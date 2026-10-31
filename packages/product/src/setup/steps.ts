// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps */
/**
 * Steps of the one-click installer. The engine is omar-kit's (repeatable steps, simulation, downloads verified against
 * SHA256SUMS, MCP declaration with a backup); this file only adds what everyone gets beyond it: the installer itself and
 * its shortcut, the Claude plugins, and the two optional roles (administrator: omar-kit's access steps
 * and the kit; creator: creator-kit).
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { downloadVerified, extractTarGz, isCompiled, type ReleaseArtifact } from "../shared/update.ts";
import type { Context } from "../admin/lib/context.ts";
import {
  checkArtifact,
  downloadsFor,
  pickArtifact,
  WINDOWS_PLATFORM,
  type ManifestArtifact,
} from "../admin/lib/downloads.ts";
import {
  createShortcut,
  stepAcces,
  stepCles,
  stepDepot,
  stepMcp,
  stepPrerequis,
  type Step,
  type StepResult,
} from "../admin/lib/steps.ts";
import { findTool } from "../admin/lib/tools.ts";
import { stepNativeRuntime } from "./r2.ts";

export const DEFAULT_BASE = "https://downloads.aphrody.com";
export const SETUP_EXE = "Aphrody-Setup.exe";
/** Artifact names in latest.json of downloads.aphrody.com. */
export const ARTIFACTS = {
  setup: "aphrody-setup",
} as const;
export const PLUGINS = ["plugin-aphrody", "plugin-yolo"] as const;
/** Local Claude Code marketplace written next to the plugins (`claude plugin marketplace add <dir>`). */
export const MARKETPLACE = "aphrody-local";

export type Role = "admin" | "createur";

/** Install folders under `%LOCALAPPDATA%\Aphrody` (Omar's stays where omar-kit looks for it). */
export function setupDirs(ctx: Context) {
  const root = join(ctx.paths.localAppData, "Aphrody");
  return {
    setup: join(root, "Setup"),
    creator: join(root, "Creator"),
    omar: ctx.paths.installDir,
    plugins: join(ctx.paths.home, ".local", "share", "aphrody", "plugins"),
    tmp: join(root, "Setup", "tmp"),
  };
}

type Verified = { artifact: ManifestArtifact; base: string } | StepResult;

/** The artifact of `name` for Windows, cross-checked with SHA256SUMS; a StepResult says why not. */
async function verifiedArtifact(
  ctx: Context,
  name: string,
  extension: string,
  label: string,
  platform: string = WINDOWS_PLATFORM,
): Promise<Verified> {
  let manifest;
  let base;
  let sums;
  try {
    ({ manifest, base, sums } = await downloadsFor(ctx, DEFAULT_BASE));
  } catch (error) {
    return {
      state: "echec",
      detail: `le site de téléchargement est injoignable (${(error as Error).message})`,
      action: "Vérifie ta connexion Internet puis relance.",
    };
  }
  const artifact = pickArtifact(manifest, name, platform, extension);
  if (!artifact)
    return {
      state: "attente",
      detail: `${label} n'est pas encore publié pour Windows sur le site de téléchargement`,
      action: "Rien à faire de ton côté : relance ce programme quand il sera publié.",
    };
  try {
    checkArtifact(base, artifact, sums);
  } catch (error) {
    return {
      state: "echec",
      detail: `vérification refusée : ${(error as Error).message}`,
      action: "N'installe rien et préviens l'équipe.",
    };
  }
  return { artifact, base };
}

const isResult = (value: Verified): value is StepResult => "state" in value;

const asRelease = (artifact: ManifestArtifact): ReleaseArtifact => ({
  id: artifact.file ?? artifact.url,
  kind: "update",
  format: "tar.gz",
  platform: WINDOWS_PLATFORM,
  file: artifact.file ?? basename(artifact.url),
  url: artifact.url,
  sha256: artifact.sha256,
  size: artifact.size,
});

const windowsOnly = (ctx: Context): StepResult | undefined =>
  ctx.sys.platform === "win32" ? undefined : { state: "ignore", detail: "installation Windows seulement" };

export const stepSetup: Step = {
  id: "setup",
  titre: "Ce programme d'installation",
  async run(ctx, mode) {
    if (!isCompiled(ctx.exePath)) return { state: "ignore", detail: "lancé depuis les sources" };
    const dir = setupDirs(ctx).setup;
    if (dirname(ctx.exePath) === dir) return { state: "deja", detail: `installé dans ${dir}` };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `copie dans ${dir} (pour réparer ou mettre à jour)`,
      };
    await mkdir(dir, { recursive: true });
    await copyFile(ctx.exePath, join(dir, SETUP_EXE));
    return { state: "fait", detail: `copié dans ${dir}` };
  },
};

/** marketplace.json of the local Claude Code marketplace holding the downloaded plugins. */
export function marketplaceJson(plugins: { name: string; dir: string }[]): string {
  return `${JSON.stringify(
    {
      name: MARKETPLACE,
      owner: { name: "aphrody-dev", email: "contact@aphrody.com" },
      description: "Aphrody plugins installed by Aphrody-Setup from downloads.aphrody.com",
      plugins: plugins.map(plugin => ({
        name: plugin.name,
        source: `./${plugin.dir}`,
      })),
    },
    null,
    2,
  )}\n`;
}

export const stepPlugins: Step = {
  id: "plugins",
  titre: "Plugins Claude (aphrody, yolo)",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    const root = setupDirs(ctx).plugins;
    const found: { id: string; artifact: ManifestArtifact }[] = [];
    for (const id of PLUGINS) {
      // Plugins are published once for every platform (`any`).
      const verified = await verifiedArtifact(ctx, id, ".tar.gz", id, "any");
      if (isResult(verified)) {
        if (verified.state === "echec") return verified;
        continue;
      }
      found.push({ id, artifact: verified.artifact });
    }
    if (found.length === 0)
      return {
        state: "attente",
        detail: "aucun plugin publié sur le site de téléchargement",
      };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: `installer ${found.map(entry => entry.id).join(", ")} et les déclarer dans Claude Code`,
      };
    for (const { id, artifact } of found) {
      const archive = join(setupDirs(ctx).tmp, artifact.file ?? `${id}.tar.gz`);
      await downloadVerified(asRelease(artifact), archive, ctx.fetchImpl);
      await mkdir(root, { recursive: true });
      const dest = join(root, id);
      const staging = await mkdtemp(join(root, `.${id}-new-`));
      const backup = `${staging}.old`;
      let moved = false;
      let preserveBackup = false;
      try {
        await extractTarGz(archive, staging);
        try {
          await rename(dest, backup);
          moved = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await rename(staging, dest);
        } catch (error) {
          if (moved) {
            try {
              await rename(backup, dest);
            } catch (rollbackError) {
              preserveBackup = true;
              throw new AggregateError(
                [error, rollbackError],
                `restauration incomplète : sauvegarde conservée dans ${backup}`,
                { cause: rollbackError },
              );
            }
          }
          throw error;
        }
      } finally {
        await rm(staging, { recursive: true, force: true });
        if (!preserveBackup) await rm(backup, { recursive: true, force: true });
      }
      await rm(archive, { force: true });
    }
    await mkdir(join(root, ".claude-plugin"), { recursive: true });
    const plugins = found.map(({ id }) => ({
      name: id.replace(/^plugin-/, ""),
      dir: id,
    }));
    await writeFile(join(root, ".claude-plugin", "marketplace.json"), marketplaceJson(plugins));
    const claude = findTool(ctx.sys, ctx.paths, "claude");
    if (!claude)
      return {
        state: "attente",
        detail: `plugins copiés dans ${root} ; Claude Code n'est pas installé`,
        action: "Installe Claude Code puis relance ce programme pour les activer.",
      };
    await ctx.sys.run([claude, "plugin", "marketplace", "add", root, "--scope", "user"], {
      timeoutMs: 120_000,
    });
    const failed: string[] = [];
    for (const plugin of plugins) {
      const result = await ctx.sys.run(
        [claude, "plugin", "install", `${plugin.name}@${MARKETPLACE}`, "--scope", "user"],
        { timeoutMs: 300_000 },
      );
      if (result.code !== 0) failed.push(plugin.name);
    }
    return failed.length === 0
      ? {
          state: "fait",
          detail: `${plugins.map(p => p.name).join(", ")} installés dans Claude Code`,
        }
      : {
          state: "echec",
          detail: `Claude Code a refusé : ${failed.join(", ")}`,
          action: "Relance ce programme ; si ça recommence, préviens l'équipe.",
        };
  },
};

export const stepShortcut: Step = {
  id: "raccourci",
  titre: "Raccourci sur le Bureau",
  async run(ctx, mode) {
    const skip = windowsOnly(ctx);
    if (skip) return skip;
    // The shortcut reopens this installer (repair and update).
    const target = join(setupDirs(ctx).setup, SETUP_EXE);
    const lnk = join(ctx.paths.desktopDir, "Aphrody.lnk");
    if (existsSync(lnk)) return { state: "deja", detail: "« Aphrody » est sur le Bureau" };
    if (!isCompiled(ctx.exePath))
      return {
        state: "ignore",
        detail: "lancé depuis les sources : pas de raccourci",
      };
    if (mode === "simuler")
      return {
        state: "a-faire",
        detail: "raccourci « Aphrody » sur le Bureau",
      };
    if (!existsSync(target))
      return {
        state: "echec",
        detail: `${target} manque : la copie de ce programme a échoué`,
      };
    return (await createShortcut(ctx, lnk, target, "Aphrody - installation et réparation"))
      ? { state: "fait", detail: "raccourci « Aphrody » sur le Bureau" }
      : { state: "echec", detail: "Windows a refusé de créer le raccourci" };
  },
};

/** Both roles are embedded in this executable; access installation remains explicit. */
export const stepOmarKit: Step = {
  id: "admin-tools",
  titre: "Outils administrateur",
  async run() {
    return {
      state: "deja",
      detail: "intégrés dans Aphrody : admin <commande>",
    };
  },
};
export const stepCreatorKit: Step = {
  id: "creator-tools",
  titre: "Outils créateur",
  async run() {
    return {
      state: "deja",
      detail: "intégrés dans Aphrody : creator <commande>",
    };
  },
};

/** Everyone's steps, then each chosen role's. */
export function stepsFor(roles: ReadonlySet<Role>): Step[] {
  return [
    stepSetup,
    stepNativeRuntime,
    stepPlugins,
    stepMcp,
    stepShortcut,
    ...(roles.has("admin") ? [stepPrerequis, stepCles, stepAcces, stepDepot, stepOmarKit] : []),
    ...(roles.has("createur") ? [stepCreatorKit] : []),
  ];
}
