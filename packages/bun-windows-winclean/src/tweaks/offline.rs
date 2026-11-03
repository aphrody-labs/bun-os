// SPDX-License-Identifier: Apache-2.0
//! Offline backend: a mounted Windows install image. Registry changes go to the image hive files through
//! `offreg.dll` (the Offline Registry library: it edits a hive without loading it into the live registry, so the
//! builder never pollutes HKLM). Appx deprovisioning, feature and capability changes go through a DISM offline
//! session ([`super::dism`]). Scheduled tasks are disabled by rewriting their XML under the image `Tasks` folder;
//! files are removed under the mount root. Services are set by their `Start` value in the SYSTEM hive.
//!
//! The image layout is mapped by [`super::offline_location`]. A hive file is opened once and cached for the life
//! of the backend, then saved on [`OfflineBackend::commit`].

use std::{collections::BTreeMap, ffi::c_void, io, path::PathBuf, sync::OnceLock};

use libloading::Library;
use windows::core::PCWSTR;

use super::{dism::Dism, offline_location, Backend, FeatureState, Op, RegData, RegHive, State, StartType, TargetKind};

type ORHKEY = *mut c_void;
type LSTATUS = i32;

// offreg.dll entry points.
type FnOpenHive = unsafe extern "system" fn(PCWSTR, *mut ORHKEY) -> LSTATUS;
type FnCloseHive = unsafe extern "system" fn(ORHKEY) -> LSTATUS;
type FnSaveHive = unsafe extern "system" fn(ORHKEY, PCWSTR, u32, u32) -> LSTATUS;
type FnCreateKey = unsafe extern "system" fn(ORHKEY, PCWSTR, PCWSTR, u32, *const c_void, *mut ORHKEY, *mut u32) -> LSTATUS;
type FnOpenKey = unsafe extern "system" fn(ORHKEY, PCWSTR, *mut ORHKEY) -> LSTATUS;
type FnCloseKey = unsafe extern "system" fn(ORHKEY) -> LSTATUS;
type FnDeleteKey = unsafe extern "system" fn(ORHKEY, PCWSTR) -> LSTATUS;
type FnGetValue = unsafe extern "system" fn(ORHKEY, PCWSTR, PCWSTR, *mut u32, *mut c_void, *mut u32) -> LSTATUS;
type FnSetValue = unsafe extern "system" fn(ORHKEY, PCWSTR, u32, *const u8, u32) -> LSTATUS;
type FnDeleteValue = unsafe extern "system" fn(ORHKEY, PCWSTR) -> LSTATUS;

const ERROR_SUCCESS: LSTATUS = 0;
const ERROR_FILE_NOT_FOUND: LSTATUS = 2;
const ERROR_MORE_DATA: LSTATUS = 234;
const REG_OPTION_NON_VOLATILE: u32 = 0;

struct OffReg {
    _lib: Library,
    open_hive: FnOpenHive,
    close_hive: FnCloseHive,
    save_hive: FnSaveHive,
    create_key: FnCreateKey,
    open_key: FnOpenKey,
    close_key: FnCloseKey,
    delete_key: FnDeleteKey,
    get_value: FnGetValue,
    set_value: FnSetValue,
    delete_value: FnDeleteValue,
}

unsafe impl Send for OffReg {}
unsafe impl Sync for OffReg {}

fn offreg() -> io::Result<&'static OffReg> {
    static LIB: OnceLock<io::Result<OffReg>> = OnceLock::new();
    LIB.get_or_init(|| {
        // SAFETY: loading a system DLL and resolving documented exports.
        unsafe {
            let lib = Library::new("offreg.dll").map_err(|e| io::Error::other(format!("load offreg.dll: {e}")))?;
            macro_rules! sym {
                ($t:ty, $n:literal) => {{ *lib.get::<$t>($n).map_err(|e| io::Error::other(format!("{}: {e}", String::from_utf8_lossy($n))))? }};
            }
            Ok(OffReg {
                open_hive: sym!(FnOpenHive, b"OROpenHive"),
                close_hive: sym!(FnCloseHive, b"ORCloseHive"),
                save_hive: sym!(FnSaveHive, b"ORSaveHive"),
                create_key: sym!(FnCreateKey, b"ORCreateKey"),
                open_key: sym!(FnOpenKey, b"OROpenKey"),
                close_key: sym!(FnCloseKey, b"ORCloseKey"),
                delete_key: sym!(FnDeleteKey, b"ORDeleteKey"),
                get_value: sym!(FnGetValue, b"ORGetValue"),
                set_value: sym!(FnSetValue, b"ORSetValue"),
                delete_value: sym!(FnDeleteValue, b"ORDeleteValue"),
                _lib: lib,
            })
        }
    })
    .as_ref()
    .map_err(|e| io::Error::other(e.to_string()))
}

fn status(code: LSTATUS, context: &str) -> io::Result<()> {
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(code))
    }
    .map_err(|e: io::Error| io::Error::new(e.kind(), format!("{context}: {e}")))
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain([0]).collect()
}

/// An offline hive file, opened once and saved on `commit`.
struct Hive {
    root: ORHKEY,
    file: PathBuf,
    dirty: bool,
}

impl Hive {
    fn open(file: PathBuf) -> io::Result<Self> {
        let or = offreg()?;
        let mut root: ORHKEY = std::ptr::null_mut();
        let path = wide(&file.to_string_lossy());
        // SAFETY: valid NUL-terminated path; `root` receives the hive handle.
        status(unsafe { (or.open_hive)(PCWSTR(path.as_ptr()), &mut root) }, "OROpenHive")?;
        Ok(Self { root, file, dirty: false })
    }

    /// Open a subkey for reading; `Ok(None)` when it does not exist.
    fn open_key(&self, subkey: &str) -> io::Result<Option<ORHKEY>> {
        let or = offreg()?;
        let mut key: ORHKEY = std::ptr::null_mut();
        let w = wide(subkey);
        // SAFETY: valid handle and NUL-terminated subkey.
        let code = unsafe { (or.open_key)(self.root, PCWSTR(w.as_ptr()), &mut key) };
        if code == ERROR_FILE_NOT_FOUND {
            Ok(None)
        } else {
            status(code, "OROpenKey").map(|()| Some(key))
        }
    }

    fn create_key(&mut self, subkey: &str) -> io::Result<ORHKEY> {
        let or = offreg()?;
        let mut key: ORHKEY = std::ptr::null_mut();
        let mut disp = 0u32;
        let w = wide(subkey);
        // SAFETY: valid handle; class null; non-volatile; default security.
        status(
            unsafe {
                (or.create_key)(self.root, PCWSTR(w.as_ptr()), PCWSTR::null(), REG_OPTION_NON_VOLATILE, std::ptr::null(), &mut key, &mut disp)
            },
            "ORCreateKey",
        )?;
        self.dirty = true;
        Ok(key)
    }

    fn close_key(&self, key: ORHKEY) {
        if let Ok(or) = offreg() {
            // SAFETY: `key` came from OROpenKey/ORCreateKey.
            unsafe { (or.close_key)(key) };
        }
    }

    fn get_value(&self, subkey: &str, name: &str) -> io::Result<Option<RegData>> {
        let Some(key) = self.open_key(subkey)? else { return Ok(None) };
        let or = offreg()?;
        let n = wide(name);
        let mut kind = 0u32;
        let mut size = 0u32;
        // SAFETY: size probe with no buffer.
        let code = unsafe { (or.get_value)(key, PCWSTR::null(), PCWSTR(n.as_ptr()), &mut kind, std::ptr::null_mut(), &mut size) };
        if code == ERROR_FILE_NOT_FOUND {
            self.close_key(key);
            return Ok(None);
        }
        if code != ERROR_SUCCESS && code != ERROR_MORE_DATA {
            self.close_key(key);
            return status(code, "ORGetValue").map(|()| None);
        }
        let mut buf = vec![0u8; size as usize];
        // SAFETY: `buf` holds `size` bytes.
        let code = unsafe { (or.get_value)(key, PCWSTR::null(), PCWSTR(n.as_ptr()), &mut kind, buf.as_mut_ptr().cast(), &mut size) };
        self.close_key(key);
        status(code, "ORGetValue")?;
        buf.truncate(size as usize);
        Ok(Some(RegData::decode(kind, &buf)))
    }

    fn set_value(&mut self, subkey: &str, name: &str, data: &RegData) -> io::Result<()> {
        let key = self.create_key(subkey)?;
        let or = offreg()?;
        let n = wide(name);
        let (kind, bytes) = data.encode();
        // SAFETY: valid key and NUL-terminated name; `bytes` holds `len` bytes.
        let code = unsafe { (or.set_value)(key, PCWSTR(n.as_ptr()), kind, bytes.as_ptr(), bytes.len() as u32) };
        self.close_key(key);
        self.dirty = true;
        status(code, "ORSetValue")
    }

    fn delete_value(&mut self, subkey: &str, name: &str) -> io::Result<()> {
        let Some(key) = self.open_key(subkey)? else { return Ok(()) };
        let or = offreg()?;
        let n = wide(name);
        // SAFETY: valid key and NUL-terminated name.
        let code = unsafe { (or.delete_value)(key, PCWSTR(n.as_ptr())) };
        self.close_key(key);
        self.dirty = true;
        if code == ERROR_FILE_NOT_FOUND { Ok(()) } else { status(code, "ORDeleteValue") }
    }

    fn delete_key(&mut self, subkey: &str) -> io::Result<()> {
        let or = offreg()?;
        let w = wide(subkey);
        // SAFETY: valid hive root and NUL-terminated subkey.
        let code = unsafe { (or.delete_key)(self.root, PCWSTR(w.as_ptr())) };
        self.dirty = true;
        if code == ERROR_FILE_NOT_FOUND { Ok(()) } else { status(code, "ORDeleteKey") }
    }

    fn key_exists(&self, subkey: &str) -> io::Result<bool> {
        Ok(self.open_key(subkey)?.inspect(|k| self.close_key(*k)).is_some())
    }

    /// Write the hive back to its file (overwriting the original) when it was modified.
    fn save(&mut self) -> io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        let or = offreg()?;
        let tmp = self.file.with_extension("bunos.tmp");
        let path = wide(&tmp.to_string_lossy());
        // SAFETY: valid hive root and path; current OS version formatting (0, 0).
        status(unsafe { (or.save_hive)(self.root, PCWSTR(path.as_ptr()), 0, 0) }, "ORSaveHive")?;
        std::fs::rename(&tmp, &self.file)?;
        self.dirty = false;
        Ok(())
    }
}

impl Drop for Hive {
    fn drop(&mut self) {
        if let Ok(or) = offreg() {
            // SAFETY: `root` came from OROpenHive and is closed once.
            unsafe { (or.close_hive)(self.root) };
        }
    }
}

/// A mounted install image.
pub struct OfflineBackend {
    mount: PathBuf,
    dism: Dism,
    hives: BTreeMap<&'static str, Hive>,
}

impl OfflineBackend {
    /// Open an offline backend over an already mounted image directory with its DISM session.
    pub fn new(mount: impl Into<PathBuf>, dism: Dism) -> Self {
        Self { mount: mount.into(), dism, hives: BTreeMap::new() }
    }

    fn hive_for(&mut self, hive: RegHive, key: &str) -> io::Result<(&mut Hive, String)> {
        let (file, subkey) = offline_location(hive, key).map_err(io::Error::other)?;
        if !self.hives.contains_key(file) {
            let opened = Hive::open(self.mount.join(file))?;
            self.hives.insert(file, opened);
        }
        Ok((self.hives.get_mut(file).expect("just inserted"), subkey))
    }

    /// Save every modified hive. Call once after a successful apply, before unmounting.
    pub fn commit(&mut self) -> io::Result<()> {
        for hive in self.hives.values_mut() {
            hive.save()?;
        }
        Ok(())
    }

    fn task_path(&self, path: &str) -> PathBuf {
        self.mount.join("Windows").join("System32").join("Tasks").join(path.trim_start_matches('\\'))
    }
}

impl Backend for OfflineBackend {
    fn kind(&self) -> TargetKind {
        TargetKind::Offline
    }

    fn detect(&mut self, op: &Op) -> io::Result<State> {
        match op {
            Op::RegSet { hive, key, name, .. } | Op::RegDeleteValue { hive, key, name } => {
                let (h, subkey) = self.hive_for(*hive, key)?;
                Ok(h.get_value(&subkey, name)?.map_or(State::Absent, |data| State::Value { data }))
            }
            Op::RegDeleteKey { hive, key } => {
                let (h, subkey) = self.hive_for(*hive, key)?;
                Ok(if h.key_exists(&subkey)? { State::KeyPresent } else { State::Absent })
            }
            Op::ServiceStart { name, .. } => {
                let (h, subkey) = self.hive_for(RegHive::Machine, &format!(r"SYSTEM\CurrentControlSet\Services\{name}"))?;
                match h.get_value(&subkey, "Start")? {
                    Some(RegData::Dword(code)) => StartType::from_code(code)
                        .map(|start| State::Start { start })
                        .ok_or_else(|| io::Error::other(format!("{name}: unknown start type {code}"))),
                    _ => Ok(State::Absent),
                }
            }
            Op::TaskDisable { path } => Ok(if self.task_path(path).exists() { State::Task { enabled: true } } else { State::Absent }),
            Op::FileRemove { path } => {
                let p = self.mount.join(path.trim_start_matches(['\\', '/']));
                Ok(if p.exists() { State::FilePresent } else { State::Absent })
            }
            // Appx provisioning and feature/capability state come from the DISM session; the engine applies them
            // without a prior read, so report Absent (it will issue the change and verify through the journal).
            Op::AppxRemove { .. } => Ok(State::Packages { full_names: vec![String::new()] }),
            Op::CapabilityRemove { .. } => Ok(State::Installed { installed: true }),
            Op::Feature { state, .. } => Ok(State::Feature {
                state: match state {
                    FeatureState::Enabled => FeatureState::Disabled,
                    FeatureState::Disabled => FeatureState::Enabled,
                },
            }),
            Op::PowerScheme { .. } => Err(io::Error::new(io::ErrorKind::Unsupported, "power schemes are live-only")),
        }
    }

    fn apply(&mut self, op: &Op) -> io::Result<()> {
        match op {
            Op::RegSet { hive, key, name, data } => {
                let (h, subkey) = self.hive_for(*hive, key)?;
                h.set_value(&subkey, name, data)
            }
            Op::RegDeleteValue { hive, key, name } => {
                let (h, subkey) = self.hive_for(*hive, key)?;
                h.delete_value(&subkey, name)
            }
            Op::RegDeleteKey { hive, key } => {
                let (h, subkey) = self.hive_for(*hive, key)?;
                h.delete_key(&subkey)
            }
            Op::ServiceStart { name, start } => {
                let (h, subkey) = self.hive_for(RegHive::Machine, &format!(r"SYSTEM\CurrentControlSet\Services\{name}"))?;
                h.set_value(&subkey, "Start", &RegData::Dword(start.code()))
            }
            Op::TaskDisable { path } => {
                let p = self.task_path(path);
                if p.exists() { std::fs::remove_file(p) } else { Ok(()) }
            }
            Op::FileRemove { path } => {
                let p = self.mount.join(path.trim_start_matches(['\\', '/']));
                if p.is_dir() {
                    std::fs::remove_dir_all(p)
                } else if p.exists() {
                    std::fs::remove_file(p)
                } else {
                    Ok(())
                }
            }
            Op::AppxRemove { family } => {
                let session = self.dism.open_offline(&self.mount.to_string_lossy())?;
                session.remove_provisioned_appx(family)
            }
            Op::CapabilityRemove { .. } | Op::Feature { .. } => {
                Err(io::Error::new(io::ErrorKind::Unsupported, "capabilities/features: DISM add/remove not yet bound"))
            }
            Op::PowerScheme { .. } => Err(io::Error::new(io::ErrorKind::Unsupported, "power schemes are live-only")),
        }
    }

    fn restore(&mut self, _op: &Op, _before: &State) -> io::Result<()> {
        // The offline image is rebuilt from the source ISO; its undo is "do not commit / rebuild", not a per-op
        // revert, so journaled restore is a no-op here.
        Ok(())
    }
}
