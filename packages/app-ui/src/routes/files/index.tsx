// SPDX-License-Identifier: Apache-2.0
// Files surface of the shell. The file service is Spacedrive (vendor/spacedrive, see
// docs/spacedrive/PROVENANCE.md); the shell does not ship an explorer of its own. The host (Spacedrive
// web interface, native Tauri window or the webos VFS explorer) registers the component that renders it.
import { type ComponentType, useSyncExternalStore } from "react";

let surface: ComponentType | null = null;
const listeners = new Set<() => void>();

/** Register the component that renders the Files surface; returns a function that unregisters it. */
export function registerFilesSurface(component: ComponentType): () => void {
  surface = component;
  for (const l of listeners) l();
  return () => {
    if (surface === component) {
      surface = null;
      for (const l of listeners) l();
    }
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function FilesRoute() {
  const Surface = useSyncExternalStore(subscribe, () => surface);
  if (Surface) return <Surface />;
  return (
    <section className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center" role="status">
      <h1 className="text-title-large text-on-surface">Fichiers</h1>
      <p className="text-body-large text-on-surface-variant">
        Le service de fichiers (Spacedrive) n'est pas monté dans cette fenêtre.
      </p>
    </section>
  );
}
