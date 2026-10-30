# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: Apache-2.0
# Builder of the native session apps: same base as the Pop!_OS/COSMIC session image (container/ubuntu.Dockerfile,
# ubuntu:26.04), so the packaged .debs link against the session's glibc and libraries. Toolchains come from rustup
# (each fork's rust-toolchain file selects its own), Bun is the host's pinned canary mounted read-only at run time.
FROM ubuntu:26.04
ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/opt/rustup \
    PATH=/opt/cargo/bin:/usr/local/bin:/usr/bin:/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git build-essential pkg-config cmake clang mold nasm just dpkg-dev unzip xz-utils python3 \
      libxkbcommon-dev libwayland-dev libinput-dev libseat-dev libudev-dev libdisplay-info-dev libgbm-dev libegl-dev \
      libpipewire-0.3-dev libpulse-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libflatpak-dev \
      libfontconfig-dev libfreetype-dev libdbus-1-dev libpam0g-dev libsystemd-dev libexpat1-dev libssl-dev \
      libglvnd-dev libxcb1-dev libx11-dev libxcursor-dev libxi-dev libxrandr-dev libappstream-dev libgtk-3-dev \
      libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libheif-dev libavcodec-dev \
      libavformat-dev libavutil-dev libswscale-dev libavfilter-dev libavdevice-dev libclang-dev \
      glslang-tools glslc libvulkan-dev \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh \
 && CARGO_HOME=/opt/cargo sh /tmp/rustup.sh -y --no-modify-path --profile minimal --default-toolchain 1.99.1 \
 && rm /tmp/rustup.sh && chmod -R a+rwX /opt/rustup /opt/cargo
