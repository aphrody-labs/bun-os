// SPDX-License-Identifier: 0BSD
/**
 * linux-bun kernel variants, after CachyOS/linux-cachyos (master 523baf9cc1e3, 2026-10-23; PKGBUILD options
 * _HZ_ticks, _tickrate, _preempt, _hugepage, _cpusched, _processor_opt, _cc_harder, _tcp_bbr3, _use_llvm_lto).
 * CachyOS applies them with scripts/config; here each option becomes lines of a config fragment in the format
 * check-config.sh already enforces (`CONFIG_X=y` / `# CONFIG_X is not set`), merged over Arch's config.
 *
 * Two tiers, because linux-bun builds Arch's source (linux 7.2.11 + Arch patch), not CachyOS's tree:
 *   - "mainline": the symbols exist in the pinned 7.2.11 Kconfig (kernel/Kconfig.hz, kernel/Kconfig.preempt,
 *     mm/Kconfig; checked by extracting those files from linux-7.2.11.tar.xz on 2026-10-29).
 *   - "cachyos-patch": SCHED_BORE, X86_64_VERSION and CC_OPTIMIZE_FOR_PERFORMANCE_O3 are NOT in the 7.2.11
 *     Kconfig files (same extraction); they come from CachyOS's patch set. They are rejected unless the build
 *     applies those patches, which linux-bun does not yet do.
 * No variant has been built or booted (Phase 0 gate, docs/KERNEL-ROADMAP.md).
 */
export interface KernelOptions {
  /** CONFIG_HZ: mainline offers 100, 250, 300, 1000. */
  hz?: 100 | 250 | 300 | 1000;
  /** NO_HZ mode: CachyOS _tickrate. */
  tickrate?: "periodic" | "idle" | "full";
  /** CachyOS _preempt: full = PREEMPT, lazy = PREEMPT_LAZY. */
  preempt?: "full" | "lazy";
  /** CachyOS _hugepage. */
  hugepage?: "always" | "madvise";
  /** Needs the CachyOS patch set. */
  cpusched?: "eevdf" | "bore";
  /** Needs the CachyOS patch set (X86_64_VERSION). */
  isaLevel?: 1 | 2 | 3 | 4;
  /** Needs the CachyOS patch set (CC_OPTIMIZE_FOR_PERFORMANCE_O3). */
  o3?: boolean;
  /** Build is patched with CachyOS's kernel-patches; unlocks the "cachyos-patch" options. */
  cachyosPatches?: boolean;
}

export interface Fragment {
  lines: string[];
  tiers: Record<string, "mainline" | "cachyos-patch">;
}

const on = (sym: string) => `CONFIG_${sym}=y`;
const off = (sym: string) => `# CONFIG_${sym} is not set`;

export function renderFragment(o: KernelOptions): Fragment {
  const lines: string[] = [];
  const tiers: Fragment["tiers"] = {};
  const need = (option: string) => {
    tiers[option] = "cachyos-patch";
    if (!o.cachyosPatches)
      throw new Error(`${option} needs the CachyOS patch set (cachyosPatches), absent from linux 7.2.11 Kconfig`);
  };
  if (o.hz !== undefined) {
    tiers.hz = "mainline";
    for (const hz of [100, 250, 300, 1000]) lines.push(hz === o.hz ? on(`HZ_${hz}`) : off(`HZ_${hz}`));
    lines.push(`CONFIG_HZ=${o.hz}`);
  }
  if (o.tickrate) {
    tiers.tickrate = "mainline";
    // linux-cachyos PKGBUILD: full = NO_HZ_FULL (+ NO_HZ, NO_HZ_COMMON), idle = NO_HZ_IDLE, periodic = HZ_PERIODIC.
    if (o.tickrate === "full")
      lines.push(off("HZ_PERIODIC"), off("NO_HZ_IDLE"), on("NO_HZ_FULL"), on("NO_HZ"), on("NO_HZ_COMMON"));
    else if (o.tickrate === "idle")
      lines.push(off("HZ_PERIODIC"), off("NO_HZ_FULL"), on("NO_HZ_IDLE"), on("NO_HZ"), on("NO_HZ_COMMON"));
    else lines.push(on("HZ_PERIODIC"), off("NO_HZ_IDLE"), off("NO_HZ_FULL"), off("NO_HZ"), off("NO_HZ_COMMON"));
  }
  if (o.preempt) {
    tiers.preempt = "mainline";
    lines.push(...(o.preempt === "full" ? [on("PREEMPT"), off("PREEMPT_LAZY")] : [off("PREEMPT"), on("PREEMPT_LAZY")]));
  }
  if (o.hugepage) {
    tiers.hugepage = "mainline";
    const always = o.hugepage === "always";
    lines.push(
      always ? off("TRANSPARENT_HUGEPAGE_MADVISE") : on("TRANSPARENT_HUGEPAGE_MADVISE"),
      always ? on("TRANSPARENT_HUGEPAGE_ALWAYS") : off("TRANSPARENT_HUGEPAGE_ALWAYS"),
    );
  }
  if (o.cpusched === "bore") {
    need("cpusched=bore");
    lines.push(on("SCHED_BORE"));
  } else if (o.cpusched === "eevdf") tiers.cpusched = "mainline"; // stock scheduler: nothing to set
  if (o.isaLevel !== undefined) {
    need("isaLevel");
    lines.push(on("GENERIC_CPU"), off("X86_NATIVE_CPU"), `CONFIG_X86_64_VERSION=${o.isaLevel}`);
  }
  if (o.o3) {
    need("o3");
    lines.push(off("CC_OPTIMIZE_FOR_PERFORMANCE"), on("CC_OPTIMIZE_FOR_PERFORMANCE_O3"));
  }
  return { lines, tiers };
}

/** Named variants. `desktop` is Arch's own tick/preempt/THP defaults pinned; `server` is the delta CachyOS ships for servers. */
export const variants: Record<string, { summary: string; options: KernelOptions }> = {
  desktop: {
    summary: "HZ=1000, full NO_HZ, full preemption, THP always (Arch config values, pinned against drift)",
    options: { hz: 1000, tickrate: "full", preempt: "full", hugepage: "always" },
  },
  server: {
    summary:
      "HZ=300, full NO_HZ, lazy preemption, THP madvise (linux-cachyos-server defaults: _HZ_ticks=300, _preempt=lazy, _hugepage=madvise)",
    options: { hz: 300, tickrate: "full", preempt: "lazy", hugepage: "madvise" },
  },
};

export function renderVariant(name: string): string {
  const v = variants[name];
  if (!v) throw new Error(`unknown kernel variant ${name}; known: ${Object.keys(variants).join(", ")}`);
  const { lines } = renderFragment(v.options);
  return [
    "# SPDX-License-Identifier: 0BSD",
    `# linux-bun variant "${name}": ${v.summary}.`,
    "# Generated by `bun factory/distro/cli.ts kernel fragment " +
      name +
      "`; merge after aphrody-bun.config and check with check-config.sh.",
    "# Not built or booted; values follow linux-cachyos 523baf9cc1e3 (_HZ_ticks/_tickrate/_preempt/_hugepage).",
    ...lines,
    "",
  ].join("\n");
}
