import { usePlatform } from "../contexts/PlatformContext";

/**
 * Floating controls overlay - demonstrates Cap-style tiny floating windows
 * Transparent background, rounded, always on top
 */
export function FloatingControls() {
  const platform = usePlatform();

  const handleClose = () => {
    if (platform.closeWindow) {
      platform.closeWindow("floating-controls");
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-2">
      <div
        className="bg-scrim/80 backdrop-blur-xl rounded-full px-4 py-3 shadow-2xl border border-ink/10"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 rounded-full bg-error hover:bg-error transition-colors flex items-center justify-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={() => alert("Stop!")}
          >
            <div className="w-3 h-3 bg-ink rounded-sm" />
          </button>
          <button
            className="w-8 h-8 rounded-full bg-app-light-box hover:bg-app-light-box transition-colors flex items-center justify-center"
            style={{ WebkitAppRegion: "no-drag" } as any}
            onClick={handleClose}
          >
            <span className="text-ink text-xl leading-none">×</span>
          </button>
        </div>
      </div>
    </div>
  );
}