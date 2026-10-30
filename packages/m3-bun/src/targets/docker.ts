// SPDX-License-Identifier: Apache-2.0
// Docker: a multi-stage Dockerfile that compiles the app on Aphrody Alpine (musl) and runs the executable on
// ghcr.io/aphrody-labs/alpine:3.24-runtime (musl, libstdc++, CA certificates, tzdata, user agent 1000; built by
// scripts/aphrody/alpine/runtime.Dockerfile of the former Bun fork). Plus a Dockerfile for a rootfs prepared by
// `m3-bun package --rootfs` (the smallest image: scratch plus the executable's libraries), a compose file and a
// .dockerignore.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

/** Base image of the build and run stages. */
export const RUNTIME_IMAGE = "ghcr.io/aphrody-labs/alpine:3.24-runtime";

const dockerfile = (c: TargetContext): string => `# syntax=docker/dockerfile:1
# ${GENERATED_NOTE}
# ${c.name} ${c.version}: one executable serves the UI and the API. Both stages use the Aphrody Alpine runtime
# image, so the executable is compiled by its musl Bun for the build platform (amd64 or arm64) and finds musl,
# libstdc++, CA certificates and tzdata at run time. It runs as the unprivileged user agent (1000).
# For the smallest image use Dockerfile.scratch.

FROM ${RUNTIME_IMAGE} AS build
WORKDIR /home/agent/src
COPY --chown=agent:agent . .
RUN bun install --frozen-lockfile
RUN ${c.cli} compile --outfile /home/agent/out/${c.binary}

FROM ${RUNTIME_IMAGE}
COPY --from=build /home/agent/out/${c.binary} /app/server
ENV PORT=${c.port} HOST=0.0.0.0
EXPOSE ${c.port}
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD ["/app/server", "--healthcheck"]
ENTRYPOINT ["/app/server"]
`;

const scratchfile = (c: TargetContext): string => `# ${GENERATED_NOTE}
# Image of an already compiled app: \`${c.cli} package --rootfs\` writes ./rootfs (the executable and its libraries).
#   docker build -f Dockerfile.scratch -t ${c.image}:${c.version} .
FROM scratch
COPY rootfs/ /
ENV PORT=${c.port} HOST=0.0.0.0
EXPOSE ${c.port}
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 CMD ["/app/server", "--healthcheck"]
ENTRYPOINT ["/app/server"]
`;

const compose = (c: TargetContext): string => `# ${GENERATED_NOTE}
services:
  ${c.name}:
    image: ${c.image}:${c.version}
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:${c.port}:${c.port}"
    environment:
      PORT: "${c.port}"
      HOST: 0.0.0.0
    healthcheck:
      test: ["CMD", "/app/server", "--healthcheck"]
      interval: 30s
      timeout: 4s
      retries: 3
      start_period: 5s
    restart: unless-stopped
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
`;

export const docker: Target = {
  id: "docker",
  title: "Docker",
  description:
    "Multi-stage Dockerfile on the Aphrody Alpine runtime image, a scratch Dockerfile for the rootfs, compose and .dockerignore",
  generate(c): GeneratedFile[] {
    return [
      { path: "Dockerfile", content: dockerfile(c) },
      { path: "Dockerfile.scratch", content: scratchfile(c) },
      { path: "docker-compose.yml", content: compose(c) },
      {
        path: ".dockerignore",
        content: ["node_modules", ".git", "dist", "bin", "deploy", "**/*.log", ".env*", ""].join("\n"),
      },
    ];
  },
};
