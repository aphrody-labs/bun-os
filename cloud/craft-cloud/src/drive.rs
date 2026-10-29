//! Google Drive API v3 client.
//!
//! Endpoints: <https://developers.google.com/drive/api/reference/rest/v3>. Notes verified against the docs:
//! * `files.export` renders at most 10 MB.
//! * Drive v3 has no `If-Match` on content updates, so [`CloudFiles::update`] compares the integer `version`
//!   field before writing (check-then-write; a concurrent writer inside that window wins silently).
//! * Content above 5 MB goes through the resumable protocol in 8 MiB chunks (multiples of 256 KiB).

use crate::api::{Api, boundary, enc, multipart_related};
use crate::model::*;
use aphrody_accounts::{Error, HttpRequest, Provider, Result};
use serde::Deserialize;
use serde_json::{Value, json};

const FILES: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS: &str = "id,name,mimeType,size,modifiedTime,version,parents,webViewLink";
/// Chunk for resumable uploads: 8 MiB, a multiple of 256 KiB as the protocol requires.
const CHUNK: usize = 8 * 1024 * 1024;
const RESUMABLE_ABOVE: usize = 5 * 1024 * 1024;

/// Scopes: full Drive access (use `drive.file` only for app-created files).
pub const SCOPE_DRIVE: &str = "https://www.googleapis.com/auth/drive";

/// Drive client.
pub struct GoogleDrive {
    api: Api,
}

#[derive(Deserialize)]
struct DriveFile {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default, rename = "modifiedTime")]
    modified_time: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    parents: Vec<String>,
    #[serde(default, rename = "webViewLink")]
    web_view_link: Option<String>,
}

impl DriveFile {
    fn into_entry(self) -> Entry {
        let mime = self.mime_type.clone().unwrap_or_default();
        let kind = match mime.as_str() {
            "application/vnd.google-apps.folder" => EntryKind::Folder,
            "application/vnd.google-apps.document" => EntryKind::NativeDoc(NativeKind::Document),
            "application/vnd.google-apps.spreadsheet" => EntryKind::NativeDoc(NativeKind::Spreadsheet),
            "application/vnd.google-apps.presentation" => EntryKind::NativeDoc(NativeKind::Presentation),
            "application/vnd.google-apps.shortcut" => EntryKind::Link,
            m if m.starts_with("application/vnd.google-apps.") => EntryKind::NativeDoc(NativeKind::Other),
            _ => EntryKind::File,
        };
        Entry {
            id: self.id,
            name: self.name,
            kind,
            mime: self.mime_type,
            size: self.size.and_then(|s| s.parse().ok()),
            modified: self.modified_time,
            version: self.version,
            parents: self.parents,
            web_url: self.web_view_link,
        }
    }
}

/// Native MIME type created when `convert` is requested for an Office upload.
pub fn native_mime_for(office_mime: &str) -> Option<&'static str> {
    match office_mime {
        m if m == ExportFormat::Docx.mime() => Some("application/vnd.google-apps.document"),
        m if m == ExportFormat::Xlsx.mime() => Some("application/vnd.google-apps.spreadsheet"),
        m if m == ExportFormat::Pptx.mime() => Some("application/vnd.google-apps.presentation"),
        _ => None,
    }
}

impl GoogleDrive {
    /// Wrap an authenticated client (scope check happens on every request).
    pub fn new(api: Api) -> Self {
        let mut api = api;
        if api.scopes.is_empty() {
            api.scopes = vec![SCOPE_DRIVE];
        }
        Self { api }
    }

    fn file_url(&self, id: &str) -> String {
        format!("{FILES}/{}", enc(id))
    }

    fn meta_query() -> String {
        format!("supportsAllDrives=true&fields={}", enc(FIELDS))
    }

    /// Resumable upload; `init` is the already-built session request (POST for create, PATCH for update).
    fn resumable(&self, init: HttpRequest, mime: &str, data: &[u8]) -> Result<Entry> {
        let resp = self.api.send(init.header("X-Upload-Content-Type", mime).header("X-Upload-Content-Length", data.len().to_string()))?;
        let session = resp.header("location").ok_or_else(|| Error::Invalid("resumable session without Location".into()))?.to_owned();
        let total = data.len();
        let mut sent = 0usize;
        loop {
            let end = (sent + CHUNK).min(total);
            let range = if total == 0 { "bytes */0".to_owned() } else { format!("bytes {sent}-{}/{total}", end - 1) };
            let req = HttpRequest::bytes("PUT", session.clone(), mime, data[sent..end].to_vec()).header("Content-Range", range);
            let r = self.api.send_any(req)?;
            match r.status {
                200 | 201 => return r.parse::<DriveFile>().map(DriveFile::into_entry),
                308 => {
                    // `Range: bytes=0-N` tells how much the server has; resume right after it.
                    sent = r
                        .header("range")
                        .and_then(|v| v.rsplit('-').next())
                        .and_then(|n| n.trim().parse::<usize>().ok())
                        .map_or(sent, |last| last + 1);
                    if sent >= total {
                        return Err(Error::Invalid("server acknowledged all bytes without completing".into()));
                    }
                }
                _ => return Err(r.error_for_status().err().unwrap_or_else(|| Error::Invalid("unexpected upload status".into()))),
            }
        }
    }
}

impl CloudFiles for GoogleDrive {
    fn provider(&self) -> Provider {
        Provider::Google
    }

    fn list(&self, parent: Option<&str>, page: Option<&str>) -> Result<Page> {
        let q = format!("'{}' in parents and trashed = false", parent.unwrap_or("root").replace('\'', "\\'"));
        let mut url = format!(
            "{FILES}?q={}&pageSize=1000&orderBy=folder,name&supportsAllDrives=true&includeItemsFromAllDrives=true&fields={}",
            enc(&q),
            enc(&format!("nextPageToken,files({FIELDS})"))
        );
        if let Some(p) = page {
            url.push_str(&format!("&pageToken={}", enc(p)));
        }
        #[derive(Deserialize)]
        struct L {
            #[serde(default)]
            files: Vec<DriveFile>,
            #[serde(default, rename = "nextPageToken")]
            next: Option<String>,
        }
        let l: L = self.api.get_json(&url)?;
        Ok(Page { entries: l.files.into_iter().map(DriveFile::into_entry).collect(), next: l.next })
    }

    fn stat(&self, id: &str) -> Result<Entry> {
        let f: DriveFile = self.api.get_json(&format!("{}?{}", self.file_url(id), Self::meta_query()))?;
        Ok(f.into_entry())
    }

    fn download(&self, id: &str) -> Result<Vec<u8>> {
        Ok(self.api.send(HttpRequest::get(format!("{}?alt=media&supportsAllDrives=true", self.file_url(id))))?.body)
    }

    fn export(&self, id: &str, format: ExportFormat) -> Result<Vec<u8>> {
        let url = format!("{}/export?mimeType={}", self.file_url(id), enc(format.mime()));
        Ok(self.api.send(HttpRequest::get(url))?.body)
    }

    fn create(&self, parent: Option<&str>, name: &str, mime: &str, data: Vec<u8>, convert: bool) -> Result<Entry> {
        let mut meta = json!({ "name": name });
        if let Some(p) = parent {
            meta["parents"] = json!([p]);
        }
        if convert {
            if let Some(native) = native_mime_for(mime) {
                meta["mimeType"] = json!(native);
            }
        }
        if data.len() > RESUMABLE_ABOVE {
            let url = format!("{UPLOAD}?uploadType=resumable&{}", Self::meta_query());
            return self.resumable(HttpRequest::json("POST", url, &meta), mime, &data);
        }
        let b = boundary();
        let body = multipart_related(&b, &meta, mime, &data);
        let url = format!("{UPLOAD}?uploadType=multipart&{}", Self::meta_query());
        let req = HttpRequest::bytes("POST", url, &format!("multipart/related; boundary={b}"), body);
        Ok(self.api.send(req)?.parse::<DriveFile>()?.into_entry())
    }

    fn update(&self, id: &str, mime: &str, data: Vec<u8>, base_version: Option<&str>) -> Result<SaveOutcome> {
        if let Some(base) = base_version {
            let remote = self.stat(id)?;
            if remote.version.as_deref() != Some(base) {
                return Ok(SaveOutcome::Conflict { remote });
            }
        }
        let url = format!("{UPLOAD}/{}?uploadType={}&{}", enc(id), if data.len() > RESUMABLE_ABOVE { "resumable" } else { "media" }, Self::meta_query());
        let entry = if data.len() > RESUMABLE_ABOVE {
            self.resumable(HttpRequest::json("PATCH", url, &json!({})), mime, &data)?
        } else {
            self.api.send(HttpRequest::bytes("PATCH", url, mime, data))?.parse::<DriveFile>()?.into_entry()
        };
        Ok(SaveOutcome::Saved(entry))
    }

    fn trash(&self, id: &str) -> Result<()> {
        let url = format!("{}?supportsAllDrives=true&fields=id", self.file_url(id));
        self.api.send(HttpRequest::json("PATCH", url, &json!({"trashed": true})))?;
        Ok(())
    }

    fn changes_cursor(&self) -> Result<String> {
        let v: Value = self.api.get_json("https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true")?;
        v["startPageToken"].as_str().map(str::to_owned).ok_or_else(|| Error::Invalid("no startPageToken".into()))
    }

    fn changes(&self, cursor: &str) -> Result<ChangePage> {
        #[derive(Deserialize)]
        struct C {
            #[serde(default, rename = "fileId")]
            file_id: String,
            #[serde(default)]
            removed: bool,
            #[serde(default)]
            file: Option<DriveFile>,
        }
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            changes: Vec<C>,
            #[serde(default, rename = "nextPageToken")]
            next: Option<String>,
            #[serde(default, rename = "newStartPageToken")]
            new_start: Option<String>,
        }
        let url = format!(
            "https://www.googleapis.com/drive/v3/changes?pageToken={}&includeRemoved=true&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000&fields={}",
            enc(cursor),
            enc(&format!("nextPageToken,newStartPageToken,changes(fileId,removed,file({FIELDS},trashed))"))
        );
        let r: R = self.api.get_json(&url)?;
        let changes = r
            .changes
            .into_iter()
            .map(|c| match (c.removed, c.file) {
                (false, Some(f)) => Change::Upsert(f.into_entry()),
                _ => Change::Removed(c.file_id),
            })
            .collect();
        Ok(ChangePage { changes, next_page: r.next, new_cursor: r.new_start })
    }

    fn share(&self, id: &str, role: ShareRole, target: &ShareTarget) -> Result<ShareResult> {
        let role = match role {
            ShareRole::Reader => "reader",
            ShareRole::Commenter => "commenter",
            ShareRole::Writer => "writer",
        };
        let body = match target {
            ShareTarget::Anyone => json!({"type":"anyone","role":role}),
            ShareTarget::User(email) => json!({"type":"user","role":role,"emailAddress":email}),
        };
        let url = format!("{}/permissions?supportsAllDrives=true&sendNotificationEmail=false&fields=id", self.file_url(id));
        self.api.send(HttpRequest::json("POST", url, &body))?;
        Ok(ShareResult { url: self.stat(id)?.web_url })
    }

    fn revisions(&self, id: &str) -> Result<Vec<Revision>> {
        #[derive(Deserialize)]
        struct U {
            #[serde(default, rename = "displayName")]
            display_name: Option<String>,
        }
        #[derive(Deserialize)]
        struct Rv {
            id: String,
            #[serde(default, rename = "modifiedTime")]
            modified: Option<String>,
            #[serde(default, rename = "lastModifyingUser")]
            user: Option<U>,
            #[serde(default)]
            size: Option<String>,
        }
        #[derive(Deserialize)]
        struct L {
            #[serde(default)]
            revisions: Vec<Rv>,
        }
        let url = format!("{}/revisions?fields={}", self.file_url(id), enc("revisions(id,modifiedTime,lastModifyingUser(displayName),size)"));
        let l: L = self.api.get_json(&url)?;
        Ok(l.revisions
            .into_iter()
            .map(|r| Revision { id: r.id, modified: r.modified, author: r.user.and_then(|u| u.display_name), size: r.size.and_then(|s| s.parse().ok()) })
            .collect())
    }

    fn comments(&self, id: &str) -> Result<Vec<Comment>> {
        #[derive(Deserialize)]
        struct A {
            #[serde(default, rename = "displayName")]
            display_name: Option<String>,
        }
        #[derive(Deserialize)]
        struct Cm {
            id: String,
            #[serde(default)]
            content: String,
            #[serde(default)]
            author: Option<A>,
            #[serde(default, rename = "createdTime")]
            created: Option<String>,
            #[serde(default)]
            resolved: bool,
        }
        #[derive(Deserialize)]
        struct L {
            #[serde(default)]
            comments: Vec<Cm>,
        }
        let url = format!(
            "{}/comments?includeDeleted=false&pageSize=100&fields={}",
            self.file_url(id),
            enc("comments(id,content,author(displayName),createdTime,resolved)")
        );
        let l: L = self.api.get_json(&url)?;
        Ok(l.comments
            .into_iter()
            .map(|c| Comment { id: c.id, author: c.author.and_then(|a| a.display_name), text: c.content, created: c.created, resolved: c.resolved })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::testutil::api;
    use aphrody_accounts::HttpResponse;
    use aphrody_accounts::testing::ScriptedTransport;
    use std::sync::Arc;

    fn drive(t: &Arc<ScriptedTransport>) -> GoogleDrive {
        GoogleDrive::new(api(t.clone()))
    }

    #[test]
    fn lists_with_kinds_pages_and_parent_query() {
        let t = Arc::new(ScriptedTransport::new().on(
            "/drive/v3/files?",
            HttpResponse::json(
                200,
                &json!({"nextPageToken":"P2","files":[
                    {"id":"f1","name":"Docs","mimeType":"application/vnd.google-apps.folder"},
                    {"id":"d1","name":"Plan","mimeType":"application/vnd.google-apps.document","version":"7","modifiedTime":"2026-10-29T10:00:00Z"},
                    {"id":"b1","name":"a.bin","mimeType":"application/octet-stream","size":"123","version":"3","parents":["f1"]}
                ]}),
            ),
        ));
        let p = drive(&t).list(Some("f1"), Some("P1")).unwrap();
        assert_eq!(p.next.as_deref(), Some("P2"));
        assert_eq!(p.entries[0].kind, EntryKind::Folder);
        assert_eq!(p.entries[1].kind, EntryKind::NativeDoc(NativeKind::Document));
        assert_eq!((p.entries[2].kind, p.entries[2].size), (EntryKind::File, Some(123)));
        let url = &t.requests()[0].url;
        assert!(url.contains("pageToken=P1") && url.contains("%27f1%27%20in%20parents"), "{url}");
    }

    #[test]
    fn export_asks_for_the_mime_type() {
        let t = Arc::new(ScriptedTransport::new().on("/export", HttpResponse { status: 200, body: b"PK".to_vec(), ..Default::default() }));
        assert_eq!(drive(&t).export("d1", ExportFormat::Docx).unwrap(), b"PK");
        assert!(t.requests()[0].url.contains("mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document"));
    }

    #[test]
    fn create_with_convert_sets_the_native_type_in_a_multipart_body() {
        let t = Arc::new(ScriptedTransport::new().on("uploadType=multipart", HttpResponse::json(200, &json!({"id":"n1","name":"x.docx","mimeType":"application/vnd.google-apps.document"}))));
        let e = drive(&t).create(Some("root"), "x.docx", ExportFormat::Docx.mime(), b"PKzip".to_vec(), true).unwrap();
        assert_eq!(e.kind, EntryKind::NativeDoc(NativeKind::Document));
        let r = &t.requests()[0];
        let body = r.body_text();
        assert!(body.contains("\"mimeType\":\"application/vnd.google-apps.document\"") && body.contains("\"parents\":[\"root\"]") && body.contains("PKzip"));
        assert!(r.header_value("content-type").is_none(), "content type travels in the Body, set by the transport");
    }

    #[test]
    fn update_detects_a_conflict_without_writing() {
        let t = Arc::new(ScriptedTransport::new().on("/drive/v3/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"9"}))));
        match drive(&t).update("f", "text/plain", b"x".to_vec(), Some("8")).unwrap() {
            SaveOutcome::Conflict { remote } => assert_eq!(remote.version.as_deref(), Some("9")),
            other => panic!("{other:?}"),
        }
        assert_eq!(t.requests().len(), 1, "no upload after a detected conflict");
    }

    #[test]
    fn update_writes_when_the_version_matches() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/drive/v3/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"8"})))
                .on("uploadType=media", HttpResponse::json(200, &json!({"id":"f","name":"n","version":"9"}))),
        );
        match drive(&t).update("f", "text/plain", b"x".to_vec(), Some("8")).unwrap() {
            SaveOutcome::Saved(e) => assert_eq!(e.version.as_deref(), Some("9")),
            other => panic!("{other:?}"),
        }
        assert_eq!(t.requests()[1].method, "PATCH");
    }

    #[test]
    fn large_uploads_use_resumable_chunks_and_resume_on_308() {
        let data = vec![7u8; CHUNK + 10];
        let t = Arc::new(
            ScriptedTransport::new()
                .on("uploadType=resumable", HttpResponse { status: 200, headers: vec![("Location".into(), "https://up.example/session1".into())], body: vec![] })
                .on("session1", HttpResponse { status: 308, headers: vec![("Range".into(), format!("bytes=0-{}", CHUNK - 1))], body: vec![] })
                .on("session1", HttpResponse::json(200, &json!({"id":"big","name":"big.bin","size":(CHUNK + 10).to_string()}))),
        );
        let e = drive(&t).create(None, "big.bin", "application/octet-stream", data, false).unwrap();
        assert_eq!(e.size, Some(CHUNK as u64 + 10));
        let reqs = t.requests();
        assert_eq!(reqs[1].header_value("content-range"), Some(format!("bytes 0-{}/{}", CHUNK - 1, CHUNK + 10).as_str()));
        assert_eq!(reqs[2].header_value("content-range"), Some(format!("bytes {}-{}/{}", CHUNK, CHUNK + 9, CHUNK + 10).as_str()));
        assert_eq!(reqs[0].header_value("x-upload-content-length"), Some((CHUNK + 10).to_string().as_str()));
    }

    #[test]
    fn change_feed_maps_removed_and_upserts() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("startPageToken", HttpResponse::json(200, &json!({"startPageToken":"100"})))
                .on(
                    "/changes?",
                    HttpResponse::json(
                        200,
                        &json!({"newStartPageToken":"105","changes":[
                            {"fileId":"a","removed":true},
                            {"fileId":"b","removed":false,"file":{"id":"b","name":"B","mimeType":"text/plain","version":"2"}},
                            {"fileId":"c","removed":false}
                        ]}),
                    ),
                ),
        );
        let d = drive(&t);
        assert_eq!(d.changes_cursor().unwrap(), "100");
        let page = d.changes("100").unwrap();
        assert_eq!(page.new_cursor.as_deref(), Some("105"));
        assert_eq!(page.changes.len(), 3);
        assert_eq!(page.changes[0], Change::Removed("a".into()));
        assert!(matches!(&page.changes[1], Change::Upsert(e) if e.name == "B"));
        assert_eq!(page.changes[2], Change::Removed("c".into()));
    }

    #[test]
    fn share_creates_a_permission_then_returns_the_link() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/permissions", HttpResponse::json(200, &json!({"id":"p"})))
                .on("/drive/v3/files/f?", HttpResponse::json(200, &json!({"id":"f","name":"n","webViewLink":"https://docs.google.com/x"}))),
        );
        let r = drive(&t).share("f", ShareRole::Commenter, &ShareTarget::User("a@b.c".into())).unwrap();
        assert_eq!(r.url.as_deref(), Some("https://docs.google.com/x"));
        let b = t.requests()[0].body_text();
        assert!(b.contains("\"role\":\"commenter\"") && b.contains("a@b.c"));
        assert!(t.requests()[0].url.contains("sendNotificationEmail=false"));
    }

    #[test]
    fn revisions_and_comments_parse() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/revisions", HttpResponse::json(200, &json!({"revisions":[{"id":"1","modifiedTime":"t","lastModifyingUser":{"displayName":"Me"},"size":"10"}]})))
                .on("/comments", HttpResponse::json(200, &json!({"comments":[{"id":"c","content":"hi","author":{"displayName":"You"},"resolved":true}]}))),
        );
        let d = drive(&t);
        let r = d.revisions("f").unwrap();
        assert_eq!((r[0].author.as_deref(), r[0].size), (Some("Me"), Some(10)));
        let c = d.comments("f").unwrap();
        assert!(c[0].resolved && c[0].text == "hi");
    }
}
