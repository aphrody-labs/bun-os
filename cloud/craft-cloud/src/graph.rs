//! Microsoft Graph v1.0 services beyond files: Outlook mail, calendar, contacts and To Do, for the OS shell and
//! the sessions (calendar sync, mail notifications). Delegated permissions per call are listed on each constant;
//! the app registration is `infra/cloud/azure.json` (`MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_TENANT`).
//!
//! Endpoints: <https://learn.microsoft.com/graph/api/overview>. Paging follows `@odata.nextLink`.

use crate::api::{Api, enc};
use aphrody_accounts::{HttpRequest, Result};
use serde_json::{Value, json};

const GRAPH: &str = "https://graph.microsoft.com/v1.0";

/// `Mail.ReadWrite`.
pub const SCOPE_MAIL: &str = "Mail.ReadWrite";
/// `Mail.Send`.
pub const SCOPE_MAIL_SEND: &str = "Mail.Send";
/// `Calendars.ReadWrite`.
pub const SCOPE_CALENDAR: &str = "Calendars.ReadWrite";
/// `Contacts.ReadWrite`.
pub const SCOPE_CONTACTS: &str = "Contacts.ReadWrite";
/// `Tasks.ReadWrite`.
pub const SCOPE_TASKS: &str = "Tasks.ReadWrite";
/// `User.Read`.
pub const SCOPE_USER: &str = "User.Read";

/// One page of a Graph collection.
#[derive(Debug, Clone, Default)]
pub struct GraphPage {
    /// `value` items.
    pub items: Vec<Value>,
    /// `@odata.nextLink`, when more items exist.
    pub next: Option<String>,
}

fn page(v: Value) -> GraphPage {
    GraphPage {
        next: v["@odata.nextLink"].as_str().map(str::to_owned),
        items: match v.get("value") {
            Some(Value::Array(a)) => a.clone(),
            _ => Vec::new(),
        },
    }
}

/// Graph client for mail, calendar, contacts and To Do.
pub struct Graph {
    api: Api,
}

impl Graph {
    /// Wrap an authenticated client (its scopes should cover the calls made).
    pub fn new(api: Api) -> Self {
        Self { api }
    }

    fn list(&self, url: &str, next: Option<&str>) -> Result<GraphPage> {
        Ok(page(self.api.get_json(next.unwrap_or(url))?))
    }

    /// Signed-in user (`/me`).
    pub fn me(&self) -> Result<Value> {
        self.api.get_json(&format!("{GRAPH}/me?$select=id,displayName,mail,userPrincipalName"))
    }

    /// Mail folders.
    pub fn mail_folders(&self, next: Option<&str>) -> Result<GraphPage> {
        self.list(&format!("{GRAPH}/me/mailFolders?$top=100"), next)
    }

    /// Messages of a folder (`inbox`, `sentitems`, an id), newest first; `search` uses KQL.
    pub fn messages(&self, folder: &str, search: Option<&str>, top: u32, next: Option<&str>) -> Result<GraphPage> {
        let mut url = format!(
            "{GRAPH}/me/mailFolders/{}/messages?$top={}&$select=id,subject,from,receivedDateTime,isRead,bodyPreview,webLink",
            enc(folder),
            top.clamp(1, 1000)
        );
        match search {
            Some(q) => url.push_str(&format!("&$search={}", enc(&format!("\"{q}\"")))),
            None => url.push_str("&$orderby=receivedDateTime%20desc"),
        }
        self.list(&url, next)
    }

    /// Send a plain-text or HTML message (`Mail.Send`).
    pub fn send_mail(&self, to: &[&str], subject: &str, body: &str, html: bool) -> Result<()> {
        let recipients: Vec<Value> = to.iter().map(|a| json!({"emailAddress": {"address": a}})).collect();
        let msg = json!({
            "message": {
                "subject": subject,
                "body": {"contentType": if html { "HTML" } else { "Text" }, "content": body},
                "toRecipients": recipients,
            },
            "saveToSentItems": true,
        });
        self.api.send(HttpRequest::json("POST", format!("{GRAPH}/me/sendMail"), &msg)).map(|_| ())
    }

    /// Calendars.
    pub fn calendars(&self, next: Option<&str>) -> Result<GraphPage> {
        self.list(&format!("{GRAPH}/me/calendars?$select=id,name,color,isDefaultCalendar,canEdit"), next)
    }

    /// Occurrences between two ISO-8601 instants (recurring events expanded), default calendar.
    pub fn calendar_view(&self, start: &str, end: &str, next: Option<&str>) -> Result<GraphPage> {
        self.list(
            &format!(
                "{GRAPH}/me/calendarView?startDateTime={}&endDateTime={}&$orderby=start/dateTime&$top=200&$select=id,subject,start,end,location,isAllDay,organizer,webLink",
                enc(start),
                enc(end)
            ),
            next,
        )
    }

    /// Create an event on the default calendar (Graph `event` JSON).
    pub fn create_event(&self, event: &Value) -> Result<Value> {
        self.api.json("POST", &format!("{GRAPH}/me/events"), event)
    }

    /// Contacts.
    pub fn contacts(&self, next: Option<&str>) -> Result<GraphPage> {
        self.list(&format!("{GRAPH}/me/contacts?$top=200&$select=id,displayName,emailAddresses,mobilePhone"), next)
    }

    /// To Do lists.
    pub fn todo_lists(&self, next: Option<&str>) -> Result<GraphPage> {
        self.list(&format!("{GRAPH}/me/todo/lists"), next)
    }

    /// Tasks of a To Do list.
    pub fn todo_tasks(&self, list: &str, next: Option<&str>) -> Result<GraphPage> {
        self.list(&format!("{GRAPH}/me/todo/lists/{}/tasks?$top=200", enc(list)), next)
    }
}
