// SPDX-License-Identifier: Apache-2.0
/** Enrich an unsealed candidate only. Activation remains the canonical Infra adapter. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export async function prepareGameCandidate(options: {
  release: string;
  releasesRoot: string;
  image: string;
  overlay: string;
  ingress: string;
  phase: "bootstrap" | "game";
}) {
  const root = realpathSync(options.releasesRoot);
  const candidate = realpathSync(options.release);
  if (
    !candidate.startsWith(root + "/") ||
    candidate.slice(root.length + 1).includes("/")
  ) {
    throw new Error(
      "Candidate must be a direct child of the declared releases root",
    );
  }
  if (await Bun.file(resolve(candidate, "release.json")).exists()) {
    throw new Error("A sealed release must never be modified");
  }
  const composePath = resolve(candidate, "compose.yaml");
  const nginxRoot = resolve(candidate, "nginx");
  const ingressPath = resolve(nginxRoot, "zz-dragonballfr-game.conf");
  if (
    lstatSync(composePath).isSymbolicLink() ||
    realpathSync(nginxRoot) !== nginxRoot ||
    (existsSync(ingressPath) && lstatSync(ingressPath).isSymbolicLink())
  ) {
    throw new Error("Candidate configuration must not contain symlinks");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(options.image))
    throw new Error("Immutable image ID required");
  const compose = JSON.parse(
    await Bun.file(resolve(candidate, "compose.yaml")).text(),
  );
  if (
    !compose.services?.site ||
    !compose.services?.gateway ||
    compose.services.site.image !== options.image
  ) {
    throw new Error(
      "Candidate must contain the qualified site image and gateway",
    );
  }
  const fullIngress = await Bun.file(options.ingress).text();
  const bootstrap = `# SPDX-License-Identifier: Apache-2.0
server {
    listen 80;
    listen [::]:80;
    server_name play.dragonballfr.com game-api.dragonballfr.com;
    add_header X-Robots-Tag noindex always;
    add_header Cache-Control no-store always;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 404; }
}
`;
  if (options.phase === "game") {
    const overlay = Bun.YAML.parse(await Bun.file(options.overlay).text()) as {
      services: { game: Record<string, unknown> };
    };
    const game = overlay.services?.game;
    if (!game || game.network_mode !== "host")
      throw new Error("Public game declaration required");
    compose.services.game = { ...game, image: options.image };
  } else if (compose.services.game) {
    throw new Error("Bootstrap cannot remove an already declared game service");
  }
  await Bun.write(
    ingressPath,
    options.phase === "game" ? fullIngress : bootstrap,
  );
  await Bun.write(composePath, JSON.stringify(compose, null, 2) + "\n");
  return {
    candidate,
    phase: options.phase,
    port: options.phase === "game" ? 5013 : null,
  };
}

if (import.meta.main) {
  const [release, releasesRoot, image, overlay, ingress, phase] =
    Bun.argv.slice(2);
  if (
    !release ||
    !releasesRoot ||
    !image ||
    !overlay ||
    !ingress ||
    !phase ||
    !["bootstrap", "game"].includes(phase)
  ) {
    throw new Error(
      "Usage: shenron-game-ingress.ts RELEASE RELEASES_ROOT IMAGE OVERLAY INGRESS bootstrap|game",
    );
  }
  console.log(
    JSON.stringify(
      await prepareGameCandidate({
        release,
        releasesRoot,
        image,
        overlay,
        ingress,
        phase: phase as "bootstrap" | "game",
      }),
    ),
  );
}
