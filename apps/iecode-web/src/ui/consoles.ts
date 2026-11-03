type ConsoleId = "dust" | "wii" | "switch" | "ctr";

const consoleStatus: Record<Exclude<ConsoleId, "dust" | "wii">, { title: string; message: string }> = {
  switch: {
    title: "Switch",
    message: "Not available yet.",
  },
  ctr: {
    title: "3DS",
    message: "Not available yet.",
  },
};

export function installConsoleSwitcher(suspendDust: () => void): void {
  const status = document.getElementById("console-status") as HTMLElement;
  const title = document.getElementById("console-status-title") as HTMLElement;
  const message = document.getElementById("console-status-message") as HTMLElement;
  const canvas = document.getElementById("canvas-container") as HTMLElement;
  const menu = document.getElementById("menu-container") as HTMLElement;
  const wii = document.getElementById("wii-panel") as HTMLElement;
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-console-target]");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const selected = button.dataset["consoleTarget"] as ConsoleId;
      if (selected !== "dust" && selected !== "wii" && !(selected in consoleStatus)) return;
      if (selected !== "dust") suspendDust();

      document.body.dataset["console"] = selected;
      for (const item of buttons) {
        item.setAttribute("aria-pressed", String(item === button));
      }

      const dustSelected = selected === "dust";
      canvas.hidden = !dustSelected;
      menu.hidden = !dustSelected;
      canvas.inert = !dustSelected;
      menu.inert = !dustSelected;
      const wiiSelected = selected === "wii";
      wii.hidden = !wiiSelected;
      wii.inert = !wiiSelected;
      if (wiiSelected) installWiiHomebrew();
      status.hidden = dustSelected || wiiSelected;
      if (selected !== "dust" && selected !== "wii") {
        title.textContent = consoleStatus[selected].title;
        message.textContent = consoleStatus[selected].message;
      }
    });
  }
}

type WiiRuntime = {
  default: () => Promise<unknown>;
  prepare_audio: () => void;
  start_wii_emulator: (rom: Uint8Array, dsp?: Uint8Array) => void;
};

let wiiRuntimePromise: Promise<WiiRuntime> | undefined;

function installWiiHomebrew(): void {
  const rom = document.getElementById("wii-rom") as HTMLInputElement;
  const dsp = document.getElementById("wii-dsp") as HTMLInputElement;
  const start = document.getElementById("wii-start") as HTMLButtonElement;
  const status = document.getElementById("wii-status") as HTMLElement;
  const host = document.getElementById("wii-runtime-host") as HTMLElement;
  const home = document.getElementById("wii-home") as HTMLButtonElement;
  if (start.dataset["wired"] === "true") return;
  start.dataset["wired"] = "true";

  let runtime: WiiRuntime | undefined;
  wiiRuntimePromise ??= (new Function("path", "return import(path)")("./wii/pkg/gecko_web.js") as Promise<WiiRuntime>);
  wiiRuntimePromise = wiiRuntimePromise.then(async (module) => {
    await module.default();
    return module;
  });
  void wiiRuntimePromise.then((module) => {
    runtime = module;
    status.textContent = navigator.gpu ? "Choisissez un fichier DOL homebrew pour démarrer." : "WebGPU indisponible dans ce navigateur.";
    start.disabled = !navigator.gpu || !rom.files?.length;
  }).catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  });

  rom.addEventListener("change", () => { start.disabled = !runtime || !rom.files?.length || !navigator.gpu; });
  start.addEventListener("click", async () => {
    const file = rom.files?.[0];
    if (!runtime || !file || !navigator.gpu) return;
    start.disabled = true;
    status.textContent = "Préparation du runtime Wii…";
    try {
      runtime.prepare_audio();
      const [data, dspData] = await Promise.all([file.arrayBuffer(), dsp.files?.[0]?.arrayBuffer()]);
      host.replaceChildren();
      host.removeAttribute("hidden");
      home.hidden = false;
      runtime.start_wii_emulator(new Uint8Array(data), dspData ? new Uint8Array(dspData) : undefined);
      document.querySelector(".wii-home")?.setAttribute("hidden", "");
      status.textContent = "Homebrew Wii en cours dans Bun OS.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      start.disabled = false;
    }
  });
  home.addEventListener("click", () => {
    host.replaceChildren();
    host.hidden = true;
    home.hidden = true;
    document.querySelector(".wii-home")?.removeAttribute("hidden");
    status.textContent = "Choisissez un fichier DOL homebrew pour démarrer.";
    start.disabled = !runtime || !rom.files?.length || !navigator.gpu;
  });
}
