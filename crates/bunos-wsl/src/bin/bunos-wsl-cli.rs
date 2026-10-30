// SPDX-License-Identifier: GPL-3.0-only
//! `bunos-wsl-cli`: the same operations as the desktop manager, as JSON on stdout. `bunos wsl ...`
//! (src/cli.ts) and `@aphrody/windows` `wsl` call this binary. On a non-Windows host (or with
//! `WSL_MOCK=1`) the executor is the fixture mock, so CI can run every command without WSL.

use bunos_wsl::bunos::{
    detect, ini, install,
    manifest::{self, ArtifactKind, Manifest},
    session, status,
};
use bunos_wsl::wsl::executor::wsl_executor;
use bunos_wsl::{utils, wsl};
use std::path::{Path, PathBuf};

fn usage() -> ! {
    eprintln!(
        "usage: bunos-wsl-cli <command>\n\
         \x20 list | status | version\n\
         \x20 inspect <distro>\n\
         \x20 kernel get | kernel set <bzImage> [<modules.vhdx>] | kernel unset\n\
         \x20 manifest <artifact-dir> --release <tag> --base-url <url> [--out <file>]\n\
         \x20 verify <manifest.json> <artifact-dir>\n\
         \x20 install <manifest.json> <artifact-dir> --dir <install-dir> [--name N] [--no-kernel] [--default] [--dry-run]\n\
         \x20 session <distro> <weston|hyprland-nested|hyprland-headless>\n\
         \x20 limits <distro> [--memory-mib N] [--cpu-percent N]"
    );
    std::process::exit(2)
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn print<T: serde::Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).expect("serialize"));
}

fn fail(msg: impl std::fmt::Display) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(1)
}

fn wslconfig_path() -> PathBuf {
    utils::get_user_profile().join(".wslconfig")
}

fn read_manifest(path: &str) -> Manifest {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| fail(format!("{path}: {e}")));
    Manifest::parse(&text).unwrap_or_else(|e| fail(e))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let exec = wsl_executor();
    match args.first().map(String::as_str) {
        Some("list") => {
            let out = exec.list_verbose().unwrap_or_else(|e| fail(e));
            print(&bunos_wsl_core::parse_wsl_list_output(&out.stdout));
        }
        Some("status") => {
            let out = exec.status().unwrap_or_else(|e| fail(e));
            print(&status::parse_wsl_status(&out.stdout));
        }
        Some("version") => {
            let out = exec.version().unwrap_or_else(|e| fail(e));
            print(&wsl::parse_wsl_version_output(&out.stdout));
        }
        Some("inspect") => {
            let name = args.get(1).map(String::as_str).unwrap_or_else(|| usage());
            print(&detect::inspect_distro(exec, name).unwrap_or_else(|e| fail(e)));
        }
        Some("kernel") => {
            let path = wslconfig_path();
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            match args.get(1).map(String::as_str) {
                Some("get") => print(&detect::kernel_selection(&text)),
                Some("set") => {
                    let kernel = args.get(2).unwrap_or_else(|| usage());
                    let mut t =
                        ini::set(&text, "wsl2", "kernel", &ini::escape_windows_path(kernel));
                    if let Some(m) = args.get(3) {
                        t = ini::set(&t, "wsl2", "kernelModules", &ini::escape_windows_path(m));
                    }
                    std::fs::write(&path, t).unwrap_or_else(|e| fail(e));
                    print(&detect::kernel_selection(
                        &std::fs::read_to_string(&path).unwrap_or_default(),
                    ));
                }
                Some("unset") => {
                    let t = ini::unset(
                        &ini::unset(&text, "wsl2", "kernel"),
                        "wsl2",
                        "kernelModules",
                    );
                    std::fs::write(&path, t).unwrap_or_else(|e| fail(e));
                    print(&detect::KernelSelection::default());
                }
                _ => usage(),
            }
        }
        Some("manifest") => {
            let dir = args.get(1).unwrap_or_else(|| usage());
            let release = flag(&args, "--release").unwrap_or_else(|| usage());
            let base = flag(&args, "--base-url").unwrap_or_else(|| usage());
            let m = manifest::manifest_from_dir(Path::new(dir), release, base, &|k| match k {
                ArtifactKind::Kernel | ArtifactKind::KernelModules => {
                    std::env::var("BUNOS_KERNEL_VERSION").unwrap_or_else(|_| "unknown".into())
                }
                ArtifactKind::WslgSystem => {
                    std::env::var("BUNOS_WSLG_VERSION").unwrap_or_else(|_| "unknown".into())
                }
                ArtifactKind::Rootfs => release.to_string(),
            })
            .unwrap_or_else(|e| fail(e));
            let json = serde_json::to_string_pretty(&m).expect("serialize");
            match flag(&args, "--out") {
                Some(out) => std::fs::write(out, format!("{json}\n")).unwrap_or_else(|e| fail(e)),
                None => println!("{json}"),
            }
        }
        Some("verify") => {
            let m = read_manifest(args.get(1).unwrap_or_else(|| usage()));
            let dir = Path::new(args.get(2).unwrap_or_else(|| usage()));
            let mut bad = 0;
            for a in &m.artifacts {
                match manifest::verify_artifact(&dir.join(&a.name), a) {
                    Ok(()) => println!("ok       {} {}", a.sha256, a.name),
                    Err(e) => {
                        bad += 1;
                        println!("FAILED   {} ({e})", a.name);
                    }
                }
            }
            std::process::exit(if bad == 0 { 0 } else { 1 });
        }
        Some("install") => {
            let m = read_manifest(args.get(1).unwrap_or_else(|| usage()));
            let dir = PathBuf::from(args.get(2).unwrap_or_else(|| usage()));
            let install_dir = flag(&args, "--dir").unwrap_or_else(|| usage());
            let mut req = install::InstallRequest::new(install_dir, &dir);
            if let Some(n) = flag(&args, "--name") {
                req.distro_name = n.to_string();
            }
            req.use_kernel = !args.iter().any(|a| a == "--no-kernel");
            req.make_default = args.iter().any(|a| a == "--default");
            let cfg = wslconfig_path();
            let text = std::fs::read_to_string(&cfg).unwrap_or_default();
            let plan = install::build_plan(&m, &req, &cfg, &text).unwrap_or_else(|e| fail(e));
            if args.iter().any(|a| a == "--dry-run") {
                print(&plan);
                return;
            }
            install::execute(&plan, &m, &dir, exec, &mut |l| eprintln!("{l}"))
                .unwrap_or_else(|e| fail(e));
            print(&plan);
        }
        Some("session") => {
            let distro = args.get(1).unwrap_or_else(|| usage());
            let c = session::Compositor::parse(args.get(2).unwrap_or_else(|| usage()))
                .unwrap_or_else(|| usage());
            session::apply_session(exec, distro, c).unwrap_or_else(|e| fail(e));
            print(&c);
        }
        Some("limits") => {
            let distro = args.get(1).unwrap_or_else(|| usage());
            let limits = session::DistroLimits {
                memory_mib: flag(&args, "--memory-mib").and_then(|v| v.parse().ok()),
                cpu_percent: flag(&args, "--cpu-percent").and_then(|v| v.parse().ok()),
            };
            session::apply_limits(exec, distro, limits).unwrap_or_else(|e| fail(e));
            print(&limits);
        }
        _ => usage(),
    }
}
