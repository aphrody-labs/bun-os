#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Start one Bun OS Android session container (reference invocation for the WebOS session manager).
#   sh run.sh [name] [adb-port]        defaults: bunos-android 127.0.0.1:5555
# Host preparation (idempotent): binder devices from binder_linux; redroid needs a privileged container.
# The session's /data lives in the named volume <name>-data (per-user state, Play sign-in, installed apps).
set -eu
name=${1:-bunos-android}
port=${2:-5555}
image=${BUNOS_ANDROID_IMAGE:-bunos-android:latest}
if [ ! -e /dev/binder ] && [ ! -e /dev/binderfs/binder ]; then
  sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
fi
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --privileged \
  --memory 4g --cpus 4 \
  -v "$name-data:/data" \
  -p "127.0.0.1:$port:5555" \
  "$image" \
  androidboot.redroid_width=1280 androidboot.redroid_height=800 androidboot.redroid_dpi=240 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_fps=30 \
  ro.product.brand=BunOS ro.product.model="Bun OS Android" ro.product.manufacturer=Aphrody
echo "$name: adb connect 127.0.0.1:$port"
