// SPDX-License-Identifier: MIT
// npm packages the fork shipped as hardcoded builtins, pure TypeScript on upstream Bun. They are fallbacks: an
// installed package of the same name wins (the fork's builtins shadowed node_modules; Bun OS does not).
import { defineBunOsPlugin } from "../define.ts";

const file = (name: string) => new URL(`./${name}.ts`, import.meta.url);

export default defineBunOsPlugin({
  name: "@aphrody/bun-os-plugins/thirdparty",
  replaces: ["dotenv", "dotenv/config", "uuid", "picocolors", "tiny-invariant", "erlpack", "zlib-sync"],
  fallbackModules: {
    dotenv: file("dotenv"),
    "dotenv/config": file("dotenv-config"),
    uuid: file("uuid"),
    picocolors: file("picocolors"),
    "tiny-invariant": file("tiny-invariant"),
    erlpack: file("erlpack"),
    "zlib-sync": file("zlib-sync"),
  },
});
