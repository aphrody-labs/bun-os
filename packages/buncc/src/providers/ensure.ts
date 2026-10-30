/** Managed downloads behind `buncc install <id> --run` and `buncc env <id> --ensure` for the POSIX/mingw/wine providers. */
import { ensureMingw } from "./mingw.ts";
import { ensureMsys2 } from "./msys2.ts";
import { ensurePosix } from "./posix.ts";
import { ensureWine } from "./wine.ts";

export const MANAGED_IDS = ["posix", "mingw", "msys2", "wine", "proton"] as const;
export type ManagedId = (typeof MANAGED_IDS)[number];
export const isManaged = (id: string): id is ManagedId => (MANAGED_IDS as readonly string[]).includes(id);

/** Download (checksum verified) and unpack. `dryRun` only resolves the release and asset. Returns lines to print. */
export async function ensureManaged(id: ManagedId, dryRun: boolean): Promise<string[]> {
  switch (id) {
    case "posix": {
      if (dryRun)
        return [
          "posix: would download uutils coreutils/findutils/diffutils, ripgrep, fd, sd (+ busybox-w32 on Windows)",
        ];
      const done = await ensurePosix();
      return [
        `shim directory: ${done.dir}`,
        `tools: ${Object.keys(done.tools).join(", ")}`,
        `shims: ${done.shims.length}`,
        ...done.skipped.map(s => `skipped ${s}`),
      ];
    }
    case "mingw": {
      const done = await ensureMingw({ dryRun });
      return [
        `llvm-mingw ${done.tag} (${done.asset.name}, sha256 ${done.asset.sha256.slice(0, 12)}): ${done.status}`,
        `bin: ${done.bin ?? done.dir}`,
      ];
    }
    case "msys2": {
      if (process.platform !== "win32") return ["msys2: not applicable on this host"];
      if (dryRun) return ["msys2: would unpack the pinned msys2-base-x86_64-20260927.tar.xz into the buncc cache"];
      return [`managed MSYS2 root: ${await ensureMsys2()}`];
    }
    case "wine":
    case "proton": {
      if (process.platform === "win32") return [`${id}: not applicable on Windows`];
      const done = await ensureWine(id, { dryRun });
      return [`${id} ${done.tag}: ${done.status}`, `dir: ${done.dir}`];
    }
  }
}
