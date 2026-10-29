// SPDX-License-Identifier: Apache-2.0 OR MIT
//! Every Tauri 3 plugin in one crate, plus upstream Bun as a first-class backend runtime.
//!
//! Each module stays its own runtime plugin (`plugin:fs|read_file`, `fs:allow-read-file`, …) and is
//! gated by the Cargo feature of the same name. The `aphrody` plugin itself ([`bun`]) runs a Bun
//! server (script with `bun --hot`, or a `bun build --compile` sidecar) next to the app and bridges
//! the webview to it over IPC.

extern crate self as tauri_plugin_aphrody;

pub mod bun;

#[cfg(feature = "autostart")]
pub mod autostart;
#[cfg(feature = "clipboard-manager")]
pub mod clipboard_manager;
#[cfg(feature = "deep-link")]
pub mod deep_link;
#[cfg(feature = "dialog")]
pub mod dialog;
#[cfg(feature = "fs")]
pub mod fs;
#[cfg(feature = "global-shortcut")]
pub mod global_shortcut;
#[cfg(feature = "log")]
pub mod log;
#[cfg(feature = "mcp-bridge")]
pub mod mcp_bridge;
#[cfg(feature = "notification")]
pub mod notification;
#[cfg(feature = "opener")]
pub mod opener;
#[cfg(feature = "os")]
pub mod os;
#[cfg(feature = "process")]
pub mod process;
#[cfg(feature = "single-instance")]
#[allow(unsafe_op_in_unsafe_fn)]
pub mod single_instance;
#[cfg(feature = "store")]
pub mod store;
#[cfg(feature = "updater")]
pub mod updater;
#[cfg(feature = "window-state")]
pub mod window_state;
#[cfg(feature = "wrap")]
pub mod wrap;

pub use bun::init;

/// Registers the `aphrody` plugin and every enabled module that needs no argument.
///
/// `autostart` uses its defaults (LaunchAgent, no args). `single-instance` (needs a callback),
/// `updater` (needs `plugins > updater` with a public key), `mcp-bridge` and `wrap` (opt-in) are
/// registered by the app itself.
pub trait BuilderExt<R: tauri::Runtime> {
    #[must_use]
    fn aphrody_plugins(self) -> Self;
}

impl<R: tauri::Runtime> BuilderExt<R> for tauri::Builder<R> {
    #[allow(unused_mut)]
    fn aphrody_plugins(self) -> Self {
        let mut builder = self.plugin(bun::init());
        #[cfg(all(
            feature = "autostart",
            not(any(target_os = "android", target_os = "ios"))
        ))]
        {
            builder = builder.plugin(autostart::init(autostart::MacosLauncher::LaunchAgent, None));
        }
        #[cfg(feature = "clipboard-manager")]
        {
            builder = builder.plugin(clipboard_manager::init());
        }
        #[cfg(feature = "deep-link")]
        {
            builder = builder.plugin(deep_link::init());
        }
        #[cfg(feature = "fs")]
        {
            builder = builder.plugin(fs::init());
        }
        #[cfg(feature = "dialog")]
        {
            builder = builder.plugin(dialog::init());
        }
        #[cfg(all(
            feature = "global-shortcut",
            not(any(target_os = "android", target_os = "ios"))
        ))]
        {
            builder = builder.plugin(global_shortcut::Builder::new().build());
        }
        #[cfg(feature = "log")]
        {
            builder = builder.plugin(log::Builder::new().build());
        }
        #[cfg(feature = "notification")]
        {
            builder = builder.plugin(notification::init());
        }
        #[cfg(feature = "opener")]
        {
            builder = builder.plugin(opener::init());
        }
        #[cfg(feature = "os")]
        {
            builder = builder.plugin(os::init());
        }
        #[cfg(feature = "process")]
        {
            builder = builder.plugin(process::init());
        }
        #[cfg(feature = "store")]
        {
            builder = builder.plugin(store::Builder::default().build());
        }
        #[cfg(all(
            feature = "window-state",
            not(any(target_os = "android", target_os = "ios"))
        ))]
        {
            builder = builder.plugin(window_state::Builder::default().build());
        }
        builder
    }
}
