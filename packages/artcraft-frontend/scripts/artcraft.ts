#!/usr/bin/env bun
import { cp, mkdir } from "node:fs/promises";
import { watch as watchFiles } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BunPlugin } from "bun";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import tailwindConfig from "../../../apps/artcraft-web-app/tailwind.config";
import { m3Plugin } from "@aphrody/m3/plugin";
import { APHRODY_M3_SEED } from "@aphrody/identity/theme";
import { assertRuntime, loadConfig } from "@aphrody/bun-workspace";

export const frontendDir = resolve(import.meta.dir, "..");
export const appDir = resolve(frontendDir, "../../apps/artcraft-web-app");
export const appRoot = join(appDir, "app");
export const defaultOutdir = join(appDir, "dist");
const runtimeConfig = await loadConfig(resolve(appDir, "../.."));
const sourceEntry = join(appRoot, "src/index.tsx");
const publicDir = join(appRoot, "public");
const tsconfig = join(appDir, "tsconfig.json");
const singletons = ["react", "react-dom", "@preact/signals-core", "@preact/signals-react"];
const markdownGlob =
  /import\.meta\.glob\(\s*"([^"]+)"\s*,\s*\{\s*query:\s*"\?raw"\s*,\s*import:\s*"default"\s*,\s*eager:\s*true\s*,?\s*\}\s*\)/g;

export interface BuildOptions {
  outdir?: string;
  /** Absolute browser mount, including the trailing slash. */
  basePath?: string;
  development?: boolean;
  plugins?: BunPlugin[];
}

export async function buildFrontend(options: BuildOptions = {}) {
  requireRuntime();
  const outdir = resolve(options.outdir ?? defaultOutdir);
  requireOutputDirectory(outdir);
  const development = options.development ?? false;
  const basePath = options.basePath ?? "/";
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(basePath)) throw new Error("Invalid browser base path.");
  const environment = {
    DEV: development,
    PROD: !development,
    MODE: development ? "development" : "production",
    BASE_URL: basePath,
    VITE_ENVIRONMENT_TYPE: Bun.env.VITE_ENVIRONMENT_TYPE ?? "production",
    VITE_POSTHOG_API_KEY: Bun.env.VITE_POSTHOG_API_KEY,
  };
  const define = {
    "import.meta.env": JSON.stringify(environment),
    "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production"),
  };
  const inlineWorkers = new Map<string, string>();
  for await (const worker of new Bun.Glob("storyteller-*/**/*.worker.ts").scan({
    cwd: resolve(frontendDir, ".."),
    absolute: true,
  })) {
    const result = await Bun.build({
      entrypoints: [worker],
      target: "browser",
      format: "esm",
      tsconfig,
      minify: !development,
      define,
    });
    if (!result.success) throw new AggregateError(result.logs, "Worker build failed.");
    inlineWorkers.set(resolve(worker), await result.outputs[0].text());
  }
  const result = await Bun.build({
    entrypoints: [sourceEntry],
    outdir,
    root: appRoot,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !development,
    sourcemap: development ? "linked" : "none",
    tsconfig,
    define,
    conditions: [development ? "development" : "production"],
    naming: {
      entry: "assets/[name]-[hash].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    publicPath: basePath,
    metafile: true,
    plugins: [
      m3Plugin({
        theme: { seed: APHRODY_M3_SEED },
        tailwind: false,
        sass: false,
        urlImports: false,
      }),
      frontendPlugin(outdir, inlineWorkers, basePath),
      ...(options.plugins ?? []),
    ],
  });
  if (!result.success) throw new AggregateError(result.logs, "Frontend build failed.");
  const entry = result.outputs.find(output => output.kind === "entry-point" && extname(output.path) === ".js");
  if (!entry) throw new Error("Bun did not emit the frontend entry point.");
  const css = result.outputs.filter(output => extname(output.path) === ".css");
  const script = `<script type="module" src="${basePath}${relative(outdir, entry.path).replaceAll(sep, "/")}"></script>`;
  const links = css
    .map(output => `<link rel="stylesheet" href="${basePath}${relative(outdir, output.path).replaceAll(sep, "/")}" />`)
    .join("\n");
  const html = (await Bun.file(join(appRoot, "index.html")).text())
    .replace('<script type="module" src="/src/index.tsx"></script>', script)
    .replace('<base href="/"', `<base href="${basePath}"`)
    .replaceAll('href="/artcraft-icon.svg"', `href="${basePath}artcraft-icon.svg"`)
    .replaceAll('href="/favicon.ico"', `href="${basePath}favicon.ico"`)
    .replace("</head>", `${links}\n</head>`);
  await mkdir(outdir, { recursive: true });
  await cp(publicDir, outdir, { recursive: true });
  await Bun.write(join(outdir, "index.html"), html);
  await Bun.write(join(outdir, "bun-metafile.json"), JSON.stringify(result.metafile, null, 2));
  console.log(`[bun] Bun ${Bun.version}: ${result.outputs.length} artifacts → ${outdir}`);
  return result;
}

export function serveFrontend(options: { outdir?: string; port?: number; development?: boolean } = {}) {
  requireRuntime();
  const outdir = resolve(options.outdir ?? defaultOutdir);
  const development = options.development ?? false;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 5173,
    fetch: async (request, server) => {
      const url = new URL(request.url);
      if (development && url.pathname === "/__artcraft_reload") {
        return server.upgrade(request) ? undefined : new Response("WebSocket required", { status: 400 });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad path", { status: 400 });
      }
      const path = resolve(outdir, `.${pathname}`);
      const within = relative(outdir, path);
      if (within.startsWith(`..${sep}`) || within === ".." || isAbsolute(within)) {
        return new Response("Forbidden", { status: 403 });
      }
      let file = Bun.file(path);
      if (pathname === "/" || !(await file.exists())) {
        if (pathname !== "/" && !request.headers.get("accept")?.includes("text/html")) {
          return new Response("Not found", { status: 404 });
        }
        file = Bun.file(join(outdir, "index.html"));
      }
      const headers = { "Cache-Control": "no-store" };
      if (development && file.name?.endsWith("index.html")) {
        const reload =
          '<script>const socket=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}/__artcraft_reload`);socket.onmessage=()=>location.reload();</script>';
        return new Response((await file.text()).replace("</body>", `${reload}</body>`), {
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response(request.method === "HEAD" ? null : file, {
        headers: { ...headers, "Content-Type": file.type },
      });
    },
    websocket: {
      open(socket) {
        socket.subscribe("reload");
      },
      message() {},
    },
  });
  console.log(`[bun] ${server.url}`);
  return server;
}

function frontendPlugin(outdir: string, inlineWorkers: Map<string, string>, basePath: string): BunPlugin {
  return {
    name: "aphrody-frontend",
    setup(build) {
      build.onResolve({ filter: /opencut_wasm_bg\.wasm$/ }, args => ({
        path: resolve(dirname(args.importer), args.path),
        namespace: "artcraft-wasm",
      }));
      build.onLoad({ filter: /.*/, namespace: "artcraft-wasm" }, async args => {
        const bytes = await Bun.file(args.path).bytes();
        const module = new WebAssembly.Module(bytes);
        const imports = [...new Set(WebAssembly.Module.imports(module).map(item => item.module))];
        const name = `assets/${Bun.hash(bytes).toString(16)}.wasm`;
        await Bun.write(join(outdir, name), bytes);
        const glue = imports
          .map(
            (specifier, index) =>
              `import * as imported${index} from ${JSON.stringify(resolve(dirname(args.path), specifier))};`,
          )
          .join("\n");
        const object = imports.map((specifier, index) => `${JSON.stringify(specifier)}: imported${index}`).join(",");
        const exports = WebAssembly.Module.exports(module)
          .map(
            (item, index) =>
              `const exported${index}=instance.exports[${JSON.stringify(item.name)}]; export { exported${index} as ${item.name} };`,
          )
          .join("\n");
        return {
          loader: "js",
          contents: `${glue}\nconst response=await fetch(${JSON.stringify(`${basePath}${name}`)}); if(!response.ok) throw new Error("Failed to load OpenCut WASM"); const {instance}=await WebAssembly.instantiate(await response.arrayBuffer(),{${object}});\n${exports}`,
        };
      });
      build.onResolve({ filter: /\?worker&inline$/ }, args => ({
        path: Bun.resolveSync(args.path.replace(/\?worker&inline$/, ""), dirname(args.importer)),
        namespace: "artcraft-worker",
      }));
      build.onLoad({ filter: /.*/, namespace: "artcraft-worker" }, args => {
        const source = inlineWorkers.get(resolve(args.path));
        if (source === undefined) throw new Error(`Unknown inline worker: ${args.path}`);
        return {
          loader: "js",
          contents: `export default class extends Worker { constructor(options = {}) { const url = URL.createObjectURL(new Blob([${JSON.stringify(source)}], {type:"text/javascript"})); try { super(url, {...options, type:"module"}); } finally { URL.revokeObjectURL(url); } } }`,
        };
      });
      build.onResolve({ filter: /\?raw$/ }, args => ({
        path: resolve(dirname(args.importer), args.path.slice(0, -4)),
        namespace: "artcraft-raw",
      }));
      build.onLoad({ filter: /.*/, namespace: "artcraft-raw" }, async args => ({
        loader: "js",
        contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
      }));
      build.onResolve({ filter: /\?url$/ }, args => ({
        path: resolve(dirname(args.importer), args.path.slice(0, -4)),
        namespace: "artcraft-url",
      }));
      build.onLoad({ filter: /.*/, namespace: "artcraft-url" }, async args => {
        const file = Bun.file(args.path);
        const contents = extname(args.path) === ".css" ? await compileCss(args.path) : await file.bytes();
        const name = `assets/${Bun.hash(contents).toString(16)}${extname(args.path)}`;
        await Bun.write(join(outdir, name), contents);
        return {
          loader: "js",
          contents: `export default ${JSON.stringify(`${basePath}${name}`)}`,
        };
      });
      build.onResolve(
        {
          filter: /^(react(?:-dom)?|@preact\/signals-(?:core|react))(?:\/.*)?$/,
        },
        args => {
          if (!singletons.some(name => args.path === name || args.path.startsWith(`${name}/`))) return;
          return { path: Bun.resolveSync(args.path, frontendDir) };
        },
      );
      build.onLoad({ filter: /\.css$/ }, async args => ({
        loader: "css",
        contents: await compileCss(args.path),
      }));
      build.onLoad(
        {
          filter: /markdown-content[/\\]src[/\\]lib[/\\]data[/\\]content\.ts$/,
        },
        async args => {
          let code = await Bun.file(args.path).text();
          for (const match of code.matchAll(markdownGlob)) {
            const files: Record<string, string> = {};
            const paths: string[] = [];
            for await (const file of new Bun.Glob(match[1]).scan({
              cwd: dirname(args.path),
              onlyFiles: true,
            }))
              paths.push(file);
            for (const file of paths.sort()) {
              files[file.replaceAll(sep, "/")] = await Bun.file(resolve(dirname(args.path), file)).text();
            }
            code = code.replace(match[0], JSON.stringify(files));
          }
          if (code.includes("import.meta.glob")) throw new Error("Unsupported Markdown glob shape.");
          return { loader: "ts", contents: code };
        },
      );
      build.onLoad({ filter: /spark[/\\]dist[/\\]spark\.module\.js$/ }, async args => ({
        loader: "js",
        contents: (await Bun.file(args.path).text()).replace(
          /module_or_path = new URL\("(data:application\/wasm;base64,[^"]+)", import\.meta\.url\);/,
          'module_or_path = "$1";',
        ),
      }));
    },
  };
}

async function compileCss(path: string) {
  const source = await Bun.file(path).text();
  if (resolve(path) !== resolve(join(appRoot, "src/styles/tailwind.css"))) return source;

  const legacyDirectives = /^\s*@tailwind\s+base;\s*@tailwind\s+components;\s*@tailwind\s+utilities;\s*/;
  if (!legacyDirectives.test(source)) throw new Error(`Expected Tailwind v3 entry directives in ${path}.`);

  const stylesheetDir = dirname(path);
  const configPath = join(appDir, "tailwind.config.ts");
  const sourcePaths = new Set(
    tailwindConfig.content.map(pattern => {
      const staticPath = pattern.replace(/[\\/][*?{].*$/, "");
      return relative(stylesheetDir, resolve(appDir, staticPath)).replaceAll(sep, "/");
    }),
  );
  const safelist = tailwindConfig.safelist;
  if (safelist?.some(item => typeof item !== "string")) {
    throw new Error("Tailwind v4 migration only supports string safelist entries.");
  }
  const configDirective = `@config ${JSON.stringify(relative(stylesheetDir, configPath).replaceAll(sep, "/"))};`;
  const sourceDirectives = [...sourcePaths].map(sourcePath => `@source ${JSON.stringify(sourcePath)};`).join("\n");
  const safelistDirectives = (safelist ?? []).map(item => `@source inline(${JSON.stringify(item)});`).join("\n");
  const migrated = source.replace(
    legacyDirectives,
    `@import "tailwindcss" source(none);\n${configDirective}\n${sourceDirectives}\n${safelistDirectives}\n`,
  );
  const result = await postcss([tailwindcss()]).process(migrated, {
    from: path,
    map: false,
  });
  return result.css;
}

function requireRuntime() {
  assertRuntime(runtimeConfig, true);
}

function requireOutputDirectory(outdir: string) {
  if (outdir === frontendDir || outdir === appDir || outdir === appRoot || outdir === publicDir) {
    throw new Error("The output directory must not replace a source directory.");
  }
}

export function watchDevelopment(server: ReturnType<typeof serveFrontend>) {
  const watchers: ReturnType<typeof watchFiles>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rebuilding = false;
  let queued = false;
  let stopping = false;
  async function rebuild() {
    if (stopping) return;
    if (rebuilding) {
      queued = true;
      return;
    }
    rebuilding = true;
    try {
      await buildFrontend({ development: true });
      if (!stopping) server.publish("reload", "reload");
    } catch (error) {
      console.error(error);
    } finally {
      rebuilding = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  }
  for (const directory of [appDir, resolve(frontendDir, "..")]) {
    watchers.push(
      watchFiles(directory, { recursive: true }, (_event, file) => {
        if (file && /(?:^|[/\\])(node_modules|dist|\.git)(?:[/\\]|$)/.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => void rebuild(), 150);
      }),
    );
  }
  watchers.push(
    watchFiles(join(frontendDir, "tsconfig.base.json"), () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 150);
    }),
  );
  return () => {
    stopping = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}

async function main() {
  const [command = "dev", ...args] = Bun.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const port = Number(portIndex < 0 ? (Bun.env.ARTCRAFT_DEV_PORT ?? "5173") : args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
  if (command === "build") {
    await buildFrontend();
    return;
  }
  if (command !== "dev" && command !== "preview")
    throw new Error("Usage: bun scripts/artcraft.ts build|dev|preview [--port N]");
  const development = command === "dev";
  if (development) await buildFrontend({ development });
  if (!(await Bun.file(join(defaultOutdir, "index.html")).exists())) throw new Error("Run bun run build first.");
  const server = serveFrontend({ port, development });
  const closeWatchers = development ? watchDevelopment(server) : undefined;
  const stop = () => {
    closeWatchers?.();
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) await main();
