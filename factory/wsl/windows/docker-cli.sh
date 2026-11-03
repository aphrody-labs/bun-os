#!/usr/bin/env bash
# Build docker.exe (the Docker CLI for Windows) from source: aphrody-labs/docker-cli (fork of docker/cli) at a pinned
# tag, cross-compiled with Go on the build host. The engine runs inside the bunos WSL distro; this CLI talks to it
# over the mirrored loopback (docs/WSL.md section 8). Usage: docker-cli.sh <work-dir> <out-dir>   env: TAG
set -euo pipefail
tag=${TAG:-v29.9.2}
work=$1; out=$2
mkdir -p "$work" "$out"; work=$(realpath "$work"); out=$(realpath "$out")
rm -rf "$work/docker-cli"
git clone -q --depth 1 --branch "$tag" https://github.com/aphrody-labs/docker-cli.git "$work/docker-cli"
cd "$work/docker-cli"
commit=$(git rev-parse HEAD)
# docker/cli ships vendor.mod instead of go.mod; with-go-mod.sh is upstream's own wrapper for module builds.
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 VERSION=${tag#v} GITCOMMIT=${commit:0:7} \
  ./scripts/with-go-mod.sh ./scripts/build/binary
exe=$(find build -maxdepth 1 -name 'docker-windows-amd64*.exe' -type f | head -1)
cp "$exe" "$out/docker.exe"
printf '{"tag":"%s","commit":"%s","bytes":%s,"sha256":"%s"}\n' "$tag" "$commit" "$(stat -c %s "$out/docker.exe")" \
  "$(sha256sum "$out/docker.exe" | cut -d' ' -f1)" | tee "$out/docker-cli.json"
