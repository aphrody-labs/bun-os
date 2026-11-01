import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError } from "../../src/shared/args.ts";
import {
  type AsrSegment,
  DEFAULT_ASR,
  detectAsr,
  endpointUrl,
  mergeChunks,
  planChunks,
  splitLongSegments,
  transcribeMedia,
} from "../../src/creator/commands/video-translate/asr.ts";
import { Cache } from "../../src/creator/commands/video-translate/cache.ts";
import { FASTER_WHISPER_SCRIPT } from "../../src/creator/commands/video-translate/fw-script.ts";
import {
  ToolError,
  burnSubtitles,
  exec,
  muxSubtitles,
  probeDuration,
  which,
} from "../../src/creator/commands/video-translate/media.ts";
import { parseConfig } from "../../src/creator/commands/video-translate/options.ts";
import { runPipeline } from "../../src/creator/commands/video-translate/pipeline.ts";
import { toSrt } from "../../src/creator/commands/video-translate/subtitles.ts";

const posix = process.platform !== "win32";
const haveFfmpeg = Boolean(which("ffmpeg") && which("ffprobe"));
const havePython = Boolean(which("python3"));

let work: string;
let clip: string;
let longClip: string;
let bin: string;

async function script(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function makeClip(path: string, seconds: number): Promise<void> {
  const result = await exec([
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=320x240:r=10:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=16000:cl=mono",
    "-t",
    String(seconds),
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    path,
  ]);
  if (result.code !== 0) throw new Error(result.stderr);
}

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "vt-media-"));
  bin = join(work, "bin");
  await mkdir(bin);
  if (haveFfmpeg) {
    clip = join(work, "clip.mp4");
    longClip = join(work, "long.mp4");
    await makeClip(clip, 3);
    await makeClip(longClip, 40);
  }
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

const asr = (extra: Partial<typeof DEFAULT_ASR> = {}) => ({
  ...DEFAULT_ASR,
  ...extra,
});
const seg = (start: number, end: number, text: string): AsrSegment => ({
  start,
  end,
  text,
});

// ---------------------------------------------------------------------------------------------
// pure ASR helpers
// ---------------------------------------------------------------------------------------------

describe("asr chunking and merge", () => {
  test("planChunks overlaps windows and keeps a core per chunk", () => {
    expect(planChunks(120_000, 600, 5)).toEqual([
      {
        index: 0,
        start: 0,
        length: 120_000,
        coreStart: 0,
        coreEnd: Number.POSITIVE_INFINITY,
      },
    ]);
    const chunks = planChunks(1_300_000, 600, 5);
    expect(chunks.map(c => [c.start, c.length])).toEqual([
      [0, 600_000],
      [595_000, 600_000],
      [1_190_000, 110_000],
    ]);
    expect(chunks[0]?.coreEnd).toBe(597_500);
    expect(chunks[1]?.coreStart).toBe(597_500);
    expect(chunks[2]?.coreEnd).toBe(Number.POSITIVE_INFINITY);
  });

  test("mergeChunks keeps one copy of what was heard twice in the overlap and cleans junk", () => {
    const chunks = planChunks(50_000, 30, 6);
    const [a, b] = chunks;
    expect(chunks).toHaveLength(2);
    const merged = mergeChunks([
      {
        chunk: a as never,
        segments: [seg(1000, 3000, "最初"), seg(25_000, 28_000, "重なり")],
      },
      {
        chunk: b as never,
        segments: [
          seg(25_100, 28_100, "重なり"),
          seg(30_000, 31_000, "♪"),
          seg(31_000, 31_500, "(拍手)"),
          seg(40_000, 42_000, "最後"),
        ],
      },
    ]);
    expect(merged.map(s => s.text)).toEqual(["最初", "重なり", "最後"]);
  });

  test("mergeChunks collapses hallucinated loops but keeps a legitimate repeat", () => {
    const [only] = planChunks(100_000, 600, 5);
    const loop = [
      seg(0, 1000, "ありがとう"),
      seg(1000, 2000, "ありがとう"),
      seg(2000, 3000, "ありがとう"),
      seg(3000, 4000, "ありがとう"),
    ];
    expect(mergeChunks([{ chunk: only as never, segments: loop }])).toHaveLength(1);
    const repeat = [seg(0, 1000, "はい"), seg(9000, 10_000, "はい")];
    expect(mergeChunks([{ chunk: only as never, segments: repeat }])).toHaveLength(2);
  });

  test("splitLongSegments cuts at the widest word gap when words are known", () => {
    const words = [
      { start: 0, end: 500, word: "He " },
      { start: 500, end: 1000, word: "ran " },
      { start: 1000, end: 1500, word: "out " },
      { start: 3000, end: 3500, word: "of " },
      { start: 3500, end: 4000, word: "meter." },
    ];
    const out = splitLongSegments([{ start: 0, end: 4000, text: "He ran out of meter.", words }], 12);
    expect(out.map(s => s.text)).toEqual(["He ran out", "of meter."]);
    expect(out[0]?.end).toBe(1500);
    expect(out[1]?.start).toBe(3000);
    expect(splitLongSegments([seg(0, 1000, "short")], 12)).toHaveLength(1);
  });

  test("endpoint url forms", () => {
    expect(endpointUrl("http://h:8080")).toBe("http://h:8080/v1/audio/transcriptions");
    expect(endpointUrl("http://h:8080/v1/")).toBe("http://h:8080/v1/audio/transcriptions");
    expect(endpointUrl("http://h/v1/audio/transcriptions")).toBe("http://h/v1/audio/transcriptions");
  });
});

describe("asr detection order", () => {
  test.skipIf(!posix)(
    "whisper-cli, then faster-whisper through uv, then the endpoint; --asr-url goes first",
    async () => {
      const home = await mkdtemp(join(work, "home-"));
      const only = await mkdtemp(join(work, "path-"));
      const env = { PATH: only, HOME: home };
      expect((await detectAsr(asr(), env)).selected).toBeUndefined();
      expect((await detectAsr(asr(), env)).notes.join(" ")).toMatch(
        /whisper-cli.*introuvable[\s\S]*uv introuvable[\s\S]*--asr-url/,
      );

      await script(only, "whisper-cli", "exit 0");
      const noModel = await detectAsr(asr(), env);
      expect(noModel.selected).toBeUndefined();
      expect(noModel.notes.join(" ")).toMatch(/aucun modèle ggml/);

      await script(only, "uv", "exit 0");
      expect((await detectAsr(asr(), env)).selected?.backend).toBe("faster-whisper");

      const model = join(home, "ggml-base.bin");
      await writeFile(model, "x");
      const flagged = await detectAsr(asr({ whisperModel: model }), env);
      expect(flagged.selected).toMatchObject({ backend: "whisper-cli", model });
      await mkdir(join(home, ".cache", "whisper"), { recursive: true });
      await writeFile(join(home, ".cache", "whisper", "ggml-large-v3.bin"), "x");
      await writeFile(join(home, ".cache", "whisper", "ggml-tiny.bin"), "x");
      expect((await detectAsr(asr(), env)).selected?.model).toBe(join(home, ".cache", "whisper", "ggml-large-v3.bin"));

      expect((await detectAsr(asr({ url: "http://127.0.0.1:1/v1" }), env)).selected?.backend).toBe("endpoint");
      expect((await detectAsr(asr({ backend: "faster-whisper" }), env)).selected?.backend).toBe("faster-whisper");
      expect((await detectAsr(asr({ backend: "endpoint" }), env)).selected).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// backends end to end (fake tools, real ffmpeg)
// ---------------------------------------------------------------------------------------------

describe("asr backends", () => {
  test.skipIf(!posix || !haveFfmpeg)("whisper-cli: chunks, offsets, overlap, language and cache", async () => {
    const dir = await mkdtemp(join(work, "wc-"));
    const log = join(dir, "calls.log");
    const fake = await script(
      dir,
      "whisper-cli",
      `while [ $# -gt 0 ]; do case "$1" in -f) wav="$2"; shift 2;; -of) prefix="$2"; shift 2;; -l) lang="$2"; shift 2;; *) shift;; esac; done
echo "$(basename "$wav") $lang" >> "${log}"
printf '1\\n00:00:02,000 --> 00:00:04,000\\nこんにちは %s\\n\\n' "$(basename "$wav" .wav)" > "$prefix.srt"
echo "auto-detected language: ja (p = 0.99)" >&2`,
    );
    const model = join(dir, "ggml-test.bin");
    await writeFile(model, "x");
    const cache = new Cache(join(dir, "cache"), true);
    const selection = {
      backend: "whisper-cli" as const,
      program: fake,
      model,
      detail: "fake",
    };
    const options = asr({ chunkSeconds: 30, overlapSeconds: 5 });
    expect(await probeDuration(longClip)).toBeGreaterThan(39_000);
    const first = await transcribeMedia(longClip, selection, options, {
      cache,
      env: process.env,
      log: () => {},
    });
    expect(first.chunks).toBe(2);
    expect(first.language).toBe("ja");
    expect(first.cues.map(c => [c.start, c.end, c.text])).toEqual([
      [2000, 4000, "こんにちは chunk-0001"],
      [27_000, 29_000, "こんにちは chunk-0002"],
    ]);
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
    const again = await transcribeMedia(longClip, selection, options, {
      cache,
      env: process.env,
      log: () => {},
    });
    expect(again.cachedChunks).toBe(2);
    expect(again.cues).toEqual(first.cues);
    expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test.skipIf(!posix || !haveFfmpeg || !havePython)(
    "faster-whisper: the inline uv script runs and its JSON is read (stubbed library)",
    async () => {
      const dir = await mkdtemp(join(work, "fw-"));
      const stub = join(dir, "stub");
      await mkdir(stub);
      await writeFile(
        join(stub, "faster_whisper.py"),
        `class W:
    def __init__(self, start, end, word):
        self.start, self.end, self.word = start, end, word

class S:
    def __init__(self, start, end, text, words):
        self.start, self.end, self.text, self.words = start, end, text, words

class Info:
    language = "ja"
    language_probability = 0.98

class WhisperModel:
    def __init__(self, name, device="auto", compute_type="default"):
        self.name = name
    def transcribe(self, path, language=None, beam_size=5, word_timestamps=False, vad_filter=False, condition_on_previous_text=True):
        assert word_timestamps and vad_filter and not condition_on_previous_text
        words = [W(0.2, 0.8, "こんにちは"), W(0.9, 1.5, "世界")]
        return iter([S(0.2, 1.5, "こんにちは世界", words)]), Info()
`,
      );
      const uv = await script(dir, "uv", `[ "$1" = run ] && [ "$2" = --script ] || exit 9\nshift 2\nexec python3 "$@"`);
      const result = await transcribeMedia(
        clip,
        {
          backend: "faster-whisper",
          program: uv,
          model: "large-v3",
          detail: "fake",
        },
        asr(),
        {
          cache: new Cache(join(dir, "cache"), false),
          env: { ...process.env, PYTHONPATH: stub },
          log: () => {},
        },
      );
      expect(result.language).toBe("ja");
      expect(result.cues.map(c => [c.start, c.end, c.text])).toEqual([[200, 1500, "こんにちは世界"]]);
      expect(FASTER_WHISPER_SCRIPT).toContain("# /// script");
      expect(FASTER_WHISPER_SCRIPT).toContain('dependencies = ["faster-whisper');
    },
  );

  test.skipIf(!haveFfmpeg)(
    "OpenAI-compatible endpoint: multipart request, word timestamps attached and split",
    async () => {
      const seen: {
        model?: unknown;
        format?: unknown;
        language?: unknown;
        granularities?: unknown[];
        fileSize?: number;
        auth?: string | null;
      } = {};
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          const form = await request.formData();
          seen.model = form.get("model");
          seen.format = form.get("response_format");
          seen.language = form.get("language");
          seen.granularities = form.getAll("timestamp_granularities[]");
          seen.fileSize = (form.get("file") as File).size;
          seen.auth = request.headers.get("authorization");
          return Response.json({
            language: "japanese",
            segments: [
              {
                start: 0.5,
                end: 4.5,
                text: "ここでバーストを読んでますね。青バーストを読んで、ガードして確反を取る",
              },
            ],
            words: [],
          });
        },
      });
      try {
        const result = await transcribeMedia(
          clip,
          { backend: "endpoint", model: "whisper-1", detail: "x" },
          asr({
            url: `http://127.0.0.1:${server.port}`,
            language: "ja",
            urlModel: "whisper-1",
            apiKey: "k",
          }),
          {
            cache: new Cache(join(work, "ep-cache"), false),
            env: process.env,
            log: () => {},
          },
        );
        expect(seen).toMatchObject({
          model: "whisper-1",
          format: "verbose_json",
          language: "ja",
          auth: "Bearer k",
        });
        expect(seen.granularities).toEqual(["segment", "word"]);
        expect(seen.fileSize).toBeGreaterThan(1000);
        expect(result.cues).toHaveLength(1);
        expect(result.cues[0]).toMatchObject({ start: 500, end: 4500 });
      } finally {
        server.stop(true);
      }
    },
  );

  test.skipIf(!haveFfmpeg)("no speech and tool failures are explicit", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          language: "ja",
          segments: [{ start: 0, end: 1, text: "♪" }],
        }),
    });
    try {
      await expect(
        transcribeMedia(clip, { backend: "endpoint", detail: "x" }, asr({ url: `http://127.0.0.1:${server.port}` }), {
          cache: new Cache(join(work, "ns-cache"), false),
          env: process.env,
          log: () => {},
        }),
      ).rejects.toThrow(/aucune parole/);
    } finally {
      server.stop(true);
    }
    await expect(exec(["/definitely/not/a/tool"])).rejects.toBeInstanceOf(ToolError);
  });
});

// ---------------------------------------------------------------------------------------------
// ffmpeg outputs
// ---------------------------------------------------------------------------------------------

async function frameBrightness(file: string, second: number): Promise<number> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-v",
      "error",
      "-ss",
      String(second),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "format=gray",
      "-f",
      "rawvideo",
      "-",
    ],
    { windowsHide: true, stdout: "pipe", stderr: "pipe" },
  );
  const bytes = new Uint8Array(await new Response(proc.stdout as ReadableStream).arrayBuffer());
  await proc.exited;
  let max = 0;
  for (const value of bytes) if (value > max) max = value;
  return max;
}

async function streams(file: string): Promise<{ codec_type: string; tags?: Record<string, string> }[]> {
  const result = await exec([
    "ffprobe",
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type:stream_tags=language,title",
    "-of",
    "json",
    file,
  ]);
  return (
    JSON.parse(result.stdout) as {
      streams: { codec_type: string; tags?: Record<string, string> }[];
    }
  ).streams;
}

const SRT = toSrt([
  {
    id: 1,
    start: 200,
    end: 2800,
    text: "OKI PRESSURE\nTHAT IS A GUARANTEED PUNISH",
  },
]);

describe("burn and mux", () => {
  test.skipIf(!haveFfmpeg)(
    "burn renders the text whatever the paths contain (quotes, colons, commas, brackets, spaces)",
    async () => {
      const dir = join(work, process.platform === "win32" ? `we ird 'q' [1],a;b c-d` : `we ird 'q' [1],a;b c:d`);
      await mkdir(dir, { recursive: true });
      const input = join(dir, "in put's [x].mp4");
      const subs = join(dir, process.platform === "win32" ? "sub titles, v1.srt" : "sub: titles, v1.srt");
      const output = join(dir, "out; (1).mp4");
      await Bun.write(input, Bun.file(clip));
      await writeFile(subs, SRT);
      await burnSubtitles({ input, subtitles: subs, output });
      expect((await streams(output)).map(s => s.codec_type)).toEqual(expect.arrayContaining(["video", "audio"]));
      expect(await frameBrightness(input, 1)).toBeLessThan(40);
      expect(await frameBrightness(output, 1)).toBeGreaterThan(150);
      expect(await readdir(dir)).toContain("out; (1).mp4");
    },
  );

  test.skipIf(!haveFfmpeg)("burn also works with an ASS file and fails loudly on a bad input", async () => {
    const out = join(work, "ass-out.mp4");
    const ass = join(work, "s.ass");
    const { toAss } = await import("../../src/creator/commands/video-translate/subtitles.ts");
    await writeFile(
      ass,
      toAss([{ id: 1, start: 200, end: 2800, text: "HELLO THERE" }], {
        height: 240,
      }),
    );
    await burnSubtitles({ input: clip, subtitles: ass, output: out });
    expect(await frameBrightness(out, 1)).toBeGreaterThan(150);
    await expect(
      burnSubtitles({
        input: join(work, "missing.mp4"),
        subtitles: ass,
        output: join(work, "x.mp4"),
      }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  test.skipIf(!haveFfmpeg)("mux adds an English soft-sub track and keeps video and audio", async () => {
    const subs = join(work, "mux.srt");
    await writeFile(subs, SRT);
    const probed = await Promise.all(
      ["mux.mkv", "mux.mp4"].map(async name => {
        const output = join(work, name);
        await muxSubtitles({ input: clip, subtitles: subs, output });
        return streams(output);
      }),
    );
    for (const found of probed) {
      expect(found.map(s => s.codec_type).toSorted()).toEqual(["audio", "subtitle", "video"]);
      expect(found.find(s => s.codec_type === "subtitle")?.tags?.language).toBe("eng");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// whole pipeline from media
// ---------------------------------------------------------------------------------------------

function llmServer() {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/models")) return Response.json({ data: [{ id: "fake" }] });
      calls += 1;
      const body = (await request.json()) as {
        messages: { role: string; content: string }[];
      };
      const first = body.messages.find(m => m.role === "user")?.content ?? "";
      let content = "Summary.";
      if (first.includes("TRANSLATE THESE CUES")) {
        const items = JSON.parse(/TRANSLATE THESE CUES[^\n]*\n(.*)\n/.exec(first)?.[1] ?? "[]") as {
          id: number;
        }[];
        content = JSON.stringify(
          items.map(item => ({
            id: item.id,
            text: `Translated line ${item.id}.`,
          })),
        );
      }
      return Response.json({ choices: [{ message: { content } }] });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    calls: () => calls,
    stop: () => server.stop(true),
  };
}

describe("pipeline from media", () => {
  test.skipIf(!posix || !haveFfmpeg)(
    "local file -> ASR -> translation -> mux; --resume replays nothing; the source is untouched",
    async () => {
      const dir = await mkdtemp(join(work, "e2e-"));
      const tools = join(dir, "tools");
      await mkdir(tools);
      const log = join(dir, "asr.log");
      await script(
        tools,
        "whisper-cli",
        `while [ $# -gt 0 ]; do case "$1" in -f) wav="$2"; shift 2;; -of) prefix="$2"; shift 2;; *) shift;; esac; done
echo run >> "${log}"
printf '1\\n00:00:00,300 --> 00:00:01,400\\nここから起き攻めです\\n\\n2\\n00:00:01,600 --> 00:00:02,800\\nそこ暴れますか\\n\\n' > "$prefix.srt"
echo "auto-detected language: ja (p = 0.97)" >&2`,
      );
      const model = join(dir, "ggml-test.bin");
      await writeFile(model, "x");
      const input = join(dir, "match.mp4");
      await Bun.write(input, Bun.file(clip));
      const before = await Bun.file(input).bytes();
      const llm = llmServer();
      const env = { ...process.env, PATH: `${tools}:${process.env.PATH}` };
      const logs: string[] = [];
      const out: string[] = [];
      try {
        const args = [input, "--llm-url", llm.url, "--llm-model", "fake", "--whisper-model", model, "--mux"];
        expect(
          await runPipeline(parseConfig(args).config as never, {
            env,
            io: { log: l => void logs.push(l), out: l => void out.push(l) },
          }),
        ).toBe(0);
        expect(logs.join("\n")).toMatch(/ASR : whisper-cli/);
        expect(logs.join("\n")).toMatch(/langue ja/);
        const subs = join(dir, "match.en.srt");
        const text = await readFile(subs, "utf8");
        expect(text).toContain("Translated line 1.");
        expect(text).toContain("00:00:00,300 --> ");
        const video = join(dir, "match.en.softsub.mkv");
        expect((await streams(video)).map(s => s.codec_type)).toContain("subtitle");
        expect(out.join("\n")).toContain(video);
        expect(await Bun.file(input).bytes()).toEqual(before);
        expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
        const calls = llm.calls();
        await runPipeline(parseConfig([...args, "--resume"]).config as never, {
          env,
          io: { log: () => {}, out: () => {} },
        });
        expect((await readFile(log, "utf8")).trim().split("\n")).toHaveLength(1);
        expect(llm.calls()).toBe(calls);
      } finally {
        llm.stop();
      }
    },
  );

  test.skipIf(!posix || !haveFfmpeg)(
    "URL input goes through yt-dlp, the download is removed afterwards and the video is never the output",
    async () => {
      const dir = await mkdtemp(join(work, "url-"));
      const tools = join(dir, "tools");
      await mkdir(tools);
      const args = join(dir, "ytdlp.args");
      await script(
        tools,
        "yt-dlp",
        `echo "$@" > "${args}"
while [ $# -gt 0 ]; do case "$1" in -o) tpl="$2"; shift 2;; *) shift;; esac; done
out=$(echo "$tpl" | sed 's/%(id)s/abc123/; s/%(ext)s/mkv/')
cp "$CLIP" "$out"
echo "$out"`,
      );
      await script(
        tools,
        "whisper-cli",
        `while [ $# -gt 0 ]; do case "$1" in -of) prefix="$2"; shift 2;; *) shift;; esac; done
printf '1\\n00:00:00,300 --> 00:00:01,400\\nこんにちは\\n\\n' > "$prefix.srt"`,
      );
      const model = join(dir, "ggml-test.bin");
      await writeFile(model, "x");
      const llm = llmServer();
      const out = join(dir, "result.en.srt");
      try {
        const config = parseConfig([
          "https://example.com/watch?v=abc123",
          "--llm-url",
          llm.url,
          "--llm-model",
          "fake",
          "--whisper-model",
          model,
          "--out",
          out,
        ]).config;
        expect(
          await runPipeline(config as never, {
            env: {
              ...process.env,
              PATH: `${tools}:${process.env.PATH}`,
              CLIP: clip,
            },
            io: { log: () => {}, out: () => {} },
          }),
        ).toBe(0);
        expect(await readFile(out, "utf8")).toContain("Translated line 1.");
        const used = await readFile(args, "utf8");
        expect(used).toContain("--no-playlist");
        expect(used).toContain("after_move:filepath");
        expect(used).toContain("-f ba/b");
        expect(used).toContain(join(dir, ".vt-cache", "download"));
        expect(await readdir(join(dir, ".vt-cache", "download"))).toEqual([]);
      } finally {
        llm.stop();
      }
    },
  );

  test("a URL without yt-dlp, and media without any ASR engine, fail with a clear message", async () => {
    const empty = await mkdtemp(join(work, "empty-"));
    const home = await mkdtemp(join(work, "emptyhome-"));
    const env = { PATH: empty, HOME: home };
    const llm = llmServer();
    try {
      const url = parseConfig([
        "https://example.com/v",
        "--llm-url",
        llm.url,
        "--llm-model",
        "fake",
        "--out",
        join(empty, "o.srt"),
      ]).config;
      await expect(
        runPipeline(url as never, {
          env,
          io: { log: () => {}, out: () => {} },
        }),
      ).rejects.toThrow(/yt-dlp est introuvable/);
      if (haveFfmpeg) {
        const file = parseConfig([
          clip,
          "--llm-url",
          llm.url,
          "--llm-model",
          "fake",
          "--out",
          join(empty, "o.srt"),
        ]).config;
        await expect(
          runPipeline(file as never, {
            env: { ...env, PATH: `${empty}` },
            io: { log: () => {}, out: () => {} },
          }),
        ).rejects.toThrow(/aucun moteur de reconnaissance vocale/);
      }
      expect(() => parseConfig(["x.mp4", "--asr", "bogus"])).toThrow(UsageError);
    } finally {
      llm.stop();
    }
  });

  test.skipIf(!haveFfmpeg)(
    "--dry-run on a media file reports the engine, duration and chunks without touching anything",
    async () => {
      const dir = await mkdtemp(join(work, "dryrun-"));
      const input = join(dir, "v.mp4");
      await Bun.write(input, Bun.file(longClip));
      const llm = llmServer();
      const out: string[] = [];
      try {
        const config = parseConfig([
          input,
          "--llm-url",
          llm.url,
          "--dry-run",
          "--chunk-seconds",
          "30",
          "--asr-url",
          "http://127.0.0.1:9/v1",
          "--burn",
        ]).config;
        expect(
          await runPipeline(config as never, {
            env: process.env,
            io: { log: () => {}, out: l => void out.push(l) },
          }),
        ).toBe(0);
        const plan = out.join("\n");
        expect(plan).toContain("ASR            : endpoint");
        expect(plan).toMatch(/Durée\s+: 40 s → 2 tronçon\(s\)/);
        expect(plan).toContain("v.en.hardsub.mp4");
        expect(plan).toContain("ffmpeg ✓");
        expect(await readdir(dir)).toEqual(["v.mp4"]);
        expect(llm.calls()).toBe(0);
      } finally {
        llm.stop();
      }
    },
  );
});
