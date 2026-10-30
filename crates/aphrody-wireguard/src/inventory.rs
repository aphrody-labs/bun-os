// SPDX-License-Identifier: Apache-2.0
//! Declared private tunnel (`infra/config/host/wireguard/aphrody-tunnel.json`): hub, peers,
//! services and grants. Renders the `wg-quick` configuration of any member; private keys never
//! leave their host, so they are injected at apply time.

use std::path::Path;

use ipnet::IpNet;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::conf::{Config, Interface, Peer};
use crate::{Error, Key, Result};

/// Relative location of the declared tunnel in the Aphrody repository.
pub const INVENTORY_PATH: &str = "infra/config/host/wireguard/aphrody-tunnel.json";

/// The declared tunnel compiled into the binary, used when no checkout is at hand (an operator
/// PC running only the installed `aphrody`).
pub const EMBEDDED: &str = include_str!("../../../infra/config/host/wireguard/aphrody-tunnel.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hub {
    pub peer: String,
    pub address: String,
    pub endpoint: String,
    pub listen_port: u16,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub host: String,
    pub os: String,
    pub address: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub host: String,
    pub address: String,
    #[serde(default)]
    pub port: Option<u16>,
    pub proto: String,
    #[serde(default)]
    pub auth: Option<String>,
}

/// The declared tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub name: String,
    pub interface: String,
    pub windows_tunnel_name: String,
    pub subnet: String,
    pub client_allowed_ips: String,
    pub keepalive: u16,
    pub hub: Hub,
    pub peers: Vec<Member>,
    #[serde(default)]
    pub services: Vec<Service>,
    #[serde(default)]
    pub grants: std::collections::BTreeMap<String, Vec<String>>,
}

fn net(s: &str) -> Result<IpNet> {
    s.parse()
        .map_err(|_| Error::Config(format!("réseau invalide: {s}")))
}

fn host_net(addr: &str) -> Result<IpNet> {
    net(&format!("{addr}/32"))
}

impl Inventory {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| Error::Config(format!("{}: {e}", path.display())))?;
        Self::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Self> {
        serde_json::from_str(text).map_err(|e| Error::Config(format!("inventaire: {e}")))
    }

    /// The compiled-in copy of the declared tunnel ([`EMBEDDED`]).
    pub fn embedded() -> Result<Self> {
        Self::parse(EMBEDDED)
    }

    /// The declared tunnel of the checkout `root` when it holds one, else the embedded copy.
    pub fn discover(root: Option<&Path>) -> Result<Self> {
        match root.map(|r| r.join(INVENTORY_PATH)) {
            Some(path) if path.is_file() => Self::load(&path),
            _ => Self::embedded(),
        }
    }

    /// Member id (hub included) owning a tunnel address.
    #[must_use]
    pub fn id_of_address(&self, address: &str) -> Option<&str> {
        if self.hub.address == address {
            return Some(&self.hub.peer);
        }
        self.peers
            .iter()
            .find(|p| p.address == address)
            .map(|p| p.id.as_str())
    }

    /// Services listening on a member, matched by tunnel address.
    #[must_use]
    pub fn services_of(&self, id: &str) -> Vec<&Service> {
        let Some(address) = self.address_of(id) else {
            return Vec::new();
        };
        self.services
            .iter()
            .filter(|s| s.address == address)
            .collect()
    }

    /// Ids of every member, hub first.
    #[must_use]
    pub fn ids(&self) -> Vec<String> {
        std::iter::once(self.hub.peer.clone())
            .chain(self.peers.iter().map(|p| p.id.clone()))
            .collect()
    }

    fn prefix(&self) -> Result<u8> {
        Ok(net(&self.subnet)?.prefix_len())
    }

    /// Render the configuration of `id` (hub or peer). `private_key` is the member's own key,
    /// read on its host; `None` renders a template without `PrivateKey`.
    pub fn render(&self, id: &str, private_key: Option<Key>) -> Result<Config> {
        let prefix = self.prefix()?;
        if id == self.hub.peer {
            let mut peers = Vec::new();
            for m in &self.peers {
                let mut p = Peer::new(m.public_key.parse()?);
                p.allowed_ips.push(host_net(&m.address)?);
                peers.push(p);
            }
            return Ok(Config {
                interface: Interface {
                    private_key,
                    listen_port: Some(self.hub.listen_port),
                    addresses: vec![net(&format!("{}/{prefix}", self.hub.address))?],
                    ..Interface::default()
                },
                peers,
            });
        }
        let me = self.peers.iter().find(|p| p.id == id).ok_or_else(|| {
            Error::Config(format!(
                "pair inconnu: {id} (connus: {})",
                self.ids().join(", ")
            ))
        })?;
        let mut hub = Peer::new(self.hub.public_key.parse()?);
        hub.endpoint = Some(self.hub.endpoint.clone());
        hub.persistent_keepalive = Some(self.keepalive);
        for a in self
            .client_allowed_ips
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            hub.allowed_ips.push(net(a)?);
        }
        Ok(Config {
            interface: Interface {
                private_key,
                addresses: vec![net(&format!("{}/{prefix}", me.address))?],
                ..Interface::default()
            },
            peers: vec![hub],
        })
    }

    /// Address of a member id (hub included).
    #[must_use]
    pub fn address_of(&self, id: &str) -> Option<&str> {
        if id == self.hub.peer {
            return Some(&self.hub.address);
        }
        self.peers
            .iter()
            .find(|p| p.id == id)
            .map(|p| p.address.as_str())
    }

    /// Services granted to `id`, with their tunnel address.
    #[must_use]
    pub fn reachable(&self, id: &str) -> Vec<&Service> {
        let granted = self.grants.get(id).cloned().unwrap_or_default();
        self.services
            .iter()
            .filter(|s| granted.contains(&s.id))
            .collect()
    }

    /// Read-only summary (no key material beyond public keys).
    #[must_use]
    pub fn plan(&self) -> Value {
        json!({
            "name": self.name,
            "interface": self.interface,
            "windowsTunnelName": self.windows_tunnel_name,
            "subnet": self.subnet,
            "hub": { "id": self.hub.peer, "address": self.hub.address, "endpoint": self.hub.endpoint },
            "members": self.peers.iter().map(|p| json!({
                "id": p.id, "os": p.os, "address": p.address,
                "services": self.reachable(&p.id).iter().map(|s| format!("{}:{}", s.address, s.port.map_or("*".into(), |p| p.to_string()))).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_inventory() -> Inventory {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(INVENTORY_PATH);
        Inventory::load(&path).unwrap()
    }

    #[test]
    fn embedded_copy_matches_repository_and_resolves_services() {
        let repo = repo_inventory();
        let embedded = Inventory::embedded().unwrap();
        assert_eq!(embedded.ids(), repo.ids());
        assert_eq!(embedded.id_of_address("10.200.77.10"), Some("omar"));
        assert_eq!(
            embedded.id_of_address(&embedded.hub.address.clone()),
            Some("vps")
        );
        let omar: Vec<_> = embedded
            .services_of("omar")
            .iter()
            .map(|s| s.id.clone())
            .collect();
        assert!(omar.contains(&"vnc-omar".to_owned()), "{omar:?}");
        let vps: Vec<_> = embedded
            .reachable("vps")
            .iter()
            .map(|s| s.id.clone())
            .collect();
        assert!(
            vps.contains(&"device-portal-aphro-pc".to_owned()),
            "{vps:?}"
        );
        assert!(Inventory::discover(Some(Path::new("/nonexistent"))).is_ok());
    }

    #[test]
    fn renders_hub_and_spokes_from_repository_inventory() {
        let inv = repo_inventory();
        let hub = inv.render(&inv.hub.peer.clone(), None).unwrap();
        assert_eq!(hub.interface.listen_port, Some(inv.hub.listen_port));
        assert_eq!(hub.peers.len(), inv.peers.len());
        assert!(
            hub.peers
                .iter()
                .all(|p| p.allowed_ips[0].prefix_len() == 32)
        );
        for id in inv.peers.iter().map(|p| p.id.clone()) {
            let cfg = inv
                .render(&id, Some(Key::generate_private().unwrap()))
                .unwrap();
            assert_eq!(cfg.peers.len(), 1);
            assert_eq!(cfg.peers[0].persistent_keepalive, Some(inv.keepalive));
            assert_eq!(Config::parse(&cfg.render()).unwrap(), cfg);
        }
        assert!(inv.render("nope", None).is_err());
        assert!(
            inv.plan()["members"]
                .as_array()
                .is_some_and(|m| !m.is_empty())
        );
    }
}
