import { stopTestBrowser } from "./browser-process";
// Explicit execution gate against real generated Wii WASM and Chromium WebGPU.
const browser = process.env.IECODE_BROWSER;
if (!browser) throw new Error("Set IECODE_BROWSER to a Chromium executable");
const pkg = process.env.IECODE_WII_PKG
  ? Bun.pathToFileURL(`${process.env.IECODE_WII_PKG.replace(/[\\/]+$/, "")}/`)
  : new URL("../wii/pkg/", import.meta.url);
const dol = new Uint8Array(0x108);
const words = new DataView(dol.buffer);
for (const [offset, value] of [
  [0, 0x100],
  [0x48, 0x80004000],
  [0x90, 8],
  [0xe0, 0x80004000],
  [0x100, 0x38630001],
  [0x104, 0x4bfffffc],
]) {
  words.setUint32(offset!, value!, false);
}
type Report = { status?: number[]; width?: number; height?: number; error?: string };
let resolveReport!: (report: Report) => void;
const report = new Promise<Report>(resolve => {
  resolveReport = resolve;
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/report" && request.method === "POST") {
      resolveReport(await request.json());
      return new Response("ok");
    }
    if (path === "/dol") return new Response(dol);
    if (path === "/pkg/gecko_web.js" || path === "/pkg/gecko_web_bg.wasm") {
      return new Response(Bun.file(new URL(path.slice(5), pkg)));
    }
    if (path !== "/") return new Response("Not found", { status: 404 });
    return new Response(
      `<!doctype html><script type="module">
      import init, { start_emulator, start_wii_emulator, execution_status } from '/pkg/gecko_web.js';
      const report = data => fetch('/report', {method:'POST', body:JSON.stringify(data)});
      const originalError = console.error.bind(console);
      console.error = (...args) => { originalError(...args); report({error:args.map(String).join(' ')}); };
      window.addEventListener('error', event => report({error:event.message}));
      window.addEventListener('unhandledrejection', event => report({error:String(event.reason)}));
      try {
        await init();
        const dol = new Uint8Array(await (await fetch('/dol')).arrayBuffer());
        let rejected = false;
        try { start_wii_emulator(new Uint8Array(16)); } catch { rejected = true; }
        if (!rejected) throw new Error('Malformed DOL was accepted');
        rejected = false;
        try { start_emulator(new Uint8Array(16), 'broken.dol'); } catch { rejected = true; }
        if (!rejected) throw new Error('Malformed GameCube DOL was accepted');
        start_wii_emulator(dol);
        const timer = setInterval(() => {
          const status = Array.from(execution_status());
          if (status[0] >= 3) {
            clearInterval(timer);
            const canvas = document.querySelector('canvas');
            report({status, width:canvas?.width, height:canvas?.height});
          }
        }, 50);
      } catch (error) { report({error:String(error)}); }
    </script>`,
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
const separator = process.platform === "win32" ? "\\" : "/";
const tempRoot = (Bun.env.TMPDIR ?? Bun.env.TEMP ?? Bun.env.TMP ?? ".").replace(/[\\/]+$/, "");
const browserProfile = `${tempRoot}${separator}iecode-chromium-smoke-${crypto.randomUUID()}`;
await Bun.$`mkdir -p ${browserProfile}`;
const child = Bun.spawn(
  [
    browser,
    "--headless",
    `--user-data-dir=${browserProfile}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-webgpu",
    ...(process.platform === "win32"
      ? ["--use-angle=d3d11", "--use-webgpu-adapter=d3d12", "--force-high-performance-gpu"]
      : ["--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=swiftshader", "--disable-vulkan-surface"]),
    "--disable-background-networking",
    String(server.url),
  ],
  { stdout: "ignore", stderr: "pipe", timeout: 45000 },
);
const diagnostics = new Response(child.stderr).text();
try {
  const result = await Promise.race([report, child.exited.then(code => ({ error: `Browser exited: ${code}` }))]);
  if (result.error) throw new Error(result.error);
  const resultStatus = (result as Report).status;
  if (
    !resultStatus ||
    resultStatus[0]! < 3 ||
    resultStatus[1]! === 0 ||
    ![0x80004000, 0x80004004].includes(resultStatus[2]!) ||
    !(result as Report).width ||
    !(result as Report).height
  ) {
    throw new Error(`Wii execution/presentation failed: ${JSON.stringify(result)}`);
  }
  console.log(
    JSON.stringify({
      backend: process.platform === "win32" ? "Chromium D3D12 WebGPU" : "Chromium SwiftShader WebGPU",
      ...result,
    }),
  );
} finally {
  await stopTestBrowser(child, browserProfile);
  server.stop(true);
  if (process.env.IECODE_BROWSER_VERBOSE) console.error(await diagnostics);
  else await diagnostics;
}
