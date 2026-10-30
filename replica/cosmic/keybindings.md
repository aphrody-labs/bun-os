# Keybinding map: COSMIC upstream, Omarchy, Bun OS

Bun OS column = `data/keybindings.ron` in aphrody-labs/cosmic-comp `8fb0fd4` (122 bindings, parsed by cosmic-settings-config). Upstream = pop-os/cosmic-comp `data/keybindings.ron`. Omarchy = 3.8.4 `default/hypr/bindings/*.conf`, `config/hypr/bindings.conf`.

| action | COSMIC upstream | Omarchy | Bun OS |
| --- | --- | --- | --- |
| Launcher | Super (alone), Super+/ | Super+Space (walker) | Super+Space, Super (alone), Super+Alt+Space |
| Omarchy menu | — | Super+Alt+Space | launcher with `/usr/lib/pop-launcher/scripts/bunos/*` (Theme:, Style:, Setup:, Install:, Update:, Learn:, Capture:, Trigger:) + pop session scripts |
| App library | Super+A | — | Super+A |
| Workspaces overview | Super+W | — | Super+` |
| Key bindings help | — | Super+K | Super+K (Settings > Keyboard > Shortcuts) |
| Terminal | Super+T (cosmic-term) | Super+Return | Super+Return (Rio via system action), Super+Alt+Return cosmic-term |
| Browser | Super+B | Super+Shift+Return, Super+Shift+B | Super+Shift+Return, Super+Shift+B |
| Files | Super+F | Super+Shift+F | Super+Shift+F |
| Editor | — | Super+Shift+N | Super+Shift+N (cosmic-edit) |
| Store | — | (menu Install) | Super+Shift+I |
| Aphrody Chat / Search | — | (Super+Shift+A ChatGPT web app) | Super+Shift+A / Super+Shift+/ |
| Spacedrive / Documents / Games | — | (Docker / Typora / Signal) | Super+Shift+D / W / G |
| Activity | — | Super+Ctrl+T (btop) | Super+Ctrl+T (rio -e btop) |
| Settings | — | — | Super+I |
| Close window | Super+Q, Alt+F4 | Super+W | Super+W, Super+Q, Alt+F4 |
| Toggle floating | Super+G | Super+T | Super+T |
| Fullscreen | Super+F11 | Super+F | Super+F, Super+F11 |
| Maximize / full width | Super+M | Super+Alt+F | Super+Alt+F, Super+M |
| Split orientation | Super+O | Super+J | Super+J |
| Tiling on/off (workspace) | Super+Y | Super+L (layout toggle) | Super+L |
| Pop out (float + pin) | — | Super+O | Super+O (ToggleSticky) |
| Group / stack | Super+S | Super+G | Super+G, Super+S |
| Swap | Super+X | Super+Shift+arrows | Super+X, Super+Shift+arrows (Move) |
| Focus | Super+arrows, Super+hjkl | Super+arrows | Super+arrows, Super+U (out) |
| Resize | Super+R / Super+Shift+R (mode) | Super+- / Super+= | Super+- / Super+= and Super+R / Super+Shift+R |
| Workspace N | Super+1..9, Super+0 last | Super+1..0 (0 = 10) | Super+1..0 (0 = 10) |
| Move window to N | Super+Shift+1..9 | Super+Shift+1..0 | Super+Shift+1..0 |
| Send silently to N | — | Super+Shift+Alt+1..0 | Super+Shift+Alt+1..0 |
| Next / previous workspace | Super+Ctrl+arrows/hjkl | Super+Tab / Super+Shift+Tab | Super+Tab / Super+Shift+Tab, Super+Ctrl+Left/Right |
| Former workspace | — | Super+Ctrl+Tab | Super+Ctrl+Tab |
| Window switcher | Alt+Tab, Super+Tab | Alt+Tab (cycle) | Alt+Tab |
| Next monitor | Super+Alt+arrows | Ctrl+Alt+Tab | Ctrl+Alt+Tab, Super+Alt+arrows |
| Workspace to monitor | Super+Shift+Alt+arrows (move window) | Super+Shift+Alt+arrows | Super+Shift+Alt+arrows (migrate workspace) |
| Lock | Super+Escape | Super+Ctrl+L | Super+Ctrl+L |
| Power / system menu | XF86PowerOff | Super+Escape | Super+Escape, XF86PowerOff (cosmic-osd shutdown dialog) |
| Log out | Super+Shift+Escape | — | Super+Shift+Escape |
| Screenshot | Print | Print, Super+Shift+S | Print, Super+Shift+S |
| Zoom | Super+= / Super+- | Super+Ctrl+Z / Super+Ctrl+Alt+Z | Super+Ctrl+Z / Super+Ctrl+Alt+Z |
| Theme menu | — | Super+Shift+Ctrl+Space | Super+Shift+Ctrl+Space (Appearance) and launcher `Theme:` |
| Wallpaper menu | — | Super+Ctrl+Space | Super+Ctrl+Space |
| Input source | Super+Space | — | Super+Ctrl+Alt+Space |
| Universal copy/paste | — | Super+C / Super+V | not mapped (no sendshortcut action in cosmic-comp) |
| Scratchpad | — | Super+S | not available (no special workspace in cosmic-comp) |
| Media / brightness / volume | XF86 keys | XF86 keys via swayosd | XF86 keys (cosmic-osd) |

App-level keys (unchanged COSMIC): Files Ctrl+T tab, Ctrl+W close tab, Ctrl+L location, Ctrl+F search, Ctrl+H hidden, Ctrl+1/2 list/grid, Space gallery, F2 rename, Shift+Delete permanent delete, Ctrl+Shift+N new folder; Edit Ctrl+S/Shift+S, Ctrl+F/H find/replace, Ctrl+Shift+O open project, Alt+Z wrap; Term tabs, splits, find, zoom via its shortcuts page.
