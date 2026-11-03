// SPDX-License-Identifier: Apache-2.0
//! Run a 3D authoring script: apply its ops to a document, then write the
//! requested renders (PNG, animation frames), GLB exports, the document and
//! its stats.
//!
//! ```sh
//! cargo run -p aphrody-render --release --example studio3d -- \
//!   crates/aphrody-render/examples/studio3d/character.json out/
//! ```
//!
//! The script is `{ "document"?: Document3d, "ops": [Op], "outputs": [...] }`
//! (see `aphrody_render::author3d::doc`). Each op prints one JSON report line.

use std::path::{Path, PathBuf};

use aphrody_render::author3d::doc::{Document3d, Editor, Op, ViewSpec};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Output {
    Png {
        path: PathBuf,
        #[serde(default)]
        view: ViewSpec,
    },
    Frames {
        prefix: String,
        count: u32,
        #[serde(default = "default_fps")]
        fps: f32,
        #[serde(default)]
        view: ViewSpec,
    },
    Glb {
        path: PathBuf,
        #[serde(default)]
        view: ViewSpec,
    },
    Document {
        path: PathBuf,
    },
    Stats {
        path: PathBuf,
    },
}

const fn default_fps() -> f32 {
    24.0
}

#[derive(Deserialize)]
struct Script {
    #[serde(default)]
    document: Document3d,
    #[serde(default)]
    ops: Vec<Op>,
    #[serde(default)]
    outputs: Vec<Output>,
}

fn write(dir: &Path, rel: &Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("output path {rel:?} must stay inside the output directory").into());
    }
    let path = dir.join(rel);
    std::fs::write(&path, bytes)?;
    println!(
        "{}",
        serde_json::json!({ "wrote": path, "bytes": bytes.len() })
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let script_path = args
        .next()
        .ok_or("usage: studio3d <script.json> [out-dir]")?;
    let out = PathBuf::from(args.next().unwrap_or_else(|| ".".into()));
    std::fs::create_dir_all(&out)?;
    let script: Script = serde_json::from_str(&std::fs::read_to_string(&script_path)?)?;
    let mut editor = Editor::new(script.document);
    for (i, op) in script.ops.iter().enumerate() {
        let report = editor.apply(op).map_err(|e| format!("op {i}: {e}"))?;
        println!("{}", serde_json::json!({ "op": i, "report": report }));
    }
    let doc = &editor.doc;
    for output in &script.outputs {
        match output {
            Output::Png { path, view } => write(&out, path, &doc.render_png(view)?)?,
            Output::Frames {
                prefix,
                count,
                fps,
                view,
            } => {
                for f in 0..*count {
                    let v = ViewSpec {
                        time: view.time + f as f32 / fps.max(1e-3),
                        ..view.clone()
                    };
                    let name = PathBuf::from(format!("{prefix}-{f:03}.png"));
                    write(&out, &name, &doc.render_png(&v)?)?;
                }
            }
            Output::Glb { path, view } => write(&out, path, &doc.export_glb(view)?)?,
            Output::Document { path } => write(&out, path, &serde_json::to_vec_pretty(doc)?)?,
            Output::Stats { path } => write(&out, path, &serde_json::to_vec_pretty(&doc.stats())?)?,
        }
    }
    Ok(())
}
