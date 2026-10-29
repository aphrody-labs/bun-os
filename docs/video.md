# Bun video integration

Video is the current priority. The source library is pinned to FilmCraft
`87b845138e2cecf43e97e2c2e011b820a6e70ecd` (0.7.2, MIT OR Apache-2.0).
Its Rust workspace remains independent.

The fork adds Bun-native JavaScript helpers. Rust and Cargo remain identical to
the upstream baseline `cee1feb185e675a108f78067f71ad86a640ace3d`, also used by
the parallel native codec owner.

## Owners

| Capability | Owner |
| --- | --- |
| Project loading, schemas 1–15 and atomic saves | filmcraft-format |
| Exact time and rational frame rates | filmcraft-time |
| Container probing and codecs | filmcraft-codecs / filmcraft-media |
| Editing and command validation | filmcraft-engine |
| Rendering and export | filmcraft-render / filmcraft-export |
| Native Bun metadata and frame API | Bun.Video |
| Typed process boundary | @aphrody/bun-video-project |

The adapter calls the existing headless CLI with structured arguments and JSON.
It adds output limits, cancellation and typed operations. Rust retains project
migrations, editing rules, codecs and export. No FFmpeg subprocess or copied
decoder is introduced.

Failed native operations retain structured results and failure status. Export
uses a new destination directory to isolate filenames derived by native formats.

Tick values use 254,016,000,000 units per second. Ticks and IDs span i64/u64;
the JSON boundary preserves large integers as bigint. JSONL serialization emits
their exact decimal representation rather than rounded Numbers.

## Commands

```sh
bun run video doctor
bun run video:build
bun run video commands
bun run video probe /path/to/media.mp4
bun run video inspect /path/to/project.fcproj sequence
```

Use `.local/config.json` to select an existing `filmcraft-cli` binary, or build
the pinned library through the native workspace owner. API calls do not build
the engine implicitly. Save destinations are explicit; protected provider
stores, captures and datasets are outside this integration.

The parallel Bun session owns native codec internalization. The installed
`1.4.4` runtime at `2ae8fc65fba1d05c423a2433b1195835109942b6` currently has no
Bun.Video API. The adapter reports this and does not substitute an unqualified
provider. Native availability alone does not qualify codecs, video encoding or
frame accuracy. See [qualification](qualification.md).

## Bun Video package

`vendor/bun-video` mounts [aphrody-labs/bun-video](https://github.com/aphrody-labs/bun-video). It runs on the
unmodified npm `bun` canary with documented APIs only: `Video` from `@aphrody/bun-video/native-video` spawns the
caller's FFmpeg/FFprobe and uses `Bun.Image`; there is no `Bun.Video` or `bun:video`. Composition (Remotion 4.0.539,
HyperFrames 0.8.214), HLS/DASH, mediabunny 1.63.0, yt-dlp 2026.10.26 and WebGPU compute are TypeScript on top.
The fork-only scripts and the FilmCraft-backed native layer are legacy; see `vendor/bun-video/docs/upstream-bun.md`.
