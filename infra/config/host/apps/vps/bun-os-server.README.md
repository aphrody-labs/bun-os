# Bun OS product API service

Aphrody Infra owns this one staged service through the existing service catalog,
systemd supervisor and ingress.

Qualified on 2026-10-13: the canonical Git checkout `~/src/bun-os` is root
revision `1eedaa8ca51c06790eaae7c4bfee8e35cfce25a5`, fetched from GitHub with ancestor verification and a fast-forward update. No archive,
Rust build or recursive submodule setup was used. Filtered frozen Bun installation
selects only the server SDK graph; the unrelated Tauri checkout remains lazy.

The installed Linux runtime is `/home/ubuntu/.bun/bin/bun-1.4.4`, revision
`dfde053a3045d6076ad315b6f63160c4ced71513`. The real ELF x86-64 server
compiled under the shared Bun compiler, executed `--version`, and passed
nine local HTTP contract checks. SHA-256:
`f0c8aa2fc325af2896a76590639dbc41b38ac4bc995f071fac2dd07d2f28a1ac`.
Its receipt is `~/src/bun-os/build/apps/bun-os-server.json`, with executed=true
and deployed=false. The temporary probe process was stopped after qualification.

## Activation contract

Infra installs the qualified binary at `~/src/bun-os/install/bin/bun-os-server`;
its single unit binds loopback29030. Inject `APHRODY_APP_TOKEN` only from
`~/.aphrody/secrets/bun-os/server.env` (protected directory and file; no value
belongs in Git or command arguments). A persistent bearer was generated idempotently in this protected store. Infra
secret validation reports SECURE (1/1); directory0700 and file0600 are verified. The catalog remains staged and not required at boot.

The product API has no public ingress; add a route in `nginx/routes.json` only after
service qualification.

The typed Infra catalog, repository registry and internal-only port policy all
carry this source/service owner. Systemd candidate verification and Nginx candidate syntax checks pass. Automatic
tool review rejected the grouped unit/snippet installation, manager reload and
Infra service start before execution, with reason `blocked by policy`. No
equivalent activation retry was attempted. The actual unit is inactive; route
inclusion and service activation remain pending. Prepared files and the installed
binary are not deployment proof.

The current ELF artifact is 154165944 bytes. The fresh candidate passed runtime
and API qualification before replacing the unique canonical build and install
binaries. Both hashes match the receipt. Owned generated staging entries were
removed after verification; no previous binary or rollback archive is retained.
