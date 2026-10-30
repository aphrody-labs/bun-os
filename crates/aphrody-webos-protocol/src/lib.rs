// SPDX-License-Identifier: Apache-2.0
//! The wire contract of aphrody.com (docs/webos/ARCHITECTURE.md, ADR-003). Every message between the Rust server
//! (`aphrody-webos-server`) and the Rust wasm client (`aphrody-webos-client`) is a type of this crate, serialized as
//! JSON with serde. Bump [`PROTOCOL_VERSION`] on any incompatible change.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

/// Operating systems a session can run (ADR-003, owner update 2026-10-30).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OsId {
    /// Pop!_OS with the full COSMIC desktop (cosmic-comp).
    PopOs,
    /// Redox OS, the pure-Rust operating system, under QEMU in its container.
    Redox,
    Android,
    Wine,
    Proton,
}

impl OsId {
    pub const ALL: [OsId; 5] = [
        OsId::PopOs,
        OsId::Redox,
        OsId::Android,
        OsId::Wine,
        OsId::Proton,
    ];

    pub fn name(self) -> &'static str {
        match self {
            OsId::PopOs => "Pop!_OS",
            OsId::Redox => "Redox OS",
            OsId::Android => "Android",
            OsId::Wine => "Wine",
            OsId::Proton => "Proton",
        }
    }

    pub fn summary(self) -> &'static str {
        match self {
            OsId::PopOs => "Pop!_OS with the COSMIC desktop, written in Rust by System76.",
            OsId::Redox => "Redox OS, a Unix-like operating system written entirely in Rust.",
            OsId::Android => "Android in a container, with the Bun OS app catalog.",
            OsId::Wine => "Windows applications on Wine.",
            OsId::Proton => "Windows games on Proton, with gamepad support.",
        }
    }
}

/// One entry of `GET /api/os`: whether the host can start that OS now.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct OsEntry {
    pub id: OsId,
    pub name: String,
    pub summary: String,
    pub available: bool,
    /// Why it is not available (image not built, host capacity), shown to the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
}

/// `POST /api/sessions` body.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StartSession {
    pub os: OsId,
    pub width: u32,
    pub height: u32,
}

/// A session as returned by `POST /api/sessions` and `GET /api/sessions/{id}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub os: OsId,
    pub state: SessionState,
    /// Bearer token for the stream endpoints of this session only.
    pub token: String,
    /// WebSocket path of the stream (signalling for WebRTC, frames for the fallback).
    pub stream: String,
}

/// WebRTC signalling over the stream WebSocket.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Signal {
    Offer {
        sdp: String,
    },
    Answer {
        sdp: String,
    },
    Ice {
        candidate: String,
        mid: Option<String>,
        index: Option<u16>,
    },
}

/// Full gamepad snapshot in the W3C standard mapping, sent whole (not deltas) so a lost message heals itself.
/// Buttons 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT (analog 0..1), 8 Back, 9 Start, 10 LS, 11 RS,
/// 12..15 D-pad up/down/left/right, 16 Guide. Axes LX, LY, RX, RY in -1..1. The session maps each pad to a uinput
/// Xbox 360 device.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GamepadState {
    /// Slot 0..=3.
    pub pad: u8,
    pub connected: bool,
    pub buttons: [f32; 17],
    pub axes: [f32; 4],
}

/// Client to server input, on the data channel or the WebSocket.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum Input {
    /// Absolute position in stream pixels; `buttons` is the DOM `buttons` bit mask.
    Pointer {
        x: f32,
        y: f32,
        buttons: u8,
    },
    Wheel {
        dx: f32,
        dy: f32,
    },
    /// DOM `code` (physical key) plus the produced `key`, so the server can map layouts.
    Key {
        code: String,
        key: String,
        down: bool,
    },
    Clipboard {
        text: String,
    },
    Resize {
        width: u32,
        height: u32,
    },
    Gamepad(GamepadState),
}

/// Server to client events on the stream WebSocket.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "kebab-case")]
pub enum ServerEvent {
    State { state: SessionState },
    Clipboard { text: String },
    Signal(Signal),
    Error { message: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HealthCheck {
    pub ok: bool,
    /// Optional checks are reported without making the service unhealthy.
    #[serde(default)]
    pub optional: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// `GET /api/health`: HTTP 200 when every required check is ok, 503 otherwise. The deploy activator gates on it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub service: String,
    pub version: String,
    pub protocol: u32,
    #[serde(rename = "sourceCommit")]
    pub source_commit: Option<String>,
    #[serde(rename = "uptimeSeconds")]
    pub uptime_seconds: u64,
    pub checks: std::collections::BTreeMap<String, HealthCheck>,
}

/// Error body of every failing API call.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ApiError {
    pub error: String,
}
