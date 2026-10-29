# Aphrody / Bun Video

`@aphrody/bun-video-project` calls the pinned native video library through
structured arguments and exact JSON. Rust owns project loading, migrations,
editing, codecs, rendering and export.

```ts
import {
  createVideoLibrary,
  ticksFromDecimalSeconds,
} from "@aphrody/bun-video-project";

const controller = new AbortController();
const video = await createVideoLibrary({ signal: controller.signal });
const media = await video.probe("media.mp4");
const sequence = await video.inspect("cut.fcproj");
const time = ticksFromDecimalSeconds("0.1");
await video.run("cut.fcproj", [{ id: "timeline.razor", params: { time } }], {
  saveAs: "edited.fcproj",
});
```

APIs: `commands`, `describe`, `inspect`, `probe`, `run`, `render`, `export`.
`inspect` defaults to the active sequence. CLI syntax is available through
`bun run video help`. Each call opens its own native session.

Resolution uses `binary`, then `.local/config.json`, then Cargo's offline
metadata and an existing release/debug artifact. Paths come from the selected
checkout and its configuration. Source pins and native version are checked.
API calls never compile the engine. Build it with
`bun run workspace build filmcraft`.

Defaults: 30 seconds, 16 MiB combined stdout/stderr. Options allow at most one
hour and 64 MiB; cancellation terminates the owned process tree. Native stderr
is discarded. Errors expose a stable code, optional exit status and structured
native results. Failed exports retain their receipt and offline media entries;
failed command batches retain their completed outcomes. The CLI prints these
results while keeping a failure exit status. `run`
accepts at most 10000 operations and 16 MiB of JSONL. Project persistence uses
an explicit `saveAs`. Render rejects existing aliases to the source project.
Export requires a new destination directory inside an existing parent: native
formats can derive additional filenames, and that directory isolates all of them.

Ticks use 254016000000 units/second. Rust integer JSON tokens outside the safe
Number range become `bigint`; `stringifyNativeJSON` emits exact integer tokens.
Floating point values retain the native float contract. Decimal time input
accepts at most 12 fractional digits and rejects values between ticks.
`ticksToDecimalSeconds` truncates toward zero at the requested precision.
Native render/export seconds use the engine's floating point boundary.

Export returns native receipts and offline media entries; `allowOffline` is
explicit. Render writes PNG and returns `{ output }`. Project migrations and
schemas 1–15 remain in the native library. Resources default to
`.local/video/presets`; provider stores are outside this package.

Library input: `storytold/filmcraft`, commit
`87b845138e2cecf43e97e2c2e011b820a6e70ecd`, version 0.7.2,
MIT OR Apache-2.0. The input is an open source library. Upstream Bun has no video
API: `./native` only reports whether `ffmpeg` and `ffprobe` are on PATH and probes
media files with `ffprobe`; its availability does not qualify codecs or encoding.
