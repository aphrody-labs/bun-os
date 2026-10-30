# Research log: VPS gaming host, Steam, streaming and Bevy (2026-10-17)

Findings and measurements gathered while building the Bun OS gaming stack. The sources are
linked inline. The implementations live in the owners named in each section.

## VPS hardware and disks (infra/config/host/apps/vps/gaming)

- **Host:** KVM, 12 × Intel Haswell (no TSX, x86-64-v3), 45 GiB RAM, no GPU. The display is a
  Cirrus GD 5446, so Mesa llvmpipe/lavapipe (Vulkan 1.4.354) is the only renderer.
- **Kernel and OS:** kernel 7.3.0-9 on Ubuntu 26.10 (`stonking`, glibc 2.44); WireGuard
  `wg1` 10.200.77.0/24.
- **Disk speed** (fio, random 64 KiB reads, iodepth 32):

  | Disk | Read speed | Role |
  | --- | --- | --- |
  | sda (local) | ~2.1 GB/s | holds the games volume |
  | sdb | ~15 MB/s | btrfs pool `aphrody-build-da` mounted on `/home` |
  | sdc | ~15 MB/s | same btrfs pool |

  Games therefore live on `/games`, a casefolded ext4 loop image on sda.
- **Latency:** the workstation to VPS round trip over `wg1` is ~25 ms.

## Steam

- **Session reuse:** steamcmd and the client share `config.vdf` `ConnectCache`. The key is the
  CRC32 of the account name in hex followed by `1`. Once signed in, the client moves the session
  into its own encrypted `local.vdf` and clears `ConnectCache`. After that, steamcmd needs a
  fresh interactive login.
- **Remote Play:** discovery and the control channel work directly over `wg1` (the client log
  says "connected via direct connection"). A new device needs a one-minute 4-digit PIN
  authorization on the host.
- **Downloads:** with `steam_dev.cfg`
  (`@nClientDownloadEnableHTTP2PreferenceDefault 0`,
  `@fDownloadRateImprovementToAddAnotherConnection 1.0`) and an unthrottled client, the VPS
  pulled app 454650 at ~1.1 Gbit/s from `cache*-ams1/par1.steamcontent.com`. With the client
  started `-silent`, Steam's CPU went to decompression instead of the software-rendered UI.
- **LAN cache:** Steam uses a LAN cache when `lancache.steamcontent.com` resolves to a private
  address. The Bun proxy (`packages/bun-steam/src/lancache.ts`) served 216/216 depot chunks from
  cache on the second pass, with 0 errors across 808 requests.
- **Anti-cheat runtimes:** the Proton EAC/BattlEye runtimes (Steam apps 1826330 and 1161040)
  need a signed-in account. Outside Steam, Heroic/umu take them from the Lutris runtime index
  (`https://lutris.net/api/runtimes`).
- **Web API map:** `xPaw/SteamWebAPIDocumentation` (MIT) `api.json` lists 210 interfaces and
  1127 methods: 366 callable without a key, 761 requiring one. It is the primary source of the
  `bun-steam api` index.
- **SteamDB:** steamdb.info sits behind a Cloudflare managed challenge. Bun.fetch got 451,
  curl and the Obscura static stack got 403 `cf-mitigated: challenge`, and the JS browser
  received the challenge page. SteamDB has no public API and asks not to be crawled, so its
  data is rebuilt from the Steam Web API, SteamDatabase/SteamTracking and Protobufs, and local
  PICS. The public `store.steampowered.com/api/storesearch` endpoint covers instant search.

## Streaming and remote GPU

- **API remoting:** [water-chika/vulkan_remote](https://github.com/water-chika/vulkan_remote)
  is a Vulkan ICD that forwards calls over TCP. Its server is Linux/Wayland only, and it reports
  ~39 ms per round trip on a remote link, which is not viable for games over a WAN.
- **Native wgpu client building blocks:**
  - [nchapman/tether](https://github.com/nchapman/tether) (MIT): hardware decode plus wgpu
    remote desktop;
  - [lumina-video](https://github.com/lumina-video/lumina-video) (Apache-2.0/MIT): zero-copy
    decode into `wgpu::Texture`;
  - [hgaiser/moonshine](https://github.com/hgaiser/moonshine) (BSD-2): the Moonlight protocol
    in Rust; its server needs a GPU encoder.
- **Native client result:** the loopback self-test of the result (`bun-engine stream`)
  averaged 6.1 ms from receive to present at 60 fps.
- **Server side:** [games-on-whales/wolf](https://github.com/games-on-whales/wolf) (MIT)
  encodes in software x264 in Docker. Sunshine (GPL-3.0) is the alternative. A browser cannot
  speak Moonlight, so the web client uses a GStreamer `webrtcbin` sender.

## Engine and frontend

- **Bevy:** Bevy 0.20.0 (2026-10-08) depends on wgpu ^30, the workspace GPU backend. Bevy is
  absorbed into this repository and becomes the Bun Engine runtime.
- **NGINX:** (fork-only, not available on upstream Bun) `bun:nginx` drives the pinned NGINX (`vendor/nginx` 1.31.6 + `ngx-rust` Rust
  module). The distro nginx on the VPS has no `stream` module, so play.aphrody.app terminates
  TLS in the distro nginx and proxies to the Bun-owned engine on loopback.
- **Mesa:** Mesa refuses LTO builds ("Building Mesa with LTO is not supported").
  The VPS build uses `-O3 -march=haswell` without LTO.
