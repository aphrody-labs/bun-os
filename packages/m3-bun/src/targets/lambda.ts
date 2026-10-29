// SPDX-License-Identifier: Apache-2.0
// AWS Lambda through the Bun runtime layer of upstream Bun (packages/bun-lambda of oven-sh/bun): its `bootstrap` runs
// `runtime.ts`, which imports `$LAMBDA_TASK_ROOT/<file>` named by `_HANDLER` (`handler.fetch`) and turns every
// API Gateway or function URL event into a `Request` for the module's `fetch`. The generated handler is the same
// `createM3App` the compiled executable serves (UI files, API, /healthz), bundled into one file.
import { relative } from "node:path";
import { GENERATED_NOTE } from "../util.ts";
import type { Target, TargetContext, TargetFile } from "./types.ts";

/** The app directory seen from the target directory (`../..` for the default `deploy/lambda`). */
export const appFromTarget = (c: TargetContext): string =>
  c.appDir && c.targetDir ? relative(c.targetDir, c.appDir).replaceAll("\\", "/") || "." : "../..";

export const handlerSource = (c: TargetContext): string => `// ${GENERATED_NOTE}
// The Lambda handler of ${c.name}: \`_HANDLER=handler.fetch\` for the Bun runtime layer (packages/bun-lambda).
import { join } from "node:path";
import { createM3App, dirSource } from "@aphrody/m3-bun/server";
${c.api ? `import api from "${appFromTarget(c)}/${c.api}";\n` : ""}
const app = createM3App({
  name: ${JSON.stringify(c.name)},
  version: ${JSON.stringify(c.version)},
  files: dirSource(join(import.meta.dir, ${JSON.stringify(c.outdir)})),
${c.api ? "  api,\n" : ""}});

export default { fetch: app.fetch };
`;

export const buildScript = (c: TargetContext): string => `#!/usr/bin/env bun
// ${GENERATED_NOTE}
// Build the function package lambda/function.zip: the UI (${c.cli} build), handler.ts bundled for Bun into
// handler.js, and the UI files next to it.
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { archiveDir } from "@aphrody/m3-bun";

const here = import.meta.dir;
const app = join(here, ${JSON.stringify(appFromTarget(c))});
const stage = join(here, "out");
await rm(stage, { recursive: true, force: true });

const ui = Bun.spawnSync([...${JSON.stringify(c.cli.split(" "))}, "build"], { windowsHide: true, cwd: app, stdout: "inherit", stderr: "inherit" });
if (ui.exitCode !== 0) throw new Error("${c.cli} build failed");

const bundle = await Bun.build({ entrypoints: [join(here, "handler.ts")], outdir: stage, target: "bun", minify: true, naming: "handler.js" });
if (!bundle.success) throw new AggregateError(bundle.logs, "handler bundle failed");
await cp(join(app, ${JSON.stringify(c.outdir)}), join(stage, ${JSON.stringify(c.outdir)}), { recursive: true });

const archiver = await archiveDir(stage, join(here, "function.zip"), "zip");
console.log(\`function.zip written by \${archiver}\`);
`;

export const layerScript = (c: TargetContext): string => {
  const source = `--release "bun-v${c.bunVersion}"`;
  return `#!/bin/sh
# ${GENERATED_NOTE}
# Build the Bun runtime layer with the build-layer command of packages/bun-lambda in an oven-sh/bun checkout
# (APHRODY_BUN_CHECKOUT, run \`bun install\` in packages/bun-lambda once). Publishing stays manual:
#   aws lambda publish-layer-version --layer-name bun --zip-file fileb://bun-lambda-layer.zip --compatible-architectures arm64
set -eu
checkout="\${APHRODY_BUN_CHECKOUT:?set APHRODY_BUN_CHECKOUT to a checkout of oven-sh/bun}"
bun "$checkout/packages/bun-lambda/scripts/build-layer.ts" --arch aarch64 \\
  ${source} \\
  --output "$(dirname "$0")/bun-lambda-layer.zip"
`;
};

export const samTemplate = (c: TargetContext): string => `# ${GENERATED_NOTE}
# AWS SAM: ${c.name} as one arm64 function behind a function URL. \`sam deploy --guided\` after build-lambda.ts.
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Parameters:
  BunLayerArn:
    Type: String
    Description: ARN of the layer built by build-layer.sh
Resources:
  App:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: ${c.name}
      CodeUri: function.zip
      Handler: handler.fetch
      Runtime: provided.al2023
      Architectures: [arm64]
      MemorySize: 512
      Timeout: 30
      Layers: [!Ref BunLayerArn]
      Environment:
        Variables:
          NODE_ENV: production
      FunctionUrlConfig:
        AuthType: NONE
Outputs:
  Url:
    Value: !GetAtt AppUrl.FunctionUrl
`;

export const lambda: Target = {
  id: "lambda",
  title: "AWS Lambda",
  description:
    "handler.ts (createM3App for the bun-lambda runtime), build-lambda.ts (function.zip), build-layer.sh (bun-lambda build-layer), SAM template",
  generate(c): TargetFile[] {
    return [
      { path: "handler.ts", content: handlerSource(c) },
      { path: "build-lambda.ts", content: buildScript(c), mode: 0o755 },
      { path: "build-layer.sh", content: layerScript(c), mode: 0o755 },
      { path: "template.yaml", content: samTemplate(c) },
    ];
  },
};
