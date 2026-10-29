#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** `bun-steam`: the one Bun OS Steam command surface (also reachable as `re steam`). */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { findNativeBinary } from "@aphrody/paths";
import { apiCall, apiDiff, apiMethod, apiSearch, apiShow, apiSources, apiSync } from "./apiindex.js";
import { parseAppInfo, parsePackageInfo } from "./appinfo.js";
import { type AuditReport, recordAudit, runAudit } from "./audit.js";
import { compatToolMapping, loginUsers, readClientConfig, setAutoLogin, setCompatTool } from "./config.js";
import { openSteamDb } from "./db.js";
import {
  launchOptionsString,
  launchTuning,
  openSteamUri,
  readLaunchOptions,
  rungameidUri,
  setLaunchOptions,
} from "./launch.js";
import { candidateDisks, installedGames, listLibraries, moveLibrary } from "./libraries.js";
import { opClassify, opScan, opSql, opStats } from "./ops.js";
import { openIdLoginUrl, openIdVerify, recordAuthSession } from "./openid.js";
import { resolveSteamRoot } from "./paths.js";
import {
  installAntiCheatRuntimes,
  installProton,
  installValveTool,
  listCompatTools,
  type ProtonFlavor,
  protonRelease,
  valveProtonCatalog,
} from "./proton.js";
import { remoteDownload } from "./remote.js";
import { remotePlayState } from "./remoteplay.js";
import { appUpdate, runSteamcmd, steamcmdStatus } from "./steamcmd.js";
import {
  Cursor,
  type KvObject,
  parseBinaryKvTyped,
  parseShortcuts,
  parseTextKv,
  stringifyTextKv,
  writeBinaryKv,
  type BinKvObject,
} from "./vdf.js";
import { rebuildCatalog, recordLocalInstalled, recordRemoteInstalled, searchApps } from "./search.js";
import { tune } from "./tune.js";
import { syncAppList, syncStoreApps } from "./webapi.js";

const HELP = `bun-steam <command> [options]          (--json: machine-readable output)

client                                    Steam client config: auto-login, SteamPath, running state
client users                              remembered accounts (names and flags only)
client autologin <account> [--dry-run]    make a remembered account the auto-login account
steamcmd [status]                         steamcmd location and cached sessions (booleans only)
steamcmd update <appid> [--dir D] [--beta B] [--validate] [--platform P] [--account A]
steamcmd run <+command args>...           raw steamcmd commands with the cached session
libraries | libraries games | libraries disks
libraries move <from> <to> [--dry-run]    move a library (steamapps) to a faster disk
proton [list] | proton catalog            installed tools | Valve Proton/runtime app ids
proton latest <ge|cachyos> [--arch A]     newest release of a Proton flavor
proton install|update <ge|cachyos> [--tag T] [--arch x86_64|x86_64_v3|arm64] [--dir D] [--prune]
proton valve <name|appid> [--dir D]       Valve Proton or Steam Linux Runtime through steamcmd
proton runtimes <dir> [--source steam|lutris]   official EAC/BattlEye runtimes
proton mapping | proton set <appid> <tool> [--dry-run] [--config F]
launch env [--cache D] [--llvmpipe|--no-llvmpipe] [--threads N] [--runtimes D] [--shell]
launch options <appid> [--set] [--dry-run]   read or write tuned Steam launch options
launch run <appid>                        steam://rungameid/<appid> through the running client
remoteplay [--lines N]                    Remote Play peers and recent session events
search <term> [--no-live] [--limit N] [--cc FR] [--lang english]   instant app search (FTS5 + store search)
search-index [--host vps] [--remote-root ~/.steam/steam]            rebuild the app index, record installed apps
audit [--host local|vps] [--cell N] [--disk-mb N] [--library P]... [--out F] [--no-record]
                                          network/CDN/CM/DNS/TLS/log/disk audit (JSON schema in README)
tune [--report F] [--apply] [--force] [--only id,...]   apply audit fixes to Steam config files
vdf <file> [--binary|--appinfo|--packageinfo|--shortcuts]   decode a VDF file as JSON
vdf write <in.json> <out> [--binary]      encode JSON as text or binary VDF
depot list|download|sync|audit ...        native depot client (Rust bun-steam-depot)
api sync [--store-limit N] | api search <term> | api show|method <I/M> | api diff [syncId] | api sources
api call <Interface/Method> [k=v...] [--version N]   call a public (keyless) Web API method
                                          Steam API/product index from public sources (no steamdb.info crawling)
scan | stats | sql "<SELECT>" | store <appid...> | classify <file>
openid login <return_to> | openid verify <query> | remote-download <appid> --dest D [--host vps]
options: --root <steam dir> --steamcmd <exe> --account <name> --db <path> --force`;

const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Entry point for `bun-steam ...` and `re steam ...`. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  if (argv[0] === "depot") return depot(argv.slice(1));
  if (argv[0] === "steamcmd" && argv[1] === "run") return steamcmdRaw(argv.slice(2));
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      root: { type: "string" },
      steamcmd: { type: "string" },
      account: { type: "string" },
      db: { type: "string" },
      dir: { type: "string" },
      beta: { type: "string" },
      platform: { type: "string" },
      validate: { type: "boolean" },
      tag: { type: "string" },
      arch: { type: "string" },
      prune: { type: "boolean" },
      source: { type: "string" },
      config: { type: "string" },
      cache: { type: "string" },
      llvmpipe: { type: "boolean" },
      "no-llvmpipe": { type: "boolean" },
      threads: { type: "string" },
      runtimes: { type: "string" },
      shell: { type: "boolean" },
      set: { type: "boolean" },
      "dry-run": { type: "boolean" },
      force: { type: "boolean" },
      lines: { type: "string" },
      host: { type: "string" },
      cell: { type: "string" },
      "disk-mb": { type: "string" },
      library: { type: "string", multiple: true },
      out: { type: "string" },
      "no-record": { type: "boolean" },
      report: { type: "string" },
      apply: { type: "boolean" },
      only: { type: "string" },
      binary: { type: "boolean" },
      appinfo: { type: "boolean" },
      packageinfo: { type: "boolean" },
      shortcuts: { type: "boolean" },
      "hash-max": { type: "string" },
      "no-hash": { type: "boolean" },
      applist: { type: "boolean" },
      "store-limit": { type: "string" },
      version: { type: "string" },
      "no-live": { type: "boolean" },
      limit: { type: "string" },
      cc: { type: "string" },
      lang: { type: "string" },
      "remote-root": { type: "string" },
      dest: { type: "string" },
      streams: { type: "string" },
      bwlimit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const print = (v: unknown) =>
    console.log(values.json || typeof v !== "string" ? JSON.stringify(v, replacer, values.json ? undefined : 2) : v);
  const log = (m: string) => console.error(m);
  const root = values.root ? resolveSteamRoot(values.root) : resolveSteamRoot();
  const dry = {
    dryRun: !!values["dry-run"],
    force: !!values.force,
    steamRoot: root,
  };
  const sc = {
    steamcmd: values.steamcmd,
    account: values.account,
    onLine: values.json ? undefined : log,
  };
  const index = {
    db: values.db,
    root: values.root,
    hashMax: values["no-hash"] ? 0 : values["hash-max"] ? Number(values["hash-max"]) : undefined,
  };
  const [cmd, sub, ...rest] = positionals;
  const flavor = (s?: string): ProtonFlavor => {
    if (s === "ge" || s === "cachyos") return s;
    throw new Error("flavor must be ge or cachyos");
  };

  try {
    switch (cmd) {
      case "status":
        print({
          client: readClientConfig(root),
          steamcmd: steamcmdStatus(values.steamcmd),
          libraries: listLibraries(root),
          compatTools: listCompatTools(root).map(t => t.internalName),
        });
        break;
      case "client":
        if (!sub || sub === "show") print(readClientConfig(root));
        else if (sub === "users") print(loginUsers(root));
        else if (sub === "autologin" && rest[0]) print(setAutoLogin(rest[0], dry));
        else throw new Error("client [show|users|autologin <account>]");
        break;
      case "steamcmd": {
        if (!sub || sub === "status") print(steamcmdStatus(values.steamcmd));
        else if (sub === "update" && rest[0]) {
          const run = await appUpdate(Number(rest[0]), {
            ...sc,
            installDir: values.dir,
            platform: values.platform,
            beta: values.beta,
            validate: !!values.validate,
          });
          print(run);
          return run.exitCode;
        } else throw new Error("steamcmd [status|update <appid>|run <+cmd args>...]");
        break;
      }
      case "libraries":
        if (!sub || sub === "list") print(listLibraries(root));
        else if (sub === "games") print(installedGames(root));
        else if (sub === "disks") print(candidateDisks());
        else if (sub === "move" && rest[0] && rest[1]) print(moveLibrary(rest[0], rest[1], dry));
        else throw new Error("libraries [list|games|disks|move <from> <to>]");
        break;
      case "proton":
        if (!sub || sub === "list") print(listCompatTools(root));
        else if (sub === "catalog") print(valveProtonCatalog(root));
        else if (sub === "latest")
          print(
            await protonRelease(flavor(rest[0]), {
              tag: values.tag,
              arch: values.arch,
            }),
          );
        else if (sub === "install" || sub === "update")
          print(
            await installProton(flavor(rest[0]), {
              ...(values.tag ? { tag: values.tag } : {}),
              ...(values.arch ? { arch: values.arch } : {}),
              ...(values.dir ? { dir: values.dir } : {}),
              prune: !!values.prune,
              log,
            }),
          );
        else if (sub === "valve" && rest[0]) {
          const run = await installValveTool(rest[0], {
            ...sc,
            steamRoot: root,
            installDir: values.dir,
            validate: !!values.validate,
          });
          print(run);
          return run.exitCode;
        } else if (sub === "runtimes" && rest[0])
          print(
            await installAntiCheatRuntimes(rest[0], {
              ...sc,
              source: values.source === "lutris" ? "lutris" : "steam",
              log,
            }),
          );
        else if (sub === "mapping") print(compatToolMapping(values.config));
        else if (sub === "set" && rest[0] && rest[1] !== undefined)
          print(
            setCompatTool(rest[0], rest[1], {
              ...dry,
              ...(values.config ? { configPath: values.config } : {}),
            }),
          );
        else throw new Error("proton [list|catalog|latest|install|update|valve|runtimes|mapping|set]");
        break;
      case "launch": {
        const tuning = launchTuning({
          steamRoot: root,
          cacheDir: values.cache,
          llvmpipe: values.llvmpipe ? true : values["no-llvmpipe"] ? false : "auto",
          threads: values.threads ? Number(values.threads) : undefined,
          runtimesDir: values.runtimes,
        });
        if (sub === "env") {
          if (values.shell && !values.json)
            print(
              Object.entries(tuning.env)
                .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
                .join("\n"),
            );
          else print(tuning);
        } else if (sub === "options" && rest[0]) {
          const options = launchOptionsString(tuning);
          print(
            values.set
              ? setLaunchOptions(rest[0], options, dry)
              : {
                  suggested: options,
                  current: readLaunchOptions(rest[0], root),
                },
          );
        } else if (sub === "run" && rest[0]) print(await openSteamUri(rungameidUri(rest[0])));
        else throw new Error("launch [env|options <appid>|run <appid>]");
        break;
      }
      case "audit": {
        const report =
          values.host && values.host !== "local"
            ? await remoteAudit(
                values.host,
                argv.filter((a, i) => a !== "audit" && a !== "--host" && argv[i - 1] !== "--host"),
              )
            : await runAudit({
                steamRoot: values.root ? root : undefined,
                cellId: values.cell ? Number(values.cell) : undefined,
                diskMiB: values["disk-mb"] ? Number(values["disk-mb"]) : undefined,
                libraries: values.library,
                log: values.json ? undefined : log,
              });
        if (!values["no-record"]) {
          const db = openSteamDb(values.db);
          recordAudit(db, report);
          db.close();
        }
        if (values.out) await Bun.write(values.out, JSON.stringify(report, null, 2));
        print(report);
        break;
      }
      case "tune": {
        const report = values.report
          ? ((await Bun.file(values.report).json()) as AuditReport)
          : await runAudit({
              steamRoot: values.root ? root : undefined,
              diskMiB: 0,
              log: values.json ? undefined : log,
            });
        print(
          tune(report, {
            apply: !!values.apply,
            force: !!values.force,
            ...(values.only ? { only: values.only.split(",") } : {}),
          }),
        );
        break;
      }
      case "search": {
        const db = openSteamDb(index.db);
        try {
          print(
            await searchApps(db, [sub, ...rest].filter(Boolean).join(" "), {
              live: !values["no-live"],
              limit: values.limit ? Number(values.limit) : undefined,
              cc: values.cc,
              lang: values.lang,
            }),
          );
        } finally {
          db.close();
        }
        break;
      }
      case "search-index": {
        const db = openSteamDb(index.db);
        try {
          const out: Record<string, number> = {
            catalog: rebuildCatalog(db),
            local: recordLocalInstalled(db, root),
          };
          if (values.host && values.host !== "local")
            out[values.host] = await recordRemoteInstalled(db, values.host, values["remote-root"]);
          print(out);
        } finally {
          db.close();
        }
        break;
      }
      case "remoteplay":
        print(remotePlayState(root, values.lines ? Number(values.lines) : 20));
        break;
      case "vdf":
        print(sub === "write" ? writeVdfFile(rest[0], rest[1], !!values.binary) : readVdfFile(sub, values));
        break;
      case "scan":
        print(await opScan(index, log));
        break;
      case "stats":
        print(opStats(index));
        break;
      case "sql":
        print(opSql(index, [sub, ...rest].join(" ")));
        break;
      case "api": {
        const db = openSteamDb(index.db);
        try {
          if (sub === "sync") {
            const r = await apiSync(db, {
              steamRoot: values.root ? root : undefined,
              storeLimit: values["store-limit"] ? Number(values["store-limit"]) : undefined,
              log: values.json ? undefined : log,
            });
            print(values.applist ? { ...r, applist: await syncAppList(db) } : r);
          } else if (sub === "search" && rest.length) print(apiSearch(db, rest.join(" ")));
          else if (sub === "show" && rest[0]) print(apiShow(db, rest[0]));
          else if (sub === "diff") print(apiDiff(db, rest[0] ? Number(rest[0]) : undefined));
          else if (sub === "sources") print(apiSources(db));
          else if (sub === "call" && rest[0]) {
            const args = Object.fromEntries(
              rest.slice(1).flatMap(a => {
                const i = a.indexOf("=");
                return i > 0 ? [[a.slice(0, i), a.slice(i + 1)]] : [];
              }),
            );
            print(await apiCall(db, rest[0], args, values.version ? Number(values.version) : undefined));
          } else if (sub === "method" && rest[0]) print(apiMethod(db, rest[0]));
          else
            throw new Error(
              "api sync [--store-limit N] [--applist] | search <term> | show <Interface/Method> | method <Interface/Method> | call <Interface/Method> [k=v...] [--version N] | diff [syncId] | sources",
            );
        } finally {
          db.close();
        }
        break;
      }
      case "store": {
        const db = openSteamDb(index.db);
        const ids = [sub, ...rest].map(Number).filter(Number.isInteger);
        print({ requested: ids.length, ok: await syncStoreApps(db, ids) });
        db.close();
        break;
      }
      case "openid":
        if (sub === "login" && rest[0]) print(openIdLoginUrl(rest[0]));
        else if (sub === "verify" && rest[0]) {
          const id = await openIdVerify(rest[0]);
          const db = openSteamDb(index.db);
          recordAuthSession(db, "openid", "https://localhost/", id);
          db.close();
          print({ steamid64: id });
        } else throw new Error("openid login <return_to> | verify <query>");
        break;
      case "classify":
        print(await opClassify(sub!));
        break;
      case "remote-download":
        print(
          await remoteDownload({
            appid: Number(sub),
            host: values.host ?? "vps",
            dest: values.dest!,
            streams: values.streams ? Number(values.streams) : undefined,
            bwlimit: values.bwlimit,
            steamcmd: values.steamcmd,
          }),
        );
        break;
      default:
        console.log(HELP);
        return cmd && !values.help ? 2 : 0;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (values.json) console.log(JSON.stringify({ error: message }));
    else console.error(message);
    return 1;
  }
  return 0;
}

function readVdfFile(file: string | undefined, f: Record<string, unknown>): unknown {
  if (!file) throw new Error("vdf <file> [--binary|--appinfo|--packageinfo|--shortcuts]");
  const bytes = readFileSync(file);
  if (f.appinfo) return parseAppInfo(bytes);
  if (f.packageinfo) return parsePackageInfo(bytes);
  if (f.shortcuts) return parseShortcuts(bytes);
  if (f.binary) return parseBinaryKvTyped(new Cursor(bytes));
  return parseTextKv(bytes.toString("utf8"));
}

/** Typed binary JSON (`{ "type": "int32", "value": 1 }` leaves) or plain text-VDF JSON. */
function writeVdfFile(input: string | undefined, out: string | undefined, binary: boolean) {
  if (!input || !out) throw new Error("vdf write <in.json> <out> [--binary]");
  const doc = JSON.parse(readFileSync(input, "utf8"), (_, v) =>
    v && typeof v === "object" && (v.type === "uint64" || v.type === "int64") ? { ...v, value: BigInt(v.value) } : v,
  );
  const bytes = binary ? writeBinaryKv(doc as BinKvObject) : stringifyTextKv(doc as KvObject);
  writeFileSync(out, bytes);
  return { out, bytes: bytes.length };
}

/**
 * `bun-steam steamcmd run [--json] [--account A] [--steamcmd EXE] +cmd args...`: raw steamcmd
 * commands over the cached session (parsed by hand so steamcmd flags such as `-beta` pass through).
 */
async function steamcmdRaw(args: string[]): Promise<number> {
  const opts: { account?: string | undefined; steamcmd?: string | undefined } = {};
  let json = false;
  const groups: string[][] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") json = true;
    else if (a === "--account" || a === "--steamcmd") opts[a === "--account" ? "account" : "steamcmd"] = args[++i];
    else if (a.startsWith("+")) groups.push([a.slice(1)]);
    else groups.at(-1)?.push(a);
  }
  try {
    const run = await runSteamcmd(groups, {
      ...opts,
      onLine: json ? undefined : l => console.error(l),
    });
    console.log(JSON.stringify(run, null, json ? undefined : 2));
    return run.exitCode;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(json ? JSON.stringify({ error: message }) : message);
    return 1;
  }
}

/**
 * Runs the audit on an SSH host (`ssh <host>`, Bun 1.4.4 there): bundles this CLI, copies it to a
 * temporary file, runs `audit --json --no-record` read-only, removes the file and returns the report.
 */
async function remoteAudit(host: string, args: string[]): Promise<AuditReport> {
  const out = `${process.env.TEMP ?? "/tmp"}/bun-steam-audit-${process.pid}`;
  const built = await Bun.build({
    entrypoints: [import.meta.path],
    target: "bun",
    outdir: out,
    minify: true,
  });
  if (!built.success) throw new Error(built.logs.map(String).join("; "));
  const local = built.outputs[0]!.path;
  const remote = `/tmp/bun-steam-audit-${process.pid}.js`;
  const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  try {
    if ((await Bun.spawn(["scp", "-q", ...ssh, local, `${host}:${remote}`]).exited) !== 0)
      throw new Error(`scp to ${host} failed`);
    const forward = args.filter(a => a !== "--json" && a !== "--no-record" && !a.startsWith("--out"));
    const proc = Bun.spawn(
      [
        "ssh",
        ...ssh,
        host,
        `nice -n 10 bun ${remote} audit --json --no-record ${forward.map(a => `'${a.replaceAll("'", "")}'`).join(" ")}; rm -f ${remote}`,
      ],
      { stdout: "pipe", stderr: "inherit" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const report = JSON.parse(text.trim().split(/\r?\n/).pop()!) as AuditReport & { error?: string };
    if (report.error) throw new Error(`${host}: ${report.error}`);
    return report;
  } finally {
    (await import("node:fs")).rmSync(out, { recursive: true, force: true });
  }
}

/** `bun-steam depot ...` runs the Rust depot client (`bun-steam-depot`, crates/bun-steam). */
async function depot(args: string[]): Promise<number> {
  const bin = findNativeBinary("bun-steam-depot", "BUN_STEAM_DEPOT_BIN");
  if (!bin) {
    console.error(
      "bun-steam-depot not found; build it with `bun scripts/cargo.ts exec -- build --release -p bun-steam --features depot --bin bun-steam-depot`, or set BUN_STEAM_DEPOT_BIN",
    );
    return 2;
  }
  return Bun.spawn([bin, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
