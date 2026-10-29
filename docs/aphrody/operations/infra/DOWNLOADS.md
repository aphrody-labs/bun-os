<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody downloads: site, publisher and GitHub releases

Owner order of 2026-10-06 (explicit publication authority for exactly this scope): the single `aphrody`
multi-call binary (it carries the MCP server, `aphrody-mcp`), the Bun CLI `yolo` with its runtime artifact, SDK and
templates, and the Aphrody and yolo plugins are downloadable from our site and from GitHub releases of
existing repositories.

## Public path and its limits

| Path | Content | Auth |
| --- | --- | --- |
| `https://downloads.aphrody.com/` | index page | none, by design |
| `https://aphrody.com/`, `https://www.aphrody.com/` | separate product site on the VPS; www redirects to the apex | none, by design |
| `/latest.json` | manifest: `name`, `version`, `platform`, `target`, `url`, `sha256`, `size` per artifact | none, by design |
| `/SHA256SUMS`, `/files/<file>.sha256` | checksums of the current release | none, by design |
| `/install.sh`, `/install.ps1`, `/install-yolo.sh`, `/install-yolo.ps1` | one-line installers | none, by design |
| `/files/<file>` | archives, immutable file names `<component>-<version>-<commit9>-<target>.<ext>` | none, by design |
| `/health` | liveness of the origin (503 until a release is published) | none, loopback and through nginx |

The site is read-only (GET and HEAD only), serves nothing but published, checksummed release files and exposes no
write endpoint, so it stays public and unauthenticated like `cdn.aphrody.com`. GitHub release assets of private
repositories need an authenticated token: the download server is the public path.

Since the 2026-10-10 cutover, the downloads publisher owns only
`downloads.aphrody.com`. The apex/www and `os.aphrody.com` have separate native
nginx vhosts and app-ui deployments; `/docs` at the apex is proxied to the Rust
site. The former downloads-hosted Bun fork site is not the current apex origin.

One click on Windows: the « Download Aphrody » button of the index takes the first artifact of kind `desktop`,
`Aphrody-Setup.exe` (`packages/infra/product`, 2026-10-06). It installs or repairs aphrody, yolo, the desktop app (once
`aphrody-app` is published), the three plugins as the local Claude Code marketplace `aphrody-local`, declares the
aphrody MCP server in Claude Desktop (backup first) and Claude Code, makes a shortcut, and offers the administrator
(omar-kit access steps and `Aphrody-Omar.exe`) and creator (`creator-kit.exe`) roles. One line does the same from a
shell, every component by default (`all`: unpublished ones are skipped with a note, named ones must install):

```sh
curl -fsSL https://downloads.aphrody.com/install.sh | sh
curl -fsSL https://downloads.aphrody.com/install.sh | APHRODY_COMPONENTS="aphrody" sh
```

```powershell
irm https://downloads.aphrody.com/install.ps1 | iex
```

Each installer checks every download against the release `SHA256SUMS`, runs the new binary before linking it, and
calls `aphrody self install-path` so the former standalone names (`aphrody-mcp`, `aphrody-infra`, `aphrody-kernel`,
...) are links to the single binary. `yolo` goes through `packages/engine/yolo/install.sh` (published as `install-yolo.sh`),
whose layout, relative to `~/.yolo`, is bin/, artifact/ (verified runtime), packages/runtime/, templates/ and crates/.

## Components

Declared in `tools/config/downloads.json`.

| Component | Source | Platforms |
| --- | --- | --- |
| `aphrody` | factory build of a pushed revision: `scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody --bin aphrody` | linux x86_64 (glibc 2.39 gate through `scripts/audit/elf-glibc-imports.ts --max 2.39`), windows x86_64 when the factory has an `xwin` build |
| `yolo` | `bun build --compile` of `packages/engine/yolo/src/index.ts`, verified runtime artifact `~/.yolo/runtime/<target>/current` plus its installed packages/runtime/ and templates/ | linux x86_64 |
| `aphrody-setup` (kind `desktop`) | local stage `scripts/release/stage-setup.ts`: Bun compile of `packages/infra/product`, pet icon by rcedit under Wine, not signed; the `.exe` and its flat `.tar.gz` update archive | windows x86_64 |
| `omar-kit` (kind `kit`) | local stage `scripts/release/stage-omar-kit.ts`: the pack zip and the flat `.tar.gz` its updater reads | windows x86_64 |
| `aphrody-app` (kind `desktop-app`) | Tauri NSIS installer of `crates/ui/app`, installed by the setup with `/S` | declared, disabled: no Windows build of the desktop app yet |
| `plugin-aphrody`, `plugin-yolo` | `git archive` of the pushed HEAD of `plugins/aphrody` and `plugins/yolo` (tracked files only) | any (tar.gz and zip) |

Not published, and why (also written in `latest.json` `notes`): macOS (no target declared by the factory or the
toolchain catalog), Windows `yolo` (no packaged `yolo-runtime` artifact for Windows).

No signature: the repository defines no signing key for CLI artifacts (only the unset `APHRODY_UPDATER_PUBKEY` and
`TAURI_SIGNING_PRIVATE_KEY` names of the desktop updater). Integrity is SHA-256, checked by the host after every
upload and by the installers.

## One-command republish

```sh
bun run downloads:publish plan
bun run downloads:publish build   --revision <full-sha>     # factory prepare + build, waits for the jobs
bun run downloads:publish release --revision <full-sha>     # stage (local Bun stages included: Wine and rcedit), secret scan, upload, flip `current`
bun run downloads:publish github                            # releases on the configured existing repositories
bun run downloads:publish verify                            # public download, SHA-256, `--version`
bun run downloads:publish host-plan                     # native host/certificate preflight and app refresh plan
bun run downloads:publish host-apply --apply             # refresh app on the provisioned systemd/nginx host
```

`release` refuses to publish when a staged archive or the factory binary contains a denied file name (`.env`, keys,
databases, model weights, cookies) or a token-shaped string (patterns in `tools/config/downloads.json`). The release tree
is `/home/ubuntu/apps/downloads/releases/<UTC>-<commit12>` on the vps; `current` is flipped atomically and the last five
releases are kept. Run it from a pushed, building revision; never Cargo in WSL.

## Host (vps, through `aphrody infra ssh`)

- Native unit `aphrody-downloads.service`, declared in
  `tools/config/host/systemd/aphrody/aphrody-downloads.service`: Bun on
  `127.0.0.1:8797`, app `/home/ubuntu/apps/downloads/app/server.ts`, immutable
  releases under `/home/ubuntu/apps/downloads/releases`; catalog entry
  `aphrody-downloads` in `tools/config/service-catalog.json`, route in
  `tools/config/host/nginx/routes.json`, port in `tools/config/production-topology.json`.
- nginx vhost `tools/config/host/nginx/aphrody/downloads.aphrody.com.conf`: nginx sends `/files/` itself (sendfile, ranges),
  proxies the rest. Shared certificate `aphrody.com` includes downloads in its
  SAN; the existing certbot timer renews it with `/var/www/letsencrypt`.
- `host-apply` requires the configured target/unit/port/release root to match
  the service catalog, the native unit to exist, Bun to be executable, the
  certificate to be valid for the declared hosts and nginx to pass validation
  before uploading anything. It refreshes the app, restarts the unit, requires
  loopback health and reloads native nginx. It does not provision a missing
  host or issue a replacement certificate.
- The build factory and release host are both `vps`; no DBFR push is configured.
  A previous immutable release remains available for a declared rollback.

Live qualification on 2026-10-10: native unit active, nginx validation passed,
public `/health` and `/latest.json` returned 200 with certificate validation,
and Aphrody Web rendered the download page. Publisher tests passed on an
isolated native VPS snapshot: 18 tests / 160 assertions, no failure or skip,
including preservation of previous artifacts, failed-upload rollback and
concurrent-publication refusal. Those fixture tests do not mutate production.

## Windows cross-build

The factory host has `clang-cl`, `lld` and the `x86_64-pc-windows-msvc` Rust target. 2026-10-06: `cargo-xwin` 0.23.1 was
installed there with `cargo binstall` (declared `windowsBuild` method of `tools/config/host/toolchain.json`); the Windows
SDK/CRT splat is downloaded by `cargo xwin` on first use into `~/.cache/cargo-xwin` (copying the 1.1 GiB local splat
over the current uplink was not practical).

## API convergence (vps, 2026-10-06)

Observed with `aphrody infra service status` and `systemctl`: `aphrody-downloads` (new), `aphrody-fonts-proxy` (declared
active but never installed: unit, app tree `/home/ubuntu/apps/cdn/{app,src}` from the yolo release, certificate and vhost
`cdn.aphrody.com` now installed; the vhost challenge webroot was aligned on `/var/www/letsencrypt`),
`aphrody-discord-dev`, `redis-server`: enabled and active.
Declared `retired` services (`aphrody-site`, `aphrody-web-api`, `aphrody-ai-http`,
`aphrody-embed`, `aphrody-a2a`) stay retired: reviving them is a catalog decision (convergence plan).

Public without authentication, by catalog design: `downloads.aphrody.com`/`aphrody.com`, `cdn.aphrody.com` (font proxy,
GET/HEAD only), and `bot.aphrody.com` (Discord endpoints,
signature-checked by the bot). Observed, not changed: Postgres listens on 0.0.0.0:5432 behind the INPUT DROP firewall, and
ufw allows 3080/tcp with no listener.
