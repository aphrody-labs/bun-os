# syntax=docker/dockerfile:1.8
# SPDX-License-Identifier: Apache-2.0
# aphrody:toolbox — the VPS build of the multicall `aphrody` (features jobs,mcp-toolbox: RAG, jobs, OCR, transcribe,
# home, remote_vnc, site_catalog; the published release behind aphrody:runtime has none of them) on the Bun fork
# image, which also gives the in-container `bun` the M3 tool host needs. Built and shipped by
# scripts/release/toolbox-image.ts on the vps (context: a staging directory holding this file and `aphrody`).
# dbfr runs it as the compose services mcp-http and jobs-worker (tools/config/container/compose.yaml).
ARG BASE=docker.io/oven/bun:1.4.4
FROM ${BASE}
USER root
COPY --chmod=0755 aphrody /usr/local/bin/aphrody
RUN --network=none for alias in aphrody-mcp aphrody-embed aphrody-infra; do ln -s aphrody "/usr/local/bin/$alias"; done \
 && aphrody --version
USER 1000:1000
ENV PATH=/usr/local/bin:/usr/bin:/bin
# The base image probes its own deploy entrypoint; each compose service declares its own check.
HEALTHCHECK NONE
ENTRYPOINT []
CMD ["aphrody", "--version"]
