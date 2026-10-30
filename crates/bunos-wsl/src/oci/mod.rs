//! OCI (Open Container Initiative) image handling
//!
//! Native implementation for pulling container images from registries
//! without requiring Docker or Podman.

mod image;
mod registry;
mod types;

pub use image::pull_and_create_rootfs;
pub use types::{ImageReference, ProgressCallback};
