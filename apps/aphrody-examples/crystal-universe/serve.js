// SPDX-License-Identifier: Apache-2.0
const files = new Set([
  "index.html",
  "style.css",
  "game.js",
  "webgpu.js",
  "engine.js",
  "gamepad.js",
  "avatar.js",
  "multiplayer-url.js",
  "age1000-map.js",
  "dragon-pixel-wasm.js",
  "dragon-pixel-wasm_bg.wasm",
]);
function publicMultiplayerWebSocketBase() {
  const value = process.env.DRAGON_PIXEL_WS_BASE?.trim() || "";
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("//"))
    return value.includes("?") || value.includes("#") ? "" : value;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "ws:" && url.protocol !== "wss:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return "";
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT || 4317),
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    const name = pathname.slice(1) || "index.html";
    if (pathname === "/api/config" && request.method === "GET")
      return Response.json(
        { multiplayerWebSocketBase: publicMultiplayerWebSocketBase() },
        { headers: { "cache-control": "no-store" } },
      );
    if (
      pathname === "/dragon-pixel-wasm.js" ||
      pathname === "/dragon-pixel-wasm_bg.wasm"
    ) {
      const file = Bun.file(
        new URL(
          `../../../target/wasm-package-stage/aphrody-dragon-pixel-wasm/${pathname.slice(1)}`,
          import.meta.url,
        ),
      );
      return file.exists().then((exists) =>
        exists
          ? new Response(file, {
              headers: pathname.endsWith(".wasm")
                ? { "content-type": "application/wasm" }
                : {},
            })
          : new Response("WASM package not built", { status: 404 }),
      );
    }
    if (!files.has(name)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(new URL(name, import.meta.url)));
  },
});
console.log(`Dragon Pixel: ${server.url}`);
