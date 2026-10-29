// SPDX-License-Identifier: GPL-3.0-or-later
//! OTA channels (`tools/helpers/images.py`, `tools/actions/initializer.py`).
//! A channel is a JSON document `{"response":[{datetime,filename,id,romtype,size,url,version}]}`
//! whose `id` is the SHA-256 of the zip. Upstream trusts that hash because it comes from the
//! same HTTPS origin; there is no detached signature. `verify_file` keeps that guarantee and a
//! caller can additionally pin a hash obtained out of band.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

pub const DEFAULT_SYSTEM_CHANNEL: &str = "https://ota.waydro.id/system";
pub const DEFAULT_VENDOR_CHANNEL: &str = "https://ota.waydro.id/vendor";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Build {
    pub datetime: u64,
    pub filename: String,
    pub id: String,
    #[serde(default)]
    pub romtype: String,
    #[serde(default)]
    pub size: u64,
    pub url: String,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Deserialize)]
struct Channel {
    response: Vec<Build>,
}

#[derive(Debug)]
pub enum Error {
    Http(String),
    Json(serde_json::Error),
    Io(io::Error),
    Zip(String),
    EmptyChannel,
    HashMismatch { expected: String, actual: String },
    UnsafePath(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Http(m) => write!(f, "http: {m}"),
            Error::Json(e) => write!(f, "json: {e}"),
            Error::Io(e) => write!(f, "io: {e}"),
            Error::Zip(m) => write!(f, "zip: {m}"),
            Error::EmptyChannel => write!(f, "no images found on channel"),
            Error::HashMismatch { expected, actual } => {
                write!(f, "sha256 mismatch: expected {expected}, got {actual}")
            }
            Error::UnsafePath(p) => write!(f, "unsafe archive path: {p}"),
        }
    }
}
impl std::error::Error for Error {}
impl From<io::Error> for Error {
    fn from(e: io::Error) -> Self {
        Error::Io(e)
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Json(e)
    }
}

/// `<base>/<rom_type>/waydroid_<arch>/<system_type>.json` (initializer.py).
pub fn system_channel_url(base: &str, rom_type: &str, arch: &str, system_type: &str) -> String {
    format!(
        "{}/{}/waydroid_{}/{}.json",
        base.trim_end_matches('/'),
        rom_type,
        arch,
        system_type
    )
}

/// `<base>/waydroid_<arch>/<vendor>.json`, spaces in the vendor name become `_`.
pub fn vendor_channel_url(base: &str, arch: &str, vendor: &str) -> String {
    format!(
        "{}/waydroid_{}/{}.json",
        base.trim_end_matches('/'),
        arch,
        vendor.replace(' ', "_")
    )
}

pub fn parse_channel(json: &str) -> Result<Vec<Build>, Error> {
    let ch: Channel = serde_json::from_str(json)?;
    if ch.response.is_empty() {
        return Err(Error::EmptyChannel);
    }
    Ok(ch.response)
}

/// First build strictly newer than `current` in channel order, as `images.get` does.
pub fn first_newer(builds: &[Build], current: u64) -> Option<&Build> {
    builds.iter().find(|b| b.datetime > current)
}

/// Most recent build regardless of channel order.
pub fn latest(builds: &[Build]) -> Option<&Build> {
    builds.iter().max_by_key(|b| b.datetime)
}

pub fn sha256_reader<R: Read>(mut r: R) -> io::Result<String> {
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex(&h.finalize()))
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    sha256_reader(File::open(path)?)
}

fn hex(bytes: &[u8]) -> String {
    const D: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(D[(b >> 4) as usize] as char);
        s.push(D[(b & 15) as usize] as char);
    }
    s
}

/// Compare a file against the channel `id` (case-insensitive hex).
pub fn verify_file(path: &Path, expected: &str) -> Result<(), Error> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(Error::HashMismatch {
            expected: expected.to_string(),
            actual,
        })
    }
}

/// True when the file hash appears in the channel (`images.validate`, used for offline updates).
pub fn validate_against_channel(path: &Path, builds: &[Build]) -> Result<bool, Error> {
    let sum = sha256_file(path)?;
    Ok(builds.iter().any(|b| b.id.eq_ignore_ascii_case(&sum)))
}

pub fn fetch_channel(url: &str) -> Result<Vec<Build>, Error> {
    let mut resp = ureq::get(url)
        .call()
        .map_err(|e| Error::Http(e.to_string()))?;
    let body = resp
        .body_mut()
        .read_to_string()
        .map_err(|e| Error::Http(e.to_string()))?;
    parse_channel(&body)
}

/// Stream `url` to `dest` while hashing; the file is removed again on mismatch.
/// Returns `(bytes, sha256)`.
pub fn download_verified(url: &str, dest: &Path, expected: &str) -> Result<(u64, String), Error> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| Error::Http(e.to_string()))?;
    let mut reader = resp.into_body().into_reader();
    let mut out = File::create(dest)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n])?;
        total += n as u64;
    }
    out.flush()?;
    let actual = hex(&h.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        drop(out);
        let _ = std::fs::remove_file(dest);
        return Err(Error::HashMismatch {
            expected: expected.to_string(),
            actual,
        });
    }
    Ok((total, actual))
}

/// Join an archive entry below `root`, refusing absolute paths, `..`, backslashes and drive letters.
pub fn safe_join(root: &Path, entry: &str) -> Result<PathBuf, Error> {
    if entry.contains('\\') || entry.contains(':') {
        return Err(Error::UnsafePath(entry.to_string()));
    }
    let mut out = root.to_path_buf();
    for c in Path::new(entry).components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            _ => return Err(Error::UnsafePath(entry.to_string())),
        }
    }
    Ok(out)
}

/// Extract a verified image zip into `dir`. Returns the file entries written.
pub fn extract(zip_path: &Path, dir: &Path) -> Result<Vec<String>, Error> {
    let mut ar =
        zip::ZipArchive::new(File::open(zip_path)?).map_err(|e| Error::Zip(e.to_string()))?;
    let mut written = Vec::new();
    for i in 0..ar.len() {
        let mut f = ar.by_index(i).map_err(|e| Error::Zip(e.to_string()))?;
        let name = f.name().to_string();
        let target = safe_join(dir, &name)?;
        if f.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        io::copy(&mut f, &mut File::create(&target)?)?;
        written.push(name);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"response":[
      {"datetime":1790539062,"filename":"lineage-20.0-20260927-VANILLA-waydroid_x86_64-system.zip",
       "id":"053552725bf4ae25e2d3f7e6f1947203294aa9d73dc17fe1f3abe646e5d3bd8a","romtype":"VANILLA","size":847449341,
       "url":"https://sourceforge.net/projects/waydroid/files/images/system/lineage/waydroid_x86_64/x.zip/download","version":"20.0"},
      {"datetime":1775215493,"filename":"old.zip","id":"aa","romtype":"VANILLA","size":1,"url":"https://e/x","version":"20.0"}]}"#;

    #[test]
    fn urls_match_upstream_layout() {
        assert_eq!(
            system_channel_url(DEFAULT_SYSTEM_CHANNEL, "lineage", "x86_64", "VANILLA"),
            "https://ota.waydro.id/system/lineage/waydroid_x86_64/VANILLA.json"
        );
        assert_eq!(
            vendor_channel_url("https://ota.waydro.id/vendor/", "x86_64", "MAINLINE"),
            "https://ota.waydro.id/vendor/waydroid_x86_64/MAINLINE.json"
        );
        assert!(vendor_channel_url("b", "arm64", "my phone").ends_with("/my_phone.json"));
    }

    #[test]
    fn parses_and_selects() {
        let b = parse_channel(SAMPLE).unwrap();
        assert_eq!(b.len(), 2);
        assert_eq!(first_newer(&b, 0).unwrap().datetime, 1790539062);
        assert!(first_newer(&b, 1790539062).is_none());
        assert_eq!(latest(&b).unwrap().size, 847449341);
        assert!(matches!(
            parse_channel(r#"{"response":[]}"#),
            Err(Error::EmptyChannel)
        ));
    }

    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            sha256_reader(&b"abc"[..]).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bun-waydroid-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn verify_detects_tampering() {
        let d = tmp("verify");
        let f = d.join("a.zip");
        std::fs::write(&f, b"abc").unwrap();
        let good = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        verify_file(&f, good).unwrap();
        verify_file(&f, &good.to_uppercase()).unwrap();
        assert!(matches!(
            verify_file(&f, "00"),
            Err(Error::HashMismatch { .. })
        ));
        let b = vec![Build {
            datetime: 1,
            filename: "a".into(),
            id: good.into(),
            romtype: String::new(),
            size: 3,
            url: String::new(),
            version: String::new(),
        }];
        assert!(validate_against_channel(&f, &b).unwrap());
    }

    #[test]
    fn zip_slip_is_refused_and_good_zip_extracts() {
        let root = Path::new("/r");
        assert!(safe_join(root, "../evil").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "a\\b").is_err());
        assert!(safe_join(root, "C:x").is_err());
        assert_eq!(
            safe_join(root, "system.img").unwrap(),
            root.join("system.img")
        );

        let d = tmp("zip");
        let z = d.join("i.zip");
        {
            let mut w = zip::ZipWriter::new(File::create(&z).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("system.img", o).unwrap();
            w.write_all(b"SYS").unwrap();
            w.start_file("sub/vendor.img", o).unwrap();
            w.write_all(b"VEN").unwrap();
            w.finish().unwrap();
        }
        let out = d.join("images");
        let names = extract(&z, &out).unwrap();
        assert_eq!(names.len(), 2);
        assert_eq!(std::fs::read(out.join("sub/vendor.img")).unwrap(), b"VEN");
    }
}
