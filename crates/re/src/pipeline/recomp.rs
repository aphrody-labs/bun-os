// SPDX-License-Identifier: Apache-2.0
//! Static recompilation of console BIOS and ROM images (`bunre recompile`), as stage adapters of
//! the pipeline: console lift (ARMv4T, MIPS R3000A, 6502) -> guest IR -> Rust crate over the Bun
//! Engine core -> Cargo build for the host executable or `wasm32-unknown-unknown` -> verification
//! against the interpreter of the same core (frame buffers compared byte for byte).

use super::contract::{Check, LiftOutput, Stage, StageReport, StageStatus, VerifyOutput};
use super::emit_guest::{Embed, write_crate};
use super::ir::IrModule;
use super::registry::{Ctx, report};
use super::util::{artifact, run_cmd, tail, which};
use super::{lift_6502, lift_armv4t, lift_mips};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Output of a recompilation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecompTarget {
    /// Native executable for the host.
    Exe,
    /// WebAssembly module (`wasm32-unknown-unknown`).
    Wasm,
}

impl RecompTarget {
    /// Parse a CLI value.
    #[must_use]
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "exe" | "native" => Some(Self::Exe),
            "wasm" | "wasm32" => Some(Self::Wasm),
            _ => None,
        }
    }
}

/// Recompilation request.
#[derive(Debug, Clone)]
pub struct Recompile {
    /// Build output.
    pub target: RecompTarget,
    /// Machine override (`gba`, `psx`, `nes`).
    pub machine: Option<String>,
    /// Firmware (GBA BIOS, PlayStation BIOS).
    pub bios: Option<PathBuf>,
    /// Frames run by the verification.
    pub frames: u64,
    /// Run Cargo (false stops after emitting the crate).
    pub build: bool,
    /// Scripted input of the verification runs (`key@first[-last],...`, executables only).
    pub input: Option<String>,
}

/// Generated crate and build products.
#[derive(Debug, Clone, Default)]
pub struct GuestBuild {
    /// Machine runtime.
    pub machine: String,
    /// Crate directory.
    pub crate_dir: Option<PathBuf>,
    /// Crate name.
    pub name: String,
    /// Built executable or WebAssembly module.
    pub artifact: Option<PathBuf>,
    /// Firmware used by the build.
    pub bios: Option<PathBuf>,
}

/// Machine of the current payload: explicit override, else identification.
#[must_use]
pub fn machine_of(ctx: &Ctx) -> Option<String> {
    if let Some(m) = ctx.opts.recompile.as_ref().and_then(|r| r.machine.clone()) {
        return Some(m);
    }
    let id = ctx.payload_ident.as_ref()?;
    match id.platform.as_deref()? {
        "gba" => Some("gba".into()),
        "ps1" => Some("psx".into()),
        "nes" => Some("nes".into()),
        _ => None,
    }
}

fn is(m: &'static str) -> impl Fn(&Ctx) -> bool {
    move |c: &Ctx| c.payload.is_some() && machine_of(c).as_deref() == Some(m)
}

/// Lift applicability per machine.
pub fn applies_gba(c: &Ctx) -> bool {
    is("gba")(c)
}
/// Lift applicability per machine.
pub fn applies_psx(c: &Ctx) -> bool {
    is("psx")(c)
}
/// Lift applicability per machine.
pub fn applies_nes(c: &Ctx) -> bool {
    is("nes")(c)
}

/// Emission applicability.
pub fn has_guest_ir(c: &Ctx) -> bool {
    c.ir.as_ref()
        .is_some_and(|m| m.abi.as_ref().is_some_and(|a| a.machine.is_some()))
}

/// Build applicability.
pub fn wants_build(c: &Ctx) -> bool {
    c.guest.as_ref().is_some_and(|g| g.crate_dir.is_some())
        && c.opts.recompile.as_ref().is_some_and(|r| r.build)
}

/// Verification applicability.
pub fn built(c: &Ctx) -> bool {
    c.guest.as_ref().is_some_and(|g| g.artifact.is_some())
}

fn root_file(ctx: &Ctx, rel: &str) -> Option<PathBuf> {
    ctx.opts
        .root
        .as_ref()
        .map(|r| r.join(rel))
        .filter(|p| p.is_file())
}

/// Default free GBA BIOS (Normmatt) vendored by RustBoyAdvance-NG, the one the core embeds.
const GBA_FREE_BIOS: &str = "vendor/rustboyadvance-ng/core/benches/roms/normatt_gba_bios.bin";

fn finish_lift(
    ctx: &mut Ctx,
    id: &str,
    module: IrModule,
    image: Vec<u8>,
    bios: Option<(PathBuf, Vec<u8>)>,
    machine: &str,
) -> StageReport {
    let dir = ctx.dir("lift");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return report(Stage::Lift, id, StageStatus::Failed, e.to_string());
    }
    let ir_path = dir.join("ir.json");
    if let Err(e) = serde_json::to_vec_pretty(&module)
        .map_err(|e| e.to_string())
        .and_then(|j| std::fs::write(&ir_path, j).map_err(|e| e.to_string()))
    {
        return report(Stage::Lift, id, StageStatus::Failed, e);
    }
    let stats = module.stats();
    let coverage = if stats.instructions == 0 {
        0.0
    } else {
        stats.lifted as f64 / stats.instructions as f64
    };
    let status = if stats.functions == 0 {
        StageStatus::Failed
    } else {
        StageStatus::Ok
    };
    let mut r = report(
        Stage::Lift,
        id,
        status,
        format!(
            "{} blocks, {} instructions, {:.1}% translated; {} handed to the {machine} interpreter",
            stats.functions,
            stats.instructions,
            coverage * 100.0,
            stats.unlifted
        ),
    );
    r.metrics.insert("blocks".into(), stats.functions);
    r.metrics.insert("instructions".into(), stats.instructions);
    r.metrics.insert("fallbacks".into(), stats.unlifted);
    r.artifacts.push(artifact("ir", &ir_path));
    r.output = serde_json::to_value(LiftOutput {
        ir: ir_path.display().to_string(),
        stats,
        coverage,
    })
    .unwrap_or_default();
    ctx.ir = Some(module);
    ctx.guest_embed = Some(Embed {
        image,
        bios: bios.as_ref().map(|b| b.1.clone()),
    });
    ctx.guest = Some(GuestBuild {
        machine: machine.into(),
        bios: bios.map(|b| b.0),
        ..GuestBuild::default()
    });
    r
}

fn read_bios(ctx: &Ctx, default: Option<&str>) -> Result<Option<(PathBuf, Vec<u8>)>, String> {
    let path = ctx
        .opts
        .recompile
        .as_ref()
        .and_then(|r| r.bios.clone())
        .or_else(|| default.and_then(|d| root_file(ctx, d)));
    match path {
        Some(p) => std::fs::read(&p)
            .map(|b| Some((p.clone(), b)))
            .map_err(|e| format!("{}: {e}", p.display())),
        None => Ok(None),
    }
}

/// `armv4t-lift`: GBA cartridge ROM (and the BIOS it runs with).
pub fn lift_gba(ctx: &mut Ctx) -> StageReport {
    let id = "armv4t-lift";
    let Some(path) = ctx.payload.clone() else {
        return report(Stage::Lift, id, StageStatus::Skipped, "no payload");
    };
    let rom = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e.to_string()),
    };
    let bios = match read_bios(ctx, Some(GBA_FREE_BIOS)) {
        Ok(b) => b,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e),
    };
    let mut regions = Vec::new();
    let mut entries = vec![(0x0800_0000, lift_armv4t::Isa::Arm)];
    if let Some((_, b)) = &bios {
        regions.push(lift_armv4t::Region {
            name: "bios".into(),
            base: 0,
            data: b.clone(),
        });
        // Reset, undefined, SWI, prefetch/data abort, IRQ and FIQ vectors.
        for v in [0x00, 0x04, 0x08, 0x0c, 0x10, 0x18, 0x1c] {
            entries.push((v, lift_armv4t::Isa::Arm));
        }
    }
    regions.push(lift_armv4t::Region {
        name: "rom".into(),
        base: 0x0800_0000,
        data: rom.clone(),
    });
    let module = lift_armv4t::lift(
        &regions,
        &entries,
        0x0800_0000,
        lift_armv4t::Limits {
            max_insns: ctx.opts.max_insns.max(400_000),
        },
    );
    finish_lift(ctx, id, module, rom, bios, "gba")
}

/// `r3000a-lift`: PlayStation BIOS and PS-EXE.
pub fn lift_psx(ctx: &mut Ctx) -> StageReport {
    let id = "r3000a-lift";
    let Some(path) = ctx.payload.clone() else {
        return report(Stage::Lift, id, StageStatus::Skipped, "no payload");
    };
    let input = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e.to_string()),
    };
    let is_exe = input.starts_with(b"PS-X EXE");
    let bios = if is_exe {
        match read_bios(ctx, None) {
            Ok(Some(b)) => Some(b),
            Ok(None) => {
                return report(
                    Stage::Lift,
                    id,
                    StageStatus::Failed,
                    "a PS-EXE needs --bios <512 KiB BIOS> (bep add free-firmware openbios)",
                );
            }
            Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e),
        }
    } else {
        Some((path.clone(), input.clone()))
    };
    let Some((bios_path, bios_bytes)) = bios else {
        unreachable!()
    };
    if bios_bytes.len() != 0x8_0000 {
        return report(
            Stage::Lift,
            id,
            StageStatus::Failed,
            format!(
                "PlayStation BIOS must be 512 KiB, got {} bytes",
                bios_bytes.len()
            ),
        );
    }
    let exe = if is_exe { Some(input.as_slice()) } else { None };
    let module = match lift_mips::lift_psx(
        &bios_bytes,
        exe,
        lift_mips::Limits {
            max_insns: ctx.opts.max_insns.max(400_000),
        },
    ) {
        Ok(m) => m,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e),
    };
    // The crate embeds the PS-EXE as its image; a recompiled BIOS boots the shell (no media).
    let image = if is_exe { input } else { Vec::new() };
    finish_lift(ctx, id, module, image, Some((bios_path, bios_bytes)), "psx")
}

/// `6502-lift`: NES iNES cartridge PRG-ROM.
pub fn lift_nes(ctx: &mut Ctx) -> StageReport {
    let id = "6502-lift";
    let Some(path) = ctx.payload.clone() else {
        return report(Stage::Lift, id, StageStatus::Skipped, "no payload");
    };
    let rom = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e.to_string()),
    };
    let module = match lift_6502::lift_ines(
        &rom,
        lift_6502::Limits {
            max_insns: ctx.opts.max_insns.max(200_000),
        },
    ) {
        Ok(m) => m,
        Err(e) => return report(Stage::Lift, id, StageStatus::Failed, e),
    };
    finish_lift(ctx, id, module, rom, None, "nes")
}

fn crate_name(ctx: &Ctx) -> String {
    let stem = ctx
        .payload
        .as_ref()
        .and_then(|p| p.file_stem())
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_else(|| "image".into());
    let clean: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let clean = clean.trim_matches('-');
    let machine = ctx.guest.as_ref().map_or("guest", |g| g.machine.as_str());
    format!(
        "recomp-{machine}-{}",
        if clean.is_empty() { "image" } else { clean }
    )
}

/// `emit-console-rust`: write the Cargo crate over the Bun Engine core.
pub fn emit(ctx: &mut Ctx) -> StageReport {
    let id = "emit-console-rust";
    let Some(m) = ctx.ir.as_ref() else {
        return report(Stage::Decompile, id, StageStatus::Skipped, "no IR");
    };
    let Some(root) = ctx.opts.root.clone() else {
        return report(
            Stage::Decompile,
            id,
            StageStatus::Unavailable,
            "Bun OS checkout not found (set BUN_OS_ROOT): the crate links crates/bun-engine-core",
        );
    };
    let engine = root.join("crates").join("bun-engine-core");
    let Some(embed) = ctx.guest_embed.clone() else {
        return report(
            Stage::Decompile,
            id,
            StageStatus::Skipped,
            "no embedded image",
        );
    };
    let name = crate_name(ctx);
    let dir = ctx.dir("crate");
    match write_crate(m, &dir, &name, &engine, &embed) {
        Ok(files) => {
            let mut r = report(
                Stage::Decompile,
                id,
                StageStatus::Ok,
                format!("{name}: {} files over bun_engine::recomp", files.len()),
            );
            for f in &files {
                r.artifacts.push(artifact(
                    if f.extension().is_some_and(|e| e == "rs") {
                        "rust"
                    } else {
                        "file"
                    },
                    f,
                ));
            }
            if let Some(g) = ctx.guest.as_mut() {
                g.crate_dir = Some(dir);
                g.name = name;
            }
            r
        }
        Err(e) => report(Stage::Decompile, id, StageStatus::Failed, e),
    }
}

/// Cargo command prefix: `BUNRE_CARGO` (JSON array or a single program), else the serialized
/// Bun OS wrapper on Windows (`bun scripts/cargo.ts exec --`),
/// else `cargo`.
fn cargo_prefix(root: &Path) -> Vec<String> {
    if let Ok(v) = std::env::var("BUNRE_CARGO") {
        if let Ok(list) = serde_json::from_str::<Vec<String>>(&v) {
            if !list.is_empty() {
                return list;
            }
        }
        if !v.trim().is_empty() {
            return vec![v];
        }
    }
    let script = root.join("scripts").join("cargo.ts");
    if cfg!(windows) && script.is_file() && which("bun").is_some() {
        return ["bun"]
            .iter()
            .map(|s| (*s).to_string())
            .chain([script.display().to_string(), "exec".into(), "--".into()])
            .collect();
    }
    vec!["cargo".into()]
}

/// Shared target directory of recompiled crates: the checkout's `target/`, where the serialized
/// wrapper builds, so dependencies are compiled once for every recompiled image.
fn target_dir(root: &Path) -> PathBuf {
    root.join("target")
}

/// `cargo-recompile`: build the crate for the requested target.
pub fn build(ctx: &mut Ctx) -> StageReport {
    let id = "cargo-recompile";
    let (Some(g), Some(rc), Some(root)) = (
        ctx.guest.clone(),
        ctx.opts.recompile.clone(),
        ctx.opts.root.clone(),
    ) else {
        return report(Stage::Rebuild, id, StageStatus::Skipped, "nothing to build");
    };
    let Some(dir) = g.crate_dir.clone() else {
        return report(Stage::Rebuild, id, StageStatus::Skipped, "no crate");
    };
    let prefix = cargo_prefix(&root);
    let Some(program) = which(&prefix[0]) else {
        return report(
            Stage::Rebuild,
            id,
            StageStatus::Unavailable,
            format!("`{}` not on PATH", prefix[0]),
        );
    };
    let manifest = dir.join("Cargo.toml");
    let mut args: Vec<String> = prefix[1..].to_vec();
    let tdir = target_dir(&root);
    args.extend([
        "build".into(),
        "--release".into(),
        "--manifest-path".into(),
        manifest.display().to_string(),
        "--target-dir".into(),
        tdir.display().to_string(),
    ]);
    match rc.target {
        RecompTarget::Exe => args.extend(["--bin".into(), g.name.clone()]),
        RecompTarget::Wasm => args.extend([
            "--lib".into(),
            "--target".into(),
            "wasm32-unknown-unknown".into(),
        ]),
    }
    // A bare wasm32 module has no entropy source and no JavaScript glue: getrandom (pulled in by
    // TetaNES through rand) uses its `unsupported` backend there. Recompiled machines start from
    // deterministic memory, so the random path is linked but never taken.
    let env: Vec<(String, String)> = match rc.target {
        RecompTarget::Wasm => vec![(
            "CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS".into(),
            r#"--cfg getrandom_backend="unsupported""#.into(),
        )],
        RecompTarget::Exe => Vec::new(),
    };
    let timeout = Duration::from_secs(ctx.opts.timeout_secs.max(3600));
    // The serialized wrapper refuses to start while another native build owns the host: wait
    // for the slot instead of failing.
    let started = std::time::Instant::now();
    let res = loop {
        let r = run_cmd(&program, &args, Some(&root), &env, timeout);
        let busy = r.as_ref().is_ok_and(|x| {
            !x.ok() && format!("{}{}", x.stdout, x.stderr).contains("build owns this Windows host")
        });
        if !busy || started.elapsed() > timeout {
            break r;
        }
        std::thread::sleep(Duration::from_secs(60));
    };
    let built = match rc.target {
        RecompTarget::Exe => {
            tdir.join("release")
                .join(format!("{}{}", g.name, std::env::consts::EXE_SUFFIX))
        }
        RecompTarget::Wasm => tdir
            .join("wasm32-unknown-unknown")
            .join("release")
            .join(format!("{}.wasm", g.name.replace('-', "_"))),
    };
    match res {
        Ok(x) if x.ok() && built.is_file() => {
            let bin = ctx.dir("bin");
            let _ = std::fs::create_dir_all(&bin);
            let dest = bin.join(built.file_name().unwrap_or_default());
            if let Err(e) = std::fs::copy(&built, &dest) {
                return report(
                    Stage::Rebuild,
                    id,
                    StageStatus::Failed,
                    format!("{}: {e}", dest.display()),
                );
            }
            let mut r = report(
                Stage::Rebuild,
                id,
                StageStatus::Ok,
                format!("{} built for {:?}", g.name, rc.target),
            );
            r.artifacts.push(artifact(
                if rc.target == RecompTarget::Exe {
                    "executable"
                } else {
                    "wasm"
                },
                &dest,
            ));
            if let Some(gm) = ctx.guest.as_mut() {
                gm.artifact = Some(dest);
            }
            r
        }
        Ok(x) => report(
            Stage::Rebuild,
            id,
            StageStatus::Failed,
            format!(
                "cargo failed (exit {:?}{}): {}",
                x.code,
                if x.timed_out { ", timeout" } else { "" },
                tail(&format!("{}\n{}", x.stderr, x.stdout), 2400)
            ),
        ),
        Err(e) => report(Stage::Rebuild, id, StageStatus::Failed, e),
    }
}

/// Locate the Bun Engine interpreter CLI (`bun-engine run`).
fn bun_engine_bin(root: &Path) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("BUN_ENGINE_NATIVE")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
    {
        return Some(p);
    }
    let exe = format!("bun-engine{}", std::env::consts::EXE_SUFFIX);
    let t = target_dir(root);
    ["release", "debug"]
        .iter()
        .map(|p| t.join(p).join(&exe))
        .find(|p| p.is_file())
        .or_else(|| {
            which("bun-engine")
                .filter(|p| p.extension().is_some_and(|e| e == "exe") || !cfg!(windows))
        })
}

fn ppm(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn run_json(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<serde_json::Value, String> {
    let x = run_cmd(program, args, cwd, &[], timeout)?;
    if !x.ok() {
        return Err(format!(
            "exit {:?}{}: {}",
            x.code,
            if x.timed_out { " (timeout)" } else { "" },
            tail(&format!("{}\n{}", x.stderr, x.stdout), 800)
        ));
    }
    let line = x
        .stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .ok_or_else(|| format!("no JSON on stdout: {}", tail(&x.stdout, 400)))?;
    serde_json::from_str(line).map_err(|e| e.to_string())
}

const WASM_RUNNER: &str = r#"// Generated by `bunre recompile`: run a recompiled wasm32 module under Bun and dump its screen.
const [wasmPath, frames, out, interp] = Bun.argv.slice(2);
const { instance } = await WebAssembly.instantiate(await Bun.file(wasmPath).arrayBuffer(), {});
const e = instance.exports;
if (!e.recomp_init(interp === "1" ? 1 : 0)) throw new Error("recomp_init failed");
const t0 = performance.now();
const done = e.recomp_frames(Number(frames));
const seconds = (performance.now() - t0) / 1000;
const len = e.recomp_screen(0);
const w = e.recomp_screen_width(), h = e.recomp_screen_height();
const rgb = new Uint8Array(e.memory.buffer, e.recomp_screen_ptr(), len);
await Bun.write(`${out}/screen0.ppm`, new Blob([`P6\n${w} ${h}\n255\n`, rgb.slice()]));
const s = (i) => e.recomp_stat(i);
const native = s(0), interpreted = s(1), fallbacks = s(2);
const total = native + interpreted + fallbacks;
console.log(JSON.stringify({ frames: done, seconds, interp: interp === "1", native, interpreted, fallbacks, entries: s(3), nativeRatio: total ? native / total : 0 }));
"#;

/// `recompile-verify`: run the recompiled build, the same build in interpreter mode and the
/// `bun-engine run` interpreter, and compare the frame buffers.
pub fn verify(ctx: &mut Ctx) -> StageReport {
    let id = "recompile-verify";
    let (Some(g), Some(rc)) = (ctx.guest.clone(), ctx.opts.recompile.clone()) else {
        return report(Stage::Verify, id, StageStatus::Skipped, "nothing built");
    };
    let Some(art) = g.artifact.clone() else {
        return report(Stage::Verify, id, StageStatus::Skipped, "nothing built");
    };
    let frames = rc.frames.to_string();
    let vdir = ctx.dir("verify");
    let timeout = Duration::from_secs(ctx.opts.timeout_secs.max(600));
    let mut checks = Vec::new();
    let mut outputs = serde_json::Map::new();
    let runs: Vec<(&str, bool)> = vec![("recompiled", false), ("interpreter", true)];
    for (name, interp) in &runs {
        let out = vdir.join(name);
        let _ = std::fs::create_dir_all(&out);
        let res = match rc.target {
            RecompTarget::Exe => run_json(
                &art,
                &[
                    "--frames".into(),
                    frames.clone(),
                    "--out".into(),
                    out.display().to_string(),
                    "--json".into(),
                ]
                .into_iter()
                .chain(interp.then(|| "--interp".to_string()))
                .chain(
                    rc.input
                        .iter()
                        .flat_map(|i| ["--input".to_string(), i.clone()]),
                )
                .collect::<Vec<_>>(),
                None,
                timeout,
            ),
            RecompTarget::Wasm => {
                let script = vdir.join("run-wasm.ts");
                let _ = std::fs::write(&script, WASM_RUNNER);
                match which("bun") {
                    Some(bun) => run_json(
                        &bun,
                        &[
                            script.display().to_string(),
                            art.display().to_string(),
                            frames.clone(),
                            out.display().to_string(),
                            if *interp { "1".into() } else { "0".into() },
                        ],
                        None,
                        timeout,
                    ),
                    None => Err("bun not on PATH (needed to run the wasm module)".into()),
                }
            }
        };
        match res {
            Ok(v) => {
                if !interp {
                    let native = v
                        .get("native")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0);
                    let ratio = v
                        .get("nativeRatio")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0);
                    checks.push(Check {
                        name: "translated-code-ran".into(),
                        ok: native > 0.0,
                        detail: format!(
                            "{native} instructions executed by translated code ({:.1}% of all)",
                            ratio * 100.0
                        ),
                    });
                }
                checks.push(Check {
                    name: format!("{name}-runs"),
                    ok: true,
                    detail: v.to_string(),
                });
                outputs.insert((*name).into(), v);
            }
            Err(e) => checks.push(Check {
                name: format!("{name}-runs"),
                ok: false,
                detail: e,
            }),
        }
    }
    let rec = ppm(&vdir.join("recompiled").join("screen0.ppm"));
    let int = ppm(&vdir.join("interpreter").join("screen0.ppm"));
    match (&rec, &int) {
        (Ok(a), Ok(b)) => checks.push(Check {
            name: "framebuffer-equals-interpreter-mode".into(),
            ok: a == b,
            detail: format!(
                "{} vs {} bytes{}",
                a.len(),
                b.len(),
                if a == b { ", identical" } else { ", DIFFERENT" }
            ),
        }),
        _ => checks.push(Check {
            name: "framebuffer-equals-interpreter-mode".into(),
            ok: false,
            detail: "missing screen dump".into(),
        }),
    }
    // Console (TTY, debug port) output of the translated run must match the interpreted run.
    if let (Some(a), Some(b)) = (
        outputs
            .get("recompiled")
            .and_then(|v| v.get("console"))
            .and_then(serde_json::Value::as_str),
        outputs
            .get("interpreter")
            .and_then(|v| v.get("console"))
            .and_then(serde_json::Value::as_str),
    ) {
        checks.push(Check {
            name: "console-equals-interpreter-mode".into(),
            ok: a == b,
            detail: format!("{} vs {} bytes", a.len(), b.len()),
        });
    }
    // Reference: the Bun Engine interpreter CLI on the original input.
    let system = match g.machine.as_str() {
        "gba" => "gba",
        "psx" => "psx",
        _ => "nes",
    };
    let mut skipped = Vec::new();
    // `bun-engine run psx` boots media (PS-EXE or disc) on a BIOS; a recompiled BIOS alone has
    // no media, so only the in-binary interpreter comparison applies.
    let scripted = rc.input.is_some();
    let bios_only = g.machine == "psx"
        && ctx
            .payload
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .is_some_and(|b| !b.starts_with(b"PS-X EXE"));
    if scripted {
        skipped.push(
            "framebuffer-equals-bun-engine-run: `bun-engine run` has no scripted input".to_string(),
        );
    } else if bios_only {
        skipped.push(
            "framebuffer-equals-bun-engine-run: `bun-engine run psx` needs a PS-EXE or disc image"
                .to_string(),
        );
    } else if let (Some(root), Some(input)) = (ctx.opts.root.clone(), ctx.payload.clone()) {
        match bun_engine_bin(&root) {
            Some(be) => {
                let out = vdir.join("bun-engine");
                let _ = std::fs::create_dir_all(&out);
                let mut args = vec![
                    "run".to_string(),
                    system.into(),
                    input.display().to_string(),
                    "--headless".into(),
                    "--frames".into(),
                    frames.clone(),
                    "--out".into(),
                    out.display().to_string(),
                ];
                if let Some(b) = g.bios.as_ref().filter(|b| **b != input) {
                    args.extend(["--bios".into(), b.display().to_string()]);
                }
                match run_cmd(&be, &args, None, &[], timeout) {
                    Ok(x) if x.ok() => match (&rec, ppm(&out.join("screen0.ppm"))) {
                        (Ok(a), Ok(b)) => checks.push(Check {
                            name: "framebuffer-equals-bun-engine-run".into(),
                            ok: *a == b,
                            detail: format!(
                                "{} `{}`: {}",
                                be.display(),
                                args.join(" "),
                                if *a == b { "identical" } else { "DIFFERENT" }
                            ),
                        }),
                        (_, Err(e)) => checks.push(Check {
                            name: "framebuffer-equals-bun-engine-run".into(),
                            ok: false,
                            detail: e,
                        }),
                        (Err(e), _) => checks.push(Check {
                            name: "framebuffer-equals-bun-engine-run".into(),
                            ok: false,
                            detail: e.clone(),
                        }),
                    },
                    Ok(x) => checks.push(Check {
                        name: "framebuffer-equals-bun-engine-run".into(),
                        ok: false,
                        detail: format!("bun-engine exit {:?}: {}", x.code, tail(&x.stderr, 600)),
                    }),
                    Err(e) => checks.push(Check {
                        name: "framebuffer-equals-bun-engine-run".into(),
                        ok: false,
                        detail: e,
                    }),
                }
            }
            None => checks.push(Check {
                name: "framebuffer-equals-bun-engine-run".into(),
                ok: false,
                detail: "bun-engine binary not found (BUN_ENGINE_NATIVE or target/{release,debug})"
                    .into(),
            }),
        }
    }
    let all = checks.iter().all(|c| c.ok);
    let mut r = report(
        Stage::Verify,
        id,
        if all {
            StageStatus::Ok
        } else {
            StageStatus::Partial
        },
        checks
            .iter()
            .map(|c| format!("{}={}", c.name, if c.ok { "ok" } else { "FAIL" }))
            .collect::<Vec<_>>()
            .join(", "),
    );
    for name in ["recompiled", "interpreter", "bun-engine"] {
        let p = vdir.join(name).join("screen0.ppm");
        if p.is_file() {
            r.artifacts.push(artifact("screen", &p));
        }
    }
    r.output = serde_json::json!({ "checks": serde_json::to_value(VerifyOutput { checks }).unwrap_or_default()["checks"].clone(), "runs": outputs, "skipped": skipped });
    r
}
