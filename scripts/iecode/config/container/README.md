# IECODE sealed product

The Aphrody owner factory builds Rust, Bun and .NET outputs on the qualified target.
`scripts/iecode/build/package-release.ts` combines their complete inventories, verifies
every byte and prepares a new external Docker context. The input lists the expected
products separately from delivered products; missing outputs block sealing.

```sh
bun scripts/iecode/build/package-release.ts --input /private/release-input.json --output /private/releases/new
bun scripts/iecode/build/package-release.ts --input /private/release-input.json --output /private/releases/new --apply
```

Use `scripts/iecode/build/bun-artifacts.ts` for workspace packages and standalone Bun tools,
and `scripts/iecode/build/managed-artifacts.ts` for the four managed products. Cargo outputs
come from the serialized Aphrody factory. Compilation receipts preserve targets,
features, source revisions and hashes. A compiled desktop binary still requires its
display and graphics runtime qualification.

The runtime follows the sealed precompiled artifact pattern used by Aphrody. It uses
Ubuntu 26.04 for the Bun GNU release ABI, the pinned .NET 10 runtime,
and a non-root user. Build only the generated `image` directory. Keep the image ID
in the host-specific Infra plan before activation; this recipe does not change host
allocation or install a new deployment controller.

SQLite databases are consistent snapshots, including committed WAL pages. They
remain in `private-volume-payload` outside the image context and Git. Transfer them
through the owner Infra transport, verify their receipt hashes and provision a new
IE-labelled volume. Never overwrite an existing database during release activation.
Postgres remains a separate persistent service under the existing IE storage
configuration and password-file secret. Keep provider stores separate.

Compose the existing storage recipe with `compose.product.json`, or pass these
services through the canonical host Infra project. `IECODE_PRODUCT_IMAGE` must be
an immutable digest or verified local image ID. The default command is a runtime
probe; select a packaged tool explicitly in the host plan. GUI outputs need a
qualified display target. Retain the previous release and data volumes for rollback.

The optional `compose.steamcmd.json` profile builds a separate Valve SteamCMD
helper. Set `IEVR_GAME_DIR` in the protected `~/.config/nie/steam.env` to the
absolute `data/` directory on the Docker host. That bind mount points both
SteamCMD and the Steam client at the actual NIE game-data directory; the client
mount is read-only.

```sh
docker compose --env-file ~/.config/nie/steam.env -f config/container/compose.steamcmd.json build steamcmd
docker compose --env-file ~/.config/nie/steam.env -f config/container/compose.steamcmd.json --profile steamcmd run --rm steamcmd
```

SteamCMD state, including its local login cache, stays in the separate
`ie-steam-state` volume. The command opens an interactive SteamCMD session;
authenticate there without putting credentials in command arguments or Compose
environment. Proton tools are stored separately in the persistent
`ie-proton-runtime` volume. The current VPS volume contains Proton 5.13
(app 1420170), with its manifest at the library root and payload under
`common/Proton 5.13`; the Steam client mounts that library read-only. Install
IEVR with `force_install_dir
/var/lib/iecode/data` and SteamCMD's `app_update 2799860 validate` after
authentication. Check that the game-data filesystem has at least 75 GB free
before downloading the game.
The first run copies SteamCMD into the persistent state volume before its
self-update, so `run --rm` keeps the updated client across later containers.

An optional `steam-client` profile installs Valve's Linux Steam launcher in a
separate Xvfb/Openbox container. Steam client auth lives in the dedicated
`ie-steam-client-state` volume, separate from SteamCMD auth and NIE tokens.
Proton lives in `ie-proton-runtime`; the game-data bind mount is read-only in
the UI container. The noVNC port is published only on
VPS loopback (`127.0.0.1:6080`), so reach it through the existing SSH alias:

```sh
scp config/container/apparmor-steam-client vps:/tmp/iecode-apparmor-steam-client
ssh vps 'sudo install -D -m 0644 /tmp/iecode-apparmor-steam-client /etc/apparmor.d/containers/iecode-steam-client && sudo apparmor_parser -r -W /etc/apparmor.d/containers/iecode-steam-client'
docker compose --env-file ~/.config/nie/steam.env -f config/container/compose.steamcmd.json --profile steam-client up -d --build steam-client
ssh -N -L 6080:127.0.0.1:6080 vps
```

The AppArmor profile follows Docker's container policy and enables user and
mount namespace mediation for this container. Its seccomp profile starts from
Docker Engine 29.1.3's default and allows `clone`/`unshare` combinations that
include `CLONE_NEWUSER`, plus `CLONE_NEWNS` alone for nested user-namespace
work. It also allows the mount syscalls Bubblewrap needs; the kernel still
requires `CAP_SYS_ADMIN` in the target namespace, and this container receives no
host `CAP_SYS_ADMIN`. The Steam auth volume stays private to this host. Do not
disable AppArmor or seccomp globally.

Open `http://127.0.0.1:6080/vnc.html` and sign in through Steam's UI. Do not put
the password, Steam Guard code, or session cookies in Compose or repository
files. The service mounts the product-data path read-only and shares the
SteamCMD-managed Proton volume; the NIE downloader remains the owner of the
game-data contents.

`cloudflare-product.json` declares the NIE, IECODE and RG domains, the two private
EU R2 buckets and the Frankfurt Neon target. The Aphrody Infra adapter
`scripts/iecode/tools/infra/iecode-cloudflare.ps1` plans, provisions and verifies the
buckets using the existing protected owner credential. Its receipt verifies EU
jurisdiction and disabled public access. Bucket provisioning does not activate
the three domains or upload product data; those steps require qualified origins
and sealed artifact manifests. Neon provisioning requires the authenticated owner
account. Existing Better Auth and PostgreSQL remain the RG authentication owners.
