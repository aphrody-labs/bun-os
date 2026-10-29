// SPDX-License-Identifier: Apache-2.0
//! The canonical `APHRODY_AI_*` environment contract.
//!
//! Single source of truth for the canonical environment variable names that
//! name aphrody's local/open-source AI stack (binaries, the `aphrody-ai-http`
//! gateway, chat/code/reasoning/small, vision, OCR, STT, embed, rerank). This
//! mirrors `tools/aphrody/config/local-ai.json` (owned by `aphrody-infra`;
//! that file's `modelAuthority` names this repository, and this module, as
//! the source). A rename or a new alias is a one-file change here rather than
//! a private literal drifting in each consumer (CLAUDE.md: "a tool that
//! compiles is not a tool that is wired").
//!
//! Every call site in this workspace that used to read
//! `std::env::var("APHRODY_RAG_EMBED_ENDPOINT")` (or hardcode a fallback
//! such as `http://127.0.0.1:8080`) goes through [`CanonicalEnv::resolve`]
//! instead, so the precedence (`resolution.precedence` in the contract:
//! canonical name, then each alias in the order listed) is enforced in one
//! place.
//!
//! `aphrody ai env` (the CLI's `crates/aphrody/src/ai_env_cmd.rs`) is the one
//! writer of these names: it resolves the current machine's values and
//! writes them to `~/.aphrody/ai/local-ai.{json,env}`, always using the
//! canonical name, never an alias.
//!
//! # Example
//!
//! ```
//! use aphrody_config::ai_env::EMBED_MODEL;
//!
//! // No environment variable set: nothing resolves.
//! assert_eq!(EMBED_MODEL.resolve_with(&|_| None), None);
//!
//! // A legacy alias still works.
//! assert_eq!(
//!     EMBED_MODEL.resolve_with(&|name| {
//!         (name == "APHRODY_RAG_EMBED_MODEL").then(|| "qwen3-embedding-0.6b".to_owned())
//!     }),
//!     Some("qwen3-embedding-0.6b".to_owned())
//! );
//! ```

/// One canonical environment variable name plus the legacy aliases a reader
/// still honours, most-specific (closest to this exact capability) first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanonicalEnv {
    /// The name every writer emits (`aphrody ai env`, `.env.example`, docs).
    pub canonical: &'static str,
    /// Legacy names a reader still accepts, in the order they are tried.
    pub aliases: &'static [&'static str],
}

impl CanonicalEnv {
    /// Read the process environment: [`Self::canonical`], then each of
    /// [`Self::aliases`] in order. A blank value counts as unset, matching
    /// [`aphrody_models::LocalRole::resolve`]'s treatment of blank overrides.
    #[must_use]
    pub fn resolve(&self) -> Option<String> {
        self.resolve_with(&|name| std::env::var(name).ok())
    }

    /// [`Self::resolve`] with the environment lookup injected, so tests never
    /// mutate the real process environment (this crate forbids `unsafe`, and
    /// `std::env::set_var` requires it as of the 2024 edition).
    #[must_use]
    pub fn resolve_with(&self, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
        let read = |name: &str| env(name).filter(|value| !value.trim().is_empty());
        read(self.canonical).or_else(|| self.aliases.iter().find_map(|alias| read(alias)))
    }

    /// Which name actually supplied the resolved value (for `aphrody ai env`
    /// notes and `aphrody doctor` diagnostics). `None` when nothing is set.
    #[must_use]
    pub fn resolve_source(&self) -> Option<&'static str> {
        self.resolve_source_with(&|name| std::env::var(name).ok())
    }

    /// [`Self::resolve_source`] with the environment lookup injected.
    #[must_use]
    pub fn resolve_source_with(
        &self,
        env: &dyn Fn(&str) -> Option<String>,
    ) -> Option<&'static str> {
        let set = |name: &str| env(name).is_some_and(|value| !value.trim().is_empty());
        if set(self.canonical) {
            return Some(self.canonical);
        }
        self.aliases.iter().copied().find(|alias| set(alias))
    }
}

/// `binaries.aphrody` — the `aphrody` executable itself.
pub const BIN: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_BIN",
    aliases: &[],
};

/// `binaries.aphrody-mcp` — the `aphrody-mcp` executable.
pub const MCP_BIN: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_MCP_BIN",
    aliases: &["APHRODY_MCP_BIN"],
};

/// `gateways.ai-http` — the `aphrody-ai-http` REST gateway origin.
pub const HTTP_URL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_HTTP_URL",
    aliases: &[],
};

/// `gateways.ai-http` — the bearer token for [`HTTP_URL`]. Never write the
/// resolved value anywhere a secret should not go; this contract exists to
/// name where it lives, not to move it.
pub const HTTP_TOKEN: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_HTTP_TOKEN",
    aliases: &[],
};

/// `capabilities.chat` — the managed llama-server base URL (`.../v1`), also
/// the base for [`CODE_MODEL`], [`REASONING_MODEL`] and [`SMALL_MODEL`]
/// (`baseUrlFrom: "chat"` in the contract: one instance, several roles).
pub const CHAT_BASE_URL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_CHAT_BASE_URL",
    aliases: &["APHRODY_OSS_BASE_URL", "APHRODY_LOCAL_MODEL_URL"],
};

/// `capabilities.chat` — the model id served at [`CHAT_BASE_URL`].
pub const CHAT_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_CHAT_MODEL",
    aliases: &["APHRODY_LLM_MODEL"],
};

/// Bearer credential for the configured chat upstream only. This is distinct
/// from [`HTTP_TOKEN`], which authenticates callers of the Aphrody gateway.
/// Keep the value in the host's protected environment store, never in a provider table.
pub const CHAT_API_KEY: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_CHAT_API_KEY",
    aliases: &["APHRODY_AI_CHAT_TOKEN", "VLLM_API_KEY"],
};

/// `capabilities.code` — model id; base URL is [`CHAT_BASE_URL`].
pub const CODE_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_CODE_MODEL",
    aliases: &[],
};

/// `capabilities.reasoning` — model id; base URL is [`CHAT_BASE_URL`].
pub const REASONING_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_REASONING_MODEL",
    aliases: &[],
};

/// `capabilities.small` — model id; base URL is [`CHAT_BASE_URL`].
pub const SMALL_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_SMALL_MODEL",
    aliases: &[],
};

/// `capabilities.vision` — base URL of the visual-transcription endpoint.
pub const VISION_BASE_URL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_VISION_BASE_URL",
    aliases: &[],
};

/// `capabilities.vision` — the model id served at [`VISION_BASE_URL`].
pub const VISION_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_VISION_MODEL",
    aliases: &[],
};

/// `capabilities.ocr` — the model id `aphrody ocr` runs by default.
pub const OCR_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_OCR_MODEL",
    aliases: &[],
};

/// `capabilities.stt` — the model id `aphrody_transcribe` runs by default.
pub const STT_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_STT_MODEL",
    aliases: &[],
};

/// `capabilities.embed` — base URL of the `/v1/embeddings` endpoint. The
/// default model is for *new* local indexes only: querying an existing index
/// uses that index's own model and dimensions (embedding spaces never mix,
/// CLAUDE.md §7).
pub const EMBED_BASE_URL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_EMBED_BASE_URL",
    aliases: &["EMBED_URL", "APHRODY_RAG_EMBED_ENDPOINT"],
};

/// `capabilities.embed` — the model id served at [`EMBED_BASE_URL`].
pub const EMBED_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_EMBED_MODEL",
    aliases: &["APHRODY_RAG_EMBED_MODEL"],
};

/// `capabilities.embed` — vector width of [`EMBED_MODEL`]. An override that
/// disagrees with the catalog's dimension for the resolved model is an error,
/// never a silent choice (CLAUDE.md §7, "embedding spaces must never mix").
pub const EMBED_DIMENSIONS: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_EMBED_DIMENSIONS",
    aliases: &["APHRODY_RAG_EMBED_DIM"],
};

/// `capabilities.rerank` — base URL of the `/v1/rerank` endpoint.
pub const RERANK_BASE_URL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_RERANK_BASE_URL",
    aliases: &["RERANK_URL", "APHRODY_RAG_RERANK_ENDPOINT"],
};

/// `capabilities.rerank` — the model id served at [`RERANK_BASE_URL`].
pub const RERANK_MODEL: CanonicalEnv = CanonicalEnv {
    canonical: "APHRODY_AI_RERANK_MODEL",
    aliases: &["APHRODY_RAG_RERANK_MODEL"],
};

/// Every canonical variable, in the order `tools/aphrody/config/local-ai.json`
/// lists its `binaries` / `gateways` / `capabilities` sections. `aphrody ai
/// env` writes exactly these names, and only these.
pub const ALL: [CanonicalEnv; 19] = [
    BIN,
    MCP_BIN,
    HTTP_URL,
    HTTP_TOKEN,
    CHAT_BASE_URL,
    CHAT_MODEL,
    CHAT_API_KEY,
    CODE_MODEL,
    REASONING_MODEL,
    SMALL_MODEL,
    VISION_BASE_URL,
    VISION_MODEL,
    OCR_MODEL,
    STT_MODEL,
    EMBED_BASE_URL,
    EMBED_MODEL,
    EMBED_DIMENSIONS,
    RERANK_BASE_URL,
    RERANK_MODEL,
];

#[cfg(test)]
#[path = "ai_env_tests.rs"]
mod ai_env_tests;
