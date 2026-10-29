// SPDX-License-Identifier: Apache-2.0
// Cloud and release targets: lambda (the bun-lambda runtime of upstream Bun), release (GitHub workflow on
// oven-sh/setup-bun), next (@aphrody/m3-next inside @aphrody/next-bun).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadApp } from "../src/config.ts";
import { contextFor, generateTargets, type TargetContext } from "../src/targets/index.ts";
import { RELEASE_MATRIX } from "../src/targets/release.ts";
import { COMPILE_TARGETS } from "../src/config.ts";
import { cleanup, fixtureCopy } from "./helpers.ts";

afterAll(cleanup);

let app = "";
let ctx: TargetContext;
let out = "";
const read = (id: string, file: string) => Bun.file(join(out, id, file)).text();

beforeAll(async () => {
  app = fixtureCopy();
  out = join(app, "deploy");
  ctx = contextFor(await loadApp(app));
  await generateTargets(["lambda", "release", "next"], ctx, out);
}, 120_000);

/** Bundle the generated handler for Bun, with `@aphrody/m3-bun/*` taken from this checkout. */
async function bundleHandler(outdir: string): Promise<string> {
  const src = resolve(import.meta.dir, "../src");
  const result = await Bun.build({
    entrypoints: [join(out, "lambda", "handler.ts")],
    outdir,
    target: "bun",
    naming: "handler.js",
    plugins: [
      {
        name: "m3-bun-self",
        setup(build) {
          build.onResolve({ filter: /^@aphrody\/m3-bun\/server$/ }, () => ({
            path: join(src, "server.ts"),
          }));
        },
      },
    ],
  });
  expect(result.logs).toEqual([]);
  mkdirSync(join(outdir, "dist"), { recursive: true });
  writeFileSync(join(outdir, "dist", "index.html"), "<!doctype html><title>hello-m3</title>");
  return join(outdir, "handler.js");
}

describe("lambda", () => {
  test("handler.ts is createM3App for _HANDLER=handler.fetch: UI, API and /healthz from one fetch", async () => {
    const handler = await read("lambda", "handler.ts");
    expect(handler).toContain('import api from "../../src/api.ts";');
    const bundled = await bundleHandler(join(out, "lambda", "out"));
    const { default: lambda } = (await import(bundled)) as {
      default: { fetch(r: Request): Promise<Response> };
    };
    const [health, hello, page] = await Promise.all([
      lambda.fetch(new Request("https://fn.lambda-url.eu-west-3.on.aws/healthz")),
      lambda.fetch(new Request("https://fn.lambda-url.eu-west-3.on.aws/api/hello/lambda")),
      lambda.fetch(
        new Request("https://fn.lambda-url.eu-west-3.on.aws/", {
          headers: { Accept: "text/html" },
        }),
      ),
    ]);
    expect([health.status, await hello.json(), await page.text()]).toEqual([
      200,
      { hello: "lambda" },
      "<!doctype html><title>hello-m3</title>",
    ]);
  });

  test("build script, layer script on bun-lambda build-layer and a SAM template for provided.al2023", async () => {
    const build = await read("lambda", "build-lambda.ts");
    expect(build).toContain('import { archiveDir } from "@aphrody/m3-bun";');
    expect(build).toContain('const app = join(here, "../..");');
    expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(build)).not.toThrow();
    const layer = await read("lambda", "build-layer.sh");
    expect(layer).toContain('/packages/bun-lambda/scripts/build-layer.ts" --arch aarch64 \\\n');
    expect(layer).toContain(`--release "bun-v${ctx.bunVersion}"`);
    const sam = Bun.YAML.parse(await read("lambda", "template.yaml")) as any;
    expect(sam.Resources.App.Properties).toMatchObject({
      Handler: "handler.fetch",
      Runtime: "provided.al2023",
      Architectures: ["arm64"],
      CodeUri: "function.zip",
    });
  });

  // The bun-lambda runtime of upstream Bun against a local Lambda Runtime API: one function URL event in, one response out.
  const runtime = join(process.env.APHRODY_BUN_CHECKOUT ?? "C:/bun", "packages/bun-lambda/runtime.ts");
  const runnable =
    existsSync(runtime) &&
    (() => {
      try {
        Bun.resolveSync("aws4fetch", dirname(runtime));
        return true;
      } catch {
        return false;
      }
    })();
  test.skipIf(!runnable)(
    "the bun-lambda runtime serves the bundled handler",
    async () => {
      const task = join(out, "lambda", "task");
      await bundleHandler(task);
      const { promise: answered, resolve: answer } = Promise.withResolvers<{
        statusCode: number;
        body: string;
      }>();
      let served = false;
      await using api = Bun.serve({
        port: 0,
        routes: {
          "/2018-06-01/runtime/invocation/next": () => {
            if (served) return new Promise<Response>(() => {});
            served = true;
            const event = {
              version: "2.0",
              requestContext: {
                requestId: "r1",
                domainName: "fn.example",
                http: { method: "GET", path: "/api/hello/aws" },
              },
              headers: { host: "fn.example" },
              isBase64Encoded: false,
            };
            return Response.json(event, {
              headers: {
                "Lambda-Runtime-Aws-Request-Id": "r1",
                "Lambda-Runtime-Trace-Id": "t1",
                "Lambda-Runtime-Invoked-Function-Arn": "arn:aws:lambda:eu-west-3:000000000000:function:hello-m3",
                "Lambda-Runtime-Deadline-Ms": String(Date.now() + 60_000),
              },
            });
          },
          "/2018-06-01/runtime/invocation/r1/response": {
            POST: async request => {
              answer(await request.json());
              return new Response(null, { status: 202 });
            },
          },
        },
      });
      await using proc = Bun.spawn({
        windowsHide: true,
        cmd: [process.execPath, runtime],
        cwd: task,
        env: {
          ...process.env,
          AWS_LAMBDA_RUNTIME_API: `127.0.0.1:${api.port}`,
          _HANDLER: "handler.fetch",
          LAMBDA_TASK_ROOT: task,
        },
        stdout: "inherit",
        stderr: "inherit",
      });
      const response = await Promise.race([
        answered,
        proc.exited.then(code => Promise.reject(new Error(`bun-lambda runtime exited with ${code}`))),
      ]);
      proc.kill();
      expect({
        status: response.statusCode,
        body: JSON.parse(response.body),
      }).toEqual({
        status: 200,
        body: { hello: "aws" },
      });
    },
    60_000,
  );
});

describe("release", () => {
  test("a tag builds every target with upstream Bun and attaches archives and checksums to the release", async () => {
    const workflow = Bun.YAML.parse(await read("release", ".github/workflows/release.yml")) as any;
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.permissions).toEqual({ contents: "write" });
    const include = workflow.jobs.package.strategy.matrix.include as {
      target: string;
    }[];
    expect(include.map(m => m.target)).toEqual(RELEASE_MATRIX.map(m => m.target));
    for (const { target } of include) expect(COMPILE_TARGETS as readonly string[]).toContain(target);
    const steps = workflow.jobs.package.steps.map((s: any) => s.run ?? s.uses).join("\n");
    expect(steps).toContain("oven-sh/setup-bun@v2");
    expect(steps).toContain("bunx --bun m3-bun package --target ${{ matrix.target }} --out release");
    const publish = workflow.jobs.publish.steps.map((s: any) => s.run ?? s.uses).join("\n");
    expect(publish).toContain('gh release create "$GITHUB_REF_NAME" release/*');
    expect(publish).toContain("grep -v '\\.sha256$'");
  });
});

describe("next", () => {
  test("next.config.ts is withBun(withM3(...)): standalone output, M3 packages transpiled, Turbopack root set", async () => {
    // Evaluated inside this package so @aphrody/m3-next and @aphrody/next-bun resolve.
    const { default: config } = (await import(join(out, "next", "next.config.ts"))) as {
      default: (phase: string, ctx: { defaultConfig: object }) => Promise<Record<string, any>>;
    };
    const resolved = await config("phase-production-build", {
      defaultConfig: {},
    });
    expect(resolved).toMatchObject({
      output: "standalone",
      poweredByHeader: false,
      env: { M3_APP_VERSION: "1.2.3" },
    });
    expect(resolved.transpilePackages).toContain("@aphrody/m3-next");
    expect(typeof resolved.turbopack.root).toBe("string");
    const build = await read("next", "build-next.sh");
    expect(build).toContain("bunx --bun next-bun build --turbopack");
    expect(build).toContain("bunx --bun next-bun standalone .next/standalone");
  });
});
