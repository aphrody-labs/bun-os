// SPDX-License-Identifier: Apache-2.0
/**
 * Writes the Tauri 3 project of a conversion plan. The generated app is configuration only: the
 * behaviour lives in the `tauri-plugin-aphrody` runtime plugin, so a converted app carries no
 * copy of the navigation, download or proxy logic. The Tauri shell itself comes from
 * `@aphrody/scaffold`, the single scaffolder.
 */
import { existsSync } from "node:fs";
import { cp, copyFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  crateName,
  isUsableAppIcon,
  parseHexColor,
  solidIconPng,
  TAURI_3,
  tauriShell,
  writeFiles,
  type FileMap,
} from "@aphrody/scaffold";
import type { ConversionPlan, IconRef, SiteProbe } from "./types.ts";

export interface GenerateOptions {
  /** Directory of the `tauri-plugin-aphrody` crate. Defaults to `crates/tauri-plugin-aphrody` of this checkout. */
  wrapCrate?: string;
  /** Copy the repository `Cargo.lock` next to the project so versions match and offline builds work. */
  copyLock?: boolean;
  /** Allow writing into a non-empty directory. Existing files are still never overwritten. */
  force?: boolean;
  fetch?: typeof fetch;
}

export interface GenerateResult {
  outDir: string;
  files: string[];
  notes: string[];
}

export class GenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateError";
  }
}

const REPO_ROOT = resolve(import.meta.dir, "../../..");

function iconScore(icon: IconRef): number {
  const size = Math.max(
    0,
    ...(icon.sizes ?? "").split(/\s+/).map(part => Number.parseInt(part.split("x")[0] ?? "0", 10) || 0),
  );
  const png = /png/i.test(icon.type ?? "") || /\.png(?:$|\?)/i.test(icon.href) ? 1 : 0;
  const apple = /apple-touch/.test(icon.rel) ? 50 : 0;
  return png * 1000 + Math.min(size, 1024) + apple;
}

async function fetchIcon(
  site: SiteProbe,
  doFetch: typeof fetch,
  notes: string[],
): Promise<{
  png: Uint8Array | null;
  source: { ext: string; bytes: Uint8Array } | null;
}> {
  const candidates = [...(site.manifest?.icons ?? []), ...site.icons]
    .toSorted((a, b) => iconScore(b) - iconScore(a))
    .slice(0, 4);
  let source: { ext: string; bytes: Uint8Array } | null = null;
  for (const icon of candidates) {
    try {
      const res = await doFetch(icon.href, {
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > 5_000_000) continue;
      if (isUsableAppIcon(bytes)) return { png: bytes, source: { ext: "png", bytes } };
      if (!source) {
        const type = res.headers.get("content-type") ?? icon.type ?? "";
        const ext = /svg/i.test(type) ? "svg" : /png/i.test(type) ? "png" : /icon|ico/i.test(type) ? "ico" : "png";
        source = { ext, bytes };
      }
    } catch (error) {
      notes.push(`icon ${icon.href} not fetched: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { png: null, source };
}

async function findProjectIcon(dir: string): Promise<Uint8Array | null> {
  for (const candidate of [
    "public/icon.png",
    "public/apple-touch-icon.png",
    "public/icons/icon-512x512.png",
    "public/icon-512.png",
    "app/icon.png",
    "src/app/icon.png",
    "assets/icon.png",
    "icon.png",
  ]) {
    const path = join(dir, candidate);
    if (!existsSync(path)) continue;
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    if (isUsableAppIcon(bytes)) return bytes;
  }
  return null;
}

function relativeCrate(from: string, crate: string): string {
  const rel = relative(from, crate);
  return isAbsolute(rel) ? crate : rel;
}

export function sidecarBuildScript(entry: string, sourceDir: string): string {
  return `// SPDX-License-Identifier: Apache-2.0
// Compiles the project's server into the sidecar binary that Tauri bundles (\`bundle.externalBin\`).
import { mkdir } from "node:fs/promises";

const source = process.env.SIDECAR_SOURCE ?? ${JSON.stringify(sourceDir)};
const entry = process.env.SIDECAR_ENTRY ?? ${JSON.stringify(entry)};
const host = /host: (\\S+)/.exec(new TextDecoder().decode(Bun.spawnSync(["rustc", "-vV"]).stdout))?.[1];
if (!host) throw new Error("rustc -vV did not report a host triple");
const exe = host.includes("windows") ? ".exe" : "";
await mkdir("src-tauri/binaries", { recursive: true });
const result = Bun.spawnSync(
  ["bun", "build", "--compile", \`\${source}/\${entry}\`, "--outfile", \`src-tauri/binaries/server-\${host}\${exe}\`],
  { stdio: ["inherit", "inherit", "inherit"] },
);
process.exit(result.exitCode);
`;
}

/** Writes the project. Refuses a non-empty directory unless `force`, and never overwrites a file. */
export async function generateProject(
  plan: ConversionPlan,
  outDir: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const out = resolve(outDir);
  const { config } = plan;
  const notes: string[] = [];
  const doFetch = options.fetch ?? fetch;
  const wrapCrate = resolve(options.wrapCrate ?? join(REPO_ROOT, "crates/tauri-plugin-aphrody"));
  if (!existsSync(join(wrapCrate, "Cargo.toml"))) {
    throw new GenerateError(`tauri-plugin-aphrody crate not found at ${wrapCrate}`);
  }
  const tauriDir = join(out, "src-tauri");
  // The debug bridge is a feature of the wrap crate itself (`tauri_plugin_aphrody::wrap::debug`), wry only.
  const withDebug = config.engine === "wry";

  // Icon: the site's own when it is a usable PNG, otherwise a solid colour from its theme.
  let icon: Uint8Array | null = null;
  let iconSource: { ext: string; bytes: Uint8Array } | null = null;
  if (plan.probe.kind === "site") {
    const found = await fetchIcon(plan.probe, doFetch, notes);
    icon = found.png;
    iconSource = found.source;
  } else {
    icon = await findProjectIcon(plan.probe.input);
  }
  if (!icon) {
    const color = parseHexColor(plan.probe.kind === "site" ? plan.probe.themeColor : null) ?? undefined;
    icon = solidIconPng(256, color);
    notes.push(
      iconSource
        ? "site icon is not a square 8-bit RGBA PNG; a solid placeholder is used, run `bun run icons` to build the real set"
        : "no usable icon found; a solid placeholder is used, run `bun run icons` with your artwork",
    );
  }

  const files: FileMap = tauriShell({
    name: config.name,
    identifier: config.identifier,
    engine: config.engine,
    build: { frontendDist: "../dist" },
    window: { mode: "runtime" },
    csp: null,
    permissions: [],
    capabilityDescription:
      "No IPC: the wrapped page runs as in a browser. Grant permissions per origin with a `remote` capability.",
    runtimePlugin: {
      crate: "tauri-plugin-aphrody",
      path: relativeCrate(tauriDir, wrapCrate),
      init: 'tauri_plugin_aphrody::wrap::init(include_str!("../wrap.json"))',
      // Only the bundle mode needs the loopback server (axum, reqwest, rustls, tokio); `remote`
      // loads the deployed origin and `sidecar` spawns the project's own server with std only.
      features: [config.mode === "bundle" ? "wrap-bundle" : "wrap"],
    },
    debugBridge: withDebug,
    externalBin: config.mode === "sidecar" ? ["binaries/server"] : undefined,
    icon,
  });
  files["src-tauri/wrap.json"] = `${JSON.stringify(config, null, 2)}\n`;

  let iconFile = "src-tauri/icons/icon.png";
  if (iconSource && icon !== iconSource.bytes) {
    iconFile = `app-icon.${iconSource.ext}`;
    files[iconFile] = iconSource.bytes;
  }

  // Mode-specific payload.
  const scripts: Record<string, string> = {
    dev: "tauri dev",
    build: "tauri build",
    icons: `tauri icon ${iconFile}`,
    parity: "web-to-tauri parity .",
  };
  let bundleDist: { from: string; to: string } | null = null;
  if (config.mode === "bundle" && plan.probe.kind === "directory") {
    const staticDir = plan.probe.staticDir ?? "dist";
    bundleDist = {
      from: join(plan.probe.input, staticDir),
      to: join(out, "dist"),
    };
  } else {
    files["dist/index.html"] =
      `<!doctype html><meta charset="utf-8"><title>${config.name.replace(/[<&]/g, "")}</title>\n`;
    if (config.mode === "sidecar" && plan.probe.kind === "directory") {
      files["scripts/build-sidecar.ts"] = sidecarBuildScript(
        plan.probe.serverEntry ?? "server.ts",
        resolve(plan.probe.input),
      );
      scripts["build:sidecar"] = "bun scripts/build-sidecar.ts";
      notes.push("run `bun run build:sidecar` before `tauri build`: Tauri bundles src-tauri/binaries/server-<triple>");
    }
  }
  files["package.json"] =
    `${JSON.stringify({ name: crateName(config.name), version: "0.1.0", private: true, type: "module", scripts, devDependencies: { "@tauri-apps/cli": TAURI_3.jsCli } }, null, 2)}\n`;
  files["wrap-plan.json"] = `${JSON.stringify(plan, null, 2)}\n`;
  files["README.md"] = readme(plan);

  const written = await writeFiles(out, files, options.force ? "merge" : "empty");
  if (bundleDist) {
    await cp(bundleDist.from, bundleDist.to, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    notes.push(
      `copied ${relative(plan.probe.kind === "directory" ? plan.probe.input : out, bundleDist.from) || "."}/ to dist/; Tauri embeds it in the binary`,
    );
  }

  if (options.copyLock !== false) {
    const lock = join(REPO_ROOT, "Cargo.lock");
    const target = join(tauriDir, "Cargo.lock");
    if (existsSync(lock) && wrapCrate.startsWith(REPO_ROOT) && !existsSync(target)) {
      await copyFile(lock, target);
      written.push(target);
      notes.push("Cargo.lock copied from the repository so dependency versions match its pins");
    }
  }
  if (config.engine === "cef")
    notes.push(
      "cef engine: generated but not compiled by the generator's own checks; Koharu is the only CEF app qualified in this repository",
    );
  return { outDir: out, files: written, notes };
}

export function readme(plan: ConversionPlan): string {
  const { config } = plan;
  const risks = plan.risks
    .map(
      risk =>
        `| ${risk.severity} | ${risk.area} | ${risk.summary} | ${risk.mitigation.kind}: ${risk.mitigation.detail} |`,
    )
    .join("\n");
  const target = plan.probe.kind === "site" ? plan.probe.finalUrl : plan.probe.input;
  const runtimeNote =
    config.mode === "bundle"
      ? ""
      : "- The runtime is built without its `wrap-bundle` feature (no loopback server). To switch `mode` to `bundle`, select `wrap-bundle` in the features of the `tauri-plugin-aphrody` line of `src-tauri/Cargo.toml`.\n";
  return `<!-- SPDX-License-Identifier: Apache-2.0 -->

# ${config.name}

Native Tauri 3 app generated by \`@aphrody/web-to-tauri\` from \`${target}\`.

- Mode: **${config.mode}** · engine: **${config.engine}** · verdict: **${plan.verdict}**
- Behaviour: \`src-tauri/wrap.json\` (read by the \`tauri-plugin-aphrody\` runtime plugin). Edit it, do not fork the runtime.
${runtimeNote}- Plan and probe: \`wrap-plan.json\`.

## Why this mode

${plan.reasons.map(reason => `- ${reason}`).join("\n")}

## Remaining risks

| Severity | Area | Risk | Mitigation |
| --- | --- | --- | --- |
${risks}

A green build proves nothing about parity. Run \`bun run parity\` against the running app (debug bridge)
and review every \`manual\` row above.

## Commands

\`\`\`sh
bun install
bun run dev      # tauri dev
bun run build    # tauri build
bun run icons    # regenerate the icon set from app-icon.*
\`\`\`
`;
}
