// SPDX-License-Identifier: Apache-2.0
// Guard of the host disposition (infra/config/host/host-policy.toml [layout]): one home per host, no /srv, no /opt.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_LAYOUT,
  hostLayout,
  hostPath,
  migratePath,
  relink,
  retiredLinks,
  retiredPrefix,
} from "../src/host/layout.ts";
import { sourceCheckout } from "../src/host/index.ts";

const ROOT = sourceCheckout()!;

test("every root lives in the one declared home", () => {
  expect(HOST_LAYOUT.home).toBe("/home/ubuntu");
  for (const root of [HOST_LAYOUT.src, HOST_LAYOUT.apps, HOST_LAYOUT.build, HOST_LAYOUT.archive, HOST_LAYOUT.state])
    expect(root.startsWith(`${HOST_LAYOUT.home}/`)).toBe(true);
  expect(HOST_LAYOUT.compose).toBe(`${HOST_LAYOUT.apps}/compose.yaml`);
  expect(HOST_LAYOUT.composeProject).toBe("aphrody");
  expect(hostPath("apps", "demoapp", "shared")).toBe("/home/ubuntu/apps/demoapp/shared");
  expect(hostLayout("/home/x").src).toBe("/home/x/src");
});

test("retired locations map to their replacement, longest prefix first", () => {
  expect(migratePath("/srv/aphrody-build/workspaces/vu-wsl/x")).toBe("/home/ubuntu/build/wsl/vu/x");
  expect(migratePath("/srv/aphrody-build/cache")).toBe("/home/ubuntu/build/cache");
  expect(migratePath("/srv/aphrody-downloads/site")).toBe("/home/ubuntu/apps/downloads/site");
  expect(migratePath("/srv/demoapp/shared")).toBe("/home/ubuntu/apps/demoapp/shared");
  expect(migratePath("/etc/aphrody/container/compose.yaml")).toBe("/home/ubuntu/apps/aphrody/compose.yaml");
  expect(retiredPrefix("/srvx")).toBeNull();
  expect(retiredPrefix("/home/ubuntu/apps/demoapp")).toBeNull();
});

test("each host runs one compose project that includes ~/apps/<app>/compose.yaml", () => {
  for (const host of ["vps", "dbfr"]) {
    const text = readFileSync(join(ROOT, "infra/config/host/apps", host, "compose.yaml"), "utf8");
    const parsed = Bun.YAML.parse(text) as { name: string; include: (string | { path: string[] })[] };
    expect(parsed.name).toBe(HOST_LAYOUT.composeProject);
    for (const entry of parsed.include) {
      const paths = typeof entry === "string" ? [entry] : entry.path;
      expect(paths[0]).toMatch(/^[a-z0-9-]+\/compose\.yaml$/);
      for (const override of paths.slice(1)) expect(override).toMatch(/^[a-z0-9-]+\.yaml$/);
    }
  }
});

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every spelling of a retired location: absolute keys as is, `~/x` also as $HOME, ${HOME}, %h and the home. */
function retiredPattern(): RegExp {
  const spellings: string[] = [];
  for (const [from] of HOST_LAYOUT.retired) {
    const rest = from.startsWith(`${HOST_LAYOUT.home}/`) ? from.slice(HOST_LAYOUT.home.length) : null;
    if (rest === null) spellings.push(`(?<![\\w.$}~-])${esc(from)}`);
    else for (const home of ["~", "$HOME", "${HOME}", "%h", HOST_LAYOUT.home]) spellings.push(esc(home + rest));
  }
  return new RegExp(`(?:${spellings.join("|")})(?![\\w-])`);
}

// Dated records and documents keep their history; inventories are observations; tests may name retired paths.
const EXEMPT = [
  /^docs\//,
  /\.mdx?$/,
  /(^|\/)tests?\//,
  /\.test\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_tests\.rs$/,
  /^tools\/config\/host\/inventory\//,
  /^tools\/config\/host\/host-policy\.toml$/,
  /^tools\/config\/docs\//,
  /^crates\/infra\/infra\/src\/layout\.rs$/,
  /^packages\/engine\/core\/src\/host\/layout\.ts$/,
  /^crates\/os\/kernel\/comps\/drive\//, // FHS mount points of any Linux machine
  /^m3\/docs\//,
  /\d{4}-?\d{2}-?\d{2}/,
];
const TEXT =
  /\.(rs|[cm]?[jt]sx?|py|sh|ps1|json|toml|ya?ml|conf|inc|service|timer|socket|path|env|txt)$|(^|\/)(Dockerfile|Justfile|[^./]+)$/;

test("no retired host location in code or config", () => {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
  });
  const pattern = retiredPattern();
  const hits: string[] = [];
  for (const file of listed.stdout.toString().split("\0")) {
    if (!file || !TEXT.test(file) || EXEMPT.some(r => r.test(file))) continue;
    if (file.startsWith("vendor/") || file.includes("node_modules/")) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (!pattern.test(text)) continue;
    text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
    });
  }
  expect(hits).toEqual([]);
});

test.skipIf(process.platform === "win32")("relink points symlinks into retired locations at their replacement", () => {
  const dir = mkdtempSync(join(tmpdir(), "host-relink-"));
  try {
    mkdirSync(join(dir, "app/releases/r1"), { recursive: true });
    symlinkSync("/srv/aphrody-creator/releases/r1", join(dir, "app/current"));
    symlinkSync("/home/ubuntu/apps/creator/releases/r1", join(dir, "app/kept"));
    symlinkSync("releases/r1", join(dir, "app/relative"));
    const links = retiredLinks([dir]);
    expect(links).toEqual([
      {
        path: join(dir, "app/current"),
        target: "/srv/aphrody-creator/releases/r1",
        replacement: "/home/ubuntu/apps/creator/releases/r1",
      },
    ]);
    relink(links);
    expect(readlinkSync(join(dir, "app/current"))).toBe("/home/ubuntu/apps/creator/releases/r1");
    expect(retiredLinks([dir])).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
