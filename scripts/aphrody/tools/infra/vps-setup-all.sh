#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# VPS dependency provisioning and environment setup script (Ubuntu 26.04).
# Installs system libraries, Rust nightly, Bun, and UV in one go.
# Moved from aphrody/scripts/ (host provisioning belongs to aphrody-infra).
set -euo pipefail

echo "==> 0. Applying OS & Kernel Performance Tuning"
# Ensure BBR module is loaded
echo "tcp_bbr" | sudo tee /etc/modules-load.d/bbr.conf >/dev/null
sudo modprobe tcp_bbr 2>/dev/null || true

# Apply sysctl settings for high network/connection concurrency
sudo mkdir -p /etc/sysctl.d
cat <<EOF | sudo tee /etc/sysctl.d/99-aphrody-vps.conf >/dev/null
# Network & TCP Subsystem
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 16384
net.core.netdev_max_backlog = 16384
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
net.core.optmem_max = 2048576
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1
net.ipv4.tcp_dsack = 1
net.ipv4.tcp_fack = 1
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_syncookies = 1

# Virtual Memory
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
vm.max_map_count = 1048576
vm.min_free_kbytes = 65536
vm.overcommit_memory = 1

# Filesystem limits
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192
fs.pipe-max-size = 1048576
fs.aio-max-nr = 1048576

# Security Hardening
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
net.core.bpf_jit_harden = 2
kernel.unprivileged_bpf_disabled = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
EOF

sudo sysctl --system || true

# Configure limits for file descriptors & processes
sudo mkdir -p /etc/security/limits.d
cat <<EOF | sudo tee /etc/security/limits.d/99-aphrody.conf >/dev/null
aphrody          soft    nofile          1048576
aphrody          hard    nofile          1048576
aphrody          soft    nproc           524288
aphrody          hard    nproc           524288
aphrody          soft    memlock         unlimited
aphrody          hard    memlock         unlimited

*                soft    nofile          1048576
*                hard    nofile          1048576
*                soft    nproc           524288
*                hard    nproc           524288
*                soft    memlock         unlimited
*                hard    memlock         unlimited
root             soft    nofile          1048576
root             hard    nofile          1048576
EOF

# systemd Manager Limits
sudo mkdir -p /etc/systemd/system.conf.d
cat <<EOF | sudo tee /etc/systemd/system.conf.d/99-limits.conf >/dev/null
[Manager]
DefaultLimitNOFILE=1048576:1048576
DefaultLimitNPROC=524288:524288
DefaultLimitMEMLOCK=infinity
DefaultTasksMax=infinity
EOF

# systemd Journald Hardening
sudo mkdir -p /etc/systemd/journald.conf.d
cat <<EOF | sudo tee /etc/systemd/journald.conf.d/99-aphrody.conf >/dev/null
[Journal]
Storage=persistent
Compress=yes
SystemMaxUse=1G
SystemKeepFree=2G
SystemMaxFileSize=128M
MaxRetentionSec=1month
RateLimitIntervalSec=30s
RateLimitBurst=10000
EOF

# systemd-oomd tuning
sudo mkdir -p /etc/systemd/oomd.conf.d
cat <<EOF | sudo tee /etc/systemd/oomd.conf.d/99-aphrody.conf >/dev/null
[OOM]
SwapUsedLimit=90%
DefaultMemoryPressureLimit=75%
DefaultMemoryPressureDurationSec=30s
EOF

# VirtIO Storage (fstrim timer) and network rules
sudo systemctl enable --now fstrim.timer || true
sudo mkdir -p /etc/udev/rules.d
cat <<EOF | sudo tee /etc/udev/rules.d/99-virtio.rules >/dev/null
ACTION=="add|change", KERNEL=="vd[a-z]|sd[a-z]", ATTR{queue/scheduler}="none"
ACTION=="add|change", KERNEL=="vd[a-z]|sd[a-z]", ATTR{queue/read_ahead_kb}="256"
ACTION=="add", SUBSYSTEM=="net", KERNEL=="eth*|ens*", ATTR{tx_queue_len}="10000"
EOF
sudo udevadm control --reload-rules 2>/dev/null || true

# Enable Transparent Hugepages (THP)
if [[ -f /sys/kernel/mm/transparent_hugepage/enabled ]]; then
  echo "always" | sudo tee /sys/kernel/mm/transparent_hugepage/enabled >/dev/null || true
fi
if [[ -f /sys/kernel/mm/transparent_hugepage/defrag ]]; then
  echo "always" | sudo tee /sys/kernel/mm/transparent_hugepage/defrag >/dev/null || true
fi

# Try to make THP persistent in /etc/default/grub if grub config and update-grub exist
if [[ -f /etc/default/grub ]] && command -v update-grub &>/dev/null; then
  if ! grep -q "transparent_hugepage=always" /etc/default/grub; then
    sudo sed -i 's/\(GRUB_CMDLINE_LINUX_DEFAULT="[^"]*\)"/\1 transparent_hugepage=always"/' /etc/default/grub || true
    sudo update-grub || true
  fi
fi

echo "==> 1. Updating APT and installing system libraries"
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  protobuf-compiler \
  libportaudio2 \
  lld-21 \
  git \
  curl \
  libjemalloc-dev \
  libjemalloc2

echo "==> 2. Setting up lld linker symlinks"
sudo ln -sf /usr/bin/lld-21 /usr/bin/lld
sudo ln -sf /usr/bin/ld.lld-21 /usr/bin/ld.lld

echo "==> 3. Installing Rustup (nightly toolchain)"
if ! command -v rustup &>/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
else
  echo "Rustup already installed."
fi
# Load cargo environment
# shellcheck disable=SC1090
source "$HOME/.cargo/env"
rustup target add x86_64-unknown-linux-gnu wasm32-unknown-unknown wasm32-wasip1

echo "==> 4. Installing Bun (JavaScript runtime)"
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.com/install | bash
else
  echo "Bun already installed."
fi

echo "==> 5. Installing uv (Python package manager)"
if ! command -v uv &>/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
else
  echo "uv already installed."
fi

echo "==> VPS environment bootstrap complete!"
