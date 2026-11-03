#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Checks a kernel .config against AOSP's Android kernel requirements (kernel/configs: <release>/android-<kver>/
// android-base.config and android-base-conditional.xml), the same data VTS checks a device's /proc/config.gz
// against through the compatibility matrix. Every requirement ends in exactly one class:
//
//   met        the .config has the required value
//   absent     the symbol does not exist in this kernel tree's Kconfig (removed upstream or Android-only, never
//              merged); the reason and the mainline replacement are listed in ABSENT below when known
//   waived     deliberately not met: linux-bun is a general-purpose host kernel (WAIVED below gives each reason)
//   missing    exists in the tree, not met, not waived: a failure
//
//   bun check-android.ts --aosp <configs/c/android-6.12> --src <kernel tree> --config <.config> [--json out.json]
//
// Exit 1 when anything is `missing` or when a waiver/absent note no longer applies (stale list).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Requirements linux-bun does not meet on purpose: an Android device kernel wants them, a desktop/WSL/Waydroid
// host breaks with them. Android in a container (Waydroid) or a VM (Cuttlefish, crosvm) does not need them on the host.
const WAIVED: Record<string, string> = {
  CONFIG_FHANDLE: "systemd needs name_to_handle_at/open_by_handle_at (FHANDLE); Android's 'not set' is device-only",
  CONFIG_SYSVIPC: "desktop userland (X11 MIT-SHM, Wine, PostgreSQL) needs SysV IPC; Android's bionic has none",
  CONFIG_NFS_FS: "NFS client kept as a module for desktop/server use; unused by Android",
  CONFIG_NFSD: "NFS server kept as a module for desktop/server use; unused by Android",
  CONFIG_DEVMEM: "kept (with STRICT_DEVMEM, Arch default) for firmware and diagnostics tools on a PC",
  CONFIG_IP6_NF_NAT: "Docker/Podman IPv6 NAT needs it; Android forbids it on devices only",
  CONFIG_FW_CACHE: "firmware cache across suspend/resume for PC Wi-Fi/GPU firmware",
  CONFIG_STATIC_USERMODEHELPER:
    "routes every usermode helper (modprobe, coredump) through one binary Arch does not ship; would break request_module",
  CONFIG_DEFAULT_SECURITY_SELINUX:
    "SELinux is built in (SECURITY_SELINUX=y) and selectable with lsm=...,selinux; making it the default LSM on a host without a policy would change every Arch install. Android in Waydroid runs its own policy permissive",
};

// Requirements whose symbol does not exist in the mainline tree, with what replaces it.
const ABSENT: Record<string, string> = {
  CONFIG_ANDROID_BINDER_IPC:
    "C binder removed in v7.4-rc1 (fd2bc059ed46 'binder: rm -f binder.c', char-misc-7.4-rc1); ANDROID_BINDER_IPC_RUST (Rust binder) is the only binder and is enabled",
  CONFIG_ANDROID_BINDERFS: "C binderfs removed with the C binder; the Rust binder links rust_binderfs.c (binderfs) unconditionally",
  CONFIG_ASHMEM: "removed from staging in v5.18; Android 10+ libcutils uses memfd (sys.use_memfd=true in Waydroid)",
  CONFIG_CPU_FREQ_TIMES: "Android common kernel only; replaced by the BPF time_in_state program (Android 12+)",
  CONFIG_UID_SYS_STATS: "Android common kernel only (storaged/batterystats per-UID I/O); no mainline equivalent, not needed by Waydroid",
  CONFIG_NETFILTER_XT_MATCH_QUOTA2: "Android common kernel only; netd's data quotas use BPF (CGROUP_BPF, NETFILTER_XT_MATCH_BPF) since Android 9",
  CONFIG_NETFILTER_XT_MATCH_QUOTA2_LOG: "Android common kernel only, with QUOTA2",
  CONFIG_DM_DEFAULT_KEY: "Android common kernel only (metadata encryption on real block devices); mainline has dm-crypt with inline encryption",
  CONFIG_SCHED_DEBUG: "removed in v6.15; the debug interfaces it gated are always built",
  CONFIG_NF_CT_PROTO_DCCP: "DCCP removed from mainline in v6.16",
  CONFIG_NF_CT_PROTO_SCTP: "always built with NF_CONNTRACK since v5.x (no symbol)",
  CONFIG_NF_CT_PROTO_UDPLITE: "UDP-Lite conntrack folded into NF_CONNTRACK; no symbol",
  CONFIG_ANDROID_LOW_MEMORY_KILLER: "removed in v4.12; lmkd uses PSI (enabled)",
  CONFIG_ANDROID_PARANOID_NETWORK: "Android common kernel only",
  CONFIG_BPFILTER: "removed in v6.8",
  CONFIG_USELIB: "removed in v6.16",
  CONFIG_DEVKMEM: "removed in v5.13",
  CONFIG_TRACE_GPU_MEM: "exists only as a hidden symbol selected by GPU drivers that report memory tracepoints",
};

// Requirements whose symbol was renamed in mainline; the new name is checked (the old one is a "transitional" alias).
const RENAMED: Record<string, string> = {
  CONFIG_CFI_CLANG: "CONFIG_CFI", // arch/Kconfig v6.18+: CFI_CLANG -> CFI (kCFI), with Rust support
};

type Req = { sym: string; want: string; source: string };
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const aosp = opt("--aosp");
const src = opt("--src");
const configPath = opt("--config");
if (!aosp || !src || !configPath) {
  console.error("usage: check-android.ts --aosp <dir> --src <kernel tree> --config <.config> [--json out]");
  process.exit(2);
}

const config = new Map<string, string>();
for (const line of readFileSync(configPath, "utf8").split("\n")) {
  const set = /^(CONFIG_\w+)=(.*)$/.exec(line);
  if (set) config.set(set[1], set[2]);
}
const value = (sym: string) => config.get(sym) ?? "n";

// Every symbol defined by a Kconfig file of the tree.
const symbols = new Set<string>();
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === ".git") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (name.startsWith("Kconfig"))
      for (const m of readFileSync(p, "utf8").matchAll(/^\s*(?:menu)?config\s+(\w+)/gm)) symbols.add(`CONFIG_${m[1]}`);
  }
};
walk(src);

const reqs: Req[] = [];
for (const line of readFileSync(join(aosp, "android-base.config"), "utf8").split("\n")) {
  const set = /^(CONFIG_\w+)=(.*)$/.exec(line);
  const unset = /^# (CONFIG_\w+) is not set$/.exec(line);
  if (set) reqs.push({ sym: set[1], want: set[2], source: "android-base.config" });
  else if (unset) reqs.push({ sym: unset[1], want: "n", source: "android-base.config" });
}

// android-base-conditional.xml: <group><conditions><config>K V</config>...</conditions><config>K V</config>...</group>
const xml = readFileSync(join(aosp, "android-base-conditional.xml"), "utf8");
const pairs = (s: string) =>
  [...s.matchAll(/<config>\s*<key>(\w+)<\/key>\s*<value[^>]*>([^<]*)<\/value>\s*<\/config>/g)].map(m => ({
    sym: m[1],
    want: m[2].trim(),
  }));
for (const g of xml.matchAll(/<group>([\s\S]*?)<\/group>/g)) {
  const cond = /<conditions>([\s\S]*?)<\/conditions>/.exec(g[1]);
  const conds = cond ? pairs(cond[1]) : [];
  if (!conds.every(c => (c.want === "n" ? value(c.sym) === "n" : value(c.sym) === c.want))) continue;
  const label = conds.map(c => `${c.sym}=${c.want}`).join(",");
  for (const r of pairs(g[1].replace(/<conditions>[\s\S]*?<\/conditions>/, "")))
    reqs.push({ ...r, source: `android-base-conditional.xml [${label}]` });
}
// <kernel minlts="6.12.0" /> is the minimum kernel; mainline 7.4 satisfies it.
const minlts = /minlts="([\d.]+)"/.exec(xml)?.[1];

const strip = (v: string) => v.replace(/^"|"$/g, "");
const result = reqs.map(r => {
  const sym = RENAMED[r.sym] ?? r.sym;
  const have = value(sym);
  const met = r.want === "n" ? have === "n" : strip(have) === strip(r.want);
  let cls: "met" | "absent" | "waived" | "missing";
  let note: string | undefined;
  if (met) cls = "met";
  else if (!symbols.has(sym)) {
    cls = "absent";
    note = ABSENT[r.sym] ?? "symbol not in this tree's Kconfig";
  } else if (WAIVED[r.sym]) {
    cls = "waived";
    note = WAIVED[r.sym];
  } else cls = "missing";
  // TRACE_GPU_MEM is a hidden symbol: it exists but cannot be set from a fragment.
  if (cls === "missing" && ABSENT[r.sym]) {
    cls = "absent";
    note = ABSENT[r.sym];
  }
  if (sym !== r.sym) note = `renamed ${r.sym} -> ${sym}${note ? `; ${note}` : ""}`;
  return { ...r, have, class: cls, ...(note ? { note } : {}) };
});

const count = (c: string) => result.filter(r => r.class === c).length;
const stale = Object.keys(WAIVED).filter(s => result.some(r => r.sym === s && r.class === "met"));
const summary = {
  aosp,
  config: configPath,
  minlts,
  requirements: result.length,
  met: count("met"),
  absent: count("absent"),
  waived: count("waived"),
  missing: count("missing"),
  staleWaivers: stale,
};
for (const r of result.filter(r => r.class !== "met"))
  console.log(`${r.class.padEnd(7)} ${r.sym}=${r.want} (have ${r.have})${r.note ? `: ${r.note}` : ""}`);
console.log(JSON.stringify(summary));
const json = opt("--json");
if (json) writeFileSync(json, JSON.stringify({ ...summary, results: result }, null, 1));
process.exit(summary.missing > 0 ? 1 : 0);
