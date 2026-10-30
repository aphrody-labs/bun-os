# Component specs (COSMIC shell and apps under the Bun OS defaults)

Tokens refer to [`tokens.md`](tokens.md). Theme values resolve from the active ThemeBuilder (Aphrody by default); geometry is Square radii (2 px), Standard spacing.

## Shell

| component | process / config | layout | states | Bun OS default |
| --- | --- | --- | --- | --- |
| Top bar | cosmic-panel, `com.system76.CosmicPanel.Panel/v1` | layer-shell top, full width, XS (24 px), padding 0, spacing 0, opacity 1.0, exclusive zone | normal, applet popup open, autohide (Never) | left: `CosmicPanelAppButton` (opens app library, Omarchy's menu button), `CosmicAppletWorkspaces` (numbered, accent on active); centre: `CosmicAppletTime`; right: `StatusArea` (tray), `Tiling`, `InputSources`, `Bluetooth`, `Network`, `Audio`, `Battery`, `Notifications`, `Power` |
| Applet popup | applet process, libcosmic popup | anchored under the applet, radius_m (2), container bg primary_container_bg | open/closed, loading, empty | as upstream |
| Dock | `com.system76.CosmicPanel.Dock/v1` + `CosmicAppList` | bottom, L, radius 12 | — | absent from `entries` (Omarchy has no dock); favorites still set for users who add it |
| Launcher | cosmic-launcher | centred layer surface, search field + result list, each row icon + name + description | empty, results, no results, alt-tab mode | Super+Space; pop-launcher plugins: desktop entries, windows, files, calc (`=`), web (`ddg`/`g` etc.), terminal (`:`), scripts (Bun OS menu), session |
| App library | cosmic-app-library | centred layer surface, icon grid, group bar at the bottom | all, group, editing, search | Super+A and the bar's menu button |
| Workspaces overview | cosmic-workspaces | full-output layer surface, workspace strip + live window thumbnails (ext-image-copy-capture) | open, drag | Super+` ; horizontal strip (WorkspaceLayout::Horizontal) |
| Notification toast | cosmic-notifications | top-centre card, app icon, summary (heading), body (body), actions | shown, hover (no expire), action, critical sticky | as upstream; DND in the notifications applet |
| OSD | cosmic-osd | bottom-centre pill with icon + level bar | volume, brightness, mic, airplane; polkit dialog; power dialog with countdown | Super+Escape opens the power dialog |
| Lock / greeter | cosmic-greeter | centred clock (title1), date, user avatar, password field, session/power menus | idle, typing, error | Super+Ctrl+L |
| Wallpaper | cosmic-bg `com.system76.CosmicBackground/v1/all` | per output or all | image, slideshow, colour | set by `bunos-theme-set` to the theme's backgrounds directory, rotation 900 s, Zoom |
| Active hint | cosmic-comp | 2 px accent outline around the focused window, gaps 10/10 | focused, unfocused | Square corners follow the theme |
| Stack (tabbed group) | cosmic-comp | tab bar above the stacked windows, 150 ms tab animation | active, hover | Super+G |

## Applications

| app | id | primary layout | key states |
| --- | --- | --- | --- |
| Files | com.system76.CosmicFiles | header bar (back/forward, location/breadcrumb, view toggle, search), nav sidebar (Recents, Home, Documents, Downloads, Music, Pictures, Videos, Trash, Networks, mounts), tabs, grid or list (name/modified/size) | empty folder, loading, search results, operations progress, gallery overlay (Space), properties dialog, file chooser (`CosmicFilesDialog`) |
| Terminal | com.system76.CosmicTerm | header with tabs, panes split horizontally/vertically, find bar | tabs, splits maximized, profiles, colour scheme from its settings |
| Text editor | com.system76.CosmicEdit | tabs, project sidebar (file tree, git), status/find bar | unsaved dot, find/replace, git diff, settings page |
| Store | com.system76.CosmicStore | nav: Explore, Create, Work, Develop, Learn, Game, Relax, Socialize, Utilities, Applets, Installed, Updates; Explore shelves (Editor's choice, Popular, Made for COSMIC, Recently updated, category shelves); app page (icon, name, developer, Install/Open, screenshots, description, releases, size, licence) | installing progress, failed, update available, backend list (flatpak, packagekit, pkgar, rpm-ostree) |
| Settings | com.system76.CosmicSettings | nav sidebar of sections, page = stacked settings sections | live apply, search, subpages |
| Player | com.system76.CosmicPlayer | video surface, bottom controls, playlist | playing, paused, fullscreen |
| Screenshot | cosmic-screenshot | portal chooser: region / window / screen, save or copy | — |

## Theme switching components (Bun OS)

| piece | path | contract |
| --- | --- | --- |
| Theme set | `factory/desktop/cosmic-session/rootfs/usr/share/bunos/themes/<name>/{cosmic.ron,rio.toml,theme.json}` | generated from Omarchy `colors.toml`; Aphrody's `cosmic.ron` equals the fork's `ThemeBuilder::dark()` (verified: parse + build + field equality up to f32 rounding) |
| Switcher | `rootfs/usr/bin/bunos-theme-set NAME` | imports the COSMIC theme, sets icon theme (CosmicTk `icon_theme`, if installed), Rio theme link, wallpaper entry; lists themes without argument |
| Menu entries | `rootfs/usr/lib/pop-launcher/scripts/bunos/*.sh` | pop-launcher scripts plugin headers `name/icon/description/keywords`; 25 `Theme:` entries + Style/Setup/Install/Update/Learn/Capture/Trigger |
