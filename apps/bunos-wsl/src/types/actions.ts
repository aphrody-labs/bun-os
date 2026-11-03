// Distro scope type definition - matches Rust enum
export type DistroScope =
  | { type: "all" }
  | { type: "specific"; distros: string[] }
  | { type: "pattern"; pattern: string };

// Custom action definition
export interface CustomAction {
  id: string;
  name: string;
  icon: string;       // Icon identifier from predefined set
  command: string;    // Command to execute, supports variables like ${DISTRO_NAME}
  scope: DistroScope;
  confirmBeforeRun: boolean;
  showOutput: boolean;
  requiresSudo: boolean;    // Prompt for sudo password when executing
  requiresStopped: boolean; // Requires distribution to be stopped before running
  runInTerminal: boolean;   // Run command in user's terminal instead of background
  runOnStartup: boolean;    // Run automatically when matching distribution starts
  order: number;      // Sort order for display
}

// Icons for custom actions. `id` is what a saved action stores; `symbol` is its Material Symbols
// Outlined glyph (rendered by the m3-fonts symbols subset through @aphrody/m3-primitives Icon).
export const ACTION_ICONS = [
  { id: "terminal", label: "Terminal", symbol: "terminal" },
  { id: "folder", label: "Folder", symbol: "folder" },
  { id: "gear", label: "Settings", symbol: "settings" },
  { id: "rocket", label: "Launch", symbol: "send" },
  { id: "wrench", label: "Tool", symbol: "build" },
  { id: "box", label: "Package", symbol: "inventory_2" },
  { id: "lightning", label: "Lightning", symbol: "bolt" },
  { id: "refresh", label: "Refresh", symbol: "refresh" },
  { id: "database", label: "Database", symbol: "database" },
  { id: "cloud", label: "Cloud", symbol: "cloud" },
  { id: "lock", label: "Lock", symbol: "lock" },
  { id: "code", label: "Code", symbol: "code" },
] as const;

/** The Material Symbols glyph of a saved action icon id (an unknown id, e.g. from an imported file, shows "bolt"). */
export function actionSymbol(iconId: string): string {
  return ACTION_ICONS.find((icon) => icon.id === iconId)?.symbol ?? "bolt";
}

// Available variables for command substitution
export const ACTION_VARIABLES = [
  { name: "${DISTRO_NAME}", description: "Name of the WSL distribution" },
  { name: "${HOME}", description: "Home directory path in WSL" },
  { name: "${USER}", description: "Default user in the distribution" },
  { name: "${WINDOWS_HOME}", description: "Windows user home path (in WSL format)" },
] as const;

// Default custom action for new actions
export const DEFAULT_CUSTOM_ACTION: Omit<CustomAction, "id"> = {
  name: "New Action",
  icon: "terminal",
  command: "",
  scope: { type: "all" },
  confirmBeforeRun: false,
  showOutput: true,  // Show output by default so users see feedback
  requiresSudo: false,
  requiresStopped: false,
  runInTerminal: false,
  runOnStartup: false,
  order: 0,
};

