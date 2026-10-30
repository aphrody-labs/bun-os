// SPDX-License-Identifier: Apache-2.0
//! The wire contract of aphrody.com (docs/webos/ARCHITECTURE.md, ADR-003). Every message between the Rust server
//! (`aphrody-webos-server`) and the Rust wasm client (`aphrody-webos-client`) is a type of this crate, serialized as
//! JSON with serde. Bump [`PROTOCOL_VERSION`] on any incompatible change.

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 2;

/// `GET /api/session`: whether this host can start a Bun OS desktop now. There is one session type (ADR-003): a
/// per-user container of the unified Bun OS image (COSMIC with Android inside it), streamed by the gateway. The
/// per-OS session types of the first draft (Pop!_OS, Redox, Android emulator, Wine, Proton) are retired.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionAvailability {
    pub available: bool,
    /// Why not, shown to the user.
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
    pub width: u32,
    pub height: u32,
}

/// A session as returned by `POST /api/sessions` and `GET /api/sessions/{id}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
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
    State {
        state: SessionState,
    },
    Clipboard {
        text: String,
    },
    Signal(Signal),
    Error {
        message: String,
    },
    /// The binary frames that follow are H.264 Annex B chunks framed as `[kind u8][pts u64 BE, µs][payload]`
    /// (kind 1 SPS/PPS config, 2 key frame, 3 delta) for a WebCodecs `VideoDecoder` configured with `codec`.
    Video {
        codec: String,
        width: u32,
        height: u32,
    },
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
