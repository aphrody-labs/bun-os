/**
 * Source policy of the Wayland / Hyprland closure: which upstream projects Bun OS pins and, when needed, builds
 * from source. Everything else that the closure reaches is resolved from the Arch Linux repositories ("provided by
 * distro"). Tag, SHA, date, build system and dependencies are computed by compute-closure.ts, never typed here.
 *
 * consumers: "bun-os" = the Bun OS (Arch based) image compositions, "wslg" = the WSLg system distro build
 * (Azure Linux 3.0 base, everything of the graphics stack built from source).
 */
export type Consumer = "bun-os" | "wslg";

export interface Source {
  id: string;
  /** Arch package names this project replaces (the first one gives the Arch version). */
  arch: string[];
  /** Candidate git URLs, first reachable wins (upstream first). */
  url: string[];
  /** Tag prefix (case-insensitive) in front of the dotted version; or a full tagRe with one capture group. */
  prefix?: string;
  tagRe?: string;
  group: "wayland" | "xorg" | "graphics" | "input" | "hyprland" | "desktop" | "toolkit" | "rdp";
  consumers: Consumer[];
  /** Extra Arch dependencies for projects that have no Arch package (or none we can read). */
  extraDepends?: string[];
  /** Only listed when some other closure item references it (data-driven check of an order that named it). */
  onlyIfReferenced?: boolean;
  /** Optional upstream dependencies that the chosen build options enable (promoted from optional to required). */
  enable?: string[];
  /** Upstream names (pkg-config / find_package) that the options disable or that are not system libraries. */
  ignore?: string[];
  /** Arch dependency names that are dropped from the edges (runtime-only virtuals that would make a cycle). */
  dropDepends?: string[];
  note?: string;
  /** meson/cmake options used by WSLg (wslg-deps.json). Items without options were not yet built there: unverified. */
  wslgOptions?: string[];
  wslgOptionsVerified?: boolean;
}

const FD = "https://gitlab.freedesktop.org";
const GH = "https://github.com";
const B: Consumer[] = ["bun-os", "wslg"];
const I: Consumer[] = ["bun-os"];
const xlib = (id: string, repo: string, prefix: string, arch = id): Source => ({
  id,
  arch: [arch],
  url: [`${FD}/xorg/lib/${repo}.git`],
  prefix,
  group: "xorg",
  consumers: B,
});

export const SOURCES: Source[] = [
  // ---- Wayland core ------------------------------------------------------------------------------------------
  { id: "wayland", arch: ["wayland"], url: [`${FD}/wayland/wayland.git`], prefix: "", group: "wayland", consumers: B,
    wslgOptions: ["-Ddocumentation=false", "-Dtests=false", "-Ddtd_validation=false"], wslgOptionsVerified: true },
  { id: "wayland-protocols", arch: ["wayland-protocols"], url: [`${FD}/wayland/wayland-protocols.git`], prefix: "", group: "wayland", consumers: B,
    wslgOptions: ["-Dtests=false"], wslgOptionsVerified: true },
  { id: "weston", arch: ["weston"], url: [`${FD}/wayland/weston.git`], prefix: "", group: "wayland", consumers: B,
    enable: ["freerdp3", "winpr3", "libdisplay-info", "libdrm", "libinput", "libevdev", "lcms2", "libpng", "libjpeg", "libwebp", "lua", "xcb", "xcb-composite", "xcb-xfixes", "xcb-cursor", "xcb-shape", "xcb-icccm", "libseat", "pangocairo", "cairo-xcb", "cairo-egl", "libunwind"],
    note: "Arch ships 15.0.1 (stale); the rdp backend needs FreeRDP 3 (weston's own meson option), upstream rdp is not the WSLg RAIL fork.",
    wslgOptions: ["-Dbackend-headless=true", "-Dbackend-rdp=true", "-Dbackend-drm=false", "-Dbackend-wayland=false", "-Dbackend-pipewire=false", "-Dbackend-vnc=false", "-Dbackend-default=headless", "-Drenderer-gl=true", "-Drenderer-vulkan=false", "-Dxwayland=true", "-Dxwayland-path=/usr/local/bin/Xwayland", "-Dshell-desktop=true", "-Dshell-ivi=false", "-Dshell-kiosk=false", "-Dshell-lua=false", "-Dsystemd=false", "-Dcolor-management-lcms=false", "-Dimage-jpeg=true", "-Dimage-webp=false", "-Ddeprecated-pipewire=false", "-Ddeprecated-remoting=false", "-Dsimple-clients=shm,egl,damage", "-Dtools=info", "-Ddemo-clients=false", "-Dtests=false", "-Ddoc=false"], wslgOptionsVerified: true },
  { id: "xwayland", arch: ["xorg-xwayland"], url: [`${FD}/xorg/xserver.git`], prefix: "xwayland-", group: "wayland", consumers: B,
    ignore: ["libtirpc", "xdmcp", "nettle", "libgcrypt", "libsystemd", "dbus-1", "hal", "udev", "xcb-aux", "libunwind", "libdrm_nouveau"],
    note: "Newest stable line is xwayland-24.1.x; xwayland-26.0.99.x are release candidates of 26.1 and are skipped. libtirpc is only needed with -Dsecure-rpc=true (WSLg disables it): provided by distro.",
    wslgOptions: ["-Dxvfb=false", "-Dxdmcp=false", "-Dsecure-rpc=false", "-Dxwayland_ei=false", "-Ddocs=false", "-Ddevel-docs=false", "-Ddocs-pdf=false"], wslgOptionsVerified: true },
  { id: "libxkbcommon", arch: ["libxkbcommon", "libxkbcommon-x11"], url: [`${GH}/xkbcommon/libxkbcommon.git`], prefix: "xkbcommon-", group: "input", consumers: B },
  { id: "libinput", arch: ["libinput"], url: [`${FD}/libinput/libinput.git`], prefix: "", group: "input", consumers: B, enable: ["libevdev", "mtdev", "libwacom"], ignore: ["libwacom", "gtk4"],
    wslgOptions: ["-Ddocumentation=false", "-Dtests=false", "-Ddebug-gui=false", "-Dlibwacom=false"] },
  { id: "libevdev", arch: ["libevdev"], url: [`${FD}/libevdev/libevdev.git`], prefix: "libevdev-", group: "input", consumers: B, wslgOptions: ["-Ddocumentation=disabled", "-Dtests=disabled"] },
  { id: "mtdev", arch: ["mtdev"], url: ["https://bitmath.org/git/mtdev.git"], prefix: "v", group: "input", consumers: B, note: "autotools; the GitHub mirror rydberg/mtdev stops at v1.1.5, the bitmath.org repository has v1.1.7 as Arch." },
  { id: "libei", arch: ["libei"], url: [`${FD}/libinput/libei.git`], prefix: "", group: "input", consumers: B, ignore: ["libevdev"], wslgOptions: ["-Dtests=disabled", "-Ddocumentation=[]"] },
  { id: "seatd", arch: ["seatd"], url: ["https://git.sr.ht/~kennylevinsen/seatd"], prefix: "", group: "input", consumers: B, wslgOptions: ["-Dman-pages=disabled", "-Dexamples=disabled", "-Dserver=disabled"] },
  { id: "libdisplay-info", arch: ["libdisplay-info"], url: [`${FD}/emersion/libdisplay-info.git`], prefix: "", group: "graphics", consumers: B },
  { id: "libliftoff", arch: ["libliftoff"], url: [`${FD}/emersion/libliftoff.git`], prefix: "v", group: "graphics", consumers: B },
  { id: "libdecor", arch: ["libdecor"], url: [`${FD}/libdecor/libdecor.git`], prefix: "", group: "wayland", consumers: B, ignore: ["gtk+-3.0", "dbus-1"], wslgOptions: ["-Ddemo=false", "-Ddbus=disabled", "-Dgtk=disabled"] },
  { id: "pixman", arch: ["pixman"], url: [`${FD}/pixman/pixman.git`], prefix: "pixman-", group: "graphics", consumers: B },
  { id: "cairo", arch: ["cairo"], url: [`${FD}/cairo/cairo.git`], prefix: "", group: "graphics", consumers: B, ignore: ["lzo2", "x11", "xcb-shm", "xlib-xcb", "glib-2.0", "gobject-2.0"], wslgOptions: ["-Dtests=disabled", "-Dgtk_doc=false"] },
  { id: "pango", arch: ["pango"], url: ["https://gitlab.gnome.org/GNOME/pango.git"], prefix: "", group: "graphics", consumers: B, wslgOptions: ["-Dintrospection=disabled", "-Ddocumentation=false"] },
  { id: "libdrm", arch: ["libdrm"], url: [`${FD}/mesa/drm.git`], prefix: "libdrm-", group: "graphics", consumers: B, ignore: ["cunit", "valgrind"], wslgOptions: ["-Dtests=false", "-Dvalgrind=disabled", "-Dman-pages=disabled"] },
  { id: "libglvnd", arch: ["libglvnd"], url: [`${FD}/glvnd/libglvnd.git`], prefix: "v", group: "graphics", consumers: B, dropDepends: ["opengl-driver", "mesa"], note: "Arch libglvnd depends on mesa (opengl-driver): runtime-only, dropped to keep the build order acyclic; any opengl-driver satisfies it." },
  { id: "mesa", arch: ["mesa"], url: [`${FD}/mesa/mesa.git`], prefix: "mesa-", group: "graphics", consumers: B, ignore: ["libunwind", "valgrind", "libsensors", "libva", "libarchive", "libdrm_nouveau"],
    note: "aphrody-labs/mesa exists but is a fork of OpenGamingCollective/mesa (gaming patches), not of upstream; upstream mesa.git is pinned. d3d12 (WSL) and zink are in-tree gallium drivers.",
    wslgOptions: ["-Dgallium-drivers=swrast,d3d12", "-Dvulkan-drivers=", "-Dllvm=disabled"], wslgOptionsVerified: true },
  { id: "directx-headers", arch: ["directx-headers"], url: [`${GH}/microsoft/DirectX-Headers.git`], tagRe: "^v(\\d+\\.\\d+\\.\\d+)$", group: "graphics", consumers: ["wslg"], wslgOptions: ["-Dbuild-test=false"], wslgOptionsVerified: true,
    note: "mesa's d3d12 gallium driver (WSL GPU path) needs it; WSLg also vendors DirectX-Headers-1.0." },
  { id: "libepoxy", arch: ["libepoxy"], url: [`${GH}/anholt/libepoxy.git`], prefix: "", group: "graphics", consumers: B, ignore: ["x11"], wslgOptions: ["-Dtests=false", "-Ddocs=false"] },
  { id: "lcms2", arch: ["lcms2"], url: [`${GH}/mm2/Little-CMS.git`], prefix: "lcms", group: "graphics", consumers: B },
  // ---- X.Org (Xwayland) -------------------------------------------------------------------------------------
  { id: "xorgproto", arch: ["xorgproto"], url: [`${FD}/xorg/proto/xorgproto.git`], prefix: "xorgproto-", group: "xorg", consumers: B },
  { id: "xorg-util-macros", arch: ["xorg-util-macros"], url: [`${FD}/xorg/util/macros.git`], prefix: "util-macros-", group: "xorg", consumers: B },
  { id: "xcb-proto", arch: ["xcb-proto"], url: [`${FD}/xorg/proto/xcbproto.git`], prefix: "xcb-proto-", group: "xorg", consumers: B },
  xlib("libxcb", "libxcb", "libxcb-"),
  xlib("xcb-util", "libxcb-util", "xcb-util-"),
  xlib("xcb-util-image", "libxcb-image", "xcb-util-image-"),
  xlib("xcb-util-keysyms", "libxcb-keysyms", "xcb-util-keysyms-"),
  xlib("xcb-util-renderutil", "libxcb-render-util", "xcb-util-renderutil-"),
  xlib("xcb-util-wm", "libxcb-wm", "xcb-util-wm-"),
  xlib("xcb-util-errors", "libxcb-errors", "xcb-util-errors-"),
  xlib("xcb-util-cursor", "libxcb-cursor", "xcb-util-cursor-"),
  xlib("libx11", "libx11", "libX11-"),
  xlib("libxau", "libxau", "libXau-"),
  xlib("libxdmcp", "libxdmcp", "libXdmcp-"),
  xlib("libxext", "libxext", "libXext-"),
  xlib("libxrender", "libxrender", "libXrender-"),
  xlib("libxfixes", "libxfixes", "libXfixes-"),
  xlib("libxcursor", "libxcursor", "libXcursor-"),
  xlib("libxcomposite", "libxcomposite", "libXcomposite-"),
  xlib("libxdamage", "libxdamage", "libXdamage-"),
  xlib("libxrandr", "libxrandr", "libXrandr-"),
  xlib("libxi", "libxi", "libXi-"),
  xlib("libxtst", "libxtst", "libXtst-"),
  xlib("libxxf86vm", "libxxf86vm", "libXxf86vm-"),
  xlib("libxshmfence", "libxshmfence", "libxshmfence-"),
  xlib("libxkbfile", "libxkbfile", "libxkbfile-"),
  xlib("libxfont2", "libxfont", "libXfont2-"),
  xlib("libfontenc", "libfontenc", "libfontenc-"),
  xlib("libxcvt", "libxcvt", "libxcvt-"),
  xlib("libpciaccess", "libpciaccess", "libpciaccess-"),
  { id: "xkbcomp", arch: ["xorg-xkbcomp"], url: [`${FD}/xorg/app/xkbcomp.git`], prefix: "xkbcomp-", group: "xorg", consumers: B },
  { id: "xkeyboard-config", arch: ["xkeyboard-config"], url: [`${FD}/xkeyboard-config/xkeyboard-config.git`], prefix: "xkeyboard-config-", group: "xorg", consumers: B },
  // ---- RDP backend -------------------------------------------------------------------------------------------
  { id: "freerdp", arch: ["freerdp"], url: [`${GH}/FreeRDP/FreeRDP.git`], prefix: "", group: "rdp", consumers: B,
    ignore: ["x11", "xkbfile", "wayland-client", "wayland-scanner", "alsa", "libpulse", "cups", "fuse3", "krb5", "libsystemd", "libusb-1.0", "uriparser", "opencl", "pkcs11-helper", "libpcsclite", "sdl3", "sdl3-ttf", "sdl3-image", "libjpeg", "mbedtls", "libopenh264", "openh264", "libavcodec", "libswscale", "faad", "fdk-aac", "opus", "cjson", "json-c", "ffmpeg", "x264", "libsoxr", "libva"],
    note: "FreeRDP 3 (winpr3 inside). WSLg's own RAIL/gfxredir FreeRDP stays vendored in the wslg repository (microsoft/FreeRDP-mirror) until upstreamed; this pin serves upstream Weston 16's rdp backend.",
    wslgOptions: ["-DWITH_SERVER=ON", "-DWITH_CLIENT=OFF", "-DWITH_CLIENT_COMMON=OFF", "-DWITH_CLIENT_CHANNELS=OFF", "-DWITH_CLIENT_INTERFACE=OFF", "-DWITH_LIBSYSTEMD=OFF", "-DWITH_WAYLAND=OFF", "-DWITH_ICU=ON"] },
  // ---- Hyprland core chain -----------------------------------------------------------------------------------
  { id: "hyprwayland-scanner", arch: ["hyprwayland-scanner"], url: [`${GH}/hyprwm/hyprwayland-scanner.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"] },
  { id: "hyprland-protocols", arch: ["hyprland-protocols"], url: [`${GH}/hyprwm/hyprland-protocols.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: [] },
  { id: "hyprutils", arch: ["hyprutils"], url: [`${GH}/hyprwm/hyprutils.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"] },
  { id: "hyprlang", arch: ["hyprlang"], url: [`${GH}/hyprwm/hyprlang.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"] },
  { id: "hyprcursor", arch: ["hyprcursor"], url: [`${GH}/hyprwm/hyprcursor.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"] },
  { id: "hyprgraphics", arch: ["hyprgraphics"], url: [`${GH}/hyprwm/hyprgraphics.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"] },
  { id: "hyprwire", arch: ["hyprwire"], url: [`${GH}/hyprwm/hyprwire.git`], prefix: "v", group: "hyprland", consumers: B, note: "New runtime dependency of Hyprland 0.57 (Arch hyprland depends on hyprwire and hyprland-guiutils; the WSLg bunos Dockerfile of 2026-10-29 builds neither)." },
  { id: "hyprtoolkit", arch: ["hyprtoolkit"], url: [`${GH}/hyprwm/hyprtoolkit.git`], prefix: "v", group: "hyprland", consumers: B },
  { id: "hyprland-guiutils", arch: ["hyprland-guiutils"], url: [`${GH}/hyprwm/hyprland-guiutils.git`], prefix: "v", group: "hyprland", consumers: B, note: "Hyprland 0.57 depends on it (Arch); hyprtoolkit based, replaces hyprland-qtutils." },
  { id: "aquamarine", arch: ["aquamarine"], url: [`${GH}/hyprwm/aquamarine.git`], prefix: "v", group: "hyprland", consumers: B, wslgOptionsVerified: true, wslgOptions: ["-DCMAKE_BUILD_TYPE=Release"], note: "WSLg carries bunos/patches/aquamarine-0001 (clamp wayland bind versions)." },
  { id: "hyprland", arch: ["hyprland", "hyprpm"], url: [`${GH}/hyprwm/Hyprland.git`], prefix: "v", group: "hyprland", consumers: B, enable: ["xcb", "xcb-errors", "xcb-icccm", "xcb-xfixes", "xcb-composite", "xcb-res", "xcb-renderutil"], wslgOptionsVerified: true,
    wslgOptions: ["-DCMAKE_BUILD_TYPE=Release", "-DNO_TESTS=ON", "-DNO_HYPRPM=ON", "-DNO_UWSM=ON", "-DNO_SYSTEMD=ON", "-DBUILD_TESTING=OFF"] },
  { id: "hyprland-qtutils", arch: ["hyprland-qtutils"], url: [`${GH}/hyprwm/hyprland-qtutils.git`], prefix: "v", group: "hyprland", consumers: I, note: "Legacy Qt helper; Hyprland 0.57 uses hyprland-guiutils. Kept because the order named it; Qt stays a distro package (qt6-base, qt6-wayland, qt6-declarative)." },
  // ---- Hyprland ecosystem applications (bun-os image only) ----------------------------------------------------
  { id: "xdg-desktop-portal-hyprland", arch: ["xdg-desktop-portal-hyprland"], url: [`${GH}/hyprwm/xdg-desktop-portal-hyprland.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprlock", arch: ["hyprlock"], url: [`${GH}/hyprwm/hyprlock.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hypridle", arch: ["hypridle"], url: [`${GH}/hyprwm/hypridle.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprpaper", arch: ["hyprpaper"], url: [`${GH}/hyprwm/hyprpaper.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprpicker", arch: ["hyprpicker"], url: [`${GH}/hyprwm/hyprpicker.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprsunset", arch: ["hyprsunset"], url: [`${GH}/hyprwm/hyprsunset.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprpolkitagent", arch: ["hyprpolkitagent"], url: [`${GH}/hyprwm/hyprpolkitagent.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprshutdown", arch: ["hyprshutdown"], url: [`${GH}/hyprwm/hyprshutdown.git`], prefix: "v", group: "hyprland", consumers: I },
  { id: "hyprland-preview-share-picker", arch: [], url: [`${GH}/aphrody-labs/hyprland-preview-share-picker.git`, `${GH}/WhySoBad/hyprland-preview-share-picker.git`], prefix: "v", group: "hyprland", consumers: I,
    extraDepends: ["gtk4", "gtk4-layer-shell", "xdg-desktop-portal-hyprland", "rust", "cargo", "pkgconf"],
    note: "Not in the Arch repositories (AUR). aphrody-labs fork of WhySoBad/hyprland-preview-share-picker; Rust/GTK4 (extraDepends read from its README, UNVERIFIED against Cargo.toml)." },
  // ---- helper libraries of Hyprland and desktop plumbing -------------------------------------------------------
  { id: "tomlplusplus", arch: ["tomlplusplus"], url: [`${GH}/marzer/tomlplusplus.git`], prefix: "v", group: "toolkit", consumers: B },
  { id: "sdbus-cpp", arch: ["sdbus-cpp"], url: [`${GH}/Kistler-Group/sdbus-cpp.git`], prefix: "v", group: "toolkit", consumers: B, ignore: ["libsystemd", "libelogind", "basu"] },
  { id: "muparser", arch: ["muparser"], url: [`${GH}/beltoforion/muparser.git`], prefix: "v", group: "toolkit", consumers: B },
  { id: "re2", arch: ["re2"], url: [`${GH}/google/re2.git`], tagRe: "^(\\d{4}-\\d{2}-\\d{2})$", group: "toolkit", consumers: B },
  { id: "glaze", arch: ["glaze"], url: [`${GH}/stephenberry/glaze.git`], prefix: "v", group: "toolkit", consumers: B, note: "Hyprland build-time (header-only) dependency." },
  { id: "cpptrace", arch: ["cpptrace"], url: [`${GH}/jeremy-rifkin/cpptrace.git`], prefix: "v", group: "toolkit", consumers: B, onlyIfReferenced: true },
  { id: "gtk4-layer-shell", arch: ["gtk4-layer-shell"], url: [`${GH}/wmww/gtk4-layer-shell.git`], prefix: "v", group: "toolkit", consumers: I },
  { id: "gtk-layer-shell", arch: ["gtk-layer-shell"], url: [`${GH}/wmww/gtk-layer-shell.git`], prefix: "v", group: "toolkit", consumers: I },
  // ---- session services (bun-os image) -----------------------------------------------------------------------------
  { id: "pipewire", arch: ["pipewire", "libpipewire"], url: [`${FD}/pipewire/pipewire.git`], prefix: "", group: "desktop", consumers: I },
  { id: "wireplumber", arch: ["wireplumber"], url: [`${FD}/pipewire/wireplumber.git`], prefix: "", group: "desktop", consumers: I },
  { id: "xdg-desktop-portal", arch: ["xdg-desktop-portal"], url: [`${GH}/flatpak/xdg-desktop-portal.git`], prefix: "", group: "desktop", consumers: I },
  { id: "xdg-desktop-portal-wlr", arch: ["xdg-desktop-portal-wlr"], url: [`${GH}/emersion/xdg-desktop-portal-wlr.git`], prefix: "v", group: "desktop", consumers: I },
  { id: "xdg-desktop-portal-gtk", arch: ["xdg-desktop-portal-gtk"], url: [`${GH}/flatpak/xdg-desktop-portal-gtk.git`], prefix: "", group: "desktop", consumers: I },
  { id: "polkit", arch: ["polkit"], url: [`${GH}/polkit-org/polkit.git`], prefix: "", group: "desktop", consumers: I },
];

/**
 * Arch packages that the closure must contain as distro packages although no source item depends on them
 * (stacks the order named that stay prebuilt): Qt 6 and GTK 4 (applications of the Hyprland ecosystem, COSMIC is
 * handled by its own composition), compositor test tools.
 */
export const DISTRO_ROOTS: { pkg: string; consumers: Consumer[]; why: string }[] = [
  { pkg: "qt6-base", consumers: I, why: "hyprland-qtutils / Qt applications; Qt is not built from source" },
  { pkg: "qt6-wayland", consumers: I, why: "Qt Wayland platform plugin" },
  { pkg: "qt6-declarative", consumers: I, why: "hyprland-qtutils QML" },
  { pkg: "gtk4", consumers: I, why: "hyprland-preview-share-picker, portals" },
  { pkg: "wayland-utils", consumers: B, why: "wayland-info protocol probe" },
  { pkg: "xorg-xdpyinfo", consumers: B, why: "Xwayland probe" },
  { pkg: "xorg-xprop", consumers: B, why: "Xwayland probe" },
  { pkg: "wlr-randr", consumers: B, why: "probe" },
  { pkg: "grim", consumers: B, why: "screenshot probe" },
  { pkg: "llvm-libs", consumers: I, why: "mesa llvmpipe / zink in the Bun OS image" },
  { pkg: "vulkan-icd-loader", consumers: B, why: "mesa zink, weston vulkan renderer" },
  { pkg: "vulkan-headers", consumers: B, why: "build" },
  { pkg: "meson", consumers: B, why: "build tool" },
  { pkg: "ninja", consumers: B, why: "build tool" },
  { pkg: "cmake", consumers: B, why: "build tool" },
  { pkg: "pkgconf", consumers: B, why: "build tool" },
  { pkg: "git", consumers: B, why: "build tool" },
  { pkg: "python", consumers: B, why: "build tool" },
  { pkg: "python-mako", consumers: B, why: "mesa build" },
  { pkg: "python-packaging", consumers: B, why: "mesa build" },
  { pkg: "python-yaml", consumers: B, why: "mesa build" },
  { pkg: "glslang", consumers: B, why: "Hyprland shader validation" },
  { pkg: "lua", consumers: B, why: "Hyprland 0.57 / Weston lua shell" },
  { pkg: "libcanberra", consumers: B, why: "Hyprland sound" },
];
