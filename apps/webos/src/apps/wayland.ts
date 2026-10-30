// SPDX-License-Identifier: Apache-2.0
// A real native Wayland client of the headless Hyprland session on the host, shown as its own WebOS window.
// The service (/api/wayland/*) launches the program and returns the Hyprland client address of its surface;
// the stream client (./hyprland) draws that surface and sends pointer, keyboard and clipboard input back.
import { h } from "../dom";

interface LaunchResult {
  pid?: number;
  address?: string;
  error?: string;
}

/** Launch `app` in the Hyprland session and mount its surface in `root`. */
export async function waylandApp(root: HTMLElement, app: string, name: string): Promise<void> {
  const status = h("div", { class: "empty" }, `Starting ${name}…`);
  root.append(status);
  try {
    const res = await fetch("/api/wayland/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app }),
    });
    const body = (await res.json().catch(() => ({}))) as LaunchResult;
    if (!res.ok || body.error || !body.address)
      throw new Error(
        body.error === "not-installed"
          ? `${name} is not installed on the host yet`
          : (body.error ?? `host answered ${res.status}`),
      );
    status.remove();
    const { mountHyprland } = await import("../../client/hyprland");
    mountHyprland(root, { window: body.address });
  } catch (error) {
    status.textContent = `${name} could not start: ${error instanceof Error ? error.message : String(error)}`;
  }
}
