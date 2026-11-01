// SPDX-License-Identifier: Apache-2.0
//! Standalone server of one session, for per-session units and containers.
//!
//! Desktop (X11 or Wayland): `aphrody-remote-desktop [--bind 127.0.0.1:8794] [--fps 30] [--quality 70] [--scale 1]`.
//! Android (feature `android`): `aphrody-remote-desktop --android 127.0.0.1:5555 --scrcpy-server <jar>
//! [--bind 127.0.0.1:8799] [--max-size 1920] [--max-fps 60] [--bit-rate 8000000] [--adb adb]`.
//! The bearer token comes from `APHRODY_REMOTE_TOKEN` or the file named by `APHRODY_REMOTE_TOKEN_FILE`.

use anyhow::{Context, Result, bail};
use aphrody_remote_desktop::{ServeOptions, serve};

fn token() -> Result<String> {
    match std::env::var("APHRODY_REMOTE_TOKEN") {
        Ok(t) if !t.is_empty() => Ok(t),
        _ => {
            let path = std::env::var("APHRODY_REMOTE_TOKEN_FILE")
                .context("set APHRODY_REMOTE_TOKEN or APHRODY_REMOTE_TOKEN_FILE")?;
            Ok(std::fs::read_to_string(&path)
                .with_context(|| format!("cannot read {path}"))?
                .trim()
                .to_owned())
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut opts = ServeOptions::default();
    let mut bind: Option<std::net::SocketAddr> = None;
    let mut android: Option<String> = None;
    let mut open_play_store = false;
    let mut jar: Option<std::path::PathBuf> = None;
    let mut adb = std::path::PathBuf::from("adb");
    let (mut max_size, mut max_fps, mut bit_rate) = (1920u32, 60u32, 8_000_000u32);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = || args.next().with_context(|| format!("{a} needs a value"));
        match a.as_str() {
            "--bind" => bind = Some(value()?.parse().context("--bind")?),
            "--fps" => opts.fps = value()?.parse().context("--fps")?,
            "--quality" => opts.quality = value()?.parse().context("--quality")?,
            "--scale" => opts.scale = value()?.parse().context("--scale")?,
            "--android" => android = Some(value()?),
            "--open-play-store" => open_play_store = true,
            "--scrcpy-server" => jar = Some(value()?.into()),
            "--adb" => adb = value()?.into(),
            "--max-size" => max_size = value()?.parse().context("--max-size")?,
            "--max-fps" => max_fps = value()?.parse().context("--max-fps")?,
            "--bit-rate" => bit_rate = value()?.parse().context("--bit-rate")?,
            "--status" => {
                println!("{}", aphrody_remote_desktop::backend_status());
                return Ok(());
            }
            other => bail!("unknown argument {other}"),
        }
    }
    if open_play_store {
        #[cfg(feature = "android")]
        {
            let serial = android.context("--open-play-store needs --android <serial>")?;
            let output = std::process::Command::new(&adb)
                .args(["-s", &serial, "shell", "pm", "path", "com.android.vending"])
                .output()
                .with_context(|| format!("cannot run {}", adb.display()))?;
            if !output.status.success() || output.stdout.is_empty() {
                bail!("Google Play Store (com.android.vending) is not installed on {serial}");
            }
            let output = std::process::Command::new(&adb)
                .args([
                    "-s",
                    &serial,
                    "shell",
                    "monkey",
                    "-p",
                    "com.android.vending",
                    "1",
                ])
                .output()
                .with_context(|| format!("cannot launch Play Store on {serial}"))?;
            if !output.status.success() {
                bail!(
                    "failed to launch Play Store on {serial}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            println!(
                "Opened Google Play Store on {serial}. Complete sign-in interactively in the Android viewer."
            );
            return Ok(());
        }
        #[cfg(not(feature = "android"))]
        bail!("built without the `android` feature");
    }
    if let Some(serial) = android {
        #[cfg(feature = "android")]
        {
            let o = aphrody_remote_desktop::android::AndroidOptions {
                bind: bind.unwrap_or_else(|| std::net::SocketAddr::from(([127, 0, 0, 1], 8799))),
                token: token()?,
                serial,
                adb,
                server_jar: jar.context("--android needs --scrcpy-server")?,
                max_size,
                max_fps,
                bit_rate,
            };
            eprintln!(
                "aphrody-remote-desktop android {}: http://{}/api/android/",
                o.serial, o.bind
            );
            return aphrody_remote_desktop::android::serve_android(o).await;
        }
        #[cfg(not(feature = "android"))]
        {
            let _ = (serial, jar, adb, max_size, max_fps, bit_rate);
            bail!("built without the `android` feature");
        }
    }
    if let Some(b) = bind {
        opts.bind = b;
    }
    opts.token = token()?;
    eprintln!("aphrody-remote-desktop: http://{}/", opts.bind);
    serve(opts).await
}
