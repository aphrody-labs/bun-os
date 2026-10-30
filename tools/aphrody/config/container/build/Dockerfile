# syntax=docker/dockerfile:1.8
# SPDX-License-Identifier: Apache-2.0
#
# aphrody-build: the single VPS build image for Aphrody.
# Build it with scripts/aphrody/build/container/aphrody-build.ts image (pins read from rust-toolchain.toml,
# package.json#packageManager and Cargo.lock); run builds with `aphrody-build.ts run`. It copies no checkout, env file or secret into the image:
# sources are bind mounted, caches are named volumes, tokens arrive as runtime environment names.
#
# Contents: Rust (pinned channel, every target/component of rust-toolchain.toml: Linux, Windows MSVC,
# wasm32), cargo-xwin + clang-cl/lld-link for Windows MSVC cross builds, wasm-bindgen-cli matching
# Cargo.lock, sccache, mold/lld, cmake/ninja/nasm/clang (aws-lc-sys, boringtun/defguard netlink,
# rustvncserver, x11rb), Bun and uv. Runs as any host uid with the shared `aphrody-build` group.

ARG UBUNTU=26.04

FROM ubuntu:${UBUNTU} AS build
ARG RUST_CHANNEL
ARG RUST_TARGETS
ARG RUST_COMPONENTS
ARG BUN_VERSION
ARG BUN_RELEASE_VERSION
ARG UV_VERSION=0.12.24
ARG WASM_BINDGEN_VERSION
ARG SCCACHE_VERSION=0.18.0
ARG CARGO_XWIN_VERSION=0.23.1
ARG CARGO_BINSTALL_VERSION=1.24.0
ARG CARGO_BINSTALL_SHA256=7ffe1832c4bc3148d00f02d51c1d96c9cccdec76a0fa20e6e5692201d78bcc0b
# LLVM 22 (Ubuntu 26.04): the MSVC STL that cargo-xwin fetches rejects clang-cl older than 19 (STL1000).
ARG LLVM=22
ARG BUILD_GID=1500
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8

RUN test -n "${RUST_CHANNEL}" && test -n "${BUN_VERSION}" && test -n "${BUN_RELEASE_VERSION}" && test -n "${WASM_BINDGEN_VERSION}" \
 || { echo "RUST_CHANNEL, BUN_VERSION, BUN_RELEASE_VERSION and WASM_BINDGEN_VERSION are required (use aphrody-build.ts image)" >&2; exit 64; }

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git openssh-client tar unzip xz-utils zstd jq rsync file python3 \
      build-essential pkg-config cmake ninja-build nasm protobuf-compiler \
      clang-${LLVM} lld-${LLVM} llvm-${LLVM} libclang-${LLVM}-dev mold \
      libssl-dev libsqlite3-dev zlib1g-dev liblzma-dev libbz2-dev libzstd-dev \
 && llvm="/usr/lib/llvm-${LLVM}/bin" \
 && for tool in clang clang++ lld ld.lld llvm-ar llvm-rc llvm-ranlib; do ln -sf "${llvm}/${tool}" "/usr/local/bin/${tool}"; done \
 && ln -sf "${llvm}/clang" /usr/local/bin/clang-cl \
 && ln -sf "${llvm}/lld" /usr/local/bin/lld-link \
 && ln -sf "${llvm}/llvm-ar" /usr/local/bin/llvm-lib \
 && ln -sf "${llvm}/llvm-ar" /usr/local/bin/llvm-dlltool \
 && clang-cl --version >/dev/null && lld-link --version >/dev/null && llvm-lib /? >/dev/null

# Rust toolchain under /opt/rust, read-only at runtime: every target and component the repository
# toolchain file names is preinstalled so rustup never needs to write while a build runs.
ENV RUSTUP_HOME=/opt/rust/rustup PATH=/opt/rust/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
      | env CARGO_HOME=/opt/rust/cargo sh -s -- -y --no-modify-path --profile minimal --default-toolchain none \
 && targets="" && for t in ${RUST_TARGETS}; do targets="${targets} -t ${t}"; done \
 && components="" && for c in ${RUST_COMPONENTS}; do components="${components} -c ${c}"; done \
 && env CARGO_HOME=/opt/rust/cargo rustup toolchain install "${RUST_CHANNEL}" --profile minimal ${components} ${targets} \
 && env CARGO_HOME=/opt/rust/cargo rustup default "${RUST_CHANNEL}" \
 && rustc --version && cargo --version

# Prebuilt, version-pinned cargo tools (no compilation in the image build).
RUN curl -fsSL "https://github.com/cargo-bins/cargo-binstall/releases/download/v${CARGO_BINSTALL_VERSION}/cargo-binstall-x86_64-unknown-linux-musl.tgz" \
      -o /tmp/cargo-binstall.tgz \
 && echo "${CARGO_BINSTALL_SHA256}  /tmp/cargo-binstall.tgz" | sha256sum -c - \
 && tar -xzf /tmp/cargo-binstall.tgz -C /tmp cargo-binstall \
 && env CARGO_HOME=/opt/rust/cargo /tmp/cargo-binstall --no-confirm --locked --disable-telemetry \
      --disable-strategies compile --install-path /opt/rust/cargo/bin \
      "sccache@${SCCACHE_VERSION}" "cargo-xwin@${CARGO_XWIN_VERSION}" "wasm-bindgen-cli@${WASM_BINDGEN_VERSION}" \
 && rm -rf /tmp/cargo-binstall /tmp/cargo-binstall.tgz /opt/rust/cargo/registry /opt/rust/cargo/.crates* \
 && sccache --version && cargo-xwin --version && wasm-bindgen --version

# Bun: the exact upstream oven-sh/bun release pinned by package.json.
RUN curl -fsSL https://bun.com/install \
      | env BUN_INSTALL=/opt/bun bash -s "${BUN_RELEASE_VERSION}" \
 && ln -sf /opt/bun/bin/bun /usr/local/bin/bun && ln -sf /opt/bun/bin/bun /usr/local/bin/bunx \
 && case "$(bun --version)" in "${BUN_VERSION}"*) ;; *) echo "bun $(bun --version) is not ${BUN_VERSION}" >&2; exit 1 ;; esac \
 && curl -LsSf "https://astral.sh/uv/${UV_VERSION}/install.sh" | env UV_INSTALL_DIR=/usr/local/bin INSTALLER_NO_MODIFY_PATH=1 sh \
 && uv --version

# Private Git dependencies (aphrody-labs/aphrody pinned by revision): the system credential
# helper answers for github.com from APHRODY_GIT_TOKEN, passed at run time by name only; nothing stored.
RUN git config --system credential.https://github.com.helper \
      '!f() { test "$1" = get && test -n "${APHRODY_GIT_TOKEN:-}" && printf "username=x-access-token\npassword=%s\n" "$APHRODY_GIT_TOKEN"; }; f'

# Shared caches: each mount point becomes a named volume owned by the build group (setgid, group
# writable), so any host uid that runs with `--group-add ${BUILD_GID}` shares them.
RUN groupadd -g "${BUILD_GID}" aphrody-build \
 && mkdir -p /cache/cargo /cache/sccache /cache/bun /cache/xwin /cache/xdg /cache/target /work \
 && chown -R root:aphrody-build /cache /work && chmod -R 2775 /cache /work
COPY --chmod=755 entrypoint.sh /usr/local/bin/aphrody-build-entrypoint

# Windows MSVC C/C++: clang-cl, unlike cl.exe, needs the ISA enabled for SSE4.1/SSSE3 intrinsics
# (libwebp-sys): x86-64-v2, the Windows 11 24H2 baseline (SSE4.2 + POPCNT).
ENV CARGO_HOME=/cache/cargo \
    SCCACHE_DIR=/cache/sccache SCCACHE_CACHE_SIZE=20G RUSTC_WRAPPER=sccache CARGO_INCREMENTAL=0 \
    BUN_INSTALL_CACHE_DIR=/cache/bun XWIN_CACHE_DIR=/cache/xwin XDG_CACHE_HOME=/cache/xdg \
    CARGO_BUILD_JOBS=6 CARGO_NET_GIT_FETCH_WITH_CLI=true CARGO_TERM_COLOR=never \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=clang \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C link-arg=-fuse-ld=mold" \
    CMAKE_POLICY_VERSION_MINIMUM=3.5 \
    CFLAGS_x86_64_pc_windows_msvc="-msse4.2 -mpopcnt" \
    CXXFLAGS_x86_64_pc_windows_msvc="-msse4.2 -mpopcnt" \
    APHRODY_CLOUD=1 CONTAINER=true HOME=/tmp/home \
    NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
LABEL org.opencontainers.image.title="aphrody-build" \
      org.opencontainers.image.description="Aphrody VPS build image" \
      org.opencontainers.image.licenses="Apache-2.0" \
      dev.aphrody.rust="${RUST_CHANNEL}" dev.aphrody.bun="${BUN_VERSION}" dev.aphrody.bun-release="${BUN_RELEASE_VERSION}" \
      dev.aphrody.wasm-bindgen="${WASM_BINDGEN_VERSION}"
WORKDIR /work
USER 65534:${BUILD_GID}
ENTRYPOINT ["aphrody-build-entrypoint"]
CMD ["bash"]
