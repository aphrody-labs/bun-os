# Owned dumps

Bun Engine and the bep emulators are qualified against the owner's own dumps:
BIOS, firmware and console keys dumped from consoles the owner owns, and ROMs
and disc images dumped from games the owner bought. `bep` ingests these files,
verifies them, stores them privately and runs them headless. It never downloads,
searches for or fetches copyrighted ROMs, BIOS or keys. Every byte comes from a
file the owner supplies.

## Legal scope

- **Personal dumps only.** Each file is dumped by the owner from hardware or
  software the owner owns. bep does not acquire dumps from anywhere else.
- **Private testing only.** Dumps are used to test Bun Engine and the
  emulators on the owner's machines and the owner's VPS test host.
- **No distribution.** Dumps are never committed, never published in the
  play.aphrody.app catalog and never served without authentication. The
  signed-in upload page receives files but never returns their bytes. Bucket
  copies are encrypted on the client before upload.
- Free replacements (OpenBIOS, Normmatt's GBA BIOS) and freely redistributable
  homebrew and test ROMs stay in the separate public registries
  (`free-firmware.json`, `roms.json`). Only those registries feed the public
  catalog.

## Pipeline

The pipeline handles one file at a time:

1. **Detect.** The formats registry (`packages/bun-engine/src/formats`)
   identifies the format, header, title, serial and region by content.
   Archives (zip, tar, tar.gz through `Bun.Archive`; 7z, rar and xz through
   bep's 7-Zip owner) are unpacked into `usr/var/tmp/bep-owned` and their
   members are ingested. Key files (`prod.keys`, `title.keys`,
   `aes_keys.txt`, `seeddb.bin`, `boot9.bin`, `otp.bin`, `movable.sed`, and
   any `name = hex` key list) are recognised before anything else.
2. **Hash.** One streaming pass computes CRC32, MD5, SHA-1, SHA-256 and the Git
   blob id. Multi-GB disc images are never loaded into memory.
3. **Verify.** Each dump gets one of three statuses:
   - `verified`: the hash matches a No-Intro or Redump DAT of
     `vendor/libretro-database` (CRC32 and size, MD5, or the headerless CRC),
     a BIOS in `plugins/consoles/firmware.json`, or a BIOS MD5 from
     `vendor/libretro-core-info`.
   - `bad-dump`: the hash matches a `[b]` entry, a header check fails
     (complement, CRC, checksum or logo), or the header serial is in the DAT
     with a different size (trimmed or overdumped).
   - `unverified-good-dump`: the structure is sound but the hash is in no
     table. This covers homebrew, prototypes, undumped revisions and keys.
   An ambiguous disc image (ISO, CHD, CUE or `.bin`) is only filed under a
   system that a DAT or a serial confirms. Otherwise, pass `--system`.
4. **Store.** Dumps are content-addressed and deduplicated by SHA-256. Each
   new name of a known dump is added to its record.

   | Kind     | Path                                                  |
   | -------- | ----------------------------------------------------- |
   | firmware | `usr/share/bun-engine/firmware/<console>/<sha256>.<ext>` |
   | ROM      | `usr/share/bun-engine/roms/<console>/<sha256>.<ext>`     |
   | keys     | `usr/share/bun-engine/keys/<console>/<sha256>.<ext>`     |

   Firmware and ROMs get a `.json` manifest with `origin: "owned"`, so the
   library, launch routing and `bep install` see them, and
   `bep cache prune` never removes them. The metadata lives in the `owned`
   table of `usr/var/lib/bep/library.db` (bun:sqlite).
5. **Keys.** The keys store is owner-only. On Windows it has a protected DACL
   (OWNER RIGHTS and SYSTEM) set through `bun:windows` (fork-only API, not available on upstream Bun). Elsewhere it uses
   modes 0700 and 0600. Key values are never logged or returned. Listings
   show the key names and the store id only, with no digests of the key
   material.

`usr/` is gitignored, so the stores, the inbox and the reports never reach
Git.

## Commands

```sh
bep import <file|dir|archive...> [--system <id>]   # ingest what you supply
bep owned ls [--kind firmware|rom|keys] [--system <id>]
bep owned rm <sha...>                               # forget and delete (free imports are kept)
bep owned inbox [--watch]                           # usr/var/inbox drop folder
```

### Drop folder

Files dropped into `usr/var/inbox` are ingested once their size stops
changing, then removed. A file that fails moves to `usr/var/inbox/.rejected`
with an `.error.txt` note. Run `bep owned inbox --watch` to keep watching the
folder.

### play.aphrody.app

The signed-in page `/api/owned/drop` accepts drag and drop. Uploads are
resumable 8 MiB chunks:

| Method and route                       | Purpose                         |
| -------------------------------------- | ------------------------------- |
| `GET /api/owned/upload/:id`            | Bytes received so far           |
| `PUT /api/owned/upload/:id?offset=N`   | Upload one chunk                |
| `POST /api/owned/upload/:id/done`      | Ingest through the inbox        |

`GET /api/owned` lists the store. The routes come from
`packages/bun-engine/src/owned/http.ts`. `apps/play/src/server/app.ts` wraps
every route in the session and same-origin guard. The engine's
`/api/owned/upload/` location accepts 16 MiB bodies, unbuffered. Elsewhere
the limit stays at 1 MiB.

### Private bucket

```sh
bep owned push [<sha...>|--all] [--to r2:private/owned|file:<dir>] [--part-size 32M] [--limit 8M]
bep owned pull <sha> <file> [--from <target>] [--limit 8M]
bep owned forget <sha...> [--from <target>]
```

**Encryption.** Each part is compressed with `Bun.zstdCompress` and then
sealed with AES-256-GCM through Web Crypto. The keys are derived with HKDF
from a master secret in the OS credential store (`Bun.secrets`
`aphrody.bun-engine/owned-dumps-key`). bep creates the secret on first use and
never prints it. Object names are HMACs of the SHA-256, so the bucket sees
neither titles nor hashes. The manifest is encrypted too.

**Resume.** Part IVs are derived from the SHA-256 and the part index, so a
re-sealed part is byte-identical. Parts that `owned_sync` already records as
uploaded and that are still present remotely are skipped.

**Integrity.** After upload, bep checks each part's size and ETag (MD5). On
restore, it checks each sealed part against the SHA-256 in the manifest,
checks the GCM tags, and checks the SHA-256 of the whole dump. A tampered
part aborts the restore.

**Transport.** bep moves the sealed bytes through the platform transfer
service (`@bun-os/platform/transfer`, `objectTarget`). The default target
is `r2:private/owned`: the private R2 bucket of the platform settings
(`bun-os-private`, no public URL), under the `owned/` prefix. The platform
holds the R2 credentials in its protected store, refuses any bucket other than
the configured private one, and applies `--limit` together with its global
bandwidth cap. `file:<dir>` targets are for local tests only.

### VPS test host

```sh
bep owned sync vps [<sha...>] [--limit 4M] [--keys] [--system <id>] [--prune]
```

This mirrors the store over the wg1 mesh (`ssh vps`) into `/games/private`,
which gets mode 0700 and a `*` `.gitignore`. Files are written with mode 0600.
The transfer is kept light:

- one file at a time;
- throttled on the sending side (4 MiB/s by default);
- `nice` and idle I/O priority on the VPS;
- an interrupted file resumes from its `.part`;
- the file is published only when `sha256sum` matches.

Key files are only sent with `--keys`. `--prune` removes remote dumps that are
no longer in the local store.

### Tests

```sh
bep test owned [<sha...>] [--system <id>] [--frames 180] [--timeout 120000] [--no-roms] [--no-bios]
```

**ROMs.** Every owned ROM runs on its launch route. On the native Bun Engine
machine, it runs headless for N frames with the owner's BIOS when one is
stored. On a bep release emulator or RetroArch, it runs in check mode.

**BIOS.** Every owned BIOS boots its native machine instead of the free
replacement. The PlayStation BIOS boots alone. The GBA BIOS boots under a free
test cartridge. When a free image exists, bep runs it as well for comparison.

**Report.** bep records, for each run:

- a frame hash (SHA-256 of the final screens);
- a PNG screenshot and a 160 px nearest-neighbour thumbnail (`Bun.Image`);
- the status: `pass`, `blank`, `fail`, `timeout` or `skipped`.

Everything goes to `usr/var/lib/bep/owned-tests/<run>/report.json` and the
`owned_tests` table. Reports stay private.

## Guards

- **Pre-commit hook.** `bep owned hook` installs a hook that runs
  `packages/bun-engine/src/owned/guard.ts --staged` and chains any existing
  hook. The hook rejects:
  - private store paths;
  - ROM, disc image and key extensions;
  - BIOS, firmware and key file names;
  - any staged blob whose Git object id equals an owned dump, which catches
    renamed copies without reading file contents.
- **Public build.** `apps/play/scripts/build.ts` refuses to copy a ROM from
  the private store into the public catalog.
- **Server start.** The play server refuses to start when its public or
  emulation root overlaps a private store (`assertPublicRoot`).
