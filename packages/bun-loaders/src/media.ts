// SPDX-License-Identifier: MIT
/** Image metadata through Bun.Image, video metadata through ffprobe (bun-engine probe owner). */
import { resolve } from "node:path";
import { probeMedia } from "../../bun-engine/src/native-capabilities.ts";

export function inspectMedia(input: string): Promise<Record<string, unknown>> {
  return probeMedia(resolve(input));
}
