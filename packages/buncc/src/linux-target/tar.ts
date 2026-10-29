/** Minimal ustar/pax/GNU-longname reader, enough for Arch `.pkg.tar.zst` and repository `.db` archives. */
export interface TarEntry {
  path: string;
  /** "file" | "dir" | "symlink" | "hardlink" */
  type: "file" | "dir" | "symlink" | "hardlink";
  /** Link target for symlinks and hard links. */
  link: string;
  mode: number;
  data: Uint8Array;
}

const dec = new TextDecoder();
const cstr = (b: Uint8Array) => dec.decode(b).replace(/\0.*$/s, "");

/** pax extended header records ("<len> key=value\n"). */
function paxRecords(data: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const text = dec.decode(data);
  let i = 0;
  while (i < text.length) {
    const sp = text.indexOf(" ", i);
    if (sp < 0) break;
    const len = Number(text.slice(i, sp));
    if (!len) break;
    const rec = text.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out.set(rec.slice(0, eq), rec.slice(eq + 1));
    i += len;
  }
  return out;
}

export function untar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  let longName: string | undefined;
  let longLink: string | undefined;
  let pax = new Map<string, string>();
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const size = parseInt(cstr(h.subarray(124, 136)).trim() || "0", 8);
    const flag = String.fromCharCode(h[156] || 48);
    const prefix = cstr(h.subarray(345, 500));
    let path = cstr(h.subarray(0, 100));
    if (prefix && cstr(h.subarray(257, 263)).startsWith("ustar")) path = `${prefix}/${path}`;
    let link = cstr(h.subarray(157, 257));
    const mode = parseInt(cstr(h.subarray(100, 108)).trim() || "0", 8);
    off += 512;
    const data = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    if (flag === "L") {
      longName = cstr(data);
      continue;
    }
    if (flag === "K") {
      longLink = cstr(data);
      continue;
    }
    if (flag === "x") {
      pax = paxRecords(data);
      continue;
    }
    if (flag === "g") continue;
    path = pax.get("path") ?? longName ?? path;
    link = pax.get("linkpath") ?? longLink ?? link;
    longName = longLink = undefined;
    pax = new Map();
    const type =
      flag === "5" ? "dir" : flag === "2" ? "symlink" : flag === "1" ? "hardlink" : flag === "0" || flag === "\0" ? "file" : undefined;
    if (type) out.push({ path: path.replace(/^\.\//, "").replace(/\/$/, ""), type, link, mode, data });
  }
  return out;
}
