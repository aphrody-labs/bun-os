# bunos-bridge

`bunos-run <linux-program> [args...]` runs a program of the Bun OS WSL distro (`bunos`, override with `BUNOS_DISTRO`)
from Windows like an .exe, as the invoking user, through `wsl.exe -d bunos --cd <cwd> --exec ...`: WSL's own access
rules apply, and no daemon is involved. Windows paths in the program, arguments (`C:\x`, `--out=C:\x`, existing `a\b`)
and working directory become Linux paths (`/mnt/c/...`, `\wsl.localhost\bunos\x` -> `/x`); stdio is inherited and the
exit code returned; environment crosses through `WSLENV`.

Verified 2026-11-03 on the workstation: `uname -r`, `sh -c 'pwd; exit 7'` (cwd `/mnt/c/src/bun-os`, exit 7), stdin
piped to `cat`, `ls 'C:\src\...'`. Cost per launch is wsl.exe's (hyperfine, 15 runs: 0.50 s ± 0.49 s, very noisy
while the VM was busy). From Git Bash set `MSYS_NO_PATHCONV=1`, or MSYS rewrites `/usr/bin/x` into a Windows path.
