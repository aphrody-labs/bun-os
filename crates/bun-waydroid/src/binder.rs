// SPDX-License-Identifier: GPL-3.0-or-later
//! Binder node discovery and binderfs planning (`tools/helpers/drivers.py`).
//! Pure functions over a list of existing `/dev` names so they are testable on any host.

pub const BINDER: &[&str] = &["anbox-binder", "puddlejumper", "bonder", "binder"];
pub const VNDBINDER: &[&str] = &[
    "anbox-vndbinder",
    "vndpuddlejumper",
    "vndbonder",
    "vndbinder",
];
pub const HWBINDER: &[&str] = &["anbox-hwbinder", "hwpuddlejumper", "hwbonder", "hwbinder"];

/// `_IOWR('b', 1, struct binderfs_device)` where the struct is 256 + 4 + 4 bytes.
pub const BINDER_CTL_ADD: u32 = ioc_iowr(98, 1, 264);

const fn ioc_iowr(ty: u32, nr: u32, size: u32) -> u32 {
    // dir(2 bits)=3 at 30, size(14) at 16, type(8) at 8, nr(8) at 0
    (3 << 30) | (size << 16) | (ty << 8) | nr
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Nodes {
    pub binder: Option<String>,
    pub vndbinder: Option<String>,
    pub hwbinder: Option<String>,
}

fn pick(candidates: &[&str], existing: &[String]) -> Option<String> {
    // Upstream keeps the last match in list order.
    candidates
        .iter()
        .rev()
        .find(|c| existing.iter().any(|e| e == **c))
        .map(|s| s.to_string())
}

/// Nodes present in `/dev`. For MAINLINE vendors all four names are accepted, for Halium the
/// plain `binder`/`vndbinder`/`hwbinder` names are excluded (drivers.py `[:-1]`).
pub fn detect(existing: &[String], mainline: bool) -> Nodes {
    let cut = |l: &'static [&'static str]| if mainline { l } else { &l[..l.len() - 1] };
    Nodes {
        binder: pick(cut(BINDER), existing),
        vndbinder: pick(cut(VNDBINDER), existing),
        hwbinder: pick(cut(HWBINDER), existing),
    }
}

/// Device names binderfs must still create (first name of each missing family).
pub fn plan_alloc(existing: &[String]) -> Vec<&'static str> {
    let mut plan = Vec::new();
    for fam in [BINDER, VNDBINDER, HWBINDER] {
        if !fam.iter().any(|n| existing.iter().any(|e| e == *n)) {
            plan.push(fam[0]);
        }
    }
    plan
}

/// The 264-byte payload of `BINDER_CTL_ADD`: 256 bytes name, then major and minor as u32 (zero in).
pub fn ctl_payload(name: &str) -> Option<[u8; 264]> {
    let b = name.as_bytes();
    if b.len() >= 256 {
        return None;
    }
    let mut out = [0u8; 264];
    out[..b.len()].copy_from_slice(b);
    Some(out)
}

pub fn binderfs_loaded(proc_filesystems: &str) -> bool {
    proc_filesystems
        .lines()
        .any(|l| l.split_whitespace().nth(1) == Some("binder"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn ioctl_number_matches_linux() {
        // linux/android/binderfs.h: BINDER_CTL_ADD = _IOWR('b', 1, struct binderfs_device)
        assert_eq!(BINDER_CTL_ADD, 0xC108_6201);
    }

    #[test]
    fn plan_creates_only_missing_families() {
        assert_eq!(
            plan_alloc(&v(&[])),
            vec!["anbox-binder", "anbox-vndbinder", "anbox-hwbinder"]
        );
        assert_eq!(
            plan_alloc(&v(&["anbox-binder", "hwbinder"])),
            vec!["anbox-vndbinder"]
        );
        assert!(plan_alloc(&v(&["binder", "vndbinder", "hwbinder"])).is_empty());
    }

    #[test]
    fn detect_respects_vendor_type() {
        let all = v(&["binder", "vndbinder", "hwbinder"]);
        assert_eq!(detect(&all, true).binder.as_deref(), Some("binder"));
        assert_eq!(detect(&all, false), Nodes::default());
        assert_eq!(
            detect(&v(&["anbox-binder"]), false).binder.as_deref(),
            Some("anbox-binder")
        );
    }

    #[test]
    fn payload_and_proc_filesystems() {
        let p = ctl_payload("anbox-binder").unwrap();
        assert_eq!(&p[..12], b"anbox-binder");
        assert_eq!(p[12], 0);
        assert!(ctl_payload(&"x".repeat(256)).is_none());
        assert!(binderfs_loaded("nodev\tsysfs\nnodev\tbinder\n"));
        assert!(!binderfs_loaded("nodev\tsysfs\n\text4\n"));
    }
}
