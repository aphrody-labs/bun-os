// SPDX-License-Identifier: Apache-2.0
use super::*;

fn conservative_live() -> Profile {
    Profile::default()
}

#[test]
fn embedded_catalog_parses_and_is_guarded() {
    let c = Catalog::embedded().expect("catalog");
    assert!(c.tweaks.len() > 30);
    for t in &c.tweaks {
        for op in t.ops().unwrap() {
            assert!(guard(&op).is_none(), "{} has a guarded op", t.id);
        }
    }
}

#[test]
fn conservative_live_profile_excludes_offline_and_heavy_tweaks() {
    let c = Catalog::embedded().unwrap();
    let sel = conservative_live().select(&c).unwrap();
    let ids: Vec<&str> = sel.iter().map(|t| t.id.as_str()).collect();
    assert!(ids.contains(&"privacy.telemetry"));
    assert!(ids.contains(&"ai.recall"));
    assert!(ids.contains(&"performance.power-plan"));
    assert!(!ids.iter().any(|i| i.starts_with("setup.")), "setup is offline-only");
    assert!(!ids.contains(&"appx.xbox"));
    assert!(!ids.contains(&"edge-onedrive.edge-files"));
    assert!(!ids.contains(&"wsl.subsystem"));
    for t in sel {
        assert_eq!(t.level, Level::Conservative);
        for op in t.ops().unwrap() {
            assert!(!matches!(op, Op::FileRemove { .. } | Op::RegDeleteKey { .. } | Op::CapabilityRemove { .. } | Op::Feature { .. }));
        }
    }
}

#[test]
fn offline_profile_includes_setup_but_not_power() {
    let c = Catalog::embedded().unwrap();
    let p = Profile::parse("target = \"offline\"\nlevel = \"standard\"\n").unwrap();
    let ids: Vec<String> = p.select(&c).unwrap().iter().map(|t| t.id.clone()).collect();
    assert!(ids.contains(&"setup.hardware-bypass".to_owned()));
    assert!(ids.contains(&"edge-onedrive.onedrive-setup".to_owned()));
    assert!(!ids.contains(&"performance.power-plan".to_owned()));
}

#[test]
fn profile_rejects_unknown_ids_and_fields() {
    let c = Catalog::embedded().unwrap();
    assert!(Profile::parse("include = [\"nope.x\"]").unwrap().select(&c).is_err());
    assert!(Profile::parse("modules = [\"nope\"]").unwrap().select(&c).is_err());
    assert!(Profile::parse("bogus = 1").is_err());
}

#[test]
fn modules_include_exclude() {
    let c = Catalog::embedded().unwrap();
    let p = Profile::parse("modules = [\"ai\"]\ninclude = [\"shell.dark-mode\"]\nexclude = [\"ai.copilot-app\"]").unwrap();
    let ids: Vec<String> = p.select(&c).unwrap().iter().map(|t| t.id.clone()).collect();
    assert_eq!(ids, ["ai.copilot", "ai.recall", "shell.dark-mode"]);
}

#[test]
fn guard_refuses_protected_targets() {
    assert!(guard(&Op::ServiceStart { name: "WinDefend".into(), start: StartType::Disabled }).is_some());
    assert!(guard(&Op::ServiceStart { name: "WireGuardTunnel$wg0".into(), start: StartType::Disabled }).is_some());
    assert!(guard(&Op::ServiceStart { name: "cloudflared".into(), start: StartType::Disabled }).is_some());
    assert!(guard(&Op::ServiceStart { name: "LxssManager".into(), start: StartType::Disabled }).is_some());
    assert!(guard(&Op::AppxRemove { family: "Microsoft.WindowsStore".into() }).is_some());
    assert!(guard(&Op::AppxRemove { family: "Microsoft.VCLibs.140.00".into() }).is_some());
    assert!(
        guard(&Op::RegSet {
            hive: RegHive::Machine,
            key: r"SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection".into(),
            name: "DisableRealtimeMonitoring".into(),
            data: RegData::Dword(1)
        })
        .is_some()
    );
    assert!(guard(&Op::Feature { name: "Microsoft-Windows-Subsystem-Linux".into(), state: FeatureState::Disabled }).is_some());
    assert!(guard(&Op::Feature { name: "Microsoft-Windows-Subsystem-Linux".into(), state: FeatureState::Enabled }).is_none());
    assert!(guard(&Op::FileRemove { path: r"Windows\System32\Microsoft-Edge-Webview".into() }).is_some());
    assert!(guard(&Op::FileRemove { path: r"Windows\..\x".into() }).is_some());
    assert!(guard(&Op::ServiceStart { name: "DiagTrack".into(), start: StartType::Disabled }).is_none());
}

#[test]
fn catalog_with_guarded_op_is_rejected() {
    let bad = r#"schema = 1
[[module]]
id = "x"
title = "x"
description = "x"
[[tweak]]
id = "x.defender"
module = "x"
title = "no"
level = "aggressive"
services = [{ name = "WinDefend", start = "disabled" }]
"#;
    assert!(Catalog::parse(bad).is_err());
}

#[test]
fn reg_data_roundtrip() {
    for d in [
        RegData::Dword(7),
        RegData::Qword(1 << 40),
        RegData::Sz("100".into()),
        RegData::ExpandSz("%SystemRoot%".into()),
        RegData::MultiSz(vec!["a".into(), "bc".into()]),
        RegData::Binary(vec![1, 2, 3]),
    ] {
        let (k, b) = d.encode();
        assert_eq!(RegData::decode(k, &b), d);
    }
}

#[test]
fn plan_apply_verify_undo_roundtrip() {
    let c = Catalog::embedded().unwrap();
    let profile = conservative_live();
    let tweaks = profile.select(&c).unwrap();
    let mut sys = MemoryBackend::default();
    sys.kind = Some(TargetKind::Live);
    // A pre-existing user value that must come back on undo, an installed bloat app, a running telemetry service,
    // an enabled task and the Balanced plan.
    let k = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced".to_owned();
    sys.values.insert((RegHive::User, k.to_ascii_lowercase(), "hidefileext".into()), RegData::Dword(1));
    sys.packages.push("Clipchamp.Clipchamp_3.0.0.0_neutral__yxz26nhyzhsrt".into());
    sys.packages.push("Microsoft.WindowsStore_22410.1401.5.0_x64__8wekyb3d8bbwe".into());
    sys.services.insert("diagtrack".into(), StartType::Automatic);
    sys.tasks.insert(r"\microsoft\windows\customer experience improvement program\consolidator".into(), true);
    sys.power = "381b4222-f694-41f0-9685-ff5bb260df2e".into();
    let original = sys.clone();

    let plan = plan(&mut sys, &profile, &tweaks, "t0");
    assert!(plan.changes() > 40);
    assert!(plan.steps.iter().any(|s| s.tweak == "services.retail-demo" && s.action == "skip"));
    assert!(touched_keys(&plan).iter().any(|(h, k)| *h == RegHive::Machine && k.contains("DataCollection")));
    let json = serde_json::to_string(&plan).unwrap();
    let plan: Plan = serde_json::from_str(&json).unwrap();

    let mut journal = Journal { started: "t0".into(), ..Journal::default() };
    let mut persisted = 0;
    apply(&mut sys, &plan, &mut journal, |_| persisted += 1);
    assert_eq!(persisted, plan.changes());
    assert!(journal.entries.iter().all(|e| e.result == "applied"), "{journal:?}");
    assert!(verify(&mut sys, &journal).is_empty());
    assert!(sys.packages.iter().any(|p| p.starts_with("Microsoft.WindowsStore_")), "Store kept");
    assert!(!sys.packages.iter().any(|p| p.starts_with("Clipchamp")));
    assert_eq!(sys.services["diagtrack"], StartType::Disabled);
    assert_eq!(sys.power, "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c");

    // A second plan is a no-op.
    let again = super::plan(&mut sys, &profile, &tweaks, "t1");
    assert_eq!(again.changes(), 0);

    let mut journal: Journal = serde_json::from_str(&serde_json::to_string(&journal).unwrap()).unwrap();
    let report = undo(&mut sys, &mut journal);
    assert!(report.errors.is_empty(), "{report:?}");
    assert!(journal.undone);
    assert_eq!(sys.values, original.values);
    assert_eq!(sys.services, original.services);
    assert_eq!(sys.tasks, original.tasks);
    assert_eq!(sys.power, original.power);
    let mut a = sys.packages.clone();
    let mut b = original.packages.clone();
    a.sort();
    b.sort();
    assert_eq!(a, b);
}

#[test]
fn hand_edited_plan_cannot_bypass_guard() {
    let mut sys = MemoryBackend::default();
    sys.services.insert("windefend".into(), StartType::Automatic);
    let plan = Plan {
        schema: 1,
        target: TargetKind::Live,
        created: "t".into(),
        profile: Profile::default(),
        steps: vec![Step {
            tweak: "evil".into(),
            module: "services".into(),
            op: Op::ServiceStart { name: "WinDefend".into(), start: StartType::Disabled },
            before: State::Start { start: StartType::Automatic },
            action: "change".into(),
            reason: None,
            reversible: true,
        }],
    };
    let mut j = Journal::default();
    apply(&mut sys, &plan, &mut j, |_| {});
    assert_eq!(j.entries[0].result, "failed");
    assert_eq!(sys.services["windefend"], StartType::Automatic);
}

#[test]
fn offline_locations() {
    assert_eq!(
        offline_location(RegHive::Machine, r"SYSTEM\CurrentControlSet\Control\BitLocker").unwrap(),
        (r"Windows\System32\config\SYSTEM", r"ControlSet001\Control\BitLocker".to_owned())
    );
    assert_eq!(
        offline_location(RegHive::Machine, r"SOFTWARE\Policies\X").unwrap(),
        (r"Windows\System32\config\SOFTWARE", r"Policies\X".to_owned())
    );
    assert_eq!(offline_location(RegHive::User, r"Software\X").unwrap().0, r"Users\Default\NTUSER.DAT");
    assert!(offline_location(RegHive::Machine, r"SAM\X").is_err());
}

#[test]
fn look_module_is_user_registry_with_a_binary_palette() {
    let c = Catalog::embedded().unwrap();
    let look: Vec<_> = c.tweaks.iter().filter(|t| t.module == "look").collect();
    assert!(look.len() >= 5);
    let mut palette = None;
    for t in look {
        for op in t.ops().unwrap() {
            match op {
                Op::RegSet { hive, name, data, .. } => {
                    assert_eq!(hive, RegHive::User, "{}", t.id);
                    if name == "AccentPalette" {
                        palette = Some(data);
                    }
                }
                other => panic!("{}: unexpected {other:?}", t.id),
            }
        }
    }
    let Some(RegData::Binary(bytes)) = palette else { panic!("no AccentPalette") };
    assert_eq!(bytes.len(), 32);
    assert_eq!(&bytes[12..15], &[0x5b, 0x45, 0xa2], "the seed is the fourth entry");
}
