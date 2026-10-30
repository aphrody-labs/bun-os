// Capability probe for media tooling next to the video engine. Upstream Bun has no video decoder (`Bun.Image` covers
// stills only), so frame access and metadata for previews come from ffmpeg/ffprobe when they are installed. The video
// project engine itself (filmcraft) is built and called separately and is not affected by this probe.

export interface NativeVideoCapabilities {
  owner: "ffmpeg";
  available: boolean;
  ffmpeg?: string;
  ffprobe?: string;
  reason?: string;
}

export function nativeVideoCapabilities(): NativeVideoCapabilities {
  const ffmpeg = Bun.which("ffmpeg");
  const ffprobe = Bun.which("ffprobe");
  if (!ffmpeg || !ffprobe) {
    return { owner: "ffmpeg", available: false, reason: "ffmpeg and ffprobe are not on PATH." };
  }
  return { owner: "ffmpeg", available: true, ffmpeg, ffprobe };
}

/** Container and stream facts of a local media file, as reported by ffprobe. */
export async function probeVideo(path: string): Promise<Record<string, unknown>> {
  if (!path.trim() || path.length > 32_768 || path.includes("\0")) {
    throw new TypeError("A valid local media path is required.");
  }
  const { ffprobe, reason } = nativeVideoCapabilities();
  if (!ffprobe) throw new Error(reason);
  const child = Bun.spawn([ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${err.trim()}`);
  return JSON.parse(out) as Record<string, unknown>;
}
