/**
 * Path translation between the spellings one file has on Windows and in POSIX layers:
 *
 *   windows  C:\Users\me\x      (also C:/Users/me/x, \\?\C:\..., \\server\share\...)
 *   msys     /c/Users/me/x      (MSYS2, Git for Windows bash)   UNC: //server/share/...
 *   cygwin   /cygdrive/c/Users/me/x
 *   wsl      /mnt/c/Users/me/x  (automount root is configurable in /etc/wsl.conf; default /mnt/), \\wsl.localhost\Distro\p (legacy \\wsl$\Distro\p also read) <-> /p
 *   posix    any other absolute or relative POSIX path (returned unchanged)
 *
 * Pure string functions: no file system access, so scripts can stop depending on a particular bash to convert paths.
 * Facts: WSL mounts drives under /mnt/<letter> by default (Microsoft Learn, "Advanced settings configuration in WSL",
 * automount root); Cygwin uses /cygdrive/<letter> (cygwin.com user guide, "Using Cygwin / Mount points").
 */

export type PathStyle = "windows" | "msys" | "cygwin" | "wsl" | "posix";

export interface ParsedPath {
  /** Drive letter (lower case) of a drive path. */
  drive?: string;
  /** UNC server and share. */
  unc?: { server: string; share: string };
  /** WSL distribution of a \\wsl$ path; `parts` is then the Linux path. */
  wslDistro?: string;
  absolute: boolean;
  parts: string[];
  style: PathStyle;
}

export interface PathOptions {
  /** WSL automount root, default "/mnt". */
  wslMount?: string;
  /** Separator written for the windows style, default "\\". */
  sep?: "\\" | "/";
}

const DRIVE = /^([A-Za-z]):(?:[\\/]|$)/;
const split = (s: string) => s.split(/[\\/]+/).filter(Boolean);

/** Guess the style of a path string. A bare `/x/...` with a one-letter first segment is msys. */
export function detectStyle(p: string, o: PathOptions = {}): PathStyle {
  const mount = (o.wslMount ?? "/mnt").replace(/\/+$/, "");
  if (DRIVE.test(p) || p.startsWith("\\\\")) return "windows";
  if (/^\/cygdrive\/[A-Za-z](\/|$)/.test(p)) return "cygwin";
  if (new RegExp(`^${mount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[A-Za-z](/|$)`).test(p)) return "wsl";
  if (/^\/[A-Za-z](\/|$)/.test(p)) return "msys";
  return "posix";
}

export function parsePath(p: string, o: PathOptions = {}): ParsedPath {
  const style = detectStyle(p, o);
  if (style === "windows") {
    const ext = /^\\\\\?\\UNC\\(.*)$/i.exec(p);
    if (ext) return parseUnc(ext[1]!);
    const verbatim = /^\\\\[?.]\\(.*)$/.exec(p);
    const s = verbatim ? verbatim[1]! : p;
    const wsl = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(.*)$/i.exec(s);
    if (wsl) return { wslDistro: wsl[1], absolute: true, parts: split(wsl[2]!), style: "windows" };
    if (s.startsWith("\\\\")) return parseUnc(s.slice(2));
    const d = DRIVE.exec(s);
    if (d) return { drive: d[1]!.toLowerCase(), absolute: /^[A-Za-z]:[\\/]/.test(s), parts: split(s.slice(2)), style };
    return { absolute: s.startsWith("\\"), parts: split(s), style };
  }
  if (style === "cygwin") {
    const m = /^\/cygdrive\/([A-Za-z])(.*)$/.exec(p)!;
    return { drive: m[1]!.toLowerCase(), absolute: true, parts: split(m[2]!), style };
  }
  if (style === "wsl") {
    const mount = (o.wslMount ?? "/mnt").replace(/\/+$/, "");
    const rest = p.slice(mount.length);
    const m = /^\/([A-Za-z])(.*)$/.exec(rest)!;
    return { drive: m[1]!.toLowerCase(), absolute: true, parts: split(m[2]!), style };
  }
  if (style === "msys") {
    const m = /^\/([A-Za-z])(.*)$/.exec(p)!;
    return { drive: m[1]!.toLowerCase(), absolute: true, parts: split(m[2]!), style };
  }
  if (/^\/\/[^/]/.test(p)) return parseUnc(p.slice(2));
  return { absolute: p.startsWith("/"), parts: split(p), style: "posix" };
}

function parseUnc(rest: string): ParsedPath {
  const [server = "", share = "", ...parts] = split(rest);
  return { unc: { server, share }, absolute: true, parts, style: "windows" };
}

/** Convert `p` to `target`. Drive paths round-trip; relative paths only change separators. */
export function convertPath(p: string, target: PathStyle, o: PathOptions = {}): string {
  if (p === "") return p;
  const parsed = parsePath(p, o);
  const mount = (o.wslMount ?? "/mnt").replace(/\/+$/, "");
  const sep = o.sep ?? "\\";
  const tail = parsed.parts;
  switch (target) {
    case "windows": {
      if (parsed.drive)
        return `${parsed.drive.toUpperCase()}:${tail.length || parsed.absolute ? sep : ""}${tail.join(sep)}`;
      if (parsed.unc) return `${sep}${sep}${[parsed.unc.server, parsed.unc.share, ...tail].join(sep)}`;
      if (parsed.wslDistro) return `\\\\wsl.localhost\\${parsed.wslDistro}\\${tail.join("\\")}`;
      // A plain POSIX absolute path has no Windows spelling without a distro; separators change only.
      return (parsed.absolute ? sep : "") + tail.join(sep);
    }
    case "msys":
    case "cygwin":
    case "wsl": {
      const base = target === "msys" ? "" : target === "cygwin" ? "/cygdrive" : mount;
      if (parsed.drive) return `${base}/${parsed.drive}${tail.length ? "/" + tail.join("/") : ""}`;
      if (parsed.unc) return `//${[parsed.unc.server, parsed.unc.share, ...tail].join("/")}`;
      if (parsed.wslDistro) return target === "wsl" ? "/" + tail.join("/") : p;
      return (parsed.absolute ? "/" : "") + tail.join("/");
    }
    case "posix":
      return convertPath(p, "msys", o);
  }
}

export const toWindows = (p: string, o?: PathOptions) => convertPath(p, "windows", o);
export const toMsys = (p: string, o?: PathOptions) => convertPath(p, "msys", o);
export const toCygwin = (p: string, o?: PathOptions) => convertPath(p, "cygwin", o);
export const toWsl = (p: string, o?: PathOptions) => convertPath(p, "wsl", o);

/** Does `s` look like a file path worth translating (used by argument translation)? */
export function looksLikePath(s: string, o: PathOptions = {}): boolean {
  return detectStyle(s, o) !== "posix" && !/^[A-Za-z]:[^\\/]/.test(s);
}
