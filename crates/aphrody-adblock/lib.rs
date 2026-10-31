//! `adblock-rust` is the engine powering Brave's native adblocker, available as a library for
//! anyone to use. It features:
//!
//! - Network blocking
//! - Cosmetic filtering
//! - Resource replacements
//! - Hosts syntax
//! - uBlock Origin syntax extensions
//! - iOS content-blocking syntax conversion
//! - Compiling to native code or WASM
//! - Rust bindings ([crates](https://crates.io/crates/adblock))
//! - JS bindings ([npm](https://npmjs.com/adblock-rs))
//! - Community-maintained Python bindings ([pypi](https://pypi.org/project/adblock/))
//! - High performance!
//!
//! Check the [`Engine`] documentation to get started with adblocking.

// Absorbed from Brave adblock-rust: upstream visibility, std collections and std I/O are kept verbatim.
#![allow(
    unreachable_pub,
    clippy::needless_pass_by_value,
    clippy::trivially_copy_pass_by_ref,
    clippy::undocumented_unsafe_blocks,
    clippy::derive_partial_eq_without_eq,
    clippy::or_fun_call,
    clippy::box_collection,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros,
    dead_code
)]

extern crate alloc;

// Own modules, currently everything is exposed, will need to limit
pub mod blocker;
#[cfg(feature = "content-blocking")]
pub mod content_blocking;
pub mod cosmetic_filter_cache;
mod cosmetic_filter_cache_builder;
mod cosmetic_filter_utils;
mod data_format;
pub mod engine;
pub mod filters;
mod flatbuffers;
pub mod lists;
mod network_filter_list;
mod optimizer;
pub mod regex_manager;
pub mod request;
pub mod resources;
pub mod sourcemap;
pub mod url_parser;

#[doc(hidden)]
pub mod utils;

#[doc(inline)]
pub use engine::Engine;
#[doc(inline)]
pub use lists::FilterSet;

#[cfg(test)]
mod sync_tests {
    #[allow(unused)]
    fn static_assert_sync<S: Sync>() {
        let _ = core::marker::PhantomData::<S>;
    }

    #[test]
    #[cfg(not(feature = "single-thread"))]
    fn assert_engine_sync() {
        static_assert_sync::<crate::engine::Engine>();
    }
}
