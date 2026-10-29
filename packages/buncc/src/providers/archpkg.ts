/** Detect and install makepkg, namcap and pacman (Arch Linux packages, .pkg.tar.zst). PKGBUILDs are written by hand next to the code they package. */
import { missing, probeVersion, which } from "./_shared.ts";
import type { Provider } from "./types.ts";

export const makepkgProvider: Provider = {
  id: "makepkg",
  description: "makepkg, namcap and pacman for Arch Linux packages (.pkg.tar.zst)",
  platforms: ["linux"],
  async detect(ctx) {
    const makepkg = which("makepkg", ctx);
    if (!makepkg) return missing("sudo pacman -S --needed base-devel namcap   (Arch Linux, CachyOS, Omarchy)");
    const notes: string[] = [];
    if (!which("namcap", ctx)) notes.push("namcap missing: sudo pacman -S namcap");
    if (!which("zstd", ctx)) notes.push("zstd missing (needed for .pkg.tar.zst)");
    if (typeof process.getuid === "function" && process.getuid() === 0)
      notes.push("makepkg refuses to run as root; use a normal user");
    return {
      found: true,
      path: makepkg,
      version: await probeVersion(makepkg, ["--version"], ctx),
      notes: notes.length ? notes : undefined,
    };
  },
  install: () => ({ commands: [["sudo", "pacman", "-S", "--needed", "--noconfirm", "base-devel", "namcap"]] }),
  env: async () => ({ PKGEXT: ".pkg.tar.zst" }),
};
