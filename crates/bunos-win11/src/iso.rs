// SPDX-License-Identifier: Apache-2.0
//! The `bunos-win11 iso` builder: take an official Windows 11 ISO, apply the offline tweak profile to a mounted
//! install.wim through the WinClean offline backend (offreg + DISM), and write a new ISO.
//!
//! This is the Bun OS, Rust-first equivalent of ntdevlabs/tiny11builder (vendored and credited at
//! vendor/tiny11builder, docs/WINDOWS-DESKTOP.md). DISM mount/commit and the offline hive edits are the DISM API
//! and offreg.dll in-process; only ISO extraction and the final `oscdimg` boot-image step shell out to the tools
//! Windows ships in the ADK, since there is no documented in-process API for them.
//!
//! The flow is staged and each stage is logged, mirroring tiny11builder's script so its behaviour is auditable:
//!   1. mount the source ISO (PowerShell `Mount-DiskImage`) and copy it to the working tree,
//!   2. pick the edition index in `sources\install.wim`,
//!   3. DISM-mount that index read-write,
//!   4. apply the offline profile (appx deprovision, policy/registry on the image hives, services, tasks, files),
//!   5. DISM-commit and unmount,
//!   6. `oscdimg` a bootable `tiny-bunos.iso`.

#[cfg(windows)]
pub use imp::build;

#[cfg(not(windows))]
pub fn build(_: &crate::IsoArgs) -> anyhow::Result<()> {
    anyhow::bail!(
        "the ISO builder runs on Windows (DISM API); build and unit-test the profile logic elsewhere"
    )
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    use anyhow::{Context, Result, bail};
    use bun_windows_winclean::tweaks::{
        Catalog, Journal, Profile, TargetKind, apply, dism::Dism, offline::OfflineBackend, plan,
    };

    use crate::IsoArgs;

    /// Where the working files live: `%LOCALAPPDATA%\bunos\win11\iso-build`.
    fn work_root() -> PathBuf {
        dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("bunos")
            .join("win11")
            .join("iso-build")
    }

    pub fn build(args: &IsoArgs) -> Result<()> {
        let profile = load_profile(args)?;
        if profile.target != TargetKind::Offline {
            bail!("the ISO profile must have target = \"offline\"");
        }
        let catalog = Catalog::embedded().context("embedded catalog")?;
        let tweaks = profile.select(&catalog).context("profile selection")?;

        let source = PathBuf::from(&args.source);
        if !source.exists() {
            bail!("source ISO not found: {}", source.display());
        }
        let out = PathBuf::from(&args.output);
        let work = work_root();
        let media = work.join("media");
        let mount = work.join("mount");
        std::fs::create_dir_all(&media)?;
        std::fs::create_dir_all(&mount)?;

        eprintln!("[1/6] copying ISO contents from {}", source.display());
        extract_iso(&source, &media)?;

        let wim = media.join("sources").join("install.wim");
        if !wim.exists() {
            bail!(
                "no sources\\install.wim in the ISO (install.esd ISOs must be exported to .wim first)"
            );
        }
        let index = args.index.unwrap_or(1);
        eprintln!("[2/6] edition index {index} in {}", wim.display());

        // install.wim in a copied ISO is read-only; clear that so DISM can commit.
        clear_readonly(&wim)?;

        let dism = Dism::initialize().context("DismInitialize")?;
        eprintln!("[3/6] mounting image read-write at {}", mount.display());
        dism.mount(&wim.to_string_lossy(), index, &mount.to_string_lossy())
            .context("DismMountImage")?;

        let result = (|| -> Result<Journal> {
            let mut backend = OfflineBackend::new(&mount, &dism);
            eprintln!(
                "[4/6] applying '{}' ({} tweaks)",
                args.config.as_deref().unwrap_or("default offline"),
                tweaks.len()
            );
            let the_plan = plan(&mut backend, &profile, &tweaks, "iso");
            eprintln!("      {} changes", the_plan.changes());
            let mut journal = Journal {
                started: "iso".into(),
                ..Journal::default()
            };
            apply(&mut backend, &the_plan, &mut journal, |_| {});
            backend.commit().context("save offline hives")?;
            Ok(journal)
        })();

        eprintln!("[5/6] unmounting (commit={})", result.is_ok());
        dism.unmount(&mount.to_string_lossy(), result.is_ok())
            .context("DismUnmountImage")?;
        let journal = result?;

        eprintln!("[6/6] writing bootable ISO {}", out.display());
        make_iso(&media, &out)?;

        let applied = journal
            .entries
            .iter()
            .filter(|e| e.result == "applied")
            .count();
        eprintln!("done: {applied} changes baked into {}", out.display());
        Ok(())
    }

    fn load_profile(args: &IsoArgs) -> Result<Profile> {
        match &args.config {
            Some(path) => {
                let text = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
                Profile::parse(&text).map_err(|e| anyhow::anyhow!("profile: {e}"))
            }
            None => Ok(Profile {
                target: TargetKind::Offline,
                level: bun_windows_winclean::tweaks::Level::Standard,
                ..Default::default()
            }),
        }
    }

    /// Copy the ISO's files to `dst` by mounting it as a drive (PowerShell `Mount-DiskImage`), robocopy, dismount.
    fn extract_iso(iso: &Path, dst: &Path) -> Result<()> {
        let script = format!(
            r#"$ErrorActionPreference='Stop';
$img = Mount-DiskImage -ImagePath '{iso}' -PassThru;
try {{
  $vol = ($img | Get-Volume).DriveLetter;
  robocopy "$vol`:\" '{dst}' /E /NFL /NDL /NJH /NJS /NP | Out-Null;
}} finally {{ Dismount-DiskImage -ImagePath '{iso}' | Out-Null }}"#,
            iso = iso.display(),
            dst = dst.display(),
        );
        run_pwsh(&script).context("mount+copy ISO")
    }

    fn clear_readonly(file: &Path) -> Result<()> {
        let mut perms = std::fs::metadata(file)?.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        std::fs::set_permissions(file, perms)?;
        Ok(())
    }

    /// Build a bootable ISO with `oscdimg` (Windows ADK). The boot data uses the standard etfsboot + efisys layout.
    fn make_iso(media: &Path, out: &Path) -> Result<()> {
        let oscdimg = which_oscdimg().context(
            "oscdimg.exe not found; install the Windows ADK Deployment Tools (the ISO tree is ready at the media dir)",
        )?;
        let bios = media.join(r"boot\etfsboot.com");
        let efi = media.join(r"efi\microsoft\boot\efisys.bin");
        let boot = format!(
            "-bootdata:2#p0,e,b{}#pEF,e,b{}",
            bios.display(),
            efi.display()
        );
        let status = std::process::Command::new(oscdimg)
            .args(["-m", "-o", "-u2", "-udfver102", &boot])
            .arg(media)
            .arg(out)
            .status()
            .context("run oscdimg")?;
        if !status.success() {
            bail!("oscdimg failed ({status})");
        }
        Ok(())
    }

    fn which_oscdimg() -> Option<PathBuf> {
        if let Ok(path) = std::env::var("OSCDIMG") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        let base = PathBuf::from(
            r"C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools",
        );
        for arch in ["amd64", "arm64", "x86"] {
            let p = base.join(arch).join(r"Oscdimg\oscdimg.exe");
            if p.exists() {
                return Some(p);
            }
        }
        None
    }

    fn run_pwsh(script: &str) -> Result<()> {
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .status()
            .context("spawn powershell")?;
        if !status.success() {
            bail!("powershell step failed ({status})");
        }
        Ok(())
    }
}
