//! `media-core` CLI, the process boundary used by `@aphrody/media` (Bun) and the shell "open
//! with" actions. All output is one JSON document on stdout; errors go to stderr with exit 1.
//!
//!   media-core probe <file>
//!   media-core render <file> <stack.json> <out.(png|jpg|webp)>
//!   media-core proxy <file> <stack.json> <cache-dir> <max-edge>
//!   media-core send <inbox-dir> <from> <to> <file> <stack.json> [first-frame last-frame]
//!   media-core receive <inbox-dir> <app>

use media_core::ai::NoBackend;
use media_core::asset::{self, ProxyCache};
use media_core::graph::EditStack;
use media_core::project::Handoff;
use media_core::{Result, engine};
use std::path::PathBuf;

fn stack(path: &str) -> Result<EditStack> {
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

fn run(args: &[String]) -> Result<serde_json::Value> {
    let a = |i: usize| -> Result<&str> {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| media_core::Error::Invalid("missing argument".into()))
    };
    match a(0)? {
        "probe" => Ok(serde_json::to_value(asset::probe(&std::fs::read(a(1)?)?)?)?),
        "render" => {
            let bytes = std::fs::read(a(1)?)?;
            let meta = asset::probe(&bytes)?;
            let out = engine::render(&asset::decode(&bytes, meta.orientation)?, &stack(a(2)?)?, &NoBackend)?;
            if a(3)?.ends_with(".jpg") || a(3)?.ends_with(".jpeg") {
                image::DynamicImage::ImageRgba8(out.clone()).to_rgb8().save(a(3)?)?;
            } else {
                out.save(a(3)?)?;
            }
            Ok(serde_json::json!({ "out": a(3)?, "width": out.width(), "height": out.height() }))
        }
        "proxy" => {
            let bytes = std::fs::read(a(1)?)?;
            let edge: u32 = a(4)?.parse().map_err(|_| media_core::Error::Invalid("max-edge".into()))?;
            let (p, hit) = ProxyCache::open(a(3)?)?.get_or_render(&bytes, &stack(a(2)?)?, edge, &NoBackend)?;
            Ok(serde_json::json!({ "path": p, "hit": hit }))
        }
        "send" => {
            let bytes = std::fs::read(a(4)?)?;
            let frames = match (args.get(6), args.get(7)) {
                (Some(x), Some(y)) => Some((
                    x.parse().map_err(|_| media_core::Error::Invalid("frame".into()))?,
                    y.parse().map_err(|_| media_core::Error::Invalid("frame".into()))?,
                )),
                _ => None,
            };
            let h = Handoff {
                from: a(2)?.into(),
                to: a(3)?.into(),
                asset: asset::probe(&bytes)?,
                path: PathBuf::from(a(4)?).canonicalize()?,
                stack: stack(a(5)?)?,
                frames,
            };
            Ok(serde_json::json!({ "file": h.send(std::path::Path::new(a(1)?))? }))
        }
        "receive" => Ok(serde_json::to_value(Handoff::receive(std::path::Path::new(a(1)?), a(2)?)?)?),
        other => Err(media_core::Error::Invalid(format!("unknown command {other}"))),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(v) => println!("{v}"),
        Err(e) => {
            eprintln!("media-core: {e}");
            std::process::exit(1);
        }
    }
}
