//! Parser fixtures are real probe output with host names and public IPs replaced.

use serde_json::json;

use crate::parse;
use crate::registry::{self, Entry, Inventory, Outcome, Query, Secret};
use crate::schema::{self, Cpu, Disk, Gpu, HostInfo, Memory, Os};
use crate::transport::{Target, parse_target};

const MEMINFO: &str = "MemTotal:       48163932 kB\nMemFree:        22346020 kB\nMemAvailable:   41186008 kB\nBuffers:         1623100 kB\nCached:         14643316 kB\nSwapCached:            0 kB\nSwapTotal:       2097148 kB\nSwapFree:        2097000 kB\n";
const PSI: &str = "some avg10=0.50 avg60=0.00 avg300=0.00 total=370755392\nfull avg10=0.25 avg60=0.00 avg300=0.00 total=272687081\n";
const CPUINFO: &str = "processor\t: 0\nvendor_id\t: GenuineIntel\nmodel name\t: Intel Core Processor (Haswell, no TSX)\nflags\t\t: fpu vme sse4_2 avx avx2 bmi2 avx512f amx_tile\n\nprocessor\t: 1\nvendor_id\t: GenuineIntel\nmodel name\t: Intel Core Processor (Haswell, no TSX)\nflags\t\t: fpu vme sse4_2 avx avx2 bmi2 avx512f amx_tile\n\n";
const CPUINFO_CORES: &str = "processor\t: 0\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 1\nphysical id\t: 0\ncore id\t\t: 0\n\nprocessor\t: 2\nphysical id\t: 0\ncore id\t\t: 1\n\n";
const OS_RELEASE: &str = "PRETTY_NAME=\"Ubuntu 26.04.1 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"26.04\"\nVERSION=\"26.04.1 LTS (Resolute Raccoon)\"\nID=ubuntu\n";
const ALPINE_RELEASE: &str =
    "NAME=\"Alpine Linux\"\nID=alpine\nVERSION_ID=3.24.0\nPRETTY_NAME=\"Alpine Linux v3.24\"\n";
const NVIDIA_CSV: &str =
    "NVIDIA GeForce RTX 4070, 12282, 11301, 616.92\nNVIDIA GeForce RTX 3090, 24576, 1024, 616.92\n";
const NVIDIA_BANNER: &str =
    "| NVIDIA-SMI 616.92                 KMD Version: 616.92        CUDA UMD Version: 13.4     |\n";
const NVIDIA_BANNER_OLD: &str =
    "| NVIDIA-SMI 550.54.15    Driver Version: 550.54.15    CUDA Version: 12.4     |\n";
const LSBLK: &str = r#"{"blockdevices":[{"name":"sda","type":"disk","size":322122547200,"fstype":null,"mountpoint":null,"rota":false,"tran":null,"model":"QEMU HARDDISK","children":[{"name":"sda1","type":"part","size":320932396544,"fstype":"ext4","mountpoint":"/","rota":false,"tran":null,"model":null}]},{"name":"nvme0n1","type":"disk","size":1000204886016,"fstype":null,"mountpoint":null,"rota":false,"tran":"nvme","model":"Micron","children":[{"name":"nvme0n1p1","type":"part","size":1000000000000,"fstype":"ext4","mountpoint":"/data","rota":false,"tran":null,"model":null}]},{"name":"sdb","type":"disk","size":4000787030016,"rota":true,"tran":"sata","children":[{"name":"sdb1","type":"part","rota":true}]}]}"#;
const DF: &str = "Filesystem     Type      1-blocks         Used    Available Capacity Mounted on\ntmpfs          tmpfs   4931989504      1232896   4930756608       1% /run\n/dev/sda1      ext4  311227166720 151496683520 156504383488      50% /\ntmpfs          tmpfs  24659931136      2101248  24657829888       1% /dev/shm\nnone           tmpfs      1048576            0      1048576       0% /run/credentials/systemd-journald.service\n/dev/sda15     vfat     109395456      6567424    102828032       7% /boot/efi\n/dev/nvme0n1p1 ext4  999000000000  1000000000 900000000000       1% /mnt/with space\n";
const IP_ADDR: &str = "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever\n2: ens3    inet 203.0.113.10/32 metric 100 scope global dynamic ens3\\       valid_lft 56048sec preferred_lft 56048sec\n3: wg0    inet 10.8.0.1/24 scope global wg0\\       valid_lft forever preferred_lft forever\n4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever\n29: mesh    inet 10.200.77.1/24 scope global mesh\\       valid_lft forever\n";
const CIM_GPU: &str = "\"Name\",\"AdapterRAM\",\"DriverVersion\"\r\n\"NVIDIA GeForce RTX 4070\",\"4293918720\",\"32.0.16.1692\"\r\n\"Microsoft Basic Display Adapter\",\"0\",\"10.0.1\"\r\n";
const WMIC_GPU: &str = "\r\nNode,AdapterRAM,DriverVersion,Name\r\nPC-ONE,4293918720,32.0.16.1692,NVIDIA GeForce RTX 4070\r\n\r\n";
const CIM_CPU: &str = "\"Name\",\"NumberOfCores\",\"NumberOfLogicalProcessors\"\r\n\"13th Gen Intel(R) Core(TM) i7-13700F\",\"16\",\"24\"\r\n";
const CIM_OS: &str = "\"Caption\",\"Version\",\"BuildNumber\",\"TotalVisibleMemorySize\",\"FreePhysicalMemory\",\"TotalVirtualMemorySize\",\"FreeVirtualMemory\"\r\n\"Microsoft Windows 11 Famille\",\"10.0.28000\",\"28000\",\"33363336\",\"2087452\",\"66950948\",\"14833068\"\r\n";
const CIM_DISK: &str = "\"DeviceID\",\"FileSystem\",\"Size\",\"FreeSpace\",\"DriveType\"\r\n\"C:\",\"NTFS\",\"996911943680\",\"307311341568\",\"3\"\r\n\"D:\",\"\",\"\",\"\",\"5\"\r\n";
const PHYSICAL_DISK: &str =
    "\"FriendlyName\",\"MediaType\",\"BusType\"\r\n\"NVMe Micron_2400\",\"SSD\",\"NVMe\"\r\n";
const NET_IP: &str = "\"InterfaceAlias\",\"IPAddress\"\r\n\"Ethernet\",\"192.168.0.24\"\r\n\"Aphrody\",\"10.200.77.4\"\r\n\"Loopback Pseudo-Interface 1\",\"127.0.0.1\"\r\n\"WireGuard Tunnel\",\"172.31.0.2\"\r\n";

fn prefixes() -> Vec<String> {
    vec!["10.200.".into(), "10.8.".into()]
}

#[test]
fn memory_cgroup_mounts_and_namespaces() {
    let mounts = "25 20 0:24 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n26 20 0:25 /tenant /sys/fs/memory\\040group rw - cgroup cgroup rw,memory\n";
    let hierarchies = parse::memory_cgroups(
        "0::/user.slice/worker\n3:cpu,memory:/tenant/child\n",
        mounts,
    );
    assert_eq!(hierarchies.len(), 2);
    assert_eq!(hierarchies[0].mount, "/sys/fs/cgroup");
    assert_eq!(hierarchies[0].path, "/sys/fs/cgroup/user.slice/worker");
    assert!(hierarchies[0].unified);
    assert_eq!(hierarchies[1].path, "/sys/fs/memory group/child");
    assert!(!hierarchies[1].unified);
    assert!(
        parse::memory_cgroups("0::/../../outside\n3:memory:/tenant-other/child", mounts).is_empty()
    );
    let namespace = parse::memory_cgroups(
        "0::/",
        "25 20 0:24 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw",
    );
    assert_eq!(namespace[0].path, "/sys/fs/cgroup");
}

#[test]
fn memory_cgroup_limits_account_for_ancestor_usage() {
    assert_eq!(parse::memory_budget("0", Some("0")), Some((0, 0)));
    assert_eq!(parse::memory_budget("0", Some("4096")), Some((0, 0)));
    assert_eq!(parse::memory_budget("max", Some("0")), None);
    assert_eq!(
        parse::memory_budget("1048583", Some("5")),
        Some((1048583, 1048578))
    );
    assert_eq!(parse::memory_budget("9223372036854771712", Some("5")), None);
    assert_eq!(parse::memory_budget("9223372036854710272", Some("5")), None);
    let mut memory = Memory {
        total_mib: 32768,
        available_mib: 20000,
        ..Memory::default()
    };
    parse::constrain_memory(&mut memory, "8589934592", Some("1073741824"));
    assert_eq!((memory.total_mib, memory.available_mib), (8192, 7168));
    // A wider parent ceiling can still have less headroom due to siblings.
    parse::constrain_memory(&mut memory, "17179869184", Some("16106127360"));
    assert_eq!((memory.total_mib, memory.available_mib), (8192, 1024));
    parse::constrain_memory(&mut memory, "max", None);
    parse::constrain_memory(&mut memory, "invalid", Some("0"));
    assert_eq!((memory.total_mib, memory.available_mib), (8192, 1024));
    parse::constrain_memory(&mut memory, "1048576", Some("2097152"));
    assert_eq!((memory.total_mib, memory.available_mib), (1, 0));
    let mut unknown_usage = Memory {
        total_mib: 8192,
        available_mib: 4096,
        ..Memory::default()
    };
    parse::constrain_memory(&mut unknown_usage, "1073741824", None);
    assert_eq!(
        (unknown_usage.total_mib, unknown_usage.available_mib),
        (1024, 0)
    );
}

#[test]
fn meminfo_and_psi() {
    let m = parse::meminfo(MEMINFO);
    assert_eq!(
        (
            m.total_mib,
            m.available_mib,
            m.swap_total_mib,
            m.swap_free_mib
        ),
        (47035, 40220, 2047, 2047)
    );
    assert_eq!(parse::psi(PSI), (Some(0.5), Some(0.25)));
    assert_eq!(parse::psi(""), (None, None));
    // No MemAvailable (old kernels): free + buffers + cached.
    let old =
        parse::meminfo("MemTotal: 2048 kB\nMemFree: 1024 kB\nBuffers: 512 kB\nCached: 512 kB\n");
    assert_eq!((old.total_mib, old.available_mib), (2, 2));
}

#[test]
fn cpuinfo_flags_and_cores() {
    let c = parse::cpuinfo(CPUINFO);
    assert_eq!(c.model, "Intel Core Processor (Haswell, no TSX)");
    assert_eq!((c.logical, c.physical), (2, None));
    assert_eq!(c.flags, ["avx", "avx2", "avx512f", "amx_tile"]);
    let c = parse::cpuinfo(CPUINFO_CORES);
    assert_eq!((c.logical, c.physical), (3, Some(2)));
}

#[test]
fn os_release_variants() {
    assert_eq!(
        parse::os_release(OS_RELEASE),
        ("Ubuntu 26.04.1 LTS".into(), "26.04".into())
    );
    assert_eq!(
        parse::os_release(ALPINE_RELEASE),
        ("Alpine Linux v3.24".into(), "3.24.0".into())
    );
    assert_eq!(parse::os_release(""), (String::new(), String::new()));
}

#[test]
fn nvidia_smi() {
    let gpus = parse::nvidia_smi_csv(NVIDIA_CSV);
    assert_eq!(gpus.len(), 2);
    assert_eq!(
        (gpus[0].vram_total_mib, gpus[0].vram_free_mib),
        (12282, Some(11301))
    );
    assert_eq!(gpus[1].driver.as_deref(), Some("616.92"));
    assert_eq!(
        parse::nvidia_cuda_version(NVIDIA_BANNER).as_deref(),
        Some("13.4")
    );
    assert_eq!(
        parse::nvidia_cuda_version(NVIDIA_BANNER_OLD).as_deref(),
        Some("12.4")
    );
    assert_eq!(parse::nvidia_cuda_version("NVIDIA-SMI has failed"), None);
    assert!(parse::nvidia_smi_csv("No devices were found").is_empty());
}

#[test]
fn lsblk_and_df() {
    let kinds = parse::lsblk_kinds(LSBLK);
    assert_eq!(kinds["sda1"], "ssd");
    assert_eq!(kinds["nvme0n1p1"], "nvme");
    assert_eq!(kinds["sdb1"], "hdd");
    assert!(parse::lsblk_kinds("not json").is_empty());

    let disks = parse::df(DF);
    let mounts: Vec<&str> = disks.iter().map(|d| d.mount.as_str()).collect();
    assert_eq!(mounts, ["/", "/boot/efi", "/mnt/with space"]);
    assert_eq!((disks[0].total_mib, disks[0].free_mib), (296809, 149254));
}

#[test]
fn wireguard_addresses() {
    let a = parse::ip_addr(IP_ADDR, &prefixes());
    let got: Vec<(&str, &str)> = a
        .iter()
        .map(|x| (x.iface.as_str(), x.ip.as_str()))
        .collect();
    assert_eq!(got, [("wg0", "10.8.0.1"), ("mesh", "10.200.77.1")]);
    let w = parse::windows_addresses(NET_IP, &prefixes());
    let got: Vec<&str> = w.iter().map(|x| x.ip.as_str()).collect();
    assert_eq!(got, ["10.200.77.4", "172.31.0.2"]);
}

#[test]
fn windows_probes() {
    for text in [CIM_GPU, WMIC_GPU] {
        let gpus = parse::windows_gpus(text);
        assert_eq!(gpus.len(), 1, "{text}");
        assert_eq!(
            (gpus[0].vendor.as_str(), gpus[0].vram_total_mib),
            ("nvidia", 4095)
        );
        assert_eq!(gpus[0].driver.as_deref(), Some("32.0.16.1692"));
    }
    assert_eq!(
        parse::windows_cpu(CIM_CPU),
        Some(("13th Gen Intel(R) Core(TM) i7-13700F".into(), 16, 24))
    );
    let sys = parse::windows_system(CIM_OS).unwrap();
    assert_eq!(
        (sys.build.as_str(), sys.version.as_str()),
        ("28000", "10.0.28000")
    );
    assert_eq!(
        (sys.memory.total_mib, sys.memory.available_mib),
        (32581, 2038)
    );
    assert_eq!(sys.memory.swap_total_mib, 32800);
    let kind = parse::windows_disk_kind(PHYSICAL_DISK);
    assert_eq!(kind, "nvme");
    let disks = parse::windows_disks(CIM_DISK, &kind);
    assert_eq!(disks.len(), 1);
    assert_eq!(
        (
            disks[0].mount.as_str(),
            disks[0].fs.as_str(),
            disks[0].total_mib
        ),
        ("C:\\", "NTFS", 950729)
    );
    assert_eq!(
        parse::windows_disk_kind(
            "\"MediaType\",\"BusType\"\r\n\"SSD\",\"SATA\"\r\n\"HDD\",\"SATA\"\r\n"
        ),
        "unknown"
    );
}

fn info(id: &str, at: u64, vram_free: Option<u64>, ram: u64) -> HostInfo {
    HostInfo {
        schema: schema::SCHEMA,
        id: id.into(),
        collected_at: at,
        os: Os {
            family: "linux".into(),
            name: "Ubuntu".into(),
            version: "26.04".into(),
            arch: "x86_64".into(),
            libc: "glibc".into(),
            build: None,
        },
        cpu: Cpu {
            model: "x".into(),
            logical_cores: 4,
            ..Cpu::default()
        },
        memory: Memory {
            total_mib: 65536,
            available_mib: ram,
            ..Memory::default()
        },
        gpus: vram_free
            .map(|f| Gpu {
                vendor: "nvidia".into(),
                name: "NVIDIA RTX 4090".into(),
                vram_total_mib: 24576,
                vram_free_mib: Some(f),
                driver: None,
                cuda: Some("12.4".into()),
            })
            .into_iter()
            .collect(),
        disks: vec![Disk {
            mount: "/".into(),
            device: "sda1".into(),
            fs: "ext4".into(),
            total_mib: 500_000,
            free_mib: 200_000,
            kind: "ssd".into(),
        }],
        ..HostInfo::default()
    }
}

const SECRET: &[u8] = b"0123456789abcdef-secret";

#[test]
fn merge_is_idempotent_and_newest_wins() {
    let mut inv = Inventory::new();
    let old = registry::card(&info("vps", 1000, Some(1), 1), None);
    let new = registry::card(&info("vps", 2000, Some(2), 2), None);
    assert_eq!(inv.merge(old.clone(), None), Outcome::Added);
    assert_eq!(inv.merge(old.clone(), None), Outcome::Unchanged);
    assert_eq!(inv.merge(new.clone(), None), Outcome::Updated);
    assert_eq!(inv.merge(old, None), Outcome::Stale);
    assert_eq!(inv.merge(new.clone(), None), Outcome::Unchanged);
    assert_eq!(inv.hosts["vps"], new);

    // Same timestamp, different content: the larger canonical text wins in either order.
    let (a, b) = (
        registry::card(&info("t", 5, Some(1), 1), None),
        registry::card(&info("t", 5, Some(2), 1), None),
    );
    let (mut x, mut y) = (Inventory::new(), Inventory::new());
    x.merge(a.clone(), None);
    x.merge(b.clone(), None);
    y.merge(b, None);
    y.merge(a, None);
    assert_eq!(x.hosts, y.hosts);
}

#[test]
fn signatures() {
    let secret = Secret::from_bytes(SECRET).unwrap();
    let other = Secret::from_bytes(b"another-secret-0123456789").unwrap();
    assert!(Secret::from_bytes(b"short").is_err());
    let signed = registry::card(&info("vps", 1, None, 1), Some(&secret));
    let sig = signed.sig.clone().unwrap();
    assert_eq!(sig.len(), 64);
    assert!(secret.verify(&signed.info, &sig));
    assert!(!other.verify(&signed.info, &sig));
    assert!(!secret.verify(&signed.info, "zz"));

    let mut inv = Inventory::new();
    assert_eq!(inv.merge(signed.clone(), Some(&secret)), Outcome::Added);
    assert!(matches!(
        inv.merge(signed.clone(), Some(&other)),
        Outcome::Rejected(_)
    ));
    let unsigned = registry::card(&info("pc", 1, None, 1), None);
    assert!(
        matches!(inv.merge(unsigned, Some(&secret)), Outcome::Rejected(r) if r.contains("unsigned"))
    );
    let mut tampered = signed;
    tampered.info["memory"]["total_mib"] = json!(1);
    assert!(
        matches!(inv.merge(tampered, Some(&secret)), Outcome::Rejected(r) if r.contains("bad signature"))
    );
    // Key order does not matter.
    let reordered: Entry = serde_json::from_str(&format!(
        "{{\"sig\":\"{sig}\",\"info\":{}}}",
        serde_json::to_string(&registry::card(&info("vps", 1, None, 1), None).info).unwrap()
    ))
    .unwrap();
    assert!(secret.verify(&reordered.info, &sig));
}

#[test]
fn rejects_bad_ids_and_schema() {
    let mut inv = Inventory::new();
    for id in ["", "../x", "a/b", ".hidden", "a b"] {
        assert!(
            matches!(
                inv.merge(registry::card(&info(id, 1, None, 1), None), None),
                Outcome::Rejected(_)
            ),
            "{id}"
        );
    }
    let mut future = registry::card(&info("x", 1, None, 1), None);
    future.info["schema"] = json!(2);
    assert!(matches!(inv.merge(future, None), Outcome::Rejected(_)));
    assert!(inv.hosts.is_empty());
}

#[test]
fn find_by_resources() {
    let mut inv = Inventory::new();
    inv.merge(
        registry::card(&info("big", 10_000, Some(20_000), 8_000), None),
        None,
    );
    inv.merge(
        registry::card(&info("busy", 10_000, Some(2_000), 60_000), None),
        None,
    );
    inv.merge(
        registry::card(&info("cpu", 10_000, None, 30_000), None),
        None,
    );
    let ids = |q: &Query| -> Vec<String> {
        registry::find(&inv, q, 20_000)
            .iter()
            .map(|h| h["id"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        ids(&Query {
            min_vram_free_gb: Some(16.0),
            ..Query::default()
        }),
        ["big"]
    );
    assert_eq!(
        ids(&Query {
            min_vram_free_gb: Some(1.0),
            ..Query::default()
        }),
        ["big", "busy"]
    );
    assert_eq!(
        ids(&Query {
            min_ram_gb: Some(20.0),
            ..Query::default()
        }),
        ["busy", "cpu"]
    );
    assert_eq!(
        ids(&Query {
            gpu: Some("4090".into()),
            cuda: true,
            ..Query::default()
        }),
        ["big", "busy"]
    );
    assert_eq!(
        ids(&Query {
            os: Some("windows".into()),
            ..Query::default()
        }),
        Vec::<String>::new()
    );
    assert_eq!(
        ids(&Query {
            min_disk_free_gb: Some(300.0),
            ..Query::default()
        }),
        Vec::<String>::new()
    );
    assert_eq!(
        ids(&Query {
            max_age_s: Some(5),
            ..Query::default()
        }),
        Vec::<String>::new()
    );
    assert_eq!(ids(&Query::default()).len(), 3);
}

#[test]
fn targets() {
    assert_eq!(
        parse_target("C:\\cards").unwrap(),
        Target::Dir("C:\\cards".into())
    );
    assert_eq!(
        parse_target("/srv/cards").unwrap(),
        Target::Dir("/srv/cards".into())
    );
    assert_eq!(
        parse_target("ubuntu@vps:inbox").unwrap(),
        Target::Ssh {
            dest: "ubuntu@vps".into(),
            port: None,
            dir: "inbox".into()
        }
    );
    assert_eq!(
        parse_target("ssh://vps:2222//srv/host").unwrap(),
        Target::Ssh {
            dest: "vps".into(),
            port: Some(2222),
            dir: "/srv/host".into()
        }
    );
    assert_eq!(
        parse_target("ssh://vps/.bun/host/inbox").unwrap(),
        Target::Ssh {
            dest: "vps".into(),
            port: None,
            dir: ".bun/host/inbox".into()
        }
    );
    assert!(parse_target("-oProxyCommand=x:dir").is_err());
}

#[test]
fn directory_roundtrip_and_load() {
    let dir = std::env::temp_dir().join(format!("bun-host-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let secret = Secret::from_bytes(SECRET).unwrap();
    let inbox = dir.join("inbox");
    for (id, at) in [("pc-omar", 1_000u64), ("vps", 2_000)] {
        let entry = registry::card(&info(id, at, Some(100), 100), Some(&secret));
        crate::transport::push(&Target::Dir(inbox.clone()), &entry).unwrap();
    }
    std::fs::write(inbox.join("junk.json"), b"{").unwrap();
    let loaded = registry::load(&dir, Some(&secret));
    assert_eq!(
        loaded.inventory.hosts.keys().collect::<Vec<_>>(),
        ["pc-omar", "vps"]
    );
    assert_eq!(loaded.rejected.len(), 1);
    let mut inventory = loaded.inventory;
    registry::save(&dir, &mut inventory).unwrap();
    let again = registry::load(&dir, Some(&secret));
    assert_eq!(again.inventory.hosts, inventory.hosts);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn card_matches_the_schema() {
    let schema: serde_json::Value = serde_json::from_str(schema::schema_json()).unwrap();
    let card = serde_json::to_value(info("vps", 1, Some(1), 1)).unwrap();
    for key in schema["required"].as_array().unwrap() {
        assert!(card.get(key.as_str().unwrap()).is_some(), "{key}");
    }
    for (section, def) in schema["properties"].as_object().unwrap() {
        if let (Some(props), Some(value)) = (def.get("properties"), card.get(section)) {
            for key in props.as_object().unwrap().keys() {
                assert!(value.get(key).is_some(), "{section}.{key}");
            }
        }
    }
}

#[test]
fn collect_this_machine() {
    let info = crate::collect::collect("self-test");
    assert_eq!(info.schema, schema::SCHEMA);
    assert!(info.memory.total_mib > 0, "{info:?}");
    assert!(info.cpu.logical_cores >= 1);
    assert!(!info.os.family.is_empty());
    assert!(registry::valid_id(&crate::collect::default_id()));
}
