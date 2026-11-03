// SPDX-License-Identifier: Apache-2.0
// WordCraft's package must exist before the unified image consumes native debs.
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

export interface WordcraftImageSteps {
  buildPackage(): Promise<void>;
  buildImage(): Promise<void>;
  verifyImage(): Promise<void>;
}

/** A gate must qualify the exact published source revision used for the package. */
export function validateWordcraftGate(
  gate: { sha?: string; green?: boolean },
  head: string,
  upstream: string,
): void {
  if (
    !/^[0-9a-f]{40}$/.test(head) ||
    gate.green !== true ||
    gate.sha !== head ||
    upstream !== head
  )
    throw new Error(
      "WordCraft image requires the green published checkout revision",
    );
}

/** A failed stage prevents every later stage; success means the image was checked. */
export async function runWordcraftImageSteps(
  steps: WordcraftImageSteps,
): Promise<void> {
  await steps.buildPackage();
  await steps.buildImage();
  await steps.verifyImage();
}

/** Explicit operator action: no image or release claim is made until all stages pass. */
export async function wordcraftImage(): Promise<void> {
  const { git, home, readJson, repo, run, syncStateDir } =
    await import("./lib.ts");
  const { imageBuild } = await import("./nightly.ts");
  const successful = async (argv: string[]) => {
    const result = await run(argv);
    if (result.code !== 0)
      throw new Error(`${argv[0]} failed: ${result.out.slice(-1000)}`);
    return result.out.trim();
  };
  const gate = readJson<{ sha?: string; green?: boolean }>(
    join(syncStateDir, "gate.json"),
    {},
  );
  const head = (await git("rev-parse", "HEAD")).out.trim();
  const upstream = (await git("rev-parse", "origin/main")).out.trim();
  validateWordcraftGate(gate, head, upstream);
  for (const name of ["cargo", "cargo-xwin"]) {
    const active = await run(["pgrep", "-x", name]);
    if (active.code === 0) throw new Error(`Another ${name} build is active`);
    if (active.code !== 1)
      throw new Error(`Could not inspect ${name} processes`);
  }
  const manifest = Bun.TOML.parse(
    await Bun.file(join(repo, "apps/wordcraft/Cargo.toml")).text(),
  ) as {
    package?: { version?: string };
  };
  const version = manifest.package?.version;
  if (!version) throw new Error("WordCraft version is missing");
  const expected = `${version}+bunos${head.slice(0, 10)}`;
  await runWordcraftImageSteps({
    async buildPackage() {
      const child = Bun.spawn(
        [
          "sh",
          join(home, ".local/bin/aphrody-native-apps"),
          "container",
          "wordcraft",
        ],
        {
          cwd: repo,
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      if ((await child.exited) !== 0)
        throw new Error("WordCraft package build failed");
    },
    async buildImage() {
      if ((await git("rev-parse", "HEAD")).out.trim() !== head)
        throw new Error("Checkout changed after package build");
      const result = await imageBuild();
      if (!result.ok)
        throw new Error(`Unified image build failed: ${result.detail}`);
    },
    async verifyImage() {
      const prefix = [
        "docker",
        "run",
        "--rm",
        "--network=none",
        "--entrypoint",
      ];
      const installed = await successful([
        ...prefix,
        "dpkg-query",
        "bunos-unified:session",
        "-W",
        "-f=${Version}",
        "wordcraft",
      ]);
      if (installed !== expected)
        throw new Error(
          `Image has WordCraft ${installed}, expected ${expected}`,
        );
      const banner = await successful([
        ...prefix,
        "/usr/bin/wordcraft",
        "bunos-unified:session",
        "--version",
      ]);
      if (!banner.startsWith(`wordcraft ${version} `))
        throw new Error(
          "WordCraft in the image did not report its expected version",
        );
      // Exercise the real Markdown and DOCX codecs with a fresh synthetic document.
      const directory = await mkdtemp(join(tmpdir(), "bunos-wordcraft-probe-"));
      try {
        const marker = "Bun OS WordCraft local probe";
        await Bun.write(join(directory, "probe.md"), `${marker}\n`);
        const cli = [
          "docker",
          "run",
          "--rm",
          "--network=none",
          "--mount",
          `type=bind,src=${directory},dst=/probe`,
          "--entrypoint",
          "/usr/bin/wordcraft-cli",
          "bunos-unified:session",
        ];
        await successful([
          ...cli,
          "convert",
          "/probe/probe.md",
          "/probe/probe.docx",
        ]);
        const text = await successful([...cli, "text", "/probe/probe.docx"]);
        if (!text.includes(marker))
          throw new Error("WordCraft DOCX round-trip lost probe text");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      if ((await git("rev-parse", "HEAD")).out.trim() !== head)
        throw new Error("Checkout changed during image build");
      console.log(
        `WordCraft ${expected} installed in bunos-unified:session; graphical opening is not yet verified.`,
      );
    },
  });
}
