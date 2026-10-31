//! Google REST calls used by the backend and the sessions. Each takes a bearer token from
//! [`super::adc::Adc`] (service account) or [`super::oauth::OwnerOAuth`] (owner account) and returns
//! the API's JSON, trimmed with `fields` where the API supports it.

use super::{HTTP, Result, check};
use serde_json::Value;

async fn get(token: &str, url: &str, query: &[(&str, &str)]) -> Result<Value> {
    let resp = HTTP.get(url).bearer_auth(token).query(query).send().await?;
    Ok(check(resp).await?.json().await?)
}

/// OpenID userinfo (email, name, picture).
pub async fn userinfo(token: &str) -> Result<Value> {
    get(token, "https://openidconnect.googleapis.com/v1/userinfo", &[]).await
}

/// Files directly under My Drive's root.
pub async fn drive_root(token: &str, page_size: u32) -> Result<Value> {
    let size = page_size.clamp(1, 1000).to_string();
    get(
        token,
        "https://www.googleapis.com/drive/v3/files",
        &[
            ("q", "'root' in parents and trashed = false"),
            ("pageSize", size.as_str()),
            ("orderBy", "folder,name"),
            ("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)"),
        ],
    )
    .await
}

/// Drive storage quota and user.
pub async fn drive_about(token: &str) -> Result<Value> {
    get(
        token,
        "https://www.googleapis.com/drive/v3/about",
        &[("fields", "user(displayName,emailAddress),storageQuota")],
    )
    .await
}

/// Gmail labels.
pub async fn gmail_labels(token: &str) -> Result<Value> {
    get(token, "https://gmail.googleapis.com/gmail/v1/users/me/labels", &[]).await
}

/// Gmail message ids of a search (`q` uses Gmail search syntax).
pub async fn gmail_messages(token: &str, q: &str, max: u32) -> Result<Value> {
    let max = max.clamp(1, 500).to_string();
    get(
        token,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        &[("q", q), ("maxResults", max.as_str())],
    )
    .await
}

/// Calendars of the user.
pub async fn calendar_list(token: &str) -> Result<Value> {
    get(
        token,
        "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        &[("fields", "items(id,summary,primary,accessRole,timeZone)")],
    )
    .await
}

/// Upcoming events of one calendar (`primary` for the main one), from now.
pub async fn calendar_events(token: &str, calendar: &str, time_min_rfc3339: &str, max: u32) -> Result<Value> {
    let max = max.clamp(1, 2500).to_string();
    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/{}/events",
        url::form_urlencoded::byte_serialize(calendar.as_bytes()).collect::<String>()
    );
    get(
        token,
        &url,
        &[
            ("timeMin", time_min_rfc3339),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
            ("maxResults", max.as_str()),
        ],
    )
    .await
}

/// The user's own YouTube channels.
pub async fn youtube_my_channels(token: &str) -> Result<Value> {
    get(
        token,
        "https://www.googleapis.com/youtube/v3/channels",
        &[("part", "snippet,statistics,contentDetails"), ("mine", "true")],
    )
    .await
}

/// Contacts (People API connections).
pub async fn people_connections(token: &str, page_size: u32) -> Result<Value> {
    let size = page_size.clamp(1, 1000).to_string();
    get(
        token,
        "https://people.googleapis.com/v1/people/me/connections",
        &[
            ("personFields", "names,emailAddresses,phoneNumbers"),
            ("pageSize", size.as_str()),
        ],
    )
    .await
}

/// Cloud Storage buckets of a project.
pub async fn gcs_buckets(token: &str, project: &str) -> Result<Value> {
    get(
        token,
        "https://storage.googleapis.com/storage/v1/b",
        &[("project", project), ("fields", "items(name,location,storageClass,timeCreated)")],
    )
    .await
}

/// Artifact Registry repositories of a project in one location.
pub async fn artifact_repositories(token: &str, project: &str, location: &str) -> Result<Value> {
    let url = format!(
        "https://artifactregistry.googleapis.com/v1/projects/{project}/locations/{location}/repositories"
    );
    get(token, &url, &[]).await
}

const GRAPH: &str = "https://graph.microsoft.com/v1.0";

/// Microsoft Graph `/me`.
pub async fn graph_me(token: &str) -> Result<Value> {
    get(token, &format!("{GRAPH}/me"), &[("$select", "id,displayName,mail,userPrincipalName")]).await
}

/// OneDrive root children.
pub async fn onedrive_root(token: &str) -> Result<Value> {
    get(
        token,
        &format!("{GRAPH}/me/drive/root/children"),
        &[("$select", "id,name,size,folder,file,lastModifiedDateTime,webUrl"), ("$top", "100")],
    )
    .await
}

/// Newest Outlook inbox messages.
pub async fn outlook_messages(token: &str, top: u32) -> Result<Value> {
    let top = top.clamp(1, 100).to_string();
    get(
        token,
        &format!("{GRAPH}/me/mailFolders/inbox/messages"),
        &[
            ("$select", "id,subject,from,receivedDateTime,isRead,webLink"),
            ("$orderby", "receivedDateTime desc"),
            ("$top", top.as_str()),
        ],
    )
    .await
}

/// Calendar occurrences between two ISO-8601 instants (recurrences expanded).
pub async fn graph_calendar_view(token: &str, start: &str, end: &str) -> Result<Value> {
    get(
        token,
        &format!("{GRAPH}/me/calendarView"),
        &[
            ("startDateTime", start),
            ("endDateTime", end),
            ("$select", "id,subject,start,end,location,isAllDay,webLink"),
            ("$orderby", "start/dateTime"),
            ("$top", "200"),
        ],
    )
    .await
}
