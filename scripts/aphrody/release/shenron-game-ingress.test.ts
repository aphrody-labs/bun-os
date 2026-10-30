// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareGameCandidate } from "./shenron-game-ingress";

const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "shenron-game-ingress-"));
  temporary.push(root);
  const release = join(root, "docker-fixture");
  mkdirSync(join(release, "nginx"), { recursive: true });
  const image = "sha256:" + "a".repeat(64);
  await Bun.write(
    join(release, "compose.yaml"),
    JSON.stringify({
      services: {
        site: { image, env_file: ["/etc/site.env"] },
        gateway: { image: "sha256:" + "b".repeat(64) },
      },
    }),
  );
  const overlay = join(root, "game.yaml");
  await Bun.write(
    overlay,
    "services:\n  game:\n    network_mode: host\n    environment:\n      SHENRON_SITE_SURFACE: game\n",
  );
  const ingress = join(root, "ingress.conf");
  await Bun.write(ingress, "server { listen 443 ssl; server_name play.dragonballfr.com; }\n");
  return { release, releasesRoot: root, image, overlay, ingress };
}

test("bootstrap publishes only bounded ACME ingress, preserving the application", async () => {
  const f = await fixture();
  await prepareGameCandidate({ ...f, phase: "bootstrap" });
  const compose = await Bun.file(join(f.release, "compose.yaml")).json();
  expect(Object.keys(compose.services)).toEqual(["site", "gateway"]);
  expect(compose.services.site.env_file).toEqual(["/etc/site.env"]);
  const conf = await Bun.file(join(f.release, "nginx/zz-dragonballfr-game.conf")).text();
  expect(conf).toContain("try_files $uri =404");
  expect(conf).toContain("X-Robots-Tag noindex always");
  expect(conf).not.toContain("proxy_pass");
  expect(conf).not.toContain("listen 443");
});

test("game phase reuses the exact sealed application image and preserves site policy", async () => {
  const f = await fixture();
  await prepareGameCandidate({ ...f, phase: "game" });
  const compose = await Bun.file(join(f.release, "compose.yaml")).json();
  expect(compose.services.game.image).toBe(f.image);
  expect(compose.services.game.env_file).toBeUndefined();
  expect(compose.services.site.env_file).toEqual(["/etc/site.env"]);
});

test("sealed candidates, escaping roots, mutable images and symlinked configurations are refused", async () => {
  const f = await fixture();
  await expect(prepareGameCandidate({ ...f, image: "latest", phase: "game" })).rejects.toThrow("Immutable");
  await expect(prepareGameCandidate({ ...f, releasesRoot: f.release, phase: "game" })).rejects.toThrow("direct child");
  await Bun.write(join(f.release, "release.json"), "{}");
  await expect(prepareGameCandidate({ ...f, phase: "game" })).rejects.toThrow("sealed release");
  const g = await fixture();
  symlinkSync(g.ingress, join(g.release, "nginx/zz-dragonballfr-game.conf"));
  await expect(prepareGameCandidate({ ...g, phase: "game" })).rejects.toThrow("symlinks");
});
