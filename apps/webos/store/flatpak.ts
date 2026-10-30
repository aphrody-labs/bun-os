// SPDX-License-Identifier: Apache-2.0
// Flatpak repository (OSTree + static deltas + appstream) at /repo/flatpak/repo, signed with a key of the protected
// store. One launcher flatpak per WebOS registry package plus com.aphrody.WebOS; each opens the app on the origin through
// the OpenURI portal. Assembled by hand (metadata + files + export) and committed with `flatpak build-export`.
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { docker, run, step, tail, writeIndex, type Ctx, type IndexEntry, type QualResult, type QualStep } from "./common";

const BRANCH = "stable";
const RUNTIME = "org.freedesktop.Platform/x86_64/24.08";
const SDK = "org.freedesktop.Sdk/x86_64/24.08";
const IMAGE = "ubuntu:24.04";
const camel = (id: string) =>
  id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join("");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface App {
  id: string;
  name: string;
  summary: string;
  license: string;
  version: string;
  category: string;
  url: string;
  icon: string;
}

async function apps(ctx: Ctx): Promise<App[]> {
  const dist = Bun.env.WEBOS_DIST ?? join(ctx.store, "../current/dist");
  const fallback = join(ctx.root, "apps/webos/public/brand/512.png");
  const registry = (await Bun.file(join(dist, "registry.json")).json()) as {
    packages: { id: string; name: string; description: string; license: string; version: string; category: string }[];
  };
  const list: App[] = [
    {
      id: "com.aphrody.WebOS",
      name: "Aphrody Bun OS",
      summary: "The Bun OS tiling desktop in your browser",
      license: "Apache-2.0",
      version: "1.4.7",
      category: "System",
      url: `${ctx.origin}/os`,
      icon: fallback,
    },
  ];
  for (const p of registry.packages) {
    const own = join(dist, "apps", p.id, "aphrody-icon.png");
    list.push({
      id: `com.aphrody.webos.${camel(p.id)}`,
      name: p.name,
      summary: p.description,
      license: p.license,
      version: p.version.split("+")[0]!,
      category: p.category === "games" ? "Game" : p.category === "create" ? "Graphics" : "Utility",
      url: `${ctx.origin}/?app=${p.id}`,
      icon: (await Bun.file(own).exists()) ? own : fallback,
    });
  }
  return list;
}

const flatpak = (args: string[]) => run(["flatpak", ...args], { timeout: 600_000 });

export async function build(ctx: Ctx): Promise<void> {
  const home = join(ctx.secrets, "flatpak");
  await mkdir(home, { recursive: true });
  await chmod(home, 0o700);
  const gpg = (args: string[]) => run(["gpg", "--homedir", home, ...args]);
  if ((await gpg(["--list-secret-keys", "aphrody-flatpak"])).code)
    await gpg(["--batch", "--passphrase", "", "--quick-gen-key", "aphrody-flatpak <contact@aphrody.com>", "rsa3072", "sign", "never"]);
  const fpr = (await gpg(["--list-secret-keys", "--with-colons", "aphrody-flatpak"])).out
    .split("\n")
    .find((l) => l.startsWith("fpr"))!
    .split(":")[9]!;
  const exported = Bun.spawnSync(["gpg", "--homedir", home, "--export", fpr]);
  const gpgKey = Buffer.from(exported.stdout).toString("base64");
  const base = join(ctx.store, "repo/flatpak");
  const repo = join(base, "repo");
  const work = join(ctx.store, ".work/flatpak");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(base, { recursive: true });
  const list = await apps(ctx);
  const entries: IndexEntry[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const sign = [`--gpg-sign=${fpr}`, `--gpg-homedir=${home}`];
  for (const a of list) {
    const dir = join(work, a.id);
    const share = join(dir, "export/share");
    await mkdir(join(dir, "files/bin"), { recursive: true });
    await mkdir(join(share, "applications"), { recursive: true });
    await mkdir(join(share, "metainfo"), { recursive: true });
    await mkdir(join(share, "icons/hicolor/512x512/apps"), { recursive: true });
    await Bun.write(join(dir, "metadata"), `[Application]\nname=${a.id}\nruntime=${RUNTIME}\nsdk=${SDK}\ncommand=aphrody-open\n`);
    await Bun.write(join(dir, "files/bin/aphrody-open"), `#!/bin/sh\nexec xdg-open '${a.url}'\n`);
    await chmod(join(dir, "files/bin/aphrody-open"), 0o755);
    await Bun.write(
      join(share, "applications", `${a.id}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${a.name}\nComment=${a.summary}\nExec=aphrody-open\nIcon=${a.id}\nCategories=${a.category};\nTerminal=false\n`,
    );
    await cp(a.icon, join(share, "icons/hicolor/512x512/apps", `${a.id}.png`));
    await Bun.write(
      join(share, "metainfo", `${a.id}.metainfo.xml`),
      `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${a.id}</id>
  <name>${esc(a.name)}</name>
  <summary>${esc(a.summary.slice(0, 120))}</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>${esc(a.license)}</project_license>
  <description><p>${esc(a.summary)} Opens the app on ${esc(new URL(a.url).host)}, which installs it into your browser and keeps it available offline.</p></description>
  <launchable type="desktop-id">${a.id}.desktop</launchable>
  <url type="homepage">${ctx.origin}/apps</url>
  <releases><release version="${esc(a.version)}" date="${new Date().toISOString().slice(0, 10)}"/></releases>
  <content_rating type="oars-1.1"/>
</component>
`,
    );
    const r = await flatpak(["build-export", ...sign, "--update-appstream", repo, dir, BRANCH]);
    if (r.code) skipped.push({ name: a.id, reason: tail(r.out, 3) });
    else
      entries.push({
        name: a.id,
        version: a.version,
        desc: a.summary,
        license: a.license,
        file: "/repo/flatpak/repo",
        homepage: `${ctx.origin}/apps`,
        meta: { branch: BRANCH, runtime: RUNTIME, category: a.category, ref: `app/${a.id}/x86_64/${BRANCH}` },
      });
  }
  if (!entries.length) throw new Error(`flatpak build-export produced nothing: ${skipped[0]?.reason}`);
  const up = await flatpak(["build-update-repo", ...sign, "--generate-static-deltas", "--prune", repo]);
  console.log(tail(up.out, 6));
  if (up.code) throw new Error("flatpak build-update-repo failed");
  await Bun.write(
    join(base, "aphrody.flatpakrepo"),
    `[Flatpak Repo]\nTitle=Aphrody Bun OS\nComment=Bun OS web apps as Flatpaks\nUrl=${ctx.origin}/repo/flatpak/repo/\nHomepage=${ctx.origin}/apps\nDefaultBranch=${BRANCH}\nGPGKey=${gpgKey}\nNoDeps=true\n`,
  );
  for (const e of entries)
    await Bun.write(
      join(base, `${e.name}.flatpakref`),
      `[Flatpak Ref]\nTitle=${e.name}\nName=${e.name}\nBranch=${BRANCH}\nUrl=${ctx.origin}/repo/flatpak/repo/\nIsRuntime=false\nSuggestRemoteName=aphrody\nRuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo\nGPGKey=${gpgKey}\n`,
    );
  await run(["chmod", "-R", "a+rX", base]);
  await writeIndex(ctx, { format: "flatpak", generated: new Date().toISOString(), url: "/repo/flatpak/aphrody.flatpakrepo", entries, skipped });
  await rm(work, { recursive: true, force: true });
}

export async function qualify(ctx: Ctx): Promise<QualResult> {
  const steps: QualStep[] = [];
  const idx = (await Bun.file(join(ctx.store, "index/flatpak.json")).json().catch(() => undefined)) as { entries: IndexEntry[] } | undefined;
  const app = idx?.entries.find((e) => e.name === "com.aphrody.WebOS") ?? idx?.entries[0];
  if (!app) steps.push({ name: "app published", ok: false, ms: 0, log: "flatpak index has no app" });
  else {
    const script = `set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq flatpak ca-certificates curl >/dev/null
flatpak remote-add --system --if-not-exists aphrody ${ctx.origin}/repo/flatpak/aphrody.flatpakrepo
flatpak remote-ls aphrody --app
flatpak install --system --no-deps -y aphrody ${app.name}//${BRANCH}
flatpak list --app --columns=application,version,origin | grep ${app.name}
test -x /var/lib/flatpak/app/${app.name}/current/active/files/bin/aphrody-open`;
    await step(steps, `flatpak remote-add && flatpak install ${app.name} (signed)`, () => docker(IMAGE, script, { privileged: true, timeout: 900_000 }));
  }
  return { format: "flatpak", ok: steps.every((s) => s.ok), at: new Date().toISOString(), image: IMAGE, steps };
}
