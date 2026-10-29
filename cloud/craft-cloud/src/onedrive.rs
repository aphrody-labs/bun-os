//! OneDrive / SharePoint document libraries through Microsoft Graph v1.0.
//!
//! Endpoints: <https://learn.microsoft.com/graph/api/resources/onedrive>. Verified behaviors:
//! * Small files (< 4 MiB) use `PUT .../content`; larger ones use `createUploadSession` and fragments that are
//!   multiples of 320 KiB, sent WITHOUT an `Authorization` header (the `uploadUrl` is pre-authenticated).
//! * Conflict detection uses `If-Match: <eTag>`; a stale tag answers `412 Precondition Failed`.
//! * Delta: `GET .../delta?token=latest` returns a `@odata.deltaLink` without enumerating the drive.
//! * Graph v1.0 has no comments API for arbitrary files, so [`CloudFiles::comments`] is unsupported here.

use crate::api::{Api, enc};
use crate::model::*;
use aphrody_accounts::{Error, HttpRequest, Provider, Result};
use serde::Deserialize;
use serde_json::{Value, json};

const GRAPH: &str = "https://graph.microsoft.com/v1.0";
const SELECT: &str = "id,name,size,file,folder,lastModifiedDateTime,eTag,parentReference,webUrl,deleted,remoteItem";
/// 32 x 320 KiB = 10 MiB fragments.
const FRAGMENT: usize = 32 * 320 * 1024;
const SIMPLE_MAX: usize = 4 * 1024 * 1024;

/// Delegated permission for read/write on the user's files.
pub const SCOPE_FILES: &str = "Files.ReadWrite";

/// Which drive to address.
#[derive(Debug, Clone)]
pub enum DriveRef {
    /// `/me/drive`.
    Me,
    /// A specific drive (SharePoint library, shared drive): `/drives/{id}`.
    Id(String),
}

impl DriveRef {
    fn base(&self) -> String {
        match self {
            DriveRef::Me => format!("{GRAPH}/me/drive"),
            DriveRef::Id(id) => format!("{GRAPH}/drives/{}", enc(id)),
        }
    }
}

/// OneDrive client.
pub struct OneDrive {
    api: Api,
    drive: DriveRef,
}

#[derive(Deserialize)]
struct Item {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    file: Option<FileFacet>,
    #[serde(default)]
    folder: Option<Value>,
    #[serde(default, rename = "lastModifiedDateTime")]
    modified: Option<String>,
    #[serde(default, rename = "eTag")]
    etag: Option<String>,
    #[serde(default, rename = "parentReference")]
    parent: Option<ParentRef>,
    #[serde(default, rename = "webUrl")]
    web_url: Option<String>,
    #[serde(default)]
    deleted: Option<Value>,
    #[serde(default, rename = "remoteItem")]
    remote: Option<Value>,
}

#[derive(Deserialize)]
struct FileFacet {
    #[serde(default, rename = "mimeType")]
    mime: Option<String>,
}
#[derive(Deserialize)]
struct ParentRef {
    #[serde(default)]
    id: Option<String>,
}

impl Item {
    fn into_entry(self) -> Entry {
        let kind = if self.folder.is_some() {
            EntryKind::Folder
        } else if self.remote.is_some() {
            EntryKind::Link
        } else {
            EntryKind::File
        };
        Entry {
            id: self.id,
            name: self.name,
            kind,
            mime: self.file.and_then(|f| f.mime),
            size: self.size,
            modified: self.modified,
            version: self.etag,
            parents: self.parent.and_then(|p| p.id).into_iter().collect(),
            web_url: self.web_url,
        }
    }
}

impl OneDrive {
    /// Wrap an authenticated client on `/me/drive`.
    pub fn new(api: Api) -> Self {
        Self::with_drive(api, DriveRef::Me)
    }
    /// Wrap an authenticated client on a specific drive.
    pub fn with_drive(mut api: Api, drive: DriveRef) -> Self {
        if api.scopes.is_empty() {
            api.scopes = vec![SCOPE_FILES];
        }
        Self { api, drive }
    }

    fn item_url(&self, id: &str) -> String {
        format!("{}/items/{}", self.drive.base(), enc(id))
    }
    fn children_url(&self, parent: Option<&str>) -> String {
        match parent {
            Some(p) => format!("{}/children", self.item_url(p)),
            None => format!("{}/root/children", self.drive.base()),
        }
    }
    /// `/root:/name:` or `/items/{parent}:/name:`
    fn path_url(&self, parent: Option<&str>, name: &str) -> String {
        match parent {
            Some(p) => format!("{}:/{}:", self.item_url(p), enc(name)),
            None => format!("{}/root:/{}:", self.drive.base(), enc(name)),
        }
    }

    fn upload_session(&self, url: String, if_match: Option<&str>, data: &[u8]) -> Result<Entry> {
        let mut init = HttpRequest::json("POST", url, &json!({"item": {"@microsoft.graph.conflictBehavior": "fail"}}));
        if let Some(t) = if_match {
            init = init.header("If-Match", t);
        }
        let session: Value = self.api.send(init)?.parse()?;
        let upload_url = session["uploadUrl"].as_str().ok_or_else(|| Error::Invalid("no uploadUrl".into()))?.to_owned();
        let total = data.len();
        let mut sent = 0usize;
        while sent < total {
            let end = (sent + FRAGMENT).min(total);
            let req = HttpRequest::bytes("PUT", upload_url.clone(), "application/octet-stream", data[sent..end].to_vec())
                .header("Content-Range", format!("bytes {sent}-{}/{total}", end - 1));
            let r = self.api.send_anonymous(req)?;
            match r.status {
                200 | 201 => return Ok(r.parse::<Item>()?.into_entry()),
                202 => sent = end,
                412 => return Err(Error::Conflict),
                _ => return Err(r.error_for_status().err().unwrap_or_else(|| Error::Invalid("unexpected upload status".into()))),
            }
        }
        Err(Error::Invalid("upload session ended without a final item".into()))
    }
}

impl CloudFiles for OneDrive {
    fn provider(&self) -> Provider {
        Provider::Microsoft
    }

    fn list(&self, parent: Option<&str>, page: Option<&str>) -> Result<Page> {
        #[derive(Deserialize)]
        struct L {
            #[serde(default)]
            value: Vec<Item>,
            #[serde(default, rename = "@odata.nextLink")]
            next: Option<String>,
        }
        let url = page.map_or_else(|| format!("{}?$top=200&$select={SELECT}", self.children_url(parent)), str::to_owned);
        let l: L = self.api.get_json(&url)?;
        Ok(Page { entries: l.value.into_iter().map(Item::into_entry).collect(), next: l.next })
    }

    fn stat(&self, id: &str) -> Result<Entry> {
        let i: Item = self.api.get_json(&format!("{}?$select={SELECT}", self.item_url(id)))?;
        Ok(i.into_entry())
    }

    fn download(&self, id: &str) -> Result<Vec<u8>> {
        // Graph answers 302 to a pre-authenticated URL; the transport drops Authorization across origins.
        Ok(self.api.send(HttpRequest::get(format!("{}/content", self.item_url(id))))?.body)
    }

    fn export(&self, id: &str, format: ExportFormat) -> Result<Vec<u8>> {
        match format {
            ExportFormat::Pdf => Ok(self.api.send(HttpRequest::get(format!("{}/content?format=pdf", self.item_url(id))))?.body),
            _ => Err(Error::Unsupported("OneDrive converts to PDF only; Office files are already native (use download)")),
        }
    }

    fn create(&self, parent: Option<&str>, name: &str, mime: &str, data: Vec<u8>, _convert: bool) -> Result<Entry> {
        if data.len() <= SIMPLE_MAX {
            let url = format!("{}/content?@microsoft.graph.conflictBehavior=fail&$select={SELECT}", self.path_url(parent, name));
            let r = self.api.send(HttpRequest::bytes("PUT", url, mime, data))?;
            return Ok(r.parse::<Item>()?.into_entry());
        }
        self.upload_session(format!("{}/createUploadSession", self.path_url(parent, name)), None, &data)
    }

    fn update(&self, id: &str, mime: &str, data: Vec<u8>, base_version: Option<&str>) -> Result<SaveOutcome> {
        let outcome = if data.len() <= SIMPLE_MAX {
            let mut req = HttpRequest::bytes("PUT", format!("{}/content?$select={SELECT}", self.item_url(id)), mime, data);
            if let Some(t) = base_version {
                req = req.header("If-Match", t);
            }
            let r = self.api.send_any(req)?;
            if r.status == 412 {
                Err(Error::Conflict)
            } else {
                r.error_for_status()?.parse::<Item>().map(Item::into_entry)
            }
        } else {
            self.upload_session(format!("{}/createUploadSession", self.item_url(id)), base_version, &data)
        };
        match outcome {
            Ok(e) => Ok(SaveOutcome::Saved(e)),
            Err(Error::Conflict) => Ok(SaveOutcome::Conflict { remote: self.stat(id)? }),
            Err(e) => Err(e),
        }
    }

    fn trash(&self, id: &str) -> Result<()> {
        self.api.send(HttpRequest::new("DELETE", self.item_url(id)))?;
        Ok(())
    }

    fn changes_cursor(&self) -> Result<String> {
        #[derive(Deserialize)]
        struct D {
            #[serde(rename = "@odata.deltaLink")]
            delta: String,
        }
        let d: D = self.api.get_json(&format!("{}/root/delta?token=latest", self.drive.base()))?;
        Ok(d.delta)
    }

    fn changes(&self, cursor: &str) -> Result<ChangePage> {
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            value: Vec<Item>,
            #[serde(default, rename = "@odata.nextLink")]
            next: Option<String>,
            #[serde(default, rename = "@odata.deltaLink")]
            delta: Option<String>,
        }
        let r: R = self.api.get_json(cursor)?;
        let changes = r
            .value
            .into_iter()
            .map(|i| if i.deleted.is_some() { Change::Removed(i.id) } else { Change::Upsert(i.into_entry()) })
            .collect();
        Ok(ChangePage { changes, next_page: r.next, new_cursor: r.delta })
    }

    fn share(&self, id: &str, role: ShareRole, target: &ShareTarget) -> Result<ShareResult> {
        let write = matches!(role, ShareRole::Writer);
        match target {
            ShareTarget::Anyone => {
                let v: Value = self.api.json("POST", &format!("{}/createLink", self.item_url(id)), &json!({"type": if write { "edit" } else { "view" }, "scope": "anonymous"}))?;
                Ok(ShareResult { url: v["link"]["webUrl"].as_str().map(str::to_owned) })
            }
            ShareTarget::User(email) => {
                let body = json!({"recipients":[{"email": email}],"roles":[if write { "write" } else { "read" }],"requireSignIn":true,"sendInvitation":false});
                self.api.send(HttpRequest::json("POST", format!("{}/invite", self.item_url(id)), &body))?;
                Ok(ShareResult { url: self.stat(id)?.web_url })
            }
        }
    }

    fn revisions(&self, id: &str) -> Result<Vec<Revision>> {
        #[derive(Deserialize)]
        struct V {
            id: String,
            #[serde(default, rename = "lastModifiedDateTime")]
            modified: Option<String>,
            #[serde(default)]
            size: Option<u64>,
            #[serde(default, rename = "lastModifiedBy")]
            by: Option<Value>,
        }
        #[derive(Deserialize)]
        struct L {
            #[serde(default)]
            value: Vec<V>,
        }
        let l: L = self.api.get_json(&format!("{}/versions", self.item_url(id)))?;
        Ok(l.value
            .into_iter()
            .map(|v| Revision {
                id: v.id,
                modified: v.modified,
                author: v.by.as_ref().and_then(|b| b.pointer("/user/displayName")).and_then(Value::as_str).map(str::to_owned),
                size: v.size,
            })
            .collect())
    }

    fn comments(&self, _id: &str) -> Result<Vec<Comment>> {
        Err(Error::Unsupported("Microsoft Graph v1.0 has no comments API for arbitrary OneDrive files (Excel workbooks have one: see excel::list_comments)"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::testutil::api;
    use aphrody_accounts::HttpResponse;
    use aphrody_accounts::testing::ScriptedTransport;
    use std::sync::Arc;

    fn od(t: &Arc<ScriptedTransport>) -> OneDrive {
        OneDrive::new(api(t.clone()))
    }

    #[test]
    fn lists_root_children_with_nextlink_paging() {
        let t = Arc::new(ScriptedTransport::new().on(
            "/me/drive/root/children",
            HttpResponse::json(
                200,
                &json!({"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=X","value":[
                    {"id":"1","name":"Docs","folder":{"childCount":2},"eTag":"\"{A},1\""},
                    {"id":"2","name":"a.docx","size":42,"file":{"mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},"eTag":"\"{B},3\"","parentReference":{"id":"root-id"}}
                ]}),
            ),
        ));
        let p = od(&t).list(None, None).unwrap();
        assert_eq!(p.entries[0].kind, EntryKind::Folder);
        assert_eq!((p.entries[1].size, p.entries[1].parents.clone()), (Some(42), vec!["root-id".to_owned()]));
        assert!(p.next.unwrap().contains("skiptoken"));
        assert!(t.requests()[0].url.contains("$top=200"));
    }

    #[test]
    fn small_create_uses_put_content_and_fails_on_name_clash() {
        let t = Arc::new(ScriptedTransport::new().on(":/content", HttpResponse::json(201, &json!({"id":"n","name":"a b.txt","size":2,"file":{"mimeType":"text/plain"},"eTag":"e1"}))));
        let e = od(&t).create(Some("P"), "a b.txt", "text/plain", b"hi".to_vec(), false).unwrap();
        assert_eq!(e.version.as_deref(), Some("e1"));
        let u = &t.requests()[0].url;
        assert!(u.contains("/items/P:/a%20b.txt:/content") && u.contains("conflictBehavior=fail"), "{u}");
    }

    #[test]
    fn update_sends_if_match_and_maps_412_to_a_conflict_with_remote_state() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("/content", HttpResponse { status: 412, ..Default::default() })
                .on("/items/I?", HttpResponse::json(200, &json!({"id":"I","name":"n","eTag":"remote-newer"}))),
        );
        match od(&t).update("I", "text/plain", b"x".to_vec(), Some("mine")).unwrap() {
            SaveOutcome::Conflict { remote } => assert_eq!(remote.version.as_deref(), Some("remote-newer")),
            other => panic!("{other:?}"),
        }
        assert_eq!(t.requests()[0].header_value("if-match"), Some("mine"));
    }

    #[test]
    fn large_update_uses_an_upload_session_with_anonymous_fragments() {
        let data = vec![1u8; FRAGMENT + 5];
        let t = Arc::new(
            ScriptedTransport::new()
                .on("createUploadSession", HttpResponse::json(200, &json!({"uploadUrl":"https://upload.example/sess"})))
                .on("upload.example", HttpResponse::json(202, &json!({"nextExpectedRanges":["10485760-"]})))
                .on("upload.example", HttpResponse::json(200, &json!({"id":"I","name":"big","eTag":"e2","size":FRAGMENT + 5}))),
        );
        match od(&t).update("I", "application/octet-stream", data, Some("e1")).unwrap() {
            SaveOutcome::Saved(e) => assert_eq!(e.version.as_deref(), Some("e2")),
            other => panic!("{other:?}"),
        }
        let r = t.requests();
        assert_eq!(r[0].header_value("if-match"), Some("e1"));
        assert!(r[1].header_value("authorization").is_none() && r[2].header_value("authorization").is_none());
        assert_eq!(r[1].header_value("content-range"), Some(format!("bytes 0-{}/{}", FRAGMENT - 1, FRAGMENT + 5).as_str()));
    }

    #[test]
    fn delta_cursor_then_changes_map_deletions() {
        let t = Arc::new(
            ScriptedTransport::new()
                .on("delta?token=latest", HttpResponse::json(200, &json!({"@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/drive/root/delta?token=T1","value":[]})))
                .on("token=T1", HttpResponse::json(200, &json!({"@odata.deltaLink":"https://graph.microsoft.com/v1.0/me/drive/root/delta?token=T2","value":[
                    {"id":"a","deleted":{"state":"deleted"}},{"id":"b","name":"B","file":{},"eTag":"x"}]}))),
        );
        let d = od(&t);
        let c = d.changes_cursor().unwrap();
        let page = d.changes(&c).unwrap();
        assert_eq!(page.changes[0], Change::Removed("a".into()));
        assert!(matches!(&page.changes[1], Change::Upsert(e) if e.id == "b"));
        assert!(page.new_cursor.unwrap().ends_with("T2"));
    }

    #[test]
    fn share_link_and_unsupported_operations_are_explicit() {
        let t = Arc::new(ScriptedTransport::new().on("/createLink", HttpResponse::json(201, &json!({"link":{"webUrl":"https://1drv.ms/x"}}))));
        let d = od(&t);
        assert_eq!(d.share("I", ShareRole::Writer, &ShareTarget::Anyone).unwrap().url.as_deref(), Some("https://1drv.ms/x"));
        assert!(t.requests()[0].body_text().contains("\"type\":\"edit\""));
        assert!(matches!(d.comments("I"), Err(Error::Unsupported(_))));
        assert!(matches!(d.export("I", ExportFormat::Docx), Err(Error::Unsupported(_))));
    }

    #[test]
    fn sharepoint_library_addresses_the_drive_by_id() {
        let t = Arc::new(ScriptedTransport::new().on("/drives/b%21abc/root/children", HttpResponse::json(200, &json!({"value":[]}))));
        OneDrive::with_drive(api(t.clone()), DriveRef::Id("b!abc".into())).list(None, None).unwrap();
        assert!(t.requests()[0].url.contains("/drives/b%21abc/"));
    }
}
