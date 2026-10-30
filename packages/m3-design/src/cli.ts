#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//
//   m3-design [search] <query> [--domain <d>] [--stack <s>] [options]   UI/UX Pro Max search
//   m3-design system <product query> [-p "Name"] [options]             design-system recommendation
//   m3-design compile --prompt <brief> [--color <hex>] [--design-system <id>]
//   m3-design contrast <tokens.json | fg-hex bg-hex> [--json]           WCAG contrast (Replica)
//   m3-design parity <features.csv> [--visual <imgdiff.json>...]        feature parity (Replica)
//   m3-design imgdiff <original.png> <clone.png> [--mode layout|pixel]  screenshot diff (Replica)

const USAGE = `Usage: m3-design <command> [arguments]

Commands:
  search <query> [--domain d] [--stack s] [-n N] [--json]   Search the UI/UX Pro Max catalogs (default command)
  system <product query> [-p "Name"] [--persist ...]        Generate a design-system recommendation
  compile --prompt <brief> [--color hex] [--design-system id]
                                                           Compile a brief into an M3 React scaffold
  contrast <tokens.json | fg-hex bg-hex> [--json]           WCAG 2.2 contrast of design-token pairs
  parity <features.csv> [--visual diff.json...] [--markdown] Feature parity score of a clone
  imgdiff <original.png> <clone.png> [--out diff.png]      Layout or pixel diff of two screenshots

Run "m3-design search --help" for every search option.`;

const args = process.argv.slice(2);
const [command = "", ...rest] = args;

async function run(): Promise<number> {
  switch (command) {
    case "-h":
    case "--help":
    case "help":
      console.log(USAGE);
      return 0;
    case "compile": {
      const { parseCliArgs, runCli } = await import("./handlers.ts");
      const options = parseCliArgs(rest);
      if (!options) {
        console.error("Usage: m3-design compile --prompt <brief> [--color <hex>] [--design-system <id>]");
        return 2;
      }
      const { DesignCompiler } = await import("./generator.ts");
      const { nativeSpecValidator } = await import("./native.ts");
      const { loadDesignSystemFromDisk } = await import("./node.ts");
      const compiler = new DesignCompiler({
        validateSpec: nativeSpecValidator,
        loadDesignSystem: loadDesignSystemFromDisk,
      });
      return runCli(options, compiler);
    }
    case "contrast":
      return (await import("./contrast.ts")).contrastMain(rest);
    case "parity":
      return (await import("./parity.ts")).parityMain(rest);
    case "imgdiff":
      return (await import("./imgdiff.ts")).imgdiffMain(rest);
    case "system": {
      const { main } = await import("../intelligence/ui-ux-pro-max/scripts/search.ts");
      return main(rest.includes("--help") || rest.includes("-h") ? rest : [...rest, "--design-system"]);
    }
    case "search":
      return (await import("../intelligence/ui-ux-pro-max/scripts/search.ts")).main(rest);
    default:
      if (args.length === 0) {
        console.error(USAGE);
        return 2;
      }
      return (await import("../intelligence/ui-ux-pro-max/scripts/search.ts")).main(args);
  }
}

process.exitCode = await run();
