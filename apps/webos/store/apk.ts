// SPDX-License-Identifier: Apache-2.0
// Alpine repository /repo/apk/v3.22/main/x86_64/ built from factory/alpine/aports/bunos/* with abuild inside an Alpine
// container. APKINDEX.tar.gz and packages are signed with an RSA key kept in the protected store; only the public key
// is served (/repo/apk/keys/).
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, run, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const IMAGE = "alpine:3.22";
const KEY = "aphrody-store.rsa";
export const apkDir = (ctx: Ctx) => join(ctx.store, "repo/apk/v3.22/main/x86_64");

export async function build(ctx: Ctx): Promise<void> {
  const out = apkDir(ctx);
  const keys = join(ctx.store, "repo/apk/keys");
  await mkdir(out, { recursive: true });
  await mkdir(keys, { recursive: true });
  await mkdir(join(ctx.secrets, "apk"), { recursive: true, mode: 0o700 });
  const work = join(ctx.store, ".work/apk");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(join(ctx.root, "factory/alpine/aports/bunos"), join(work, "bunos"), { recursive: true });
  const names = (await readdir(join(work, "bunos"), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const script = `set -u
apk add --no-cache alpine-sdk >/dev/null
adduser -D builder; addgroup builder abuild
if [ ! -f /keys/${KEY} ]; then
  su builder -c "abuild-keygen -n -b 4096" >/dev/null 2>&1
  cp /home/builder/.abuild/*.rsa /keys/${KEY}; cp /home/builder/.abuild/*.rsa.pub /keys/${KEY}.pub
fi
mkdir -p /home/builder/.abuild
cp /keys/${KEY} /home/builder/.abuild/${KEY}; cp /keys/${KEY}.pub /home/builder/.abuild/${KEY}.pub
echo "PACKAGER_PRIVKEY=/home/builder/.abuild/${KEY}" > /home/builder/.abuild/abuild.conf
cp /keys/${KEY}.pub /etc/apk/keys/
cp -r /work/bunos /home/builder/aports && chown -R builder /home/builder
for p in ${names.join(" ")}; do
  if su builder -c "cd /home/builder/aports/$p && abuild checksum >/dev/null 2>&1; abuild -F -r" >/tmp/$p.log 2>&1; then echo "BUILT $p"; else echo "FAILED $p"; tail -n 4 /tmp/$p.log; fi
done
rm -f /out/*.apk /out/APKINDEX.tar.gz
cp /home/builder/packages/aports/*/*.apk /home/builder/packages/aports/*/APKINDEX.tar.gz /out/ 2>/dev/null || cp /home/builder/packages/*/*/*.apk /home/builder/packages/*/*/APKINDEX.tar.gz /out/
cp /keys/${KEY}.pub /pub/aphrody-store.rsa.pub
chmod -R a+rX /out /pub
`;
  const r = await docker(IMAGE, script, { mounts: [`${work}:/work`, `${out}:/out`, `${keys}:/pub`, `${join(ctx.secrets, "apk")}:/keys`], timeout: 3_000_000 });
  console.log(tail(r.out, 40));
  await run(["chmod", "600", join(ctx.secrets, "apk", KEY)]);
  const built = new Set([...r.out.matchAll(/^BUILT (\S+)/gm)].map((m) => m[1]!));
  const skipped: { name: string; reason: string }[] = [];
  for (const line of r.out.split("\n")) {
    const m = /^FAILED (\S+)/.exec(line);
    if (m) skipped.push({ name: m[1]!, reason: "" });
    else if (skipped.length && !line.startsWith("BUILT ") && skipped.at(-1)!.reason.length < 200) skipped.at(-1)!.reason += ` ${line.trim()}`;
  }
  if (!built.size) throw new Error("apk build produced nothing");
  const index = await run(["tar", "-xzOf", join(out, "APKINDEX.tar.gz"), "APKINDEX"]);
  const entries: IndexEntry[] = [];
  for (const block of index.out.split("\n\n")) {
    const f: Record<string, string> = {};
    for (const line of block.split("\n")) if (line[1] === ":") f[line[0]!] = line.slice(2);
    if (!f.P) continue;
    entries.push({
      name: f.P, version: f.V ?? "", desc: f.T ?? "", license: f.L, size: Number(f.S ?? 0), homepage: f.U,
      file: `/repo/apk/v3.22/main/x86_64/${f.P}-${f.V}.apk`, meta: { arch: f.A, depends: (f.D ?? "").split(" ").filter(Boolean) },
    });
  }
  await writeIndex(ctx, { format: "apk", generated: new Date().toISOString(), url: "/repo/apk/v3.22/main", entries, skipped });
  await rm(work, { recursive: true, force: true });
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const script = `set -eu
wget -qO /etc/apk/keys/aphrody-store.rsa.pub ${ctx.origin}/repo/apk/keys/aphrody-store.rsa.pub
echo ${ctx.origin}/repo/apk/v3.22/main >> /etc/apk/repositories
apk update
apk add bunos-hello
bunos-hello
apk info -e bunos-hello`;
  await step(steps, "apk update && apk add bunos-hello (signed index)", () => docker(IMAGE, script));
  return { format: "apk", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image: IMAGE, steps };
}
