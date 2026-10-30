//! Keeps the crate-local copy `data/aphrody-tunnel.json` in step with the repository file `infra/config/host/wireguard/aphrody-tunnel.json`. A published crate cannot
//! reach outside its own directory, so it embeds the copy; inside the checkout the copy is refreshed on build.
use std::{fs, path::Path};

fn main() {
    let source = Path::new("../../infra/config/host/wireguard/aphrody-tunnel.json");
    println!("cargo:rerun-if-changed={}", source.display());
    println!("cargo:rerun-if-changed=build.rs");
    if let Ok(bytes) = fs::read(source) {
        let target = Path::new("data/aphrody-tunnel.json");
        if fs::read(target).ok().as_deref() != Some(bytes.as_slice()) {
            fs::write(target, bytes).expect("refresh the crate-local copy");
        }
    }
}
