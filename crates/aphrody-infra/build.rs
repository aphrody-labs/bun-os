//! Keeps the crate-local copy `data/host-policy.toml` in step with the repository file `infra/config/host/host-policy.toml`. A published crate cannot
//! reach outside its own directory, so it embeds the copy; inside the checkout the copy is refreshed on build.
use std::{fs, path::Path};

fn main() {
    let source = Path::new("../../infra/config/host/host-policy.toml");
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed=build.rs");
    if let Ok(bytes) = fs::read(source) {
        let target = Path::new("data/host-policy.toml");
        if fs::read(target).ok().as_deref() != Some(bytes.as_slice()) {
            fs::write(target, bytes).expect("refresh the crate-local copy");
        }
    }
}
