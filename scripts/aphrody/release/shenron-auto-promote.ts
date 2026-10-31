#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readdirSync, lstatSync, copyFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeDeployment, deploymentSelection } from "./shenron-deployment-identity.ts";
import { renderPublicCdnGateway } from "../tools/infra/shenron-public-cdn-gateway.ts";

const infra = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
const config = await Bun.file(join(infra, "tools/config/shenron-auto-deploy.json")).json();
const [sha, image, work, job, previous] = process.argv.slice(2);
const selection = deploymentSelection(sha ?? "", config);
if (
  !/^[a-f0-9]{40}$/.test(sha ?? "") ||
  !/^sha256:[a-f0-9]{64}$/.test(image ?? "") ||
  !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(previous ?? "") ||
  work !== config.worktree ||
  job !== join(config.artifacts, selection.id)
)
  throw new Error("Invalid promotion identity");
const env = { ...process.env, APHRODY_SSH_COMMAND_TIMEOUT_SECS: "1800" };
function command(args: string[], inherit = false): string {
  const p = Bun.spawnSync(args, {
    env,
    stdout: inherit ? "inherit" : "pipe",
    stderr: "inherit",
  });
  if (p.exitCode !== 0) throw new Error(`Promotion command failed: ${args[0]} ${args[1] ?? ""}`);
  return inherit ? "" : (p.stdout?.toString().trim() ?? "");
}
function remote(code: string, inherit = false): string {
  return command(
    ["aphrody", "infra", "--root", infra, "ssh", "exec", "--host", config.targetHost, "-c", code],
    inherit,
  );
}
function quote(s: string): string {
  return "'" + s.replaceAll("'", "'\\''") + "'";
}
function js(code: string): string {
  return "bun -e " + quote(code);
}
async function digest(path: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
}
const upload = join(job!, "transfer");
mkdirSync(upload, { recursive: true, mode: 0o700 });
const imagePath = join(upload, "image.tar");
command(["docker", "image", "save", "--output", imagePath, image!], true);
const activePath = remote(`readlink -f ${config.remoteRoot}/current`);
const beforeBuildIdentity = activeDeployment(
  JSON.parse(
    remote(
      js(
        `const release=${JSON.stringify(activePath)};const m=await Bun.file(release+'/release.json').json();console.log(JSON.stringify({release,commit:m.commit,deployment:m.deployment}));`,
      ),
    ),
  ),
);
if (beforeBuildIdentity.id !== previous) throw new Error("Production changed before CDN config rendering");
const sealedCdn = JSON.parse(
  remote(
    js(
      `const release=${JSON.stringify(activePath)};const name='nginx/cdn-dragonballfr-ssl.conf';const m=await Bun.file(release+'/release.json').json();const expected=m.files?.[name];if(!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Sealed CDN config missing from manifest');const path=release+'/'+name;const file=Bun.file(path);if(!(await file.exists()))throw Error('Sealed CDN config missing');const source=await file.text();const hash=new Bun.CryptoHasher('sha256').update(source).digest('hex');if(hash!==expected)throw Error('Sealed CDN config digest mismatch');console.log(JSON.stringify({source,sha256:hash}));`,
    ),
  ),
);
if (typeof sealedCdn.source !== "string" || !/^[a-f0-9]{64}$/.test(sealedCdn.sha256 ?? ""))
  throw new Error("Invalid sealed CDN config response");
const renderedCdn = renderPublicCdnGateway(sealedCdn.source, "http://127.0.0.1:9077");
const entries: Record<string, Blob> = {};
function add(dir: string, prefix = "") {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name),
      relative = prefix + name,
      s = lstatSync(p);
    if (s.isSymbolicLink()) throw new Error("CDN artifact contains symlink");
    if (s.isDirectory()) add(p, relative + "/");
    else if (s.isFile()) entries[relative] = Bun.file(p);
    else throw new Error("CDN artifact contains special file");
  }
}
add(join(work!, "dist/cdn"));
entries["nginx/cdn-dragonballfr-ssl.conf"] = new Blob([renderedCdn]);
entries["nginx/cdn-dragonballfr-ssl.conf.source.sha256"] = new Blob([`${sealedCdn.sha256}\n`]);
if (
  !Object.keys(entries).some(p => p.startsWith("site/")) ||
  !Object.keys(entries).some(p => p.startsWith("_next/static/"))
)
  throw new Error("CDN artifact incomplete");
await Bun.Archive.write(join(upload, "cdn.tar.gz"), entries, {
  compress: "gzip",
  level: 3,
});
for (const name of [
  "prepare-shenron-auto-release.py",
  "stage-shenron-cdn.py",
  "seal-shenron-docker-release.py",
  "shenron_deployment_identity.py",
])
  copyFileSync(join(infra, "scripts/release", name), join(upload, name));
if (selection.deployment) await Bun.write(join(upload, "deployment.json"), JSON.stringify(selection.deployment) + "\n");
const checksums: Record<string, string> = {};
await Promise.all(
  readdirSync(upload).map(async name => {
    checksums[name] = await digest(join(upload, name));
  }),
);
await Bun.write(join(upload, "checksums.json"), JSON.stringify(checksums) + "\n");
const destination = `/tmp/shenron-auto-${selection.id}`;
remote(js(`require("node:fs").mkdirSync(${JSON.stringify(destination)},{recursive:true,mode:0o700})`));
command(
  [
    "aphrody",
    "infra",
    "--root",
    infra,
    "ssh",
    "sync",
    "--host",
    config.targetHost,
    "--source",
    upload,
    "--destination",
    destination,
    "--apply",
  ],
  true,
);
remote(
  js(
    `const fs=require("node:fs");const root=${JSON.stringify(destination)};const sums=JSON.parse(fs.readFileSync(root+"/checksums.json","utf8"));for(const [name,expected]of Object.entries(sums)){if(name.includes("/")||name.includes(".."))throw Error("Bad checksum path");const hash=new Bun.CryptoHasher("sha256");for await(const b of Bun.file(root+"/"+name).stream())hash.update(b);if(hash.digest("hex")!==expected)throw Error("Transfer checksum mismatch")}await new Bun.Archive(await Bun.file(root+"/cdn.tar.gz").bytes()).extract(root+"/cdn");console.log("Transfer checksums verified")`,
  ),
  true,
);
const activeIdentity = activeDeployment(
  JSON.parse(
    remote(
      js(
        `const release=${JSON.stringify(activePath)};const m=await Bun.file(release+'/release.json').json();console.log(JSON.stringify({release,commit:m.commit,deployment:m.deployment}));`,
      ),
    ),
  ),
);
if (activeIdentity.id !== previous) throw new Error("Production changed during build; candidate preserved");
remote(`sudo -n docker image load --input ${destination}/image.tar`, true);
const remoteImage = remote(`sudo -n docker image inspect -f '{{.Id}}' ${image}`);
if (remoteImage !== image) throw new Error("Loaded image differs");
const release = `${config.remoteRoot}/releases/${selection.releaseName}`;
const prepare = [
  "sudo",
  "-n",
  "python3",
  "-B",
  `${destination}/prepare-shenron-auto-release.py`,
  "--root",
  config.remoteRoot,
  "--previous",
  activePath,
  "--commit",
  sha!,
  "--image-id",
  image!,
  "--artifact",
  `${destination}/cdn`,
  ...(selection.deployment ? ["--deployment", `${destination}/deployment.json`] : []),
]
  .map(quote)
  .join(" ");
remote(prepare + " --plan", true);
remote(prepare + " --apply", true);
remote(`sudo -n /usr/local/sbin/aphrody-infra-deploy-shenron verify ${release}`, true);
command(
  [
    "aphrody",
    "infra",
    "--root",
    infra,
    "deploy",
    "--target",
    config.targetHost,
    "--stack",
    "shenron",
    "--release",
    release,
    "--apply",
  ],
  true,
);
if (remote(`readlink -f ${config.remoteRoot}/current`) !== release) throw new Error("Activation identity differs");
await Bun.write(
  join(job!, "promotion.json"),
  JSON.stringify(
    {
      commit: sha,
      deploymentId: selection.id,
      image,
      previous,
      release,
      at: new Date().toISOString(),
      transferChecksums: checksums,
    },
    null,
    2,
  ) + "\n",
);
remote(js(`require("node:fs").rmSync(${JSON.stringify(destination)},{recursive:true})`));
rmSync(upload, { recursive: true });
console.log(`Activated Shenron ${sha}`);
