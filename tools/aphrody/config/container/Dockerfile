# syntax=docker/dockerfile:1.8
# SPDX-License-Identifier: Apache-2.0
#
# Aphrody in a container. Build context: the repository root.
#
#   docker build -f tools/config/container/Dockerfile --target runtime -t aphrody:runtime .   # verified Aphrody + Yolo binaries
#   docker build -f tools/config/container/Dockerfile --target dev     -t aphrody:dev     .   # + Rust toolchain and build tools
#   docker build -f tools/config/container/Dockerfile --target release-builder -t aphrody:release-builder . # + all Python workspaces
#
# Targets: runtime-base (OS) -> runtime (verified Aphrody + Yolo release binaries),
# and base (runtime-base + Bun/uv) -> build-tools (pinned toolchains) -> deps (frozen Bun install).
# dev adds shipped binaries; wasm-toolchain builds portable packages without them;
# release-builder adds Python; wasm-artifacts exports browser/Bun JS, types and WASM.
# The runtime target contains no source checkout, workspace node_modules or build toolchain.
# The container is its own build host: the dev target sets APHRODY_CLOUD=1, the same profile as a Claude cloud
# session (local Cargo through scripts/aphrody/build/rust/cargo-serial.sh, jobs = CPU count, no factory routing).
# Limits: scoped `-p <crate>` Cargo gates; full-workspace and engine (V8, Tauri, WebKit) builds need a larger host.

ARG UBUNTU=24.04

FROM ubuntu:${UBUNTU} AS runtime-base
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl libgcc-s1 libsqlite3-0 libssl3 libstdc++6 socat \
 && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 tools/config/container/entrypoint.sh /usr/local/bin/aphrody-entrypoint
RUN (userdel -r ubuntu 2>/dev/null || true) && useradd -m -u 1000 -s /bin/bash aphrody \
 && mkdir -p /app /home/aphrody/.aphrody && chown -R aphrody:aphrody /app /home/aphrody

# This uses the same published manifest and SHA256SUMS verification as the one-line installer.
# Only the shipped CLI/runtime/template artifacts enter the image; Rust sources are not copied.
FROM runtime-base AS artifacts
ARG APHRODY_DOWNLOAD_URL=https://downloads.aphrody.com
ARG APHRODY_RELEASE
COPY packages/infra/workspace/assets/downloads/install-full.sh /tmp/aphrody-install.sh
RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils coreutils gawk grep tar \
 && rm -rf /var/lib/apt/lists/*
RUN APHRODY_DOWNLOAD_URL="${APHRODY_DOWNLOAD_URL}" \
    APHRODY_RELEASE="${APHRODY_RELEASE}" \
    APHRODY_COMPONENTS="aphrody" \
    APHRODY_PREFIX=/opt/aphrody \
    APHRODY_NO_LINKS=1 \
    sh /tmp/aphrody-install.sh \
 && set -- /opt/aphrody/lib/aphrody/*/aphrody \
 && test -x "$1" \
 && strip --strip-unneeded "$1" \
 && "$1" --version >/dev/null \
 && rm -f /tmp/aphrody-install.sh

# Developer base. Pins follow package.json (packageManager) and tools/config/system-packages.json.
FROM runtime-base AS base
ARG BUN_VERSION=1.4.4
ARG UV_VERSION=0.12.22
RUN apt-get update \
 && apt-get install -y --no-install-recommends coreutils gawk git grep openssh-client python3 ripgrep rsync tar unzip xz-utils zstd jq \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.com/install | env BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}" \
 && curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh

FROM base AS build-tools
WORKDIR /app
COPY --chown=aphrody:aphrody rust-toolchain.toml ./
COPY --chown=aphrody:aphrody scripts/dev/cloud-quickinstall.ts scripts/dev/cloud-quickinstall.ts
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential pkg-config clang libclang-dev cmake ninja-build libssl-dev libsqlite3-dev zlib1g-dev \
      liblzma-dev libbz2-dev libzstd-dev protobuf-compiler pigz sccache \
 && rm -rf /var/lib/apt/lists/*
USER aphrody
ENV RUSTUP_HOME=/home/aphrody/.rustup CARGO_HOME=/home/aphrody/.cargo \
    BUN_INSTALL=/home/aphrody/.bun \
    YOLO_HOME=/home/aphrody/.yolo \
    PATH=/home/aphrody/.cargo/bin:/home/aphrody/.bun/bin:/home/aphrody/.yolo/bin:/home/aphrody/.local/bin:/usr/local/bin:/usr/bin:/bin \
    APHRODY_HOME=/home/aphrody/.aphrody APHRODY_CLOUD=1
# The channel is the one rust-toolchain.toml pins.
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none \
 && channel="$(sed -nE 's/^channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' rust-toolchain.toml | head -1)" \
 && rustup toolchain install "${channel}" --profile minimal -c rustfmt -c clippy -c rust-src \
 && rustup default "${channel}"
# Bun gates (oxlint, oxfmt) and prebuilt cargo tools; the latter are best effort (network policies differ).
RUN bun add -g oxlint oxfmt typescript@7.0.2 \
 && (bun scripts/dev/cloud-quickinstall.ts just cargo-nextest cargo-deny cargo-audit sd fd-find ripgrep || true)
ENTRYPOINT ["aphrody-entrypoint"]
CMD ["shell"]

FROM build-tools AS deps
WORKDIR /app
COPY --chown=aphrody:aphrody . .
USER aphrody
RUN --mount=type=cache,target=/home/aphrody/.bun/install/cache,uid=1000,gid=1000 \
    bun install --frozen-lockfile

# Compact runtime: verified Aphrody/Yolo artifacts, no monorepo or node_modules.
FROM runtime-base AS runtime
COPY --chown=aphrody:aphrody --from=artifacts /opt/aphrody /opt/aphrody
RUN set -- /opt/aphrody/lib/aphrody/*/aphrody \
 && test -x "$1" \
 && ln -s "$1" /usr/local/bin/aphrody \
 && ln -s "$1" /usr/local/bin/aphrody-mcp
ENV APHRODY_HOME=/home/aphrody/.aphrody PORT=8999
ENV PATH=/usr/local/bin:/usr/bin:/bin
VOLUME /home/aphrody/.aphrody
EXPOSE 8999
USER aphrody
ENTRYPOINT ["aphrody-entrypoint"]
CMD ["mcp"]

FROM deps AS dev
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
COPY --chown=aphrody:aphrody --from=artifacts /opt/aphrody /opt/aphrody
RUN set -- /opt/aphrody/lib/aphrody/*/aphrody \
 && test -x "$1" \
 && ln -s "$1" /usr/local/bin/aphrody \
 && ln -s "$1" /usr/local/bin/aphrody-mcp
USER aphrody

# Portable builds do not download the native CLI/runtime or Python ML workspace.
FROM build-tools AS wasm-toolchain
COPY --chown=aphrody:aphrody Cargo.lock ./
ARG WASM_OPT_VERSION=132
ARG CARGO_BINSTALL_VERSION=1.24.0
ARG TARGETARCH
USER root
# Digests are the official GitHub release asset digests for these pinned versions.
RUN arch="${TARGETARCH:-$(uname -m)}" \
 && case "$arch" in \
      amd64|x86_64) triple=x86_64; \
        wasm_sha=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572; \
        binstall_sha=7ffe1832c4bc3148d00f02d51c1d96c9cccdec76a0fa20e6e5692201d78bcc0b ;; \
      arm64|aarch64) triple=aarch64; \
        wasm_sha=c58562417836c5d0493d89bdefc434933bdc097db641b483df86bcfa557a107f; \
        binstall_sha=c2c44aba65d402ac43ee821387c49246bc574bde65d3d7f0f7a9e666c5a69f7f ;; \
      *) echo "Unsupported WASM builder architecture: $arch" >&2; exit 64 ;; \
    esac \
 && curl -fsSL "https://github.com/WebAssembly/binaryen/releases/download/version_${WASM_OPT_VERSION}/binaryen-version_${WASM_OPT_VERSION}-${triple}-linux.tar.gz" \
      -o /tmp/binaryen.tar.gz \
 && echo "${wasm_sha}  /tmp/binaryen.tar.gz" | sha256sum -c - \
 && mkdir -p /opt/binaryen \
 && tar -xzf /tmp/binaryen.tar.gz --strip-components=1 -C /opt/binaryen \
 && curl -fsSL "https://github.com/cargo-bins/cargo-binstall/releases/download/v${CARGO_BINSTALL_VERSION}/cargo-binstall-${triple}-unknown-linux-musl.tgz" \
      -o /tmp/cargo-binstall.tgz \
 && echo "${binstall_sha}  /tmp/cargo-binstall.tgz" | sha256sum -c - \
 && tar -xzf /tmp/cargo-binstall.tgz -C /usr/local/bin cargo-binstall \
 && cargo-binstall -V \
 && rm -f /tmp/binaryen.tar.gz /tmp/cargo-binstall.tgz
USER aphrody
ENV PATH=/opt/binaryen/bin:/home/aphrody/.cargo/bin:/home/aphrody/.bun/bin:/home/aphrody/.yolo/bin:/home/aphrody/.local/bin:/usr/local/bin:/usr/bin:/bin
ENV CARGO_TARGET_DIR=/app/target
ENV SCCACHE_DIR=/home/aphrody/.cache/sccache
RUN rustup target add wasm32-unknown-unknown wasm32-wasip1 \
 && bindgen_version="$(sed -n '/^name = "wasm-bindgen"$/,/^$/s/^version = "\([^"]*\)"$/\1/p' Cargo.lock | head -n1)" \
 && test -n "${bindgen_version}" \
 && cargo binstall --no-confirm --locked --disable-strategies compile --disable-telemetry --version "${bindgen_version}" \
      --install-path "/home/aphrody/.cache/aphrody/tools/wasm-bindgen-${bindgen_version}" wasm-bindgen-cli \
 && bun add --global wasm-pack@0.15.0 \
 && wasm-opt --version

# Export only the generated browser/Bun package: no image OS or native toolchain.
FROM wasm-toolchain AS wasm-build
COPY --chown=aphrody:aphrody . .
RUN --mount=type=cache,target=/home/aphrody/.cargo/registry,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/aphrody/.cargo/git,uid=1000,gid=1000 \
    --mount=type=cache,target=/app/target,sharing=locked,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/aphrody/.cache/sccache,uid=1000,gid=1000 \
    bun scripts/aphrody/build/rust/wasm-package.ts --crate aphrody-command-wasm --out /home/aphrody/wasm-package
FROM scratch AS wasm-artifacts
COPY --from=wasm-build /home/aphrody/wasm-package/ /

# Full multi-language release workspace, with its venv outside the source bind mount.
# Python ML dependencies are installed only for this explicitly selected target.
FROM wasm-toolchain AS release-builder
COPY --chown=aphrody:aphrody --from=deps /app /app
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
USER aphrody
ENV UV_CACHE_DIR=/home/aphrody/.cache/uv UV_PROJECT_ENVIRONMENT=/home/aphrody/.venv UV_LINK_MODE=copy
ENV CARGO_BUILD_JOBS=6 RUSTC_WRAPPER=sccache
RUN --mount=type=cache,target=/home/aphrody/.cache/uv,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/aphrody/.cargo/registry,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/aphrody/.cargo/git,uid=1000,gid=1000 \
    --mount=type=cache,target=/app/target,sharing=locked,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/aphrody/.cache/sccache,uid=1000,gid=1000 \
    uv sync --locked --all-packages --project py
WORKDIR /app
CMD ["shell"]

# Benchmark container: startup, pipe, JSON and file-read timings of dash, bash, zsh, fish, nu and bun
FROM base AS benchmark
USER root
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      dash bash zsh fish hyperfine time jq bc bsdextrautils \
 && rm -rf /var/lib/apt/lists/* \
 && arch="${TARGETARCH:-$(uname -m)}" \
 && case "$arch" in \
      amd64|x86_64) nu_arch=x86_64-unknown-linux-musl ;; \
      arm64|aarch64) nu_arch=aarch64-unknown-linux-musl ;; \
      *) nu_arch=x86_64-unknown-linux-musl ;; \
    esac \
 && curl -fsSL "https://github.com/nushell/nushell/releases/download/0.116.0/nu-0.116.0-${nu_arch}.tar.gz" \
      | tar -xzf - --strip-components=1 -C /usr/local/bin \
 && nu --version
USER aphrody
WORKDIR /app
COPY --chown=aphrody:aphrody . .
CMD ["bash", "scripts/audit/bench/run-shell-benchmark.sh"]

