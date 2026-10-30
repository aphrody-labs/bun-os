//! Headless ROM suite: every case of `tests/rom-suite.json` is booted on its in-tree core and
//! measured, never assumed. Only free homebrew and test ROMs are used; the files are fetched by
//! `scripts/emulation/fetch-roms.ts` (pinned, sha256-verified) or read from the pinned vendor trees
//! and are never committed. A case whose ROM is absent is reported `rom-missing` (a failure when
//! `BUN_ENGINE_ROMS_REQUIRED=1`, as in CI).
//!
//! Per case: final-frame SHA-256 over all screens, a second boot that must give the same hash
//! (determinism), a non-blank check, an audio SHA-256 when the core produces audio, and a
//! save-state round trip when the core can save. Results are written as JSON to
//! `BUN_ENGINE_RESULTS` (default `target/rom-suite/results.json`) for `scripts/emulation/matrix.ts`.
//! `BUN_ENGINE_RECORD=1` never fails on hashes and dumps the final screens as PPM next to the results.

use std::{
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use bun_engine::machine::{Machine, Screen, Step};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Rectangles `[screen, x, y, w, h]` blanked before hashing: guests that draw the host wall clock
/// (DS RTC, 3DS clock) would otherwise change the hash every minute.
type Mask = Vec<[usize; 5]>;

fn screens_hash(screens: &[Screen], mask: &Mask) -> String {
    let mut h = Sha256::new();
    for (i, s) in screens.iter().enumerate() {
        h.update((s.width as u32).to_le_bytes());
        h.update((s.height as u32).to_le_bytes());
        let mut rgb = s.rgb.clone();
        for &[screen, x, y, w, hh] in mask {
            if screen != i {
                continue;
            }
            for row in y..(y + hh).min(s.height) {
                let from = (row * s.width + x.min(s.width)) * 3;
                let to = (row * s.width + (x + w).min(s.width)) * 3;
                rgb[from..to].fill(0);
            }
        }
        h.update(&rgb);
    }
    hex(&h.finalize())
}

fn distinct_colors(screens: &[Screen]) -> usize {
    let mut seen = std::collections::HashSet::new();
    for s in screens {
        for px in s.rgb.chunks_exact(3) {
            seen.insert([px[0], px[1], px[2]]);
            if seen.len() > 16 {
                return seen.len();
            }
        }
    }
    seen.len()
}

#[allow(unused_variables)]
fn boot(
    system: &str,
    core: &str,
    path: &Path,
    rom: &[u8],
    bios: Option<&[u8]>,
) -> Result<Box<dyn Machine>, String> {
    let name = path.to_string_lossy().into_owned();
    match system {
        #[cfg(feature = "gba")]
        "gba" => bun_engine::machine::gba::Gba::from_rom(rom, bios).map(|m| Box::new(m) as _),
        #[cfg(feature = "nes")]
        "nes" => bun_engine::machine::nes::Nes::from_rom(&name, rom).map(|m| Box::new(m) as _),
        #[cfg(feature = "psx")]
        "psx" => bun_engine::machine::psx::Psx::new(bios.ok_or("needs openbios")?, rom)
            .map(|m| Box::new(m) as _),
        #[cfg(feature = "wii")]
        "wii" => bun_engine::machine::wii::WiiMachine::wii_dol(rom).map(|m| Box::new(m) as _),
        #[cfg(feature = "wii")]
        "gc" => bun_engine::machine::wii::WiiMachine::gamecube_dol(rom).map(|m| Box::new(m) as _),
        #[cfg(any(feature = "nds", feature = "ctr"))]
        "nds" | "3ds" => bun_engine::machine::handheld::HandheldMachine::from_path(path)
            .map(|m| Box::new(m) as _),
        #[cfg(feature = "switch")]
        "switch" => bun_engine::machine::switch::Switch::from_path(&name).map(|m| Box::new(m) as _),
        #[cfg(feature = "arm")]
        "arm" => {
            bun_engine::machine::arm::ArmFirmware::from_image(rom, 128).map(|m| Box::new(m) as _)
        }
        #[cfg(feature = "libretro")]
        "libretro" => {
            let cores = std::env::var("BUN_ENGINE_CORES")
                .map(PathBuf::from)
                .unwrap_or_else(|_| root().join("target/rom-suite/cores"));
            let file = cores.join(bun_engine::machine::libretro::Libretro::core_file(core));
            if !file.exists() {
                return Err(format!("core-missing: {}", file.display()));
            }
            let system_dir = cores.join("system");
            bun_engine::machine::libretro::Libretro::open(&file, path, &system_dir)
                .map(|m| Box::new(m) as _)
        }
        other => Err(format!("core `{other}` is not compiled into this test")),
    }
}

struct Run {
    hash: String,
    audio_hash: Option<String>,
    audio_samples: usize,
    colors: usize,
    frames: u64,
    ms: f64,
    stopped: Option<String>,
    savestate: Option<bool>,
    screens: Vec<Screen>,
}

fn keys_at(input: &[(u64, u32)], frame: u64) -> u32 {
    input
        .iter()
        .filter(|(at, _)| *at <= frame)
        .next_back()
        .map_or(0, |(_, k)| *k)
}

fn run(
    system: &str,
    core: &str,
    path: &Path,
    rom: &[u8],
    bios: Option<&[u8]>,
    frames: u64,
    input: &[(u64, u32)],
    mask: &Mask,
    savestate: bool,
) -> Result<Run, String> {
    let mut m = boot(system, core, path, rom, bios)?;
    let mut audio = Sha256::new();
    let mut samples = 0usize;
    let mut buf = Vec::new();
    let mut stopped = None;
    let mut done = 0;
    let started = Instant::now();
    let mut state = None;
    let mid = frames / 2;
    while done < frames {
        m.set_input(bun_engine::machine::Input {
            keys: keys_at(input, done),
            touch: None,
        });
        if !matches!(m.run_frame(), Step::Frame) {
            stopped = Some(m.diagnostic().unwrap_or_else(|| "machine stopped".into()));
            break;
        }
        buf.clear();
        m.audio(&mut buf);
        samples += buf.len();
        for s in &buf {
            audio.update(s.to_bits().to_le_bytes());
        }
        done += 1;
        if savestate && done == mid {
            state = m.save_state();
        }
    }
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    let screens = m.screens();
    let hash = screens_hash(&screens, mask);
    let mut round_trip = None;
    if let Some(state) = state {
        // Reload the mid-run state and replay the second half: it must land on the same picture.
        drop(m); // libretro cores keep process-wide state: one instance at a time
        let mut m2 = boot(system, core, path, rom, bios)?;
        if m2.load_state(&state).is_ok() {
            for f in mid..done {
                m2.set_input(bun_engine::machine::Input {
                    keys: keys_at(input, f),
                    touch: None,
                });
                let _ = m2.run_frame();
                buf.clear();
                m2.audio(&mut buf);
            }
            round_trip = Some(screens_hash(&m2.screens(), mask) == hash);
        } else {
            round_trip = Some(false);
        }
    }
    Ok(Run {
        hash,
        audio_hash: (samples > 0).then(|| hex(&audio.finalize())),
        audio_samples: samples,
        colors: distinct_colors(&screens),
        frames: done,
        ms,
        stopped,
        savestate: round_trip,
        screens,
    })
}

fn parse_mask(case: &Value) -> Mask {
    case["mask"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let v: Vec<usize> = r
                        .as_array()?
                        .iter()
                        .filter_map(|n| n.as_u64().map(|n| n as usize))
                        .collect();
                    <[usize; 5]>::try_from(v).ok()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_input(case: &Value) -> Vec<(u64, u32)> {
    case["input"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|e| Some((e[0].as_u64()?, e[1].as_u64()? as u32)))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn rom_suite() {
    let manifest: Value = serde_json::from_slice(
        &fs::read(root().join("crates/bun-engine-core/tests/rom-suite.json")).unwrap(),
    )
    .unwrap();
    let downloads = std::env::var("BUN_ENGINE_ROMS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root().join("target/rom-suite/downloads"));
    let out = std::env::var("BUN_ENGINE_RESULTS")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root().join("target/rom-suite/results.json"));
    let shots = out.parent().unwrap().join("screens");
    let required = std::env::var("BUN_ENGINE_ROMS_REQUIRED").as_deref() == Ok("1");
    let only = std::env::var("BUN_ENGINE_ONLY").ok();
    let record = std::env::var("BUN_ENGINE_RECORD").as_deref() == Ok("1");
    let mut results = Vec::new();
    let mut failures = Vec::new();
    for case in manifest["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        if only.as_deref().is_some_and(|o| !id.starts_with(o)) {
            continue;
        }
        let system = case["system"].as_str().unwrap();
        let core = case["libretro"].as_str().unwrap_or("");
        let rel = case["rom"].as_str().unwrap();
        let path = if rel.starts_with("vendor/") {
            root().join(rel)
        } else {
            downloads.join(rel)
        };
        let mut r = json!({
            "id": id, "console": case["console"], "core": case["core"], "system": system,
            "rom": rel, "frames": case["frames"], "note": case["note"],
        });
        let Ok(rom) = fs::read(&path) else {
            r["status"] = "rom-missing".into();
            if required {
                failures.push(format!("{id}: ROM missing ({})", path.display()));
            }
            results.push(r);
            continue;
        };
        let bios = case["bios"]
            .as_str()
            .and_then(|b| fs::read(downloads.join(b)).ok());
        if case["bios"].is_string() && bios.is_none() {
            r["status"] = "bios-missing".into();
            if required {
                failures.push(format!("{id}: BIOS missing"));
            }
            results.push(r);
            continue;
        }
        r["rom_sha256"] = hex(&Sha256::digest(&rom)).into();
        let frames = case["frames"].as_u64().unwrap();
        let input = parse_input(case);
        let mask = parse_mask(case);
        let save = case["savestate"].as_bool().unwrap_or(true);
        let first = match run(
            system,
            core,
            &path,
            &rom,
            bios.as_deref(),
            frames,
            &input,
            &mask,
            save,
        ) {
            Ok(f) => f,
            Err(e) if e.starts_with("core-missing") => {
                r["status"] = "core-missing".into();
                r["error"] = e.into();
                if required {
                    failures.push(format!("{id}: core missing"));
                }
                results.push(r);
                continue;
            }
            Err(e) if e.contains("not compiled") => {
                r["status"] = "not-built".into();
                if required {
                    failures.push(format!("{id}: {e}"));
                }
                results.push(r);
                continue;
            }
            Err(e) => {
                r["status"] = "boot-failed".into();
                r["error"] = e.clone().into();
                failures.push(format!("{id}: {e}"));
                results.push(r);
                continue;
            }
        };
        let second = run(
            system,
            core,
            &path,
            &rom,
            bios.as_deref(),
            frames,
            &input,
            &mask,
            false,
        )
        .unwrap();
        let deterministic = first.hash == second.hash && first.audio_hash == second.audio_hash;
        let expected = case["hash"].as_str().unwrap_or("");
        r["frame_hash"] = first.hash.clone().into();
        r["audio_hash"] = first.audio_hash.clone().into();
        r["audio_samples"] = first.audio_samples.into();
        r["distinct_colors"] = first.colors.into();
        r["frames_run"] = first.frames.into();
        r["ms_per_frame"] =
            ((first.ms / first.frames.max(1) as f64 * 100.0).round() / 100.0).into();
        r["deterministic"] = deterministic.into();
        r["savestate_roundtrip"] = first.savestate.into();
        r["screens"] = first
            .screens
            .iter()
            .map(|s| format!("{}x{}", s.width, s.height))
            .collect::<Vec<_>>()
            .into();
        r["stopped"] = first.stopped.clone().into();
        let verdict = case["verdict"].as_str().unwrap_or("");
        r["verdict"] = verdict.into();
        r["status"] = if first.stopped.is_some() {
            "stopped"
        } else if !deterministic && case["volatile"].as_bool() == Some(true) {
            // Known thread-timing dependent core: measured and reported, but its hash cannot be pinned.
            "volatile"
        } else if !deterministic {
            "nondeterministic"
        } else if first.colors <= 1 && !verdict.starts_with("blank") {
            "blank"
        } else if expected.is_empty() {
            "unrecorded"
        } else if expected != first.hash {
            "hash-mismatch"
        } else {
            "ok"
        }
        .into();
        if record {
            let _ = fs::create_dir_all(&shots);
            for (i, s) in first.screens.iter().enumerate() {
                let mut ppm = format!("P6\n{} {}\n255\n", s.width, s.height).into_bytes();
                ppm.extend_from_slice(&s.rgb);
                let _ = fs::write(shots.join(format!("{id}-{i}.ppm")), ppm);
            }
        } else if r["status"] != "ok" && r["status"] != "volatile" {
            failures.push(format!("{id}: {}", r["status"]));
        }
        if first.savestate == Some(false) {
            failures.push(format!("{id}: save-state round trip diverged"));
        }
        results.push(r);
    }
    fs::create_dir_all(out.parent().unwrap()).unwrap();
    fs::write(
        &out,
        serde_json::to_vec_pretty(&json!({ "cases": results })).unwrap(),
    )
    .unwrap();
    assert!(
        failures.is_empty(),
        "rom suite failures:\n{}",
        failures.join("\n")
    );
}
