//! Scope catalog: which OAuth scopes each OS-level service needs, per provider.
//!
//! Google scope URLs: <https://developers.google.com/identity/protocols/oauth2/scopes>.
//! Microsoft Graph permissions: <https://learn.microsoft.com/graph/permissions-reference>.
//! Photos Library scopes `photoslibrary`, `.readonly` and `.sharing` were removed on 2025-04-01
//! (apps can only read what they created); whole-library browsing goes through the Picker API.

use crate::provider::Provider;

const G: &str = "https://www.googleapis.com/auth/";

/// A service the OS exposes natively.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Service {
    /// Files: Google Drive / OneDrive.
    Files,
    /// Documents: Google Docs (Word on OneDrive is plain Files).
    Docs,
    /// Spreadsheets: Google Sheets (Excel workbook API is Files on Microsoft).
    Sheets,
    /// Presentations: Google Slides (PowerPoint is Files on Microsoft).
    Slides,
    /// Calendar.
    Calendar,
    /// Mail.
    Mail,
    /// Contacts / People.
    Contacts,
    /// Tasks / To Do.
    Tasks,
    /// Photos (Google Photos Picker + append-only upload).
    Photos,
    /// YouTube upload and channel reads.
    YouTube,
    /// Google Play Developer API (user-delegated; service accounts need no scope grant).
    PlayConsole,
    /// Vertex AI / Gemini through the user's cloud project.
    CloudPlatform,
}

/// Read-only or read-write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// List and read.
    Read,
    /// Create, modify, delete.
    Write,
}

/// Google's scope classification, which decides verification work for public apps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sensitivity {
    /// No verification required.
    NonSensitive,
    /// Brand verification.
    Sensitive,
    /// Verification plus a yearly third-party security assessment for public apps.
    Restricted,
}

/// Scopes for a service. Empty slice = provider has no such service (documented in the docs table).
pub fn scopes(provider: Provider, service: Service, access: Access) -> &'static [&'static str] {
    use Access::{Read, Write};
    use Service::*;
    match (provider, service, access) {
        (Provider::Google, Files, Read) => &["https://www.googleapis.com/auth/drive.readonly"],
        (Provider::Google, Files, Write) => &["https://www.googleapis.com/auth/drive"],
        (Provider::Google, Docs, Read) => &["https://www.googleapis.com/auth/documents.readonly"],
        (Provider::Google, Docs, Write) => &["https://www.googleapis.com/auth/documents"],
        (Provider::Google, Sheets, Read) => {
            &["https://www.googleapis.com/auth/spreadsheets.readonly"]
        }
        (Provider::Google, Sheets, Write) => &["https://www.googleapis.com/auth/spreadsheets"],
        (Provider::Google, Slides, Read) => {
            &["https://www.googleapis.com/auth/presentations.readonly"]
        }
        (Provider::Google, Slides, Write) => &["https://www.googleapis.com/auth/presentations"],
        (Provider::Google, Calendar, Read) => {
            &["https://www.googleapis.com/auth/calendar.readonly"]
        }
        (Provider::Google, Calendar, Write) => &["https://www.googleapis.com/auth/calendar"],
        (Provider::Google, Mail, Read) => &["https://www.googleapis.com/auth/gmail.readonly"],
        (Provider::Google, Mail, Write) => &[
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/gmail.send",
        ],
        (Provider::Google, Contacts, Read) => {
            &["https://www.googleapis.com/auth/contacts.readonly"]
        }
        (Provider::Google, Contacts, Write) => &["https://www.googleapis.com/auth/contacts"],
        (Provider::Google, Tasks, Read) => &["https://www.googleapis.com/auth/tasks.readonly"],
        (Provider::Google, Tasks, Write) => &["https://www.googleapis.com/auth/tasks"],
        (Provider::Google, Photos, Read) => {
            &["https://www.googleapis.com/auth/photospicker.mediaitems.readonly"]
        }
        (Provider::Google, Photos, Write) => &[
            "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
            "https://www.googleapis.com/auth/photoslibrary.appendonly",
        ],
        (Provider::Google, YouTube, Read) => &["https://www.googleapis.com/auth/youtube.readonly"],
        (Provider::Google, YouTube, Write) => &["https://www.googleapis.com/auth/youtube.upload"],
        (Provider::Google, PlayConsole, _) => &["https://www.googleapis.com/auth/androidpublisher"],
        (Provider::Google, CloudPlatform, _) => &["https://www.googleapis.com/auth/cloud-platform"],

        (Provider::Microsoft, Files | Docs | Sheets | Slides, Read) => &["Files.Read"],
        (Provider::Microsoft, Files | Docs | Sheets | Slides, Write) => &["Files.ReadWrite"],
        (Provider::Microsoft, Calendar, Read) => &["Calendars.Read"],
        (Provider::Microsoft, Calendar, Write) => &["Calendars.ReadWrite"],
        (Provider::Microsoft, Mail, Read) => &["Mail.Read"],
        (Provider::Microsoft, Mail, Write) => &["Mail.ReadWrite", "Mail.Send"],
        (Provider::Microsoft, Contacts, Read) => &["Contacts.Read"],
        (Provider::Microsoft, Contacts, Write) => &["Contacts.ReadWrite"],
        (Provider::Microsoft, Tasks, Read) => &["Tasks.Read"],
        (Provider::Microsoft, Tasks, Write) => &["Tasks.ReadWrite"],
        (Provider::Microsoft, Photos | YouTube | PlayConsole | CloudPlatform, _) => &[],
    }
}

/// Union of the scopes for several services at one access level, de-duplicated.
pub fn scopes_for(provider: Provider, services: &[Service], access: Access) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for s in services {
        for sc in scopes(provider, *s, access) {
            if !out.contains(sc) {
                out.push(sc);
            }
        }
    }
    out
}

/// Google's sensitivity class of a scope URL (unknown scopes are treated as restricted).
pub fn google_sensitivity(scope: &str) -> Sensitivity {
    let name = scope.strip_prefix(G).unwrap_or(scope);
    match name {
        "openid" | "email" | "profile" | "userinfo.email" | "userinfo.profile" | "drive.file"
        | "drive.appdata" => Sensitivity::NonSensitive,
        "drive"
        | "drive.readonly"
        | "drive.metadata"
        | "drive.metadata.readonly"
        | "gmail.readonly"
        | "gmail.modify"
        | "gmail.compose"
        | "gmail.insert"
        | "gmail.settings.basic" => Sensitivity::Restricted,
        "documents"
        | "documents.readonly"
        | "spreadsheets"
        | "spreadsheets.readonly"
        | "presentations"
        | "presentations.readonly"
        | "calendar"
        | "calendar.readonly"
        | "calendar.events"
        | "contacts"
        | "contacts.readonly"
        | "tasks"
        | "tasks.readonly"
        | "gmail.send"
        | "youtube"
        | "youtube.readonly"
        | "youtube.upload"
        | "androidpublisher"
        | "cloud-platform"
        | "photospicker.mediaitems.readonly"
        | "photoslibrary.appendonly"
        | "photoslibrary.readonly.appcreateddata"
        | "photoslibrary.edit.appcreateddata" => Sensitivity::Sensitive,
        _ => Sensitivity::Restricted,
    }
}

/// Scopes that Google allows in the limited-input device flow
/// (<https://developers.google.com/identity/protocols/oauth2/limited-input-device>, checked 2026-10-29).
pub fn google_device_flow_allows(scope: &str) -> bool {
    let name = scope.strip_prefix(G).unwrap_or(scope);
    matches!(
        name,
        "openid"
            | "email"
            | "profile"
            | "drive.appdata"
            | "drive.file"
            | "youtube"
            | "youtube.readonly"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_google_service_has_scopes_and_microsoft_gaps_are_explicit() {
        use Service::*;
        for s in [
            Files,
            Docs,
            Sheets,
            Slides,
            Calendar,
            Mail,
            Contacts,
            Tasks,
            Photos,
            YouTube,
            PlayConsole,
            CloudPlatform,
        ] {
            for a in [Access::Read, Access::Write] {
                assert!(!scopes(Provider::Google, s, a).is_empty(), "{s:?}/{a:?}");
            }
        }
        assert!(scopes(Provider::Microsoft, Photos, Access::Read).is_empty());
        assert_eq!(
            scopes_for(Provider::Microsoft, &[Files, Docs, Sheets], Access::Write),
            vec!["Files.ReadWrite"]
        );
    }

    #[test]
    fn photos_never_asks_for_removed_scopes() {
        for a in [Access::Read, Access::Write] {
            for s in scopes(Provider::Google, Service::Photos, a) {
                assert!(
                    !s.ends_with("photoslibrary")
                        && !s.ends_with("photoslibrary.readonly")
                        && !s.ends_with("photoslibrary.sharing")
                );
            }
        }
    }

    #[test]
    fn device_flow_cannot_carry_full_drive() {
        assert!(google_device_flow_allows(
            "https://www.googleapis.com/auth/drive.file"
        ));
        assert!(!google_device_flow_allows(
            "https://www.googleapis.com/auth/drive"
        ));
        assert!(!google_device_flow_allows(
            "https://www.googleapis.com/auth/documents"
        ));
    }

    #[test]
    fn classification() {
        assert_eq!(
            google_sensitivity("https://www.googleapis.com/auth/drive"),
            Sensitivity::Restricted
        );
        assert_eq!(
            google_sensitivity("https://www.googleapis.com/auth/drive.file"),
            Sensitivity::NonSensitive
        );
        assert_eq!(
            google_sensitivity("https://www.googleapis.com/auth/documents"),
            Sensitivity::Sensitive
        );
    }
}
