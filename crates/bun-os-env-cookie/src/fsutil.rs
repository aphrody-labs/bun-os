//! Atomic writes that keep (or tighten) permissions.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::Io;

/// Permission bits of an existing file on Unix; `None` elsewhere or when the file is missing.
pub(crate) fn existing_mode(path: &Path) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .ok()
            .map(|m| m.permissions().mode() & 0o7777)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// Mode for a file that holds secrets: the existing mode without group/other bits, or `0600`.
pub(crate) fn private_mode(existing: Option<u32>) -> u32 {
    existing.map_or(0o600, |mode| mode & 0o700)
}

/// Writes `data` next to `path` and renames it over `path`, so readers never see a partial file.
/// A symlink is followed so the link itself survives. `mode` (Unix only) sets the permission bits
/// of the new file before it becomes visible.
pub(crate) fn atomic_write(path: &Path, data: &[u8], mode: Option<u32>) -> io::Result<()> {
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    let target: PathBuf = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let dir = match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    let file_name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        ".{file_name}.tmp-{}-{}-{nanos}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode.unwrap_or(0o666));
        }
        let mut file = options.open(&tmp)?;
        #[cfg(unix)]
        if let Some(mode) = mode {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(mode))?;
        }
        #[cfg(not(unix))]
        let _ = mode;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Creates `dir` (and parents); on Unix a directory created here is private (`0700`).
pub(crate) fn create_private_dir(dir: &Path) -> io::Result<()> {
    if dir.is_dir() {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir_all(dir)
    }
}

pub(crate) fn home_dir(io: &Io) -> Option<PathBuf> {
    io.env_var("HOME")
        .or_else(|| io.env_var("USERPROFILE"))
        .filter(|home| !home.is_empty())
        .map(PathBuf::from)
}
