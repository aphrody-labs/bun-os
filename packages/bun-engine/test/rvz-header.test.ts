import { expect, test } from "bun:test";
import { parseWia } from "../src/formats/parsers/home";
import { BinarySource } from "../src/formats/stream";

async function header(container: "RVZ" | "WIA", compression: number, discType = 2) {
  const bytes = new Uint8Array(0x200);
  bytes.set(new TextEncoder().encode(container));
  bytes[3] = 1;
  const view = new DataView(bytes.buffer);
  view.setUint32(0x48, discType);
  view.setUint32(0x4c, compression);
  return (
    await parseWia({
      source: BinarySource.from(bytes),
      head: bytes,
      path: "fixture",
    })
  ).header;
}

test("RVZ metadata only advertises the reader for its supported containers and codecs", async () => {
  expect((await header("RVZ", 5)).decompressor).toContain("aphrody-wii-image");
  expect((await header("RVZ", 0)).decompressor).toContain("aphrody-wii-image");
  expect((await header("RVZ", 3)).decompressor).toContain("not supported");
  expect((await header("WIA", 5)).decompressor).toContain("not supported");
  expect((await header("RVZ", 5, 7)).discType).toBe("unknown (7)");
  expect((await header("RVZ", 5, 7)).decompressor).toContain("not supported");
});
