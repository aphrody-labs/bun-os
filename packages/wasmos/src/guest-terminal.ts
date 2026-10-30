// SPDX-License-Identifier: Apache-2.0
// A real shell for the terminal: commands run in the Alpine guest (container2wasm: Bochs x86_64 + Linux, see boot.ts) and
// the bytes they print are rendered by Rio VT (`rio-vt` through `aphrody-shell-web`'s `WebTerminal`), the same VT state the
// desktop terminal uses. The guest is a real Linux userland: `uname`, `ls`, `apk`, busybox/uutils, nothing is emulated here.
import { boot, type BootResult } from "./boot.ts";

/** The part of aphrody-shell-web's `WebTerminal` (wasm-bindgen) the adapter needs. */
export interface RioVt {
  ingest(bytes: Uint8Array): void;
  scrape_text(): string;
  resize(cols: number, rows: number): void;
  take_replies(): string[];
}

/**
 * A pty's output post-processing (`onlcr`): the guest's stdout here is a pipe, so lines end in a bare LF. A terminal
 * emulator expects CR LF, otherwise every line starts under the end of the previous one.
 */
export function onlcr(text: string): Uint8Array {
  return new TextEncoder().encode(text.replace(/\r?\n/g, "\r\n"));
}

export class GuestTerminal {
  constructor(
    private readonly vt: RioVt,
    private readonly wasm: string,
  ) {}

  /** Echo the command like a shell prompt would, run it in the guest, render everything through Rio VT. */
  async run(command: string, options: { timeoutMs?: number; prompt?: string } = {}): Promise<BootResult> {
    this.vt.ingest(new TextEncoder().encode(`${options.prompt ?? "$ "}${command}\r\n`));
    const result = await boot({
      wasm: this.wasm,
      args: ["sh", "-c", command],
      timeoutMs: options.timeoutMs ?? 120_000,
    });
    this.vt.ingest(onlcr(result.output));
    return result;
  }

  /** What the terminal shows now (plain text of the Rio VT grid). */
  screen(): string {
    return this.vt.scrape_text();
  }
}
