# Provenance of the Waydroid integration

- Upstream: https://github.com/waydroid/waydroid, GPL-3.0 (`LICENSE` kept in `vendor/waydroid` and `crates/bun-waydroid`).
- Fork: https://github.com/aphrody-labs/waydroid, mounted at `vendor/waydroid` (remote `upstream` = waydroid/waydroid).
- Pinned upstream commit: `db7294c4c2bd43157bab94cf8a3015e22d9f1ad8` (main, 2026-10-29; tools version 1.6.3).
- No upstream file is modified. `crates/bun-waydroid` is a port of the management logic and is GPL-3.0-or-later.

| Rust (crates/bun-waydroid) | Upstream |
| --- | --- |
| `ota.rs` | `tools/helpers/images.py`, `tools/actions/initializer.py` (channel URLs, newest build, SHA-256) |
| `binder.rs` | `tools/helpers/drivers.py` (node families, binderfs `BINDER_CTL_ADD`) |
| `cfg.rs` | `tools/config/__init__.py` (`waydroid.cfg` keys and defaults) |
| `props.rs` | `tools/helpers/props.py`, `images.make_prop` |
| `lxc.rs` | `tools/helpers/lxc.py` `set_lxc_config` |

Resync: `git -C vendor/waydroid fetch upstream && git -C vendor/waydroid merge --ff-only upstream/main`, diff the files above
against the table, update the pinned commit here and in `docs/ANDROID.md`.
