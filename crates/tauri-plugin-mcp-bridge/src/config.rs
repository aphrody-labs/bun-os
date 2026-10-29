//! Configuration for the MCP Bridge plugin.
//!
//! This module provides configuration options for customizing the plugin behavior,
//! including the WebSocket server bind address.

use std::net::SocketAddr;
use std::sync::Arc;

/// Callback invoked once with the address the WebSocket server actually bound to.
///
/// Aphrody patch: lets a host publish the real (possibly ephemeral) port, for example in a
/// discovery file, without scanning ports.
#[derive(Clone)]
pub struct ListenHook(pub Arc<dyn Fn(SocketAddr) + Send + Sync>);

impl std::fmt::Debug for ListenHook {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ListenHook(..)")
    }
}

/// Configuration for the MCP Bridge plugin.
#[derive(Clone, Debug)]
pub struct Config {
    /// The address to bind the WebSocket server to.
    /// Aphrody patch: default "127.0.0.1" (loopback only; upstream defaulted to "0.0.0.0").
    pub bind_address: String,
    /// The base port for the WebSocket server.
    /// Default: 9223. The plugin will scan up to 100 ports from this base.
    /// Aphrody patch: `0` binds an ephemeral port chosen by the OS.
    pub base_port: u16,
    /// Aphrody patch: shared secret every client must present, either as the `token` query
    /// parameter of the WebSocket URL or as `Authorization: Bearer <token>`. `None` disables
    /// the check; Host and Origin checks always apply.
    pub token: Option<String>,
    /// Aphrody patch: called once with the bound address.
    pub on_listen: Option<ListenHook>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind_address: "127.0.0.1".to_string(),
            base_port: 9223,
            token: None,
            on_listen: None,
        }
    }
}

impl Config {
    /// Creates a new configuration with the specified bind address.
    pub fn new(bind_address: &str) -> Self {
        Self {
            bind_address: bind_address.to_string(),
            ..Self::default()
        }
    }

    /// Creates a configuration that binds to localhost only.
    pub fn localhost_only() -> Self {
        Self::default()
    }
}

/// Builder for creating a configured MCP Bridge plugin.
///
/// # Examples
///
/// ```rust,ignore
/// use tauri_plugin_mcp_bridge::Builder;
///
/// // Default: binds to 0.0.0.0 (all interfaces)
/// let plugin: tauri::plugin::TauriPlugin<tauri::Wry> = Builder::new().build();
///
/// // Localhost only:
/// let plugin: tauri::plugin::TauriPlugin<tauri::Wry> = Builder::new()
///     .bind_address("127.0.0.1")
///     .build();
/// ```
pub struct Builder {
    config: Config,
}

impl Default for Builder {
    fn default() -> Self {
        Self::new()
    }
}

impl Builder {
    /// Creates a new builder with default configuration.
    pub fn new() -> Self {
        Self {
            config: Config::default(),
        }
    }

    /// Sets the bind address for the WebSocket server.
    ///
    /// # Arguments
    ///
    /// * `addr` - The address to bind to (e.g., "0.0.0.0" or "127.0.0.1")
    ///
    /// # Examples
    ///
    /// ```rust
    /// use tauri_plugin_mcp_bridge::Builder;
    ///
    /// let builder = Builder::new().bind_address("127.0.0.1");
    /// ```
    pub fn bind_address(mut self, addr: &str) -> Self {
        self.config.bind_address = addr.to_string();
        self
    }

    /// Sets the base port for the WebSocket server.
    ///
    /// The plugin will scan up to 100 ports starting from this base port.
    ///
    /// # Arguments
    ///
    /// * `port` - The base port number (e.g., 9223)
    ///
    /// # Examples
    ///
    /// ```rust
    /// use tauri_plugin_mcp_bridge::Builder;
    ///
    /// let builder = Builder::new().base_port(9323);
    /// ```
    pub fn base_port(mut self, port: u16) -> Self {
        self.config.base_port = port;
        self
    }

    /// Aphrody patch: requires clients to present this token (query `token=` or bearer header).
    pub fn token(mut self, token: &str) -> Self {
        self.config.token = Some(token.to_string());
        self
    }

    /// Aphrody patch: registers a callback that receives the bound socket address.
    pub fn on_listen(mut self, hook: impl Fn(SocketAddr) + Send + Sync + 'static) -> Self {
        self.config.on_listen = Some(ListenHook(Arc::new(hook)));
        self
    }

    /// Builds the plugin with the configured options.
    pub fn build<R: tauri::Runtime>(self) -> tauri::plugin::TauriPlugin<R> {
        crate::init_with_config(self.config)
    }
}
