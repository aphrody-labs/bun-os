#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
// viz3d: the Bun OS command line of 3Dviz Pro Max. The same commands ship in the skill as scripts/<name>.js.
import { fetchAssetsCommand } from "./assets.ts";
import { findBlender } from "./blender.ts";
import { captureCommand } from "./capture.ts";
import { contextCommand, resolveCommand, searchCommand, UsageError } from "./commands.ts";
import { heroTierCommand } from "./hero-tier.ts";
import { hostProbeCommand } from "./host-probe.ts";
import { serveCommand } from "./serve-command.ts";
import { validateCommand } from "./validate.ts";

const HELP = `usage: viz3d <command> [options]   (each command takes --help)

  search <query>          lexical BM25 candidates over recipes and knowledge
  resolve <id>...         full records, cited sources and blueprint snippets
  context <objective>     design context: candidate groups, blueprints, quality brief (design-context)
  probe [--out host.json] host tools and the shipped-kit quality ceiling (host-probe)
  blender                 locate a runnable Blender (blender-locate)
  hero-tier --record ID   bake a blueprint's T3 hero GLB with Blender, cached
  serve --kit|--dir|--study  Bun.serve scene server (WebGPU kits, built scenes, the 37 studies)
  capture ...             CDP screenshots of a served scene, view quality, motion check
  validate                manifest, layout, JSON Schema and hash checks of the dataset
  fetch-assets            download the study anatomy meshes into the local cache`;

const json = (value: unknown) => console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));

export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "search":
        return json(searchCommand(rest)), 0;
      case "resolve":
        return json(resolveCommand(rest)), 0;
      case "context":
      case "design-context":
        return json(contextCommand(rest)), 0;
      case "probe":
      case "host-probe":
        return json(await hostProbeCommand(rest)), 0;
      case "blender":
      case "blender-locate":
        return json(await findBlender()), 0;
      case "hero-tier":
        return await heroTierCommand(rest);
      case "serve":
        return await serveCommand(rest);
      case "capture":
        return await captureCommand(rest);
      case "validate": {
        const { code, report } = validateCommand(rest);
        json(report);
        return code;
      }
      case "fetch-assets":
        return await fetchAssetsCommand(rest);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        return json(HELP), 0;
      default:
        console.error(`unknown command ${command}\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) process.exitCode = await run(Bun.argv.slice(2));
