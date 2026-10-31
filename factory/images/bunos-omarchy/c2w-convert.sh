#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Prepare c2w's browser runtime plus an external OCI rootfs. This is an
# experimental shell-terminal bundle, not a graphical desktop build.
set -euo pipefail

readonly script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly image_ref="${1:?usage: c2w-convert.sh IMAGE_REF PRIVATE_JOB_DIR PRIVATE_ROOT SHARED_LOCK}"
readonly output_input="${2:?missing private output directory}"
readonly private_root_input="${3:?missing private build root}"
readonly lock_path="${4:?missing shared factory lock path}"
readonly c2w="${C2W_BIN:-$HOME/build/tools/container2wasm-v0.8.4/c2w}"
readonly expected_version="v0.8.4"
readonly expected_binary_sha="ca6a504db86eff9d0ab28dc04b8710c0f7f9aecc1a8c398d20bc9e82784a82b3"
readonly expected_embedded_sha="cff6ff206edf808d903913892fe1fa71c51efebc5d0ef76608c26e5b7f17e275"
readonly expected_bounded_sha="256a29d4ce1ecfcbf9bb91aca8ba23335e8938e95d1a5f027bb06b359a7cc633"
readonly expected_jobs=25
readonly c2w_source_commit="6ed3d98882a2b22eafc1334f574c364a5b2b8c47"
readonly builder_name="bunos-omarchy-c2w-j4"

die() { printf 'c2w Omarchy conversion: %s\n' "$*" >&2; exit 1; }
for command in realpath flock docker skopeo sha256sum sed grep wc tr df timeout tar du find xargs awk cp mkdir date sort git bun go make gzip; do
  command -v "$command" >/dev/null || die "missing required command: $command"
done
[[ -x "$c2w" ]] || die "pinned c2w executable not found: $c2w"
[[ "$("$c2w" --version)" == "c2w version $expected_version" ]] || die "unexpected c2w release"
[[ "$(sha256sum "$c2w" | awk '{print $1}')" == "$expected_binary_sha" ]] || die "installed c2w binary digest mismatch"
[[ "$image_ref" =~ ^[A-Za-z0-9._/:@-]+$ ]] || die "invalid image reference"
[[ "$lock_path" == /* && "$private_root_input" == /* && "$output_input" == /* ]] || die "all paths must be absolute"

readonly private_root="$(realpath -e -- "$private_root_input")"
readonly output_dir="$(realpath -m -- "$output_input")"
[[ "$(dirname -- "$output_dir")" == "$private_root" ]] || die "output must be a direct child of the private build root"
[[ ! -e "$output_dir" && ! -L "$output_dir" ]] || die "refusing to reuse existing output: $output_dir"
[[ -f "$lock_path" ]] || die "shared factory lock must already exist: $lock_path"

# Acquire the same lock used by native image builds before creating any output
# or running Skopeo/BuildKit work. Do not switch or modify the default builder.
exec 9<>"$lock_path"
flock -x -w 3600 9 || die "shared factory slot remained busy for one hour"

readonly architecture="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_ref")"
[[ "$architecture" == "linux/amd64" ]] || die "expected linux/amd64 image, received $architecture"
docker buildx version >/dev/null
docker buildx create --help | grep -q -- '--buildkitd-config' || die "buildx lacks --buildkitd-config support"
docker buildx create --help | grep -q -- '--driver' || die "buildx lacks --driver support"

mkdir -- "$output_dir"
readonly web_dir="$output_dir/web"
readonly htdocs_dir="$web_dir/htdocs"
readonly js_dir="$htdocs_dir/img"
readonly oci_dir="$htdocs_dir/omarchy"
readonly logs_dir="$output_dir/logs"
readonly buildx_config="$private_root/bunos-omarchy-c2w-buildkitd.toml"
readonly embedded_dockerfile="$output_dir/c2w-v0.8.4-embedded.Dockerfile"
readonly bounded_dockerfile="$output_dir/c2w-v0.8.4-j4.Dockerfile"
readonly source_dir="$output_dir/container2wasm-v0.8.4"
readonly frontend_dir="$source_dir/extras/runcontainerjs"

mkdir -- "$web_dir" "$logs_dir" "$htdocs_dir"
if [[ -e "$buildx_config" ]]; then
  cmp -s -- "$script_dir/c2w-buildkitd.toml" "$buildx_config" || die "stable BuildKit config differs from this conversion's bounded config: $buildx_config"
else
  cp -- "$script_dir/c2w-buildkitd.toml" "$buildx_config"
fi

available_kib="$(df -Pk -- "$private_root" | awk 'END { print $4 }')"
required_bytes=32212254720
[[ "$available_kib" =~ ^[0-9]+$ ]] && (( available_kib * 1024 >= required_bytes )) || die "need at least 30 GiB free under $private_root"

# Verify and constrain every compiler invocation in this exact v0.8.4 embedded
# Dockerfile. The pinned hashes catch upstream binary/Dockerfile drift.
"$c2w" --show-dockerfile >"$embedded_dockerfile"
[[ "$(sha256sum "$embedded_dockerfile" | awk '{print $1}')" == "$expected_embedded_sha" ]] || die "embedded Dockerfile digest mismatch"
nproc_count="$(grep -o 'nproc' "$embedded_dockerfile" | wc -l | tr -d '[:space:]')"
[[ "$nproc_count" == "$expected_jobs" ]] || die "expected $expected_jobs nproc uses, found $nproc_count"
sed -E 's/-j[[:space:]]*\$\(nproc\)/-j4/g' "$embedded_dockerfile" >"$bounded_dockerfile"
if grep -q 'nproc' "$bounded_dockerfile"; then die "unbounded nproc expression remains"; fi
job_count="$(grep -o -- '-j4' "$bounded_dockerfile" | wc -l | tr -d '[:space:]')"
[[ "$job_count" == "$expected_jobs" ]] || die "expected $expected_jobs bounded -j4 uses, found $job_count"
[[ "$(sha256sum "$bounded_dockerfile" | awk '{print $1}')" == "$expected_bounded_sha" ]] || die "bounded Dockerfile digest mismatch"

# Keep the named owner builder and its cache between jobs. Buildx
# max-parallelism=1 serializes independent RUN stages; the verified -j4
# Dockerfile plus bounded Go settings caps compiler concurrency at four.
if docker buildx ls | awk 'NR > 1 { sub(/\*$/, "", $1); print $1 }' | grep -Fxq "$builder_name"; then
  docker buildx inspect --builder "$builder_name" >"$logs_dir/buildkit-builder-before.log" 2>&1 || die "stable BuildKit builder exists but cannot be inspected"
  grep -Eq 'Driver:[[:space:]]+docker-container' "$logs_dir/buildkit-builder-before.log" || die "stable builder has unexpected driver; inspect before using"
else
  docker buildx create --name "$builder_name" --driver docker-container --buildkitd-config "$buildx_config" >/dev/null
fi
docker buildx inspect --builder "$builder_name" --bootstrap >"$logs_dir/buildkit-builder.log" 2>&1

# Assemble the upstream browser terminal frontend from the exact c2w v0.8.4
# source commit, with its Go and JavaScript build concurrency explicitly bound.
timeout --signal=TERM 600 git clone --no-checkout --filter=blob:none \
  https://github.com/container2wasm/container2wasm.git "$source_dir" \
  >"$logs_dir/source-clone.log" 2>&1
timeout --signal=TERM 600 git -C "$source_dir" fetch --depth=1 origin "$c2w_source_commit" \
  >>"$logs_dir/source-clone.log" 2>&1
git -C "$source_dir" checkout --detach "$c2w_source_commit" >>"$logs_dir/source-clone.log" 2>&1
[[ "$(git -C "$source_dir" rev-parse HEAD)" == "$c2w_source_commit" ]] || die "container2wasm source checkout does not match the release commit"
cp -a -- "$source_dir/examples/no-conversion-emscripten/htdocs/." "$htdocs_dir/"
(
  cd -- "$source_dir"
  export GOMAXPROCS=4 GOFLAGS=-p=4
  timeout --signal=TERM 1800 make -j4 imagemounter.wasm
) >"$logs_dir/imagemounter.log" 2>&1
[[ -s "$source_dir/out/imagemounter.wasm" ]] || die "imagemounter build produced no wasm module"
gzip -n -9 -c "$source_dir/out/imagemounter.wasm" >"$htdocs_dir/imagemounter.wasm.gzip"
(
  cd -- "$frontend_dir"
  timeout --signal=TERM 1200 bun install --no-save
  timeout --signal=TERM 1200 bun run webpack
) >"$logs_dir/terminal-frontend.log" 2>&1
[[ -s "$frontend_dir/dist/runcontainer.js" && -s "$frontend_dir/dist/stack-worker.js" ]] || die "terminal frontend bundle is incomplete"
cp -a -- "$frontend_dir/dist" "$htdocs_dir/dist"

# Export the already-built Omarchy container as an OCI Image Layout. The
# browser fetches this external 5.8-GiB-class bundle separately from c2w's JS.
timeout --signal=TERM 3600 skopeo copy \
  --override-os linux --override-arch amd64 --format oci \
  "docker-daemon:$image_ref" "oci:$oci_dir:latest" \
  >"$logs_dir/skopeo.log" 2>&1
[[ -s "$oci_dir/oci-layout" && -s "$oci_dir/index.json" ]] || die "Skopeo did not produce a complete OCI Image Layout"
oci_bytes="$(du -sb -- "$oci_dir" | awk '{print $1}')"

# --external-bundle emits the Emscripten/QEMU browser runtime without
# embedding the Omarchy OCI image. Output path must be slash-terminated.
mkdir -- "$js_dir"
timeout --signal=TERM 14400 "$c2w" \
  --to-js --external-bundle \
  --dockerfile "$bounded_dockerfile" \
  --build-arg MAKEFLAGS=-j4 \
  --build-arg VM_MEMORY_SIZE_MB=2048 \
  --build-arg VM_CORE_NUMS=2 \
  --extra-flag="--builder=$builder_name" \
  "$js_dir/" \
  >"$logs_dir/c2w.log" 2>&1
[[ -n "$(find "$js_dir" -type f -print -quit)" ]] || die "c2w produced no browser runtime files"

embedded_sha="$(sha256sum "$embedded_dockerfile" | awk '{print $1}')"
bounded_sha="$(sha256sum "$bounded_dockerfile" | awk '{print $1}')"
oci_tree_sha="$(find "$oci_dir" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
js_tree_sha="$(find "$js_dir" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
cat >"$output_dir/conversion-receipt.json" <<EOF
{
  "schemaVersion": 1,
  "state": "unqualified-terminal-experiment",
  "createdAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceImage": "$image_ref",
  "sourceArchitecture": "$architecture",
  "container2wasm": {
    "version": "$expected_version",
    "binarySha256": "$expected_binary_sha",
    "releaseTarSha256": "1142ab95212578c0c7f666de830de6945f2abbea1713d1e07a7cb04072e00f31",
    "embeddedDockerfileSha256": "$embedded_sha",
    "boundedDockerfileSha256": "$bounded_sha",
    "nprocReplacements": $nproc_count,
    "allMakeJobsBoundedTo": 4,
    "buildkitMaxParallelism": 1,
    "flags": ["--to-js", "--external-bundle"],
    "guestMemoryMiB": 2048,
    "guestVcpus": 2
  },
  "externalRootfs": {
    "format": "OCI Image Layout",
    "path": "web/htdocs/omarchy",
    "sizeBytes": $oci_bytes,
    "treeSha256": "$oci_tree_sha",
    "expectedApproximateSize": "5.8 GiB"
  },
  "browserRuntime": {
    "path": "web/htdocs/img",
    "treeSha256": "$js_tree_sha"
  },
  "browserTerminal": {
    "sourceCommit": "$c2w_source_commit",
    "imagemounterPath": "web/htdocs/imagemounter.wasm.gzip",
    "frontendPath": "web/htdocs/dist",
    "rootfsPath": "web/htdocs/omarchy",
    "servingRequirements": ["HTTP", "COOP: same-origin", "COEP: require-corp", "CORS for the OCI layout", "same-origin xterm modules or valid CDN access"],
    "runtimeQualified": false
  },
  "qualification": {
    "terminalOnly": true,
    "browserUiPackaged": true,
    "browserUiQualified": false,
    "guiQualified": false,
    "notes": "Pinned upstream browser terminal UI and imagemounter are packaged with the external OCI rootfs. Browser serving headers, CDN availability, module integration, memory pressure and end-to-end session remain unqualified; graphical desktop is unsupported."
  }
}
EOF
printf 'Prepared c2w browser runtime and external OCI image: %s\n' "$output_dir"
printf 'OCI bundle bytes: %s; receipt: %s\n' "$oci_bytes" "$output_dir/conversion-receipt.json"
