#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// `bunos arch ...`: sync, watch, serve, query, info, deps, outdated, check, diff, events, crosscheck, wsl-image, snapshot.
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { collectPins } from "./pins.ts";
import { checkPins, depTree, diffSources, info, renderTree, search, type PinReport, type SearchBy } from "./query.ts";
import { startServer } from "./server.ts";
import { defaultCacheDir, openStore, type DepKind, type Store } from "./store.ts";
import {
  aurInfo,
  createContext,
  crossCheckApi,
  crossCheckFeed,
  DEFAULT_REPOS,
  snapshotMirrorlist,
  STAGING_REPOS,
  syncAur,
  syncAurSources,
  syncNews,
  syncOfficial,
  syncOfficialSources,
  syncSnapshot,
  TESTING_REPOS,
  wslImage,
  type Context,
} from "./sync.ts";
import { watch } from "./watch.ts";
import type { Webhook } from "./events.ts";

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const USAGE = `bunos arch: real-time Arch Linux + AUR package index (bun:sqlite)

  sync      [--official] [--aur] [--all] [--testing] [--staging] [--files] [--news] [--force]
            [--sources arch|aur|all] [--pkgbuild] [--names a,b] [--limit N] [--snapshot YYYY-MM-DD]
  watch     [--serve] [--port N] [--webhook URL]... [--track a,b] [--official-interval S] [--aur-interval S]
  serve     [--port N] [--host H] (token from ARCH_INDEX_TOKEN, required off loopback)
  query     <name|glob> [--by name|provides|depends|makedepends|optdepends|desc|file|maintainer|group|base] [--source repo|aur] [--limit N]
  info      <name> [--source repo|aur] [--live]
  version   <name>...   (version in Arch and AUR now; --live asks archlinux.org/AUR RPC)
  deps      <name> [--tree] [--kinds depends,makedepends] [--depth N]
  outdated  [--root DIR] [--lock FILE] [--fail]    compare repository pins (lists, locks, PKGBUILDs) with the index
  check     [--root DIR] [--list FILE]...           fail on removed packages (generators fail fast)
  diff      <pkgbase> [from to] [--source arch|aur] | --since 1h|ID
  events    [--since ID|DURATION] [--type T] [--limit N]
  crosscheck [--names pacman,linux] [--feed]
  wsl-image
  snapshot  <YYYY-MM-DD> [--mirrorlist]
  status

Global: --db PATH (default $BUNOS_ARCH_DB or <cache>/index.sqlite, cache = $BUNOS_ARCH_CACHE or ~/.cache/bunos/arch), --json`;

function duration(text: string, now = Date.now()): number | undefined {
  const m = /^(\d+)([smhd])$/.exec(text);
  if (!m) return undefined;
  return now - Number(m[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "s"]!;
}

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(0)} ms`);
const fmtBytes = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`);

function printPin(r: PinReport): string {
  const v = r.pin.version ? `${r.pin.name} ${r.pin.version}` : r.pin.name;
  const now = r.current ? ` -> ${r.current}${r.repo ? ` [${r.repo}]` : ""}` : "";
  return `${r.status.toUpperCase().padEnd(9)} ${v}${now}${r.note ? ` (${r.note})` : ""}${r.pin.origin ? `  <- ${r.pin.origin}` : ""}`;
}

export async function runArchCli(argv: string[], io: Io = { out: t => console.log(t), err: t => console.error(t) }): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.out(USAGE);
    return command ? 0 : 1;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      db: { type: "string" },
      json: { type: "boolean" },
      official: { type: "boolean" },
      aur: { type: "boolean" },
      all: { type: "boolean" },
      testing: { type: "boolean" },
      staging: { type: "boolean" },
      files: { type: "boolean" },
      news: { type: "boolean" },
      force: { type: "boolean" },
      sources: { type: "string" },
      pkgbuild: { type: "boolean" },
      names: { type: "string" },
      limit: { type: "string" },
      snapshot: { type: "string" },
      serve: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      webhook: { type: "string", multiple: true },
      track: { type: "string" },
      "official-interval": { type: "string" },
      "aur-interval": { type: "string" },
      by: { type: "string" },
      source: { type: "string" },
      live: { type: "boolean" },
      tree: { type: "boolean" },
      kinds: { type: "string" },
      depth: { type: "string" },
      root: { type: "string" },
      lock: { type: "string", multiple: true },
      list: { type: "string", multiple: true },
      fail: { type: "boolean" },
      since: { type: "string" },
      type: { type: "string" },
      feed: { type: "boolean" },
      mirrorlist: { type: "boolean" },
      follow: { type: "boolean" },
    },
  });
  const json = !!values.json;
  const emit = (value: unknown, text: () => string) => io.out(json ? JSON.stringify(value, null, 2) : text());
  const snapshotDate = typeof values.snapshot === "string" ? values.snapshot : command === "snapshot" ? positionals[0] : undefined;
  const dbPath =
    (values.db as string | undefined) ??
    process.env.BUNOS_ARCH_DB ??
    (snapshotDate && command !== "snapshot" ? join(defaultCacheDir(), "snapshots", `${snapshotDate.replaceAll("/", "-")}.sqlite`) : undefined);
  const root = resolve((values.root as string | undefined) ?? process.cwd());
  let store: Store | undefined;
  const open = () => (store ??= openStore(command === "snapshot" && snapshotDate ? join(defaultCacheDir(), "snapshots", `${snapshotDate.replaceAll("/", "-")}.sqlite`) : dbPath));
  const context = (): Context => createContext({ store: open() });
  try {
    switch (command) {
      case "sync": {
        const ctx = context();
        const wantAll = !!values.all;
        const doOfficial = wantAll || !!values.official || (!values.aur && !values.sources && !values.news);
        const doAur = wantAll || !!values.aur;
        const reports: Record<string, unknown> = {};
        if (snapshotDate) {
          reports.snapshot = await syncSnapshot(ctx, snapshotDate, { files: !!values.files });
        } else if (doOfficial) {
          const repos = [...DEFAULT_REPOS, ...(values.testing || wantAll ? TESTING_REPOS : []), ...(values.staging ? STAGING_REPOS : [])];
          reports.official = await syncOfficial(ctx, { repos, files: !!values.files, force: !!values.force });
        }
        if (doAur && !snapshotDate) reports.aur = await syncAur(ctx, { force: !!values.force });
        if (values.news || wantAll) reports.news = await syncNews(ctx);
        const names = typeof values.names === "string" ? values.names.split(",") : undefined;
        const limit = values.limit ? Number(values.limit) : undefined;
        const src = values.sources as string | undefined;
        if (src === "arch" || src === "all" || (wantAll && !src))
          reports.archSources = await syncOfficialSources(ctx, { names, limit, pkgbuild: !!values.pkgbuild, onProgress: progress(io, json) });
        if (src === "aur" || src === "all") reports.aurSources = await syncAurSources(ctx, { names, limit, pkgbuild: !!values.pkgbuild, onProgress: progress(io, json) });
        emit(reports, () => formatSync(reports));
        const failed = JSON.stringify(reports).includes('"status":"error"');
        return failed ? 1 : 0;
      }
      case "watch": {
        const ctx = context();
        const webhooks: Webhook[] = ((values.webhook as string[] | undefined) ?? []).map(url => ({ url, secret: process.env.ARCH_INDEX_WEBHOOK_SECRET }));
        const ac = new AbortController();
        process.once("SIGINT", () => ac.abort());
        process.once("SIGTERM", () => ac.abort());
        let served: ReturnType<typeof startServer> | undefined;
        if (values.serve) {
          served = startServer(ctx, { port: Number(values.port ?? 4747), hostname: (values.host as string | undefined) ?? "127.0.0.1", token: process.env.ARCH_INDEX_TOKEN });
          io.out(`API listening on ${served.url}`);
        }
        io.out("watching (Ctrl-C to stop)");
        ctx.bus.subscribe(e => io.out(json ? JSON.stringify(e) : `${new Date(e.ts).toISOString()} ${e.type} ${e.repo ? `${e.repo}/` : ""}${e.name}${e.old || e.new ? `: ${e.old ?? "-"} -> ${e.new ?? "-"}` : ""}`));
        await watch(ctx, {
          signal: ac.signal,
          webhooks,
          trackSources: typeof values.track === "string" ? values.track.split(",") : undefined,
          officialIntervalMs: values["official-interval"] ? Number(values["official-interval"]) * 1000 : undefined,
          aurIntervalMs: values["aur-interval"] ? Number(values["aur-interval"]) * 1000 : undefined,
          repos: [...DEFAULT_REPOS, ...(values.testing ? TESTING_REPOS : [])],
          files: !!values.files,
          onTask: (task, result) => io.out(`${new Date().toISOString()} ${task}: ${JSON.stringify(summary(result))}`),
        });
        served?.stop();
        return 0;
      }
      case "serve": {
        const ctx = context();
        const s = startServer(ctx, { port: Number(values.port ?? 4747), hostname: (values.host as string | undefined) ?? "127.0.0.1", token: process.env.ARCH_INDEX_TOKEN });
        io.out(`API listening on ${s.url}`);
        await new Promise<void>(resolveStop => {
          process.once("SIGINT", resolveStop);
          process.once("SIGTERM", resolveStop);
        });
        s.stop();
        return 0;
      }
      case "query": {
        const term = positionals[0];
        if (!term) return usage(io, "query needs a name or glob");
        const rows = search(open(), term, { by: (values.by as SearchBy | undefined) ?? "name", source: values.source as "repo" | "aur" | undefined, testing: !!values.testing, limit: values.limit ? Number(values.limit) : 50 });
        emit(rows, () => rows.map(r => `${r.repo}/${r.name} ${r.version}${r.source === "aur" ? ` (votes ${r.votes}${r.outOfDate ? ", OUT OF DATE" : ""}${r.maintainer ? "" : ", orphan"})` : ""}\n    ${r.description}`).join("\n") || "no match");
        return rows.length ? 0 : 1;
      }
      case "info": {
        const name = positionals[0];
        if (!name) return usage(io, "info needs a package name");
        const ctx = context();
        if (values.live) await aurInfo(ctx, [name]).catch(() => []);
        const p = info(ctx.store, name, { source: values.source as "repo" | "aur" | undefined, testing: !!values.testing });
        if (!p) {
          io.err(`${name}: not in the index`);
          return 1;
        }
        emit(p, () => formatInfo(p));
        return 0;
      }
      case "version": {
        if (positionals.length === 0) return usage(io, "version needs one or more names");
        const ctx = context();
        const out: Record<string, unknown>[] = [];
        if (values.live) {
          const aurNames = positionals.filter(n => !ctx.store.getPackage(n, { source: "repo" }));
          if (aurNames.length) await aurInfo(ctx, aurNames).catch(() => []);
        }
        for (const n of positionals) {
          const rows = ctx.store.getPackages(n);
          out.push({ name: n, repo: rows.filter(r => r.source === "repo" && !/-(testing|staging)$/.test(r.repo)).map(r => ({ repo: r.repo, version: r.version })), testing: rows.filter(r => /-(testing|staging)$/.test(r.repo)).map(r => ({ repo: r.repo, version: r.version })), aur: rows.filter(r => r.source === "aur").map(r => ({ version: r.version, outOfDate: r.outOfDate, maintainer: r.maintainer })) });
        }
        emit(out, () =>
          out
            .map(o => {
              const parts = [...(o.repo as { repo: string; version: string }[]).map(r => `${r.repo} ${r.version}`), ...(o.testing as { repo: string; version: string }[]).map(r => `${r.repo} ${r.version}`), ...(o.aur as { version: string; outOfDate: number | null }[]).map(r => `aur ${r.version}${r.outOfDate ? " (out of date)" : ""}`)];
              return `${o.name}: ${parts.join(", ") || "not found"}`;
            })
            .join("\n"),
        );
        return out.every(o => (o.repo as unknown[]).length + (o.aur as unknown[]).length > 0) ? 0 : 1;
      }
      case "deps": {
        const name = positionals[0];
        if (!name) return usage(io, "deps needs a package name");
        const tree = depTree(open(), name, { kinds: ((values.kinds as string | undefined) ?? "depends").split(",") as DepKind[], depth: values.depth ? Number(values.depth) : values.tree ? 8 : 1 });
        emit(tree, () => renderTree(tree));
        return tree.missing ? 1 : 0;
      }
      case "outdated":
      case "check": {
        const st = open();
        const pins = await collectPins(root, values.list || values.lock ? { lists: (values.list as string[] | undefined) ?? [], locks: (values.lock as string[] | undefined) ?? [], pkgbuilds: [] } : undefined);
        const reports = checkPins(st, pins, { aur: true });
        const missing = reports.filter(r => r.status === "missing");
        const outdated = reports.filter(r => r.status === "outdated");
        const interesting = command === "check" ? reports.filter(r => ["missing", "replaced", "orphaned", "flagged"].includes(r.status)) : reports.filter(r => !["current", "group", "aur"].includes(r.status));
        emit({ pins: pins.length, missing: missing.length, outdated: outdated.length, reports: interesting }, () => [`${pins.length} pins checked against ${st.count()} indexed packages`, ...interesting.map(printPin), `missing ${missing.length}, outdated ${outdated.length}, replaced ${reports.filter(r => r.status === "replaced").length}`].join("\n"));
        return missing.length > 0 || (command === "outdated" && values.fail && outdated.length > 0) ? 1 : 0;
      }
      case "diff": {
        const st = open();
        if (values.since) {
          const ts = duration(String(values.since));
          const events = st.listEvents(ts !== undefined ? { sinceTs: ts, limit: 500 } : { sinceId: Number(values.since), limit: 500 });
          emit(events, () => events.map(e => `${new Date(e.ts).toISOString()} ${e.type} ${e.repo}/${e.name} ${e.old ?? "-"} -> ${e.new ?? "-"}`).join("\n") || "no change");
          return 0;
        }
        const base = positionals[0];
        if (!base) return usage(io, "diff needs a pkgbase or --since");
        const d = diffSources(st, values.source === "aur" ? "aur" : "arch", base, positionals[1], positionals[2]);
        emit(d, () => [`${d.pkgbase} ${d.from} -> ${d.to}`, "--- .SRCINFO", ...d.srcinfo, "--- PKGBUILD", ...d.pkgbuild].join("\n"));
        return 0;
      }
      case "events": {
        const st = open();
        const ts = values.since ? duration(String(values.since)) : undefined;
        const events = st.listEvents({ sinceTs: ts, sinceId: ts === undefined && values.since ? Number(values.since) : undefined, type: values.type as string | undefined, limit: values.limit ? Number(values.limit) : 100 });
        emit(events, () => events.map(e => `#${e.id} ${new Date(e.ts).toISOString()} ${e.type} ${e.repo}/${e.name} ${e.old ?? "-"} -> ${e.new ?? "-"}`).join("\n") || "no events");
        return 0;
      }
      case "crosscheck": {
        const ctx = context();
        const reports: Awaited<ReturnType<typeof crossCheckFeed>>[] = [];
        if (values.feed || !values.names) reports.push(await crossCheckFeed(ctx));
        if (values.names) reports.push(await crossCheckApi(ctx, String(values.names).split(",")));
        emit(reports, () => reports.map(r => `${r.source}: ${r.checked} checked, ${r.matching} match, db ahead ${r.ahead.length}, db behind ${r.behind.length}, missing ${r.missing.length}`).join("\n"));
        return 0;
      }
      case "wsl-image": {
        const ctx = context();
        const img = await wslImage(ctx);
        emit(img, () => `archlinux-wsl ${img.version}  ${fmtBytes(img.bytes)}  sha256 ${img.sha256 ?? "unknown"}\n${img.url}`);
        return 0;
      }
      case "snapshot": {
        if (!snapshotDate) return usage(io, "snapshot needs a date");
        io.out(values.mirrorlist ? snapshotMirrorlist(snapshotDate).trimEnd() : `Use: bunos arch sync --snapshot ${snapshotDate}`);
        return 0;
      }
      case "status": {
        const st = open();
        const s = { path: st.path, counts: st.repoCounts(), events: st.listEvents({ limit: 1 })[0]?.id ?? 0, fetches: st.db.query("SELECT url, etag, checked_at AS checkedAt, changed_at AS changedAt, bytes FROM fetch_state ORDER BY url").all(), rpcUsedToday: st.rpcUsed() };
        emit(s, () => [`index ${s.path}`, ...s.counts.map(c => `  ${c.repo.padEnd(18)} ${String(c.n).padStart(7)} packages`), `  events ${s.events}, AUR RPC today ${s.rpcUsedToday}`].join("\n"));
        return 0;
      }
      default:
        io.err(`unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } finally {
    store?.close();
  }
}

function usage(io: Io, message: string): number {
  io.err(`${message}\n\n${USAGE}`);
  return 2;
}

function progress(io: Io, json: boolean) {
  let last = 0;
  return (done: number, total: number) => {
    const now = Date.now();
    if (!json && (now - last > 5000 || done === total)) {
      last = now;
      io.err(`  sources ${done}/${total}`);
    }
  };
}

function summary(result: unknown): unknown {
  if (Array.isArray(result)) return result.map(r => ({ repo: r.repo, status: r.status, added: r.added, updated: r.updated, removed: r.removed }));
  const r = result as Record<string, unknown>;
  return { status: r.status, packages: r.packages, added: r.added, updated: r.updated, removed: r.removed, error: r.error };
}

function formatSync(reports: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const key of ["official", "snapshot"]) {
    const list = reports[key] as { repo: string; status: string; packages?: number; bytes?: number; ms: number; added?: number; updated?: number; removed?: number; error?: string }[] | undefined;
    for (const r of list ?? []) lines.push(`${r.repo.padEnd(18)} ${r.status.padEnd(12)} ${r.packages ?? "-"} pkgs ${r.bytes ? fmtBytes(r.bytes) : ""} ${fmtMs(r.ms)}${r.added || r.updated || r.removed ? ` (+${r.added} ~${r.updated} -${r.removed})` : ""}${r.error ? ` ERROR ${r.error}` : ""}`);
  }
  const a = reports.aur as { status: string; packages?: number; bytes?: number; jsonBytes?: number; ms: number; error?: string } | undefined;
  if (a) lines.push(`aur                ${a.status.padEnd(12)} ${a.packages ?? "-"} pkgs ${a.bytes ? `${fmtBytes(a.bytes)} gz / ${fmtBytes(a.jsonBytes ?? 0)} json` : ""} ${fmtMs(a.ms)}${a.error ? ` ERROR ${a.error}` : ""}`);
  const n = reports.news as { status: string; fresh: number } | undefined;
  if (n) lines.push(`news               ${n.status} (${n.fresh} new)`);
  for (const key of ["archSources", "aurSources"]) {
    const s = reports[key] as { source: string; wanted: number; fetched: number; skipped: number; notFound: number; failed: number; drift: number; requests: number; bytes: number; ms: number; requestsPerSecond: number } | undefined;
    if (s) lines.push(`${s.source} sources: wanted ${s.wanted}, fetched ${s.fetched}, already stored ${s.skipped}, not found ${s.notFound}, failed ${s.failed}, tag drift ${s.drift}; ${s.requests} requests, ${fmtBytes(s.bytes)}, ${fmtMs(s.ms)} (${s.requestsPerSecond.toFixed(2)} req/s)`);
  }
  return lines.join("\n");
}

function formatInfo(p: ReturnType<typeof info> & {}): string {
  const dep = (l: { name: string; op: string; version: string }[]) => l.map(d => `${d.name}${d.op}${d.version}`).join("  ") || "None";
  return [
    `Repository     : ${p.repo}`,
    `Name           : ${p.name}`,
    `Version        : ${p.version}`,
    `Base           : ${p.base}`,
    `Description    : ${p.description}`,
    `URL            : ${p.url}`,
    `Licenses       : ${p.licenses.join(" ") || "None"}`,
    `Groups         : ${p.groups.join(" ") || "None"}`,
    `Provides       : ${dep(p.provides)}`,
    `Depends On     : ${dep(p.depends)}`,
    `Make Deps      : ${dep(p.makedepends)}`,
    `Optional Deps  : ${p.optdepends.map(d => `${d.name}${d.description ? `: ${d.description}` : ""}`).join("  ") || "None"}`,
    `Conflicts With : ${dep(p.conflicts)}`,
    `Replaces       : ${dep(p.replaces)}`,
    p.source === "repo"
      ? `Download Size  : ${fmtBytes(p.csize)}  Installed: ${fmtBytes(p.isize)}  Build Date: ${p.builddate ? new Date(p.builddate * 1000).toISOString() : "-"}  Packager: ${p.packager}`
      : `AUR            : votes ${p.votes}, popularity ${p.popularity?.toFixed(2)}, maintainer ${p.maintainer ?? "ORPHAN"}, ${p.outOfDate ? `out of date since ${new Date(p.outOfDate * 1000).toISOString().slice(0, 10)}` : "not flagged"}, last modified ${p.lastModified ? new Date(p.lastModified * 1000).toISOString().slice(0, 10) : "-"}`,
    `Required By    : ${p.requiredBy.slice(0, 40).join("  ") || "None"}${p.requiredBy.length > 40 ? ` (+${p.requiredBy.length - 40})` : ""}`,
    p.srcinfoVersions.length ? `Sources stored: ${p.srcinfoVersions.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

if (import.meta.main) {
  process.exitCode = await runArchCli(Bun.argv.slice(2));
}
