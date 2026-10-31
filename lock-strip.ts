// Remove the packages this agent added to the shared Cargo.lock; restore jni/android-native blocks from HEAD.
const drop = new Set(["allo-isolate","askama","askama_derive","askama_macros","askama_parser","build-target","bunos-flutter-bridge","dart-sys","delegate-attr","flutter_rust_bridge","flutter_rust_bridge_macros","java-locator","oslog","threadpool","uniffi","uniffi_bindgen","uniffi_core","uniffi_internal_macros","uniffi_macros","uniffi_meta","uniffi_pipeline","uniffi_udl","weedle2"]);
const head = Bun.spawnSync(["git","show","HEAD:Cargo.lock"]).stdout.toString();
const cur = await Bun.file("Cargo.lock").text();
const split = (s: string) => s.split(/\n(?=\[\[package\]\]\n)/);
const nameOf = (b: string) => /^name = "([^"]+)"/m.exec(b)?.[1];
const key = (b: string) => `${nameOf(b)} ${/^version = "([^"]+)"/m.exec(b)?.[1]}`;
const headBlocks = new Map(split(head).map(b => [key(b), b]));
const headNames = new Set(split(head).map(nameOf));
const out = split(cur).filter(b => !(drop.has(nameOf(b)!) && !headNames.has(nameOf(b)))).map(b => {
  const n = nameOf(b);
  if ((n === "jni" || n === "android-native") && headBlocks.has(key(b))) return headBlocks.get(key(b))!.replace(/\n+$/, "");
  return b.replace(/^ "([^" ]+)(?: [^"]*)?",\n/gm, (line, dep) => (drop.has(dep) && !headNames.has(dep) ? "" : line));
});
let text = out.join("\n");
if (!text.endsWith("\n")) text += "\n";
await Bun.write("Cargo.lock", text);
console.log("blocks", split(cur).length, "->", out.length);
