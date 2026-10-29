// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadApp } from "../src/config.ts";
import { generateTargets, getTarget, TARGETS, contextFor, type TargetContext } from "../src/targets/index.ts";
import { RUNTIME_IMAGE } from "../src/targets/docker.ts";
import { httpVhostModel, nginxRenderer, renderNginx, vhostModel, type NginxModel } from "../src/targets/nginx.ts";
import { sharedDropin } from "../src/targets/systemd.ts";
import { cleanup, FIXTURE, freePort, tmp } from "./helpers.ts";

afterAll(cleanup);

let ctx: TargetContext;
let out = "";
const read = (id: string, file: string) => readFileSync(join(out, id, file), "utf8");
const json = (id: string, file: string) => JSON.parse(read(id, file)) as Record<string, any>;

beforeAll(async () => {
  out = tmp("m3-bun-targets-");
  ctx = contextFor(await loadApp(FIXTURE));
  await generateTargets(["all"], ctx, out);
}, 120_000);

describe("the context", () => {
  test("is derived from the app and its deploy section", () => {
    expect(ctx).toMatchObject({
      name: "hello-m3",
      version: "1.2.3",
      port: 3456,
      domain: "hello.example.com",
      image: "ghcr.io/aphrody-labs/hello-m3",
      namespace: "aphrody",
      user: "ubuntu",
      region: "cdg",
      binary: "hello-m3",
      outdir: "dist",
      api: "src/api.ts",
      bunVersion: Bun.version,
      tls: "letsencrypt",
    });
  });
});

describe("registry", () => {
  test("sixteen targets with unique ids, each with a description; an unknown id lists the known ones", () => {
    expect(TARGETS.map(t => t.id)).toEqual([
      "docker",
      "systemd",
      "nginx",
      "vercel",
      "fly",
      "cloudflare",
      "coolify",
      "vscode",
      "windows",
      "tauri",
      "webos",
      "lambda",
      "os-themes",
      "release",
      "next",
    ]);
    for (const t of TARGETS) expect(t.description.length).toBeGreaterThan(20);
    expect(() => getTarget("heroku")).toThrow(/unknown deploy target heroku \(docker, systemd/);
  });

  test("generation writes only below <out>/<id>/ and every target produced files", async () => {
    for (const t of TARGETS) expect(existsSync(join(out, t.id))).toBe(true);
    const only = tmp();
    const generated = await generateTargets(["fly"], ctx, only);
    expect(generated.map(g => g.id)).toEqual(["fly"]);
    expect(existsSync(join(only, "docker"))).toBe(false);
  });

  test("a generated path that escapes its directory is refused", async () => {
    const { writeFiles } = await import("../src/util.ts");
    await expect(writeFiles(tmp(), [{ path: "../escape.txt", content: "x" }])).rejects.toThrow(/escapes its directory/);
  });
});

describe("docker", () => {
  test("multi-stage Dockerfile: compile and run on the Aphrody Alpine runtime image, healthcheck without a shell", () => {
    const file = read("docker", "Dockerfile");
    expect(RUNTIME_IMAGE).toBe("ghcr.io/aphrody-labs/alpine:3.24-runtime");
    expect(file.match(/^FROM .*$/gm)).toEqual([`FROM ${RUNTIME_IMAGE} AS build`, `FROM ${RUNTIME_IMAGE}`]);
    expect(file).toContain("COPY --chown=agent:agent . .");
    expect(file).toContain("compile --outfile /home/agent/out/hello-m3");
    expect(file).toContain("COPY --from=build /home/agent/out/hello-m3 /app/server");
    expect(file).toContain(
      'HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD ["/app/server", "--healthcheck"]',
    );
    expect(file).toContain('ENTRYPOINT ["/app/server"]');
    expect(file).not.toContain("USER root");
  });
  test("Dockerfile.scratch consumes the rootfs of `m3-bun package --rootfs`; compose is read-only with dropped capabilities", () => {
    expect(read("docker", "Dockerfile.scratch")).toContain("COPY rootfs/ /");
    const compose = Bun.YAML.parse(read("docker", "docker-compose.yml")) as {
      services: Record<string, any>;
    };
    const service = compose.services["hello-m3"];
    expect(service.read_only).toBe(true);
    expect(service.cap_drop).toEqual(["ALL"]);
    expect(service.ports).toEqual(["127.0.0.1:3456:3456"]);
    expect(service.healthcheck.test).toEqual(["CMD", "/app/server", "--healthcheck"]);
    expect(read("docker", ".dockerignore")).toContain("node_modules");
  });
});

describe("systemd", () => {
  test("the unit has the shape of the yolo host units", () => {
    const unit = read("systemd", "hello-m3.service");
    expect(unit).toContain("[Unit]");
    for (const line of [
      "Type=simple",
      "User=ubuntu",
      "Group=ubuntu",
      "WorkingDirectory=/home/ubuntu/apps/aphrody/current",
      "Environment=PORT=3456",
      "EnvironmentFile=-/etc/aphrody/hello-m3.env",
      "ExecStart=/home/ubuntu/apps/aphrody/current/bin/hello-m3",
      "Restart=on-failure",
      "RestartSec=2",
      "WantedBy=multi-user.target",
    ])
      expect(unit).toContain(line);
  });
  test("the sandbox is the shared drop-ins, byte for byte from the yolo checkout when it is there", () => {
    const names = [
      "sandbox-base.conf",
      "sandbox-home-ro.conf",
      "sandbox-kernel.conf",
      "net-inet-only.conf",
      "syscall-service.conf",
    ];
    names.forEach((name, i) => {
      expect(read("systemd", `hello-m3.service.d/${String(10 + i * 10).padStart(2, "0")}-${name}`)).toBe(
        sharedDropin(ctx.yoloRoot, name),
      );
    });
    expect(sharedDropin("/nonexistent", "sandbox-base.conf")).toContain("ProtectSystem=strict");
    if (existsSync(join(ctx.yoloRoot, "infra/config/host/systemd/shared/sandbox-base.conf"))) {
      expect(sharedDropin(ctx.yoloRoot, "sandbox-base.conf")).toBe(
        readFileSync(join(ctx.yoloRoot, "infra/config/host/systemd/shared/sandbox-base.conf"), "utf8"),
      );
    }
  });
  test("the catalog entry follows service-catalog.json and the env file holds no secrets", () => {
    expect(json("systemd", "service-catalog.entry.json")).toEqual({
      id: "hello-m3",
      application: "aphrody",
      kind: "bun-http",
      runtime: "bun",
      unit: "hello-m3.service",
      health: "http://127.0.0.1:3456/healthz",
      port: 3456,
      sourceRepo: "aphrody",
      workingDirectory: "/home/ubuntu/apps/aphrody/current",
      environmentFile: "/etc/aphrody/hello-m3.env",
      publicProxy: "nginx",
      public: true,
    });
    expect(read("systemd", "hello-m3.env.example")).toContain("PORT=3456");
  });
  test.skipIf(!Bun.which("systemd-analyze"))("systemd-analyze verify accepts the unit merged with its drop-ins", () => {
    const root = tmp("m3-bun-systemd-");
    const bin = join(root, "current/bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "hello-m3"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    // The drop-ins are plain `[Service]` sections: appended in order, they are what systemd merges.
    const dropins = readdirSync(join(out, "systemd", "hello-m3.service.d"))
      .toSorted()
      .map(f => readFileSync(join(out, "systemd", "hello-m3.service.d", f), "utf8"));
    const merged = `${read("systemd", "hello-m3.service")
      .replaceAll("/home/ubuntu/apps/aphrody/current", join(root, "current"))
      .replace("[Install]", `${dropins.join("\n")}\n[Install]`)}`;
    const file = join(root, "hello-m3.service");
    writeFileSync(file, merged);
    const proc = Bun.spawnSync(["systemd-analyze", "verify", file], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = `${proc.stdout.toString()}${proc.stderr.toString()}`;
    // The machine running the test may lack the `ubuntu` account, the env file or the targets; no other finding is tolerated.
    const findings = text
      .split("\n")
      .filter(l => l.trim() && !/Failed to resolve (user|group)|User .* not found|Group .* not found|ubuntu/i.test(l));
    expect(findings).toEqual([]);
  });
});

describe("nginx", () => {
  const renderer = nginxRenderer();
  test("renderer reads real Bun process streams and propagates diagnostics on failure", async () => {
    const script = join(out, "stream-renderer.ts");
    await Bun.write(
      script,
      'const model = await Bun.stdin.json(); console.error("renderer diagnostic"); console.log(JSON.stringify({ model, args: process.argv.slice(2) }));',
    );
    const model = vhostModel(ctx);
    expect(JSON.parse(await renderNginx([process.execPath, script], model, ["owner comment"]))).toEqual({
      model,
      args: ["--comment", "owner comment", "-"],
    });
    await Bun.write(script, 'console.error("renderer denied"); process.exit(23);');
    await expect(renderNginx([process.execPath, script], model, [])).rejects.toThrow("failed (23): renderer denied");
  });
  test("vhost model: upstream with keepalive, ACME and redirect on :80, TLS on :443, the yolo proxy snippet", () => {
    const model = json("nginx", "hello-m3.nginx.json") as NginxModel;
    expect(model).toEqual(vhostModel(ctx));
    expect(model.upstreams).toEqual([
      {
        name: "hello_m3",
        targets: [{ type: "Tcp", target: "127.0.0.1:3456" }],
        keepalive: 16,
      },
    ]);
    const [redirect, tls] = model.servers;
    expect(redirect!.listen_ports).toEqual(["80"]);
    expect(redirect!.locations!.map(l => l.path)).toEqual(["^~ /.well-known/acme-challenge/", "/"]);
    expect(redirect!.locations![1]!.custom_directives).toEqual(["return 301 https://hello.example.com$request_uri"]);
    expect(tls!.listen_ports).toEqual(["443 ssl"]);
    expect(tls!.server_names).toEqual(["hello.example.com"]);
    expect(tls!.ssl_certificate).toBe("/etc/letsencrypt/live/hello.example.com/fullchain.pem");
    expect(tls!.custom_directives).toContain("http2 on");
    expect(tls!.custom_directives).toContain('add_header Strict-Transport-Security "max-age=31536000" always');
    expect(tls!.locations![0]!.proxy_pass).toBe("http://hello_m3");
    expect(tls!.locations![0]!.custom_directives).toContain("include snippets/proxy-client-ip.inc");
    expect(json("nginx", "hello-m3.http.nginx.json")).toEqual(httpVhostModel(ctx));
  });
  test("the listen-http2 form is available for nginx older than 1.25.1", () => {
    const tls = vhostModel({ ...ctx, http2: "listen" }).servers[1]!;
    expect(tls.listen_ports).toEqual(["443 ssl http2"]);
    expect(tls.custom_directives).not.toContain("http2 on");
  });
  test("the vhosts are rendered by aphrody infra nginx, or say how to render them", () => {
    if (renderer) {
      const conf = read("nginx", "hello-m3.conf");
      expect(conf).toContain("upstream hello_m3 {\n    server 127.0.0.1:3456;\n    keepalive 16;\n}");
      expect(conf).toContain("listen 443 ssl;\n    server_name hello.example.com;");
      expect(conf).toContain("    http2 on;\n");
      expect(conf).toContain("return 301 https://hello.example.com$request_uri;");
      expect(conf).toContain('proxy_set_header Connection "";');
      expect(conf).toContain("include snippets/proxy-client-ip.inc;");
    } else {
      expect(read("nginx", "hello-m3.conf.todo")).toContain(
        "aphrody infra nginx render hello-m3.nginx.json > hello-m3.conf",
      );
    }
  });
  test("the routes.json entry matches the catalog shape", () => {
    expect(json("nginx", "routes.entry.json")).toEqual({
      host: "hello.example.com",
      service: "hello-m3",
      upstream: "127.0.0.1:3456",
      probePath: "/healthz",
      vhost: "nginx/aphrody/hello-m3.conf",
    });
  });
  test.skipIf(!Bun.which("nginx") || !nginxRenderer())(
    "nginx -t accepts the TLS vhost (self-signed test certificate) and the HTTP variant",
    async () => {
      const dir = tmp("m3-bun-nginx-");
      mkdirSync(join(dir, "snippets"), { recursive: true });
      const snippet = join(ctx.yoloRoot, "infra/config/host/nginx/snippets/proxy-client-ip.inc");
      writeFileSync(
        join(dir, "snippets/proxy-client-ip.inc"),
        existsSync(snippet)
          ? readFileSync(snippet, "utf8")
          : "proxy_set_header X-Real-IP $remote_addr;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n",
      );
      let tls: TargetContext["tls"] = "letsencrypt";
      if (Bun.which("openssl")) {
        const cert = join(dir, "c.pem");
        const key = join(dir, "k.pem");
        const made = Bun.spawnSync(
          [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            key,
            "-out",
            cert,
            "-subj",
            "/CN=hello.example.com",
            "-days",
            "1",
          ],
          { windowsHide: true, stdout: "pipe", stderr: "pipe" },
        );
        expect(made.exitCode).toBe(0);
        tls = { cert, key };
      }
      const target = join(tmp(), "nginx");
      // `http2 on;` needs nginx 1.25.1; older servers take the `listen ... http2` form.
      const version = /nginx\/(\d+)\.(\d+)\.(\d+)/.exec(
        Bun.spawnSync(["nginx", "-v"], {
          windowsHide: true,
          stderr: "pipe",
        }).stderr.toString(),
      );
      const modern = version ? [Number(version[1]), Number(version[2]), Number(version[3])] : [0, 0, 0];
      const supportsDirective =
        modern[0]! > 1 || (modern[0] === 1 && (modern[1]! > 25 || (modern[1] === 25 && modern[2]! >= 1)));
      await generateTargets(["nginx"], { ...ctx, tls, http2: supportsDirective ? "directive" : "listen" }, target);
      const files = tls === "letsencrypt" ? ["hello-m3.http.conf"] : ["hello-m3.conf", "hello-m3.http.conf"];
      for (const file of files) {
        // An unprivileged test cannot bind :80 and :443: move the listeners, keep every other line as generated.
        const generatedPath = join(target, "nginx", file);
        writeFileSync(
          generatedPath,
          readFileSync(generatedPath, "utf8")
            .replace("listen 80;", `listen 127.0.0.1:${freePort()};`)
            .replace("listen 443 ssl", `listen 127.0.0.1:${freePort()} ssl`),
        );
        const main = join(dir, `${file}.main.conf`);
        writeFileSync(
          main,
          `pid ${dir}/nginx.pid;\nerror_log ${dir}/error.log;\nevents {}\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/body;\n  proxy_temp_path ${dir}/proxy;\n  fastcgi_temp_path ${dir}/fcgi;\n  uwsgi_temp_path ${dir}/uwsgi;\n  scgi_temp_path ${dir}/scgi;\n  include ${join(target, "nginx", file)};\n}\n`,
        );
        const proc = Bun.spawnSync(["nginx", "-t", "-p", dir, "-c", main], {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
        });
        const text = `${proc.stdout.toString()}${proc.stderr.toString()}`;
        expect({
          file,
          ok: proc.exitCode === 0,
          text: proc.exitCode === 0 ? "" : text,
        }).toEqual({
          file,
          ok: true,
          text: "",
        });
      }
    },
  );
});

describe("vercel", () => {
  test("vercel.json: Bun runtime, static output, API rewrite, SPA rewrite that spares assets and API, headers", () => {
    const v = json("vercel", "vercel.json");
    expect(v.bunVersion).toBe("1.x");
    expect(v.outputDirectory).toBe("dist");
    expect(v.buildCommand).toBe("bunx --bun m3-bun build");
    expect(v.rewrites[0]).toEqual({ source: "/api/(.*)", destination: "/api" });
    expect(v.rewrites.at(-1)).toEqual({
      source: "/((?!assets/|chunk-|api/).*)",
      destination: "/index.html",
    });
    const spa = new RegExp(`^${v.rewrites.at(-1).source}$`);
    expect(spa.test("/some/route")).toBe(true);
    expect(spa.test("/chunk-abc.js")).toBe(false);
    expect(spa.test("/api/x")).toBe(false);
    expect(v.headers.flatMap((h: any) => h.headers.map((x: any) => x.key))).toContain("X-Content-Type-Options");
  });
  test("api/index.ts adapts the app's routes to one fetch handler", () => {
    const fn = read("vercel", "api/index.ts");
    expect(fn).toContain('import { normalizeApi, routesToFetch } from "@aphrody/m3-bun/api";');
    expect(fn).toContain('import api from "../src/api.ts";');
    expect(fn).toContain("export default {");
  });
});

describe("fly", () => {
  test("fly.toml parses and carries the app, region, service, check and VM", () => {
    const fly = Bun.TOML.parse(read("fly", "fly.toml")) as Record<string, any>;
    expect(fly.app).toBe("hello-m3");
    expect(fly.primary_region).toBe("cdg");
    expect(fly.build.dockerfile).toBe("Dockerfile");
    expect(fly.env).toEqual({ PORT: "3456", HOST: "0.0.0.0" });
    expect(fly.http_service).toMatchObject({
      internal_port: 3456,
      force_https: true,
      auto_stop_machines: "stop",
      auto_start_machines: true,
      min_machines_running: 0,
    });
    expect(fly.http_service.checks[0]).toMatchObject({
      method: "GET",
      path: "/healthz",
    });
    expect(fly.vm[0]).toEqual({ size: "shared-cpu-1x", memory: "256mb" });
  });
});

const stripCommentLines = (text: string) => text.replace(/^\s*\/\/.*$/gm, "");

describe("cloudflare", () => {
  test("wrangler.jsonc: worker, static assets with SPA fallback, worker-first API routes, custom domain", () => {
    const w = JSON.parse(stripCommentLines(read("cloudflare", "wrangler.jsonc"))) as Record<string, any>;
    expect(w).toMatchObject({
      name: "hello-m3",
      main: "src/worker.ts",
      assets: {
        directory: "./dist",
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*", "/healthz"],
      },
      routes: [{ pattern: "hello.example.com", custom_domain: true }],
    });
    expect(w.compatibility_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  test("worker and pages function reuse the app's routes; pages has _headers and _redirects", () => {
    expect(read("cloudflare", "src/worker.ts")).toContain("routesToFetch(normalizeApi(api).routes)");
    expect(read("cloudflare", "src/worker.ts")).toContain("env.ASSETS.fetch(request)");
    expect(read("cloudflare", "pages/functions/[[path]].ts")).toContain("export const onRequest");
    expect(read("cloudflare", "pages/_redirects")).toContain("/* /index.html 200");
    expect(read("cloudflare", "pages/_headers")).toContain("Cache-Control: public, max-age=31536000, immutable");
  });
});

describe("coolify", () => {
  test("compose service with the SERVICE_FQDN routing variable and the executable's health check", () => {
    const compose = Bun.YAML.parse(read("coolify", "docker-compose.yaml")) as {
      services: Record<string, any>;
    };
    const service = compose.services["hello-m3"];
    expect(service.environment).toContain("SERVICE_FQDN_HELLO_M3_3456=https://hello.example.com");
    expect(service.environment).toContain("PORT=3456");
    expect(service.healthcheck.test).toEqual(["CMD", "/app/server", "--healthcheck"]);
    expect(service.build).toEqual({ context: ".", dockerfile: "Dockerfile" });
  });
});

describe("vscode", () => {
  test("tasks, launch configurations and extension recommendations are valid JSON with the m3-bun commands", () => {
    const tasks = json("vscode", ".vscode/tasks.json");
    const labels = tasks.tasks.map((t: any) => t.label);
    for (const label of [
      "m3-bun: dev",
      "m3-bun: build",
      "m3-bun: compile",
      "m3-bun: serve",
      "m3-bun: deploy (generate all targets)",
      "m3-bun: package",
      "m3-bun: smoke (compiled executable)",
      "m3-bun: test",
    ])
      expect(labels).toContain(label);
    expect(tasks.tasks.find((t: any) => t.label === "m3-bun: build").group).toEqual({
      kind: "build",
      isDefault: true,
    });
    expect(tasks.tasks.find((t: any) => t.label === "m3-bun: dev").isBackground).toBe(true);
    const launch = json("vscode", ".vscode/launch.json");
    expect(launch.configurations.map((c: any) => c.type)).toEqual(["bun", "bun", "bun", "bun"]);
    expect(json("vscode", ".vscode/extensions.json").recommendations).toEqual(["oven.bun-vscode", "oxc.oxc-vscode"]);
  });

  // The Bun extension of the fork declares what its debugger, tasks and settings accept.
  const extension = join(process.env.APHRODY_BUN_CHECKOUT ?? "C:/bun", "packages/bun-vscode/package.json");
  test.skipIf(!existsSync(extension))(
    "launch.json and settings.json use only what the Bun extension declares",
    async () => {
      const { contributes } = (await Bun.file(extension).json()) as {
        contributes: any;
      };
      const debuggerSchema = contributes.debuggers.find((d: any) => d.type === "bun").configurationAttributes;
      for (const config of json("vscode", ".vscode/launch.json").configurations) {
        const known = Object.keys(debuggerSchema[config.request].properties);
        const own = Object.keys(config).filter(key => !["type", "request", "name"].includes(key));
        expect({
          name: config.name,
          unknown: own.filter(key => !known.includes(key)),
        }).toEqual({
          name: config.name,
          unknown: [],
        });
      }
      const properties = contributes.configuration.properties as Record<string, { type: string }>;
      const settings = json("vscode", ".vscode/settings.json");
      const bunSettings = Object.entries(settings).filter(([key]) => key.startsWith("bun."));
      expect(bunSettings.length).toBeGreaterThan(5);
      for (const [key, value] of bunSettings)
        expect({ key, type: properties[key]?.type }).toEqual({
          key,
          type: typeof value,
        });
    },
  );
});

describe("windows", () => {
  test("scripts target the .exe, use WinSW or a scheduled task, and never claim sc.exe can run a Bun executable", () => {
    expect(read("windows", "build-windows.ps1")).toContain("build-windows.ts");
    const build = read("windows", "build-windows.ts");
    expect(build).toContain('compileApp({ app, target: "windows-x64"');
    expect(build).toContain("windowsIcon(");
    expect(read("windows", "icon.svg")).toStartWith("<svg ");
    const app = read("windows", "install-app.ps1");
    expect(app).toContain("WScript.Shell");
    expect(app).toContain(
      "Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\hello-m3",
    );
    expect(app).toContain("DisplayVersion = '1.2.3'");
    expect(read("windows", "uninstall-app.ps1")).toContain("Remove-Item $key -Recurse");
    expect(read("windows", "windows-check.ts")).toContain("inspectWindows(");
    const install = read("windows", "install-service.ps1");
    expect(install).toContain("WinSW-x64.exe");
    expect(install).toContain("Register-ScheduledTask");
    expect(install).toContain("$OpenFirewall");
    expect(install).not.toContain("sc.exe create");
    expect(read("windows", "uninstall-service.ps1")).toContain("Unregister-ScheduledTask");
    const xml = read("windows", "hello-m3-service.xml");
    expect(xml).toContain("<id>hello-m3</id>");
    expect(xml).toContain('<env name="PORT" value="__PORT__" />');
    const open = xml.match(/<[a-z]+[ >]/g)!.length;
    expect(open).toBeGreaterThan(8);
  });
  test.skipIf(!Bun.which("pwsh"))(
    "PowerShell parses every script without syntax errors",
    () => {
      const files = [
        "build-windows.ps1",
        "install-app.ps1",
        "uninstall-app.ps1",
        "install-service.ps1",
        "uninstall-service.ps1",
      ].map(file => join(out, "windows", file));
      const script = `foreach ($f in @(${files.map(file => `'${file}'`).join(", ")})) { $e = $null; $t = $null; [System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e) | Out-Null; foreach ($x in $e) { "$(Split-Path $f -Leaf): $($x.Message)" } }`;
      const proc = Bun.spawnSync(["pwsh", "-NoProfile", "-NonInteractive", "-Command", script], {
        windowsHide: true,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect({
        out: proc.stdout.toString().trim(),
        code: proc.exitCode,
      }).toEqual({
        out: "",
        code: 0,
      });
    },
    30_000,
  );
});

