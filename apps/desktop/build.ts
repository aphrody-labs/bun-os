import { join } from "node:path";
import { loadConfig, assertRuntime, repositoryRoot } from "@aphrody/bun-workspace";
import { capabilityFor, type Catalog } from "./shared.ts";
import { nativeVideoCapabilities } from "@aphrody/bun-video-project/native";

export const desktopRoot = import.meta.dir;
export const desktopOutput = join(repositoryRoot, "build/apps/desktop");

export async function buildDesktop() {
  const config = await loadConfig(repositoryRoot);
  assertRuntime(config);
  const catalog: Catalog = {
    runtime: {
      version: config.runtime.version,
      repository: config.runtime.repository,
    },
    video: { nativeAvailable: nativeVideoCapabilities().available },
    libraries: config.modules
      .filter(module => module.kind === "library")
      .map(module => ({
        id: module.id,
        priority: config.priorities?.includes(module.id) ?? false,
        ...capabilityFor(module.id),
        license: module.license,
        initialized: false,
        inspectable: false,
      })),
    inspections: [],
  };
  const web = await Bun.build({
    entrypoints: [join(desktopRoot, "src/app.ts")],
    outdir: join(desktopOutput, "web"),
    target: "browser",
    format: "esm",
    minify: true,
    define: { __APHRODY_CATALOG__: JSON.stringify(catalog) },
  });
  if (!web.success) throw new AggregateError(web.logs, "Bun frontend build failed");
  // Bundle the stylesheet so its @aphrody/m3-tokens imports resolve into web/style.css.
  const styles = await Bun.build({
    entrypoints: [join(desktopRoot, "src/style.css")],
    outdir: join(desktopOutput, "web"),
    target: "browser",
    minify: true,
  });
  if (!styles.success) throw new AggregateError(styles.logs, "Bun stylesheet build failed");
  await Bun.write(join(desktopOutput, "web/index.html"), Bun.file(join(desktopRoot, "src/index.html")));
  const server = await Bun.build({
    entrypoints: [join(desktopRoot, "server.ts")],
    outdir: desktopOutput,
    target: "bun",
    format: "esm",
    minify: true,
  });
  if (!server.success) throw new AggregateError(server.logs, "Bun backend build failed");
  console.log("Aphrody: " + catalog.libraries.length + " libraries bundled.");
  return desktopOutput;
}

if (import.meta.main) await buildDesktop();
