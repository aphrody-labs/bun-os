// SPDX-License-Identifier: Apache-2.0
//! `bunos-design`: the native half of the Bun OS design pipeline (`m3-os-themes design`).
//!
//!   bunos-design seed <image>                         wallpaper source colour (MCU Celebi + score), `#rrggbb`
//!   bunos-design theme [--seed <hex>|--wallpaper <image>] [--variant <v>] [--contrast <-1..1>]
//!                                                     M3 theme export (schema 1, 49 roles, light + dark) as JSON
//!   bunos-design render <jobs.json>                   render every job in parallel (ICO and/or PNG outputs)
//!
//! A render job is `{ "svg": "<svg>", "small"?: "<svg>", "ico"?: "out.ico", "sizes"?: [16, ...],
//! "png"?: [{ "size": 48, "out": "x.png" }] }`. `small` replaces `svg` at 24 px and below (hinted detail).
//! ICOs use the Windows shell layout of `aphrody_svg::raster::render_ico_windows` (DIB < 256 px, PNG 256 px).

use std::{fs, path::PathBuf, process::ExitCode};

use aphrody_m3_tokens::{color_math::hex_from_argb, image::source_color_from_image_bytes, theme::ThemeRequest};
use aphrody_svg::raster::{RenderOptions, WINDOWS_SHELL_ICO_SIZES, render_ico_windows, render_png};
use rayon::prelude::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Png {
    size: u32,
    out: PathBuf,
}

#[derive(Deserialize)]
struct Job {
    svg: String,
    small: Option<String>,
    ico: Option<PathBuf>,
    sizes: Option<Vec<u32>>,
    #[serde(default)]
    png: Vec<Png>,
}

#[derive(Deserialize)]
struct Jobs {
    jobs: Vec<Job>,
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn seed_of(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("{path}: {e}"))?;
    let argb = source_color_from_image_bytes(&bytes).map_err(|e| format!("{path}: {e}"))?;
    Ok(hex_from_argb(argb))
}

fn write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    fs::write(path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

fn run_job(job: &Job) -> Result<usize, String> {
    let svg_for = |s: u32| match &job.small {
        Some(small) if s <= 24 => small.as_str(),
        _ => job.svg.as_str(),
    };
    let mut written = 0;
    if let Some(ico) = &job.ico {
        let sizes = job.sizes.as_deref().unwrap_or(WINDOWS_SHELL_ICO_SIZES);
        let bytes = render_ico_windows(svg_for, sizes).map_err(|e| format!("{}: {e}", ico.display()))?;
        write(ico, &bytes)?;
        written += 1;
    }
    for png in &job.png {
        let bytes = render_png(svg_for(png.size), RenderOptions::square(png.size))
            .map_err(|e| format!("{}: {e}", png.out.display()))?;
        write(&png.out, &bytes)?;
        written += 1;
    }
    Ok(written)
}

fn run(args: &[String]) -> Result<String, String> {
    match args.first().map(String::as_str) {
        Some("seed") => seed_of(args.get(1).ok_or("usage: bunos-design seed <image>")?),
        Some("theme") => {
            let seed = match (flag(args, "--seed"), flag(args, "--wallpaper")) {
                (Some(s), _) => Some(s),
                (None, Some(w)) => Some(seed_of(&w)?),
                (None, None) => None,
            };
            let contrast = flag(args, "--contrast").map(|c| c.parse::<f64>().map_err(|e| e.to_string())).transpose()?;
            let request = ThemeRequest::parse(seed.as_deref(), flag(args, "--variant").as_deref(), contrast)?;
            serde_json::to_string_pretty(&request.export()).map_err(|e| e.to_string())
        }
        Some("render") => {
            let path = args.get(1).ok_or("usage: bunos-design render <jobs.json>")?;
            let text = fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
            let jobs: Jobs = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
            let counts = jobs.jobs.par_iter().map(run_job).collect::<Result<Vec<_>, _>>()?;
            Ok(format!("rendered {} files from {} jobs", counts.iter().sum::<usize>(), jobs.jobs.len()))
        }
        _ => Err("usage: bunos-design seed <image> | theme [--seed|--wallpaper] [--variant] [--contrast] | render <jobs.json>".into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(out) => {
            println!("{out}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("bunos-design: {e}");
            ExitCode::FAILURE
        }
    }
}
