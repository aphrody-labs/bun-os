//! Generates runtime-loaded bindings for `bun_emu_host.h`. Every emulator core is its own plugin
//! library exporting the same symbols, so the bindings bind to a library chosen at run time
//! (`BunEmuHost::new(path)`) rather than linking one at build time.
use std::{env, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let root = manifest
        .join("../..")
        .canonicalize()
        .expect("workspace root");
    // A published crate cannot reach outside its directory: it builds from its own copy of the header,
    // refreshed from `packages/bun-emu-host` whenever the checkout is present.
    let header = manifest.join("include/bun_emu_host.h");
    let canonical = root.join("packages/bun-emu-host/include/bun_emu_host.h");
    println!("cargo:rerun-if-changed={}", canonical.display());
    println!("cargo:rerun-if-changed={}", header.display());
    if let Ok(bytes) = std::fs::read(&canonical)
        && std::fs::read(&header).ok().as_deref() != Some(bytes.as_slice())
    {
        std::fs::write(&header, bytes).expect("refresh the crate-local header");
    }
    println!("cargo:rerun-if-env-changed=BUN_EMU_HOST_DIR");
    let plugins = env::var("BUN_EMU_HOST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root.join("build/emu-host/bin"));
    // Default plugin directory baked into the crate (overridable at run time).
    println!(
        "cargo:rustc-env=BUN_EMU_HOST_DEFAULT_DIR={}",
        plugins.display()
    );
    println!("cargo:include={}", header.parent().unwrap().display());

    let bindings = bindgen::Builder::default()
        .header(header.to_string_lossy())
        .clang_arg("-DBUN_EMU_HOST_BUILD")
        .allowlist_function("bun_emu_.*")
        .allowlist_type("bun_emu.*")
        .allowlist_var("BUN_EMU_.*")
        .dynamic_library_name("BunEmuHost")
        .dynamic_link_require_all(true)
        .derive_default(true)
        .layout_tests(false)
        .generate()
        .expect("bindgen bun_emu_host.h");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    bindings
        .write_to_file(out.join("bindings.rs"))
        .expect("write bindings");
}
