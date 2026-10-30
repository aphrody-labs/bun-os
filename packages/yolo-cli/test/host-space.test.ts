import { describe, expect, it } from "bun:test";
import { estimateReclaim, parseDfSizeAvail, parseFindLinks, spaceGate, type LinkRecord } from "../src/host-space";

const link = (ino: number, nlink: number, blocks: number, dev = "2049"): LinkRecord => ({
  dev,
  ino: String(ino),
  nlink,
  blocks,
});

const transport = (find: string, dfOutput: string) => ({
  host: "local" as const,
  remote: false,
  async exec(cmd: string) {
    if (cmd.includes("-printf '%y'")) return { code: 0, stdout: "d", stderr: "" };
    if (cmd.includes("%D %i")) return { code: 0, stdout: find, stderr: "" };
    return { code: 0, stdout: dfOutput, stderr: "" };
  },
  async service() {
    return { code: 1, stdout: "", stderr: "unused" };
  },
  async tune() {
    return { code: 1, stdout: "", stderr: "unused" };
  },
});
const dfText = (total: number, avail: number) => `1B-blocks Avail\n${total} ${avail}\n`;
const df = (total: number, avail: number) => `1B-blocks Avail\n${total} ${avail}\n`;
const run = async (cmd: string): Promise<string> => await Bun.$`sh -c ${cmd}`.quiet().text();
const key = (r: { dev: string; ino: string; nlink: number; blocks: number }): string =>
  `${r.dev}:${r.ino}:${r.nlink}:${r.blocks}`;

describe("estimateReclaim", () => {
  it("frees everything when no file has another link", () => {
    const e = estimateReclaim([link(1, 1, 8), link(2, 1, 16)]);
    expect(e).toEqual({
      naiveBytes: 24 * 512,
      uniqueBytes: 24 * 512,
      freedBytes: 24 * 512,
      keptBytes: 0,
      inodes: 2,
    });
  });

  it("frees nothing when the other link lives outside the set", () => {
    // /home/ubuntu/demoapp/.../file is hard-linked to /home/ubuntu/apps/demoapp/shared/.../file; only the home copy is deleted
    const e = estimateReclaim([link(10, 2, 1_000_000)]);
    expect(e.naiveBytes).toBe(1_000_000 * 512);
    expect(e.freedBytes).toBe(0);
    expect(e.keptBytes).toBe(1_000_000 * 512);
  });

  it("frees the blocks once when both links are deleted, and a naive sum counts them twice", () => {
    const e = estimateReclaim([link(10, 2, 1_000_000), link(10, 2, 1_000_000)]);
    expect(e.naiveBytes).toBe(2 * 1_000_000 * 512);
    expect(e.uniqueBytes).toBe(1_000_000 * 512);
    expect(e.freedBytes).toBe(1_000_000 * 512);
  });

  it("keeps inodes of different devices apart", () => {
    const e = estimateReclaim([link(5, 1, 8, "1"), link(5, 1, 8, "2")]);
    expect(e.inodes).toBe(2);
    expect(e.freedBytes).toBe(16 * 512);
  });

  it("satisfies freed <= unique <= naive on random sets (seeded)", () => {
    let seed = 0x9e3779b9;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let round = 0; round < 300; round++) {
      // build files with nlink total links, then pick a random subset of links as the deletion set
      const records: LinkRecord[] = [];
      const files = 1 + rnd(40);
      let expectedFreed = 0;
      for (let f = 0; f < files; f++) {
        const nlink = 1 + rnd(4);
        const blocks = rnd(5000);
        const inside = rnd(nlink + 1); // 0..nlink links inside the set
        for (let i = 0; i < inside; i++) records.push(link(f, nlink, blocks));
        if (inside === nlink) expectedFreed += blocks * 512;
      }
      const e = estimateReclaim(records);
      expect(e.freedBytes).toBe(expectedFreed);
      expect(e.freedBytes).toBeLessThanOrEqual(e.uniqueBytes);
      expect(e.uniqueBytes).toBeLessThanOrEqual(e.naiveBytes);
      expect(e.keptBytes).toBe(e.uniqueBytes - e.freedBytes);
    }
  });
});

describe("parseFindLinks", () => {
  it("parses find -printf '%D %i %n %b' lines and ignores noise", () => {
    expect(parseFindLinks("2049 123 2 8\nfind: warning\n2049 124 1 16\n\n")).toEqual([
      { dev: "2049", ino: "123", nlink: 2, blocks: 8 },
      { dev: "2049", ino: "124", nlink: 1, blocks: 16 },
    ]);
  });
});

describe("spaceGate", () => {
  const GIB = 1024 ** 3;
  it("accepts exactly the floor and refuses one byte below", () => {
    expect(spaceGate(100, 50, 0.5).ok).toBe(true);
    const below = spaceGate(100, 49, 0.5);
    expect(below.ok).toBe(false);
    expect(below.shortfallBytes).toBe(1);
  });

  it("reports the shortfall of the vps before the cleanup (192 GiB used of 290 GiB, floor 50 %)", () => {
    const g = spaceGate(290 * GIB, 98.6 * GIB, 0.5);
    expect(g.ok).toBe(false);
    expect(g.shortfallBytes / GIB).toBeCloseTo(46.4, 1);
  });

  it("rounds the requirement up and rejects invalid input", () => {
    expect(spaceGate(3, 1, 0.5).requiredFreeBytes).toBe(2);
    expect(() => spaceGate(0, 0, 0.5)).toThrow();
    expect(() => spaceGate(10, 5, 1.5)).toThrow();
  });
});

describe("parseDfSizeAvail", () => {
  it("reads the size and avail columns", () => {
    expect(parseDfSizeAvail("     1B-blocks         Avail\n 311385612288  107270053888\n")).toEqual({
      totalBytes: 311385612288,
      freeBytes: 107270053888,
    });
    expect(() => parseDfSizeAvail("nothing")).toThrow();
  });
});

describe("yolo host space", () => {
  const { runHostCommand } = require("../src/host") as typeof import("../src/host");
  const root = new URL("..", import.meta.url).pathname;
  const GIB = 1024 ** 3;

  it("predicts the floor from the really freed bytes and exits 3 when it is not reached", async () => {
    let printed = "";
    // 30 GiB shared with a live copy (nlink 2, one name inside) + 5 GiB of own files
    const find = `2049 1 2 ${(30 * GIB) / 512}\n2049 2 1 ${(5 * GIB) / 512}\n`;
    const code = await runHostCommand(
      ["space", "/home/ubuntu/apps/old", "--host", "local", "--min-free", "50%", "--depth", "0", "--json"],
      root,
      {
        transport: transport(find, dfText(290 * GIB, 100 * GIB)),
        out: s => (printed += s),
      },
    );
    const r = JSON.parse(printed);
    expect(r.estimate.freedBytes).toBe(5 * GIB);
    expect(r.estimate.keptBytes).toBe(30 * GIB);
    expect(r.after.ok).toBe(false);
    expect(code).toBe(3);
  });

  it("exits 0 once the floor is reached", async () => {
    const find = `2049 2 1 ${(60 * GIB) / 512}\n`;
    const code = await runHostCommand(
      ["space", "/home/ubuntu/apps/old", "--host", "local", "--min-free", "50%", "--depth", "0", "--json"],
      root,
      {
        transport: transport(find, dfText(290 * GIB, 100 * GIB)),
        out: () => {},
      },
    );
    expect(code).toBe(0);
  });
});

describe("ship disk gate", () => {
  const { diskDecision, diskProbeCommand } = require("../src/host-space") as typeof import("../src/host-space");
  const GIB = 1024 ** 3;

  it("accepts at the floor and refuses below it, with the shortfall in GiB", () => {
    expect(diskDecision(df(290 * GIB, 145 * GIB), 0.5).ok).toBe(true);
    const d = diskDecision(df(290 * GIB, Math.round(98.6 * GIB)), 0.5);
    expect(d.ok).toBe(false);
    expect(d.message).toContain("34.0 % free");
    expect(d.message).toContain("50 % floor");
    expect(d.message).toContain("47 GiB");
  });

  it("refuses when the probe is unreadable instead of assuming free space", () => {
    expect(diskDecision(null).ok).toBe(false);
    expect(diskDecision("garbage").ok).toBe(false);
  });

  it("probes the nearest existing parent of a path that does not exist (run for real)", async () => {
    const cmd = diskProbeCommand("/tmp/yolo-space-nope/a/b/c");
    const out = await Bun.$`sh -c ${cmd}`.text();
    const parsed = require("../src/host-space").parseDfSizeAvail(out);
    expect(parsed.totalBytes).toBeGreaterThan(0);
    expect(diskDecision(out, 0).ok).toBe(true);
  });

  it("quotes hostile paths", () => {
    expect(diskProbeCommand("/x'; rm -rf / #")).toContain(`'/x'\\''; rm -rf / #'`);
  });
});

describe("variable floor", () => {
  const { DEFAULT_MIN_FREE, parseRatio, resolveMinFree } =
    require("../src/host-space") as typeof import("../src/host-space");

  it("reads ratios and percentages and rejects the rest", () => {
    expect(parseRatio("0.3")).toBe(0.3);
    expect(parseRatio("30%")).toBeCloseTo(0.3);
    expect(parseRatio("30")).toBeCloseTo(0.3);
    expect(parseRatio(0.25)).toBe(0.25);
    expect(parseRatio("150")).toBeNull();
    expect(parseRatio("-1")).toBeNull();
    expect(parseRatio("abc")).toBeNull();
    expect(parseRatio("")).toBeNull();
  });

  it("takes the flag, then the environment, then the policy, then the default", () => {
    expect(resolveMinFree({ flag: "0.1", env: "0.3", policy: 0.4 })).toBe(0.1);
    expect(resolveMinFree({ env: "30%", policy: 0.4 })).toBeCloseTo(0.3);
    expect(resolveMinFree({ policy: 0.4 })).toBe(0.4);
    expect(resolveMinFree({})).toBe(DEFAULT_MIN_FREE);
    expect(resolveMinFree({ flag: "", env: undefined, policy: 0 })).toBe(0);
  });

  it("fails loudly on an invalid value instead of falling through to a laxer source", () => {
    expect(() => resolveMinFree({ flag: "lots", policy: 0.4 })).toThrow(/--min-free/);
    expect(() => resolveMinFree({ env: "200%" })).toThrow(/YOLO_MIN_FREE/);
  });

  it("is read from host-policy.toml per host", () => {
    const { parsePolicy } = require("../src/host-safety") as typeof import("../src/host-safety");
    const toml = `[space]\nmin_free = 0.3\nparallel = 4\n[hosts.vps.space]\nmin_free = 0.5\nsplit_depth = 3\n`;
    expect(parsePolicy(toml, "dbfr").space).toEqual({
      minFree: 0.3,
      parallel: 4,
      splitDepth: 2,
    });
    expect(parsePolicy(toml, "vps").space).toEqual({
      minFree: 0.5,
      parallel: 4,
      splitDepth: 3,
    });
    expect(parsePolicy("[space]\nmin_free = 7\n", "vps").space.minFree).toBe(0.2);
  });
});

describe("limiter", () => {
  const { limiter } = require("../src/host-space") as typeof import("../src/host-space");

  it("never runs more than the limit at once, keeps every result and runs all tasks", async () => {
    await Promise.all(
      [1, 3, 8].map(async limit => {
        const gate = limiter(limit);
        let active = 0;
        let peak = 0;
        const results = await Promise.all(
          Array.from({ length: 50 }, (_, i) =>
            gate(async () => {
              active++;
              peak = Math.max(peak, active);
              await Bun.sleep(1 + (i % 3));
              active--;
              return i;
            }),
          ),
        );
        expect(results).toEqual(Array.from({ length: 50 }, (_, i) => i));
        expect(peak).toBeLessThanOrEqual(limit);
        expect(peak).toBe(Math.min(limit, 50));
      }),
    );
  });

  it("releases the slot when a task throws", async () => {
    const gate = limiter(1);
    await expect(gate(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await gate(async () => "next")).toBe("next");
  });
});

describe("scanLinks", () => {
  const { scanLinks } = require("../src/host-space") as typeof import("../src/host-space");
  const { mkdtempSync, mkdirSync, writeFileSync, linkSync, symlinkSync, rmSync } =
    require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");

  it("returns the same multiset of links as one find, whatever depth and parallelism", async () => {
    const root = mkdtempSync(join(tmpdir(), "scan-"));
    try {
      // 6 dirs, 3 levels, loose files at every level, hard links across sibling subtrees, a symlink, a name with a quote
      for (const d of ["a", "a/x", "a/x/y", "b", "b/z", "c"]) mkdirSync(join(root, d), { recursive: true });
      let n = 0;
      const file = (rel: string, size: number): string => {
        const p = join(root, rel);
        writeFileSync(p, Buffer.alloc(size, ++n));
        return p;
      };
      const shared = file("a/x/y/shared", 9000);
      linkSync(shared, join(root, "b/z/shared-link"));
      linkSync(shared, join(root, "c/shared-link2"));
      file("a/loose1", 5000);
      file("a/x/loose2", 1);
      file("b/it's", 4096);
      file("top", 70000);
      symlinkSync(shared, join(root, "c/sym"));
      const reference = parseFindLinks(await run(`find '${root}' -xdev -type f -printf '%D %i %n %b\\n'`));
      const want = reference.map(key).toSorted();
      for (const depth of [0, 1, 2, 5]) {
        for (const parallel of [1, 4]) {
          // oxlint-disable-next-line no-await-in-loop -- scans find réels sur disque : séquentiels pour rester dans le délai du test et mesurer chaque combinaison isolément
          const got = await scanLinks([root], {
            run,
            depth,
            parallel,
            batch: 2,
          });
          expect(got.map(key).toSorted()).toEqual(want);
          expect(estimateReclaim(got)).toEqual(estimateReclaim(reference));
        }
      }
      // a file as the root, and a path that does not exist
      expect((await scanLinks([join(root, "top")], { run, depth: 2, parallel: 2 })).length).toBe(1);
      expect(await scanLinks([join(root, "nope")], { run, depth: 2, parallel: 2 })).toEqual([]);
      // hard-link semantics through the split: deleting only a/ keeps the shared inode alive
      const onlyA = estimateReclaim(await scanLinks([join(root, "a")], { run, depth: 3, parallel: 4 }));
      expect(onlyA.keptBytes).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("issues commands concurrently up to the limit", async () => {
    let active = 0;
    let peak = 0;
    const fake = async (cmd: string): Promise<string> => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active--;
      if (cmd.includes("-maxdepth 0 -printf '%y'")) return "d";
      if (cmd.includes("-mindepth 1")) return "d\t/r/a\nd\t/r/b\nd\t/r/c\nd\t/r/d\n";
      return "";
    };
    await scanLinks(["/r"], { run: fake, depth: 2, parallel: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});
