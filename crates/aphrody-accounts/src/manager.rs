//! Multiple accounts: sign-in, persistence, switching, silent token refresh.

use crate::error::{Error, Result};
use crate::flow::{self, DeviceCode};
use crate::http::HttpTransport;
use crate::loopback::Loopback;
use crate::pkce::{Pkce, random_urlsafe};
use crate::provider::{Provider, ProviderConfig, Tenant};
use crate::token::{IdClaims, TokenSet};
use crate::vault::TokenVault;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Access tokens closer than this to expiry are refreshed first.
pub const EXPIRY_SKEW_SECS: u64 = 120;

/// Public, non-secret description of a signed-in account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    /// Stable id: `google:<sub>` or `microsoft:<tid>.<oid|sub>`.
    pub id: String,
    /// Identity platform.
    pub provider: Provider,
    /// Entra tenant segment the account signed in through (Google: `common`).
    pub tenant: String,
    /// Email or sign-in name.
    pub label: String,
    /// Display name, when the id_token had one.
    pub display_name: Option<String>,
    /// Avatar URL, when known.
    pub picture: Option<String>,
    /// Scopes granted so far (union over incremental grants).
    pub scopes: Vec<String>,
    /// Set when the provider rejected the refresh token.
    pub needs_reauth: bool,
    /// Unix seconds of the first sign-in.
    pub added_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    accounts: Vec<Account>,
    active: Option<String>,
}

/// Anything that can hand out a bearer token for an account and a set of scopes.
pub trait TokenSource: Send + Sync {
    /// Valid access token for `account`, refreshing silently; errors when scopes are not granted.
    fn bearer(&self, account: &str, scopes: &[&str]) -> Result<String>;
}

/// Fixed token, for tests and for service-account tokens minted elsewhere (`gcloud ... print-access-token`).
pub struct StaticToken(pub String);

impl TokenSource for StaticToken {
    fn bearer(&self, _account: &str, _scopes: &[&str]) -> Result<String> {
        Ok(self.0.clone())
    }
}

/// Account store and token broker.
pub struct AccountManager {
    index_path: PathBuf,
    vault: Arc<dyn TokenVault>,
    http: Arc<dyn HttpTransport>,
    clients: Mutex<HashMap<Provider, ProviderConfig>>,
    index: Mutex<Index>,
    refresh_lock: Mutex<()>,
    now: Box<dyn Fn() -> u64 + Send + Sync>,
}

impl AccountManager {
    /// Open (or create) the index at `index_path`; secrets go to `vault`.
    pub fn open(index_path: impl Into<PathBuf>, vault: Arc<dyn TokenVault>, http: Arc<dyn HttpTransport>) -> Result<Self> {
        let index_path = index_path.into();
        let index = match std::fs::read(&index_path) {
            Ok(b) => serde_json::from_slice(&b)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index::default(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            index_path,
            vault,
            http,
            clients: Mutex::new(HashMap::new()),
            index: Mutex::new(index),
            refresh_lock: Mutex::new(()),
            now: Box::new(flow::unix_now),
        })
    }
    /// Replace the clock (tests).
    #[must_use]
    pub fn with_clock(mut self, now: impl Fn() -> u64 + Send + Sync + 'static) -> Self {
        self.now = Box::new(now);
        self
    }
    /// Register the OAuth client used for a provider.
    pub fn register_client(&self, cfg: ProviderConfig) {
        if let Ok(mut c) = self.clients.lock() {
            c.insert(cfg.provider, cfg);
        }
    }
    fn client(&self, p: Provider) -> Result<ProviderConfig> {
        self.clients
            .lock()
            .map_err(|_| Error::Vault("poisoned".into()))?
            .get(&p)
            .cloned()
            .ok_or(Error::NoClient(p.as_str()))
    }
    fn save(&self, idx: &Index) -> Result<()> {
        if let Some(dir) = self.index_path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.index_path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(idx)?)?;
        std::fs::rename(&tmp, &self.index_path)?;
        Ok(())
    }
    fn with_index<R>(&self, f: impl FnOnce(&mut Index) -> R) -> Result<R> {
        let mut g = self.index.lock().map_err(|_| Error::Vault("poisoned".into()))?;
        Ok(f(&mut g))
    }

    /// All accounts, in sign-in order.
    pub fn list(&self) -> Vec<Account> {
        self.with_index(|i| i.accounts.clone()).unwrap_or_default()
    }
    /// The account used when a caller does not name one.
    pub fn active(&self) -> Option<Account> {
        self.with_index(|i| i.active.as_ref().and_then(|id| i.accounts.iter().find(|a| &a.id == id).cloned())).ok().flatten()
    }
    /// Look one up.
    pub fn get(&self, id: &str) -> Option<Account> {
        self.list().into_iter().find(|a| a.id == id)
    }
    /// Make `id` the active account (the shell Settings switcher calls this).
    pub fn set_active(&self, id: &str) -> Result<()> {
        let mut idx = self.index.lock().map_err(|_| Error::Vault("poisoned".into()))?;
        if !idx.accounts.iter().any(|a| a.id == id) {
            return Err(Error::UnknownAccount(id.into()));
        }
        idx.active = Some(id.into());
        self.save(&idx)
    }

    fn account_id(provider: Provider, c: &IdClaims) -> String {
        match (provider, &c.tid, &c.oid) {
            (Provider::Microsoft, Some(tid), Some(oid)) => format!("microsoft:{tid}.{oid}"),
            _ => format!("{}:{}", provider.as_str(), c.sub),
        }
    }

    /// Persist tokens obtained from a completed flow; creates or updates the account and makes it active.
    pub fn add_with_tokens(&self, provider: Provider, tenant: &Tenant, tokens: TokenSet) -> Result<Account> {
        let claims = tokens.id_token.as_deref().map(IdClaims::decode).transpose()?.ok_or_else(|| {
            Error::Invalid("no id_token: the grant must include the `openid` scope".into())
        })?;
        let id = Self::account_id(provider, &claims);
        let now = (self.now)();
        let mut idx = self.index.lock().map_err(|_| Error::Vault("poisoned".into()))?;
        let existing = idx.accounts.iter().position(|a| a.id == id);
        let mut scopes: Vec<String> = existing.map(|i| idx.accounts[i].scopes.clone()).unwrap_or_default();
        for s in &tokens.scopes {
            if !scopes.iter().any(|x| x.eq_ignore_ascii_case(s)) {
                scopes.push(s.clone());
            }
        }
        let account = Account {
            id: id.clone(),
            provider,
            tenant: if provider == Provider::Microsoft { tenant.segment().to_owned() } else { "common".into() },
            label: claims.label(),
            display_name: claims.name.clone(),
            picture: claims.picture.clone(),
            scopes,
            needs_reauth: false,
            added_at: existing.map_or(now, |i| idx.accounts[i].added_at),
        };
        let mut stored = tokens;
        stored.scopes.clone_from(&account.scopes);
        // A re-consent without a new refresh token (Google) must not drop the one we have.
        if stored.refresh_token.is_none() {
            stored.refresh_token = self.load(&id)?.and_then(|t| t.refresh_token);
        }
        self.vault.set(&id, &serde_json::to_string(&stored)?)?;
        match existing {
            Some(i) => idx.accounts[i] = account.clone(),
            None => idx.accounts.push(account.clone()),
        }
        idx.active = Some(id);
        self.save(&idx)?;
        Ok(account)
    }

    fn load(&self, id: &str) -> Result<Option<TokenSet>> {
        self.vault.get(id)?.map(|s| serde_json::from_str(&s).map_err(Error::from)).transpose()
    }

    /// Browser sign-in: PKCE authorization code flow with a loopback redirect.
    ///
    /// `open_url` receives the authorization URL (open it in the user's browser or print it).
    /// Pass `login_hint` to pre-select an account, `force_consent` to re-issue a refresh token.
    pub fn login_loopback(
        &self,
        provider: Provider,
        scopes: &[&str],
        login_hint: Option<&str>,
        force_consent: bool,
        open_url: &dyn Fn(&str),
        timeout: Duration,
    ) -> Result<Account> {
        let cfg = self.client(provider)?;
        let lb = Loopback::bind(cfg.loopback_host())?;
        let redirect = lb.redirect_uri();
        let pkce = Pkce::generate()?;
        let state = random_urlsafe(24)?;
        let wanted = flow::effective_scopes(&cfg, scopes);
        let url = flow::authorization_url(&cfg, &wanted, &redirect, &state, &pkce, login_hint, force_consent)?;
        open_url(&url);
        let code = lb.wait_for_code(&state, timeout)?;
        let tokens = flow::exchange_code(self.http.as_ref(), &cfg, &code, &redirect, &pkce, &wanted, (self.now)())?;
        self.add_with_tokens(provider, &cfg.tenant, tokens)
    }

    /// Start the device grant; show `DeviceCode::user_code` and `verification_uri`, then call [`Self::finish_device`].
    pub fn begin_device(&self, provider: Provider, scopes: &[&str]) -> Result<DeviceCode> {
        let cfg = self.client(provider)?;
        let wanted = flow::effective_scopes(&cfg, scopes);
        if provider == Provider::Google {
            if let Some(bad) = wanted.iter().find(|s| !crate::scopes::google_device_flow_allows(s)) {
                return Err(Error::Invalid(format!(
                    "Google's device flow only allows openid/email/profile, drive.file, drive.appdata and youtube scopes; `{bad}` needs the loopback flow"
                )));
            }
        }
        flow::start_device(self.http.as_ref(), &cfg, &wanted)
    }

    /// Poll the device grant until the user finishes, then store the account.
    pub fn finish_device(&self, provider: Provider, dc: &DeviceCode, sleep: &dyn Fn(Duration)) -> Result<Account> {
        let cfg = self.client(provider)?;
        let tokens = flow::wait_device(self.http.as_ref(), &cfg, dc, &|| (self.now)(), sleep)?;
        self.add_with_tokens(provider, &cfg.tenant, tokens)
    }

    /// Sign out. With `revoke`, Google tokens are revoked at the provider first (best effort).
    pub fn remove(&self, id: &str, revoke: bool) -> Result<()> {
        let acct = self.get(id).ok_or_else(|| Error::UnknownAccount(id.into()))?;
        if revoke {
            if let (Some(t), Ok(cfg)) = (self.load(id)?, self.client(acct.provider)) {
                let token = t.refresh_token.as_deref().unwrap_or(&t.access_token);
                let _ = flow::revoke(self.http.as_ref(), &cfg, token);
            }
        }
        self.vault.delete(id)?;
        let mut idx = self.index.lock().map_err(|_| Error::Vault("poisoned".into()))?;
        idx.accounts.retain(|a| a.id != id);
        if idx.active.as_deref() == Some(id) {
            idx.active = idx.accounts.first().map(|a| a.id.clone());
        }
        self.save(&idx)
    }
}

impl TokenSource for AccountManager {
    fn bearer(&self, account: &str, scopes: &[&str]) -> Result<String> {
        let acct = self.get(account).ok_or_else(|| Error::UnknownAccount(account.into()))?;
        let missing: Vec<String> = {
            let probe = TokenSet {
                access_token: String::new(),
                refresh_token: None,
                expires_at: 0,
                scopes: acct.scopes.clone(),
                id_token: None,
            };
            probe.missing_scopes(scopes).into_iter().map(str::to_owned).collect()
        };
        if !missing.is_empty() {
            return Err(Error::MissingScopes { account: account.into(), missing });
        }
        let _g = self.refresh_lock.lock().map_err(|_| Error::Vault("poisoned".into()))?;
        let tokens = self.load(account)?.ok_or_else(|| Error::ReauthRequired(account.into()))?;
        let now = (self.now)();
        if tokens.is_fresh(now, EXPIRY_SKEW_SECS) {
            return Ok(tokens.access_token);
        }
        let cfg = self.client(acct.provider)?;
        match flow::refresh(self.http.as_ref(), &cfg, &tokens, now) {
            Ok(new) => {
                self.vault.set(account, &serde_json::to_string(&new)?)?;
                Ok(new.access_token)
            }
            Err(Error::OAuth { code, .. }) if code == "invalid_grant" || code == "interaction_required" => {
                let mut idx = self.index.lock().map_err(|_| Error::Vault("poisoned".into()))?;
                if let Some(a) = idx.accounts.iter_mut().find(|a| a.id == account) {
                    a.needs_reauth = true;
                }
                self.save(&idx)?;
                Err(Error::ReauthRequired(account.into()))
            }
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::HttpResponse;
    use crate::testing::{ScriptedTransport, fake_id_token};
    use crate::vault::MemoryVault;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn mgr(dir: &std::path::Path, http: Arc<ScriptedTransport>, clock: Arc<AtomicU64>) -> AccountManager {
        let m = AccountManager::open(dir.join("accounts.json"), Arc::new(MemoryVault::new()), http)
            .unwrap()
            .with_clock(move || clock.load(Ordering::SeqCst));
        m.register_client(ProviderConfig::google("gid", Some("gsec".into())));
        m.register_client(ProviderConfig::microsoft("mid", Tenant::Common));
        m
    }

    fn tokens(sub: &str, email: &str, scopes: &[&str], rt: Option<&str>, exp: u64) -> TokenSet {
        TokenSet {
            access_token: format!("AT-{sub}"),
            refresh_token: rt.map(str::to_owned),
            expires_at: exp,
            scopes: scopes.iter().map(|s| (*s).to_owned()).collect(),
            id_token: Some(fake_id_token(&json!({"sub":sub,"email":email,"name":"Owner"}))),
        }
    }

    #[test]
    fn multiple_accounts_switch_and_persist_without_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(AtomicU64::new(1000));
        let m = mgr(dir.path(), Arc::new(ScriptedTransport::new()), clock.clone());
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid"], Some("RT-A"), 5000)).unwrap();
        let b = m.add_with_tokens(Provider::Microsoft, &Tenant::Consumers, tokens("2", "b@outlook.com", &["User.Read"], Some("RT-B"), 5000)).unwrap();
        assert_eq!(a.id, "google:1");
        assert_eq!(b.id, "microsoft:2");
        assert_eq!(m.active().unwrap().id, b.id);
        m.set_active(&a.id).unwrap();
        assert_eq!(m.list().len(), 2);
        assert!(matches!(m.set_active("nope"), Err(Error::UnknownAccount(_))));

        let on_disk = std::fs::read_to_string(dir.path().join("accounts.json")).unwrap();
        assert!(!on_disk.contains("RT-A") && !on_disk.contains("AT-1"), "index must hold no token material");

        let reopened = AccountManager::open(dir.path().join("accounts.json"), Arc::new(MemoryVault::new()), Arc::new(ScriptedTransport::new())).unwrap();
        assert_eq!(reopened.active().unwrap().id, a.id);
        assert_eq!(reopened.get("microsoft:2").unwrap().tenant, "consumers");
    }

    #[test]
    fn entra_ids_use_tenant_and_object_id() {
        let c = IdClaims { sub: "pairwise".into(), tid: Some("T".into()), oid: Some("O".into()), ..Default::default() };
        assert_eq!(AccountManager::account_id(Provider::Microsoft, &c), "microsoft:T.O");
    }

    #[test]
    fn silent_refresh_only_when_near_expiry_and_serialized() {
        let dir = tempfile::tempdir().unwrap();
        let clock = Arc::new(AtomicU64::new(1000));
        let http = Arc::new(ScriptedTransport::new().on(
            "oauth2.googleapis.com/token",
            HttpResponse::json(200, &json!({"access_token":"AT-new","expires_in":3600})),
        ));
        let m = mgr(dir.path(), http.clone(), clock.clone());
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid", "https://www.googleapis.com/auth/drive"], Some("RT"), 1500)).unwrap();
        assert_eq!(m.bearer(&a.id, &["https://www.googleapis.com/auth/drive.readonly"]).unwrap(), "AT-1");
        assert_eq!(http.count("/token"), 0);
        clock.store(1450, Ordering::SeqCst);
        assert_eq!(m.bearer(&a.id, &[]).unwrap(), "AT-new");
        assert_eq!(m.bearer(&a.id, &[]).unwrap(), "AT-new");
        assert_eq!(http.count("/token"), 1, "second call uses the refreshed token");
    }

    #[test]
    fn missing_scope_is_reported_before_any_network_call() {
        let dir = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedTransport::new());
        let m = mgr(dir.path(), http.clone(), Arc::new(AtomicU64::new(0)));
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid"], Some("RT"), 9999)).unwrap();
        match m.bearer(&a.id, &["https://www.googleapis.com/auth/documents"]) {
            Err(Error::MissingScopes { missing, .. }) => assert_eq!(missing, vec!["https://www.googleapis.com/auth/documents"]),
            other => panic!("{other:?}"),
        }
        assert!(http.requests().is_empty());
    }

    #[test]
    fn revoked_refresh_token_flags_the_account() {
        let dir = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedTransport::new().on("/token", HttpResponse::json(400, &json!({"error":"invalid_grant"}))));
        let m = mgr(dir.path(), http, Arc::new(AtomicU64::new(100)));
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid"], Some("RT"), 100)).unwrap();
        assert!(matches!(m.bearer(&a.id, &[]), Err(Error::ReauthRequired(_))));
        assert!(m.get(&a.id).unwrap().needs_reauth);
    }

    #[test]
    fn incremental_consent_unions_scopes_and_keeps_the_refresh_token() {
        let dir = tempfile::tempdir().unwrap();
        let m = mgr(dir.path(), Arc::new(ScriptedTransport::new()), Arc::new(AtomicU64::new(0)));
        m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid"], Some("RT"), 9999)).unwrap();
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["https://www.googleapis.com/auth/documents"], None, 9999)).unwrap();
        assert_eq!(m.list().len(), 1);
        assert!(a.scopes.contains(&"openid".to_owned()) && a.scopes.iter().any(|s| s.ends_with("/documents")));
        assert_eq!(m.load(&a.id).unwrap().unwrap().refresh_token.as_deref(), Some("RT"));
    }

    #[test]
    fn remove_revokes_google_and_promotes_another_account() {
        let dir = tempfile::tempdir().unwrap();
        let http = Arc::new(ScriptedTransport::new().on("revoke", HttpResponse { status: 200, ..Default::default() }));
        let m = mgr(dir.path(), http.clone(), Arc::new(AtomicU64::new(0)));
        let a = m.add_with_tokens(Provider::Google, &Tenant::Common, tokens("1", "a@gmail.com", &["openid"], Some("RT"), 9)).unwrap();
        let b = m.add_with_tokens(Provider::Microsoft, &Tenant::Common, tokens("2", "b@x.y", &["User.Read"], Some("R2"), 9)).unwrap();
        m.set_active(&a.id).unwrap();
        m.remove(&a.id, true).unwrap();
        assert!(http.requests()[0].body_text().contains("token=RT"));
        assert_eq!(m.active().unwrap().id, b.id);
        assert!(m.load(&a.id).unwrap().is_none());
    }

    #[test]
    fn google_device_flow_refuses_full_drive_scope() {
        let dir = tempfile::tempdir().unwrap();
        let m = mgr(dir.path(), Arc::new(ScriptedTransport::new()), Arc::new(AtomicU64::new(0)));
        let err = m.begin_device(Provider::Google, &["https://www.googleapis.com/auth/drive"]).unwrap_err();
        assert!(err.to_string().contains("loopback"));
    }

    #[test]
    fn end_to_end_loopback_login_against_scripted_google() {
        let dir = tempfile::tempdir().unwrap();
        let id_token = fake_id_token(&json!({"sub":"777","email":"me@gmail.com","name":"Me"}));
        let http = Arc::new(ScriptedTransport::new().on(
            "oauth2.googleapis.com/token",
            HttpResponse::json(200, &json!({"access_token":"AT","expires_in":3600,"refresh_token":"RT","scope":"openid email https://www.googleapis.com/auth/drive.file","id_token":id_token})),
        ));
        let m = mgr(dir.path(), http.clone(), Arc::new(AtomicU64::new(10)));
        // The "browser": parse the URL we are asked to open and hit the loopback redirect like Google would.
        let acct = m
            .login_loopback(
                Provider::Google,
                &["https://www.googleapis.com/auth/drive.file"],
                None,
                false,
                &|url| {
                    let u = url::Url::parse(url).unwrap();
                    let q: HashMap<_, _> = u.query_pairs().into_owned().collect();
                    let redirect = url::Url::parse(&q["redirect_uri"]).unwrap();
                    let (host, port, state) = (redirect.host_str().unwrap().to_owned(), redirect.port().unwrap(), q["state"].clone());
                    std::thread::spawn(move || {
                        use std::io::{Read, Write};
                        let mut s = std::net::TcpStream::connect((host.as_str(), port)).unwrap();
                        write!(s, "GET /?code=THE_CODE&state={state} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
                        let mut sink = String::new();
                        let _ = s.read_to_string(&mut sink);
                    });
                },
                Duration::from_secs(10),
            )
            .unwrap();
        assert_eq!(acct.id, "google:777");
        assert_eq!(acct.label, "me@gmail.com");
        let body = http.requests()[0].body_text();
        assert!(body.contains("code=THE_CODE") && body.contains("code_verifier="));
        assert_eq!(m.bearer(&acct.id, &["https://www.googleapis.com/auth/drive.file"]).unwrap(), "AT");
    }
}
