// SPDX-License-Identifier: Apache-2.0
// What the Windows 11 template may contain. Paths are relative to the volume root with "/" separators.
//
// - \Windows and the Windows-owned parts of \Program Files are scanned, minus logs, caches, registry hives,
//   key stores and anything that records what this machine's user did or installed.
// - \ProgramData and \Users are never scanned: they come from the fixed skeleton below, so no name of the
//   owner's own files can reach the template.
// - PE files must be signed by Microsoft (embedded or catalog) to be published; others are only counted.

/** Top-level trees that are walked on the real volume. */
export const SCANNED_ROOTS = ["Windows", "Program Files", "Program Files (x86)"] as const;

/** Windows-owned folders of \Program Files and \Program Files (x86); everything else there is skipped. */
export const PROGRAM_FILES_ALLOW = [
  "Common Files/microsoft shared",
  "Common Files/System",
  "Common Files/Services",
  "Internet Explorer",
  "Windows Defender",
  "Windows Defender Advanced Threat Protection",
  "Windows Mail",
  "Windows Media Player",
  "Windows Multimedia Platform",
  "Windows NT",
  "Windows Photo Viewer",
  "Windows Portable Devices",
  "Windows Security",
  "Windows Sidebar",
  "WindowsPowerShell",
] as const;

/** Directories under \Windows that are skipped entirely (lowercase, relative to \Windows). */
export const WINDOWS_EXCLUDE = [
  "appcompat", // Amcache and program inventory of this machine
  "csc", // offline files of the user
  "debug",
  "downloaded program files",
  "installer", // MSI cache of installed software
  "livekernelreports",
  "logs",
  "minidump",
  "panther", // setup logs
  "prefetch", // names of executed programs
  "servicestate",
  "serviceprofiles", // service accounts' profiles
  "softwaredistribution",
  "temp",
  "ccmcache",
  "system32/config", // registry hives
  "system32/configuration",
  "system32/catroot2",
  "system32/grouppolicy",
  "system32/grouppolicyusers",
  "system32/logfiles",
  "system32/microsoft/protect", // DPAPI keys
  "system32/sru", // resource usage database
  "system32/tasks", // scheduled tasks of installed software
  "system32/wdi/logfiles",
  "system32/wbem/logs",
  "system32/wbem/repository",
  "system32/winevt/logs",
  "system32/spool/printers",
  "system32/spool/servers",
  "system32/drivers/etc", // hosts and networks files are machine configuration
  "system32/sleepstudy",
  "system32/networklist",
  "system32/msdtc",
  "system32/lxss", // WSL state
  "syswow64/config",
  "syswow64/tasks",
  "syswow64/grouppolicy",
  "syswow64/grouppolicyusers",
  "syswow64/logfiles",
  "winsxs/backup",
  "winsxs/temp",
  "winsxs/installtemp",
  "winsxs/filemaps",
  "winsxs/pendingdeletes",
  "winsxs/catalogs",
  "systemtemp",
  "wbem",
] as const;

/** File extensions that are never published (logs, journals, dumps, databases, temporary files). */
export const EXCLUDED_EXTENSIONS = new Set([
  "log",
  "log1",
  "log2",
  "etl",
  "evtx",
  "evt",
  "dmp",
  "mdmp",
  "hdmp",
  "tmp",
  "temp",
  "bak",
  "old",
  "chk",
  "blf",
  "regtrans-ms",
  "edb",
  "jrs",
  "jfm",
  "jtx",
  "db",
  "db-wal",
  "db-shm",
  "sqlite",
  "lock",
  "lck",
  "pf",
  "wer",
  "lnk",
  "url",
  "pfx",
  "p12",
  "pem",
  "key",
  "token",
  "cookie",
]);

export const PE_EXTENSIONS = new Set([
  "exe",
  "dll",
  "sys",
  "ocx",
  "cpl",
  "mui",
  "drv",
  "scr",
  "efi",
  "tlb",
  "ax",
  "acm",
  "tsp",
  "winmd",
]);
export const CONFIG_EXTENSIONS = new Set(["ini", "inf", "xml", "manifest", "json", "admx", "adml", "mof", "mfl"]);

export const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Inbox driver packages are named after an inf shipped in \Windows\INF; OEM ones are installed as oemNN.inf. */
export function driverStorePackageInbox(packageName: string, inboxInfs: ReadonlySet<string>): boolean {
  const m = /^(.+?\.inf)_(amd64|x86|arm64|wow64|ia64|arm)_[0-9a-f]{16}$/i.exec(packageName);
  return m !== null && inboxInfs.has(m[1]!.toLowerCase());
}

export type Verdict = "include" | "skip";

/**
 * Decides whether the walker descends into or publishes `rel` (e.g. "Windows/System32/kernel32.dll").
 * `inboxInfs` holds the lowercase inf names of \Windows\INF that are not oem*.inf.
 */
export function classify(rel: string, isDir: boolean, inboxInfs: ReadonlySet<string> = new Set()): Verdict {
  const parts = rel.split("/");
  const lower = rel.toLowerCase();
  const top = parts[0]!;
  const name = parts.at(-1)!;
  const lname = name.toLowerCase();
  if (parts.length === 1) return (SCANNED_ROOTS as readonly string[]).includes(top) && isDir ? "include" : "skip";
  if (top === "Program Files" || top === "Program Files (x86)") {
    const inside = parts.slice(1).join("/").toLowerCase();
    const allowed = PROGRAM_FILES_ALLOW.some(a => {
      const al = a.toLowerCase();
      return inside === al || inside.startsWith(`${al}/`) || (isDir && al.startsWith(`${inside}/`));
    });
    if (!allowed) return "skip";
  } else if (top === "Windows") {
    const inside = lower.slice("windows/".length);
    if (WINDOWS_EXCLUDE.some(x => inside === x || inside.startsWith(`${x}/`))) return "skip";
    // WinSxS: only the component manifests.
    if (inside.startsWith("winsxs")) {
      if (inside === "winsxs") return isDir ? "include" : "skip";
      if (!(inside === "winsxs/manifests" || inside.startsWith("winsxs/manifests/"))) return "skip";
    }
    // Third-party driver packages and their installed infs.
    if (/^system32\/driverstore\/filerepository\/[^/]+/.test(inside)) {
      const pkg = parts[4]!;
      if (!driverStorePackageInbox(pkg, inboxInfs)) return "skip";
    }
    if (inside.startsWith("inf/") && /^oem\d+\./.test(lname)) return "skip";
    if (inside.startsWith("system32/catroot/") && /^oem\d+\.cat$/.test(lname)) return "skip";
  } else return "skip";
  if (!safePath(rel, isDir)) return "skip";
  if (isDir) return "include";
  if (EXCLUDED_EXTENSIONS.has(extOf(name)) || /\.(log|etl)\.\d+$/i.test(name) || name.startsWith("~")) return "skip";
  return "include";
}

/** Fixed skeleton nodes: [relative path, attributes]. Directories only; nothing is read from the real tree. */
const D = 0x10;
const HS = 0x16; // directory | hidden | system
const RO = 0x11; // directory | read-only (shell folders)
export const SKELETON: readonly (readonly [string, number])[] = [
  ["PerfLogs", D],
  ["Program Files/WindowsApps", 0x12], // Store packages: names withheld
  ["Program Files/Common Files", D],
  ["Program Files (x86)/Common Files", D],
  ["ProgramData", 0x12],
  ["ProgramData/Microsoft", D],
  ["ProgramData/Microsoft/Windows", D],
  ["ProgramData/Microsoft/Windows/Start Menu", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs/Accessibility", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs/Accessories", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs/Startup", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs/System Tools", RO],
  ["ProgramData/Microsoft/Windows/Start Menu/Programs/Windows Tools", RO],
  ["ProgramData/Microsoft/Windows/Templates", D],
  ["ProgramData/Microsoft/Windows/WER", D],
  ["ProgramData/Microsoft/Windows Defender", D],
  ["ProgramData/Packages", D],
  ["ProgramData/regid.1991-06.com.microsoft", D],
  ["ProgramData/SoftwareDistribution", D],
  ["ProgramData/USOPrivate", D],
  ["ProgramData/USOShared", D],
  ["Users", RO],
  ["Users/Default", 0x13],
  ["Users/Public", RO],
  ["Users/Public/Desktop", 0x13],
  ["Users/Public/Documents", RO],
  ["Users/Public/Downloads", RO],
  ["Users/Public/Libraries", 0x13],
  ["Users/Public/Music", RO],
  ["Users/Public/Pictures", RO],
  ["Users/Public/Videos", RO],
  ...userProfile("Users/Default", HS),
  ...userProfile("Users/User", D),
];

/** The known-folder layout of one profile (FOLDERID_* defaults), with the standard AppData children. */
function userProfile(root: string, appDataAttr: number): [string, number][] {
  const out: [string, number][] = root.endsWith("/User") ? [[root, D]] : [];
  for (const f of [
    "3D Objects",
    "Contacts",
    "Desktop",
    "Documents",
    "Downloads",
    "Favorites",
    "Links",
    "Music",
    "OneDrive",
    "Pictures",
    "Saved Games",
    "Searches",
    "Videos",
  ])
    out.push([`${root}/${f}`, RO]);
  out.push(
    [`${root}/Pictures/Camera Roll`, D],
    [`${root}/Pictures/Saved Pictures`, D],
    [`${root}/Pictures/Screenshots`, D],
    [`${root}/AppData`, appDataAttr],
    [`${root}/AppData/Local`, D],
    [`${root}/AppData/Local/Microsoft`, D],
    [`${root}/AppData/Local/Microsoft/Windows`, D],
    [`${root}/AppData/Local/Microsoft/WindowsApps`, D],
    [`${root}/AppData/Local/Packages`, D],
    [`${root}/AppData/Local/Programs`, D],
    [`${root}/AppData/Local/Temp`, D],
    [`${root}/AppData/LocalLow`, D],
    [`${root}/AppData/Roaming`, D],
    [`${root}/AppData/Roaming/Microsoft`, D],
    [`${root}/AppData/Roaming/Microsoft/Windows`, D],
    [`${root}/AppData/Roaming/Microsoft/Windows/Start Menu`, RO],
    [`${root}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs`, RO],
    [`${root}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`, RO],
    [`${root}/AppData/Roaming/Microsoft/Windows/SendTo`, RO],
    [`${root}/AppData/Roaming/Microsoft/Windows/Templates`, D],
    [`${root}/AppData/Roaming/Microsoft/Windows/Recent`, RO],
  );
  return out;
}

/** Directories the skeleton keeps empty on purpose, so the explorer can say why. */
export const SKELETON_NOTE =
  "Skeleton: the standard Windows layout only. This folder's real contents are never scanned or published.";

/** Name patterns that must never appear in a published path (defence in depth over the rules above). */
export const FORBIDDEN_SEGMENTS = [
  /^\.ssh$/i,
  /^\.gnupg$/i,
  /^\.aws$/i,
  /^\.azure$/i,
  /^\.kube$/i,
  /^\.docker$/i,
  /^\.pypirc$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^\.cookies\.json$/i,
  /^\.env(\..*)?$/i,
  /^cookies$/i,
  /^login data$/i,
  /^ntuser\.(dat|ini|pol)/i,
  /^usrclass\.dat/i,
  /^\.git$/i,
  /^node_modules$/i,
];
/** Registry hive file names (no extension); checked on files only, since folders such as \Windows\System exist. */
const HIVE_FILES = /^(sam|security|software|system|default|components|drivers|bbi|elam|userdiff)$/i;

/** True when no segment of `rel` names a credential store, hive or secret. */
export function safePath(rel: string, isDir = false): boolean {
  const parts = rel.split("/");
  if (!isDir && HIVE_FILES.test(parts.at(-1)!)) return false;
  return !parts.some(seg => FORBIDDEN_SEGMENTS.some(re => re.test(seg)));
}
