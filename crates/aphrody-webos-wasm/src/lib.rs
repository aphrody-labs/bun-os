// SPDX-License-Identifier: Apache-2.0
//! Typed WebOS API for the browser: files, binary triage and patches.
//!
//! [`WebOsFs`] wraps the APFS1 image VFS of `aphrody-shell-web` so the WebOS
//! worker keeps its two OPFS slots; the apps call methods instead of a shell.
//! Paths are absolute UTF-8 strings; JSON results are documented per method.

use std::{
    cell::RefCell,
    io,
    path::{Path, PathBuf},
};

use aphrody_patch::{PatchFileSystem, apply_patch, parse_patch};
use aphrody_shell_vfs::{FileKind, Vfs, VfsError, path as vpath};
use aphrody_shell_web::opfs::SharedOpfsVfs;

/// The Rio VT terminal state, exported so the WebOS Terminal app can feed it the bytes of a real shell (the Alpine guest).
pub use aphrody_shell_web::WebTerminal;
use serde_json::json;
use wasm_bindgen::prelude::*;

mod rag;
mod rpc;

const TRIAGE_STRINGS_LIMIT: usize = 256;

fn err(e: VfsError) -> String {
    e.to_string()
}

fn kind_name(kind: FileKind) -> &'static str {
    match kind {
        FileKind::File => "file",
        FileKind::Dir => "dir",
    }
}

/// OPFS-persisted filesystem shared by every WebOS app.
#[wasm_bindgen]
pub struct WebOsFs {
    fs: SharedOpfsVfs,
}

#[wasm_bindgen]
impl WebOsFs {
    /// Restore from an APFS1 image; an empty image starts a new filesystem.
    ///
    /// # Errors
    /// Throws on a truncated, corrupt or oversized image.
    #[wasm_bindgen(constructor)]
    pub fn new(image: &[u8]) -> Result<WebOsFs, String> {
        Ok(Self {
            fs: SharedOpfsVfs::from_image(image).map_err(err)?,
        })
    }

    /// `[{"name","kind":"file"|"dir","size"}]` sorted by name.
    ///
    /// # Errors
    /// Throws when the path is missing or not a directory.
    pub fn list(&mut self, path: &str) -> Result<String, String> {
        let dir = path.as_bytes();
        let mut out = Vec::new();
        for entry in self.fs.read_dir(dir).map_err(err)? {
            let child = vpath::join(&vpath::normalize(dir).map_err(err)?, &entry.name);
            let size = self.fs.stat(&child).map(|s| s.size).unwrap_or(0);
            out.push(json!({
                "name": String::from_utf8_lossy(&entry.name),
                "kind": kind_name(entry.kind),
                "size": size,
            }));
        }
        Ok(serde_json::Value::Array(out).to_string())
    }

    /// `{"kind","size"}`.
    ///
    /// # Errors
    /// Throws when the path does not resolve.
    pub fn stat(&mut self, path: &str) -> Result<String, String> {
        let st = self.fs.stat(path.as_bytes()).map_err(err)?;
        Ok(json!({ "kind": kind_name(st.kind), "size": st.size }).to_string())
    }

    /// Whole file contents.
    ///
    /// # Errors
    /// Throws when the file is missing or a directory.
    pub fn read(&mut self, path: &str) -> Result<Vec<u8>, String> {
        self.fs.read(path.as_bytes()).map_err(err)
    }

    /// Create or truncate a file, creating missing parent directories.
    ///
    /// # Errors
    /// Throws on an invalid path or when a quota is exceeded.
    pub fn write(&mut self, path: &str, data: &[u8]) -> Result<(), String> {
        write_with_parents(&mut self.fs, path.as_bytes(), data)
    }

    /// `mkdir -p`.
    ///
    /// # Errors
    /// Throws when a component is a file.
    pub fn mkdir(&mut self, path: &str) -> Result<(), String> {
        self.fs.mkdir_all(path.as_bytes()).map_err(err)
    }

    /// `rm -r`.
    ///
    /// # Errors
    /// Throws when the path does not resolve.
    pub fn remove(&mut self, path: &str) -> Result<(), String> {
        self.fs.remove_all(path.as_bytes()).map_err(err)
    }

    /// Move a node.
    ///
    /// # Errors
    /// Same rules as [`Vfs::rename`].
    pub fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        self.fs.rename(from.as_bytes(), to.as_bytes()).map_err(err)
    }

    /// New APFS1 image when something changed, empty otherwise.
    ///
    /// # Errors
    /// Throws when the image would exceed the OPFS slot size.
    #[wasm_bindgen(js_name = imageIfDirty)]
    pub fn image_if_dirty(&self) -> Result<Vec<u8>, String> {
        Ok(self.fs.image_if_dirty().map_err(err)?.unwrap_or_default())
    }

    /// Acknowledge that the last image reached OPFS.
    #[wasm_bindgen(js_name = markPersisted)]
    pub fn mark_persisted(&self) {
        self.fs.mark_persisted();
    }

    /// Answer one explorer wire request (`{"Query"|"Action": ...}`) from this filesystem;
    /// `now` is an RFC 3339 timestamp, as the VFS stores none. Always returns the wire
    /// envelope: `{"json": ...}`, `{"error": "..."}` or `"Pong"`.
    pub fn rpc(&mut self, request: &str, now: &str) -> String {
        let reply = serde_json::from_str::<serde_json::Value>(request)
            .map_err(|e| format!("invalid request: {e}"))
            .and_then(|req| rpc::handle(&mut self.fs, &req, now));
        rpc::envelope(reply)
    }

    /// BM25 search over the text files of the home directory, chunked by `aphrody-rag-core`:
    /// `{"results":[{path,start_line,end_line,score,content}]}`.
    #[wasm_bindgen(js_name = ragSearch)]
    pub fn rag_search(&mut self, query: &str, limit: usize) -> String {
        rag::search(&mut self.fs, rpc::HOME, query, limit).to_string()
    }

    /// `{"documents","chunks"}` of the searchable home directory.
    #[wasm_bindgen(js_name = ragStats)]
    pub fn rag_stats(&mut self) -> String {
        rag::stats(&mut self.fs, rpc::HOME).to_string()
    }

    /// `aphrody re triage` report (format, sections, hashes, strings) as JSON.
    ///
    /// # Errors
    /// Throws when the file is unreadable or its headers are inconsistent.
    pub fn triage(&mut self, path: &str) -> Result<String, String> {
        let bytes = self.fs.read(path.as_bytes()).map_err(err)?;
        triage_json(&bytes)
    }

    /// Printable strings of a file as a JSON array.
    ///
    /// # Errors
    /// Throws when the file is unreadable.
    pub fn strings(&mut self, path: &str, min_len: usize, limit: usize) -> Result<String, String> {
        let bytes = self.fs.read(path.as_bytes()).map_err(err)?;
        serde_json::to_string(&aphrody_re::extract_strings(&bytes, min_len, limit))
            .map_err(|e| e.to_string())
    }

    /// Apply a Codex-style `*** Begin Patch` document; relative paths resolve
    /// against `cwd`. Returns `{"added","modified","deleted"}`.
    ///
    /// # Errors
    /// Throws on a malformed patch or a hunk that does not match.
    #[wasm_bindgen(js_name = applyPatch)]
    pub fn apply_patch(&mut self, patch: &str, cwd: &str) -> Result<String, String> {
        apply_patch_json(&self.fs, patch, cwd.as_bytes())
    }
}

/// Apply a Codex-style patch on `fs`; relative paths resolve against `cwd`.
pub(crate) fn apply_patch_json(
    fs: &SharedOpfsVfs,
    patch: &str,
    cwd: &[u8],
) -> Result<String, String> {
    let args = parse_patch(patch).map_err(|e| e.to_string())?;
    let adapter = PatchFs {
        fs: RefCell::new(fs.clone()),
        cwd,
    };
    let summary = apply_patch(&args, &adapter).map_err(|e| e.to_string())?;
    let names = |v: &[PathBuf]| -> Vec<String> {
        v.iter().map(|p| p.to_string_lossy().into_owned()).collect()
    };
    Ok(json!({
        "added": names(&summary.added),
        "modified": names(&summary.modified),
        "deleted": names(&summary.deleted),
    })
    .to_string())
}

/// Triage report of `bytes` as JSON.
pub(crate) fn triage_json(bytes: &[u8]) -> Result<String, String> {
    let report =
        aphrody_re::triage_bounded(bytes, TRIAGE_STRINGS_LIMIT).map_err(|e| e.to_string())?;
    serde_json::to_string(&report).map_err(|e| e.to_string())
}

/// Unified diff of two texts, for the Files app's compare view.
#[wasm_bindgen(js_name = unifiedDiff)]
#[must_use]
pub fn unified_diff(old: &str, new: &str) -> String {
    aphrody_patch::unified_diff(old, new)
}

/// Local language detection of `aphrody-google` (scripts and stop words, no network):
/// `{"language","confidence","isReliable"}`.
#[wasm_bindgen(js_name = detectLanguage)]
pub fn detect_language(text: &str) -> Result<String, String> {
    detect_language_json(text)
}

pub(crate) fn detect_language_json(text: &str) -> Result<String, String> {
    serde_json::to_string(&aphrody_google::language_detect::detect_single_local(text))
        .map_err(|e| e.to_string())
}

/// Crate version, shown in the WebOS About panel.
#[wasm_bindgen]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn write_with_parents(fs: &mut impl Vfs, path: &[u8], data: &[u8]) -> Result<(), String> {
    let norm = vpath::normalize(path).map_err(err)?;
    if let Some(slash) = norm.iter().rposition(|&b| b == b'/')
        && slash > 0
    {
        fs.mkdir_all(&norm[..slash]).map_err(err)?;
    }
    fs.write(&norm, data).map_err(err)
}

struct PatchFs<'a> {
    fs: RefCell<SharedOpfsVfs>,
    cwd: &'a [u8],
}

impl PatchFs<'_> {
    fn resolve(&self, path: &Path) -> io::Result<Vec<u8>> {
        vpath::resolve(self.cwd, path.to_string_lossy().as_bytes()).map_err(to_io)
    }
}

fn to_io(e: VfsError) -> io::Error {
    let kind = match e {
        VfsError::NotFound => io::ErrorKind::NotFound,
        VfsError::AlreadyExists => io::ErrorKind::AlreadyExists,
        VfsError::InvalidPath | VfsError::InvalidInput => io::ErrorKind::InvalidInput,
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, e.to_string())
}

impl PatchFileSystem for PatchFs<'_> {
    fn read(&self, path: &Path) -> io::Result<String> {
        let bytes = self
            .fs
            .borrow_mut()
            .read(&self.resolve(path)?)
            .map_err(to_io)?;
        String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    fn write(&self, path: &Path, contents: &str) -> io::Result<()> {
        let target = self.resolve(path)?;
        write_with_parents(&mut *self.fs.borrow_mut(), &target, contents.as_bytes())
            .map_err(io::Error::other)
    }

    fn remove(&self, path: &Path) -> io::Result<()> {
        self.fs
            .borrow_mut()
            .remove(&self.resolve(path)?)
            .map_err(to_io)
    }

    fn exists(&self, path: &Path) -> bool {
        self.resolve(path)
            .is_ok_and(|p| self.fs.borrow_mut().exists(&p))
    }
}

#[cfg(test)]
mod tests {
    use super::WebOsFs;

    #[test]
    fn files_round_trip_through_an_image() {
        let mut fs = WebOsFs::new(&[]).expect("empty image");
        fs.write("/home/user/a.txt", b"hello\n").expect("write");
        assert_eq!(fs.read("/home/user/a.txt").expect("read"), b"hello\n");
        assert!(fs.list("/home/user").expect("list").contains("\"a.txt\""));
        let image = fs.image_if_dirty().expect("image");
        assert!(!image.is_empty());
        fs.mark_persisted();
        assert!(fs.image_if_dirty().expect("clean").is_empty());
        let mut restored = WebOsFs::new(&image).expect("restore");
        assert_eq!(restored.read("/home/user/a.txt").expect("read"), b"hello\n");
    }

    #[test]
    fn patch_applies_relative_to_cwd() {
        let mut fs = WebOsFs::new(&[]).expect("empty image");
        fs.write("/src/a.txt", b"one\ntwo\n").expect("write");
        let patch =
            "*** Begin Patch\n*** Update File: a.txt\n@@\n one\n-two\n+three\n*** End Patch";
        let summary = fs.apply_patch(patch, "/src").expect("apply");
        assert!(summary.contains("a.txt"));
        assert_eq!(fs.read("/src/a.txt").expect("read"), b"one\nthree\n");
    }

    #[test]
    fn strings_finds_text() {
        let mut fs = WebOsFs::new(&[]).expect("empty image");
        fs.write("/bin/blob", b"\0\0\0hello-world\0\x01")
            .expect("write");
        assert!(
            fs.strings("/bin/blob", 4, 10)
                .expect("strings")
                .contains("hello-world")
        );
    }
}

#[cfg(test)]
mod api_tests {
    use super::WebOsFs;

    #[test]
    fn search_patch_and_triage_work_on_the_shared_filesystem() {
        let mut fs = WebOsFs::new(&[]).expect("empty image");
        fs.write("/home/user/notes.md", b"# Notes\n\nthe walrus sings\n")
            .expect("write");
        let hits = fs.rag_search("walrus", 5);
        assert!(hits.contains("/home/user/notes.md"), "{hits}");
        let patch = "*** Begin Patch\n*** Add File: made.txt\n+patched\n*** End Patch";
        fs.apply_patch(patch, "/home/user").expect("patch");
        assert_eq!(fs.read("/home/user/made.txt").expect("read"), b"patched\n");
        assert!(fs.triage("/home/user/notes.md").is_ok());
    }

    #[test]
    fn detects_languages() {
        let json = super::detect_language("こんにちは").expect("json");
        assert!(
            json.contains(r#""language":"ja""#) && json.contains(r#""isReliable":true"#),
            "{json}"
        );
    }
}
