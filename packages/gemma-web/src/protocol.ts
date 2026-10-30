// SPDX-License-Identifier: Apache-2.0
import type { FetchProgress } from "./cache";
import type { GenerateOptions, GenerateStats, LoadStats } from "./engine";

export type WorkerRequest =
  | { type: "load"; modelBase?: string; ortBase?: string; decoderEp?: "webgpu" | "wasm"; partBytes?: number }
  | { type: "generate"; id: number; opts: Omit<GenerateOptions, "signal"> }
  | { type: "abort"; id: number }
  | { type: "dispose" };

export type WorkerResponse =
  | { type: "progress"; p: FetchProgress }
  | { type: "loaded"; stats: LoadStats }
  | { type: "delta"; id: number; text: string }
  | { type: "done"; id: number; stats: GenerateStats }
  | { type: "error"; id?: number | undefined; message: string };
