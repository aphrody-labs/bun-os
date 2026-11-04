// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface SourceEntry {
  origin?: string;
  upstream?: string;
  path?: string;
  description?: string;
  localState?: string;
}

const root = process.cwd();
const sourcesFile = join(root, "vendor", "sources.json");
const gitmodulesFile = join(root, ".gitmodules");
const cargoToml = await Bun.file(join(root, "Cargo.toml")).text();
const packageJson = await Bun.file(join(root, "package.json")).text();

const sourcesJson = JSON.parse(await Bun.file(sourcesFile).text());
const sources: Record<string, SourceEntry> = sourcesJson.sources || {};

// Read .gitmodules
const gitmodulesText = await Bun.file(gitmodulesFile).text();
const submodulePaths = [...gitmodulesText.matchAll(/path\s*=\s*(.+)/g)].map(m => m[1].trim());

// Read vendor directory
const vendorDirs = readdirSync(join(root, "vendor")).filter(d => {
  try {
    return statSync(join(root, "vendor", d)).isDirectory();
  } catch {
    return false;
  }
});

interface VendorAnalysis {
  name: string;
  path: string;
  inSourcesJson: boolean;
  inGitmodules: boolean;
  inCargoToml: boolean;
  inPackageJson: boolean;
  origin?: string;
  upstream?: string;
  hasFork: boolean;
  description?: string;
  category: "vital-os" | "emulator" | "toolchain" | "redundant-fork" | "non-vital-doc" | "other";
}

const analyses: VendorAnalysis[] = [];

// Keywords for vital OS components
const VITAL_OS_KEYWORDS = [
  "cosmic", "niri", "smithay", "wayland", "rio", "nushell", "obscura",
  "waydroid", "oven-bun", "cachyos", "kernel", "wine", "uutils", "ripgrep",
  "fd", "bat", "eza", "sd", "just", "helix", "sudo-rs"
];

for (const dir of vendorDirs) {
  const relPath = `vendor/${dir}`;
  const srcKey = Object.keys(sources).find(k => (sources[k].path === dir || k === dir));
  const src = srcKey ? sources[srcKey] : undefined;

  const inCargo = cargoToml.includes(relPath) || cargoToml.includes(`"${dir}"`);
  const inPkg = packageJson.includes(relPath) || packageJson.includes(`"${dir}"`);
  const inSub = submodulePaths.includes(relPath);

  const hasFork = Boolean(src?.origin && src?.upstream && src.origin !== src.upstream);
  const isVital = VITAL_OS_KEYWORDS.some(k => dir.toLowerCase().includes(k) || srcKey?.toLowerCase().includes(k));

  let category: VendorAnalysis["category"] = "other";
  if (isVital) {
    category = "vital-os";
  } else if (dir.startsWith("wasm/") || dir.includes("wasm")) {
    category = "toolchain";
  } else if (["pcsx2", "rpcs3", "vita3k", "xemu", "flycast", "shadps4"].some(e => dir.includes(e))) {
    category = "emulator";
  } else if (hasFork && !inCargo && !inPkg) {
    category = "redundant-fork";
  }

  analyses.push({
    name: dir,
    path: relPath,
    inSourcesJson: Boolean(src),
    inGitmodules: inSub,
    inCargoToml: inCargo,
    inPackageJson: inPkg,
    origin: src?.origin,
    upstream: src?.upstream,
    hasFork,
    description: src?.description,
    category,
  });
}

console.log(`Scanned ${analyses.length} vendor directories.`);
const redundant = analyses.filter(a => a.category === "redundant-fork" || (!a.inCargoToml && !a.inPackageJson && a.category !== "vital-os"));
console.log(`Found ${redundant.length} non-vital / redundant vendor candidates.`);

await Bun.write(
  join(root, "scripts", "vendor-analysis-report.json"),
  JSON.stringify({ total: analyses.length, analyses, redundantCandidates: redundant }, null, 2)
);

console.log("Report written to scripts/vendor-analysis-report.json");
