# syntax=docker/dockerfile:1.8
# SPDX-License-Identifier: Apache-2.0
# Ubuntu desktop build environment and lean application runtime dependencies.
# Build context must be the repository root.

ARG UBUNTU_VERSION=24.04

# Complete native build toolchain for the repository's GTK4 + CEF runtime.
FROM ubuntu:${UBUNTU_VERSION} AS builder
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
ARG RUST_VERSION=1.98.1
ARG BUN_VERSION=1.4.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates clang cmake curl git libasound2-dev libclang-dev \
      libcups2-dev libdrm-dev libgbm-dev libglib2.0-dev libgtk-4-dev libnss3-dev \
      libssl-dev libx11-dev libxcb-randr0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
      libxkbcommon-dev llvm-dev pkg-config python3 sccache unzip \
 && rm -rf /var/lib/apt/lists/* \
 && (userdel -r ubuntu 2>/dev/null || true) \
 && groupadd --gid 1000 builder \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash builder \
 && mkdir -p /workspace /home/builder/.cache \
 && chown -R builder:builder /workspace /home/builder
ENV HOME=/home/builder RUSTUP_HOME=/home/builder/.rustup CARGO_HOME=/home/builder/.cargo \
    BUN_INSTALL=/home/builder/.bun PATH=/home/builder/.cargo/bin:/home/builder/.bun/bin:${PATH} \
    APHRODY_CLOUD=1 RUSTC_WRAPPER=sccache SCCACHE_DIR=/home/builder/.cache/sccache
USER builder
WORKDIR /workspace
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --no-modify-path --default-toolchain "${RUST_VERSION}" \
 && rustup component add clippy rustfmt rust-src \
 && curl -fsSL https://bun.com/install | bash -s "bun-v${BUN_VERSION}"
CMD ["bash"]

# Runtime libraries for the CEF/GTK4 app. No browser system WebView is installed.
FROM ubuntu:${UBUNTU_VERSION} AS runtime
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 \
      libcairo2 libcups2t64 libdrm2 libgbm1 libglib2.0-0t64 libgtk-4-1 libnss3 libnspr4 \
      libpango-1.0-0 libssl3t64 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 libxrender1 libxshmfence1 libxss1 libxtst6 \
 && rm -rf /var/lib/apt/lists/* \
 && (userdel -r ubuntu 2>/dev/null || true) \
 && groupadd --gid 1000 desktop \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash desktop \
 && install -d -o desktop -g desktop /workspace /home/desktop/.config /home/desktop/.local/share
ENV HOME=/home/desktop XDG_CONFIG_HOME=/home/desktop/.config XDG_DATA_HOME=/home/desktop/.local/share
USER desktop
WORKDIR /workspace
CMD ["bash"]
