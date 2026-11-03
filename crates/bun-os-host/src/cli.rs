//! `bunos host` command line.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::PathBuf;

use crate::registry::{self, Outcome, Query, Secret};
use crate::{collect, schema, transport};

macro_rules! outln {
    ($io:expr, $($arg:tt)*) => {{ let _ = writeln!($io.out, $($arg)*); }};
}
macro_rules! errln {
    ($io:expr, $($arg:tt)*) => {{ let _ = writeln!($io.err, $($arg)*); }};
}

const USAGE: &str = "bunos host: resource inventory of this machine and the shared registry

Usage:
  bunos host collect [--id ID] [--text]        print the card of this machine (JSON)
  bunos host schema                            print the JSON Schema of a card
  bunos host push --to TARGET [--id ID]        collect, sign and drop the card on TARGET
  bunos host sync [--from TARGET]...           refresh the local card, pull TARGETs, merge into the store
  bunos host list [--json]                     hosts of the store
  bunos host find [--vram-free GB] [--ram GB] [--disk GB] [--gpu NAME] [--os NAME] [--cuda] [--max-age S] [--json]

TARGET is a directory, [user@]host:dir or ssh://[user@]host[:port]/dir (POSIX host, system OpenSSH).
Secret (HMAC-SHA256 of each card): -s NAME reads the environment variable NAME, --secret-file PATH
reads a file (0600 on Unix). Never pass the secret itself on the command line.
Store: $BUN_HOST_DIR or ~/.bun/host (inventory.json, inbox/ for dropped cards).";

#[derive(Default)]
struct Opts {
    id: Option<String>,
    text: bool,
    json: bool,
    to: Option<String>,
    from: Vec<String>,
    secret_env: Option<String>,
    secret_file: Option<PathBuf>,
    dir: Option<PathBuf>,
    query: Query,
}

fn parse(args: &[String]) -> Result<Opts, String> {
    let mut o = Opts::default();
    let mut it = args.iter();
    let num = |flag: &str, v: Option<&String>| -> Result<f64, String> {
        v.ok_or_else(|| format!("{flag} needs a value"))?
            .parse::<f64>()
            .map_err(|_| format!("{flag} needs a number"))
    };
    while let Some(arg) = it.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (arg.as_str(), None),
        };
        let mut value = || inline.clone().or_else(|| it.next().cloned());
        match flag {
            "--id" => o.id = value(),
            "--text" => o.text = true,
            "--json" => o.json = true,
            "--to" => o.to = value(),
            "--from" => o.from.extend(value()),
            "-s" | "--secret" => o.secret_env = value(),
            "--secret-file" => o.secret_file = value().map(PathBuf::from),
            "--dir" => o.dir = value().map(PathBuf::from),
            "--vram-free" => o.query.min_vram_free_gb = Some(num(flag, value().as_ref())?),
            "--ram" => o.query.min_ram_gb = Some(num(flag, value().as_ref())?),
            "--disk" => o.query.min_disk_free_gb = Some(num(flag, value().as_ref())?),
            "--gpu" => o.query.gpu = value(),
            "--os" => o.query.os = value(),
            "--cuda" => o.query.cuda = true,
            "--max-age" => o.query.max_age_s = Some(num(flag, value().as_ref())? as u64),
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    Ok(o)
}

fn secret(o: &Opts) -> Result<Option<Secret>, String> {
    match (&o.secret_env, &o.secret_file) {
        (Some(name), _) => Secret::from_env(name).map(Some),
        (None, Some(file)) => Secret::from_file(file).map(Some),
        (None, None) => crate::tools::secret_from_env(),
    }
}

fn gib(mib: u64) -> String {
    format!("{:.1}", mib as f64 / 1024.0)
}

fn summary(info: &schema::HostInfo, now: u64) -> String {
    let gpus: Vec<String> = info
        .gpus
        .iter()
        .map(|g| match g.vram_free_mib {
            Some(free) => format!("{} {}/{} GiB", g.name, gib(free), gib(g.vram_total_mib)),
            None => format!("{} {} GiB", g.name, gib(g.vram_total_mib)),
        })
        .collect();
    let disk = info.disks.iter().map(|d| d.free_mib).max().unwrap_or(0);
    format!(
        "{:<12} {} {} | {} | {}c | RAM {}/{} GiB | GPU {} | disk free {} GiB | {}s ago",
        info.id,
        info.os.name,
        info.os.version,
        info.kernel.release,
        info.cpu.logical_cores,
        gib(info.memory.available_mib),
        gib(info.memory.total_mib),
        if gpus.is_empty() {
            "-".into()
        } else {
            gpus.join(", ")
        },
        gib(disk),
        now.saturating_sub(info.collected_at) / 1000,
    )
}

fn print_rejected(io: &mut Io, rejected: &[String]) {
    for r in rejected {
        errln!(io, "bunos host: rejected: {r}");
    }
}

fn run(io: &mut Io, args: &[String]) -> Result<(), String> {
    let Some((command, rest)) = args.split_first() else {
        outln!(io, "{USAGE}");
        return Ok(());
    };
    let o = parse(rest)?;
    let id = o.id.clone().unwrap_or_else(collect::default_id);
    let store = o.dir.clone().unwrap_or_else(registry::store_dir);
    match command.as_str() {
        "help" | "--help" | "-h" => outln!(io, "{USAGE}"),
        "schema" => outln!(io, "{}", schema::schema_json()),
        "collect" => {
            let info = collect::collect(&id);
            if o.text {
                outln!(io, "{}", summary(&info, collect::now_ms()));
            } else {
                outln!(
                    io,
                    "{}",
                    serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?
                );
            }
        }
        "push" => {
            let to = o.to.as_deref().ok_or("push needs --to TARGET")?;
            let target = transport::parse_target(to)?;
            let secret = secret(&o)?;
            let entry = registry::card(&collect::collect(&id), secret.as_ref());
            let place = transport::push(&target, &entry)?;
            outln!(
                io,
                "pushed {id} -> {place}{}",
                if entry.sig.is_some() {
                    " (signed)"
                } else {
                    " (unsigned)"
                }
            );
        }
        "sync" => {
            let secret = secret(&o)?;
            let loaded = registry::load(&store, secret.as_ref());
            let (mut inventory, mut rejected) = (loaded.inventory, loaded.rejected);
            inventory.merge(
                registry::card(&collect::collect(&id), secret.as_ref()),
                secret.as_ref(),
            );
            for from in &o.from {
                let (cards, errors) = transport::pull(&transport::parse_target(from)?)?;
                rejected.extend(errors);
                for card in cards {
                    match inventory.merge(card, secret.as_ref()) {
                        Outcome::Rejected(reason) => rejected.push(reason),
                        Outcome::Added | Outcome::Updated | Outcome::Unchanged | Outcome::Stale => {
                        }
                    }
                }
            }
            registry::save(&store, &mut inventory)?;
            print_rejected(io, &rejected);
            outln!(
                io,
                "{} hosts in {}",
                inventory.hosts.len(),
                store.join("inventory.json").display()
            );
        }
        "list" => {
            let secret = secret(&o)?;
            let loaded = registry::load(&store, secret.as_ref());
            print_rejected(io, &loaded.rejected);
            if o.json {
                outln!(
                    io,
                    "{}",
                    serde_json::to_string_pretty(&loaded.inventory).map_err(|e| e.to_string())?
                );
            } else {
                let now = collect::now_ms();
                for info in loaded.inventory.infos() {
                    outln!(io, "{}", summary(&info, now));
                }
            }
        }
        "find" => {
            let secret = secret(&o)?;
            let loaded = registry::load(&store, secret.as_ref());
            print_rejected(io, &loaded.rejected);
            let mut query = o.query;
            query.max_age_s.get_or_insert(86_400);
            let hits = registry::find(&loaded.inventory, &query, collect::now_ms());
            outln!(
                io,
                "{}",
                serde_json::to_string_pretty(&hits).map_err(|e| e.to_string())?
            );
            if hits.is_empty() {
                return Err("no host matches".into());
            }
        }
        other => return Err(format!("unknown command {other:?}; try `bunos host help`")),
    }
    Ok(())
}

/// What `bunos host` printed: the caller writes `out` to stdout and `err` to stderr.
#[derive(Default)]
pub struct Io {
    pub out: String,
    pub err: String,
}

/// Runs `bunos host`; returns the exit code.
pub fn main(args: Vec<OsString>, io: &mut Io) -> i32 {
    let args: Vec<String> = args
        .into_iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    match run(io, &args) {
        Ok(()) => 0,
        Err(message) => {
            errln!(io, "bunos host: {message}");
            1
        }
    }
}
