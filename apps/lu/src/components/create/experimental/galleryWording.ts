// What the result view and the gallery strip say about a local file, per
// host. The sentences were written for ComfyUI and Windows ("as soon as
// ComfyUI is running", "Recycle Bin") and stood like that on a Mac too, where
// there is no ComfyUI and no Recycle Bin (persona walk, 09.10.2026). `mac` is
// isMlxImageHost(); with it false every string is the one Windows and Linux
// always had.

/** The line over a result whose file cannot be shown. */
export function unavailableLine(gone: boolean, mac: boolean): string {
  if (mac) {
    return gone
      ? 'This file is no longer on this Mac.'
      : 'This render is on this Mac, but its file could not be read just now.'
  }
  return gone
    ? 'This file is no longer in the ComfyUI output folder.'
    : 'This render lives on the local engine, which isn\'t reachable right now. It shows up again as soon as ComfyUI is running.'
}

/** The same state as a tooltip on a gallery tile. */
export function unavailableTitle(gone: boolean, mac: boolean): string {
  if (mac) return gone ? 'No longer on this Mac' : 'Local render, but its file could not be read'
  return gone ? 'No longer in the ComfyUI output folder' : "Local render, but the local engine isn't reachable"
}

/**
 * The tooltip of Delete. A local render goes to the Recycle Bin on Windows
 * and to the Trash on a Mac (lib/gallery-trash.ts), and each is called by
 * its own name.
 */
export function deleteTitle(mac: boolean): string {
  return mac ? 'Delete (moves the file to the Trash)' : 'Delete (moves the file to the Recycle Bin)'
}

/**
 * Whether the player of a result draws its own controls.
 *
 * A video whose file cannot be read still drew them, and the line saying so
 * lay on top: "0:00" and the play button shone through the sentence (persona
 * walk, 09.10.2026, Fund 26). There is nothing to play, so the player goes
 * without controls for as long as the file is missing, on every platform.
 */
export function playerHasControls(unavailable: boolean): boolean {
  return !unavailable
}

/**
 * The room an unreadable video keeps. A video without a file is the
 * browser's 300 by 150 box, too low for the icon and three lines.
 */
export const UNAVAILABLE_VIDEO_BOX = 'min-w-[360px] min-h-[200px] bg-black'
