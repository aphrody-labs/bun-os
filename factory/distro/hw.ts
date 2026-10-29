// SPDX-License-Identifier: 0BSD
/**
 * Hardware detection profiles, after CachyOS/chwd (tag 1.25.0 = 4c61525942aa, 2026-10-23). Same data model
 * (TOML profile tables; match on PCI class/vendor/device IDs, DMI chassis/product/board, virtualization,
 * priority, driver_conflict_group, packages, hooks), reimplemented read-only: this module plans, it never
 * installs. chwd's profiles/*.toml are not copied; factory/distro/hw/profiles.toml is Bun OS's own list.
 * chwd's blacklist fields were not traced upstream (UNVERIFIED), so they are not implemented here.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PciDevice {
  /** 4 hex digits: class and subclass, e.g. "0300" (VGA). */
  class: string;
  vendor: string;
  device: string;
  name?: string;
}
export interface HostFacts {
  pci: PciDevice[];
  /** DMI chassis_type number as a string (laptop: 8 9 10 11 31). */
  chassisType?: string;
  productName?: string;
  boardName?: string;
  /** `systemd-detect-virt --vm` output, "none" on bare metal. */
  virt?: string;
}
export interface Profile {
  name: string;
  desc?: string;
  priority: number;
  class_ids: string[];
  vendor_ids: string[];
  device_ids: string[];
  /** ">ids/foo.ids" in the TOML: the device list is loaded from this file (see loadIds). */
  device_ids_file?: string;
  device_name_pattern?: string;
  hwd_product_name_pattern?: string;
  board_name_pattern?: string;
  chassis_types?: string[];
  environment_types?: string[];
  driver_conflict_group?: string;
  packages: string[];
  post_install?: string;
  post_remove?: string;
}

const list = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s+/).filter(Boolean) : []);
const lower = (v: string[]) => v.map(x => x.toLowerCase());

/** Parse profiles.toml. A dotted sub-table (`[a.b]`) inherits every key of its parent `[a]`. */
export function parseProfiles(text: string): Profile[] {
  const table = Bun.TOML.parse(text) as Record<string, any>;
  const out: Profile[] = [];
  const visit = (name: string, node: Record<string, any>, inherited: Record<string, any>) => {
    const scalars = Object.fromEntries(
      Object.entries(node).filter(([, v]) => typeof v !== "object" || Array.isArray(v)),
    );
    const merged = { ...inherited, ...scalars };
    const ids = typeof merged.device_ids === "string" ? merged.device_ids : "*";
    out.push({
      name,
      desc: merged.desc,
      priority: Number(merged.priority ?? 0),
      class_ids: lower(list(merged.class_ids ?? "*")),
      vendor_ids: lower(list(merged.vendor_ids ?? "*")),
      device_ids: ids.startsWith(">") ? ["*"] : lower(list(ids)),
      device_ids_file: ids.startsWith(">") ? ids.slice(1).trim() : undefined,
      device_name_pattern: merged.device_name_pattern,
      hwd_product_name_pattern: merged.hwd_product_name_pattern,
      board_name_pattern: merged.board_name_pattern,
      chassis_types: merged.chassis_types ? list(merged.chassis_types) : undefined,
      environment_types: merged.environment_types ? list(merged.environment_types) : undefined,
      driver_conflict_group: merged.driver_conflict_group,
      packages: list(merged.packages),
      post_install: node.post_install ?? inherited.post_install,
      post_remove: node.post_remove ?? inherited.post_remove,
    });
    for (const [key, child] of Object.entries(node))
      if (child && typeof child === "object" && !Array.isArray(child)) visit(`${name}.${key}`, child, merged);
  };
  for (const [name, node] of Object.entries(table))
    if (node && typeof node === "object") visit(name, node as Record<string, any>, {});
  return out;
}

/** `.ids` files: one hex device ID per line, `#` comments. */
export async function loadIds(file: string): Promise<Set<string>> {
  if (!existsSync(file)) return new Set();
  return new Set(
    (await readFile(file, "utf8"))
      .split(/\r?\n/)
      .map(l => l.replace(/#.*/, "").trim().toLowerCase())
      .filter(Boolean),
  );
}

const any = (patterns: string[], value: string) => patterns.includes("*") || patterns.includes(value.toLowerCase());

/** True when the profile applies to this device on this host. `ids` resolves device_ids_file contents. */
export function matches(profile: Profile, device: PciDevice, host: HostFacts, ids?: Map<string, Set<string>>): boolean {
  if (!any(profile.class_ids, device.class)) return false;
  if (!any(profile.vendor_ids, device.vendor)) return false;
  if (profile.device_ids_file) {
    if (!ids?.get(profile.device_ids_file)?.has(device.device.toLowerCase())) return false;
  } else if (!any(profile.device_ids, device.device)) return false;
  if (profile.device_name_pattern && !new RegExp(profile.device_name_pattern).test(device.name ?? "")) return false;
  if (profile.hwd_product_name_pattern && !new RegExp(profile.hwd_product_name_pattern).test(host.productName ?? ""))
    return false;
  if (profile.board_name_pattern && !new RegExp(profile.board_name_pattern).test(host.boardName ?? "")) return false;
  if (profile.chassis_types && !profile.chassis_types.includes(host.chassisType ?? "")) return false;
  if (profile.environment_types && !profile.environment_types.includes(host.virt ?? "none")) return false;
  return true;
}

export interface Selection {
  device: PciDevice;
  profile: Profile;
}
export interface Plan {
  selections: Selection[];
  /** Profiles that lost to a higher-priority profile of the same driver_conflict_group. */
  dropped: { profile: string; by: string; group: string }[];
  packages: string[];
  postInstall: string[];
}

/**
 * chwd --autoconfigure: for each device pick the matching profile with the highest priority, then keep one
 * profile per driver_conflict_group (highest priority wins). Sub-profiles (`name.child`) only apply when the
 * caller names them in `extra` (e.g. a prime variant chosen by hybrid-GPU detection), never implicitly.
 */
export function plan(
  profiles: Profile[],
  host: HostFacts,
  options: { ids?: Map<string, Set<string>>; extra?: string[] } = {},
): Plan {
  const wanted = new Set(options.extra ?? []);
  const candidates = profiles.filter(p => !p.name.includes(".") || wanted.has(p.name));
  const chosen: Selection[] = [];
  for (const device of host.pci) {
    const hits = candidates.filter(p => matches(p, device, host, options.ids)).sort((a, b) => b.priority - a.priority);
    if (hits[0]) chosen.push({ device, profile: hits[0] });
  }
  const dropped: Plan["dropped"] = [];
  const best = new Map<string, Selection>();
  for (const sel of chosen) {
    const group = sel.profile.driver_conflict_group;
    if (!group) continue;
    const current = best.get(group);
    if (!current || sel.profile.priority > current.profile.priority) best.set(group, sel);
  }
  const selections = chosen.filter(sel => {
    const group = sel.profile.driver_conflict_group;
    const winner = group ? best.get(group) : undefined;
    if (!group || !winner || winner.profile.name === sel.profile.name) return true;
    dropped.push({ profile: sel.profile.name, by: winner.profile.name, group });
    return false;
  });
  const unique = new Map(selections.map(s => [s.profile.name, s.profile]));
  return {
    selections,
    dropped,
    packages: [...new Set([...unique.values()].flatMap(p => p.packages))],
    postInstall: [...unique.values()].flatMap(p => (p.post_install ? [p.post_install] : [])),
  };
}

/** Read host facts from sysfs. `root` is "/" on a real system and a fixture directory in tests. */
export async function scanHost(root = "/"): Promise<HostFacts> {
  const read = async (...p: string[]) => (await readFile(join(root, ...p), "utf8").catch(() => "")).trim();
  const pci: PciDevice[] = [];
  const dir = join(root, "sys/bus/pci/devices");
  for (const slot of existsSync(dir) ? await readdir(dir) : []) {
    const hex = async (f: string, n: number) =>
      (await read("sys/bus/pci/devices", slot, f)).replace(/^0x/, "").slice(0, n);
    pci.push({ class: await hex("class", 4), vendor: await hex("vendor", 4), device: await hex("device", 4) });
  }
  return {
    pci,
    chassisType: (await read("sys/devices/virtual/dmi/id/chassis_type")) || undefined,
    productName: (await read("sys/devices/virtual/dmi/id/product_name")) || undefined,
    boardName: (await read("sys/devices/virtual/dmi/id/board_name")) || undefined,
  };
}

export async function loadIdsFor(profiles: Profile[], baseDir: string): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const p of profiles)
    if (p.device_ids_file) map.set(p.device_ids_file, await loadIds(join(baseDir, p.device_ids_file)));
  return map;
}

export const defaultProfilesFile = join(dirname(import.meta.path), "hw", "profiles.toml");
