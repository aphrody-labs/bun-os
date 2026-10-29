import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");

/** Output directory of the managed host and its Konnect plugins. */
export const outputDirectory = join(repositoryRoot, "build", "ds-dotnet");

const projects = {
  host: join(packageRoot, "dotnet", "Aphrody.Ds.csproj"),
  plugins: join(packageRoot, "dotnet", "plugins", "Aphrody.Ds.Plugins.csproj"),
};

const vendors = ["kuriimu2", "spica", "pk3ds"];

function dotnet(args: string[]): void {
  const result = Bun.spawnSync([Bun.which("dotnet") ?? "dotnet", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1" },
  });
  if (result.exitCode !== 0) throw new Error(`dotnet ${args[0]} failed (${result.exitCode})`);
}

/** True when the assemblies are built. */
export function isBuilt(): boolean {
  return (
    existsSync(join(outputDirectory, "Aphrody.Ds.dll")) &&
    existsSync(join(outputDirectory, "plugins", "Aphrody.Ds.Plugins.dll"))
  );
}

/** Builds the host assembly and the Konnect plugin assembly from the pinned vendor submodules. */
export function build(configuration = "Release"): string {
  for (const vendor of vendors) {
    if (!existsSync(join(repositoryRoot, "vendor", vendor, ".git"))) {
      throw new Error(`vendor/${vendor} is not initialized: git submodule update --init vendor/${vendor}`);
    }
  }
  dotnet(["build", projects.host, "-c", configuration, "-o", outputDirectory]);

  // The plugin loader loads every dll of the plugin directory, so only the plugin assembly is kept there.
  const staging = join(repositoryRoot, "build", "ds-dotnet-plugins");
  rmSync(staging, { recursive: true, force: true });
  dotnet(["build", projects.plugins, "-c", configuration, "-o", staging]);
  const pluginDirectory = join(outputDirectory, "plugins");
  rmSync(pluginDirectory, { recursive: true, force: true });
  mkdirSync(pluginDirectory, { recursive: true });
  for (const file of ["Aphrody.Ds.Plugins.dll", "Aphrody.Ds.Plugins.pdb"]) {
    copyFileSync(join(staging, file), join(pluginDirectory, file));
  }
  rmSync(staging, { recursive: true, force: true });
  return outputDirectory;
}

if (import.meta.main) console.log(build(process.argv[2] ?? "Release"));
