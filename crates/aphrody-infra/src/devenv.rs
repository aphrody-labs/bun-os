//! Native Linux host provisioning driven by `infra/config/system-packages.json`
//! and `rust-toolchain.toml`. The generated POSIX script is idempotent.

use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::fs;
use std::path::Path;

pub struct Pins {
    pub rust_channel: String,
    pub bun: String,
    pub uv: String,
    pub apt: Vec<String>,
    pub cargo_tools: Vec<String>,
}

fn version_token(value: &str) -> Result<&str> {
    if value.is_empty()
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        bail!("version refusée: {value}");
    }
    Ok(value)
}

pub fn load(root: &Path, host: &str) -> Result<Pins> {
    let packages: Value = serde_json::from_str(
        &fs::read_to_string(root.join("infra/config/system-packages.json"))
            .context("lecture infra/config/system-packages.json")?,
    )?;
    let toolchain = fs::read_to_string(root.join("rust-toolchain.toml"))
        .context("lecture rust-toolchain.toml")?;
    let rust_channel = toolchain
        .lines()
        .find_map(|line| line.trim().strip_prefix("channel"))
        .and_then(|rest| rest.split('"').nth(1))
        .context("channel absent de rust-toolchain.toml")?
        .to_owned();
    let pin = |tool: &str| {
        packages["toolchains"][tool]["version"]
            .as_str()
            .map(str::to_owned)
            .with_context(|| format!("toolchains.{tool}.version absent"))
    };
    let list = |key: &str| -> Vec<String> {
        packages[key]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut apt = list("common");
    apt.extend(list(host));
    Ok(Pins {
        rust_channel,
        bun: pin("bun")?,
        uv: pin("uv")?,
        apt,
        cargo_tools: list("cargoTools"),
    })
}

const PATH_BLOCK: &str = r#"# >>> aphrody-infra toolchain >>>
export BUN_INSTALL="$HOME/.bun"
case ":$PATH:" in *":$HOME/.cargo/bin:"*) ;; *) export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH" ;; esac
# <<< aphrody-infra toolchain <<<"#;

/// Build the provisioning script. `apply = false` only reports versions.
pub fn script(pins: &Pins, apply: bool) -> Result<String> {
    let rust = version_token(&pins.rust_channel)?;
    let bun = version_token(&pins.bun)?;
    let uv = version_token(&pins.uv)?;
    for package in &pins.apt {
        version_token(package)?;
    }
    for tool in &pins.cargo_tools {
        version_token(tool)?;
    }
    let mut out = String::from("set -u\n");
    out.push_str(&format!("{PATH_BLOCK}\n"));
    if apply {
        out.push_str(&format!(
            r#"for rc in "$HOME/.bashrc" "$HOME/.profile"; do
  [ -f "$rc" ] || touch "$rc"
  if ! grep -q '>>> aphrody-infra toolchain >>>' "$rc"; then
    tmp=$(mktemp); printf '%s\n' '{block}' > "$tmp"; cat "$rc" >> "$tmp"; mv "$tmp" "$rc"
  fi
done
if sudo -n true 2>/dev/null; then
  sudo -n apt-get update -qq >/dev/null 2>&1
  for p in {apt}; do
    dpkg -s "$p" >/dev/null 2>&1 || sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$p" >/dev/null 2>&1 || echo "apt-unavailable $p"
  done
else
  echo "apt-skipped (no passwordless sudo)"
fi
command -v rustup >/dev/null 2>&1 || curl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none >/dev/null 2>&1
rustup toolchain install {rust} --profile minimal -c rustfmt -c clippy >/dev/null 2>&1 && rustup default {rust} >/dev/null 2>&1
[ "$(bun --version 2>/dev/null)" = "{bun}" ] || npm install --global "bun@{bun}" >/dev/null 2>&1
uv --version 2>/dev/null | grep -q " {uv} " || curl -LsSf https://astral.sh/uv/{uv}/install.sh | env UV_INSTALL_DIR="$HOME/.local/bin" INSTALLER_NO_MODIFY_PATH=1 sh >/dev/null 2>&1
command -v nu >/dev/null 2>&1 || {{ command -v cargo-binstall >/dev/null 2>&1 || cargo install --locked cargo-binstall >/dev/null 2>&1; cargo binstall -y --locked nu >/dev/null 2>&1; }}
if [ -n "{cargo_tools}" ]; then
  command -v cargo-binstall >/dev/null 2>&1 || cargo install --locked cargo-binstall >/dev/null 2>&1
  for tool in {cargo_tools}; do command -v "$tool" >/dev/null 2>&1 || cargo binstall -y --locked "$tool" >/dev/null 2>&1; done
fi
"#,
            block = PATH_BLOCK.replace('\'', r"'\''"),
            apt = pins.apt.join(" "),
            cargo_tools = pins.cargo_tools.join(" "),
        ));
    }
    out.push_str(&format!(
        r#"v() {{ "$@" 2>/dev/null | head -1 | tr -d '\n' || true; }}
printf 'rust\t%s\twant {rust}\n' "$(v rustc --version)"
printf 'bun\t%s\twant {bun}\n' "$(v bun --version)"
printf 'uv\t%s\twant {uv}\n' "$(v uv --version)"
printf 'nu\t%s\n' "$(v nu --version)"
printf 'cargo-tools\t%s declared\n' "{cargo_tools}"
printf 'node\t%s\twant absent\n' "$(command -v node || echo absent)"
missing=0; for p in {apt}; do dpkg -s "$p" >/dev/null 2>&1 || missing=$((missing+1)); done
printf 'apt\t%s missing of {count}\n' "$missing"
"#,
        apt = pins.apt.join(" "),
        cargo_tools = pins.cargo_tools.join(" "),
        count = pins.apt.len(),
    ));
    Ok(out)
}

/// Optional developer tools share the canonical catalog and installer.
pub fn developer_script(root: &Path, apply: bool) -> Result<String> {
    let catalog: Value = serde_json::from_str(&fs::read_to_string(
        root.join("infra/config/developer-cli-tools.json"),
    )?)?;
    let mut out = String::from("set -eu\n");
    out.push_str(&format!("{PATH_BLOCK}\n"));
    for family in ["tools", "nu_plugins"] {
        if family == "nu_plugins" {
            out.push_str("plugin_registry=\"\"; if command -v nu >/dev/null 2>&1; then plugin_registry=$(nu -c '$nu.plugin-path'); fi\n");
        }
        let tools = catalog[family]
            .as_array()
            .with_context(|| format!("{family} absent"))?;
        for tool in tools {
            let command = version_token(tool["command"].as_str().context("command absent")?)?;
            let package = version_token(tool["package"].as_str().context("package absent")?)?;
            for token in [command, package] {
                if !token.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_') {
                    bail!("nom de commande/crate refusé: {token}");
                }
            }
            if apply {
                out.push_str(&format!(
                    "if ! command -v {command} >/dev/null 2>&1; then\n\
                     command -v cargo-binstall >/dev/null 2>&1 || cargo install --locked cargo-binstall\n\
                     cargo binstall -y --locked {package}\nfi\n"
                ));
            }
            out.push_str(&format!(
                "if command -v {command} >/dev/null 2>&1; then printf 'present\t%s\t%s\n' {command} \"$(command -v {command})\"; else printf 'missing\t%s\n' {command}; fi\n"
            ));
            if family == "nu_plugins" && apply {
                let plugin = version_token(tool["plugin"].as_str().context("plugin absent")?)?;
                out.push_str(&format!(
                    "if [ \"$(nu --config /dev/null --env-config /dev/null --plugin-config \"$plugin_registry\" -c \"plugin list | where name == '{plugin}' | is-empty\")\" = true ]; then\n\
                     nu --config /dev/null --env-config /dev/null --plugin-config \"$plugin_registry\" -c \"plugin add $(command -v {command})\"\nfi\n"
                ));
            }
        }
    }
    out.push_str("if command -v nu >/dev/null 2>&1; then nu --config /dev/null --env-config /dev/null --plugin-config \"$plugin_registry\" -c 'plugin list | select name status | to json'; fi\n");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pins() -> Pins {
        Pins {
            rust_channel: "nightly-2026-05-17".into(),
            bun: "1.4.2".into(),
            uv: "0.12.17".into(),
            apt: vec!["git".into(), "rsync".into()],
            cargo_tools: vec!["cargo-nextest".into()],
        }
    }

    #[test]
    fn check_mode_does_not_install() {
        let s = script(&pins(), false).unwrap();
        assert!(!s.contains("apt-get install") && !s.contains("curl"), "{s}");
        assert!(s.contains("want nightly-2026-05-17"));
    }

    #[test]
    fn apply_installs_pinned_versions() {
        let s = script(&pins(), true).unwrap();
        assert!(s.contains("npm install --global \"bun@1.4.2\""));
        assert!(s.contains("astral.sh/uv/0.12.17/install.sh"));
        assert!(s.contains("rustup toolchain install nightly-2026-05-17"));
        assert!(s.contains("for p in git rsync"));
        assert!(s.contains("cargo binstall -y --locked \"$tool\""));
    }

    #[test]
    fn rejects_injection_in_pins() {
        let mut bad = pins();
        bad.bun = "1.4.2; rm -rf ~".into();
        assert!(script(&bad, true).is_err());
        let mut bad = pins();
        bad.apt.push("x$(id)".into());
        assert!(script(&bad, false).is_err());
    }

    #[test]
    fn developer_catalog_rejects_shell_tokens_before_install() {
        let root =
            std::env::temp_dir().join(format!("aphrody-developer-test-{}", std::process::id()));
        fs::create_dir_all(root.join("tools").join("config")).unwrap();
        fs::write(
            root.join("infra/config/developer-cli-tools.json"),
            r#"{"tools":[{"command":"safe","package":"unsafe;touch-marker"}],"nu_plugins":[]}"#,
        )
        .unwrap();
        assert!(developer_script(&root, true).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repository_pins_load_for_every_host() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for host in ["vps", "dbfr", "wsl"] {
            let pins = load(&root, host).unwrap();
            script(&pins, true).unwrap();
        }
    }
}
