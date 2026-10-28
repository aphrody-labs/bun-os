#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- publication steps and guards must be sequential */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, resolve, relative, sep, posix } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { canonicalBunInputs } from "@aphrody/product/build-inputs";
import { checkoutRoot } from "@aphrody/paths";
import { runProcess } from "@aphrody/bun-workspace/process";

export const repository = resolve(import.meta.dir, "../../..");
export const serverSource = "packages/product/src/downloads/server.ts";
export const downloadsConfig = "tools/aphrody/config/downloads.json";
export const uiSourcePaths = [
  "packages",
  "apps/aphrody-app",
  "crates/aphrody-identity",
  downloadsConfig,
  "tools/aphrody/config/public-assets.json",
  "scripts/aphrody/release/publish-app-ui.ts",
  "scripts/aphrody/release/publish-app-ui.test.ts",
  "scripts/m3/fonts-sync.ts",
  "bun.lock",
  "package.json",
];
export function releaseBunCheckout(root = repository, env: NodeJS.ProcessEnv = process.env): string {
  return checkoutRoot("bun", {
    ...env,
    APHRODY_WORKSPACE_ROOT: root,
    APHRODY_BUN_CHECKOUT: env.APHRODY_BUN_CHECKOUT || join(root, "sources/bun"),
  });
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export interface ReleaseConfig {
  host: { target: string; root: string; service?: string };
  site: {
    appUi: {
      directory: string;
      declaration: string;
      nativeRpc: boolean;
      googleSearch?: { owner: string; module: string; environmentFile: string };
    };
  };
}
export function releasePlan(config: ReleaseConfig, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("An exact 40-character source revision is required");
  if (
    !["vps", "dbfr"].includes(config.host.target) ||
    !/^\/home\/[a-z0-9_-]+\/apps\/downloads$/.test(config.host.root) ||
    config.site.appUi.directory !== "app-ui" ||
    config.site.appUi.declaration !== "app-ui/deployment.json" ||
    config.site.appUi.nativeRpc !== false
  )
    throw new Error("Unsupported deployment catalog; preserve host and native RPC isolation");
  const id = "app-ui-" + revision;
  const base = posix.join(config.host.root, "app-ui");
  const service = config.host.service ?? "aphrody-downloads";
  if (service !== "aphrody-downloads") throw new Error("Unsupported systemd service owner");
  const search = config.site.appUi.googleSearch;
  if (
    search &&
    (search.owner !== "/home/ubuntu/.local/bin/aphrody" ||
      search.module !== "current/google-search.ts" ||
      search.environmentFile !== "current/google-search.env")
  )
    throw new Error("Unsupported Google search deployment catalog");
  return {
    revision,
    id,
    host: config.host.target,
    base,
    release: posix.join(base, "releases", id),
    server: posix.join(config.host.root, "app/server.ts"),
    declaration: posix.join(base, "deployment.json"),
    restart:
      "sudo systemctl restart " +
      quote(service + ".service") +
      "; systemctl is-active --quiet " +
      quote(service + ".service"),
    ...(search
      ? {
          search: {
            owner: search.owner,
            module: posix.join(base, search.module),
            environmentFile: posix.join(base, search.environmentFile),
          },
        }
      : {}),
    nativeRpc: false,
  };
}
export { canonicalBunInputs } from "@aphrody/product/build-inputs";

export function searchEnvironment(module: string, owner: string): string {
  if (
    !/^\/home\/[a-z0-9_-]+\/apps\/downloads\/app-ui\/current\/google-search\.ts$/.test(module) ||
    owner !== "/home/ubuntu/.local/bin/aphrody"
  )
    throw new Error("Invalid search environment owner");
  return `GOOGLE_SEARCH_SDK_MODULE=${module}\nGOOGLE_SEARCH_OWNER=${owner}\n`;
}
export function buildCommand(artifact: string, publicAssets = false): string[] {
  return ["bun", "packages/app-ui/build.ts", "--out", artifact, ...(publicAssets ? ["--public-assets"] : [])];
}
export function prerequisiteCommands(): string[][] {
  // Build exactly the JS owners imported by app-ui; fonts are checksum-pinned by their owner lock.
  return [
    // Tauri's canonical package exposes TS sources directly; Bun bundles them.
    ["bun", "scripts/m3/fonts-sync.ts", "--quiet"],
    ["bun", "scripts/m3/fonts-sync.ts", "--check", "--quiet"],
    ["bun", "--cwd", "packages/identity", "scripts/sprite.ts"],
  ];
}
export function declarationCommand(path: string): string {
  // Source \\n becomes exactly one shell backslash, so printf emits a real newline.
  return `printf '%s\\n' '{"schemaVersion":1,"root":"current"}' > ${quote(path)}`;
}
export function smokeCommand(directory: string): string {
  const curl = "curl -fsS --max-time 2 -H 'Host: aphrody.com' ";
  return (
    "curl -fsS --max-time 2 --retry 5 --retry-delay 1 --retry-connrefused --retry-max-time 15 " +
    "http://127.0.0.1:8797/health > /dev/null; " +
    curl +
    "http://127.0.0.1:8797/ -o " +
    quote(directory + "/home-smoke.html") +
    "; " +
    curl +
    "http://127.0.0.1:8797/os -o " +
    quote(directory + "/os-smoke.html") +
    "; " +
    'grep -Fq \'name="aphrody-rpc" content="unavailable"\' ' +
    quote(directory + "/home-smoke.html") +
    "; " +
    'grep -Fq \'name="aphrody-rpc" content="unavailable"\' ' +
    quote(directory + "/os-smoke.html")
  );
}
export function verifyArtifactProvenance(prior: unknown, current: unknown) {
  if (JSON.stringify(prior) !== JSON.stringify(current))
    throw new Error("Artifact source/checksum provenance does not match");
}
export function artifactManifest(
  directory: string,
  revision: string,
  publicAssets = false,
  sources?: ReturnType<typeof canonicalBunInputs>,
) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid source revision");
  const root = realpathSync(directory);
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  function walk(current: string) {
    for (const name of readdirSync(current).toSorted()) {
      const path = join(current, name);
      const info = lstatSync(path);
      const rel = relative(root, path);
      if (info.isSymbolicLink() || rel.startsWith(".." + sep) || /[\r\n\\]/.test(name))
        throw new Error("Artifact contains an unsafe path or symlink");
      if (info.isDirectory()) walk(path);
      else if (info.isFile() && rel !== "release-manifest.json" && rel !== "SHA256SUMS") {
        const bytes = readFileSync(path);
        files.push({
          path: rel.replaceAll(sep, "/"),
          bytes: bytes.length,
          sha256: sha(bytes),
        });
      } else if (!info.isFile()) throw new Error("Artifact contains a non-regular file");
    }
  }
  walk(root);
  if (sources && !files.some(file => file.path === "google-search.ts" && file.sha256 === sources.search.sha256))
    throw new Error("Artifact Google search source checksum mismatch");
  for (const required of ["index.html", "public-home.html", "app.js", "app.css", "public-docs.json"])
    if (!files.some(file => file.path === required)) throw new Error("Incomplete artifact: " + required);
  if (!files.some(file => file.path.startsWith("fonts/"))) throw new Error("Missing fonts");
  if (publicAssets && !files.some(file => file.path === "public-assets.json"))
    throw new Error("Missing public assets declaration");
  return {
    schemaVersion: 1,
    revision,
    publicAssets,
    files,
    ...(sources
      ? {
          sources: {
            bun: sources.revision,
            transferSourceCommit: sources.transferSourceCommit,
            transferSha256: sources.transferSha256,
            docs: sources.docs,
            search: sources.search,
          },
        }
      : {}),
  };
}
export function runtimeCommand(command: string[], executable = process.execPath): string[] {
  return command[0] === "bun" ? [executable, ...command.slice(1)] : command;
}
export interface BackendConfig {
  schemaVersion: 1;
  module: { revision: string; sha256: string };
  root: string;
  collections: Record<
    string,
    {
      pointer: string;
      hosts: string[];
      policySha256: string;
      owner: "aphrody-web-crawl";
    }
  >;
  /** Explicit opt-in for the existing /api/search route; otherwise retain Google. */
  searchCollection?: string;
}
export function backendReleasePlan(config: ReleaseConfig, revision: string, input: BackendConfig) {
  const ui = releasePlan(config, revision);
  if (ui.host !== "vps" || config.host.root !== "/home/ubuntu/apps/downloads")
    throw new Error("Backend requires the declared VPS Downloads owner");
  if (
    !input ||
    input.schemaVersion !== 1 ||
    Object.keys(input).some(
      key => !["schemaVersion", "module", "root", "collections", "searchCollection"].includes(key),
    ) ||
    !input.module ||
    Object.keys(input.module).some(key => !["revision", "sha256"].includes(key)) ||
    !/^[a-f0-9]{40}$/.test(input.module.revision) ||
    !/^[a-f0-9]{64}$/.test(input.module.sha256) ||
    input.root !== config.host.root + "/public-index" ||
    !input.collections ||
    typeof input.collections !== "object" ||
    Array.isArray(input.collections)
  )
    throw new Error("Explicit pinned public backend configuration required");
  const entries = Object.entries(input.collections);
  if (entries.length < 1 || entries.length > 8) throw new Error("Bounded explicit public collections required");
  for (const [name, collection] of entries) {
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
      !collection ||
      Object.keys(collection).some(key => !["pointer", "hosts", "policySha256", "owner"].includes(key)) ||
      collection.pointer !== name + ".pointer.json" ||
      collection.owner !== "aphrody-web-crawl" ||
      !/^[a-f0-9]{64}$/.test(collection.policySha256) ||
      !Array.isArray(collection.hosts) ||
      collection.hosts.length < 1 ||
      collection.hosts.length > 32 ||
      new Set(collection.hosts).size !== collection.hosts.length ||
      collection.hosts.some(
        host =>
          typeof host !== "string" ||
          host.length > 253 ||
          !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host) ||
          host.split(".").some(label => label.length > 63) ||
          /(?:^|\.)(?:localhost|local|internal|home|lan|onion)$/.test(host),
      )
    )
      throw new Error("Invalid public collection policy");
  }
  if (
    Buffer.byteLength(JSON.stringify(input.collections)) > 16384 ||
    (input.searchCollection !== undefined &&
      (typeof input.searchCollection !== "string" || !Object.hasOwn(input.collections, input.searchCollection)))
  )
    throw new Error("Search collection must be explicitly declared and bounded");
  const settings = structuredClone(input);
  const configSha256 = sha(Buffer.from(JSON.stringify(settings)));
  const id = `backend-${revision}-${settings.module.revision.slice(0, 12)}-${configSha256.slice(0, 12)}`;
  const base = posix.join(config.host.root, "backend");
  return {
    mode: "backend-only" as const,
    revision,
    id,
    host: ui.host,
    base,
    release: posix.join(base, "releases", id),
    server: ui.server,
    restart: ui.restart,
    module: posix.join(base, "current/public-index.ts"),
    environmentFile: posix.join(base, "current/public-index.env"),
    settings,
    configSha256,
    uiCurrent: ui.base + "/current",
    googleEnvironment: ui.search?.environmentFile,
  };
}
export function backendEnvironment(plan: ReturnType<typeof backendReleasePlan>): string {
  return (
    `PUBLIC_INDEX_SDK_MODULE=${plan.module}\nPUBLIC_INDEX_ROOT=${plan.settings.root}\nPUBLIC_INDEX_COLLECTIONS='${JSON.stringify(plan.settings.collections)}'\n` +
    (plan.settings.searchCollection
      ? `PUBLIC_SEARCH_BACKEND=public-index\nPUBLIC_INDEX_DEFAULT_COLLECTION=${plan.settings.searchCollection}\n`
      : "")
  );
}
export function backendArtifactManifest(
  directory: string,
  plan: ReturnType<typeof backendReleasePlan>,
  serverSha256: string,
) {
  const root = realpathSync(directory);
  if (lstatSync(directory).isSymbolicLink() || resolve(root) !== resolve(directory))
    throw new Error("Backend artifact directory must be canonical");
  const allowed = new Set(["server.ts", "public-index.ts", "public-index.env", "release-manifest.json", "SHA256SUMS"]);
  if (readdirSync(root).some(name => !allowed.has(name)))
    throw new Error("Backend artifact must contain only declared public files");
  for (const name of readdirSync(root)) {
    const stat = lstatSync(join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
      throw new Error("Unsafe backend artifact metadata/file");
  }
  const files = ["server.ts", "public-index.ts", "public-index.env"].map(path => {
    const file = join(root, path);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
      throw new Error("Unsafe backend artifact file");
    const data = readFileSync(file);
    return { path, bytes: data.length, sha256: sha(data) };
  });
  if (
    files[0]!.sha256 !== serverSha256 ||
    files[1]!.sha256 !== plan.settings.module.sha256 ||
    readFileSync(join(root, "public-index.env"), "utf8") !== backendEnvironment(plan)
  )
    throw new Error("Backend source/environment checksum mismatch");
  return {
    schemaVersion: 1,
    mode: "backend-only",
    revision: plan.revision,
    bun: plan.settings.module.revision,
    configSha256: plan.configSha256,
    files,
  };
}
export function backendActivationCommand(
  plan: ReturnType<typeof backendReleasePlan>,
  input: {
    archiveSha256: string;
    serverSha256: string;
    expectedServerSha256: string;
    expectedCurrent: string;
    expectedEnvironmentSha256: string;
  },
) {
  if (
    ![input.archiveSha256, input.serverSha256, input.expectedServerSha256].every(value =>
      /^[a-f0-9]{64}$/.test(value),
    ) ||
    (input.expectedCurrent !== "absent" &&
      !/^releases\/backend-[a-f0-9]{40}-[a-f0-9]{12}-[a-f0-9]{12}$/.test(input.expectedCurrent)) ||
    (input.expectedCurrent === "absent"
      ? input.expectedEnvironmentSha256 !== "absent"
      : !/^[a-f0-9]{64}$/.test(input.expectedEnvironmentSha256))
  )
    throw new Error("Exact live backend/server rollback guards required");
  const backup = plan.base + "/backups/" + plan.id;
  const current = plan.base + "/current";
  const pending = plan.base + "/" + plan.id + ".tar.gz.pending";
  const canonical = (path: string) =>
    `test ! -L ${quote(path)}; test "$(realpath -m -- ${quote(path)})" = ${quote(path)}`;
  const preserved = [
    `test "$(readlink ${quote(plan.uiCurrent)} || :)" = "$ui_before"`,
    ...(plan.googleEnvironment
      ? [`test "$(sha256sum ${quote(plan.googleEnvironment)} | cut -d ' ' -f1)" = "$google_before"`]
      : []),
  ].join("; ");
  const restore = [
    `live_server=$(sha256sum ${quote(plan.server)} | cut -d ' ' -f1); test "$live_server" = ${quote(input.serverSha256)} || test "$live_server" = ${quote(input.expectedServerSha256)} || { echo 'Foreign server change preserved; rollback refused' >&2; return 2; }`,
    `live_current=$(readlink ${quote(current)} || :); test "$live_current" = ${quote("releases/" + plan.id)} || test "$live_current" = ${quote(input.expectedCurrent === "absent" ? "" : input.expectedCurrent)} || { echo 'Foreign backend change preserved; rollback refused' >&2; return 2; }`,
    ...(input.expectedCurrent === "absent"
      ? []
      : [
          `echo ${quote(input.expectedEnvironmentSha256 + "  " + plan.base + "/" + input.expectedCurrent + "/public-index.env")} | sha256sum -c - || return 2`,
        ]),
    `echo ${quote(input.expectedServerSha256 + "  " + backup + "/server.ts")} | sha256sum -c -`,
    `cp -p ${quote(backup + "/server.ts")} ${quote(plan.server + ".rollback")}; mv ${quote(plan.server + ".rollback")} ${quote(plan.server)}`,
    input.expectedCurrent === "absent"
      ? `unlink ${quote(current)} || :`
      : `ln -s ${quote(input.expectedCurrent)} ${quote(current + ".rollback")}; mv -Tf ${quote(current + ".rollback")} ${quote(current)}`,
    plan.restart,
  ].join("; ");
  const route = `http://127.0.0.1:8797/api/index/search?query=qualification&collection=${Object.keys(plan.settings.collections)[0]}&num=1&start=0`;
  return [
    "set -eu; umask 077",
    canonical(posix.dirname(plan.base)),
    canonical(plan.base),
    canonical(plan.base + "/releases"),
    canonical(plan.base + "/backups"),
    canonical(plan.server),
    canonical(plan.settings.root),
    `test -d ${quote(plan.settings.root)}`,
    `systemctl cat aphrody-downloads.service | grep -Fxq ${quote("ExecStart=/home/ubuntu/.bun/bin/bun " + plan.server)}`,
    `systemctl cat aphrody-downloads.service | grep -Fxq ${quote("EnvironmentFile=" + plan.environmentFile)} || systemctl cat aphrody-downloads.service | grep -Fxq ${quote("EnvironmentFile=-" + plan.environmentFile)}`,
    `test -f ${quote(plan.server)}; echo ${quote(input.expectedServerSha256 + "  " + plan.server)} | sha256sum -c -`,
    input.expectedCurrent === "absent"
      ? `test ! -e ${quote(current)} && test ! -L ${quote(current)}`
      : `${canonical(plan.base + "/" + input.expectedCurrent)}; ${canonical(plan.base + "/" + input.expectedCurrent + "/public-index.env")}; test -L ${quote(current)}; test "$(readlink ${quote(current)})" = ${quote(input.expectedCurrent)}; echo ${quote(input.expectedEnvironmentSha256 + "  " + plan.environmentFile)} | sha256sum -c -`,
    `ui_before=$(readlink ${quote(plan.uiCurrent)} || :); ${plan.googleEnvironment ? `google_before=$(sha256sum ${quote(plan.googleEnvironment)} | cut -d ' ' -f1)` : ":"}`,
    `test ! -e ${quote(plan.release)} && test ! -L ${quote(plan.release)}; test ! -e ${quote(backup)} && test ! -L ${quote(backup)}`,
    ...[plan.server + ".pending", plan.server + ".rollback", current + ".pending", current + ".rollback"].map(
      path => `test ! -e ${quote(path)} && test ! -L ${quote(path)}`,
    ),
    `echo ${quote(input.archiveSha256 + "  " + pending)} | sha256sum -c -; mkdir -p ${quote(plan.release)} ${quote(backup)}`,
    `tar -xzf ${quote(pending)} -C ${quote(plan.release)}; cd ${quote(plan.release)}; sha256sum -c SHA256SUMS`,
    `echo ${quote(input.serverSha256 + "  " + plan.release + "/server.ts")} | sha256sum -c -; echo ${quote(plan.settings.module.sha256 + "  " + plan.release + "/public-index.ts")} | sha256sum -c -`,
    `${quote("/home/ubuntu/.bun/bin/bun")} -e ${quote('const sdk = await import(process.argv[1]); if (typeof sdk.createPublicIndexSearch !== "function") throw new Error("Invalid public SDK"); const search = sdk.createPublicIndexSearch(JSON.parse(process.argv[2])); if (typeof search !== "function") throw new Error("Invalid public SDK factory"); search.close?.();')} -- ${quote(plan.release + "/public-index.ts")} ${quote(JSON.stringify({ root: plan.settings.root, collections: plan.settings.collections }))}`,
    `cp -p ${quote(plan.server)} ${quote(backup + "/server.ts")}; echo ${quote(input.expectedServerSha256 + "  " + backup + "/server.ts")} | sha256sum -c -`,
    `printf '%s\\n' ${quote(input.expectedCurrent)} > ${quote(backup + "/previous-current")}`,
    `rollback() { ${restore}; }; trap 'status=$?; if test "$status" -ne 0; then rollback; fi; exit "$status"' EXIT`,
    `echo ${quote(input.expectedServerSha256 + "  " + plan.server)} | sha256sum -c -`,
    `cp -p ${quote(plan.release + "/server.ts")} ${quote(plan.server + ".pending")}; mv ${quote(plan.server + ".pending")} ${quote(plan.server)}`,
    `ln -s ${quote("releases/" + plan.id)} ${quote(current + ".pending")}; mv -Tf ${quote(current + ".pending")} ${quote(current)}`,
    plan.restart,
    `curl -fsS --retry 5 --retry-delay 1 --retry-connrefused --max-time 3 http://127.0.0.1:8797/health > /dev/null`,
    `status=$(curl -sS --max-time 5 -H 'Host: aphrody.com' -o ${quote(backup + "/index-smoke.json")} -w '%{http_code}' ${quote(route)}); test "$status" = 200 || test "$status" = 503`,
    `test "$(curl -sS --max-time 3 -H 'Host: aphrody.com' -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8797/api/index/search')" = 400`,
    preserved,
    "trap - EXIT",
  ].join(";\n");
}
async function backendMain(values: {
  apply?: boolean;
  build?: boolean;
  artifact?: string;
  out?: string;
  revision?: string;
  "backend-config"?: string;
  "expected-server-sha"?: string;
  "expected-backend-current"?: string;
  "expected-backend-env-sha"?: string;
  "public-assets"?: boolean;
}) {
  if (!values["backend-config"] || values["public-assets"])
    throw new Error("Backend-only requires explicit configuration and does not build UI assets");
  const config: ReleaseConfig = await Bun.file(join(repository, downloadsConfig)).json();
  const revision = values.revision ?? (await run(["git", "rev-parse", "HEAD"]));
  const configStat = lstatSync(values["backend-config"]);
  if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.nlink !== 1 || configStat.size > 32768)
    throw new Error("Bounded regular public backend configuration required");
  const backendConfig = (await Bun.file(values["backend-config"]).json()) as BackendConfig;
  const plan = backendReleasePlan(config, revision, backendConfig);
  console.log(
    JSON.stringify(
      {
        ...plan,
        prerequisite: `Declare EnvironmentFile=-${plan.environmentFile} through Infra before activation`,
        uiPreserved: true,
      },
      null,
      2,
    ),
  );
  if (!values.build && !values.apply) return;
  if (
    revision !== (await run(["git", "rev-parse", "HEAD"])) ||
    (await run([
      "git",
      "status",
      "--porcelain",
      "--",
      serverSource,
      "scripts/aphrody/release/publish-app-ui.ts",
      "scripts/aphrody/release/publish-app-ui.test.ts",
      downloadsConfig,
    ]))
  )
    throw new Error("Commit exact backend publisher/server source before publication");
  const bunCheckout = releaseBunCheckout();
  const modulePath = "packages/bun-google/src/public-index.ts";
  if (
    plan.settings.module.revision !== (await run(["git", "rev-parse", "HEAD"], bunCheckout)) ||
    (await run(["git", "status", "--porcelain", "--", modulePath], bunCheckout))
  )
    throw new Error("Commit exact canonical Bun SDK source before publication");
  const moduleFile = join(realpathSync(bunCheckout), modulePath);
  const moduleStat = lstatSync(moduleFile);
  if (
    !moduleStat.isFile() ||
    moduleStat.isSymbolicLink() ||
    moduleStat.nlink !== 1 ||
    realpathSync(moduleFile) !== resolve(moduleFile) ||
    sha(readFileSync(moduleFile)) !== plan.settings.module.sha256
  )
    throw new Error("Pinned canonical SDK checksum mismatch");
  const workspace = mkdtempSync(join(tmpdir(), "aphrody-backend-release-"));
  const artifact = resolve(values.artifact ?? values.out ?? join(workspace, "artifact"));
  if ([repository, bunCheckout].some(root => artifact === root || artifact.startsWith(root + sep)))
    throw new Error("Use an isolated backend artifact outside source checkouts");
  if (
    realpathSync(posix.dirname(artifact.replaceAll(sep, "/"))) !== resolve(posix.dirname(artifact.replaceAll(sep, "/")))
  )
    throw new Error("Artifact parent must be canonical");
  if (values.build) {
    // Exclusive staging: never overwrite an existing artifact or foreign symlink.
    mkdirSync(artifact);
    await Bun.write(join(artifact, "server.ts"), Bun.file(join(repository, serverSource)));
    await Bun.write(join(artifact, "public-index.ts"), Bun.file(moduleFile));
    await Bun.write(join(artifact, "public-index.env"), backendEnvironment(plan));
  }
  const serverSha256 = sha(readFileSync(join(repository, serverSource)));
  const manifest = backendArtifactManifest(artifact, plan, serverSha256);
  if (!values.build) verifyArtifactProvenance(await Bun.file(join(artifact, "release-manifest.json")).json(), manifest);
  await Bun.write(join(artifact, "release-manifest.json"), JSON.stringify(manifest));
  await Bun.write(
    join(artifact, "SHA256SUMS"),
    manifest.files.map(file => file.sha256 + "  " + file.path).join("\n") + "\n",
  );
  const archive = join(workspace, "backend.tar.gz");
  await run(["tar", "-czf", archive, "-C", artifact, "."]);
  const archiveSha256 = sha(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  console.log(
    JSON.stringify({
      mode: "backend-only",
      artifact,
      archive,
      archiveSha256,
      serverSha256,
      files: manifest.files.length,
      deployed: false,
    }),
  );
  if (!values.apply) return;
  const activation = backendActivationCommand(plan, {
    archiveSha256,
    serverSha256,
    expectedServerSha256: values["expected-server-sha"] ?? "",
    expectedCurrent: values["expected-backend-current"] ?? "",
    expectedEnvironmentSha256: values["expected-backend-env-sha"] ?? "",
  });
  const ssh = (command: string) => run(["aphrody", "infra", "ssh", "exec", "--host", plan.host, "--cmd", command]);
  const pending = plan.base + "/" + plan.id + ".tar.gz.pending";
  await ssh(
    `set -eu; test ! -L ${quote(plan.base)}; test "$(realpath -m -- ${quote(plan.base)})" = ${quote(plan.base)}; test ! -L ${quote(plan.base + "/publication.lock")}; test ! -e ${quote(plan.base + "/publication.lock")} || test -f ${quote(plan.base + "/publication.lock")}; test ! -e ${quote(pending)} && test ! -L ${quote(pending)}; mkdir -p ${quote(plan.base + "/releases")} ${quote(plan.base + "/backups")}`,
  );
  await run(["aphrody", "infra", "ssh", "sftp", "--host", plan.host, "--path", pending, "--put", archive]);
  // Separate from UI publication; no nginx or unit mutation and no UI symlink flip.
  await ssh(`flock --close -- ${quote(plan.base + "/publication.lock")} bash -c ${quote(activation)}`);
  console.log(
    JSON.stringify({
      mode: "backend-only",
      activated: plan.release,
      serverSha256,
      archiveSha256,
      uiPreserved: true,
      liveSearchQualified: false,
    }),
  );
}
export async function run(command: string[], cwd = repository, env: Record<string, string> = {}) {
  const { stdout, stderr, code } = await runProcess(runtimeCommand(command), cwd, {
    timeoutMs: 1_800_000,
    maxOutputBytes: 32 * 1024 * 1024,
    env: { ...Bun.env, ...env },
  });
  if (code !== 0) throw new Error(command[0] + " failed: " + (stdout + "\n" + stderr).slice(-3000));
  return stdout.trim();
}
async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      build: { type: "boolean" },
      artifact: { type: "string" },
      revision: { type: "string" },
      out: { type: "string" },
      "expected-server-sha": { type: "string" },
      "scp-fallback": { type: "boolean" },
      "public-assets": { type: "boolean" },
      "backend-only": { type: "boolean" },
      "backend-config": { type: "string" },
      "expected-backend-current": { type: "string" },
      "expected-backend-env-sha": { type: "string" },
    },
  });
  if (values["backend-only"]) return backendMain(values);
  if (values["backend-config"] || values["expected-backend-current"] || values["expected-backend-env-sha"])
    throw new Error("Backend options require --backend-only");
  const revision = values.revision ?? (await run(["git", "rev-parse", "HEAD"]));
  const config: ReleaseConfig = await Bun.file(join(repository, downloadsConfig)).json();
  const plan = releasePlan(config, revision);
  const publicAssets = values["public-assets"] ?? false;
  console.log(JSON.stringify({ ...plan, publicAssets }, null, 2));
  if (!values.build && !values.apply) return;
  if (revision !== (await run(["git", "rev-parse", "HEAD"]))) throw new Error("Selected revision must be current HEAD");
  const dirty = await run(["git", "status", "--porcelain", "--", ...uiSourcePaths]);
  if (dirty) throw new Error("Commit the complete owned UI/source batch before building or publishing");
  const bunCheckout = releaseBunCheckout();
  const bunRevision = await run(["git", "rev-parse", "HEAD"], bunCheckout);
  if (await run(["git", "status", "--porcelain", "--", "packages/bun-google/src/search.ts"], bunCheckout))
    throw new Error("Commit canonical Bun search and documentation sources before publication");
  const sources = canonicalBunInputs(bunCheckout, bunRevision);
  const workspace = mkdtempSync(join(tmpdir(), "aphrody-app-ui-release-"));
  const artifact = resolve(values.artifact ?? values.out ?? join(workspace, "artifact"));
  if (artifact === repository || artifact.startsWith(repository + sep))
    throw new Error("Use an isolated artifact directory outside the checkout");
  if (values.build) {
    for (const command of prerequisiteCommands()) await run(command);
    await run(buildCommand(artifact, publicAssets), repository, {
      APP_UI_DOCS_CATALOG: sources.docsFile,
      APHRODY_BUN_CHECKOUT: bunCheckout,
      APP_UI_BUN_REVISION: bunRevision,
    });
    await Bun.write(join(artifact, "google-search.ts"), Bun.file(sources.searchFile));
    if (plan.search)
      await Bun.write(join(artifact, "google-search.env"), searchEnvironment(plan.search.module, plan.search.owner));
  }
  if (
    plan.search &&
    readFileSync(join(artifact, "google-search.env"), "utf8") !==
      searchEnvironment(plan.search.module, plan.search.owner)
  )
    throw new Error("Artifact Google search environment does not match the declared owner");
  const manifest = artifactManifest(artifact, revision, publicAssets, sources);
  if (!values.build) {
    const prior = await Bun.file(join(artifact, "release-manifest.json")).json();
    verifyArtifactProvenance(prior, manifest);
  }
  await Bun.write(join(artifact, "release-manifest.json"), JSON.stringify(manifest));
  await Bun.write(
    join(artifact, "SHA256SUMS"),
    manifest.files.map(file => file.sha256 + "  " + file.path).join("\n") + "\n",
  );
  const archive = join(workspace, "app-ui.tar.gz");
  await run(["tar", "-czf", archive, "-C", artifact, "."]);
  const archiveHash = sha(new Uint8Array(await Bun.file(archive).arrayBuffer()));
  console.log(
    JSON.stringify({
      artifact,
      archive,
      sha256: archiveHash,
      files: manifest.files.length,
    }),
  );
  if (!values.apply) return;
  const expected = values["expected-server-sha"];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Apply requires --expected-server-sha from the reviewed host plan");
  const ssh = (command: string) => run(["aphrody", "infra", "ssh", "exec", "--host", plan.host, "--cmd", command]);
  const guard = `test "$(sha256sum ${quote(plan.server)} | cut -d ' ' -f 1)" = ${quote(expected)}`;
  if (plan.search)
    await ssh(
      `test -x ${quote(plan.search.owner)}; systemctl cat aphrody-downloads.service | grep -Fq ${quote("EnvironmentFile=-" + plan.search.environmentFile)}`,
    );
  await ssh("set -eu; " + guard + "; mkdir -p " + quote(plan.base + "/releases"));
  const upload = async (source: string, target: string, large = false) => {
    try {
      await run(["aphrody", "infra", "ssh", "sftp", "--host", plan.host, "--path", target, "--put", source]);
    } catch (error) {
      if (!large || !values["scp-fallback"]) throw error;
      // Native SFTP has a bounded large-transfer timeout. OpenSSH is an explicit coverage fallback.
      const resolved = await run(["ssh", "-G", plan.host]);
      if (!/^hostname (?![a-z]+$)\S+/m.test(resolved))
        throw new Error("OpenSSH host alias is not configured", {
          cause: error,
        });
      const executable = Bun.which("ssh");
      if (!executable)
        throw new Error("Native OpenSSH executable is unavailable", {
          cause: error,
        });
      await run(["scp", "-S", executable, "-o", "BatchMode=yes", source, plan.host + ":" + target]);
    }
  };
  const pending = plan.base + "/" + plan.id + ".tar.gz.pending";
  await upload(archive, pending, true);
  const sourceHash = sha(readFileSync(join(repository, serverSource)));
  await upload(join(repository, serverSource), plan.server + "." + plan.id + ".pending");
  const backup = plan.base + "/backups/" + plan.id;
  const rollback =
    `echo ${quote(expected + "  " + backup + "/server.ts")} | sha256sum -c - && ` +
    `cp -p ${quote(backup + "/server.ts")} ${quote(plan.server + ".rollback")} && mv ${quote(plan.server + ".rollback")} ${quote(plan.server)}; ` +
    `if test -s ${quote(backup + "/previous-current")}; then ln -s "$(cat ${quote(backup + "/previous-current")})" ${quote(plan.base + "/current.rollback")} && mv -Tf ${quote(plan.base + "/current.rollback")} ${quote(plan.base + "/current")}; else unlink ${quote(plan.base + "/current")} 2>/dev/null || :; fi; ` +
    `if test -f ${quote(backup + "/deployment.json")}; then (cd ${quote(backup)} && sha256sum -c deployment.sha256) && cp -p ${quote(backup + "/deployment.json")} ${quote(plan.declaration + ".rollback")} && mv ${quote(plan.declaration + ".rollback")} ${quote(plan.declaration)}; else rm -f ${quote(plan.declaration)}; fi; ${plan.restart}`;
  await ssh(
    `set -eu; ${guard}; test ! -e ${quote(plan.release)}; ` +
      `echo ${quote(archiveHash + "  " + pending)} | sha256sum -c -; mkdir -p ${quote(plan.release)} ${quote(backup)}; ` +
      `tar -xzf ${quote(pending)} -C ${quote(plan.release)}; cd ${quote(plan.release)}; sha256sum -c SHA256SUMS; ` +
      `echo ${quote(sourceHash + "  " + plan.server + "." + plan.id + ".pending")} | sha256sum -c -; ` +
      `cp -p ${quote(plan.server)} ${quote(backup + "/server.ts")}; echo ${quote(expected + "  " + backup + "/server.ts")} | sha256sum -c -; ` +
      `if test -e ${quote(plan.declaration)}; then cp -p ${quote(plan.declaration)} ${quote(backup + "/deployment.json")}; old_declaration_sha=$(sha256sum ${quote(plan.declaration)} | cut -d ' ' -f 1); printf '%s  deployment.json\\n' "$old_declaration_sha" > ${quote(backup + "/deployment.sha256")}; (cd ${quote(backup)} && sha256sum -c deployment.sha256); fi; ` +
      `readlink ${quote(plan.base + "/current")} > ${quote(backup + "/previous-current")} || :; ` +
      `rollback() { ${rollback}; }; trap 'status=$?; if test "$status" -ne 0; then rollback; fi; exit "$status"' EXIT; ` +
      `mv ${quote(plan.server + "." + plan.id + ".pending")} ${quote(plan.server)}; ` +
      `ln -s ${quote("releases/" + plan.id)} ${quote(plan.base + "/current.pending")}; ` +
      `mv -Tf ${quote(plan.base + "/current.pending")} ${quote(plan.base + "/current")}; ` +
      declarationCommand(plan.declaration + ".pending") +
      "; " +
      `mv ${quote(plan.declaration + ".pending")} ${quote(plan.declaration)}; ${plan.restart}; ` +
      smokeCommand(backup) +
      "; trap - EXIT",
  );
  console.log(JSON.stringify({ activated: plan.release, backup, sourceHash, rollback }));
}
if (import.meta.main) await main();
