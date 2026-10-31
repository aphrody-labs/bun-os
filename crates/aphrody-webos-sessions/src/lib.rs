// SPDX-License-Identifier: Apache-2.0
//! Per-user Bun OS sessions (ADR-003): one container of the unified image (`bunos-unified`) per signed-in
//! user, created over the Docker Engine API, never with a published port. The aphrody.com server owns the
//! public routes and the client tokens; it asks this manager for a user's session and bridges the client
//! WebSocket to [`Backend::url`] with [`Backend::token`] (the `aphrody-remote-desktop` gateway inside the
//! container, wire translated by the server).
//!
//! Container contract (factory/images/bunos-unified, integrator agreement 2026-10-30):
//! entrypoint `/usr/bin/bunos-unified-session` reads `BUNOS_SESSION_SIZE=WxH` and
//! `APHRODY_REMOTE_TOKEN_FILE=/run/secrets/session.token`, runs cage headless with cosmic-comp nested and the
//! gateway on `0.0.0.0:8794`, home `/home/aphrody` on volume `aphrody-home-<user>`, Waydroid images read-only
//! at `/usr/share/bunos/waydroid/images`. Hardening: read-only rootfs plus tmpfs mounts, every capability dropped but
//! the set LXC needs for the inner Android container, no-new-privileges, private cgroup namespace, pids and
//! CPU/memory limits, a dedicated bridge network without inter-container traffic.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use bollard::Docker;
use bollard::container::{
    Config, CreateContainerOptions, InspectContainerOptions, ListContainersOptions, RemoveContainerOptions,
    StartContainerOptions,
};
use bollard::models::{DeviceMapping, HostConfig, HostConfigCgroupnsModeEnum};
use bollard::network::{CreateNetworkOptions, InspectNetworkOptions};
use tokio::sync::Mutex;

pub use aphrody_webos_protocol::{SessionAvailability, SessionState, StartSession};

const GATEWAY_PORT: u16 = 8794;
const LABEL: &str = "aphrody.session";
const LABEL_USER: &str = "aphrody.user";

/// Limits and locations of the session containers.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    /// Image of the unified rootfs, e.g. `bunos-unified:latest`.
    pub image: String,
    /// Bridge network of the sessions (created with inter-container traffic disabled).
    pub network: String,
    /// Host directory of the per-session gateway tokens (bind-mounted read-only into each container).
    pub token_dir: PathBuf,
    /// Host directory of the Waydroid images (bind-mounted read-only), absent when Android is not provisioned.
    pub waydroid_images: Option<PathBuf>,
    pub cpus: f64,
    pub memory_bytes: i64,
    pub pids: i64,
    pub idle: Duration,
    pub ready_timeout: Duration,
}

impl SessionConfig {
    /// `WEBOS_SESSIONS_*` environment with defaults sized for the VPS (12 cores, 45 GB).
    pub fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let num = |k: &str, d: f64| var(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(d);
        let home = var("HOME").unwrap_or_else(|| "/home/ubuntu".into());
        SessionConfig {
            image: var("WEBOS_SESSIONS_IMAGE").unwrap_or_else(|| "bunos-unified:latest".into()),
            network: var("WEBOS_SESSIONS_NETWORK").unwrap_or_else(|| "aphrody-sessions".into()),
            token_dir: var("WEBOS_SESSIONS_TOKEN_DIR").unwrap_or_else(|| "/run/aphrody/sessions".into()).into(),
            waydroid_images: Some(
                var("WEBOS_SESSIONS_WAYDROID_IMAGES").unwrap_or_else(|| format!("{home}/.cache/bunos-waydroid/a17/images")).into(),
            )
            .filter(|p: &PathBuf| p.is_dir()),
            cpus: num("WEBOS_SESSIONS_CPUS", 6.0),
            memory_bytes: (num("WEBOS_SESSIONS_MEMORY_GB", 12.0) * 1024.0 * 1024.0 * 1024.0) as i64,
            pids: num("WEBOS_SESSIONS_PIDS", 8192.0) as i64,
            idle: Duration::from_secs(num("WEBOS_SESSIONS_IDLE_MINUTES", 30.0) as u64 * 60),
            ready_timeout: Duration::from_secs(num("WEBOS_SESSIONS_READY_SECONDS", 180.0) as u64),
        }
    }
}

/// Where the server bridges a session's stream.
#[derive(Debug, Clone)]
pub struct Backend {
    /// `ws://<container ip>:8794/ws` of the gateway inside the container.
    pub url: String,
    /// Gateway token of this container.
    pub token: String,
}

/// One user's session.
#[derive(Debug, Clone)]
pub struct Session {
    /// Container name, `aphrody-session-<user>`.
    pub id: String,
    pub user: String,
    pub state: SessionState,
    pub backend: Option<Backend>,
}

struct Entry {
    session: Session,
    last_seen: Instant,
}

/// The session manager. Cheap to clone.
#[derive(Clone)]
pub struct Sessions {
    docker: Docker,
    cfg: Arc<SessionConfig>,
    live: Arc<Mutex<HashMap<String, Entry>>>,
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("system randomness");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Lower-case `[a-z0-9-]` form of a user id for container and volume names.
pub fn user_slug(user: &str) -> Option<String> {
    let s: String = user
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect();
    (!s.is_empty()).then_some(s)
}

impl Sessions {
    /// Connect to the local Docker Engine, prepare the network and adopt running session containers.
    pub async fn connect(cfg: SessionConfig) -> Result<Self> {
        let docker = Docker::connect_with_local_defaults().context("cannot reach the Docker Engine")?;
        docker.ping().await.context("Docker Engine ping")?;
        tokio::fs::create_dir_all(&cfg.token_dir).await.with_context(|| format!("cannot create {}", cfg.token_dir.display()))?;
        set_mode(&cfg.token_dir, 0o700).await?;
        let me = Sessions { docker, cfg: Arc::new(cfg), live: Arc::new(Mutex::new(HashMap::new())) };
        me.ensure_network().await?;
        me.adopt().await?;
        let reaper = me.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                reaper.reap().await;
            }
        });
        Ok(me)
    }

    /// Whether sessions can start: the image exists locally.
    pub async fn availability(&self) -> SessionAvailability {
        match self.docker.inspect_image(&self.cfg.image).await {
            Ok(_) => SessionAvailability { available: true, reason: None },
            Err(_) => SessionAvailability {
                available: false,
                reason: Some("The Bun OS session image is not built on this host yet.".into()),
            },
        }
    }

    async fn ensure_network(&self) -> Result<()> {
        if self.docker.inspect_network(&self.cfg.network, None::<InspectNetworkOptions<String>>).await.is_ok() {
            return Ok(());
        }
        let mut options = HashMap::new();
        options.insert("com.docker.network.bridge.enable_icc".to_owned(), "false".to_owned());
        options.insert("com.docker.network.bridge.name".to_owned(), "aphrody-sess0".to_owned());
        self.docker
            .create_network(CreateNetworkOptions {
                name: self.cfg.network.clone(),
                driver: "bridge".to_owned(),
                options,
                ..Default::default()
            })
            .await
            .with_context(|| format!("cannot create network {}", self.cfg.network))?;
        Ok(())
    }

    /// Re-register session containers left running by a previous server process.
    async fn adopt(&self) -> Result<()> {
        let mut filters = HashMap::new();
        filters.insert("label".to_owned(), vec![format!("{LABEL}=1")]);
        let list = self
            .docker
            .list_containers(Some(ListContainersOptions::<String> { all: false, filters, ..Default::default() }))
            .await?;
        for c in list {
            let Some(user) = c.labels.as_ref().and_then(|l| l.get(LABEL_USER)).cloned() else { continue };
            let Some(name) = c.names.and_then(|n| n.first().map(|s| s.trim_start_matches('/').to_owned())) else { continue };
            let Ok(token) = tokio::fs::read_to_string(self.token_path(&name)).await else { continue };
            if let Ok(url) = self.gateway_url(&name).await {
                let session = Session {
                    id: name.clone(),
                    user,
                    state: SessionState::Running,
                    backend: Some(Backend { url, token: token.trim().to_owned() }),
                };
                self.live.lock().await.insert(name, Entry { session, last_seen: Instant::now() });
            }
        }
        Ok(())
    }

    fn token_path(&self, name: &str) -> PathBuf {
        self.cfg.token_dir.join(format!("{name}.token"))
    }

    async fn gateway_url(&self, name: &str) -> Result<String> {
        let info = self.docker.inspect_container(name, None::<InspectContainerOptions>).await?;
        let ip = info
            .network_settings
            .and_then(|n| n.networks)
            .and_then(|n| n.get(&self.cfg.network).and_then(|e| e.ip_address.clone()))
            .filter(|ip| !ip.is_empty())
            .context("session container has no address on the session network")?;
        Ok(format!("ws://{ip}:{GATEWAY_PORT}/ws"))
    }

    /// The user's session, started when absent. Returns once the gateway inside answers.
    pub async fn start(&self, user: &str, size: &StartSession) -> Result<Session> {
        let slug = user_slug(user).context("invalid user id")?;
        let name = format!("aphrody-session-{slug}");
        if let Some(e) = self.live.lock().await.get_mut(&name) {
            e.last_seen = Instant::now();
            if e.session.state == SessionState::Running {
                return Ok(e.session.clone());
            }
        }
        let _ = self
            .docker
            .remove_container(&name, Some(RemoveContainerOptions { force: true, ..Default::default() }))
            .await;
        let token = random_hex(32);
        let token_file = self.token_path(&name);
        tokio::fs::write(&token_file, &token).await?;
        set_mode(&token_file, 0o600).await?;

        let width = size.width.clamp(640, 3840);
        let height = size.height.clamp(480, 2160);
        let mut binds = vec![
            format!("aphrody-home-{slug}:/home/aphrody"),
            format!("{}:/run/secrets/session.token:ro", token_file.display()),
        ];
        if let Some(images) = &self.cfg.waydroid_images {
            binds.push(format!("{}:/usr/share/bunos/waydroid/images:ro", images.display()));
        }
        let tmpfs: HashMap<String, String> = [
            ("/run", "rw,exec,nosuid,size=512m"),
            ("/tmp", "rw,nosuid,size=4g"),
            ("/var/lib/waydroid", "rw,exec,size=1g"),
            ("/var/lib/misc", "rw,size=16m"),
            ("/var/log", "rw,size=256m"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
        let caps = [
            "SYS_ADMIN", "NET_ADMIN", "NET_RAW", "SETUID", "SETGID", "CHOWN", "DAC_OVERRIDE", "FOWNER", "KILL", "MKNOD",
            "SYS_CHROOT", "SETPCAP", "AUDIT_WRITE", "AUDIT_CONTROL", "SYS_NICE", "WAKE_ALARM", "BLOCK_SUSPEND", "SYS_PTRACE",
            "NET_BIND_SERVICE", "DAC_READ_SEARCH", "FSETID", "SYS_RESOURCE", "IPC_LOCK",
        ];
        let host = HostConfig {
            binds: Some(binds),
            tmpfs: Some(tmpfs),
            cap_drop: Some(vec!["ALL".to_owned()]),
            cap_add: Some(caps.iter().map(|c| (*c).to_owned()).collect()),
            security_opt: Some(vec![
                "apparmor=unconfined".to_owned(),
                "seccomp=unconfined".to_owned(),
                "no-new-privileges".to_owned(),
            ]),
            readonly_rootfs: Some(true),
            cgroupns_mode: Some(HostConfigCgroupnsModeEnum::PRIVATE),
            shm_size: Some(1024 * 1024 * 1024),
            nano_cpus: Some((self.cfg.cpus * 1e9) as i64),
            memory: Some(self.cfg.memory_bytes),
            pids_limit: Some(self.cfg.pids),
            network_mode: Some(self.cfg.network.clone()),
            devices: Some(host_devices()),
            device_cgroup_rules: Some(device_rules().await),
            sysctls: Some([("net.ipv4.ip_forward".to_owned(), "1".to_owned())].into_iter().collect()),
            ..Default::default()
        };
        let mut labels = HashMap::new();
        labels.insert(LABEL.to_owned(), "1".to_owned());
        labels.insert(LABEL_USER.to_owned(), user.to_owned());
        let config = Config {
            image: Some(self.cfg.image.clone()),
            hostname: Some("bunos".to_owned()),
            env: Some(vec![
                format!("BUNOS_SESSION_SIZE={width}x{height}"),
                "APHRODY_REMOTE_TOKEN_FILE=/run/secrets/session.token".to_owned(),
            ]),
            labels: Some(labels),
            host_config: Some(host),
            ..Default::default()
        };
        self.docker
            .create_container(Some(CreateContainerOptions { name: name.clone(), platform: None }), config)
            .await
            .with_context(|| format!("cannot create {name}"))?;
        let starting = Session { id: name.clone(), user: user.to_owned(), state: SessionState::Starting, backend: None };
        self.live.lock().await.insert(name.clone(), Entry { session: starting, last_seen: Instant::now() });
        self.docker.start_container(&name, None::<StartContainerOptions<String>>).await.with_context(|| format!("cannot start {name}"))?;

        let url = self.gateway_url(&name).await?;
        let health = url.replace("ws://", "").replace("/ws", "");
        let deadline = Instant::now() + self.cfg.ready_timeout;
        loop {
            if tokio::net::TcpStream::connect(&health).await.is_ok() {
                break;
            }
            if Instant::now() > deadline {
                let _ = self.stop(&name).await;
                bail!("the session did not become ready in {:?}", self.cfg.ready_timeout);
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        let session = Session {
            id: name.clone(),
            user: user.to_owned(),
            state: SessionState::Running,
            backend: Some(Backend { url, token }),
        };
        self.live.lock().await.insert(name, Entry { session: session.clone(), last_seen: Instant::now() });
        Ok(session)
    }

    /// The session `id`, if live.
    pub async fn get(&self, id: &str) -> Option<Session> {
        self.live.lock().await.get(id).map(|e| e.session.clone())
    }

    /// The live session of `user`.
    pub async fn for_user(&self, user: &str) -> Option<Session> {
        let name = format!("aphrody-session-{}", user_slug(user)?);
        self.get(&name).await
    }

    /// Mark activity (the stream bridge calls this on traffic) so the reaper keeps the session.
    pub async fn touch(&self, id: &str) {
        if let Some(e) = self.live.lock().await.get_mut(id) {
            e.last_seen = Instant::now();
        }
    }

    /// Stop and remove the session container; the home volume stays.
    pub async fn stop(&self, id: &str) -> Result<()> {
        self.live.lock().await.remove(id);
        let _ = tokio::fs::remove_file(self.token_path(id)).await;
        self.docker
            .remove_container(id, Some(RemoveContainerOptions { force: true, ..Default::default() }))
            .await
            .with_context(|| format!("cannot remove {id}"))?;
        Ok(())
    }

    async fn reap(&self) {
        let idle: Vec<String> = self
            .live
            .lock()
            .await
            .iter()
            .filter(|(_, e)| e.last_seen.elapsed() > self.cfg.idle)
            .map(|(k, _)| k.clone())
            .collect();
        for id in idle {
            let _ = self.stop(&id).await;
        }
    }
}

/// The whole DRI directory (minigbm falls back to the vkms card node, and host card numbers are dynamic) and loop
/// control (Waydroid image mounts), when the host has them.
fn host_devices() -> Vec<DeviceMapping> {
    ["/dev/dri", "/dev/loop-control"]
        .into_iter()
        .filter(|p| std::path::Path::new(p).exists())
        .map(|p| DeviceMapping {
            path_on_host: Some(p.to_owned()),
            path_in_container: Some(p.to_owned()),
            cgroup_permissions: Some("rwm".to_owned()),
        })
        .collect()
}

/// Loop block devices and the binder character major (read from /proc/devices) for the private binderfs.
async fn device_rules() -> Vec<String> {
    let mut rules = vec!["b 7:* rwm".to_owned()];
    if let Ok(devices) = tokio::fs::read_to_string("/proc/devices").await
        && let Some(major) = devices
            .lines()
            .filter_map(|l| l.trim().split_once(' '))
            .find(|(_, name)| *name == "binder")
            .map(|(major, _)| major.to_owned())
    {
        rules.push(format!("c {major}:* rwm"));
    }
    rules
}

#[cfg(unix)]
async fn set_mode(path: &std::path::Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn set_mode(_: &std::path::Path, _: u32) -> Result<()> {
    Ok(())
}
