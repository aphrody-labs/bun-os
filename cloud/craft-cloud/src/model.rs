//! Provider-neutral file model and the [`CloudFiles`] trait.

use aphrody_accounts::{Provider, Result};
use serde::{Deserialize, Serialize};

/// What an entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    /// Directory.
    Folder,
    /// Regular file with bytes (download works).
    File,
    /// Google-native document (Docs/Sheets/Slides...): no bytes, export only.
    NativeDoc(NativeKind),
    /// Shortcut or other link object.
    Link,
}

/// Google-native document types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NativeKind {
    /// Google Docs.
    Document,
    /// Google Sheets.
    Spreadsheet,
    /// Google Slides.
    Presentation,
    /// Drawings, Forms, Sites, Apps Script...
    Other,
}

/// One file or folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Provider item id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Kind.
    pub kind: EntryKind,
    /// MIME type when known.
    pub mime: Option<String>,
    /// Size in bytes (absent for native docs and folders).
    pub size: Option<u64>,
    /// Last modification, RFC 3339.
    pub modified: Option<String>,
    /// Opaque version token used for conflict detection: Drive `version`, Graph `eTag`.
    pub version: Option<String>,
    /// Parent ids.
    pub parents: Vec<String>,
    /// Browser URL.
    pub web_url: Option<String>,
}

/// One page of a listing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Page {
    /// Entries.
    pub entries: Vec<Entry>,
    /// Token for the next page.
    pub next: Option<String>,
}

/// A change in the feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// Created or modified.
    Upsert(Entry),
    /// Deleted or no longer visible.
    Removed(String),
}

/// One page of the change feed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChangePage {
    /// Changes on this page.
    pub changes: Vec<Change>,
    /// More pages: pass this to [`CloudFiles::changes`].
    pub next_page: Option<String>,
    /// Feed exhausted: persist this cursor and pass it next time.
    pub new_cursor: Option<String>,
}

/// File revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Revision {
    /// Revision id.
    pub id: String,
    /// Modification time, RFC 3339.
    pub modified: Option<String>,
    /// Author display name.
    pub author: Option<String>,
    /// Size in bytes.
    pub size: Option<u64>,
}

/// Comment on a file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    /// Comment id.
    pub id: String,
    /// Author display name.
    pub author: Option<String>,
    /// Text.
    pub text: String,
    /// Creation time.
    pub created: Option<String>,
    /// Resolved flag.
    pub resolved: bool,
}

/// Sharing role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShareRole {
    /// View.
    Reader,
    /// Comment (Google only).
    Commenter,
    /// Edit.
    Writer,
}

/// Who gets access.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShareTarget {
    /// Anyone with the link.
    Anyone,
    /// One person by email.
    User(String),
}

/// Result of sharing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareResult {
    /// Link to give to the recipient.
    pub url: Option<String>,
}

/// Result of an optimistic save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SaveOutcome {
    /// Written; this is the new remote state.
    Saved(Entry),
    /// The remote changed since `base_version`; nothing was written. Resolve with [`resolve_conflict`].
    Conflict {
        /// Current remote metadata.
        remote: Entry,
    },
}

/// Export targets for native documents (and PDF rendering on OneDrive).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    /// Word.
    Docx,
    /// Excel.
    Xlsx,
    /// PowerPoint.
    Pptx,
    /// PDF.
    Pdf,
    /// Plain text.
    Txt,
    /// HTML (zipped on Drive).
    Html,
    /// CSV (first sheet).
    Csv,
}

impl ExportFormat {
    /// MIME type.
    pub const fn mime(self) -> &'static str {
        match self {
            ExportFormat::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ExportFormat::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ExportFormat::Pptx => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ExportFormat::Pdf => "application/pdf",
            ExportFormat::Txt => "text/plain",
            ExportFormat::Html => "application/zip",
            ExportFormat::Csv => "text/csv",
        }
    }
}

/// The surface the shell volumes and the craft apps program against.
pub trait CloudFiles: Send + Sync {
    /// Which identity platform backs this.
    fn provider(&self) -> Provider;
    /// List a folder (`None` = root), one page at a time.
    fn list(&self, parent: Option<&str>, page: Option<&str>) -> Result<Page>;
    /// Metadata of one item.
    fn stat(&self, id: &str) -> Result<Entry>;
    /// Bytes of a regular file.
    fn download(&self, id: &str) -> Result<Vec<u8>>;
    /// Render a document (native doc on Drive; PDF conversion on OneDrive).
    fn export(&self, id: &str, format: ExportFormat) -> Result<Vec<u8>>;
    /// Create a file. With `convert`, Drive turns Office bytes into the native Google type.
    fn create(&self, parent: Option<&str>, name: &str, mime: &str, data: Vec<u8>, convert: bool) -> Result<Entry>;
    /// Replace content if the remote still has `base_version`.
    fn update(&self, id: &str, mime: &str, data: Vec<u8>, base_version: Option<&str>) -> Result<SaveOutcome>;
    /// Move to the trash (recoverable).
    fn trash(&self, id: &str) -> Result<()>;
    /// Cursor to start following changes from now.
    fn changes_cursor(&self) -> Result<String>;
    /// Read the change feed from a cursor or a `next_page` token.
    fn changes(&self, cursor: &str) -> Result<ChangePage>;
    /// Grant access.
    fn share(&self, id: &str, role: ShareRole, target: &ShareTarget) -> Result<ShareResult>;
    /// Version history.
    fn revisions(&self, id: &str) -> Result<Vec<Revision>>;
    /// Comments (Drive only; Graph has no equivalent for arbitrary files).
    fn comments(&self, id: &str) -> Result<Vec<Comment>>;
}

/// How to settle a [`SaveOutcome::Conflict`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    /// Overwrite the remote with the local bytes.
    KeepLocal,
    /// Drop the local edit (caller re-downloads).
    KeepRemote,
    /// Upload the local bytes next to the original as `name (conflict <tag>)`.
    KeepBoth,
}

/// Apply a [`Resolution`]. Returns the entry that now holds the local bytes (`None` for `KeepRemote`).
pub fn resolve_conflict(
    files: &dyn CloudFiles,
    remote: &Entry,
    mime: &str,
    local: Vec<u8>,
    how: Resolution,
    tag: &str,
) -> Result<Option<Entry>> {
    match how {
        Resolution::KeepRemote => Ok(None),
        Resolution::KeepLocal => match files.update(&remote.id, mime, local, None)? {
            SaveOutcome::Saved(e) => Ok(Some(e)),
            SaveOutcome::Conflict { remote } => Ok(Some(remote)),
        },
        Resolution::KeepBoth => {
            let parent = remote.parents.first().map(String::as_str);
            files.create(parent, &conflict_name(&remote.name, tag), mime, local, false).map(Some)
        }
    }
}

/// `report.docx` + `laptop` -> `report (conflict laptop).docx`.
pub fn conflict_name(name: &str, tag: &str) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} (conflict {tag}){}", &name[..i], &name[i..]),
        _ => format!("{name} (conflict {tag})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_names_keep_the_extension() {
        assert_eq!(conflict_name("report.docx", "laptop"), "report (conflict laptop).docx");
        assert_eq!(conflict_name("README", "x"), "README (conflict x)");
        assert_eq!(conflict_name(".env", "x"), ".env (conflict x)");
    }
}
