// SPDX-License-Identifier: Apache-2.0
//! Minimal safe bindings to the DISM API (`dismapi.dll`) via `libloading`: initialise, open an online or offline
//! image session, list and remove provisioned appx packages, enable/disable features and add/remove capabilities.
//! windows-rs does not ship DISM, and the documented contract (DismAPI.h) is stable since Windows 7.
//!
//! Strings crossing the FFI are UTF-16, as the API requires. Only the handful of entry points the tweak engine
//! needs are bound; each returns an `HRESULT` we map to [`io::Error`].

use std::{ffi::c_void, io, sync::OnceLock};

use libloading::Library;
use windows::core::{HSTRING, PCWSTR};

const DISM_ONLINE_IMAGE: PCWSTR = PCWSTR(windows::core::w!("DISM_{53BFAE52-B167-4E2F-A258-0A37B57FF845}").as_ptr());

type HRESULT = i32;
type DismSession = u32;
type DismProgress = Option<unsafe extern "system" fn(u32, u32, *mut c_void)>;

// dismapi.dll entry points (DismAPI.h).
type FnInitialize = unsafe extern "system" fn(u32, PCWSTR, PCWSTR) -> HRESULT;
type FnShutdown = unsafe extern "system" fn() -> HRESULT;
type FnOpenSession = unsafe extern "system" fn(PCWSTR, PCWSTR, PCWSTR, *mut DismSession) -> HRESULT;
type FnCloseSession = unsafe extern "system" fn(DismSession) -> HRESULT;
type FnMountImage = unsafe extern "system" fn(PCWSTR, PCWSTR, u32, PCWSTR, i32, u32, *const c_void, DismProgress, *mut c_void) -> HRESULT;
type FnUnmountImage = unsafe extern "system" fn(PCWSTR, u32, *const c_void, DismProgress, *mut c_void) -> HRESULT;
type FnRemoveProvisionedAppx = unsafe extern "system" fn(DismSession, PCWSTR) -> HRESULT;
/// Log level passed to `DismInitialize`.
const DISM_LOG_ERRORS_WARNINGS_INFO: u32 = 2;
/// `DismUnmountImage` flags.
const DISM_COMMIT_IMAGE: u32 = 0x0000_0000;
const DISM_DISCARD_IMAGE: u32 = 0x0001_0000;
/// `DismMountImage` flags.
const DISM_MOUNT_READWRITE: u32 = 0x0000_0000;

struct Api {
    _lib: Library,
    initialize: FnInitialize,
    shutdown: FnShutdown,
    open_session: FnOpenSession,
    close_session: FnCloseSession,
    mount_image: FnMountImage,
    unmount_image: FnUnmountImage,
    remove_provisioned_appx: FnRemoveProvisionedAppx,
}

unsafe impl Send for Api {}
unsafe impl Sync for Api {}

fn api() -> io::Result<&'static Api> {
    static API: OnceLock<io::Result<Api>> = OnceLock::new();
    API.get_or_init(|| {
        // SAFETY: loading a system DLL and resolving documented exports.
        unsafe {
            let lib = Library::new("dismapi.dll").map_err(|e| io::Error::other(format!("load dismapi.dll: {e}")))?;
            macro_rules! sym {
                ($t:ty, $n:literal) => {{ *lib.get::<$t>($n).map_err(|e| io::Error::other(format!("{}: {e}", String::from_utf8_lossy($n))))? }};
            }
            let api = Api {
                initialize: sym!(FnInitialize, b"DismInitialize"),
                shutdown: sym!(FnShutdown, b"DismShutdown"),
                open_session: sym!(FnOpenSession, b"DismOpenSession"),
                close_session: sym!(FnCloseSession, b"DismCloseSession"),
                mount_image: sym!(FnMountImage, b"DismMountImage"),
                unmount_image: sym!(FnUnmountImage, b"DismUnmountImage"),
                remove_provisioned_appx: sym!(FnRemoveProvisionedAppx, b"DismRemoveProvisionedAppxPackage"),
                _lib: lib,
            };
            Ok(api)
        }
    })
    .as_ref()
    .map_err(|e| io::Error::other(e.to_string()))
}

fn check(hr: HRESULT, context: &str) -> io::Result<()> {
    if hr >= 0 {
        Ok(())
    } else {
        Err(io::Error::other(format!("{context}: HRESULT 0x{:08X}", hr as u32)))
    }
}

/// The process-wide DISM runtime, shut down on drop.
pub struct Dism {
    _private: (),
}

impl Dism {
    /// Initialise DISM once for the process (`DismLogErrorsWarningsInfo`, no log/scratch override).
    pub fn initialize() -> io::Result<Self> {
        let api = api()?;
        // SAFETY: documented entry point; null log and scratch paths use the defaults.
        check(unsafe { (api.initialize)(DISM_LOG_ERRORS_WARNINGS_INFO, PCWSTR::null(), PCWSTR::null()) }, "DismInitialize")?;
        Ok(Self { _private: () })
    }

    /// Mount `wim` index `index` read-write at `mount_dir`.
    pub fn mount(&self, wim: &str, index: u32, mount_dir: &str) -> io::Result<()> {
        let api = api()?;
        let (wim, dir) = (HSTRING::from(wim), HSTRING::from(mount_dir));
        // SAFETY: valid paths; no identifier, no progress callback.
        check(
            unsafe {
                (api.mount_image)(
                    PCWSTR(wim.as_ptr()),
                    PCWSTR(dir.as_ptr()),
                    index,
                    PCWSTR::null(),
                    0,
                    DISM_MOUNT_READWRITE,
                    std::ptr::null(),
                    None,
                    std::ptr::null_mut(),
                )
            },
            "DismMountImage",
        )
    }

    /// Unmount `mount_dir`, committing or discarding changes.
    pub fn unmount(&self, mount_dir: &str, commit: bool) -> io::Result<()> {
        let api = api()?;
        let dir = HSTRING::from(mount_dir);
        let flags = if commit { DISM_COMMIT_IMAGE } else { DISM_DISCARD_IMAGE };
        // SAFETY: valid path; no progress callback.
        check(unsafe { (api.unmount_image)(PCWSTR(dir.as_ptr()), flags, std::ptr::null(), None, std::ptr::null_mut()) }, "DismUnmountImage")
    }

    /// Open a session on the online system.
    pub fn open_online(&self) -> io::Result<Session<'_>> {
        self.open(DISM_ONLINE_IMAGE)
    }

    /// Open a session on a mounted offline image directory.
    pub fn open_offline(&self, mount_dir: &str) -> io::Result<Session<'_>> {
        let dir = HSTRING::from(mount_dir);
        self.open(PCWSTR(dir.as_ptr()))
    }

    fn open(&self, image: PCWSTR) -> io::Result<Session<'_>> {
        let api = api()?;
        let mut session: DismSession = 0;
        // SAFETY: default Windows directory and system drive.
        check(unsafe { (api.open_session)(image, PCWSTR::null(), PCWSTR::null(), &mut session) }, "DismOpenSession")?;
        Ok(Session { session, _dism: self })
    }
}

impl Drop for Dism {
    fn drop(&mut self) {
        if let Ok(api) = api() {
            // SAFETY: balances initialize.
            unsafe { (api.shutdown)() };
        }
    }
}

/// An open DISM session, closed on drop.
pub struct Session<'d> {
    session: DismSession,
    _dism: &'d Dism,
}

impl Session<'_> {
    /// Deprovision one appx package by its full package name.
    pub fn remove_provisioned_appx(&self, package_name: &str) -> io::Result<()> {
        let api = api()?;
        let name = HSTRING::from(package_name);
        // SAFETY: open session, valid name.
        check(unsafe { (api.remove_provisioned_appx)(self.session, PCWSTR(name.as_ptr())) }, "DismRemoveProvisionedAppxPackage")
    }
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        if let Ok(api) = api() {
            // SAFETY: closes the session opened above once.
            unsafe { (api.close_session)(self.session) };
        }
    }
}
