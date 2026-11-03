#!/usr/bin/env bash
# Windows 11 driver-test VM on the build host (QEMU/KVM, OVMF without Secure Boot, swtpm). bunos.sys is loaded
# here and only here: never on the workstation. State lives in $VM (default ~/build/storage/vm/win11).
#
#   vm.sh config <driver-pkg-dir> <bunos-nt.exe> <ts-dir>   build config.iso (setup.cmd, OpenSSH MSI, key, payload)
#   vm.sh install                                         unattended install from $VM/win11-ltsc-eval.iso, waits for ssh
#   vm.sh start | stop | ssh <cmd...>
#   vm.sh test                                            install + load bunos.sys, run bunos-nt and the bun:ffi test
set -euo pipefail
here=$(dirname "$(realpath "$0")")
VM=${VM:-$HOME/build/storage/vm/win11}
PORT=${PORT:-2222}
mkdir -p "$VM"
key=$VM/id_ed25519
[[ -f $key ]] || ssh-keygen -q -t ed25519 -N '' -f "$key"
sshv() { ssh -i "$key" -p "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o LogLevel=ERROR bun@127.0.0.1 "$@"; }
scpv() { scp -i "$key" -P "$PORT" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$@"; }

tpm() {
  mkdir -p "$VM/tpm"
  pgrep -f "swtpm socket --tpmstate dir=$VM/tpm" >/dev/null ||
    swtpm socket --tpmstate dir="$VM/tpm" --ctrl type=unixio,path="$VM/tpm/sock" --tpm2 --daemon
}

qemu() {
  tpm
  [[ -f $VM/vars.fd ]] || cp /usr/share/OVMF/OVMF_VARS_4M.fd "$VM/vars.fd"
  local cds=()
  for iso in "$@"; do cds+=(-drive "file=$iso,media=cdrom,if=none,id=cd${#cds[@]}" -device "ide-cd,drive=cd${#cds[@]},bus=ahci.$((1 + ${#cds[@]} / 2))"); done
  qemu-system-x86_64 -name bunos-drv -enable-kvm -machine q35 -cpu host -smp "${SMP:-4}" -m "${MEM:-6G}" \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.fd \
    -drive if=pflash,format=raw,file="$VM/vars.fd" \
    -chardev socket,id=chrtpm,path="$VM/tpm/sock" -tpmdev emulator,id=tpm0,chardev=chrtpm -device tpm-tis,tpmdev=tpm0 \
    -device ahci,id=ahci -drive id=disk,file="$VM/disk.qcow2",if=none,format=qcow2 -device ide-hd,drive=disk,bus=ahci.0 \
    "${cds[@]}" \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:$PORT-:22 -device e1000e,netdev=n0 \
    -display none -vnc 127.0.0.1:${VNC:-15} -monitor unix:"$VM/monitor",server,nowait \
    -serial file:"$VM/serial.log" -daemonize -pidfile "$VM/qemu.pid"
}

wait_ssh() {
  local limit=$1 t=0
  until sshv "echo ok" >/dev/null 2>&1; do
    sleep 10; t=$((t + 10))
    ((t < limit)) || { echo "ssh not up after ${limit}s" >&2; return 1; }
  done
  echo "ssh up after ${t}s"
}

case ${1:-} in
  config)
    pkg=$(realpath "$2"); exe=$(realpath "$3"); ts=$(realpath "$4")
    c=$(mktemp -d)
    sed 's/$/\r/' "$here/setup.cmd" >"$c/setup.cmd"
    cp "$here/autounattend.xml" "$c/autounattend.xml"
    cp "$key.pub" "$c/authorized_keys"
    # Win32-OpenSSH release MSI (PowerShell/Win32-OpenSSH, MIT): installed offline by setup.cmd.
    msi=$VM/OpenSSH-Win64.msi
    [[ -f $msi ]] || gh release download -R PowerShell/Win32-OpenSSH -p 'OpenSSH-Win64-v*.msi' -O "$msi"
    cp "$msi" "$c/OpenSSH-Win64.msi"
    mkdir -p "$c/bunos/driver" "$c/bunos/ts"
    cp "$pkg"/{bunos.sys,bunos.inf,bunos.cat,WDRLocalTestCert.cer} "$c/bunos/driver/"
    cp "$exe" "$c/bunos/bunos-nt.exe"
    cp -r "$ts/." "$c/bunos/ts/"
    sed 's/$/\r/' "$here/test-driver.cmd" >"$c/bunos/test-driver.cmd"
    xorriso -as mkisofs -quiet -J -joliet-long -r -V BUNOSCFG -o "$VM/config.iso" "$c"
    rm -rf "$c"; ls -l "$VM/config.iso"
    ;;
  install)
    [[ -f $VM/win11-ltsc-eval.iso && -f $VM/config.iso ]] || { echo "need $VM/win11-ltsc-eval.iso and config.iso" >&2; exit 1; }
    rm -f "$VM/disk.qcow2" "$VM/vars.fd"; qemu-img create -q -f qcow2 "$VM/disk.qcow2" 64G
    qemu "$VM/win11-ltsc-eval.iso" "$VM/config.iso"
    # OVMF shows "Press any key to boot from CD or DVD" for a few seconds: answer it.
    for _ in $(seq 40); do echo "sendkey ret" | socat - unix-connect:"$VM/monitor" >/dev/null 2>&1 || true; sleep 0.5; done
    wait_ssh "${INSTALL_TIMEOUT:-5400}"
    ;;
  start) qemu "$VM/config.iso"; wait_ssh 900 ;;
  stop) sshv "shutdown /s /t 0" || true; sleep 20; [[ -f $VM/qemu.pid ]] && kill "$(cat "$VM/qemu.pid")" 2>/dev/null || true ;;
  ssh) shift; sshv "$@" ;;
  test)
    sshv 'type C:\bunos-setup.log & bcdedit /enum {current} | findstr /i testsigning'
    sshv 'cmd /c C:\bunos\test-driver.cmd'
    ;;
  *) sed -n 2,9p "$0"; exit 2 ;;
esac
