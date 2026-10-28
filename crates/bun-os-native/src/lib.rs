//! `bun_native`: host hardware topology and monotonic clock probes.
//!
//! - [`NativePlatform`]: monotonic clock and host hardware topology ([`SystemTopology`]), probed
//!   from the operating system and, for CUDA, from the driver API loaded at run time.
//!
//! Llama and Whisper inference are owned by `aphrody-llama-server` and `aphrody-voice`.
//! This crate does not implement a C standard library.

// Std-only leaf crate outside the event loop (like `bun_host`).
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

mod cuda;
mod topology;

use std::{sync::OnceLock, time::Instant};

pub use topology::SystemTopology;

/// Monotonic time and host hardware discovery.
#[derive(Debug, Clone, Copy, Default)]
pub struct NativePlatform;


impl NativePlatform {
    /// Nanoseconds elapsed on the monotonic clock since a process-wide anchor.
    ///
    /// The anchor is taken on the first call, so the first value is close to zero; only
    /// differences between two readings are meaningful. The value never decreases and saturates
    /// at `u64::MAX` (after about 584 years).
    #[must_use]
    pub fn time_monotonic_ns() -> u64 {
        static ANCHOR: OnceLock<Instant> = OnceLock::new();
        let elapsed = ANCHOR.get_or_init(Instant::now).elapsed();
        u64::try_from(elapsed.as_nanos()).unwrap_or(u64::MAX)
    }

    /// Probes the host hardware topology (see [`SystemTopology::probe`]).
    #[must_use]
    pub fn get_topology() -> SystemTopology {
        SystemTopology::probe()
    }

    /// Status document including a fresh topology probe.
    #[must_use]
    pub fn status() -> serde_json::Value {
        serde_json::json!({
            "status": "ready",
            "clock": "monotonic",
            "topology": Self::get_topology(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monotonic_clock_never_decreases() {
        let mut previous = NativePlatform::time_monotonic_ns();
        for _ in 0..1_000 {
            let now = NativePlatform::time_monotonic_ns();
            assert!(now >= previous, "{now} < {previous}");
            previous = now;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(NativePlatform::time_monotonic_ns() > previous);
    }

    #[test]
    fn platform_status_embeds_probed_topology() {
        let status = NativePlatform::status();
        assert_eq!(status["status"], "ready");
        let topology: SystemTopology =
            serde_json::from_value(status["topology"].clone()).expect("topology document");
        assert!(topology.cpu_count >= 1);
        assert_eq!(topology.has_cuda, topology.cuda_device_count > 0);
    }
}
