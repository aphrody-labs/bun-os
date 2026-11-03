// Pointer -> bottom-screen coordinates for the dual-screen systems, matching the presenters:
// screens are stacked vertically (top over bottom), centred horizontally, and the whole image is
// letterboxed into the canvas. Returns null outside the bottom screen.

const layouts = {
  nds: { top: [256, 192], bottom: [256, 192] },
  "3ds": { top: [400, 240], bottom: [320, 240] },
  ctr: { top: [400, 240], bottom: [320, 240] },
};

/** @param {HTMLCanvasElement} canvas @param {PointerEvent|MouseEvent} event @param {string} system */
export function bottomScreenPoint(canvas, event, system) {
  const layout = layouts[system];
  if (!layout) return null;
  const width = Math.max(layout.top[0], layout.bottom[0]);
  const height = layout.top[1] + layout.bottom[1];
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const left = rect.left + (rect.width - width * scale) / 2;
  const top = rect.top + (rect.height - height * scale) / 2;
  const x = (event.clientX - left) / scale - (width - layout.bottom[0]) / 2;
  const y = (event.clientY - top) / scale - layout.top[1];
  if (x < 0 || y < 0 || x >= layout.bottom[0] || y >= layout.bottom[1]) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** Wire pointer events on `canvas` to `handle.set_touch(x, y, down)`. Returns an unbind function. */
export function bindTouch(canvas, handle, system) {
  let down = false;
  const move = event => {
    const point = bottomScreenPoint(canvas, event, system);
    if (down && point) handle.set_touch(point.x, point.y, true);
    else if (down && !point) handle.set_touch(0, 0, false);
  };
  const press = event => {
    down = true;
    canvas.setPointerCapture?.(event.pointerId);
    move(event);
  };
  const release = () => {
    down = false;
    handle.set_touch(0, 0, false);
  };
  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  return () => {
    canvas.removeEventListener("pointerdown", press);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", release);
    canvas.removeEventListener("pointercancel", release);
  };
}
