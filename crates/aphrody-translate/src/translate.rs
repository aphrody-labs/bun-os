// SPDX-License-Identifier: Apache-2.0
//! Moteur unifié de traduction aphrody (Aphrody Web Google Translate, Google RPC, MyMemory).
//!
//! Trois étages de backend :
//!   - `Backend::WebGoogle` -> Moteur Google Translate multi-tier via un adaptateur Web explicite
//!     (RPC / Web / TTS)
//!   - `Backend::GoogleRpc` -> Google Translate RPC natif direct (`translate_a/single`, sans clé,
//!     haute disponibilité)
//!   - `Backend::MyMemory`  -> API MyMemory historique (repli)
//!

#[cfg(not(target_arch = "wasm32"))]
use aphrody_proc::NoWindow as _;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[cfg(not(target_arch = "wasm32"))]
use anyhow::Context as _;
use anyhow::Result;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tracing::warn;

/// Backend de traduction sélectionné.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Backend {
    /// Cascade automatique : WebGoogle (si disponible) -> GoogleRpc -> MyMemory.
    #[default]
    Auto,
    /// Binaire Aphrody Web (Google Translate multi-tier avec anti-bot et rotation).
    WebGoogle,
    /// Google Translate RPC public direct (GTX endpoint).
    GoogleRpc,
    /// MyMemory Translated API.
    MyMemory,
}

impl Backend {
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "web" | "web-google" | "web_google" => Self::WebGoogle,
            "google" | "google-rpc" | "rpc" | "gtx" => Self::GoogleRpc,
            "mymemory" | "memory" => Self::MyMemory,
            _ => Self::Auto,
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
const MYMEMORY_ENDPOINT: &str = "https://api.mymemory.translated.net/get";

#[cfg(not(target_arch = "wasm32"))]
const GOOGLE_RPC_ENDPOINT: &str = "https://translate.googleapis.com/translate_a/single";

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Deserialize)]
struct MyMemoryResponse {
    #[serde(rename = "responseData")]
    response_data: MyMemoryData,
    #[serde(rename = "responseStatus")]
    response_status: u32,
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Deserialize)]
struct MyMemoryData {
    #[serde(rename = "translatedText")]
    translated_text: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct CacheFile {
    pub entries: std::collections::BTreeMap<String, String>,
}

/// Moteur de traduction unifié.
pub struct Translator {
    backend: Backend,
    #[cfg(not(target_arch = "wasm32"))]
    client: reqwest::Client,
    cache: Arc<DashMap<String, String>>,
    #[cfg(not(target_arch = "wasm32"))]
    cache_path: PathBuf,
    #[cfg(not(target_arch = "wasm32"))]
    contact_email: Option<String>,
}

impl Translator {
    /// Construit un `Translator` avec le cache persistant par défaut.
    pub fn new(cache_path: PathBuf, contact_email: Option<String>) -> Result<Self> {
        let cache: Arc<DashMap<String, String>> = Arc::new(DashMap::new());

        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = rustls::crypto::ring::default_provider().install_default();

            let client = reqwest::Client::builder()
                .user_agent("aphrody-translate/2.0")
                .timeout(std::time::Duration::from_secs(15))
                .build()?;

            if cache_path.exists() {
                let raw = std::fs::read_to_string(&cache_path)
                    .with_context(|| format!("read cache {:?}", cache_path))?;
                let file: CacheFile = serde_json::from_str(&raw).unwrap_or_default();
                for (k, v) in file.entries {
                    cache.insert(k, v);
                }
            }

            Ok(Self {
                backend: Backend::Auto,
                client,
                cache,
                cache_path,
                contact_email,
            })
        }

        #[cfg(target_arch = "wasm32")]
        {
            let _ = cache_path;
            let _ = contact_email;
            Ok(Self {
                backend: Backend::Auto,
                cache,
            })
        }
    }

    /// Définit le backend actif.
    pub fn with_backend(mut self, backend: Backend) -> Self {
        self.backend = backend;
        self
    }

    fn cache_key(source: &str, target: &str, text: &str) -> String {
        let mut h = Sha256::new();
        h.update(source.as_bytes());
        h.update(b":");
        h.update(target.as_bytes());
        h.update(b":");
        h.update(text.as_bytes());
        hex::encode(h.finalize())
    }

    /// Détecte si le texte contient des caractères japonais (Kanji, Hiragana, Katakana).
    pub fn is_japanese(text: &str) -> bool {
        aphrody_translate_core::is_japanese(text)
    }

    /// Traduit un texte vers le français (source japonaise détectée, sinon anglaise).
    pub async fn translate(&self, text: &str) -> Result<String> {
        let stripped = text.trim();
        if stripped.is_empty() {
            return Ok(String::new());
        }

        if Self::is_japanese(stripped) {
            self.translate_with_lang(stripped, "ja", "fr").await
        } else {
            self.translate_with_lang(stripped, "en", "fr").await
        }
    }

    /// Traduit un texte en spécifiant la langue source et cible.
    pub async fn translate_with_lang(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String> {
        match self.translate_with_lang_strict(text, source, target).await {
            Ok(translated) => Ok(translated),
            Err(error) => {
                warn!(%error, "échec cascade traduction, conservation texte original");
                Ok(text.trim().to_owned())
            }
        }
    }

    /// Translation for API consumers: backend failures remain failures.
    /// The source text is never substituted for a failed translation.
    pub async fn translate_with_lang_strict(
        &self,
        text: &str,
        source: &str,
        target: &str,
    ) -> Result<String> {
        let stripped = text.trim();
        if stripped.is_empty() {
            return Ok(String::new());
        }

        // Vérification en cache mémoire
        let key = Self::cache_key(source, target, stripped);
        if let Some(hit) = self.cache.get(&key) {
            return Ok(hit.clone());
        }

        #[cfg(target_arch = "wasm32")]
        {
            anyhow::bail!("translation backends are unavailable on this WebAssembly target");
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let res = match self.backend {
                Backend::WebGoogle => {
                    match self.translate_web_google(stripped, source, target).await {
                        Ok(tr) => Ok(tr),
                        Err(_) => self.translate_google_rpc(stripped, source, target).await,
                    }
                }
                Backend::GoogleRpc => self.translate_google_rpc(stripped, source, target).await,
                Backend::MyMemory => self.translate_mymemory(stripped, source, target).await,
                Backend::Auto => {
                    // 1. Tente Aphrody Web Google Translate
                    match self.translate_web_google(stripped, source, target).await {
                        Ok(tr) if !tr.trim().is_empty() => Ok(tr),
                        _ => {
                            // 2. Repli immédiat sur Google RPC natif
                            match self.translate_google_rpc(stripped, source, target).await {
                                Ok(tr) if !tr.trim().is_empty() => Ok(tr),
                                _ => {
                                    // 3. Repli ultime MyMemory
                                    self.translate_mymemory(stripped, source, target).await
                                }
                            }
                        }
                    }
                }
            };

            match res {
                Ok(translated) => {
                    let final_res = translated.trim().to_string();
                    if !final_res.is_empty() {
                        self.cache.insert(key, final_res.clone());
                    }
                    if final_res.is_empty() {
                        anyhow::bail!("translation backend returned an empty response");
                    }
                    Ok(final_res)
                }
                Err(error) => Err(error),
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_google_rpc(&self, text: &str, source: &str, target: &str) -> Result<String> {
        let url = format!(
            "{}?client=gtx&sl={}&tl={}&dt=t&q={}",
            GOOGLE_RPC_ENDPOINT,
            source,
            target,
            urlencoding::encode(text)
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("google rpc request")?;
        if !resp.status().is_success() {
            anyhow::bail!("google rpc HTTP {}", resp.status());
        }

        let body: serde_json::Value = resp.json().await.context("google rpc json parse")?;
        if let Some(arr) = body.get(0).and_then(|v| v.as_array()) {
            let mut out = String::new();
            for item in arr {
                if let Some(chunk) = item.get(0).and_then(|v| v.as_str()) {
                    out.push_str(chunk);
                }
            }
            if !out.is_empty() {
                return Ok(out);
            }
        }

        anyhow::bail!("google rpc format inattendu")
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_web_google(&self, text: &str, source: &str, target: &str) -> Result<String> {
        // Adaptateur Web fourni explicitement ; sans lui, Auto replie sur RPC.
        let web_cmd =
            std::env::var("APHRODY_WEB_GOOGLE_BIN").context("APHRODY_WEB_GOOGLE_BIN absent")?;

        let mut cmd = tokio::process::Command::new(&web_cmd).no_window();
        cmd.args([
            "google",
            "translate",
            text,
            "--target",
            target,
            "--source",
            source,
        ]);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Do not revive a second Bun runtime through machine-specific
        // paths; callers already fall back to the native Google RPC backend.
        let output = cmd
            .output()
            .await
            .with_context(|| format!("spawn Web Google adapter {web_cmd}"))?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Nettoyage des lignes de progression [google] ou [recon]
            let cleaned: Vec<&str> = stdout
                .lines()
                .filter(|l| !l.starts_with('[') && !l.trim().is_empty())
                .collect();
            let res = cleaned.join("\n").trim().to_string();
            if !res.is_empty() {
                return Ok(res);
            }
        }

        anyhow::bail!("Web Google adapter: sortie vide ou échec")
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn translate_mymemory(&self, text: &str, source: &str, target: &str) -> Result<String> {
        let mut url = format!(
            "{}?q={}&langpair={}|{}",
            MYMEMORY_ENDPOINT,
            urlencoding::encode(text),
            source,
            target
        );
        if let Some(mail) = &self.contact_email {
            url.push_str(&format!("&de={}", urlencoding::encode(mail)));
        }

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("mymemory request")?;
        let parsed: MyMemoryResponse = resp.json().await.context("mymemory parse")?;
        if parsed.response_status == 200 {
            Ok(parsed.response_data.translated_text)
        } else {
            anyhow::bail!("mymemory HTTP status {}", parsed.response_status)
        }
    }

    /// Persiste le cache mémoire sur disque.
    #[cfg_attr(target_arch = "wasm32", allow(clippy::needless_return))]
    pub fn persist(&self) -> Result<()> {
        #[cfg(target_arch = "wasm32")]
        {
            return Ok(());
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut file = CacheFile::default();
            for r in self.cache.iter() {
                file.entries.insert(r.key().clone(), r.value().clone());
            }
            let raw = serde_json::to_string_pretty(&file)?;
            if let Some(parent) = self.cache_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            std::fs::write(&self.cache_path, raw).context("persist cache")?;
            Ok(())
        }
    }
}

pub fn default_cache_path(root: &Path) -> PathBuf {
    root.join(".aphrody-translate-cache.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[cfg(not(target_arch = "wasm32"))]
    async fn strict_translation_reports_backend_failure_without_caching_source_text() {
        let mut translator = Translator::new(PathBuf::new(), None)
            .expect("translator")
            .with_backend(Backend::GoogleRpc);
        // A refused loopback proxy prevents any external request during this test.
        translator.client = reqwest::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:0").expect("proxy"))
            .timeout(std::time::Duration::from_millis(100))
            .build()
            .expect("client");
        assert!(
            translator
                .translate_with_lang_strict("Hello", "en", "fr")
                .await
                .is_err()
        );
        assert!(translator.cache.is_empty());
        assert_eq!(
            translator
                .translate_with_lang("Hello", "en", "fr")
                .await
                .expect("fallback"),
            "Hello"
        );
        assert!(translator.cache.is_empty());
    }

    #[test]
    fn test_japanese_detection() {
        assert!(Translator::is_japanese("こんにちは"));
        assert!(Translator::is_japanese("孫悟空は界王拳を使った"));
        assert!(!Translator::is_japanese("Hello world"));
        assert!(!Translator::is_japanese("Bonjour tout le monde"));
    }

    #[test]
    fn test_backend_parsing() {
        assert_eq!(Backend::from_str_loose("web"), Backend::WebGoogle);
        assert_eq!(Backend::from_str_loose("web-google"), Backend::WebGoogle);
        assert_eq!(Backend::from_str_loose("google"), Backend::GoogleRpc);
        assert_eq!(Backend::from_str_loose("rpc"), Backend::GoogleRpc);
        assert_eq!(Backend::from_str_loose("mymemory"), Backend::MyMemory);
        assert_eq!(Backend::from_str_loose("auto"), Backend::Auto);
    }
}
