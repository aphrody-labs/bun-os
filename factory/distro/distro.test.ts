import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDefaults, resolveKey, sanitize } from "./cosmic.ts";
import { defaultProfilesFile, loadIdsFor, parseProfiles, plan } from "./hw.ts";
import { renderFragment, renderVariant, variants } from "./kernel-variant.ts";
import { refreshConfig, runHook } from "./layers.ts";
import { listMigrations, migrate, pendingMigrations, seedMigrations } from "./migrate.ts";
import { applyLayers, bunosLayers, cachyosLayers, detectIsa, renderLayers } from "./repos.ts";
import { mix, parseColors, render, renderTheme } from "./theme.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "bunos-distro-"));
const here = import.meta.dir;

describe("migrations", () => {
  test("sorted numerically, marker only after success, failure stops the run", async () => {
    const dir = tmp();
    const state = join(tmp(), "state");
    for (const f of ["1000000002.sh", "999999999999.sh", "1000000001.sh", "notes.txt"]) writeFileSync(join(dir, f), "");
    expect(await listMigrations(dir)).toEqual(["1000000001.sh", "1000000002.sh", "999999999999.sh"]);
    const seen: string[] = [];
    const first = await migrate({
      dir,
      stateDir: state,
      log: () => {},
      runner: async f => (seen.push(f.slice(-13)), f.endsWith("1000000002.sh") ? 3 : 0),
    });
    expect(first.ran).toEqual(["1000000001.sh"]);
    expect(first.failed).toEqual({ file: "1000000002.sh", code: 3 });
    expect(seen).toEqual(["1000000001.sh", "1000000002.sh"]);
    expect(await pendingMigrations(dir, state)).toEqual(["1000000002.sh", "999999999999.sh"]);
    const second = await migrate({ dir, stateDir: state, log: () => {}, runner: async () => 0 });
    expect(second.ran).toEqual(["1000000002.sh", "999999999999.sh"]);
    expect(await pendingMigrations(dir, state)).toEqual([]);
  });
  test("first install seeds every marker", async () => {
    const dir = tmp();
    const state = join(tmp(), "s");
    writeFileSync(join(dir, "1000000001.sh"), "");
    await seedMigrations(dir, state);
    expect(await pendingMigrations(dir, state)).toEqual([]);
  });
  test("a stuck pacman lock reports locked without running", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "1000000001.sh"), "");
    const lock = join(tmp(), "db.lck");
    writeFileSync(lock, "");
    const r = await migrate({
      dir,
      stateDir: tmp(),
      pacmanLock: lock,
      lockTimeoutMs: 30,
      runner: async () => 0,
      log: () => {},
    });
    expect(r).toEqual({ ran: [], locked: true });
  });
  test.skipIf(process.platform === "win32")("runs a real shell migration", async () => {
    const dir = tmp();
    const state = join(tmp(), "s");
    const out = join(tmp(), "out");
    writeFileSync(join(dir, "1000000001.sh"), `echo "$BUNOS_PATH" > ${JSON.stringify(out)}\n`);
    const r = await migrate({ dir, stateDir: state, bunosPath: "/x", log: () => {} });
    expect(r.ran).toEqual(["1000000001.sh"]);
    expect(readFileSync(out, "utf8").trim()).toBe("/x");
  });
});

describe("repository layers", () => {
  const v4 = "x86-64-v4 (supported, searched)\nx86-64-v3 (supported, searched)\nx86-64-v2 (supported, searched)";
  test("ISA detection order", () => {
    expect(detectIsa({ ldHelp: v4, gccTarget: "  -march=                      znver5" })).toBe("znver4");
    expect(detectIsa({ ldHelp: v4, gccTarget: "  -march=                      skylake" })).toBe("x86-64-v4");
    expect(detectIsa({ ldHelp: "x86-64-v3 (supported, searched)" })).toBe("x86-64-v3");
    expect(detectIsa({ ldHelp: "x86-64-v3 (unsupported)" })).toBe("x86-64");
    expect(detectIsa({ ldHelp: "x86-64-v3 (supported, searched)", gccTarget: "-march= znver5" })).toBe("x86-64-v3");
  });
  test("tiers: names, mirror lists, znver4 uses the v4 list", () => {
    expect(cachyosLayers("x86-64-v3").map(l => l.name)).toEqual([
      "cachyos-v3",
      "cachyos-core-v3",
      "cachyos-extra-v3",
      "cachyos",
    ]);
    expect(cachyosLayers("znver4")[0]!.include).toBe("/etc/pacman.d/cachyos-v4-mirrorlist");
    expect(cachyosLayers("x86-64").map(l => l.name)).toEqual(["cachyos"]);
    expect(bunosLayers("x86-64-v3", "https://r.example/$repo/$arch").map(l => l.server)).toEqual([
      "https://r.example/$repo/$arch_v3",
      "https://r.example/$repo/$arch",
    ]);
  });
  test("applyLayers inserts before [core], sets Architecture, and is idempotent", () => {
    const conf = "[options]\nHoldPkg = pacman\nArchitecture = x86_64\n\n[core]\nInclude = /etc/pacman.d/mirrorlist\n";
    const once = applyLayers(conf, cachyosLayers("x86-64-v3"));
    expect(once.indexOf("[cachyos-v3]")).toBeLessThan(once.indexOf("[core]"));
    expect(once).toContain("Architecture = auto");
    expect(applyLayers(once, cachyosLayers("x86-64-v3"))).toBe(once);
    expect(renderLayers(cachyosLayers("x86-64"))).toBe("[cachyos]\nInclude = /etc/pacman.d/cachyos-mirrorlist");
  });
});

describe("hardware profiles", () => {
  const profiles = parseProfiles(readFileSync(defaultProfilesFile, "utf8"));
  const gpu = (vendor: string, device = "1111") => ({ class: "0300", vendor, device });
  test("the shipped profiles parse and a sub-profile inherits its parent", () => {
    const prime = profiles.find(p => p.name === "nvidia-open-dkms.prime")!;
    expect(prime.vendor_ids).toEqual(["10de"]);
    expect(prime.device_ids_file).toBe("ids/nvidia-open.ids");
    expect(prime.priority).toBe(11);
  });
  test("AMD and Intel pick their own profile; Intel+AMD laptop gets both", () => {
    const p = plan(profiles, { pci: [gpu("8086"), gpu("1002")], virt: "none" });
    expect(p.selections.map(s => s.profile.name)).toEqual(["intel", "amd"]);
    expect(p.packages).toContain("vulkan-radeon");
  });
  test("NVIDIA without the ids file falls back; with it, open-dkms wins", async () => {
    const without = plan(
      profiles,
      { pci: [gpu("10de", "2684")], virt: "none" },
      { ids: await loadIdsFor(profiles, tmp()) },
    );
    expect(without.selections[0]!.profile.name).toBe("fallback");
    const dir = tmp();
    mkdirSync(join(dir, "ids"));
    writeFileSync(join(dir, "ids", "nvidia-open.ids"), "# Turing+\n2684\n");
    const withIds = plan(
      profiles,
      { pci: [gpu("10de", "2684")], virt: "none" },
      { ids: await loadIdsFor(profiles, dir) },
    );
    expect(withIds.selections[0]!.profile.name).toBe("nvidia-open-dkms");
    const prime = plan(
      profiles,
      { pci: [gpu("10de", "2684")], virt: "none", chassisType: "10" },
      {
        ids: await loadIdsFor(profiles, dir),
        extra: ["nvidia-open-dkms.prime"],
      },
    );
    expect(prime.selections[0]!.profile.name).toBe("nvidia-open-dkms.prime");
    expect(prime.packages).toContain("switcheroo-control");
  });
  test("a VM profile beats the vendor profile; one profile per conflict group", () => {
    const p = plan(profiles, { pci: [{ class: "0300", vendor: "1234", device: "1111" }], virt: "kvm" });
    expect(p.selections.map(s => s.profile.name)).toEqual(["qemu"]);
    const two = plan(profiles, { pci: [gpu("8086", "1"), gpu("8086", "2")], virt: "none" });
    expect(two.packages).toEqual(["mesa", "vulkan-intel", "intel-media-driver"]);
  });
});

describe("kernel variants", () => {
  test("fragment lines follow the linux-cachyos option table", () => {
    const server = renderFragment(variants.server!.options).lines;
    expect(server).toContain("CONFIG_HZ_300=y");
    expect(server).toContain("# CONFIG_HZ_1000 is not set");
    expect(server).toContain("CONFIG_HZ=300");
    expect(server).toContain("CONFIG_PREEMPT_LAZY=y");
    expect(server).toContain("# CONFIG_PREEMPT is not set");
    expect(server).toContain("CONFIG_TRANSPARENT_HUGEPAGE_MADVISE=y");
  });
  test("options absent from linux 7.2.11 Kconfig need the CachyOS patch set", () => {
    expect(() => renderFragment({ cpusched: "bore" })).toThrow(/CachyOS patch set/);
    expect(() => renderFragment({ isaLevel: 3 })).toThrow();
    expect(renderFragment({ cpusched: "bore", isaLevel: 3, cachyosPatches: true }).lines).toEqual([
      "CONFIG_SCHED_BORE=y",
      "CONFIG_GENERIC_CPU=y",
      "# CONFIG_X86_NATIVE_CPU is not set",
      "CONFIG_X86_64_VERSION=3",
    ]);
  });
  test("committed variant files are the generated ones", () => {
    for (const name of Object.keys(variants)) {
      const file = join(here, "..", "kernel", "linux-bun", "variants", `${name}.config`);
      expect(readFileSync(file, "utf8")).toBe(renderVariant(name));
    }
  });
  test("every variant line is accepted by check-config.sh's grammar", () => {
    for (const name of Object.keys(variants))
      for (const line of renderVariant(name)
        .split("\n")
        .filter(l => l && !l.startsWith("# SPDX") && !/^# [^C]/.test(l)))
        expect(line).toMatch(/^(CONFIG_[A-Z0-9_]+=.+|# CONFIG_[A-Z0-9_]+ is not set)$/);
  });
});

describe("cosmic-config", () => {
  test("names are sanitized", () => {
    expect(() => sanitize("../x")).toThrow();
    expect(() => sanitize("a/b")).toThrow();
    expect(sanitize("com.system76.CosmicComp")).toBe("com.system76.CosmicComp");
  });
  test("user, previous-version user, then system default of the current version only", async () => {
    const user = tmp();
    const sys = tmp();
    const dirs = { userDir: user, systemDirs: [sys] };
    const put = (root: string, v: number, key: string, value: string) => {
      mkdirSync(join(root, "com.example.App", `v${v}`), { recursive: true });
      writeFileSync(join(root, "com.example.App", `v${v}`, key), value);
    };
    put(sys, 2, "k", "sys2");
    put(sys, 1, "only1", "sys1");
    expect((await resolveKey(dirs, "com.example.App", 2, "k"))?.source).toBe("system");
    expect(await resolveKey(dirs, "com.example.App", 2, "only1")).toBeUndefined();
    put(user, 1, "k", "old");
    expect(await resolveKey(dirs, "com.example.App", 2, "k")).toMatchObject({ value: "old", source: "user-previous" });
    put(user, 2, "k", "new");
    expect(await resolveKey(dirs, "com.example.App", 2, "k")).toMatchObject({ value: "new", source: "user" });
  });
  test("shipped defaults install as one file per key", async () => {
    const out = tmp();
    const files = await installDefaults(join(here, "cosmic", "defaults"), out);
    expect(files).toContain("com.system76.CosmicTheme.Mode/v1/is_dark");
    expect(readFileSync(join(out, "com.system76.CosmicTheme.Mode", "v1", "is_dark"), "utf8")).toBe("true");
    const favorites = readFileSync(join(out, "com.system76.CosmicAppList", "v1", "favorites"), "utf8");
    expect(JSON.parse(favorites)).toContain("com.system76.CosmicFiles");
    expect(JSON.parse(favorites)).not.toContain("firefox");
  });
});

describe("themes", () => {
  const colors = { accent: "#fbf0df", background: "#14151a", mode: "dark" };
  test("tokens", () => {
    expect(render("{{ accent }} {{ accent_strip }} {{ accent_rgb }} {{ nope }}", colors)).toBe(
      "#fbf0df fbf0df 251,240,223 {{ nope }}",
    );
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(render("{{ mix accent #000000 50% }}", colors)).toBe(mix("#fbf0df", "#000000", 50));
    expect(render("{{ mix_strip background accent 0% }}", colors)).toBe("14151a");
  });
  test("renderTheme: theme files win over templates, outputs carry the colours", async () => {
    const out = tmp();
    const r = await renderTheme({
      themesDir: join(here, "themes"),
      name: "BunOS",
      templates: join(here, "themed"),
      out,
    });
    expect(r.files).toEqual(["colors.env", "colors.toml", "cosmic-accent.ron"]);
    const env = readFileSync(join(out, "colors.env"), "utf8");
    expect(env).toContain("BUNOS_ACCENT=fbf0df");
    expect(env).toContain("BUNOS_ACCENT_RGB=251,240,223");
    expect(readFileSync(join(out, "cosmic-accent.ron"), "utf8")).toContain('base: "#fbf0dfFF"');
    expect(parseColors(readFileSync(join(here, "themes", "bunos", "colors.toml"), "utf8")).mode).toBe("dark");
  });
  test("theme names cannot escape", async () => {
    await expect(renderTheme({ themesDir: here, name: "../x", templates: here, out: tmp() })).rejects.toThrow();
  });
});

describe("layers and hooks", () => {
  test("refreshConfig creates, leaves identical files, backs up changed ones", async () => {
    const pkg = tmp();
    const user = tmp();
    writeFileSync(join(pkg, "a.conf"), "one");
    expect((await refreshConfig({ packageDir: pkg, userDir: user, rel: "a.conf" })).action).toBe("created");
    expect((await refreshConfig({ packageDir: pkg, userDir: user, rel: "a.conf" })).action).toBe("unchanged");
    writeFileSync(join(user, "a.conf"), "mine");
    const r = await refreshConfig({ packageDir: pkg, userDir: user, rel: "a.conf", epoch: 42 });
    expect(r.action).toBe("replaced");
    expect(readFileSync(join(user, "a.conf.bak.42"), "utf8")).toBe("mine");
    expect(readFileSync(join(user, "a.conf"), "utf8")).toBe("one");
    await expect(refreshConfig({ packageDir: pkg, userDir: user, rel: "../x" })).rejects.toThrow();
  });
  test("hooks: main file then sorted .d files, skip .sample, failures do not abort", async () => {
    const hooks = tmp();
    mkdirSync(join(hooks, "post-update.d"));
    for (const f of [
      "post-update",
      "post-update.d/20-b",
      "post-update.d/10-a",
      "post-update.d/30.sample",
      "post-update.d/40-fail",
    ])
      writeFileSync(join(hooks, f), "");
    const order: string[] = [];
    const r = await runHook(
      hooks,
      "post-update",
      ["x"],
      async f => (order.push(f.slice(hooks.length + 1).replaceAll("\\", "/")), f.endsWith("40-fail") ? 1 : 0),
    );
    expect(order).toEqual(["post-update", "post-update.d/10-a", "post-update.d/20-b", "post-update.d/40-fail"]);
    expect(r.failed.length).toBe(1);
    await expect(runHook(hooks, "../x")).rejects.toThrow();
  });
});

describe("overlay", () => {
  test("files exist and carry the adopted values", () => {
    const root = join(here, "overlay");
    const sysctl = readFileSync(join(root, "usr/lib/sysctl.d/70-bunos-settings.conf"), "utf8");
    expect(sysctl).toContain("vm.swappiness = 100");
    expect(sysctl).not.toMatch(/unprivileged_userns_clone\s*=/);
    expect(readFileSync(join(root, "usr/lib/udev/rules.d/60-ioschedulers.rules"), "utf8")).toContain(
      'KERNEL=="nvme[0-9]*"',
    );
    expect(readFileSync(join(root, "usr/lib/systemd/system/bunos-scx.service"), "utf8")).toContain(
      "ConditionPathIsDirectory=/sys/kernel/sched_ext",
    );
    expect(existsSync(join(root, "etc/default/bunos-scx"))).toBe(true);
    expect(readdirSync(join(root, "usr/lib")).sort()).toEqual(["sysctl.d", "systemd", "tmpfiles.d", "udev"]);
  });
});
