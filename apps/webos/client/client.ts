// SPDX-License-Identifier: Apache-2.0
// The thin browser client of ADR-002: the whole page is the real Hyprland desktop streamed by the session gateway
// (services/wayland.ts). /?window=<address> shows one Wayland toplevel instead (a WebOS window of its own). Nothing
// else runs here: apps, files, the store and settings are native apps inside the session.
import { api } from "../contracts/api";
import { mountHyprland, type HyprlandView } from "./hyprland";

const TOKEN_KEY = "aphrody.wayland.token";
const root = document.getElementById("desktop") ?? document.body;
const params = new URLSearchParams(location.search);

// A token handed over in the fragment (#token=...) is stored and removed from the address bar.
const fragment = new URLSearchParams(location.hash.slice(1)).get("token");
if (fragment) {
  localStorage.setItem(TOKEN_KEY, fragment);
  history.replaceState(null, "", location.pathname + location.search);
}

function status(text: string) {
  const line = document.createElement("p");
  line.className = "client-status";
  line.textContent = text;
  root.replaceChildren(line);
}

function signIn(reason: string) {
  const form = document.createElement("form");
  form.className = "client-signin";
  const label = document.createElement("label");
  label.textContent = reason;
  const input = document.createElement("input");
  input.type = "password";
  input.autocomplete = "current-password";
  input.required = true;
  input.setAttribute("aria-label", "Session token");
  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Connect";
  label.append(input);
  form.append(label, button);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    localStorage.setItem(TOKEN_KEY, input.value.trim());
    void start();
  });
  root.replaceChildren(form);
  input.focus();
}

let view: HyprlandView | undefined;
async function start() {
  view?.close();
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  if (!token) return signIn("Enter your Bun OS session token");
  status("Connecting to your Bun OS session…");
  const health = await api("GET /api/wayland/health").catch(() => undefined);
  if (!health?.session)
    return (
      status(
        "Your Bun OS session is starting. This page retries every few seconds.",
      ),
      setTimeout(start, 4000)
    );
  const clients = await fetch("/api/wayland/clients", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (clients.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    return signIn(
      "That token was not accepted. Enter your Bun OS session token",
    );
  }
  const window = params.get("window") ?? undefined;
  view = mountHyprland(root, {
    token,
    window,
    resizeToFit: !window,
    fps: Number(params.get("fps") ?? 30),
  });
  performance.mark("client:connected");
}
void start();
