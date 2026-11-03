// SPDX-License-Identifier: Apache-2.0
//! Windows identity for Bun OS binaries, called from `build.rs`:
//!
//! ```ignore
//! fn main() {
//!     bunos_winres::Identity::from_env("Bun OS WSL service")
//!         .icon_role("linux")
//!         .embed("");
//! }
//! ```
//!
//! One resource script per binary carries:
//! - `ICON` 1 (the first icon is what Explorer, the taskbar and Start show): the design artifact's
//!   `icons/windows/ico/<theme>/app-<role>.ico` under `BUNOS_DESIGN_DIR`, else the repository's `factory/wsl/bunos.ico`;
//! - `VERSIONINFO` from Cargo (`CARGO_PKG_VERSION`, `CARGO_PKG_DESCRIPTION`, `CARGO_PKG_LICENSE`), company Aphrody;
//! - an application manifest (`RT_MANIFEST` 1): per-monitor-v2 DPI awareness, long paths, the UTF-8 active code page,
//!   `supportedOS` Windows 10/11, Common Controls v6 for GUI binaries, `asInvoker`.
//!
//! `extra` is appended verbatim (for example a MESSAGETABLE). On non-Windows targets nothing happens. A failing resource
//! compiler is a warning unless `BUNOS_REQUIRE_WINRES=1` (release lanes), so a host without rc/llvm-rc still builds.
//! `bun packages/bunos-run/src/bunos.ts windows identity <exe>` checks the result on a built binary.

use std::{
    env, fs,
    path::{Path, PathBuf},
};

pub struct Identity {
    product: String,
    description: String,
    file_name: String,
    icon: Option<PathBuf>,
    role: String,
    gui: bool,
}

impl Identity {
    /// Identity of the crate being built; `product` is the user-facing product name.
    #[must_use]
    pub fn from_env(product: &str) -> Self {
        let name = env::var("CARGO_PKG_NAME").unwrap_or_default();
        let bin = env::var("CARGO_BIN_NAME").unwrap_or_else(|_| name.clone());
        Self {
            product: product.to_string(),
            description: env::var("CARGO_PKG_DESCRIPTION")
                .ok()
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| product.to_string()),
            file_name: format!("{bin}.exe"),
            icon: None,
            role: "bunos".into(),
            gui: false,
        }
    }

    /// Short file description (Task Manager shows it as the process name).
    #[must_use]
    pub fn description(mut self, d: &str) -> Self {
        self.description = d.to_string();
        self
    }

    /// Design-artifact icon role (`app-<role>.ico`: bunos, files, terminal, settings, linux, monitor, ...).
    #[must_use]
    pub fn icon_role(mut self, role: &str) -> Self {
        self.role = role.to_string();
        self
    }

    /// An explicit `.ico`, relative to the crate directory.
    #[must_use]
    pub fn icon(mut self, path: &str) -> Self {
        self.icon = Some(manifest_dir().join(path));
        self
    }

    /// GUI binary: also requests Common Controls v6.
    #[must_use]
    pub fn gui(mut self) -> Self {
        self.gui = true;
        self
    }

    /// Writes and compiles the resource script.
    pub fn embed(self, extra: &str) {
        println!("cargo:rerun-if-env-changed=BUNOS_DESIGN_DIR");
        println!("cargo:rerun-if-env-changed=BUNOS_ICON_THEME");
        println!("cargo:rerun-if-env-changed=BUNOS_REQUIRE_WINRES");
        if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
            return;
        }
        let required = env::var("BUNOS_REQUIRE_WINRES").as_deref() == Ok("1");
        let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
        let icon = self.resolve_icon();
        if icon.is_none() {
            let msg = format!("{}: no icon found (BUNOS_DESIGN_DIR or factory/wsl/bunos.ico)", self.file_name);
            if required {
                panic!("{msg}");
            }
            println!("cargo:warning={msg}");
        }
        let manifest = out.join("bunos-app.manifest");
        fs::write(&manifest, manifest_xml(self.gui)).expect("write manifest");
        let mut rc = String::new();
        if let Some(icon) = &icon {
            println!("cargo:rerun-if-changed={}", icon.display());
            rc.push_str(&format!("1 ICON \"{}\"\n", rc_path(icon)));
        }
        rc.push_str(&format!("1 24 \"{}\"\n", rc_path(&manifest)));
        rc.push_str(&self.versioninfo());
        rc.push_str(extra);
        let script = out.join("bunos-identity.rc");
        fs::write(&script, rc).expect("write rc");
        let result = embed_resource::compile(&script, embed_resource::NONE);
        if let Err(e) = result.manifest_optional() {
            if required {
                panic!("embedding Windows resources failed: {e}");
            }
            println!("cargo:warning={} built without Windows identity resources: {e}", self.file_name);
        }
    }

    fn resolve_icon(&self) -> Option<PathBuf> {
        if let Some(p) = &self.icon {
            return p.exists().then(|| p.clone());
        }
        let theme = env::var("BUNOS_ICON_THEME").unwrap_or_else(|_| "dark".into());
        if let Ok(design) = env::var("BUNOS_DESIGN_DIR") {
            let p = Path::new(&design)
                .join("icons/windows/ico")
                .join(&theme)
                .join(format!("app-{}.ico", self.role));
            if p.exists() {
                return Some(p);
            }
        }
        // Repository fallback: the Bun OS mark every binary may carry.
        manifest_dir()
            .ancestors()
            .map(|a| a.join("factory/wsl/bunos.ico"))
            .find(|p| p.exists())
    }

    fn versioninfo(&self) -> String {
        let version = env::var("CARGO_PKG_VERSION").unwrap_or_else(|_| "0.0.0".into());
        let n: Vec<u16> = version
            .split(['.', '-', '+'])
            .take(3)
            .map(|p| p.parse().unwrap_or(0))
            .chain(std::iter::repeat(0))
            .take(4)
            .collect();
        let license = env::var("CARGO_PKG_LICENSE").unwrap_or_else(|_| "Apache-2.0".into());
        let internal = self.file_name.trim_end_matches(".exe");
        let q = |s: &str| s.replace('"', "\"\"");
        format!(
            r#"1 VERSIONINFO
FILEVERSION {a},{b},{c},{d}
PRODUCTVERSION {a},{b},{c},{d}
FILEOS 0x40004
FILETYPE 0x1
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "CompanyName", "Aphrody"
      VALUE "ProductName", "{product}"
      VALUE "FileDescription", "{description}"
      VALUE "FileVersion", "{version}"
      VALUE "ProductVersion", "{version}"
      VALUE "InternalName", "{internal}"
      VALUE "OriginalFilename", "{file}"
      VALUE "LegalCopyright", "Copyright (c) Aphrody. {license}."
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#,
            a = n[0],
            b = n[1],
            c = n[2],
            d = n[3],
            product = q(&self.product),
            description = q(&self.description),
            version = q(&version),
            internal = q(internal),
            file = q(&self.file_name),
            license = q(&license),
        )
    }
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()))
}

fn rc_path(p: &Path) -> String {
    p.display().to_string().replace('\\', "\\\\")
}

/// The application manifest: what Windows reads before the first line of `main` runs.
#[must_use]
pub fn manifest_xml(gui: bool) -> String {
    let controls = if gui {
        r#"
  <dependency>
    <dependentAssembly>
      <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0"
        processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
    </dependentAssembly>
  </dependency>"#
    } else {
        ""
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}}"/>
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>
      <heapType xmlns="http://schemas.microsoft.com/SMI/2020/WindowsSettings">SegmentHeap</heapType>
    </windowsSettings>
  </application>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>{controls}
</assembly>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_has_the_identity_settings() {
        let m = manifest_xml(true);
        for needle in ["PerMonitorV2", "longPathAware", "UTF-8", "8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a", "Common-Controls"] {
            assert!(m.contains(needle), "{needle}");
        }
        assert!(!manifest_xml(false).contains("Common-Controls"));
    }
}
