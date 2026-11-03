//! `bunos env`: read and edit `.env` files and show what Bun resolves from them.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::args::{Args, Spec, flag, option, short_flag, short_option};
use crate::dotenv::{self, Doc, Layer, Var};
use crate::fsutil;
use crate::mask;
use crate::{Io, errln, outln};

const USAGE: &str = "bunos env: read and edit .env files, and show what Bun loads from them

Usage:
  bunos env list [--file F]... [--process] [--sources] [--json] [--reveal]
  bunos env get KEY [--file F]... [--json] [--reveal]
  bunos env set KEY=VALUE... | KEY VALUE | KEY --stdin  [--file F]
  bunos env unset KEY... [--file F]
  bunos env check [--example .env.example] [--file F]... [--strict] [--json]
  bunos env files [--file F]... [--json]

Without --file, the files are read in the order Bun loads them for the current mode (lowest to
highest precedence): .env, .env.<mode>, .env.local (not in test mode), .env.<mode>.local. The
process environment wins over every file. With --file (repeatable, comma separated), only those
files are used and a later one wins, like bun --env-file. set and unset edit one file, .env by
default; comments, order, line endings and permissions are kept and the write is atomic.

Options:
  -f, --file F       .env file (alias --env-file)
      --cwd DIR      directory of the default files
      --mode MODE    development, production or test (default: from NODE_ENV)
      --no-process   ignore the process environment
      --no-expand    keep $VAR references as written
      --process      list: include variables that only the process environment defines
      --sources      list: print the file that provides each value
      --stdin        set: read the value from standard input
      --reveal       print secret values (hidden as ******** by default)
      --json         machine-readable output
  -h, --help         print this help

Values whose name looks secret (TOKEN, SECRET, PASSWORD, KEY, AUTH, ...) or that are URLs with a
password are hidden unless --reveal is given. Files that hold such values are kept private
(0600) on Unix. Exit status: 0 success, 1 failure (missing key, failed check, I/O), 2 usage.";

const SPECS: &[Spec] = &[
    short_option("file", 'f'),
    option("env-file"),
    option("cwd"),
    option("mode"),
    option("example"),
    flag("no-process"),
    flag("no-expand"),
    flag("process"),
    flag("sources"),
    flag("stdin"),
    flag("reveal"),
    flag("strict"),
    flag("json"),
    short_flag("help", 'h'),
];

enum Failure {
    Usage(String),
    Run(String),
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure::Run(message)
    }
}

type Outcome = Result<i32, Failure>;

pub fn main(args: &[String], io: &mut Io) -> i32 {
    let Some(sub) = args.first().map(String::as_str) else {
        outln!(io, "{USAGE}");
        return 0;
    };
    if matches!(sub, "help" | "-h" | "--help") {
        outln!(io, "{USAGE}");
        return 0;
    }
    let parsed = match Args::parse(&args[1..], SPECS) {
        Ok(parsed) => parsed,
        Err(message) => {
            errln!(io, "error: {message}");
            return 2;
        }
    };
    if parsed.has("help") {
        outln!(io, "{USAGE}");
        return 0;
    }
    let result = match sub {
        "list" | "ls" => list(io, &parsed),
        "get" => get(io, &parsed),
        "set" => set(io, &parsed),
        "unset" | "rm" | "delete" => unset(io, &parsed),
        "check" => check(io, &parsed),
        "files" => files(io, &parsed),
        other => Err(Failure::Usage(format!("unknown subcommand {other:?}"))),
    };
    match result {
        Ok(code) => code,
        Err(Failure::Usage(message)) => {
            errln!(io, "error: {message}\nRun `bunos env --help` for usage.");
            2
        }
        Err(Failure::Run(message)) => {
            errln!(io, "error: {message}");
            1
        }
    }
}

struct Scope {
    layers: Vec<Layer>,
    mode: String,
    explicit: bool,
}

fn mode_of(io: &Io, args: &Args) -> Result<String, Failure> {
    let mode = match args.value("mode") {
        Some(mode) => mode.to_string(),
        None => match io.env_var("NODE_ENV").as_deref() {
            Some("production") => "production".to_string(),
            Some("test") => "test".to_string(),
            _ => "development".to_string(),
        },
    };
    if !matches!(mode.as_str(), "development" | "production" | "test") {
        return Err(Failure::Usage(format!(
            "--mode must be development, production or test, not {mode:?}"
        )));
    }
    Ok(mode)
}

fn cwd_of(io: &Io, args: &Args) -> Result<PathBuf, Failure> {
    let base = io.current_dir()?;
    Ok(match args.value("cwd") {
        Some(dir) => base.join(dir),
        None => base,
    })
}

fn explicit_files(args: &Args) -> Vec<String> {
    let mut files = Vec::new();
    for value in args
        .values("file")
        .into_iter()
        .chain(args.values("env-file"))
    {
        for part in value.split(',') {
            let part = part.trim();
            if !part.is_empty() {
                files.push(part.to_string());
            }
        }
    }
    files
}

fn read_doc(path: &Path) -> Result<Option<Doc>, String> {
    match fs::read(path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(|text| Some(Doc::parse(&text)))
            .map_err(|_| format!("{} is not valid UTF-8", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) if path.is_dir() => Err(format!("{} is a directory ({e})", path.display())),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

fn scope(io: &Io, args: &Args) -> Result<Scope, Failure> {
    let cwd = cwd_of(io, args)?;
    let mode = mode_of(io, args)?;
    let given = explicit_files(args);
    let mut layers = Vec::new();
    if given.is_empty() {
        let mut names = vec![".env".to_string(), format!(".env.{mode}")];
        if mode != "test" {
            names.push(".env.local".to_string());
        }
        names.push(format!(".env.{mode}.local"));
        for name in names {
            let path = cwd.join(&name);
            layers.push(Layer {
                doc: read_doc(&path)?,
                label: name,
                path,
            });
        }
    } else {
        for name in &given {
            let path = cwd.join(name);
            layers.push(Layer {
                doc: read_doc(&path)?,
                label: name.clone(),
                path,
            });
        }
    }
    Ok(Scope {
        layers,
        mode,
        explicit: !given.is_empty(),
    })
}

fn resolved(io: &Io, args: &Args, scope: &Scope) -> Vec<Var> {
    let process = io.environ_map();
    dotenv::resolve(
        &scope.layers,
        &process,
        !args.has("no-process"),
        !args.has("no-expand"),
    )
}

fn shown(var: &Var, reveal: bool) -> (String, bool, bool) {
    let sensitive = mask::is_sensitive_env(&var.name, &var.value);
    if sensitive && !reveal {
        (mask::mask(&var.value), true, true)
    } else {
        (var.value.clone(), false, sensitive)
    }
}

fn var_json(var: &Var, reveal: bool) -> Value {
    let (value, masked, sensitive) = shown(var, reveal);
    json!({
        "name": var.name,
        "value": value,
        "masked": masked,
        "sensitive": sensitive,
        "source": var.source,
        "shadowed": var.shadowed,
    })
}

fn flat_value(value: &str) -> String {
    value.replace('\n', "\\n").replace('\r', "\\r")
}

fn list(io: &mut Io, args: &Args) -> Outcome {
    let scope = scope(io, args)?;
    let reveal = args.has("reveal");
    let mut vars = resolved(io, args, &scope);
    if !args.has("process") {
        vars.retain(Var::in_a_file);
    }
    vars.sort_by(|a, b| a.name.cmp(&b.name));
    if args.has("json") {
        let files: Vec<Value> = scope
            .layers
            .iter()
            .map(|l| json!({ "path": l.label, "exists": l.doc.is_some() }))
            .collect();
        let body = json!({
            "mode": scope.mode,
            "explicit": scope.explicit,
            "files": files,
            "variables": vars.iter().map(|v| var_json(v, reveal)).collect::<Vec<_>>(),
        });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
        return Ok(0);
    }
    for var in &vars {
        let (value, _, _) = shown(var, reveal);
        if args.has("sources") {
            outln!(io, "{}={}\t# {}", var.name, flat_value(&value), var.source);
        } else {
            outln!(io, "{}={}", var.name, flat_value(&value));
        }
    }
    Ok(0)
}

fn get(io: &mut Io, args: &Args) -> Outcome {
    let [key] = args.positional.as_slice() else {
        return Err(Failure::Usage("get needs exactly one KEY".to_string()));
    };
    let scope = scope(io, args)?;
    let vars = resolved(io, args, &scope);
    let var = vars.iter().find(|v| {
        if cfg!(windows) {
            v.name.eq_ignore_ascii_case(key)
        } else {
            v.name == *key
        }
    });
    let Some(var) = var else {
        return Err(Failure::Run(format!("{key} is not set")));
    };
    if args.has("json") {
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&var_json(var, args.has("reveal"))).unwrap_or_default()
        );
    } else {
        let (value, _, _) = shown(var, args.has("reveal"));
        outln!(io, "{value}");
    }
    Ok(0)
}

fn target_file(io: &Io, args: &Args) -> Result<PathBuf, Failure> {
    let files = explicit_files(args);
    if files.len() > 1 {
        return Err(Failure::Usage(
            "set and unset edit exactly one file: pass one --file".to_string(),
        ));
    }
    let cwd = cwd_of(io, args)?;
    Ok(cwd.join(files.first().map_or(".env", String::as_str)))
}

fn load_for_edit(path: &Path) -> Result<(Doc, Option<u32>), Failure> {
    let doc = read_doc(path)?.unwrap_or_else(|| Doc::parse(""));
    Ok((doc, fsutil::existing_mode(path)))
}

fn contains_secret(doc: &Doc) -> bool {
    doc.entries
        .iter()
        .any(|e| mask::is_sensitive_env(&e.key, &e.value))
}

fn save(path: &Path, doc: &Doc, existing_mode: Option<u32>) -> Result<(), Failure> {
    let mode = if contains_secret(doc) {
        Some(fsutil::private_mode(existing_mode))
    } else {
        existing_mode.or(if cfg!(unix) { Some(0o644) } else { None })
    };
    fsutil::atomic_write(path, doc.render().as_bytes(), mode)
        .map_err(|e| Failure::Run(format!("cannot write {}: {e}", path.display())))
}

fn set(io: &mut Io, args: &Args) -> Outcome {
    let path = target_file(io, args)?;
    let mut pairs: Vec<(String, String)> = Vec::new();
    if args.has("stdin") {
        let [key] = args.positional.as_slice() else {
            return Err(Failure::Usage(
                "set --stdin needs exactly one KEY".to_string(),
            ));
        };
        let mut text = io.read_stdin()?;
        if text.ends_with('\n') {
            text.pop();
            if text.ends_with('\r') {
                text.pop();
            }
        }
        pairs.push((key.clone(), text));
    } else if let [key, value] = args.positional.as_slice()
        && !key.contains('=')
    {
        pairs.push((key.clone(), value.clone()));
    } else if args.positional.is_empty() {
        return Err(Failure::Usage("set needs KEY=VALUE".to_string()));
    } else {
        for item in &args.positional {
            let Some((key, value)) = item.split_once('=') else {
                return Err(Failure::Usage(format!("{item:?} is not KEY=VALUE")));
            };
            pairs.push((key.to_string(), value.to_string()));
        }
    }
    let (mut doc, mode) = load_for_edit(&path)?;
    for (key, value) in &pairs {
        doc.set(key, value)?;
    }
    save(&path, &doc, mode)?;
    let name = path.file_name().map_or_else(
        || path.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    for (key, _) in &pairs {
        outln!(io, "{key} set in {name}");
    }
    Ok(0)
}

fn unset(io: &mut Io, args: &Args) -> Outcome {
    if args.positional.is_empty() {
        return Err(Failure::Usage("unset needs at least one KEY".to_string()));
    }
    let path = target_file(io, args)?;
    let (mut doc, mode) = load_for_edit(&path)?;
    let mut removed = 0;
    for key in &args.positional {
        let count = doc.unset(key);
        removed += count;
        if count == 0 {
            outln!(io, "{key} is not defined in {}", path.display());
        } else {
            outln!(io, "{key} removed");
        }
    }
    if removed > 0 {
        save(&path, &doc, mode)?;
    }
    Ok(0)
}

fn check(io: &mut Io, args: &Args) -> Outcome {
    let cwd = cwd_of(io, args)?;
    let example_path = cwd.join(args.value("example").unwrap_or(".env.example"));
    let Some(example) = read_doc(&example_path)? else {
        return Err(Failure::Run(format!(
            "{} does not exist",
            example_path.display()
        )));
    };
    let scope = scope(io, args)?;
    let vars = resolved(io, args, &scope);
    let defined = |name: &str| {
        vars.iter().find(|v| {
            if cfg!(windows) {
                v.name.eq_ignore_ascii_case(name)
            } else {
                v.name == name
            }
        })
    };
    let mut missing = Vec::new();
    let mut empty = Vec::new();
    let mut ok = 0usize;
    let expected = example.pairs();
    for (name, _) in &expected {
        match defined(name) {
            None => missing.push(name.clone()),
            Some(var) if var.value.is_empty() => empty.push(name.clone()),
            Some(_) => ok += 1,
        }
    }
    let mut extra: Vec<String> = vars
        .iter()
        .filter(|v| v.in_a_file() && !expected.iter().any(|(n, _)| n == &v.name))
        .map(|v| v.name.clone())
        .collect();
    extra.sort();
    let failed =
        !missing.is_empty() || !empty.is_empty() || (args.has("strict") && !extra.is_empty());
    if args.has("json") {
        let body = json!({
            "example": example_path.display().to_string(),
            "ok": ok,
            "missing": missing,
            "empty": empty,
            "extra": extra,
            "passed": !failed,
        });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    } else {
        for name in &missing {
            outln!(io, "missing  {name}");
        }
        for name in &empty {
            outln!(io, "empty    {name}");
        }
        for name in &extra {
            outln!(io, "extra    {name}");
        }
        outln!(
            io,
            "{} of {} variables from {} are set{}",
            ok,
            expected.len(),
            args.value("example").unwrap_or(".env.example"),
            if failed { " (check failed)" } else { "" }
        );
    }
    Ok(i32::from(failed))
}

fn files(io: &mut Io, args: &Args) -> Outcome {
    let scope = scope(io, args)?;
    if args.has("json") {
        let list: Vec<Value> = scope
            .layers
            .iter()
            .rev()
            .map(|l| {
                json!({
                    "path": l.label,
                    "resolved": l.path.display().to_string(),
                    "exists": l.doc.is_some(),
                    "variables": l.doc.as_ref().map(|d| d.pairs().len()),
                })
            })
            .collect();
        let body = json!({
            "mode": scope.mode,
            "explicit": scope.explicit,
            "processEnvironment": !args.has("no-process"),
            "precedence": "highest first",
            "files": list,
        });
        outln!(
            io,
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
        return Ok(0);
    }
    outln!(
        io,
        "mode: {}{}",
        scope.mode,
        if scope.explicit {
            " (explicit files)"
        } else {
            ""
        }
    );
    outln!(io, "precedence, highest first:");
    if !args.has("no-process") {
        outln!(io, "  process environment");
    }
    for layer in scope.layers.iter().rev() {
        match &layer.doc {
            Some(doc) => outln!(io, "  {}  ({} variables)", layer.label, doc.pairs().len()),
            None => outln!(io, "  {}  (not found)", layer.label),
        }
    }
    Ok(0)
}
