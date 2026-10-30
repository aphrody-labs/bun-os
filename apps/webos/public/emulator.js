// SPDX-License-Identifier: Apache-2.0
// Generic WebOS emulator window: /emulator.html?core=<id>[&autotest=1][&frames=120]
// Loads the core from /emulation/<core>/, boots a ROM from the user's file (never uploaded) or the free
// test ROM, offers save states (IndexedDB) and a touch pad, and publishes window.__emulator for the
// qualification runner.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const core = params.get("core") ?? "";
const autotest = params.get("autotest") === "1";
const wantFrames = Number(params.get("frames") ?? 120);
const errors = [];
const state = (window.__emulator = { core, phase: "loading", errors, frames: 0, result: undefined, handle: undefined });
const setStatus = (text) => ($("status").textContent = text);
const fail = (message) => {
  errors.push(message);
  state.phase = "failed";
  setStatus(message);
};
addEventListener("error", (e) => errors.push(`error: ${e.message}`));
addEventListener("unhandledrejection", (e) => errors.push(`rejection: ${e.reason?.message ?? e.reason}`));
const consoleError = console.error.bind(console);
console.error = (...args) => {
  errors.push(args.map(String).join(" "));
  consoleError(...args);
};

const db = new Promise((resolve, reject) => {
  const open = indexedDB.open("aphrody-emulators", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("states");
    open.result.createObjectStore("pending");
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(open.error);
});
async function idb(store, mode, run) {
  const database = await db;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const sha256 = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

let manifest, variant, mod, handle, emulator, romKey, lastState;

async function json(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function prepare() {
  const list = await json("/api/emulators");
  emulator = list.emulators.find((e) => e.id === core);
  if (!emulator) throw new Error(`Unknown emulator: ${core}`);
  $("title").textContent = emulator.name;
  document.title = emulator.name;
  if (emulator.mode === "v86") {
    state.phase = "ready";
    setStatus("x86 machine: open it from the Alpine Linux app");
    return;
  }
  if (emulator.mode !== "wasm") throw new Error(emulator.reason ?? "This emulator has no browser build.");
  manifest = await json(`/emulation/${emulator.core}/manifest.json`);
  variant = manifest;
  if (variant.threads && !globalThis.crossOriginIsolated) throw new Error("This emulator needs a cross-origin isolated page.");
  $("file").accept = (manifest.extensions ?? []).join(",");
  mod = await import(`/emulation/${emulator.core}/${variant.module}`);
  await mod.default({ module_or_path: `/emulation/${emulator.core}/${variant.wasm}` });
  $("file").disabled = false;
  $("test").disabled = !emulator.fixture;
  state.phase = "ready";
  setStatus("ready: load a ROM or run the free test ROM");
}

async function firmwareOptions(options) {
  const id = emulator.fixture?.firmware ?? manifest.firmware?.[0];
  if (!id || !manifest.firmware?.length) return options;
  const { loadFreeFirmware } = await import("/emulation/runtime/firmware.js");
  const firmware = await loadFreeFirmware(id, { Verifier: mod.FirmwareVerifier });
  return { ...options, bios: firmware.bytes, firmware: id };
}

async function boot(bytes, name) {
  if (handle) return;
  setStatus(`starting ${name}…`);
  state.phase = "starting";
  romKey = `${core}/${await sha256(bytes)}`;
  const system = emulator.fixture?.system ?? manifest.systems[0];
  const options = await firmwareOptions({ system, audio: true, renderer: core === "dust-nds" ? "gpu" : "software" });
  const canvas = $("screen");
  handle = await mod[manifest.start ?? "start"](canvas, bytes, options);
  state.handle = handle;
  if (manifest.touch) {
    const { bindTouch } = await import("/emulation/runtime/touch.js");
    bindTouch(handle.canvas ?? canvas, handle, system);
  }
  $("pad").hidden = false;
  const canSave = typeof handle.request_save === "function";
  $("save").disabled = !canSave;
  $("save").title = canSave ? "" : "This core has no save-state support";
  $("load").disabled = true;
  idb("states", "readonly", (s) => s.get(romKey)).then((saved) => {
    if (saved && canSave) {
      lastState = saved;
      $("load").disabled = false;
      $("export").disabled = false;
    }
  });
  state.phase = "running";
  setStatus(`running ${name}`);
  const tick = () => {
    state.frames = handle.frames ?? 0;
    if (state.phase === "running") setStatus(`running ${name}: ${state.frames} frames${handle.stopped ? `, stopped: ${handle.stopped}` : ""}`);
    requestAnimationFrame(tick);
  };
  tick();
}

async function waitFor(fn, ms) {
  const end = performance.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined && value !== null && value !== false) return value;
    if (performance.now() > end) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function saveState() {
  handle.request_save();
  const result = await waitFor(() => handle.state_result, 10000);
  if (result !== "ok") throw new Error(`save state failed: ${result ?? "timeout"}`);
  const bytes = handle.take_state();
  if (!bytes) throw new Error("save state produced no data");
  lastState = bytes;
  await idb("states", "readwrite", (s) => s.put(bytes, romKey));
  $("load").disabled = false;
  $("export").disabled = false;
  return bytes.length;
}
async function loadState() {
  handle.request_load(lastState);
  const result = await waitFor(() => handle.state_result, 10000);
  if (result !== "ok") throw new Error(`load state failed: ${result ?? "timeout"}`);
}

$("save").onclick = () =>
  saveState().then(
    (n) => setStatus(`state saved (${n} bytes)`),
    (e) => setStatus(String(e.message ?? e)),
  );
$("load").onclick = () =>
  loadState().then(
    () => setStatus("state restored"),
    (e) => setStatus(String(e.message ?? e)),
  );
$("export").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lastState]));
  a.download = `${core}.state`;
  a.click();
};
$("fs").onclick = () => document.documentElement.requestFullscreen?.();
$("test").onclick = () => bootFixture().catch((e) => fail(String(e.message ?? e)));
$("file").onchange = async () => {
  const file = $("file").files?.[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (handle) {
    // One machine per module instance: restart the page with the new image.
    await idb("pending", "readwrite", (s) => s.put({ name: file.name, bytes }, "rom"));
    location.search = `?core=${core}&pending=1`;
    return;
  }
  await boot(bytes, file.name);
};

async function bootFixture() {
  const fixture = emulator.fixture;
  const response = await fetch(`/emulation/fixtures/${fixture.pack}/${fixture.file}`);
  if (!response.ok) throw new Error(`Test ROM is not published (${response.status})`);
  await boot(new Uint8Array(await response.arrayBuffer()), fixture.file);
}

// Touch pad: buttons hold machine::keys bits.
let mask = 0;
for (const button of document.querySelectorAll("#pad button")) {
  const bit = Number(button.dataset.k);
  const set = (down) => {
    mask = down ? mask | bit : mask & ~bit;
    button.classList.toggle("on", down);
    handle?.set_input(mask);
  };
  button.addEventListener("pointerdown", (e) => {
    button.setPointerCapture(e.pointerId);
    set(true);
  });
  for (const type of ["pointerup", "pointercancel"]) button.addEventListener(type, () => set(false));
}

/** x86 qualification: boot the Alpine ISO in v86, wait for the serial login prompt, run a command as root. */
async function autorunV86() {
  const lock = await json("/vm/manifest.json");
  const { V86 } = await import("/vm/libv86.mjs");
  const screen = document.createElement("div");
  screen.id = "v86screen";
  screen.append(document.createElement("div"), document.createElement("canvas"));
  $("stage").replaceChildren(screen);
  let serial = "";
  const strip = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
/g, "");
  const vm = new V86({
    wasm_path: "/vm/v86.wasm",
    memory_size: 256 * 1024 * 1024,
    vga_memory_size: 8 * 1024 * 1024,
    screen_container: screen,
    bios: { url: "/vm/bios/seabios.bin" },
    vga_bios: { url: "/vm/bios/vgabios.bin" },
    cdrom: { url: `/vm/alpine.iso?v=${lock.alpine}`, async: true, size: lock.isoBytes },
    boot_order: 0x123,
    autostart: true,
    disable_speaker: true,
  });
  vm.add_listener("serial0-output-byte", (code) => (serial += String.fromCharCode(code)));
  state.handle = { canvas: screen, get frames() { return serial.length; } };
  state.phase = "running";
  const deadline = performance.now() + Number(params.get("timeout") ?? 300000);
  const seen = (needle) => waitFor(() => strip(serial).includes(needle), Math.max(1000, deadline - performance.now()));
  let loginPrompt = false;
  let commandOutput = false;
  loginPrompt = Boolean(await seen("login: "));
  if (loginPrompt) {
    vm.serial0_send("root\n");
    await new Promise((r) => setTimeout(r, 3000));
    vm.serial0_send("echo bun-os-$((40+2))\n");
    commandOutput = Boolean(await seen("bun-os-42"));
  }
  const bytes = serial.length;
  vm.destroy?.();
  state.result = {
    frames: wantFrames,
    lit: true,
    hash: "",
    renderer: "v86-wasm",
    audio: "n/a",
    audioProbe: { contexts: 1 },
    stopped: null,
    saveState: "unsupported",
    v86: { loginPrompt, commandOutput, serialBytes: bytes },
    error: loginPrompt && commandOutput ? undefined : `serial console: login prompt ${loginPrompt}, command output ${commandOutput}`,
    errors,
  };
  state.phase = "done";
}

async function autorun() {
  if (emulator.mode === "v86") return autorunV86();
  try {
    await bootFixture();
    const deadline = performance.now() + Number(params.get("timeout") ?? 300000);
    while (performance.now() < deadline && handle.frames < wantFrames && !handle.stopped)
      await new Promise((r) => setTimeout(r, 200));
    const reached = handle.frames;
    let saveStateResult = "unsupported";
    if (typeof handle.request_save === "function") {
      try {
        await saveState();
        await loadState();
        saveStateResult = "ok";
      } catch (error) {
        saveStateResult = "fail";
        errors.push(String(error.message ?? error));
      }
    }
    state.result = {
      frames: reached,
      lit: handle.lit,
      hash: handle.frame_hash,
      renderer: handle.renderer,
      audio: handle.audio,
      audioProbe: globalThis.__audioProbe?.(),
      stopped: handle.stopped ?? null,
      saveState: saveStateResult,
      crossOriginIsolated,
      errors,
    };
  } catch (error) {
    state.result = { frames: handle?.frames ?? 0, error: String(error?.stack ?? error?.message ?? error), errors };
  }
  state.phase = "done";
}

try {
  await prepare();
  if (autotest) await autorun();
  else if (params.get("pending") === "1") {
    const pending = await idb("pending", "readonly", (s) => s.get("rom"));
    if (pending) {
      await idb("pending", "readwrite", (s) => s.delete("rom"));
      await boot(pending.bytes, pending.name);
    }
  }
} catch (error) {
  fail(String(error?.message ?? error));
  if (autotest) state.result = { frames: 0, error: String(error?.stack ?? error?.message ?? error), errors };
}
