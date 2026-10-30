// SPDX-License-Identifier: Apache-2.0
//! Standalone remote-desktop server of one session (X11 or Wayland), for per-session units and
//! containers: `aphrody-remote-desktop [--bind 127.0.0.1:8794] [--fps 30] [--quality 70] [--scale 1]`.
//! The bearer token comes from `APHRODY_REMOTE_TOKEN` or the file named by `APHRODY_REMOTE_TOKEN_FILE`.

use anyhow::{Context, Result, bail};
use aphrody_remote_desktop::{ServeOptions, serve};

#[tokio::main]
async fn main() -> Result<()> {
    let mut opts = ServeOptions::default();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = || args.next().with_context(|| format!("{a} needs a value"));
        match a.as_str() {
            "--bind" => opts.bind = value()?.parse().context("--bind")?,
            "--fps" => opts.fps = value()?.parse().context("--fps")?,
            "--quality" => opts.quality = value()?.parse().context("--quality")?,
            "--scale" => opts.scale = value()?.parse().context("--scale")?,
            "--status" => {
                println!("{}", aphrody_remote_desktop::backend_status());
                return Ok(());
            }
            other => bail!("unknown argument {other}"),
        }
    }
    opts.token = match std::env::var("APHRODY_REMOTE_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => {
            let path = std::env::var("APHRODY_REMOTE_TOKEN_FILE").context("set APHRODY_REMOTE_TOKEN or APHRODY_REMOTE_TOKEN_FILE")?;
            std::fs::read_to_string(&path).with_context(|| format!("cannot read {path}"))?.trim().to_owned()
        }
    };
    eprintln!("aphrody-remote-desktop: http://{}/", opts.bind);
    serve(opts).await
}
