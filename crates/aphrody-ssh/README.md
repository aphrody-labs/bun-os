# aphrody-ssh

`aphrody-ssh` is the native, scriptable SSH operator for the OpenSSH aliases
configured on the host. It deliberately delegates authentication and host-key
verification to OpenSSH; private keys and rclone configuration never enter the
repository.

```powershell
cargo run -p aphrody-ssh -- status --host ovh-vps
cargo run -p aphrody-ssh -- --json status --host dbfr
cargo run -p aphrody-ssh -- ports --host ovh-vps
cargo run -p aphrody-ssh -- logs --host dbfr nginx --lines 100
cargo run -p aphrody-ssh -- service --host ovh-vps --action is-active nginx
cargo run -p aphrody-ssh -- health --host ovh-vps https://example.com/health
cargo run -p aphrody-ssh -- exec --host ovh-vps "hostname; uptime"
cargo run -p aphrody-ssh -- --json compare --host ovh-vps --local C:\work\aphrody --remote <remote-checkout>
cargo run -p aphrody-ssh -- sync --host ovh-vps --source C:\work\aphrody --destination ~/transfer/aphrody
cargo run -p aphrody-ssh -- sync --host ovh-vps --source C:\work\aphrody --destination <remote-checkout> --apply
```

`stop` and `disable` require `--confirm`. All operations have a 30-second
process timeout and return non-zero on SSH or remote failure. JSON output is
stable enough for PowerShell, CI, and monitoring consumers.

The `ovh-vps` selector is a CLI alias for the configured local OpenSSH host
`vps`; the command still delegates authentication and host-key verification to
OpenSSH. SSH runs in `BatchMode` with a ten-second connection timeout so a
health check cannot wait for interactive input.

`sync` is always a dry-run unless `--apply` is present. It includes regular
assets and untracked files, excludes `.git`, `.env*`, `.ssh`, dependency/build
trees, and never deletes remote files. Review the dry-run before applying.

`proxy` forwards a local SOCKS5 port to a remote endpoint given by `--remote <host:port>` or
`APHRODY_SSH_PROXY_REMOTE`; there is no built-in address, the value comes from aphrody-infra.
Deployment is not an aphrody-ssh command: releases, units and host tuning are owned by
aphrody-infra (its pipeline and `scripts/`).

```powershell
cargo run -p aphrody-ssh -- tunnel --dry-run --json
cargo run -p aphrody-ssh -- tunnel --services db-tunnel,redis --offset 20000
cargo run -p aphrody-ssh -- tunnel status --json
```

`tunnel` opens local port-forwards to `tools/config/service-catalog.json` services, one `ssh -N -L ...`
process per SSH alias, so application repositories stop hand-rolling `ssh -L`.
Without `--services` it opens the default dev set (`aphrody-ai-http`, `redis`). The local port is the remote port
plus `--offset` (default `10000`), except for entries whose catalog `health` is already a
`tcp://` probe of a local-facing port (a `db-tunnel` entry keeps its `15433`); the SSH alias comes
from the entry's `target` prefix (`dbfr:...`) when present, else defaults to `vps`. Local ports
already listening are skipped. The catalog path is `--catalog`, `APHRODY_INFRA_CATALOG`,
`APHRODY_INFRA_ROOT`, or auto-discovered by walking up from the current directory to find
`tools/config/service-catalog.json` directly or under a sibling `aphrody-infra` checkout. `tunnel status`
probes every planned local port and exits non-zero if any is down, without opening anything.
