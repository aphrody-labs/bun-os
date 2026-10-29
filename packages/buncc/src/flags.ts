/** Translation of the common compiler flags between the GNU (gcc, clang) and MSVC (cl, clang-cl) dialects. */

export type Dialect = "gnu" | "msvc";

export interface Translation {
  args: string[];
  /** Flags with no equivalent that were removed on purpose (-fPIC, -pthread, /nologo...). */
  dropped: string[];
  /** Flags that are not understood. They are passed through unchanged. */
  unknown: string[];
}

const MSVC_KNOWN =
  /^\/(c|E|nologo|Fo|Fe|Fd|I|D|U|O[12dxsity]*|Z[i7I]|W[0-4X]|w|EH[a-z-]*|M[DT]d?|std:|FI|TC|TP|Tc|Tp|LD|link|utf-8|permissive-|GR-?|GS-?|MP\d*|showIncludes|Zc:|external:|arch:|favor:|J|bigobj|diagnostics:|FS|Gy|Gw|Brepro|LIBPATH:)/;

/** An argument is an MSVC option when it matches a known option and is not an absolute POSIX path like /usr/include. */
export function isMsvcOption(arg: string): boolean {
  if (!MSVC_KNOWN.test(arg)) return false;
  // `/I/usr/include` is an option; `/Include/foo` or `/c/Users/x.c` is a path. Options never contain a second slash before an
  // optional value except for I, FI, Fo, Fe, Fd, external:I, LIBPATH: whose value may be a path.
  const path = /^\/[^/]*\//.test(arg);
  if (!path) return true;
  return /^\/(I|FI|Fo|Fe|Fd|external:I|LIBPATH:|Tc|Tp|D|U)/.test(arg);
}

/** Decide the dialect of an argument list from the program name and the flags. */
export function detectDialect(program: string, argv: string[]): Dialect {
  const base = program
    .replace(/^.*[\\/]/, "")
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (base === "cl" || base === "clang-cl" || base === "link" || base === "lib" || base === "lld-link") return "msvc";
  if (argv.some(isMsvcOption)) return "msvc";
  return "gnu";
}

const GNU_DROP = new Set([
  "-fPIC",
  "-fpic",
  "-fPIE",
  "-fpie",
  "-pthread",
  "-pipe",
  "-static",
  "-fno-plt",
  "-fvisibility=hidden",
  "-fdiagnostics-color=always",
  "-fdiagnostics-color=never",
  "-ffunction-sections",
  "-fdata-sections",
  "-gdwarf-4",
  "-gdwarf-5",
  "-MMD",
  "-MD",
  "-MP",
  "-MM",
  "-M",
]);
const GNU_DROP_WITH_ARG = new Set(["-MF", "-MT", "-MQ", "-arch"]);
const GNU_STD = /^-std=(?:gnu|c)(\+\+)?(\d+[a-z]*)$/;

/** GNU to MSVC. `-o` names the object with -c / -S and the executable otherwise. */
export function gnuToMsvc(argv: string[]): Translation {
  const out: string[] = [];
  const dropped: string[] = [];
  const unknown: string[] = [];
  const compileOnly = argv.some(arg => arg === "-c" || arg === "-S" || arg === "-E");
  const output = (value: string) => (compileOnly ? `/Fo${value}` : `/Fe${value}`);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (GNU_DROP.has(arg)) dropped.push(arg);
    else if (GNU_DROP_WITH_ARG.has(arg)) dropped.push(arg, next());
    else if (arg === "-c") out.push("/c");
    else if (arg === "-E") out.push("/E");
    else if (arg === "-S") out.push("/FA", "/c");
    else if (arg === "-o") out.push(output(next()));
    else if (arg.startsWith("-o") && arg.length > 2) out.push(output(arg.slice(2)));
    else if (arg === "-I" || arg === "-D" || arg === "-U") out.push(`/${arg[1]}${next()}`);
    else if (/^-[IDU]./.test(arg)) out.push(`/${arg[1]}${arg.slice(2)}`);
    else if (arg === "-isystem" || arg === "-idirafter") out.push(`/external:I${next()}`);
    else if (arg === "-include") out.push(`/FI${next()}`);
    else if (arg === "-O0") out.push("/Od");
    else if (arg === "-O1" || arg === "-Os" || arg === "-Oz") out.push("/O1");
    else if (arg === "-O" || arg === "-O2" || arg === "-O3" || arg === "-Ofast") out.push("/O2");
    else if (["-g", "-g1", "-g2", "-g3", "-ggdb"].includes(arg)) out.push("/Z7");
    else if (GNU_STD.test(arg)) {
      const m = GNU_STD.exec(arg)!;
      out.push(m[1] ? `/std:c++${m[2]}` : `/std:c${m[2]}`);
    } else if (arg === "-Wall" || arg === "-Wextra") out.push("/W3");
    else if (arg === "-Werror") out.push("/WX");
    else if (arg === "-w") out.push("/w");
    else if (arg === "-fexceptions") out.push("/EHsc");
    else if (arg === "-fno-exceptions") out.push("/EHs-c-");
    else if (arg === "-frtti") out.push("/GR");
    else if (arg === "-fno-rtti") out.push("/GR-");
    else if (arg === "-shared") out.push("/LD");
    else if (arg === "-x") {
      const lang = next();
      if (lang === "c") out.push("/TC");
      else if (lang === "c++") out.push("/TP");
      else dropped.push("-x", lang);
    } else if (arg === "-L") out.push(`/LIBPATH:${next()}`);
    else if (arg.startsWith("-L") && arg.length > 2) out.push(`/LIBPATH:${arg.slice(2)}`);
    else if (arg.startsWith("-l") && arg.length > 2) out.push(`${arg.slice(2)}.lib`);
    else if (arg.startsWith("-W") || arg.startsWith("-f") || arg.startsWith("-m")) dropped.push(arg);
    else if (arg.startsWith("-")) {
      unknown.push(arg);
      out.push(arg);
    } else out.push(arg);
  }
  return { args: out, dropped, unknown };
}

const MSVC_DROP =
  /^\/(nologo|MD|MT|MDd|MTd|GS-?|Gy|Gw|FS|MP\d*|utf-8|permissive-|Zc:.*|diagnostics:.*|bigobj|Brepro|showIncludes|Fd.*|J)$/;

/** MSVC to GNU. */
export function msvcToGnu(argv: string[]): Translation {
  const out: string[] = [];
  const dropped: string[] = [];
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (!isMsvcOption(arg)) {
      out.push(arg);
      continue;
    }
    if (MSVC_DROP.test(arg)) dropped.push(arg);
    else if (arg === "/c") out.push("-c");
    else if (arg === "/E") out.push("-E");
    else if (arg.startsWith("/Fo") || arg.startsWith("/Fe")) out.push("-o", arg.slice(3));
    else if (arg === "/I" || arg === "/D" || arg === "/U") out.push(`-${arg[1]}${next()}`);
    else if (/^\/[IDU]./.test(arg)) out.push(`-${arg[1]}${arg.slice(2)}`);
    else if (arg.startsWith("/external:I")) out.push("-isystem", arg.slice(11));
    else if (arg.startsWith("/FI")) out.push("-include", arg.slice(3));
    else if (arg === "/Od") out.push("-O0");
    else if (arg === "/O1" || arg === "/Os") out.push("-Os");
    else if (arg === "/O2") out.push("-O2");
    else if (arg === "/Ox") out.push("-O3");
    else if (arg === "/Zi" || arg === "/Z7" || arg === "/ZI") out.push("-g");
    else if (arg.startsWith("/std:")) {
      const std = arg.slice(5);
      out.push(`-std=${std === "c++latest" ? "c++2b" : std === "clatest" ? "c2x" : std}`);
    } else if (/^\/W[1-4]$/.test(arg)) out.push("-Wall");
    else if (arg === "/W0" || arg === "/w") out.push("-w");
    else if (arg === "/WX") out.push("-Werror");
    else if (arg.startsWith("/EH")) out.push(arg.includes("-") ? "-fno-exceptions" : "-fexceptions");
    else if (arg === "/GR") out.push("-frtti");
    else if (arg === "/GR-") out.push("-fno-rtti");
    else if (arg === "/LD") out.push("-shared");
    else if (arg === "/TC") out.push("-x", "c");
    else if (arg === "/TP") out.push("-x", "c++");
    else if (arg.startsWith("/Tc") || arg.startsWith("/Tp")) out.push("-x", arg[2] === "c" ? "c" : "c++", arg.slice(3));
    else if (arg.startsWith("/LIBPATH:")) out.push(`-L${arg.slice(9)}`);
    else if (arg === "/link") {
      // Everything after /link is linker syntax: keep libraries and search paths, drop the rest.
      for (i++; i < argv.length; i++) {
        const linkArg = argv[i]!;
        if (linkArg.startsWith("/LIBPATH:")) out.push(`-L${linkArg.slice(9)}`);
        else if (/\.lib$/i.test(linkArg)) out.push(`-l${linkArg.replace(/\.lib$/i, "")}`);
        else dropped.push(linkArg);
      }
    } else {
      unknown.push(arg);
      out.push(arg);
    }
  }
  return { args: out, dropped, unknown };
}

export function translate(argv: string[], from: Dialect, to: Dialect): Translation {
  if (from === to) return { args: [...argv], dropped: [], unknown: [] };
  return from === "gnu" ? gnuToMsvc(argv) : msvcToGnu(argv);
}
