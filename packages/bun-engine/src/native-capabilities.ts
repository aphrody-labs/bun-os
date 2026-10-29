import * as os from "node:os";
export interface NativeProbe {
  runtime: { version: string; revision: string; platform: string; arch: string };
  network: {
    host: string;
    dns: Awaited<ReturnType<typeof Bun.dns.lookup>>;
    dnsCache: ReturnType<typeof Bun.dns.getCacheStats>;
    tcp443: { connected: boolean; latencyMs: number; error?: string };
  };
  media: {
    image: { available: boolean; backend?: string };
    video: { available: boolean; decoder?: string };
  };
  packages: { winget: { available: boolean; executable: string | null } };
  os: Record<string, unknown>;
}

async function probeTcp(host: string): Promise<NativeProbe["network"]["tcp443"]> {
  const started = Bun.nanoseconds();
  try {
    const socket = await Bun.connect({
      hostname: host,
      port: 443,
      tls: true,
      socket: {
        data() {},
        open(socket) {
          socket.end();
        },
        error() {},
      },
    });
    socket.end();
    return { connected: true, latencyMs: (Bun.nanoseconds() - started) / 1_000_000 };
  } catch (error) {
    return {
      connected: false,
      latencyMs: (Bun.nanoseconds() - started) / 1_000_000,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Windows facts through bun:ffi (kernel32, shell32) and node:os: no fork module. */
async function probeWindows(): Promise<Record<string, unknown>> {
  const { dlopen, FFIType } = await import("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", { GetLogicalDrives: { args: [], returns: FFIType.u32 } }).symbols;
  const shell32 = dlopen("shell32.dll", { IsUserAnAdmin: { args: [], returns: FFIType.bool } }).symbols;
  const mask = kernel32.GetLogicalDrives();
  const drives: string[] = [];
  for (let i = 0; i < 26; i++) if (mask & (1 << i)) drives.push(`${String.fromCharCode(65 + i)}:\\`);
  return {
    api: "node:os+bun:ffi",
    supported: true,
    elevated: shell32.IsUserAnAdmin(),
    version: os.version(),
    release: os.release(),
    system: {
      processors: os.availableParallelism(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
    },
    drives,
  };
}

/** Linux facts from procfs: capability sets and whether io_uring is allowed by the kernel. */
async function probeLinux(): Promise<Record<string, unknown>> {
  const status = await Bun.file("/proc/self/status")
    .text()
    .catch(() => "");
  const set = (name: string) => {
    const hex = status.match(new RegExp(`^${name}:\\s*([0-9a-fA-F]+)`, "m"))?.[1] ?? "0";
    return BigInt(`0x${hex}`);
  };
  const disabled = await Bun.file("/proc/sys/kernel/io_uring_disabled")
    .text()
    .then(value => Number.parseInt(value.trim(), 10))
    .catch(() => null);
  return {
    api: "procfs",
    supported: status.length > 0,
    ioUring: { disabled },
    capabilities: {
      effective: set("CapEff").toString(),
      permitted: set("CapPrm").toString(),
      inheritable: set("CapInh").toString(),
    },
  };
}

async function probeOs(): Promise<Record<string, unknown>> {
  if (process.platform === "win32") return probeWindows();
  if (process.platform === "linux") return probeLinux();
  return { api: process.platform, supported: false };
}

export async function probeNativeCapabilities(host = "www.retrostic.com"): Promise<NativeProbe> {
  Bun.dns.prefetch(host, 443);
  const [dns, tcp443, os] = await Promise.all([
    Bun.dns.lookup(host, { family: 0, socketType: "tcp", port: 443 }),
    probeTcp(host),
    probeOs(),
  ]);
  const winget = Bun.which("winget");
  const ffprobe = Bun.which("ffprobe");
  return {
    runtime: { version: Bun.version, revision: Bun.revision, platform: process.platform, arch: process.arch },
    network: { host, dns, dnsCache: Bun.dns.getCacheStats(), tcp443 },
    media: {
      image: {
        available: typeof Bun.Image === "function",
        backend: typeof Bun.Image === "function" ? Bun.Image.backend : undefined,
      },
      video: { available: ffprobe !== null, decoder: ffprobe ? "ffprobe" : undefined },
    },
    packages: { winget: { available: winget !== null, executable: winget } },
    os,
  };
}

/** Video metadata through the ffprobe executable (upstream Bun has no video decoder). */
async function probeVideo(path: string, ffprobe: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`ffprobe failed for ${path}: ${err.trim()}`);
  return { kind: "video", path, metadata: JSON.parse(out), decoder: "ffprobe" };
}

export async function probeMedia(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`media not found: ${path}`);
  try {
    const image = new Bun.Image(file);
    return { kind: "image", path, metadata: await image.metadata(), backend: Bun.Image.backend };
  } catch (imageError) {
    const ffprobe = Bun.which("ffprobe");
    if (!ffprobe) throw imageError;
    return probeVideo(path, ffprobe);
  }
}
