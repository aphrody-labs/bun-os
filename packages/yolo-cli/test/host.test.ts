import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshServiceArgs, splitExitSentinel, withExitSentinel } from "../src/aphrody";
import {
  analyze,
  buildAudit,
  classifyDisks,
  fmtBytes,
  isBuildProcess,
  mergeInodes,
  parseArtifacts,
  parseDf,
  parseDockerDf,
  parseJournalUsage,
  parseLocks,
  parseLsblk,
  parseMeminfo,
  parseMetrics,
  parsePs,
  parseSections,
  parseSize,
  parseSs,
  parseSwapFiles,
  parseSwapon,
  parseTimers,
  parseUnits,
  parseZramctl,
  summarizeProcs,
  type Audit,
} from "../src/host-parse";
import {
  DEFAULT_POLICY,
  assertSafeCommand,
  canDeleteBuildArtifact,
  canDeleteCacheDir,
  canRemoveSource,
  canStopUnit,
  classifyService,
  isDatabasePath,
  keptCacheReason,
  normalizePath,
  parsePolicy,
  pathInUse,
  protectedReason,
  removalRefusals,
} from "../src/host-safety";
import {
  LocalTransport,
  type ExecResult,
  type Plan,
  type RunContext,
  type Transport,
  appendJournal,
  archiveLabel,
  asRoot,
  collectorScript,
  executePlan,
  hostCurlCommand,
  journalPath,
  mbit,
  median,
  parseCurlStats,
  parseFlags,
  planArchive,
  planMount,
  planNet,
  planReclaim,
  planServices,
  planTune,
  readJournal,
  readOnlyOptions,
  reclaimCandidates,
  renderPlan,
  runHostCommand,
  satisfies,
  sq,
  suggestedSwapBytes,
  wrapScript,
} from "../src/host";

// ------------------------------------------------------------------------------------------ fixtures

const LSBLK = JSON.stringify({
  blockdevices: [
    {
      name: "loop1",
      kname: "loop1",
      path: "/dev/loop1",
      type: "loop",
      size: 4096,
      fstype: "squashfs",
      fsused: 131072,
      fsavail: 0,
      mountpoints: ["/snap/bare/5"],
      label: null,
      uuid: null,
      ro: true,
      rm: false,
      rota: false,
      pkname: null,
      model: null,
    },
    {
      name: "sda",
      kname: "sda",
      path: "/dev/sda",
      type: "disk",
      size: 322122547200,
      fstype: null,
      fsused: null,
      fsavail: null,
      mountpoints: [null],
      label: null,
      uuid: null,
      ro: false,
      rm: false,
      rota: true,
      pkname: null,
      model: "QEMU",
      children: [
        {
          name: "sda1",
          kname: "sda1",
          path: "/dev/sda1",
          type: "part",
          size: 320000000000,
          fstype: "ext4",
          fsused: 232000000000,
          fsavail: 80000000000,
          mountpoints: ["/"],
          label: "cloudimg-rootfs",
          uuid: "c52b9a99",
          ro: false,
          rm: false,
          rota: true,
          pkname: "sda",
          model: null,
        },
        {
          name: "sda15",
          kname: "sda15",
          path: "/dev/sda15",
          type: "part",
          size: 110000000,
          fstype: "vfat",
          fsused: 6000000,
          fsavail: 100000000,
          mountpoints: ["/boot/efi"],
          label: "UEFI",
          uuid: "A0A3-9E36",
          ro: false,
          rm: false,
          rota: true,
          pkname: "sda",
          model: null,
        },
      ],
    },
    {
      name: "sdb",
      kname: "sdb",
      path: "/dev/sdb",
      type: "disk",
      size: 327680000000,
      fstype: null,
      fsused: null,
      fsavail: null,
      mountpoints: [null],
      label: null,
      uuid: null,
      ro: false,
      rm: false,
      rota: true,
      pkname: null,
      model: "QEMU",
      children: [
        {
          name: "sdb1",
          kname: "sdb1",
          path: "/dev/sdb1",
          type: "part",
          size: 213000000000,
          fstype: "ext4",
          fsused: 195000000000,
          fsavail: 11000000000,
          mountpoints: ["/mnt/backup"],
          label: "Backup",
          uuid: "d2e2957f",
          ro: false,
          rm: false,
          rota: true,
          pkname: "sdb",
          model: null,
        },
        {
          name: "sdb13",
          kname: "sdb13",
          path: "/dev/sdb13",
          type: "part",
          size: 1072693248,
          fstype: "ext4",
          fsused: null,
          fsavail: null,
          mountpoints: [null],
          label: "Backup",
          uuid: "86732b24",
          ro: false,
          rm: false,
          rota: true,
          pkname: "sdb",
          model: null,
        },
        {
          name: "sdb14",
          kname: "sdb14",
          path: "/dev/sdb14",
          type: "part",
          size: 4194304,
          fstype: null,
          fsused: null,
          fsavail: null,
          mountpoints: [null],
          label: null,
          uuid: null,
          ro: false,
          rm: false,
          rota: true,
          pkname: "sdb",
          model: null,
        },
      ],
    },
    {
      name: "sdc",
      kname: "sdc",
      path: "/dev/sdc",
      type: "disk",
      size: 107374182400,
      fstype: null,
      fsused: null,
      fsavail: null,
      mountpoints: [null],
      label: null,
      uuid: null,
      ro: false,
      rm: false,
      rota: true,
      pkname: null,
      model: "QEMU",
      children: [],
    },
    {
      name: "sdd",
      kname: "sdd",
      path: "/dev/sdd",
      type: "disk",
      size: 8589934592,
      fstype: "ext4",
      fsused: null,
      fsavail: null,
      mountpoints: [null],
      label: "old",
      uuid: "11111111",
      ro: false,
      rm: false,
      rota: false,
      pkname: null,
      model: "VIRTUAL",
    },
    {
      name: "zram0",
      kname: "zram0",
      path: "/dev/zram0",
      type: "disk",
      size: 17179869184,
      fstype: "swap",
      fsused: null,
      fsavail: null,
      mountpoints: ["[SWAP]"],
      label: "zram0",
      uuid: "edd9",
      ro: false,
      rm: false,
      rota: false,
      pkname: null,
      model: null,
    },
  ],
});

const DF = `Filesystem     Type      1-blocks         Used   Available Capacity Mounted on
tmpfs          tmpfs   4931997696    198631424  4733366272       5% /run
/dev/sda1      ext4  311227166720 230402682880 80807706624      75% /
/dev/sdb1      ext4  207000000000 195000000000 11000000000      95% /mnt/backup
/dev/sda15     vfat     109000000      6000000   100000000       6% /boot/efi
drvfs          9p     12345678901   1234567890  1111111111      91% /mnt/c data`;

const DFI = `Filesystem       Inodes   IUsed    IFree IUse% Mounted on
tmpfs           3000000     900  2999100    1% /run
/dev/sda1      19660800 1400000 18260800    8% /
/dev/sdb1      12000000 10500000 1500000   88% /mnt/backup
/dev/sda15            0       0        0     - /boot/efi
drvfs                 0       0        0     - /mnt/c data`;

const PS = `      1       0 14236  0.5 4990303 Ss   root                             /usr/lib/systemd/systemd --system --deserialize=137
      2       0     0  0.0 4990303 S    root                             [kthreadd]
      3       2     0  0.0 4990303 I<   root                             [pool_workqueue_release]
    900       1 2048  0.0     120 Z    ubuntu                           [defunct-child] <defunct>
   2000       1 620000 1.5 86400 Ssl  redis                            /usr/bin/redis-server 127.0.0.1:6379
   2100       1 65000  0.1 86400 S    root                             /usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock
   3000    2999 90000 99.0     300 R    ubuntu                           cargo build --release -p aphrody-tauri
   3001    3000 400000 98.0    299 R    ubuntu                           rustc --crate-name foo src/lib.rs
   3500       1 80000  0.2   4000 Sl   ubuntu                           /home/ubuntu/.cargo/bin/sccache
   4000    3999 30000  0.0     100 S    ubuntu                           bun run cli host audit`;

const PORTS = `udp   UNCONN 0      0           127.0.0.54:53       0.0.0.0:*    users:(("systemd-resolve",pid=500,fd=15))
udp   UNCONN 0      0        51.77.147.152%ens3:68  0.0.0.0:*
tcp   LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=800,fd=3),("sshd",pid=1,fd=3))
tcp   LISTEN 0      511            [::]:443         [::]:*       users:(("nginx",pid=900,fd=7))
tcp   LISTEN 0      4096       127.0.0.1:5432       0.0.0.0:*    users:(("postgres",pid=700,fd=5))`;

const COLLECTED = [
  "@@@ identity",
  "user=ubuntu",
  "uid=1000",
  "home=/home/ubuntu",
  "hostname=vps-203bea89",
  "kernel=7.0.0-28-generic",
  "os=Ubuntu 26.04.1 LTS",
  "uptime=4993337.5",
  "cpus=12",
  "loadavg=0.17 1.83 3.72 2/700 12345",
  "sudo=yes",
  "tool.zstd=yes",
  "tool.ionice=yes",
  "tool.rsync=yes",
  "tool.docker=yes",
  "@@@ meminfo",
  "MemTotal:       48128000 kB",
  "MemFree:         1000000 kB",
  "MemAvailable:   37900000 kB",
  "Cached:         30000000 kB",
  "SwapTotal:      25165820 kB",
  "SwapFree:       24400000 kB",
  "@@@ lsblk",
  LSBLK,
  "@@@ df",
  DF,
  "@@@ dfi",
  DFI,
  "@@@ mounts",
  "/ /dev/sda1 ext4 rw,relatime",
  "/mnt/backup /dev/sdb1 ext4 rw,relatime",
  "@@@ swapon",
  "/swapfile2 file 8589930496 0 10",
  "/dev/zram0 partition 17179865088 803655680 100",
  "@@@ zram",
  "/dev/zram0 17179869184 798000000 600000000 zstd",
  "@@@ services",
  "nginx.service loaded active running A high performance web server",
  "ssh.service loaded active running OpenBSD Secure Shell server",
  "snapd.service loaded active running Snap Daemon",
  "mystery.service loaded active running Something",
  "@@@ failed",
  "● aphrody-demoapp-build-20261003.service loaded failed failed Demo build",
  "@@@ timers",
  "Sun 2026-10-04 00:29:49 UTC 10h Sat 2026-10-03 00:34:42 UTC 13h ago logrotate.timer logrotate.service",
  "@@@ ports",
  PORTS,
  "@@@ ps",
  PS,
  "@@@ cwds",
  "3000 /home/ubuntu/src/aphrody",
  "3001 /home/ubuntu/src/aphrody",
  "3500 /",
  "@@@ docker",
  '{"Type":"Images","TotalCount":"5","Active":"3","Size":"2.2GB","Reclaimable":"1.8GB (81%)"}',
  '{"Type":"Containers","TotalCount":"3","Active":"0","Size":"212kB","Reclaimable":"212kB (100%)"}',
  '{"Type":"Build Cache","TotalCount":"0","Active":"0","Size":"0B","Reclaimable":"0B"}',
  "@@@ du",
  "132000000000\t/home",
  "129000000000\t/home/ubuntu",
  "61000000000\t/home/ubuntu/apps",
  "13000000000\t/home/ubuntu/apps/demoapp",
  "4400000000\t/var/lib",
  "2300000000\t/var/lib/postgresql",
  "@@@ cron",
  "e2scrub_all",
  "## user",
  "# comment",
  "0 3 * * * /usr/local/bin/backup",
  "@@@ locks",
  "/home/ubuntu/build/locks/heavy.lock|free|",
  "@@@ journal",
  "Archived and active journals take up 1.5G in the file system.",
  "@@@ apt",
  "314572800\t/var/cache/apt/archives",
  "@@@ rotlogs",
  "12 52428800",
  "@@@ artifacts",
  "900000000|cargo|old|/home/ubuntu/proj-old/target",
  "50000000|npm|old|/home/ubuntu/src/x/node_modules",
  "70000000|cargo|recent|/home/ubuntu/proj-new/target",
  "8000000|cargo|old|/home/other/proj/target",
  "6000000|cargo|old|/home/ubuntu/build/cache/target",
  "@@@ swapfiles",
  "4294967296|SWAPSPACE2|-|/swapfile.old",
  "8589934592|SWAPSPACE2|-|/swapfile2",
  "1073741824|SWAPSPACE2|fstab|/swapfile.fstab",
  "@@@ caches",
  "20971520|/home/ubuntu/.cache/pip",
  "",
].join("\n");

const audit = (over: string = COLLECTED): Audit => buildAudit("vps", over, "2026-10-03T00:00:00Z");

// ------------------------------------------------------------------------------------------- helpers

class FakeTransport implements Transport {
  readonly remote = true;
  readonly calls: string[] = [];
  readonly services: string[] = [];
  constructor(
    readonly host: "vps" | "dbfr" | "local",
    private readonly handler: (cmd: string) => ExecResult = () => ({
      code: 0,
      stdout: "",
      stderr: "",
    }),
  ) {}
  async exec(cmd: string): Promise<ExecResult> {
    this.calls.push(cmd);
    return this.handler(cmd);
  }
  async service(unit: string, action: string): Promise<ExecResult> {
    this.services.push(`${action} ${unit}`);
    return { code: 0, stdout: "", stderr: "" };
  }
  async tune(): Promise<ExecResult> {
    return { code: 0, stdout: "", stderr: "" };
  }
}

const tmpRoots: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "yolo-host-test-"));
  tmpRoots.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

const ctxFor = (
  root: string,
  transport: Transport,
  host: "vps" | "dbfr" | "local" = "local",
  lines: string[] = [],
): RunContext => ({
  host,
  command: "test",
  transport,
  local: new LocalTransport(),
  policy: DEFAULT_POLICY,
  yoloRoot: root,
  out: l => void lines.push(l),
});

// ---------------------------------------------------------------------------------------------- tests

// The build factory comes from the Aphrody config; tests must not depend on the host's own checkout
// (the build host has none at ~/aphrody), so they run against a fixture of the same shape.
const factoryRoot = mkdtempSync(join(tmpdir(), "yolo-factory-"));
const priorAphrodyRoot = process.env["YOLO_APHRODY_ROOT"];
// eager: some describe blocks compute their plans while the file is being collected
{
  mkdirSync(join(factoryRoot, "tools", "config"), { recursive: true });
  writeFileSync(
    join(factoryRoot, "tools/config/build-factory.json"),
    JSON.stringify({
      enabled: true,
      target: "vps",
      workspaceRoot: "/home/ubuntu/src/aphrody",
      cacheRoot: "/home/ubuntu/build/cache",
      artifactRoot: "/home/ubuntu/build/artifacts",
      lockPath: "/home/ubuntu/build/locks/heavy.lock",
    }),
  );
  process.env["YOLO_APHRODY_ROOT"] = factoryRoot;
}
afterAll(() => {
  if (priorAphrodyRoot === undefined) delete process.env["YOLO_APHRODY_ROOT"];
  else process.env["YOLO_APHRODY_ROOT"] = priorAphrodyRoot;
  rmSync(factoryRoot, { recursive: true, force: true });
});

describe("formatting and sections", () => {
  it("formats bytes and parses journald/docker sizes", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(1536)).toBe("1.5 KiB");
    expect(fmtBytes(80807706624)).toBe("75.3 GiB");
    expect(parseSize("1.5G")).toBe(1610612736);
    expect(parseSize("1.8GB (81%)")).toBe(1800000000);
    expect(parseSize("212kB")).toBe(212000);
    expect(parseSize("0B")).toBe(0);
    expect(parseSize("nonsense")).toBe(0);
    expect(parseJournalUsage("Archived and active journals take up 3.8G in the file system.")).toBe(parseSize("3.8G"));
  });

  it("splits collector output into sections", () => {
    const s = parseSections("@@@ a\none\ntwo\n@@@ b\nthree");
    expect(s["a"]).toBe("one\ntwo");
    expect(s["b"]).toBe("three");
  });
});

describe("lsblk, df, swap, memory parsers", () => {
  const devs = parseLsblk(LSBLK);
  it("flattens the tree and drops null mountpoints", () => {
    expect(devs.map(d => d.name)).toEqual([
      "loop1",
      "sda",
      "sda1",
      "sda15",
      "sdb",
      "sdb1",
      "sdb13",
      "sdb14",
      "sdc",
      "sdd",
      "zram0",
    ]);
    expect(devs.find(d => d.name === "sdb13")?.mountpoints).toEqual([]);
    expect(devs.find(d => d.name === "sda1")?.mountpoints).toEqual(["/"]);
    expect(parseLsblk("")).toEqual([]);
  });

  it("classifies disks and flags UNMOUNTED disks that already hold a filesystem", () => {
    const disks = classifyDisks(devs);
    const by = Object.fromEntries(disks.map(d => [d.name, d]));
    expect(Object.keys(by)).toEqual(["sda", "sdb", "sdc", "sdd"]); // no loop, no zram
    expect(by["sda"]?.state).toBe("system");
    expect(by["sdb"]?.state).toBe("mounted");
    expect(by["sdb"]?.note).toContain("/dev/sdb13");
    expect(by["sdb"]?.filesystems.find(f => f.path === "/dev/sdb13")?.mounted).toBe(false);
    expect(by["sdc"]?.state).toBe("unmounted-raw");
    expect(by["sdc"]?.holdsData).toBe(false);
    expect(by["sdd"]?.state).toBe("unmounted-data"); // whole-disk filesystem, not mounted
    expect(by["sdd"]?.holdsData).toBe(true);
    expect(by["sdb"]?.unallocatedBytes).toBeGreaterThan(1024 ** 3);
  });

  it("parses df with a mount point containing spaces and merges inode usage", () => {
    const fs = mergeInodes(parseDf(DF), DFI);
    expect(fs.map(f => f.mount)).toEqual(["/run", "/", "/mnt/backup", "/boot/efi", "/mnt/c data"]);
    const root = fs.find(f => f.mount === "/");
    expect(root?.usePercent).toBe(75);
    expect(root?.real).toBe(true);
    expect(fs.find(f => f.mount === "/run")?.real).toBe(false);
    expect(fs.find(f => f.mount === "/mnt/backup")?.inodes?.usePercent).toBe(88);
  });

  it("parses swapon (with or without header), zramctl and meminfo", () => {
    const sw = parseSwapon(
      "NAME TYPE SIZE USED PRIO\n/swapfile2 file 8589930496 0 10\n/dev/zram0 partition 17179865088 803655680 100",
    );
    expect(sw).toHaveLength(2);
    expect(sw[1]).toMatchObject({
      name: "/dev/zram0",
      usedBytes: 803655680,
      priority: 100,
    });
    expect(parseSwapon("")).toEqual([]);
    expect(parseZramctl("/dev/zram0 17179869184 798 600 zstd")[0]).toMatchObject({
      algorithm: "zstd",
      diskSizeBytes: 17179869184,
    });
    const m = parseMeminfo("MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 10 kB\nSwapFree: 5 kB\nCached: 7 kB");
    expect(m).toMatchObject({
      totalBytes: 102400,
      availableBytes: 40960,
      swapFreeBytes: 5120,
      cachedBytes: 7168,
    });
  });
});

describe("systemctl, ps, ports parsers", () => {
  it("parses units, failed units with a bullet, and timers", () => {
    const u = parseUnits(
      "nginx.service loaded active running A high performance web server\n● bad.service loaded failed failed Broken thing",
    );
    expect(u).toHaveLength(2);
    expect(u[0]).toMatchObject({
      name: "nginx.service",
      active: "active",
      sub: "running",
      description: "A high performance web server",
    });
    expect(u[1]?.name).toBe("bad.service");
    const t = parseTimers(
      "Sun 2026-10-04 00:29:49 UTC 10h Sat 2026-10-03 00:34:42 UTC 13h ago logrotate.timer logrotate.service\n- - - - apt.timer apt.service",
    );
    expect(t).toEqual([
      { unit: "logrotate.timer", activates: "logrotate.service" },
      { unit: "apt.timer", activates: "apt.service" },
    ]);
  });

  it("splits kernel threads from userland and counts zombies", () => {
    const procs = parsePs(PS);
    expect(procs).toHaveLength(10);
    const sum = summarizeProcs(procs);
    expect(sum.total).toBe(10);
    expect(sum.kernel).toBe(2);
    expect(sum.userland).toBe(8);
    expect(sum.zombies).toBe(1);
    expect(sum.byUser["ubuntu"]).toBe(5);
    expect(sum.topRss[0]?.command).toContain("redis-server");
  });

  it("recognizes build processes but not daemons or the yolo CLI itself", () => {
    const by = Object.fromEntries(parsePs(PS).map(p => [p.pid, isBuildProcess(p)]));
    expect(by[3000]).toBe(true); // cargo
    expect(by[3001]).toBe(true); // rustc
    expect(by[3500]).toBe(false); // sccache daemon
    expect(by[4000]).toBe(false); // bun run cli host audit
    expect(by[2]).toBe(false);
    expect(
      isBuildProcess({
        ...parsePs(PS)[0]!,
        args: "bun install --frozen-lockfile",
      }),
    ).toBe(true);
    expect(isBuildProcess({ ...parsePs(PS)[0]!, args: "/usr/bin/bun run build" })).toBe(true);
  });

  it("parses ss output with IPv6, interface suffixes and process names", () => {
    const l = parseSs(PORTS);
    expect(l).toHaveLength(5);
    expect(l[0]).toMatchObject({
      proto: "udp",
      address: "127.0.0.54",
      port: 53,
      process: "systemd-resolve",
      exposed: false,
    });
    expect(l[1]?.address).toBe("51.77.147.152");
    expect(l[2]).toMatchObject({ port: 22, process: "sshd", exposed: true });
    expect(l[3]).toMatchObject({ address: "[::]", port: 443, exposed: true });
    expect(l[4]?.exposed).toBe(false);
  });
});

describe("probe parsers", () => {
  it("parses docker df, locks, artifacts, swap files and metrics", () => {
    const d = parseDockerDf(COLLECTED.split("@@@ docker\n")[1]!.split("@@@")[0]!);
    expect(d.find(x => x.type === "Images")?.reclaimableBytes).toBe(1800000000);
    expect(parseLocks("/l|held|123,456,\n/m|free|\n/n|absent|\ngarbage")).toEqual([
      { path: "/l", state: "held", pids: [123, 456] },
      { path: "/m", state: "free", pids: [] },
      { path: "/n", state: "absent", pids: [] },
    ]);
    const art = parseArtifacts("900|cargo|old|/home/a/t\n1|npm|recent|/x|y/node_modules\nbad");
    expect(art).toHaveLength(2);
    expect(art[1]).toMatchObject({ recent: true, path: "/x|y/node_modules" });
    expect(parseSwapFiles("4294967296|SWAPSPACE2|-|/swapfile.old")[0]).toMatchObject({
      swapSignature: true,
      inFstab: false,
    });
    const m = parseMetrics("mem_available=10\nswap_total=20\nswap_free=5\nload1=0.5\nfree:/mnt/x=1234", "t");
    expect(m).toMatchObject({
      memAvailableBytes: 10,
      swapTotalBytes: 20,
      load1: 0.5,
    });
    expect(m.freeBytes["/mnt/x"]).toBe(1234);
  });

  it("builds a typed audit from a full collector output", () => {
    const a = audit();
    expect(a.identity).toMatchObject({
      user: "ubuntu",
      uid: 1000,
      cpus: 12,
      privileged: true,
    });
    expect(a.identity.load).toEqual([0.17, 1.83, 3.72]);
    expect(a.cron).toEqual({ files: ["e2scrub_all"], userEntries: 1 });
    expect(a.buildProcs.map(b => b.pid)).toEqual([3000, 3001]);
    expect(a.buildProcs[0]?.cwd).toBe("/home/ubuntu/src/aphrody");
    expect(a.reclaim.rotatedLogs).toEqual({ count: 12, bytes: 52428800 });
    expect(a.reclaim.journalBytes).toBe(parseSize("1.5G"));
    expect(a.docker.available).toBe(true);
  });

  it("derives findings: full disk, inodes, unmounted data, failed units, zombies", () => {
    const ids = analyze(audit()).map(f => f.id);
    expect(ids).toContain("disk-full:/mnt/backup");
    expect(ids).toContain("inodes:/mnt/backup");
    expect(ids).toContain("fs-unmounted:/dev/sdb13");
    expect(ids).toContain("fs-unmounted:/dev/sdd");
    expect(ids).toContain("failed-units");
    expect(ids).toContain("zombies");
    expect(ids).toContain("exposed-ports");
    expect(analyze(audit())[0]?.severity).toBe("critical");
  });
});

describe("free-space floor finding", () => {
  it("is critical below 50 % free and names the space command with the largest non-nested paths", () => {
    const f = analyze(audit(), 0.5).find(x => x.id === "free-floor:/mnt/backup");
    expect(f?.severity).toBe("critical");
    expect(f?.action).toContain("yolo host space");
    expect(f?.action).toContain("--host vps --fs /mnt/backup");
  });

  it("follows the floor it is given: 93 % full is below 20 % free, a 1 % floor is met", () => {
    const a = audit();
    expect(analyze(a, 0.2).some(x => x.id === "free-floor:/mnt/backup")).toBe(true);
    expect(analyze(a, 0.01).some(x => x.id === "free-floor:/mnt/backup")).toBe(false);
  });

  it("disappears once every filesystem keeps more than half free", () => {
    const a = audit();
    const roomy = {
      ...a,
      filesystems: a.filesystems.map(x =>
        Object.assign({}, x, {
          availBytes: Math.floor(x.sizeBytes * 0.6),
          usePercent: 40,
        }),
      ),
    };
    expect(analyze(roomy, 0.5).some(x => x.id.startsWith("free-floor:"))).toBe(false);
  });
});

describe("safety invariants", () => {
  const ctx = {
    user: "ubuntu",
    home: "/home/ubuntu",
    preserve: ["/home/ubuntu/build/cache", "/home/ubuntu/build/artifacts"],
  };

  it("protects /, /home, /etc, /boot, /var/lib, shared trees, databases and other users", () => {
    for (const p of [
      "/",
      "/home",
      "/etc",
      "/etc/nginx",
      "/boot",
      "/var/lib",
      "/var/lib/foo",
      "/home/ubuntu/apps/app/shared",
      "/home/ubuntu/apps/app/shared/uploads",
      "/home/other",
      "/home/other/x/target",
      "/var/lib/postgresql/18",
      "/home/ubuntu/build/cache/x",
    ]) {
      expect(protectedReason(p, ctx)).not.toBeNull();
    }
    expect(protectedReason("/home/ubuntu/proj", ctx)).toBe("a home directory");
    expect(protectedReason("/home/ubuntu/apps/app/releases", ctx)).toBe("a home directory");
    expect(protectedReason("/tmp/x", ctx)).toBeNull();
    expect(isDatabasePath("/var/lib/docker/overlay2")).toBe(true);
    expect(isDatabasePath("/home/ubuntu/apps/x/data.sqlite3")).toBe(true);
    expect(isDatabasePath("/home/ubuntu/apps/x/app")).toBe(false);
  });

  it("rejects relative, NUL and newline paths and resolves ..", () => {
    expect(() => normalizePath("relative/x")).toThrow();
    expect(() => normalizePath("/a\nb")).toThrow();
    expect(normalizePath("/a/b/../c/")).toBe("/a/c");
    expect(protectedReason("/tmp/../etc/passwd", ctx)).not.toBeNull();
  });

  it("a reclaim rule only deletes marked, aged build output in scan roots, never protected or kept data", () => {
    const roots = ["/home/ubuntu", "/tmp"];
    expect(canDeleteBuildArtifact("/home/ubuntu/p/target", "cargo", roots, ctx).ok).toBe(true);
    expect(canDeleteBuildArtifact("/home/ubuntu/src/x/node_modules", "npm", roots, ctx).ok).toBe(true);
    expect(canDeleteBuildArtifact("/home/other/p/target", "cargo", roots, ctx).ok).toBe(false);
    expect(canDeleteBuildArtifact("/home/ubuntu/build/cache/target", "cargo", roots, ctx).ok).toBe(false);
    expect(canDeleteBuildArtifact("/home/ubuntu/apps/app/shared/target", "cargo", roots, ctx).ok).toBe(false);
    expect(canDeleteBuildArtifact("/var/lib/foo/target", "cargo", ["/var"], ctx).ok).toBe(false);
    expect(canDeleteBuildArtifact("/home/ubuntu/p/src", "cargo", roots, ctx).ok).toBe(false); // wrong name for the marker
    expect(canDeleteBuildArtifact("/opt/p/target", "cargo", roots, ctx).ok).toBe(false); // outside scan roots
    expect(canDeleteBuildArtifact("/home/ubuntu/.cargo/registry/target", "cargo", roots, ctx).ok).toBe(false);
    expect(canDeleteBuildArtifact("/home/ubuntu/.cache/sccache/target", "cargo", roots, ctx).ok).toBe(false);
  });

  it("keeps sccache, cargo registry and the bun cache even if listed as cache dirs", () => {
    for (const p of [
      "/home/ubuntu/.cache/sccache",
      "/home/ubuntu/.cargo/registry/cache",
      "/home/ubuntu/.bun/install/cache",
      "/home/ubuntu/.ssh",
    ]) {
      expect(keptCacheReason(p, ctx)).not.toBeNull();
      expect(canDeleteCacheDir(p, ctx).ok).toBe(false);
    }
    expect(canDeleteCacheDir("/home/ubuntu/.cache/pip", ctx).ok).toBe(true);
    expect(canDeleteCacheDir("/home/ubuntu", ctx).ok).toBe(false);
    expect(canDeleteCacheDir("/home/ubuntu/Documents", ctx).ok).toBe(false);
    expect(canDeleteCacheDir("/home/other/.cache/pip", ctx).ok).toBe(false);
  });

  it("skips a path used by a build process, but not because of a daemon sitting in /", () => {
    expect(pathInUse("/home/ubuntu/apps/w/target", ["/home/ubuntu/apps/w"])).toBe(true);
    expect(pathInUse("/home/ubuntu/apps/w/target", ["/home/ubuntu/apps/w/target/debug"])).toBe(true);
    expect(pathInUse("/home/ubuntu/apps/w/target", ["/home/ubuntu/apps/other"])).toBe(false);
    expect(pathInUse("/home/ubuntu/apps/w/target", ["/", null])).toBe(false);
  });

  it("removes a source only when every verification passed", () => {
    const ok = {
      zstdTest: true,
      entryCountMatches: true,
      manifestChecked: true,
    };
    expect(canRemoveSource(ok)).toBe(true);
    expect(canRemoveSource({ ...ok, zstdTest: false })).toBe(false);
    expect(canRemoveSource({ ...ok, entryCountMatches: false })).toBe(false);
    expect(canRemoveSource({ ...ok, manifestChecked: false })).toBe(false);
    expect(canRemoveSource({ ...ok, dumpListed: false })).toBe(false);
    expect(canRemoveSource({ ...ok, dumpListed: true })).toBe(true);
    expect(canRemoveSource({ ...ok, pullChecksumMatches: false })).toBe(false);
  });

  it("refuses to remove system directories, the home, ~/.ssh and databases even after an archive", () => {
    for (const p of [
      "/",
      "/etc",
      "/var/lib",
      "/home",
      "/home/ubuntu",
      "/home/ubuntu/.ssh",
      "/home/ubuntu/.ssh/keys",
      "/usr/lib",
      "/boot/x",
      "/etc/ssh",
      "/var/lib/postgresql/18/main",
      "/home/ubuntu/build/cache/x",
      "/var/lib/docker",
    ])
      expect(removalRefusals(p, ctx).length).toBeGreaterThan(0);
    expect(removalRefusals("/home/ubuntu/archive/old", ctx)).toEqual([]);
    expect(removalRefusals("/home/ubuntu/projects/old", ctx)).toEqual([]);
  });

  it("never stops ssh or anything in the keep list, even when asked explicitly", () => {
    const p = DEFAULT_POLICY.services;
    expect(canStopUnit("ssh.service", p).ok).toBe(false);
    expect(canStopUnit("sshd.service", p).ok).toBe(false);
    expect(canStopUnit("ssh.socket", p).ok).toBe(false);
    expect(canStopUnit("systemd-journald.service", p).ok).toBe(false);
    expect(canStopUnit("nginx.service", p).ok).toBe(false);
    expect(canStopUnit("aphrody-whatever.service", p).ok).toBe(false);
    expect(canStopUnit("snapd.service", p).ok).toBe(true);
    expect(classifyService("snapd.service", p).cls).toBe("candidate");
    expect(classifyService("mystery.service", p).cls).toBe("unknown");
  });

  it("refuses commands that format, wipe, delete docker volumes or remove /", () => {
    for (const c of [
      "mkfs.ext4 /dev/sdb1",
      "sudo -n wipefs -a /dev/sdb",
      "sgdisk --zap-all /dev/sdb",
      "dd if=/dev/zero of=/dev/sdb bs=1M",
      "docker volume prune -f",
      "docker system prune -af --volumes",
      "rm -rf /",
      "rm -rf --no-preserve-root /",
      "echo x; rm -rf /*",
      "cryptsetup luksFormat /dev/sdb1",
      "blkdiscard /dev/sdb",
    ])
      expect(() => assertSafeCommand(c)).toThrow();
    for (const c of [
      "docker image prune -f",
      "docker container prune -f --filter until=24h",
      "rm -rf --one-file-system -- '/home/ubuntu/archive/old'",
      "tar -C '/home/ubuntu/archive' -cf - -- 'parted' | zstd -o '/x'",
    ])
      expect(() => assertSafeCommand(c)).not.toThrow();
  });
});

describe("policy file", () => {
  it("unions lists with the defaults and applies host overlays", () => {
    const toml = `
[services]
keep = ["mything"]
stop = ["noisy"]
[reclaim]
journal_max_size = "200M"
build_artifact_min_age_days = 30
[hosts.vps.services]
keep = ["only-on-vps"]
[hosts.dbfr.services]
keep = ["only-on-dbfr"]
`;
    const vps = parsePolicy(toml, "vps");
    expect(vps.services.keep).toContain("mything");
    expect(vps.services.keep).toContain("nginx"); // default retained
    expect(vps.services.keep).toContain("only-on-vps");
    expect(vps.services.keep).not.toContain("only-on-dbfr");
    expect(vps.services.stop).toContain("noisy");
    expect(vps.reclaim.journalMaxSize).toBe("200M");
    expect(vps.reclaim.buildArtifactMinAgeDays).toBe(30);
    expect(parsePolicy(null, "vps")).toEqual(DEFAULT_POLICY);
  });

  it("cannot make ssh stoppable", () => {
    const p = parsePolicy(`[services]\nstop = ["ssh", "ssh.service", "systemd-*"]`, "vps");
    expect(canStopUnit("ssh.service", p.services).ok).toBe(false);
    expect(canStopUnit("systemd-networkd.service", p.services).ok).toBe(false);
  });

  it("the shipped host-policy.toml parses", async () => {
    const text = await Bun.file(join(import.meta.dir, "../../../infra/config/host/host-policy.toml")).text();
    const p = parsePolicy(text, "vps");
    expect(p.reclaim.excludeNames).toContain("aphrody-ui");
    expect(p.services.keep).toContain("fail2ban");
  });
});

describe("collector and transport helpers", () => {
  it("is read-only: no mutating command appears in the collector script", () => {
    const script = collectorScript(
      [
        "identity",
        "meminfo",
        "lsblk",
        "df",
        "dfi",
        "mounts",
        "swapon",
        "zram",
        "services",
        "failed",
        "timers",
        "ports",
        "ps",
        "cwds",
        "docker",
        "du",
        "cron",
        "locks",
        "journal",
        "apt",
        "rotlogs",
        "artifacts",
        "swapfiles",
        "caches",
      ],
      DEFAULT_POLICY,
      ["/home/ubuntu/apps/x/heavy.lock"],
    );
    expect(script).not.toMatch(
      /\b(rm|mv|mkfs|mount|umount|swapoff|swapon\s+\/|systemctl\s+(stop|start|restart|disable|enable)|apt-get|-delete|tee|chmod|chown)\b/,
    );
    expect(script).toContain("/proc/locks");
    expect(script).toContain("-name 'aphrody-ui'");
    expect(() => assertSafeCommand(script)).not.toThrow();
  });

  it("round-trips a script through base64 and keeps the exit status through the sentinel", () => {
    const w = wrapScript("echo 'it''s'");
    expect(w).toStartWith("printf %s '");
    expect(w).toEndWith("| base64 -d | sh");
    const wrapped = withExitSentinel("false");
    expect(wrapped).toContain("@@yolo-rc=");
    expect(splitExitSentinel("out\n@@yolo-rc=3\n")).toEqual({
      stdout: "out",
      code: 3,
    });
    expect(splitExitSentinel("no marker")).toEqual({
      stdout: "no marker",
      code: null,
    });
  });

  it("quotes shell values and picks the privilege wrapper", () => {
    expect(sq("a'b")).toBe(`'a'\\''b'`);
    const id = audit().identity;
    expect(asRoot(id, "apt-get clean")).toBe("sudo -n sh -c 'apt-get clean'");
    expect(asRoot({ ...id, uid: 0 }, "apt-get clean")).toBe("apt-get clean");
    expect(asRoot({ ...id, privileged: false }, "apt-get clean")).toBeNull();
  });

  it("stop and disable carry --confirm, start does not", () => {
    expect(sshServiceArgs("vps", "x.service", "stop")).toContain("--confirm");
    expect(sshServiceArgs("vps", "x.service", "disable")).toContain("--confirm");
    expect(sshServiceArgs("vps", "x.service", "start")).not.toContain("--confirm");
  });

  it("parses flags with values, booleans and repeated flags", () => {
    const f = parseFlags(["a", "--host", "vps", "--apply", "--stop", "x", "--stop=y", "b"]);
    expect(f.positional).toEqual(["a", "b"]);
    expect(f.values.get("host")).toEqual(["vps"]);
    expect(f.values.get("stop")).toEqual(["x", "y"]);
    expect(f.values.get("apply")).toEqual(["true"]);
  });
});

describe("reclaim plan", () => {
  const a = audit();
  const { candidates, skipped } = reclaimCandidates(a, DEFAULT_POLICY, "vps");

  it("proposes only regenerable data, regenerable-first, with root commands wrapped in sudo", () => {
    const ids = candidates.map(c => c.id);
    expect(ids).toContain("apt-cache");
    expect(ids).toContain("journal");
    expect(ids).toContain("rotated-logs");
    expect(ids).toContain("docker-images");
    expect(ids).toContain("swapfile:/swapfile.old");
    expect(candidates.find(c => c.id === "apt-cache")?.cmd).toBe("sudo -n sh -c 'apt-get clean'");
    expect(candidates.find(c => c.id === "docker-images")?.cmd).toBe("docker image prune -f");
    expect(candidates.find(c => c.id === "journal")?.bytes).toBe(parseSize("1.5G") - parseSize("500M"));
    // low risk first
    const risks = candidates.map(c => c.risk);
    expect(risks.indexOf("medium")).toBeGreaterThan(risks.lastIndexOf("low") - 1);
    // no command removes a volume
    for (const c of candidates) expect(() => assertSafeCommand(c.cmd ?? "")).not.toThrow();
  });

  it("leaves alone recent, other users', preserved, active and fstab-listed things", () => {
    const why = Object.fromEntries(skipped.map(s => [s.what, s.why]));
    expect(why["/home/ubuntu/proj-new/target"]).toContain("modified within");
    expect(why["/home/other/proj/target"]).toContain("another user");
    expect(why["/home/ubuntu/build/cache/target"]).toBeDefined();
    expect(candidates.find(c => c.path === "/swapfile2")).toBeUndefined(); // active swap
    expect(why["/swapfile.fstab"]).toContain("fstab");
    expect(why["~/.cache/sccache"]).toContain("kept on purpose");
  });

  it("blocks an artifact a build process works above, and an unreadable build cwd blocks all", () => {
    // the cargo build runs in /home/ubuntu/src/aphrody; the npm candidate is in .../workspaces/x
    expect(candidates.find(c => c.path === "/home/ubuntu/src/x/node_modules")?.blocked).toBeUndefined();
    const inUse = audit(COLLECTED.replace("3000 /home/ubuntu/src/aphrody", "3000 /home/ubuntu/src/x"));
    const c2 = reclaimCandidates(inUse, DEFAULT_POLICY, "vps").candidates;
    expect(c2.find(c => c.path === "/home/ubuntu/src/x/node_modules")?.blocked).toContain("build process");
    const blind = audit(COLLECTED.replace("3000 /home/ubuntu/src/aphrody\n", ""));
    const c3 = reclaimCandidates(blind, DEFAULT_POLICY, "vps").candidates;
    expect(c3.find(c => c.kind === "build-artifact")?.blocked).toContain("cannot see");
  });

  it("without root, root-only steps are blocked instead of being run", () => {
    const noRoot = audit(COLLECTED.replace("sudo=yes", "sudo=no"));
    const apt = reclaimCandidates(noRoot, DEFAULT_POLICY, "vps").candidates.find(c => c.id === "apt-cache");
    expect(apt?.blocked).toContain("needs root");
  });

  it("the plan text lists every command", () => {
    const plan = planReclaim(a, DEFAULT_POLICY, "vps");
    const text = renderPlan(plan);
    for (const s of plan.steps) expect(text).toContain(s.cmd);
  });
});

describe("services plan", () => {
  it("proposes stopping only candidates and never the keep list", () => {
    const a = audit();
    const { rows, plan } = planServices(a, DEFAULT_POLICY, "vps", {
      stop: [],
      disable: true,
      candidates: true,
    });
    expect(rows.find(r => r.name === "ssh.service")?.cls).toBe("keep");
    expect(plan.steps.map(s => s.id)).toEqual(["stop:snapd.service", "disable:snapd.service"]);
    expect(plan.steps[0]?.cmd).toBe("aphrody-infra ssh service --host vps --action stop --confirm snapd.service");
    expect(plan.steps[0]?.undo).toBe("aphrody-infra ssh service --host vps --action start snapd.service");
  });

  it("refuses explicit --stop of ssh/nginx, accepts an unknown service, ignores stopped ones", () => {
    const a = audit();
    const { plan } = planServices(a, DEFAULT_POLICY, "vps", {
      stop: ["ssh", "nginx", "mystery", "not-running"],
      disable: false,
      candidates: false,
    });
    expect(plan.steps.map(s => s.id)).toEqual(["stop:mystery.service"]);
    expect(plan.skipped.map(s => s.what)).toEqual(
      expect.arrayContaining(["ssh.service", "nginx.service", "not-running.service"]),
    );
  });

  it("applies through the owner service command and records an undo", async () => {
    const root = tmp();
    const t = new FakeTransport("vps");
    const { plan } = planServices(audit(), DEFAULT_POLICY, "vps", {
      stop: [],
      disable: false,
      candidates: true,
    });
    const code = await executePlan(plan, ctxFor(root, t, "vps"));
    expect(code).toBe(0);
    expect(t.services).toEqual(["stop snapd.service"]);
    const j = await readJournal(root, "vps");
    expect(j.at(-1)).toMatchObject({
      command: "services",
      step: "stop:snapd.service",
      status: "ok",
    });
    expect(j.at(-1)?.undo).toContain("--action start");
  });
});

describe("tune plan", () => {
  const probe = {
    "net.ipv4.tcp_congestion_control": "bbr",
    "net.core.default_qdisc": "fq",
    "net.ipv4.tcp_rmem": "4096 1048576 16777216",
    "net.ipv4.tcp_wmem": "4096 1048576 16777216",
    "net.core.netdev_max_backlog": "1000",
    "vm.swappiness": "60",
    thp: "always",
    governor: "",
    nginx_workers: "4",
    nginx_present: "yes",
    limits: "absent",
    avail_cc: "reno cubic bbr",
    root_fstype: "ext4",
    swapfile_yolo: "absent",
  } as Record<string, string>;
  const owner = [
    {
      key: "fs.file-max",
      current_value: "4194304",
      recommended_value: "2097152",
      status: "NeedsUpdate",
    },
    {
      key: "vm.swappiness",
      current_value: "1",
      recommended_value: "10",
      status: "NeedsUpdate",
    },
    {
      key: "net.core.somaxconn",
      current_value: "65535",
      recommended_value: "65535",
      status: "Optimal",
    },
  ];

  it("shows current vs target, never lowers a ceiling and delegates owner keys to aphrody-infra", () => {
    const a = audit();
    const { rows, plan } = planTune(a, probe, owner, DEFAULT_POLICY, "vps", new Date("2026-10-03T12:00:00Z"));
    const row = (k: string) => rows.find(r => r.key === k);
    expect(row("net.ipv4.tcp_congestion_control")).toMatchObject({
      current: "bbr",
      target: "bbr",
      status: "ok",
    });
    expect(row("net.ipv4.tcp_rmem")?.status).toBe("ok"); // already larger
    expect(row("net.core.netdev_max_backlog")).toMatchObject({
      current: "1000",
      status: "change",
    });
    expect(row("vm.swappiness")?.source).toBe("aphrody-infra");
    expect(row("transparent_hugepage")).toMatchObject({
      current: "always",
      target: "madvise",
      status: "change",
    });
    expect(row("cpu governor")?.status).toBe("unavailable");
    expect(plan.steps.map(s => s.id)).toEqual(["owner-tune", "sysctl-dropin", "thp", "nginx-workers", "limits"]);
    expect(plan.notes.join(" ")).toContain("would LOWER fs.file-max");
    const drop = plan.steps.find(s => s.id === "sysctl-dropin");
    expect(drop?.cmd).toContain("net.core.netdev_max_backlog = 16384");
    expect(drop?.cmd).toContain("net.ipv4.tcp_congestion_control = bbr"); // already set: kept in the file so it persists
    expect(drop?.cmd).not.toContain("tcp_rmem");
    expect(drop?.undo).toContain('net.core.netdev_max_backlog="1000"');
    expect(plan.steps.find(s => s.id === "nginx-workers")?.cmd).toContain("nginx -t");
  });

  it("only creates a swap file when there is no swap at all, never on btrfs", () => {
    const none = audit(
      COLLECTED.replace("/swapfile2 file 8589930496 0 10\n/dev/zram0 partition 17179865088 803655680 100", "").replace(
        "/dev/zram0 17179869184 798000000 600000000 zstd",
        "",
      ),
    );
    const withSwap = planTune(audit(), probe, [], DEFAULT_POLICY, "vps", new Date()).plan;
    expect(withSwap.steps.find(s => s.id === "swapfile")).toBeUndefined();
    const plan = planTune(none, probe, [], DEFAULT_POLICY, "vps", new Date()).plan;
    const step = plan.steps.find(s => s.id === "swapfile");
    expect(step?.cmd).toContain("nofail");
    expect(step?.cmd).toContain("cp -a /etc/fstab /etc/fstab.yolo-bak-");
    expect(
      planTune(none, { ...probe, root_fstype: "btrfs" }, [], DEFAULT_POLICY, "vps", new Date()).plan.steps.find(
        s => s.id === "swapfile",
      ),
    ).toBeUndefined();
  });

  it("satisfies and sizing rules", () => {
    expect(satisfies("fs.file-max", "4194304", "2097152")).toBe(true);
    expect(satisfies("vm.swappiness", "1", "10")).toBe(false);
    expect(satisfies("net.ipv4.tcp_rmem", "4096\t1048576\t16777216", "4096 131072 16777216")).toBe(true);
    expect(satisfies("net.ipv4.tcp_rmem", "4096 87380 6291456", "4096 131072 16777216")).toBe(false);
    const GiB = 1024 ** 3;
    expect(suggestedSwapBytes(1 * GiB)).toBe(2 * GiB);
    expect(suggestedSwapBytes(4 * GiB)).toBe(4 * GiB);
    expect(suggestedSwapBytes(45 * GiB)).toBe(6 * GiB);
    expect(suggestedSwapBytes(512 * GiB)).toBe(16 * GiB);
  });
});

describe("mount plan", () => {
  const a = audit();
  const now = new Date("2026-10-03T12:00:00Z");

  it("mounts an unmounted data partition read-only, without journal replay, by default", () => {
    const plan = planMount(a, { device: "/dev/sdb13", rw: false, confirmBackup: false, fstab: false }, "vps", now);
    const mount = plan.steps.find(s => s.id === "mount");
    expect(mount?.cmd).toContain("-o ro,nosuid,nodev,noexec,noload");
    expect(mount?.cmd).not.toMatch(/\brw\b/);
    expect(plan.steps.map(s => s.id)).toEqual(["mkdir", "mount", "verify"]);
    expect(readOnlyOptions("xfs")).toContain("norecovery");
  });

  it("needs both --rw and --i-know-this-is-a-backup for read-write, and adds a nofail fstab entry after a backup", () => {
    expect(
      planMount(a, { device: "/dev/sdb13", rw: true, confirmBackup: false, fstab: false }, "vps", now).steps,
    ).toHaveLength(0);
    const rw = planMount(a, { device: "/dev/sdb13", rw: true, confirmBackup: true, fstab: true }, "vps", now);
    expect(rw.steps.find(s => s.id === "mount")?.cmd).toContain("-o rw,nosuid,nodev,noexec");
    const fstab = rw.steps.find(s => s.id === "fstab")?.cmd ?? "";
    expect(fstab.indexOf("cp -a /etc/fstab /etc/fstab.yolo-bak-")).toBeGreaterThanOrEqual(0);
    expect(fstab).toContain("nofail");
    expect(fstab.indexOf("cp -a")).toBeLessThan(fstab.indexOf(">> /etc/fstab"));
  });

  it("refuses to format: no filesystem, system disk, whole disks, mounted, volume layers, odd targets", () => {
    const refusal = (device: string, extra: Partial<Parameters<typeof planMount>[1]> = {}) =>
      planMount(a, { device, rw: false, confirmBackup: false, fstab: false, ...extra }, "vps", now).notes.join(" ");
    expect(refusal("/dev/sdb14")).toContain("never formats");
    expect(refusal("/dev/sdc")).toContain("never formats");
    expect(refusal("/dev/sda1")).toContain("running system");
    expect(refusal("/dev/sdb")).toContain("choose one of");
    expect(refusal("/dev/sdb1")).toContain("already mounted");
    expect(refusal("/dev/nope")).toContain("not a disk or partition");
    expect(refusal("sdb13")).toContain("must look like /dev");
    expect(refusal("/dev/sdb13", { target: "/etc" })).toContain("must be under /mnt");
    expect(refusal("/dev/sdb13", { target: "/mnt/../etc" })).toContain("must be under /mnt");
    const luks = audit(
      COLLECTED.replace(
        '"fstype":"ext4","fsused":null,"fsavail":null,"mountpoints":[null],"label":"old"',
        '"fstype":"crypto_LUKS","fsused":null,"fsavail":null,"mountpoints":[null],"label":"old"',
      ),
    );
    expect(
      planMount(luks, { device: "/dev/sdd", rw: false, confirmBackup: false, fstab: false }, "vps", now).notes.join(
        " ",
      ),
    ).toContain("volume layer");
  });
});

describe("archive plan", () => {
  const a = audit();
  const opts = {
    sources: ["/home/ubuntu/archive/old"],
    to: "/mnt/backup/arc",
    removeSource: true,
    level: 3,
    threads: 2,
    sudo: false,
    stamp: "20261003",
  } as const;
  const now = new Date("2026-10-03T12:00:00Z");

  it("builds the pipeline with low priority, verification steps, and removal last", () => {
    const plan = planArchive(
      a,
      { ...opts, pull: "/tmp/pulled", pgDump: "demoapp", pgUser: "postgres" },
      "vps",
      DEFAULT_POLICY,
      now,
    );
    const ids = plan.steps.map(s => s.id.split(":")[0]);
    expect(ids).toEqual([
      "pg-dump",
      "pg-verify",
      "pull",
      "pull-verify",
      "precheck",
      "create",
      "verify-zstd",
      "verify-count",
      "manifest",
      "pull",
      "pull-verify",
      "remove",
    ]);
    const create = plan.steps.find(s => s.id.startsWith("create"))?.cmd ?? "";
    expect(create).toContain("nice -n 19 ionice -c3 tar");
    expect(create).toContain("zstd -T2 -q -3");
    expect(create).toContain("pipefail");
    expect(create).toContain(".tar.zst.part");
    expect(plan.steps.find(s => s.id.startsWith("verify-zstd"))?.cmd).toContain("zstd -t");
    expect(plan.steps.find(s => s.id.startsWith("manifest"))?.cmd).toContain("sha256sum -c");
    expect(plan.steps.find(s => s.id.startsWith("pg-dump"))?.cmd).toContain(
      "sudo -n -u 'postgres' pg_dump -Fc 'demoapp'",
    );
    expect(plan.steps.find(s => s.id.startsWith("pg-verify"))?.cmd).toContain("pg_restore -l");
    expect(plan.steps.find(s => s.id.startsWith("pull:"))?.cmd).toContain("--partial --append-verify");
    expect(plan.steps.at(-1)?.id).toBe("remove:/home/ubuntu/archive/old");
    for (const s of plan.steps) if (s.kind === "exec") expect(() => assertSafeCommand(s.cmd)).not.toThrow();
  });

  it("does not plan a removal step without --remove-source and blocks it for protected system paths", () => {
    const plain = planArchive(a, { ...opts, removeSource: false }, "vps", DEFAULT_POLICY, now);
    expect(plain.steps.some(s => s.id.startsWith("remove"))).toBe(false);
    const etc = planArchive(a, { ...opts, sources: ["/etc/nginx"] }, "vps", DEFAULT_POLICY, now);
    expect(etc.steps.find(s => s.id.startsWith("remove"))?.blocked).toBeDefined();
    expect(etc.notes.join(" ")).toContain("--remove-source refused");
    const db = planArchive(a, { ...opts, sources: ["/var/lib/postgresql/18/main"] }, "vps", DEFAULT_POLICY, now);
    expect(db.steps.find(s => s.id.startsWith("remove"))?.blocked).toContain("database");
    expect(db.notes.join(" ")).toContain("pg-dump");
  });

  it("refuses the filesystem root, virtual filesystems, and an archive directory inside the source", () => {
    const plan = planArchive(
      a,
      {
        ...opts,
        sources: ["/", "/proc", "/home/ubuntu/archive/old"],
        to: "/home/ubuntu/archive/old/inside",
      },
      "vps",
      DEFAULT_POLICY,
      now,
    );
    expect(plan.steps).toHaveLength(0);
    expect(plan.skipped).toHaveLength(3);
    expect(planArchive(a, { ...opts, to: "relative" }, "vps", DEFAULT_POLICY, now).steps).toHaveLength(0);
    expect(planArchive(a, { ...opts, to: "/mnt/with space" }, "vps", DEFAULT_POLICY, now).steps).toHaveLength(0);
  });

  it("dumps a database once however many sources are archived, and a dump needs its own pull", () => {
    const plan = planArchive(
      a,
      {
        ...opts,
        sources: ["/home/ubuntu/apps/a", "/home/ubuntu/apps/b"],
        pgDump: "demoapp",
        pull: "/tmp/p",
      },
      "vps",
      DEFAULT_POLICY,
      now,
    );
    expect(plan.steps.filter(s => s.id.startsWith("pg-dump"))).toHaveLength(1);
    expect(plan.steps.filter(s => s.id.startsWith("remove"))).toHaveLength(2);
    expect(new Set(plan.steps.map(s => s.id)).size).toBe(plan.steps.length); // ids are unique
    const dumpOnly = planArchive(
      a,
      { ...opts, sources: [], removeSource: false, pgDump: "demoapp" },
      "vps",
      DEFAULT_POLICY,
      now,
    );
    expect(dumpOnly.steps.map(s => s.id)).toEqual(["pg-dump:demoapp", "pg-verify:demoapp"]);
  });

  it("labels archives from the path", () => {
    expect(archiveLabel("/home/ubuntu/build/cache")).toBe("home-ubuntu-build-cache");
    expect(archiveLabel("/")).toBe("root");
  });
});

const reclaimPlan = (): Plan => planReclaim(audit(), DEFAULT_POLICY, "vps");
const planStep = (id: string, cmd: string) => ({
  id,
  title: id,
  kind: "exec" as const,
  cmd,
  mutates: true,
  undo: null,
});

describe("executing plans", () => {
  it("runs exactly the commands the dry run listed, in order, and journals each with an undo", async () => {
    const root = tmp();
    const plan = reclaimPlan();
    const t = new FakeTransport("vps", cmd => ({
      code: 0,
      stdout: cmd.includes("mem_available")
        ? "mem_available=1\nswap_total=0\nswap_free=0\nload1=0.1\nfree:/=100\n"
        : "",
      stderr: "",
    }));
    const lines: string[] = [];
    const code = await executePlan(plan, ctxFor(root, t, "vps", lines));
    expect(code).toBe(0);
    const executed = t.calls.filter(c => !c.includes("mem_available") && !c.includes("base64"));
    const runnable = plan.steps.filter(s => s.blocked === undefined).map(s => s.cmd);
    expect(executed).toEqual(runnable);
    const j = await readJournal(root, "vps");
    expect(j.filter(e => e.status === "ok")).toHaveLength(runnable.length);
    expect(j.every(e => e.undo !== undefined && e.cmd !== "")).toBe(true);
    expect(j.find(e => e.status === "ok")?.before?.freeBytes).toBeDefined();
    expect(j.filter(e => e.status === "skipped").every(e => e.note !== null)).toBe(true);
  });

  it("refuses to mutate while a build lock is held and journals the refusal", async () => {
    const root = tmp();
    const t = new FakeTransport("vps", cmd =>
      cmd.includes("base64")
        ? {
            code: 0,
            stdout: "@@@ locks\n/home/ubuntu/build/locks/heavy.lock|held|4242,\n",
            stderr: "",
          }
        : { code: 0, stdout: "", stderr: "" },
    );
    const lines: string[] = [];
    const code = await executePlan(reclaimPlan(), ctxFor(root, t, "vps", lines));
    expect(code).toBe(3);
    expect(t.calls).toHaveLength(1); // only the lock probe ran
    expect(lines.join("\n")).toContain("build lock held");
    expect((await readJournal(root, "vps")).map(e => e.status)).toEqual(["refused"]);
  });

  it("a failed cleanup does not stop the independent ones, but the run reports the failure", async () => {
    const root = tmp();
    const t = new FakeTransport("vps", cmd =>
      cmd.includes("apt-get") ? { code: 100, stdout: "", stderr: "dpkg locked" } : { code: 0, stdout: "", stderr: "" },
    );
    const plan = reclaimPlan();
    const code = await executePlan(plan, ctxFor(root, t, "vps"));
    expect(code).toBe(1);
    const j = await readJournal(root, "vps");
    expect(j.filter(e => e.status === "failed")).toHaveLength(1);
    expect(j.find(e => e.status === "failed")).toMatchObject({
      exit: 100,
      step: "apt-cache",
    });
    expect(j.filter(e => e.status === "ok").length).toBeGreaterThan(1);
  });

  it("stops a sequence of ungrouped steps at the first failure", async () => {
    const root = tmp();
    const plan: Plan = {
      host: "local",
      command: "x",
      notes: [],
      skipped: [],
      steps: [planStep("a", "echo a"), planStep("b", "fail"), planStep("c", "echo c")],
    };
    const t = new FakeTransport("local", cmd =>
      cmd === "fail" ? { code: 2, stdout: "", stderr: "no" } : { code: 0, stdout: "", stderr: "" },
    );
    expect(await executePlan(plan, ctxFor(root, t))).toBe(1);
    expect(t.calls).toEqual(["echo a", "fail"]);
  });

  it("refuses a step whose command turned destructive", async () => {
    const root = tmp();
    const plan: Plan = {
      host: "local",
      command: "x",
      notes: [],
      skipped: [],
      steps: [
        {
          id: "bad",
          title: "bad",
          kind: "exec",
          cmd: "mkfs.ext4 /dev/sdb1",
          mutates: true,
          undo: null,
        },
      ],
    };
    const t = new FakeTransport("local");
    expect(await executePlan(plan, ctxFor(root, t))).toBe(3);
    expect(t.calls).toHaveLength(0);
  });

  it("keeps a journal that survives a torn line", async () => {
    const root = tmp();
    const entry = {
      ts: "t",
      run: "r",
      host: "local" as const,
      command: "c",
      step: "s",
      title: "t",
      cmd: "x",
      status: "ok" as const,
      exit: 0,
      ms: 1,
      before: null,
      after: null,
      undo: null,
      note: null,
    };
    await appendJournal(root, entry);
    await Bun.write(journalPath(root, "local"), (await Bun.file(journalPath(root, "local")).text()) + '{"torn":');
    await appendJournal(root, { ...entry, step: "s2" });
    expect((await readJournal(root, "local")).map(e => e.step)).toEqual(["s", "s2"]);
  });
});

// `yolo host` drives Linux hosts: the fleet safety rules accept only POSIX absolute paths, so the local
// transport runs where the temp directory is one (not Windows, even with Git's sh, tar and zstd on PATH).
const haveTools =
  process.platform !== "win32" &&
  Bun.which("zstd") !== null &&
  Bun.which("tar") !== null &&
  Bun.which("sha256sum") !== null;

const makeSource = (root: string): string => {
  const src = join(root, "src");
  mkdirSync(join(src, "sub/deep"), { recursive: true });
  writeFileSync(join(src, "a.txt"), "alpha\n".repeat(1000));
  writeFileSync(join(src, "sub/b.bin"), Buffer.alloc(4096, 7));
  writeFileSync(join(src, "sub/deep/c.txt"), "gamma");
  return src;
};
const archiveArgs = (src: string, dest: string, extra: string[] = []): string[] => [
  "archive",
  src,
  "--to",
  dest,
  "--host",
  "local",
  "--stamp",
  "20261003",
  "--apply",
  ...extra,
];

describe.skipIf(!haveTools)("local apply in a temp directory", () => {
  it("archives, verifies, writes a sha256 manifest and only then removes the source", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    const lines: string[] = [];
    const code = await runHostCommand(archiveArgs(src, dest, ["--remove-source"]), root, {
      out: l => void lines.push(l),
      transport: new LocalTransport(),
    });
    expect(code).toBe(0);
    const label = archiveLabel(src);
    expect(existsSync(join(dest, `${label}-20261003.tar.zst`))).toBe(true);
    const manifest = await Bun.file(join(dest, `${label}-20261003.tar.zst.sha256`)).text();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(new Uint8Array(await Bun.file(join(dest, `${label}-20261003.tar.zst`)).arrayBuffer()));
    expect(manifest.startsWith(hasher.digest("hex"))).toBe(true);
    expect(existsSync(src)).toBe(false); // removed after verification
    const j = await readJournal(root, "local");
    expect(j.map(e => e.status).every(s => s === "ok")).toBe(true);
    expect(j.at(-1)?.step).toBe(`remove:${src}`);
    expect(j.at(-1)?.undo).toContain("zstd -dc");
    // the archive restores the data
    const restored = join(root, "restored");
    mkdirSync(restored);
    const r = Bun.spawnSync(
      ["sh", "-c", `zstd -dc '${join(dest, `${label}-20261003.tar.zst`)}' | tar -C '${restored}' -xf -`],
      { windowsHide: true },
    );
    expect(r.exitCode).toBe(0);
    expect(await Bun.file(join(restored, "src/sub/deep/c.txt")).text()).toBe("gamma");
  });

  it("is idempotent: a second run reuses the archive and verifies it again", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    const t = new LocalTransport();
    expect(
      await runHostCommand(archiveArgs(src, dest), root, {
        out: () => {},
        transport: t,
      }),
    ).toBe(0);
    const arc = join(dest, `${archiveLabel(src)}-20261003.tar.zst`);
    const before = Bun.file(arc).lastModified;
    expect(
      await runHostCommand(archiveArgs(src, dest), root, {
        out: () => {},
        transport: t,
      }),
    ).toBe(0);
    expect(Bun.file(arc).lastModified).toBe(before);
    expect(existsSync(src)).toBe(true); // no --remove-source
  });

  it("keeps the source when a verification fails", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    class Corrupting extends LocalTransport {
      override async exec(cmd: string, secs?: number): Promise<ExecResult> {
        if (cmd.includes("zstd -t")) return { code: 1, stdout: "", stderr: "corrupt" };
        return super.exec(cmd, secs);
      }
    }
    const lines: string[] = [];
    const code = await runHostCommand(archiveArgs(src, dest, ["--remove-source"]), root, {
      out: l => void lines.push(l),
      transport: new Corrupting(),
    });
    expect(code).not.toBe(0);
    expect(existsSync(join(src, "a.txt"))).toBe(true);
    const j = await readJournal(root, "local");
    expect(j.some(e => e.status === "failed")).toBe(true);
    expect(j.some(e => e.step.startsWith("remove") && e.status === "ok")).toBe(false);
  });

  it("keeps the source when the entry count does not match (source changed during archiving)", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    class Growing extends LocalTransport {
      override async exec(cmd: string, secs?: number): Promise<ExecResult> {
        if (cmd.includes("source_entries=")) writeFileSync(join(src, "late.txt"), "new file after the archive");
        return super.exec(cmd, secs);
      }
    }
    const code = await runHostCommand(archiveArgs(src, dest, ["--remove-source"]), root, {
      out: () => {},
      transport: new Growing(),
    });
    expect(code).not.toBe(0);
    expect(existsSync(join(src, "late.txt"))).toBe(true);
    expect((await readJournal(root, "local")).some(e => e.step.startsWith("remove") && e.status === "ok")).toBe(false);
  });

  it("keeps the source when the requested database dump cannot be verified", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    class NoPostgres extends LocalTransport {
      override async exec(cmd: string, secs?: number): Promise<ExecResult> {
        if (cmd.includes("pg_dump") || cmd.includes("pg_restore"))
          return {
            code: cmd.includes("pg_dump") ? 0 : 1,
            stdout: "",
            stderr: "",
          };
        return super.exec(cmd, secs);
      }
    }
    const code = await runHostCommand(archiveArgs(src, dest, ["--remove-source", "--pg-dump", "db1"]), root, {
      out: () => {},
      transport: new NoPostgres(),
    });
    expect(code).toBe(3);
    expect(existsSync(join(src, "a.txt"))).toBe(true);
    const j = await readJournal(root, "local");
    expect(j.find(e => e.step.startsWith("remove"))?.status).toBe("refused");
  });

  it("pulls the archive to another directory and compares the checksum before removing", async () => {
    if (Bun.which("rsync") === null && Bun.which("rclone") === null) return;
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    const pulled = join(root, "pulled");
    const code = await runHostCommand(archiveArgs(src, dest, ["--pull", pulled, "--remove-source"]), root, {
      out: () => {},
      transport: new LocalTransport(),
    });
    expect(code).toBe(0);
    const name = `${archiveLabel(src)}-20261003.tar.zst`;
    expect(await Bun.file(join(pulled, name)).exists()).toBe(true);
    expect(await Bun.file(join(pulled, `${name}.sha256`)).exists()).toBe(true);
    expect(existsSync(src)).toBe(false);
  });

  it("a plan without --apply changes nothing", async () => {
    const root = tmp();
    const src = makeSource(root);
    const dest = join(root, "arc");
    const lines: string[] = [];
    const code = await runHostCommand(["archive", src, "--to", dest, "--host", "local", "--remove-source"], root, {
      out: l => void lines.push(l),
      transport: new LocalTransport(),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Plan only");
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(src, "a.txt"))).toBe(true);
    expect(existsSync(journalPath(root, "local"))).toBe(false);
  });

  it("reclaims old build output for real and journals the freed space", async () => {
    const root = tmp();
    const proj = join(root, "proj");
    mkdirSync(join(proj, "target/debug"), { recursive: true });
    writeFileSync(join(proj, "Cargo.toml"), "[package]\nname='x'\n");
    writeFileSync(join(proj, "target/debug/big.bin"), Buffer.alloc(200_000, 1));
    const base = audit();
    const a: Audit = {
      ...base,
      host: "local",
      docker: { available: false, usage: [] },
      identity: { ...base.identity, user: "tester", home: join(root, "home") },
      buildProcs: [],
      reclaim: {
        aptCacheBytes: 0,
        journalBytes: 0,
        rotatedLogs: { count: 0, bytes: 0 },
        swapFiles: [],
        cacheDirs: [],
        artifacts: [
          {
            path: join(proj, "target"),
            bytes: 200_000,
            marker: "cargo",
            recent: false,
          },
        ],
      },
    };
    const plan = planReclaim(
      a,
      {
        ...DEFAULT_POLICY,
        reclaim: { ...DEFAULT_POLICY.reclaim, scanRoots: [tmpdir()] },
      },
      "local",
    );
    expect(plan.steps.map(s => s.cmd)).toEqual([`rm -rf --one-file-system -- '${join(proj, "target")}'`]);
    const code = await executePlan(plan, ctxFor(root, new LocalTransport()));
    expect(code).toBe(0);
    expect(existsSync(join(proj, "target"))).toBe(false);
    expect(existsSync(join(proj, "Cargo.toml"))).toBe(true); // the source stays
    const j = await readJournal(root, "local");
    expect(j[0]).toMatchObject({
      status: "ok",
      step: `artifact:${join(proj, "target")}`,
    });
    expect(j[0]?.before?.freeBytes[join(proj, "target")]).toBeGreaterThan(0);
    expect(await executePlan(plan, ctxFor(root, new LocalTransport()))).toBe(0); // idempotent
  });
});

describe("net helpers and CLI wiring", () => {
  it("parses curl stats and converts units", () => {
    const s = parseCurlStats("size=50000000 total=2.000000 connect=0.020000 ttfb=0.120000 speed=25000000.000");
    expect(s).toMatchObject({
      sizeBytes: 50000000,
      totalSecs: 2,
      connectSecs: 0.02,
    });
    expect(mbit(s!.bytesPerSec)).toBe(200);
    expect(parseCurlStats("garbage")).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(hostCurlCommand("https://x/y?bytes=1")).toContain("--max-time 90 -w");
  });

  it("net is a read-only plan on remote hosts", () => {
    const plan = planNet("vps", 1000, "https://x/y");
    expect(plan.steps.every(s => !s.mutates)).toBe(true);
    expect(plan.steps.map(s => s.id)).toEqual(["tcp", "rtt", "down-host", "down-local"]);
  });

  it("requires --host and rejects unknown subcommands", async () => {
    const quiet = { out: () => {} };
    expect(await runHostCommand(["audit"], tmp(), quiet)).toBe(2);
    expect(await runHostCommand(["audit", "--host", "nowhere"], tmp(), quiet)).toBe(2);
    expect(await runHostCommand(["bogus", "--host", "vps"], tmp(), quiet)).toBe(2);
    expect(await runHostCommand([], tmp(), quiet)).toBe(2);
    expect(await runHostCommand(["help"], tmp(), quiet)).toBe(0);
  });

  it("audit through a transport returns typed JSON", async () => {
    const lines: string[] = [];
    const t = new FakeTransport("vps", () => ({
      code: 0,
      stdout: COLLECTED,
      stderr: "",
    }));
    const code = await runHostCommand(["audit", "--host", "vps", "--json"], tmp(), {
      out: l => void lines.push(l),
      transport: t,
    });
    expect(code).toBe(0);
    const j = JSON.parse(lines.join("\n"));
    expect(j.identity.cpus).toBe(12);
    expect(j.disks.find((d: { name: string }) => d.name === "sdb").state).toBe("mounted");
    expect(j.reclaimPlan.length).toBeGreaterThan(0);
    expect(j.findings.length).toBeGreaterThan(0);
    expect(t.calls).toHaveLength(1);
  });

  it("the audit never mutates: every command it sends is the one read-only collector", async () => {
    const t = new FakeTransport("vps", () => ({
      code: 0,
      stdout: COLLECTED,
      stderr: "",
    }));
    await runHostCommand(["audit", "--host", "vps", "--json"], tmp(), {
      out: () => {},
      transport: t,
    });
    await runHostCommand(["reclaim", "--host", "vps"], tmp(), {
      out: () => {},
      transport: t,
    });
    await runHostCommand(["services", "--host", "vps"], tmp(), {
      out: () => {},
      transport: t,
    });
    expect(t.calls.every(c => c.includes("base64 -d | sh"))).toBe(true);
    expect(t.services).toEqual([]);
  });
});
