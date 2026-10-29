// SPDX-License-Identifier: Apache-2.0
//! `bunre dbxv2`: native counterpart of the dbxv2 Python CLI (Dragon Ball Xenoverse 2).
//!
//! Commands read the game install read-only and write only below explicit output paths.
//! `extract`, `cpk`, `tex`, `audio`, `index`, `classify`, `search`, `stats` and `all` need the
//! `dbxv2` feature; the other commands are always built.

use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
    time::{SystemTime, UNIX_EPOCH},
};

use bun_re::game::{
    convert::{global_report, models_manifest, parse_in_place, text_in_place},
    formats::{emb_archive::EmbArchive, sav_file::SaveFile},
    inventory::inventory_install,
    reverse::reverse_install,
    text::{extract_msg_text, extract_msg_tree},
    world::xenoverse3::xenoverse3_prototype_map,
};
use serde_json::{Value, json};

const USAGE: &str = "\
Usage: bunre dbxv2 <command> ...
  inventory <game> [--output <file>]          install inventory (Python `map`)
  reverse <game> [--output <file>]            PE report of START.exe and bin/*.exe|dll
  extract <game> --out <dir> [--cpk <name>...] [--all-cpk] [--include-movies]
          [--max-gb <n>] [--no-skip-existing] [--threads <n>]
  cpk <file.cpk> --output-dir <new-dir>       extract one archive + cpk_manifest.json
  merge <out>/cpk --out <new-dir>             hard-link the extracted archives into one tree
                                              in DBXV2 mount precedence (patch/DLC over base)
  unified <root>... [--search <q> [--limit <n>] | --read <game/path> | --describe <game/path>]
          [--out <file>]                      mount several games under one <game>/<path> view
  emb <file.emb> --output-dir <new-dir>       unpack one EMB container
  emd-glb <file.emd> --out <file.glb>         export a DBXV2 model to GLB (renders via nie render)
  chara-glb <chara-dir> <prefix> --out <glb>  assemble a whole character's parts into one GLB
  tex <root> | audio <root> | models <root> | parse <root>
  text <file.msg> [--output <new-file>] | text <dir> [--output-dir <new-dir>]
  report <out> [--game <game>]                aggregate manifests -> reports/GLOBAL_REPORT.json
  index <out> | classify <out> | stats <out> | search <query> --out <out> [--limit <n>]
  sav <info|dump|decrypt|get|set|clear-cac|max-items|unlock-skills> --file <DBXV2.sav>
          [--out <dir>] [--cac <n>] [--field <name>] [--offset <n>] [--value <n>]
          [--output <file>] [--no-backup]
  tools list [--category <name>] [--catalog <modding_tools.json>]
  all <game> --out <dir> [extract options]    inventory+reverse+extract+conversions+report+index
  map [--output <file>] | catalog              Xenoverse 3 prototype map | Dragon Ball catalog";

/// Positional arguments and `--name value` / `--flag` options of one command.
struct Args {
    positional: Vec<String>,
    options: HashMap<String, Vec<String>>,
}

const FLAGS: [&str; 5] = [
    "--all-cpk",
    "--include-movies",
    "--no-skip-existing",
    "--no-backup",
    "--all",
];

impl Args {
    fn parse(args: impl Iterator<Item = OsString>) -> Option<Self> {
        let mut positional = Vec::new();
        let mut options: HashMap<String, Vec<String>> = HashMap::new();
        let mut args = args
            .map(|value| value.to_string_lossy().into_owned())
            .peekable();
        while let Some(arg) = args.next() {
            if !arg.starts_with("--") {
                positional.push(arg);
            } else if FLAGS.contains(&arg.as_str()) {
                options.entry(arg).or_default();
            } else if arg == "--cpk" {
                let values = options.entry(arg).or_default();
                while let Some(value) = args.next_if(|value| !value.starts_with("--")) {
                    values.push(value);
                }
            } else {
                let value = args.next()?;
                options.entry(arg).or_default().push(value);
            }
        }
        Some(Self {
            positional,
            options,
        })
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.options
            .get(name)
            .and_then(|values| values.last())
            .map(String::as_str)
    }

    fn flag(&self, name: &str) -> bool {
        self.options.contains_key(name)
    }

    fn only(&self, allowed: &[&str]) -> bool {
        self.options
            .keys()
            .all(|key| allowed.contains(&key.as_str()))
    }
}

pub fn main(mut args: impl Iterator<Item = OsString>) -> ExitCode {
    let Some(command) = args.next() else {
        return usage();
    };
    let Some(args) = Args::parse(args) else {
        return usage();
    };
    match command.to_string_lossy().as_ref() {
        "map" if args.positional.is_empty() && args.only(&["--output"]) => {
            emit(args.get("--output"), &xenoverse3_prototype_map())
        }
        "catalog" if args.positional.is_empty() && args.options.is_empty() => {
            print_json(&bun_re::game::get_dragon_ball_catalog())
        }
        "inventory" if args.positional.len() == 1 && args.only(&["--output"]) => {
            match inventory_install(Path::new(&args.positional[0])) {
                Ok(inventory) => emit(args.get("--output"), &inventory),
                Err(error) => fail(format!("inventory failed: {error}")),
            }
        }
        "reverse" if args.positional.len() == 1 && args.only(&["--output"]) => emit(
            args.get("--output"),
            &reverse_install(Path::new(&args.positional[0])),
        ),
        "emb" if args.positional.len() == 1 && args.only(&["--output-dir"]) => {
            match args.get("--output-dir") {
                Some(destination) => emb(Path::new(&args.positional[0]), Path::new(destination)),
                None => usage(),
            }
        }
        "text" if args.positional.len() == 1 && args.only(&["--output", "--output-dir"]) => {
            text(&args)
        }
        "models" if args.positional.len() == 1 && args.options.is_empty() => {
            report_result(models_manifest(Path::new(&args.positional[0])))
        }
        "parse" if args.positional.len() == 1 && args.options.is_empty() => {
            report_result(parse_in_place(Path::new(&args.positional[0])))
        }
        "report" if args.positional.len() == 1 && args.only(&["--game"]) => {
            report_result(global_report(Path::new(&args.positional[0]), &utc_now()))
        }
        "sav" if args.positional.len() == 1 => sav(&args),
        "tools"
            if args
                .positional
                .first()
                .is_some_and(|action| action == "list") =>
        {
            tools(&args)
        }
        "tools" => fail("only `tools list` is native; cloning stays in the Python CLI"),
        #[cfg(feature = "dbxv2")]
        other => media::main(other, &args),
        #[cfg(not(feature = "dbxv2"))]
        "extract" | "cpk" | "tex" | "audio" | "index" | "classify" | "search" | "stats" | "all" => {
            fail("this build lacks the `dbxv2` feature")
        }
        #[cfg(not(feature = "dbxv2"))]
        _ => usage(),
    }
}

fn usage() -> ExitCode {
    eprintln!("{USAGE}");
    ExitCode::from(2)
}

fn fail(message: impl std::fmt::Display) -> ExitCode {
    eprintln!("bunre dbxv2: {message}");
    ExitCode::FAILURE
}

fn utc_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |time| time.as_secs());
    let (days, rest) = (seconds / 86_400, seconds % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

fn print_json(value: &impl serde::Serialize) -> ExitCode {
    match serde_json::to_string_pretty(value) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => fail(format!("could not encode JSON: {error}")),
    }
}

/// Print to stdout, or write to `output` when given.
fn emit(output: Option<&str>, value: &impl serde::Serialize) -> ExitCode {
    let Some(output) = output else {
        return print_json(value);
    };
    let json = match serde_json::to_vec_pretty(value) {
        Ok(json) => json,
        Err(error) => return fail(format!("could not encode JSON: {error}")),
    };
    if let Some(parent) = Path::new(output)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        && let Err(error) = fs::create_dir_all(parent)
    {
        return fail(format!("could not create {}: {error}", parent.display()));
    }
    match fs::write(output, json) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(format!("could not write {output}: {error}")),
    }
}

fn report_result(result: bun_re::game::Result<Value>) -> ExitCode {
    match result {
        Ok(value) => print_json(&value),
        Err(error) => fail(error),
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?
        .write_all(bytes)
}

fn emb(input: &Path, destination: &Path) -> ExitCode {
    if !input
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("emb"))
    {
        return fail("emb input must have a .emb extension");
    }
    let bytes = match fs::read(input) {
        Ok(bytes) => bytes,
        Err(error) => return fail(format!("could not read {}: {error}", input.display())),
    };
    let archive = match EmbArchive::parse(&bytes) {
        Ok(archive) => archive,
        Err(error) => return fail(format!("invalid EMB {}: {error}", input.display())),
    };
    if destination.exists() {
        return fail(format!(
            "output directory already exists: {}",
            destination.display()
        ));
    }
    if let Err(error) = fs::create_dir(destination) {
        return fail(format!(
            "could not create {}: {error}",
            destination.display()
        ));
    }
    let mut files = Vec::with_capacity(archive.entries.len());
    let mut total_bytes = 0u64;
    for (index, entry) in archive.entries.iter().enumerate() {
        let data = match archive.entry_bytes(&bytes, index) {
            Ok(data) => data,
            Err(error) => return fail(format!("invalid EMB entry {}: {error}", entry.name)),
        };
        let output = destination.join(&entry.name);
        if let Err(error) = write_new(&output, data) {
            return fail(format!("could not create {}: {error}", output.display()));
        }
        total_bytes += data.len() as u64;
        files.push(json!({ "file": entry.name, "sizeBytes": data.len() }));
    }
    print_json(&json!({
        "archive": input.file_name().map(|name| name.to_string_lossy()),
        "entryCount": files.len(),
        "totalBytes": total_bytes,
        "files": files,
    }))
}

fn text(args: &Args) -> ExitCode {
    let input = PathBuf::from(&args.positional[0]);
    if input.is_dir() {
        if args.get("--output").is_some() {
            return usage();
        }
        return match args.get("--output-dir") {
            Some(destination) => match extract_msg_tree(&input, Path::new(destination)) {
                Ok(manifest) => print_json(&manifest),
                Err(error) => fail(format!("text batch failed: {error}")),
            },
            None => report_result(text_in_place(&input)),
        };
    }
    if args.get("--output-dir").is_some() {
        return usage();
    }
    if !input
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("msg"))
    {
        return fail("text input must have a .msg extension");
    }
    let bytes = match fs::read(&input) {
        Ok(bytes) => bytes,
        Err(error) => return fail(format!("could not read {}: {error}", input.display())),
    };
    let text = extract_msg_text(&input, &bytes);
    let Some(output) = args.get("--output") else {
        return print_json(&text);
    };
    match serde_json::to_vec_pretty(&text)
        .map_err(std::io::Error::other)
        .and_then(|json| write_new(Path::new(output), &json))
    {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(format!("could not create {output}: {error}")),
    }
}

fn parse_int(text: &str) -> Option<i64> {
    let text = text.trim();
    let (negative, digits) = text
        .strip_prefix('-')
        .map_or((false, text), |rest| (true, rest));
    let value = if let Some(hex) = digits
        .strip_prefix("0x")
        .or_else(|| digits.strip_prefix("0X"))
    {
        i64::from_str_radix(hex, 16).ok()?
    } else {
        digits.parse().ok()?
    };
    Some(if negative { -value } else { value })
}

fn backup(path: &Path, args: &Args) -> std::io::Result<()> {
    if args.flag("--no-backup") {
        return Ok(());
    }
    let mut target = path.as_os_str().to_owned();
    target.push(".bak");
    let target = PathBuf::from(target);
    if !target.exists() {
        fs::copy(path, &target)?;
        eprintln!("bunre dbxv2: sav backup -> {}", target.display());
    }
    Ok(())
}

fn sav(args: &Args) -> ExitCode {
    let allowed = [
        "--file",
        "--out",
        "--cac",
        "--field",
        "--offset",
        "--value",
        "--output",
        "--no-backup",
    ];
    if !args.only(&allowed) {
        return usage();
    }
    let Some(file) = args.get("--file").map(PathBuf::from) else {
        return fail("sav needs --file <DBXV2.sav> (a copy, never the live Steam save)");
    };
    let raw = match fs::read(&file) {
        Ok(raw) => raw,
        Err(error) => return fail(format!("could not read {}: {error}", file.display())),
    };
    let mut save = match SaveFile::decrypt(&raw) {
        Ok(save) => save,
        Err(error) => return fail(error),
    };
    let cac = match args.get("--cac").map(|value| value.parse::<usize>()) {
        Some(Ok(slot)) => Some(slot),
        Some(Err(_)) => return fail("--cac must be a slot index (0-7)"),
        None => None,
    };
    let offset = match args.get("--offset").map(parse_int) {
        Some(Some(offset)) if offset >= 0 => Some(offset as usize),
        Some(_) => return fail("--offset must be a non-negative integer (0x.. or decimal)"),
        None => None,
    };
    let value = match args.get("--value").map(parse_int) {
        Some(Some(value)) => Some(value),
        Some(None) => return fail("--value must be an integer"),
        None => None,
    };
    let field = args.get("--field");
    let global = field
        .and_then(SaveFile::global_offset)
        .filter(|_| cac.is_none());
    let action = args.positional[0].as_str();
    let result: bun_re::game::Result<Value> = (|| match action {
        "info" | "dump" => {
            let report = save.report()?;
            if let Some(out) = args.get("--out") {
                let target = Path::new(out).join("reports").join("sav.json");
                bun_re::game::convert::write_json(&target, &report)?;
            }
            Ok(serde_json::to_value(report)?)
        }
        "decrypt" => {
            let target = args
                .get("--output")
                .map_or_else(|| file.with_extension("dec.bin"), PathBuf::from);
            fs::write(&target, &save.body)?;
            Ok(json!({ "file": target.to_string_lossy(), "bytes": save.body.len() }))
        }
        "get" => match (offset, global, cac, field) {
            (Some(offset), _, _, _) => Ok(json!({ "offset": offset, "value": save.u32(offset)? })),
            (None, Some(global), _, Some(field)) => {
                Ok(json!({ "field": field, "value": save.u32(global)? }))
            }
            (None, None, Some(slot), Some(field)) => {
                Ok(json!({ "cac": slot, "field": field, "value": save.cac_get(slot, field)? }))
            }
            _ => Ok(json!({ "error": "bad_args" })),
        },
        "set" => {
            let Some(value) = value else {
                return Ok(json!({ "error": "bad_args" }));
            };
            let value = value as u32;
            let (target, old, offset_or_field) = match (offset, global, cac, field) {
                (Some(offset), ..) => (format!("u32@0x{offset:x}"), save.u32(offset)?, Ok(offset)),
                (None, Some(global), _, Some(field)) => {
                    (field.to_owned(), save.u32(global)?, Ok(global))
                }
                (None, None, Some(slot), Some(field)) => (
                    format!("CaC[{slot}].{field}"),
                    save.cac_get(slot, field)?,
                    Err((slot, field)),
                ),
                _ => return Ok(json!({ "error": "bad_args" })),
            };
            match offset_or_field {
                Ok(offset) => save.set_u32(offset, value)?,
                Err((slot, field)) => save.cac_set(slot, field, value)?,
            }
            backup(&file, args)?;
            fs::write(&file, save.encrypt()?)?;
            let reread = SaveFile::decrypt(&fs::read(&file)?)?;
            let new = match offset_or_field {
                Ok(offset) => reread.u32(offset)?,
                Err((slot, field)) => reread.cac_get(slot, field)?,
            };
            Ok(json!({ "target": target, "old": old, "new": new, "ok": new == value }))
        }
        "clear-cac" => {
            let Some(slot) = cac else {
                return Ok(json!({ "error": "bad_args" }));
            };
            let name = save.cac_name(slot)?;
            let was_valid = save.cac_valid(slot)?;
            backup(&file, args)?;
            save.clear_cac(slot)?;
            fs::write(&file, save.encrypt()?)?;
            let cleared = !SaveFile::decrypt(&fs::read(&file)?)?.cac_valid(slot)?;
            Ok(json!({ "cac": slot, "name": name, "was_valid": was_valid, "cleared": cleared }))
        }
        "max-items" => {
            let quantity = value.unwrap_or(99) as u16;
            backup(&file, args)?;
            save.max_items(quantity);
            fs::write(&file, save.encrypt()?)?;
            Ok(json!({ "action": "max-items", "qty": quantity }))
        }
        "unlock-skills" => {
            backup(&file, args)?;
            save.unlock_skills();
            fs::write(&file, save.encrypt()?)?;
            Ok(json!({ "action": "unlock-skills" }))
        }
        _ => Ok(json!({ "error": "unknown_action" })),
    })();
    report_result(result)
}

fn tools(args: &Args) -> ExitCode {
    if args.positional.len() != 1 || !args.only(&["--category", "--catalog"]) {
        return usage();
    }
    let catalog = args.get("--catalog").unwrap_or("modding_tools.json");
    let parsed: Value = match fs::read(catalog)
        .map_err(|error| error.to_string())
        .and_then(|raw| serde_json::from_slice(&raw).map_err(|error| error.to_string()))
    {
        Ok(parsed) => parsed,
        Err(error) => return fail(format!("could not read catalog {catalog}: {error}")),
    };
    let Some(categories) = parsed.get("categories").and_then(Value::as_object) else {
        return fail("catalog has no `categories` object");
    };
    let only = args.get("--category");
    let selected: serde_json::Map<String, Value> = categories
        .iter()
        .filter(|(name, _)| only.is_none_or(|only| only == name.as_str()))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    let count: usize = selected
        .values()
        .map(|category| {
            category
                .get("tools")
                .and_then(Value::as_array)
                .map_or(0, Vec::len)
        })
        .sum();
    print_json(&json!({ "count": count, "categories": selected }))
}

#[cfg(feature = "dbxv2")]
mod media {
    use std::{path::Path, process::ExitCode};

    use bun_re::game::{
        convert::{
            audio_in_place, global_report, models_manifest, parse_in_place, tex_in_place,
            text_in_place,
        },
        fs::cpk_stream::{ExtractOptions, extract_cpk, extract_install, merge_extracted},
        index::{build_index, reclassify, search, stats},
        inventory::inventory_install,
        reverse::reverse_install,
    };
    use serde_json::json;

    use super::{Args, emit, fail, print_json, report_result, usage, utc_now};

    /// `unified <root>... [--read <game/path>] [--out <file>]`: mount several installs under one
    /// streamed `<game>/<path>` namespace. With no `--read`, emit aggregate stats; with `--read`,
    /// stream that one entry (to `--out`, else report its byte length). Proves the two games mount
    /// and read through a single handle without extraction.
    fn unified(args: &Args) -> ExitCode {
        use bun_re::game::assets::Keys;
        use bun_re::game::assets::vfs::MountOptions;
        use bun_re::game::unified_vfs::UnifiedVfs;

        let roots: Vec<std::path::PathBuf> = args
            .positional
            .iter()
            .map(std::path::PathBuf::from)
            .collect();
        let options = MountOptions {
            keys: Keys::default(),
            profile: None,
            limits: None,
            skip_loose: false,
            only: Vec::new(),
        };
        let vfs = match UnifiedVfs::mount(&roots, &options) {
            Ok(vfs) => vfs,
            Err(error) => return fail(error),
        };
        if let Some(target) = args.get("--read") {
            let bytes = match vfs.read(target) {
                Ok(bytes) => bytes,
                Err(error) => return fail(error),
            };
            if let Some(out) = args.get("--out")
                && let Err(error) = std::fs::write(out, &bytes)
            {
                return fail(format!("could not write {out}: {error}"));
            }
            return print_json(&json!({
                "read": target,
                "bytes": bytes.len(),
                "out": args.get("--out"),
            }));
        }
        if let Some(query) = args.get("--search") {
            let limit = args
                .get("--limit")
                .and_then(|value| value.parse().ok())
                .unwrap_or(200);
            return emit(args.get("--out"), &vfs.search(query, limit));
        }
        if let Some(target) = args.get("--describe") {
            let runtime = bun_re::game::runtime::AssetRuntime::new(vfs);
            return match runtime.describe(target) {
                Ok(value) => emit(args.get("--out"), &value),
                Err(error) => fail(error),
            };
        }
        emit(args.get("--out"), &vfs.index())
    }

    /// Decode the sibling `<base>.emb` of an `.emd` into a PNG for [`emd_to_glb_textured`], or
    /// `None` when there is no readable texture package next to the model.
    fn texture_png_for_emd(emd_path: &Path) -> Option<Vec<u8>> {
        let emb_path = emd_path.with_extension("emb");
        let bytes = std::fs::read(&emb_path).ok()?;
        let emb = bun_re::game::EmbFile::parse(&bytes).ok()?;
        let texture = emb.decode_rgba(0).ok()?;
        bun_re::game::emd_gltf::encode_png_rgba(texture.width, texture.height, &texture.rgba)
    }

    /// Assemble every body part `<prefix>_*.emd` in `chara_dir` (skipping LOD meshes) into one
    /// textured GLB — a whole DBXV2 character through the nie renderer.
    fn chara_glb(chara_dir: &Path, prefix: &str, out: &str) -> ExitCode {
        let mut entries: Vec<std::path::PathBuf> = match std::fs::read_dir(chara_dir) {
            Ok(dir) => dir
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default();
                    name.starts_with(prefix) && name.ends_with(".emd") && !name.contains("_LOD")
                })
                .collect(),
            Err(error) => return fail(format!("could not list {}: {error}", chara_dir.display())),
        };
        entries.sort();
        if entries.is_empty() {
            return fail(format!("no {prefix}_*.emd under {}", chara_dir.display()));
        }

        // Keep each part's parsed EMD and PNG alive while assemble_glb borrows them.
        let mut owned: Vec<(bun_re::game::EmdFile, Option<Vec<u8>>)> = Vec::new();
        let mut names = Vec::new();
        for path in &entries {
            let Ok(bytes) = std::fs::read(path) else {
                continue;
            };
            let Ok(emd) = bun_re::game::EmdFile::parse(&bytes) else {
                continue;
            };
            owned.push((emd, texture_png_for_emd(path)));
            names.push(
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string(),
            );
        }
        if owned.is_empty() {
            return fail("no part parsed");
        }
        let refs: Vec<(&bun_re::game::EmdFile, Option<&[u8]>)> = owned
            .iter()
            .map(|(emd, tex)| (emd, tex.as_deref()))
            .collect();
        let glb = bun_re::game::emd_gltf::assemble_glb(&refs);
        let textured = owned.iter().filter(|(_, tex)| tex.is_some()).count();
        match std::fs::write(out, &glb) {
            Ok(()) => print_json(&json!({
                "character": prefix,
                "glb": out,
                "bytes": glb.len(),
                "parts": names,
                "textured_parts": textured,
            })),
            Err(error) => fail(format!("could not write {out}: {error}")),
        }
    }

    fn threads(args: &Args) -> usize {
        args.get("--threads")
            .and_then(|value| value.parse().ok())
            .unwrap_or_else(|| {
                std::thread::available_parallelism()
                    .map_or(4, usize::from)
                    .min(8)
            })
    }

    fn extract_options(args: &Args) -> Option<ExtractOptions> {
        Some(ExtractOptions {
            names: args.options.get("--cpk").cloned().unwrap_or_default(),
            all: args.flag("--all-cpk"),
            include_movies: args.flag("--include-movies"),
            max_gib: match args.get("--max-gb") {
                Some(value) => value.parse().ok()?,
                None => 3.0,
            },
            skip_existing: !args.flag("--no-skip-existing"),
            threads: threads(args),
        })
    }

    const EXTRACT_OPTIONS: [&str; 7] = [
        "--out",
        "--cpk",
        "--all-cpk",
        "--include-movies",
        "--max-gb",
        "--no-skip-existing",
        "--threads",
    ];

    pub fn main(command: &str, args: &Args) -> ExitCode {
        let single = args.positional.len() == 1;
        match command {
            "emd-glb" if single && args.only(&["--out"]) => {
                let Some(out) = args.get("--out") else {
                    return usage();
                };
                let input = Path::new(&args.positional[0]);
                let bytes = match std::fs::read(input) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        return fail(format!("could not read {}: {error}", input.display()));
                    }
                };
                let emd = match bun_re::game::EmdFile::parse(&bytes) {
                    Ok(emd) => emd,
                    Err(error) => return fail(format!("{}: {error}", input.display())),
                };
                // Resolve and decode the sibling `<base>.emb` texture package, when present.
                let texture = texture_png_for_emd(input);
                let glb = bun_re::game::emd_gltf::emd_to_glb_textured(&emd, texture.as_deref());
                let parts: usize = emd.parts.iter().map(|part| part.meshes.len()).sum();
                match std::fs::write(out, &glb) {
                    Ok(()) => print_json(&json!({
                        "emd": input.display().to_string(),
                        "glb": out,
                        "bytes": glb.len(),
                        "parts": emd.parts.len(),
                        "meshes": parts,
                        "textured": texture.is_some(),
                    })),
                    Err(error) => fail(format!("could not write {out}: {error}")),
                }
            }
            "chara-glb" if args.positional.len() == 2 && args.only(&["--out"]) => {
                let Some(out) = args.get("--out") else {
                    return usage();
                };
                chara_glb(Path::new(&args.positional[0]), &args.positional[1], out)
            }
            "merge" if single && args.only(&["--out"]) => {
                let Some(out) = args.get("--out") else {
                    return usage();
                };
                report_result(merge_extracted(
                    Path::new(&args.positional[0]),
                    Path::new(out),
                ))
            }
            "unified"
                if !args.positional.is_empty()
                    && args.only(&["--read", "--search", "--limit", "--describe", "--out"]) =>
            {
                unified(args)
            }
            "extract" if single && args.only(&EXTRACT_OPTIONS) => {
                let (Some(out), Some(options)) = (args.get("--out"), extract_options(args)) else {
                    return usage();
                };
                report_result(extract_install(
                    Path::new(&args.positional[0]),
                    Path::new(out),
                    &options,
                ))
            }
            "cpk" if single && args.only(&["--output-dir", "--threads"]) => {
                let Some(destination) = args.get("--output-dir").map(Path::new) else {
                    return usage();
                };
                let input = Path::new(&args.positional[0]);
                if !input
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("cpk"))
                {
                    return fail("cpk input must have a .cpk extension");
                }
                if destination.exists() {
                    return fail(format!(
                        "output directory already exists: {}",
                        destination.display()
                    ));
                }
                let manifest = match extract_cpk(input, destination, true, threads(args)) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        return fail(format!("could not extract {}: {error}", input.display()));
                    }
                };
                let path = destination.join("cpk_manifest.json");
                match serde_json::to_vec_pretty(&manifest)
                    .map_err(std::io::Error::other)
                    .and_then(|json| super::write_new(&path, &json))
                {
                    Ok(()) => print_json(&json!({
                        "archive": manifest.archive,
                        "entryCount": manifest.entry_count,
                        "totalBytes": manifest.total_bytes,
                        "manifest": path.to_string_lossy(),
                    })),
                    Err(error) => fail(format!("could not write {}: {error}", path.display())),
                }
            }
            "tex" if single && args.options.is_empty() => {
                report_result(tex_in_place(Path::new(&args.positional[0])))
            }
            "audio" if single && args.options.is_empty() => {
                report_result(audio_in_place(Path::new(&args.positional[0])))
            }
            "index" if single && args.options.is_empty() => {
                report_result(build_index(Path::new(&args.positional[0])))
            }
            "classify" if single && args.options.is_empty() => {
                report_result(reclassify(Path::new(&args.positional[0])))
            }
            "stats" if single && args.options.is_empty() => {
                report_result(stats(Path::new(&args.positional[0])))
            }
            "search" if single && args.only(&["--out", "--limit"]) => {
                let Some(out) = args.get("--out") else {
                    return usage();
                };
                let limit = args
                    .get("--limit")
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(30);
                report_result(search(Path::new(out), &args.positional[0], limit))
            }
            "all" if single && args.only(&EXTRACT_OPTIONS) => {
                let (Some(out), Some(options)) = (args.get("--out"), extract_options(args)) else {
                    return usage();
                };
                let game = Path::new(&args.positional[0]);
                let out = Path::new(out);
                let reports = out.join("reports");
                let result = (|| -> bun_re::game::Result<serde_json::Value> {
                    bun_re::game::convert::write_json(
                        &reports.join("map.json"),
                        &inventory_install(game)?,
                    )?;
                    bun_re::game::convert::write_json(
                        &reports.join("reverse_report.json"),
                        &reverse_install(game),
                    )?;
                    extract_install(game, out, &options)?;
                    let cpk = out.join("cpk");
                    let mut trees: Vec<_> = std::fs::read_dir(&cpk)?
                        .flatten()
                        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                        .map(|entry| entry.path())
                        .collect();
                    trees.sort();
                    for tree in &trees {
                        tex_in_place(tree)?;
                        audio_in_place(tree)?;
                        text_in_place(tree)?;
                        models_manifest(tree)?;
                        parse_in_place(tree)?;
                    }
                    let report = global_report(out, &utc_now())?;
                    build_index(out)?;
                    Ok(report)
                })();
                report_result(result)
            }
            _ => usage(),
        }
    }
}
