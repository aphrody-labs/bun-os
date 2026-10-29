import { join } from "node:path";
import type { BunPlugin } from "bun";
import { build, cargoCommand, crateMetadata, findManifest, type BuildOptions } from "./build.ts";
import { TRIPLES } from "./tools.ts";

/**
 * A Bun plugin (runtime `Bun.plugin()` and `Bun.build`) that builds a crate when a module imports its
 * `Cargo.toml` or one of its `.rs` files. The package is cached in the crate's Cargo target directory
 * and the generated module is loaded in place of the import.
 *
 * ```ts
 * Bun.plugin(wasmPlugin());
 * const { default: init, greet } = await import("./crates/hello/src/lib.rs");
 * ```
 */
export function wasmPlugin(options: Omit<BuildOptions, "crate" | "outdir" | "packageJson" | "cache"> = {}): BunPlugin {
  return {
    name: "@aphrody/wasm",
    setup(builder) {
      builder.onLoad({ filter: /(^|[\\/])Cargo\.toml$|\.rs$/ }, async args => {
        const manifest = findManifest(args.path);
        const meta = await crateMetadata(manifest, undefined, cargoCommand(options.cargo));
        const triple = options.triple ?? TRIPLES[options.wasi ?? "unknown"];
        const outdir = join(
          meta.targetDirectory,
          "aphrody-wasm",
          `${meta.artifactName}-${triple}-${options.profile ?? "release"}`,
        );
        const built = await build({
          ...options,
          crate: manifest,
          outdir,
          packageJson: false,
          cache: true,
          quiet: options.quiet ?? true,
        });
        const js = JSON.stringify(built.js);
        return { contents: `export * from ${js};\nexport { default } from ${js};\n`, loader: "js" };
      });
    },
  };
}
