import { motion, AnimatePresence } from "motion/react";
import { useId, useRef } from "react";
import type { SubtitleSettings } from "./Subtitles";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface SubtitleSettingsMenuProps {
  isOpen: boolean;
  settings: SubtitleSettings;
  onSettingsChange: (settings: SubtitleSettings) => void;
  onClose: () => void;
}

export function SubtitleSettingsMenu({ isOpen, settings, onSettingsChange, onClose }: SubtitleSettingsMenuProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(dialogRef, { open: isOpen, onEscape: onClose });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <button type="button" aria-label="Close subtitle settings" className="fixed inset-0 z-10" onClick={onClose} />

          {/* Settings Menu */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-20 right-6 z-20 w-72 rounded-small border border-outline-variant bg-surface-container/95 p-4 backdrop-blur-xl shadow-md3-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 id={titleId} className="mb-4 text-label-large font-semibold text-on-surface">
              Subtitle settings
            </h3>

            <div className="space-y-4">
              {/* Font Size */}
              <div>
                <label className="mb-2 flex items-center justify-between text-body-small text-on-surface-variant">
                  <span>Font size</span>
                  <span className="text-on-surface">{Math.round(settings.fontSize * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0.8"
                  max="2.5"
                  step="0.1"
                  value={settings.fontSize}
                  onChange={e =>
                    onSettingsChange({
                      ...settings,
                      fontSize: parseFloat(e.target.value),
                    })
                  }
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-outline-variant [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md3-3"
                />
              </div>

              {/* Background Opacity */}
              <div>
                <label className="mb-2 flex items-center justify-between text-body-small text-on-surface-variant">
                  <span>Background opacity</span>
                  <span className="text-on-surface">{Math.round(settings.backgroundOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.backgroundOpacity}
                  onChange={e =>
                    onSettingsChange({
                      ...settings,
                      backgroundOpacity: parseFloat(e.target.value),
                    })
                  }
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-outline-variant [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md3-3"
                />
              </div>

              {/* Position */}
              <div>
                <span className="mb-2 block text-body-small text-on-surface-variant">Position</span>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        position: "bottom",
                      })
                    }
                    className={`flex-1 rounded-small px-3 py-2 text-body-medium transition-colors ${
                      settings.position === "bottom"
                        ? "bg-primary text-white"
                        : "bg-outline-variant/50 text-on-surface-variant hover:bg-outline-variant"
                    }`}
                  >
                    Bottom
                  </button>
                  <button
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        position: "top",
                      })
                    }
                    className={`flex-1 rounded-small px-3 py-2 text-body-medium transition-colors ${
                      settings.position === "top"
                        ? "bg-primary text-white"
                        : "bg-outline-variant/50 text-on-surface-variant hover:bg-outline-variant"
                    }`}
                  >
                    Top
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
