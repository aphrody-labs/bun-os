// SPDX-License-Identifier: Apache-2.0
//! Running wsl.exe as the distro owner from a LocalSystem service, with no password and no logon.
//!
//! WslService refuses LocalSystem clients (`WSL_E_LOCAL_SYSTEM_NOT_SUPPORTED`) and keeps one session (one utility VM)
//! per user SID, with the distro registry under that user's HKCU. So the service obtains the owner's token by S4U
//! (`LsaLogonUser` with `MSV1_0_S4U_LOGON`, which needs SeTcbPrivilege, held by LocalSystem, and no credential),
//! loads the owner's profile (HKCU hive), and starts wsl.exe with `CreateProcessAsUserW`. The session it creates has
//! session ID 0, which WslService never terminates on a user logoff (only on service stop), and later interactive
//! `wsl.exe` calls of the same user land in the same session and VM.
//!
//! WSLg constrains that: WSLGd starts its RDP client (`msrdc.exe`) by interop through the Windows session that created
//! the VM. A VM created from session 0 puts msrdc in session 0, which has no desktop: the RAIL connection never
//! completes, the client drops after ~100 s, Weston crashes on the dead peer and no Linux window ever draws. So when the
//! owner has an active interactive session, the service uses that session's token (`WTSQueryUserToken`) on the
//! `winsta0\default` desktop; S4U stays the fallback before logon (instance.rs moves the VM at the owner's logon).

use crate::units::{command_line, decode_wsl};
use anyhow::{Context, Result, bail};
use std::{
    ffi::c_void,
    fs::File,
    io::Read,
    os::windows::io::FromRawHandle,
    ptr::{null, null_mut},
    sync::{Arc, Mutex},
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, LUID,
        SetHandleInformation, WAIT_OBJECT_0,
    },
    Security::{
        AllocateLocallyUniqueId, Authentication::Identity::*, QUOTA_LIMITS, SECURITY_ATTRIBUTES,
        TOKEN_SOURCE,
    },
    Storage::FileSystem::{
        CreateFileW, FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    },
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    },
    System::RemoteDesktop::{
        ProcessIdToSessionId, WTS_CURRENT_SERVER_HANDLE, WTS_INFO_CLASS, WTS_SESSION_INFOW,
        WTSActive, WTSDomainName, WTSEnumerateSessionsW, WTSFreeMemory,
        WTSQuerySessionInformationW, WTSQueryUserToken, WTSUserName,
    },
    System::{
        Environment::{CreateEnvironmentBlock, DestroyEnvironmentBlock},
        Pipes::CreatePipe,
        Threading::{
            CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessAsUserW, CreateProcessW,
            GetExitCodeProcess, INFINITE, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
            TerminateProcess, WaitForSingleObject,
        },
    },
    UI::Shell::{GetUserProfileDirectoryW, LoadUserProfileW, PROFILEINFOW, UnloadUserProfile},
};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Serialises pipe creation and CreateProcess: an inheritable pipe end created by one thread must not leak into a
/// child started by another, or the first child's stdout would never reach EOF.
static SPAWN: Mutex<()> = Mutex::new(());

/// The owner's token, loaded profile and environment block.
pub struct UserSession {
    token: HANDLE,
    profile: HANDLE,
    env: *mut c_void,
    profile_dir: Vec<u16>,
    pub account: String,
    /// The owner's interactive Windows session (token from `WTSQueryUserToken`); None for the S4U session 0.
    pub interactive: Option<u32>,
}

// The handles are process-wide kernel objects; access is read-only after construction.
unsafe impl Send for UserSession {}
unsafe impl Sync for UserSession {}

/// `user`, `.\user` or `COMPUTER\user` -> (domain, user).
fn split_account(account: &str) -> (String, String) {
    let computer = || std::env::var("COMPUTERNAME").unwrap_or_default();
    match account.split_once('\\') {
        Some((d, u)) if d != "." => (d.to_string(), u.to_string()),
        Some((_, u)) => (computer(), u.to_string()),
        None => (computer(), account.to_string()),
    }
}

/// A WTS string property (user or domain name) of a session.
fn wts_string(id: u32, class: WTS_INFO_CLASS) -> String {
    unsafe {
        let mut buf: *mut u16 = null_mut();
        let mut bytes = 0u32;
        if WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, id, class, &mut buf, &mut bytes)
            == 0
            || buf.is_null()
        {
            return String::new();
        }
        let len = (0..).take_while(|&i| *buf.add(i) != 0).count();
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(buf, len));
        WTSFreeMemory(buf as *mut c_void);
        s
    }
}

/// The active interactive Windows session (console or remote) in which `account` is logged on, if any.
pub fn active_session_of(account: &str) -> Option<u32> {
    let (domain, user) = split_account(account);
    unsafe {
        let mut list: *mut WTS_SESSION_INFOW = null_mut();
        let mut count = 0u32;
        if WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut list, &mut count) == 0 {
            return None;
        }
        let found = std::slice::from_raw_parts(list, count as usize)
            .iter()
            .filter(|s| s.SessionId != 0 && s.State == WTSActive)
            .map(|s| s.SessionId)
            .find(|&id| {
                wts_string(id, WTSUserName).eq_ignore_ascii_case(&user)
                    && wts_string(id, WTSDomainName).eq_ignore_ascii_case(&domain)
            });
        WTSFreeMemory(list as *mut c_void);
        found
    }
}

/// True when an `msrdc.exe` runs in session 0: only WSLg starts the Remote Desktop client there, and it means the VM
/// was created from session 0 (S4U) so its Linux windows cannot reach any desktop.
pub fn wslg_client_in_session0() -> bool {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut ok = Process32FirstW(snap, &mut e) != 0;
        while ok && !found {
            let len = e
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..len]).eq_ignore_ascii_case("msrdc.exe") {
                let mut sid = u32::MAX;
                found = ProcessIdToSessionId(e.th32ProcessID, &mut sid) != 0 && sid == 0;
            }
            ok = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        found
    }
}

impl UserSession {
    /// The owner's token in their active interactive session (`WTSQueryUserToken`, needs LocalSystem), so wsl.exe
    /// and the VM's interop (WSLg's msrdc) run on the user's desktop. Ok(None) when the owner is not logged on.
    pub fn interactive(account: &str) -> Result<Option<Self>> {
        let Some(id) = active_session_of(account) else {
            return Ok(None);
        };
        let (domain, user) = split_account(account);
        unsafe {
            let mut token: HANDLE = null_mut();
            if WTSQueryUserToken(id, &mut token) == 0 {
                bail!("WTSQueryUserToken(session {id}): Win32 {}", GetLastError());
            }
            let mut env: *mut c_void = null_mut();
            if CreateEnvironmentBlock(&mut env, token, 0) == 0 {
                env = null_mut();
            }
            let mut len = 0u32;
            GetUserProfileDirectoryW(token, null_mut(), &mut len);
            let mut dir = vec![0u16; len.max(1) as usize];
            if GetUserProfileDirectoryW(token, dir.as_mut_ptr(), &mut len) == 0 {
                dir = wide("C:\\");
            }
            Ok(Some(Self {
                token,
                // The interactive logon already loaded the profile: nothing to unload.
                profile: null_mut(),
                env,
                profile_dir: dir,
                account: format!("{domain}\\{user}"),
                interactive: Some(id),
            }))
        }
    }

    /// S4U logon of a local account (`user` or `COMPUTER\user`; Microsoft-account users are local accounts too).
    pub fn s4u(account: &str) -> Result<Self> {
        let (domain, user) = split_account(account);
        unsafe {
            let name = b"BunOSWsl";
            let process_name = LSA_STRING {
                Length: name.len() as u16,
                MaximumLength: name.len() as u16,
                Buffer: name.as_ptr() as *mut u8,
            };
            let mut lsa: HANDLE = null_mut();
            let mut mode = 0u32;
            let st = LsaRegisterLogonProcess(&process_name, &mut lsa, &mut mode);
            if st != 0 {
                bail!(
                    "LsaRegisterLogonProcess: NTSTATUS {st:#x} (needs SeTcbPrivilege: run as LocalSystem)"
                );
            }
            let pkg_name = b"MICROSOFT_AUTHENTICATION_PACKAGE_V1_0";
            let pkg_str = LSA_STRING {
                Length: pkg_name.len() as u16,
                MaximumLength: pkg_name.len() as u16,
                Buffer: pkg_name.as_ptr() as *mut u8,
            };
            let mut pkg = 0u32;
            let st = LsaLookupAuthenticationPackage(lsa, &pkg_str, &mut pkg);
            if st != 0 {
                LsaDeregisterLogonProcess(lsa);
                bail!("LsaLookupAuthenticationPackage: NTSTATUS {st:#x}");
            }
            // MSV1_0_S4U_LOGON followed by the two strings in the same buffer (pointers are absolute).
            let u16user: Vec<u16> = user.encode_utf16().collect();
            let u16dom: Vec<u16> = domain.encode_utf16().collect();
            let head = size_of::<MSV1_0_S4U_LOGON>();
            let total = head + (u16user.len() + u16dom.len()) * 2;
            let mut buf = vec![0u64; total.div_ceil(8)];
            let base = buf.as_mut_ptr() as *mut u8;
            let pu = base.add(head) as *mut u16;
            std::ptr::copy_nonoverlapping(u16user.as_ptr(), pu, u16user.len());
            let pd = pu.add(u16user.len());
            std::ptr::copy_nonoverlapping(u16dom.as_ptr(), pd, u16dom.len());
            let logon = base as *mut MSV1_0_S4U_LOGON;
            (*logon).MessageType = MsV1_0S4ULogon;
            (*logon).Flags = 0;
            (*logon).UserPrincipalName = LSA_UNICODE_STRING {
                Length: (u16user.len() * 2) as u16,
                MaximumLength: (u16user.len() * 2) as u16,
                Buffer: pu,
            };
            (*logon).DomainName = LSA_UNICODE_STRING {
                Length: (u16dom.len() * 2) as u16,
                MaximumLength: (u16dom.len() * 2) as u16,
                Buffer: pd,
            };

            let mut source = TOKEN_SOURCE {
                SourceName: [0; 8],
                SourceIdentifier: LUID {
                    LowPart: 0,
                    HighPart: 0,
                },
            };
            for (d, s) in source.SourceName.iter_mut().zip(b"BunOSWsl") {
                *d = *s as i8;
            }
            AllocateLocallyUniqueId(&mut source.SourceIdentifier);
            let mut profile_buf: *mut c_void = null_mut();
            let mut profile_len = 0u32;
            let mut luid = LUID {
                LowPart: 0,
                HighPart: 0,
            };
            let mut token: HANDLE = null_mut();
            let mut quotas: QUOTA_LIMITS = std::mem::zeroed();
            let mut sub = 0i32;
            // Batch: a non-interactive logon that Administrators and Users may perform by default; Network is the fallback.
            let mut st = 0;
            for kind in [SECURITY_LOGON_TYPE::Batch, SECURITY_LOGON_TYPE::Network] {
                st = LsaLogonUser(
                    lsa,
                    &process_name,
                    kind,
                    pkg,
                    base as *const c_void,
                    total as u32,
                    null(),
                    &source,
                    &mut profile_buf,
                    &mut profile_len,
                    &mut luid,
                    &mut token,
                    &mut quotas,
                    &mut sub,
                );
                if !profile_buf.is_null() {
                    LsaFreeReturnBuffer(profile_buf);
                    profile_buf = null_mut();
                }
                if st == 0 {
                    break;
                }
            }
            LsaDeregisterLogonProcess(lsa);
            if st != 0 {
                bail!(
                    "S4U logon of {domain}\\{user} failed: NTSTATUS {st:#x} (Win32 {}), substatus {sub:#x}",
                    LsaNtStatusToWinError(st)
                );
            }

            let mut uname = wide(&user);
            let mut pi = PROFILEINFOW {
                dwSize: size_of::<PROFILEINFOW>() as u32,
                dwFlags: 1, /* PI_NOUI */
                lpUserName: uname.as_mut_ptr(),
                ..Default::default()
            };
            if LoadUserProfileW(token, &mut pi) == 0 {
                let e = GetLastError();
                CloseHandle(token);
                bail!("LoadUserProfileW({user}): Win32 {e}");
            }
            let mut env: *mut c_void = null_mut();
            if CreateEnvironmentBlock(&mut env, token, 0) == 0 {
                env = null_mut();
            }
            let mut len = 0u32;
            GetUserProfileDirectoryW(token, null_mut(), &mut len);
            let mut dir = vec![0u16; len.max(1) as usize];
            if GetUserProfileDirectoryW(token, dir.as_mut_ptr(), &mut len) == 0 {
                dir = wide("C:\\");
            }
            Ok(Self {
                token,
                profile: pi.hProfile,
                env,
                profile_dir: dir,
                account: format!("{domain}\\{user}"),
                interactive: None,
            })
        }
    }
}

impl Drop for UserSession {
    fn drop(&mut self) {
        unsafe {
            if !self.env.is_null() {
                DestroyEnvironmentBlock(self.env);
            }
            if !self.profile.is_null() {
                UnloadUserProfile(self.token, self.profile);
            }
            CloseHandle(self.token);
        }
    }
}

/// A started wsl.exe with its stdout and stderr pipes.
pub struct Proc {
    process: HANDLE,
    pub pid: u32,
    pub stdout: Option<File>,
    pub stderr: Option<File>,
}

unsafe impl Send for Proc {}

impl Proc {
    /// Waits up to `timeout` (None = forever); returns the exit code, or None on timeout.
    pub fn wait(&self, timeout: Option<Duration>) -> Option<u32> {
        let ms = timeout
            .map(|d| d.as_millis().min(u32::MAX as u128 - 1) as u32)
            .unwrap_or(INFINITE);
        unsafe {
            if WaitForSingleObject(self.process, ms) != WAIT_OBJECT_0 {
                return None;
            }
            let mut code = 0u32;
            GetExitCodeProcess(self.process, &mut code);
            Some(code)
        }
    }

    pub fn kill(&self) {
        unsafe {
            TerminateProcess(self.process, 1);
        }
    }
}

impl Drop for Proc {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.process);
        }
    }
}

/// Who wsl.exe runs as: the calling user (CLI) or the owner's S4U session (service).
#[derive(Clone)]
pub enum Runner {
    Current,
    As(Arc<UserSession>),
}

pub fn wsl_exe() -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    format!("{root}\\System32\\wsl.exe")
}

impl Runner {
    pub fn spawn(&self, args: &[String]) -> Result<Proc> {
        let exe = wsl_exe();
        let mut cmd = wide(&command_line(&exe, args));
        let exe_w = wide(&exe);
        let _guard = SPAWN.lock().unwrap_or_else(|e| e.into_inner());
        unsafe {
            let sa = SECURITY_ATTRIBUTES {
                nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: null_mut(),
                bInheritHandle: 1,
            };
            let (mut out_r, mut out_w, mut err_r, mut err_w): (HANDLE, HANDLE, HANDLE, HANDLE) =
                (null_mut(), null_mut(), null_mut(), null_mut());
            if CreatePipe(&mut out_r, &mut out_w, &sa, 0) == 0
                || CreatePipe(&mut err_r, &mut err_w, &sa, 0) == 0
            {
                bail!("CreatePipe: Win32 {}", GetLastError());
            }
            SetHandleInformation(out_r, HANDLE_FLAG_INHERIT, 0);
            SetHandleInformation(err_r, HANDLE_FLAG_INHERIT, 0);
            let nul = CreateFileW(
                wide("NUL").as_ptr(),
                FILE_GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &sa,
                OPEN_EXISTING,
                0,
                null_mut(),
            );
            // An interactive token starts wsl.exe on the owner's desktop (their session, winsta0\default).
            let mut desktop = wide("winsta0\\default");
            let on_desktop = matches!(self, Runner::As(s) if s.interactive.is_some());
            let si = STARTUPINFOW {
                cb: size_of::<STARTUPINFOW>() as u32,
                lpDesktop: if on_desktop {
                    desktop.as_mut_ptr()
                } else {
                    null_mut()
                },
                dwFlags: STARTF_USESTDHANDLES,
                hStdInput: if nul == INVALID_HANDLE_VALUE {
                    null_mut()
                } else {
                    nul
                },
                hStdOutput: out_w,
                hStdError: err_w,
                ..Default::default()
            };
            let mut pi: PROCESS_INFORMATION = std::mem::zeroed();
            let ok = match self {
                Runner::Current => CreateProcessW(
                    exe_w.as_ptr(),
                    cmd.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    CREATE_NO_WINDOW,
                    null(),
                    null(),
                    &si,
                    &mut pi,
                ),
                Runner::As(s) => CreateProcessAsUserW(
                    s.token,
                    exe_w.as_ptr(),
                    cmd.as_mut_ptr(),
                    null(),
                    null(),
                    1,
                    CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                    s.env,
                    s.profile_dir.as_ptr(),
                    &si,
                    &mut pi,
                ),
            };
            let err = GetLastError();
            CloseHandle(out_w);
            CloseHandle(err_w);
            if nul != INVALID_HANDLE_VALUE {
                CloseHandle(nul);
            }
            if ok == 0 {
                CloseHandle(out_r);
                CloseHandle(err_r);
                bail!("CreateProcess(wsl.exe): Win32 {err}");
            }
            CloseHandle(pi.hThread);
            Ok(Proc {
                process: pi.hProcess,
                pid: pi.dwProcessId,
                stdout: Some(File::from_raw_handle(out_r as _)),
                stderr: Some(File::from_raw_handle(err_r as _)),
            })
        }
    }

    /// Runs wsl.exe to completion: (exit code, stdout as UTF-8, stderr decoded from wsl.exe's UTF-16).
    pub fn output(&self, args: &[String], timeout: Duration) -> Result<(u32, String, String)> {
        let mut p = self.spawn(args)?;
        let mut so = p.stdout.take().unwrap();
        let mut se = p.stderr.take().unwrap();
        let t = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = se.read_to_end(&mut b);
            b
        });
        let t2 = std::thread::spawn(move || {
            let mut b = Vec::new();
            let _ = so.read_to_end(&mut b);
            b
        });
        let Some(code) = p.wait(Some(timeout)) else {
            p.kill();
            bail!("wsl.exe {} timed out after {timeout:?}", args.join(" "));
        };
        let out = t2.join().unwrap_or_default();
        let err = t.join().unwrap_or_default();
        Ok((code, decode_wsl(&out), decode_wsl(&err)))
    }

    /// `wsl.exe -d <distro> -u root --exec <argv>`; fails with stderr when the exit code is non-zero.
    pub fn exec_root(&self, distro: &str, argv: &[&str], timeout: Duration) -> Result<String> {
        let mut args = vec![
            "-d".to_string(),
            distro.to_string(),
            "-u".into(),
            "root".into(),
            "--exec".into(),
        ];
        args.extend(argv.iter().map(|s| s.to_string()));
        let (code, out, err) = self
            .output(&args, timeout)
            .with_context(|| format!("wsl.exe -d {distro} --exec {}", argv.join(" ")))?;
        if code != 0 {
            bail!(
                "{} exited {code}: {}{}",
                argv.join(" "),
                err.trim(),
                out.trim()
            );
        }
        Ok(out)
    }
}
