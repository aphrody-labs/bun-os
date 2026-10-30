// SPDX-License-Identifier: MIT
// Candidate-only staging owner. Root image orchestration may call this before
// the full /usr-lock path; it intentionally makes no release/qualification claim.

type PacmanRepository = {
  name: string;
  server: string;
  keys?: string[];
  keyserver?: string;
};

type UsrManifest = {
  builderImage: string;
  repositories: PacmanRepository[];
};

type OmarchyIntegration = {
  repositories: Array<{
    name: string;
    servers: string[];
    signingKey: string;
  }>;
};

const candidatePackages = [
  "omarchy-keyring",
  "omarchy-settings",
  "hyprland",
  "quickshell",
  "uwsm",
  "sddm",
  "xdg-desktop-portal-hyprland",
  "pipewire",
  "wireplumber",
  "gnome-keyring",
  "gum",
  "jq",
  "git",
  "perl",
  "fakeroot",
  "pacman-contrib",
  "ttf-jetbrains-mono-nerd-basic",
  "wayvnc",
  "mesa",
  "dbus",
  "wayland-protocols",
  "foot",
  "shadow",
  // Native apps of the desktop session (real upstream packages; launchers in native-apps.sh)
  "rio",
  "epiphany",
  "fuzzel",
  "papirus-icon-theme",
  "cosmic-icon-theme",
  "cosmic-files",
  "cosmic-terminal",
  "cosmic-text-editor",
  "cosmic-store",
  "cosmic-settings",
  "cosmic-player",
];

export function planOmarchyCandidate(
  profile: Record<string, unknown>,
  usr: UsrManifest,
  integration: OmarchyIntegration,
) {
  const omarchy = integration.repositories.find(repository => repository.name === "omarchy");
  if (!omarchy || !omarchy.servers.length || !omarchy.signingKey)
    throw new Error("Omarchy candidate requires its declared signed repository.");
  const bootstrapImage = profile.bootstrapImage;
  if (typeof bootstrapImage !== "string" || bootstrapImage !== usr.builderImage)
    throw new Error("Root profile bootstrapImage and /usr builderImage must match.");

  const repositories = usr.repositories.filter(repository => repository.name !== "bunos");
  const keys = [
    ...repositories.flatMap(repository =>
      (repository.keys ?? []).map(
        key => `${key}@${(repository.keyserver ?? "keyserver.ubuntu.com").replace(/^hkps:\/\//, "")}`,
      ),
    ),
    `${omarchy.signingKey}@keyserver.ubuntu.com`,
  ];
  const pacmanConf = [
    "[options]",
    "Architecture = auto",
    "ParallelDownloads = 8",
    "SigLevel = Required DatabaseOptional",
    "LocalFileSigLevel = Optional",
    "",
    ...repositories.flatMap(repository => [`[${repository.name}]`, `Server = ${repository.server}`, ""]),
    `[${omarchy.name}]`,
    "SigLevel = Required DatabaseOptional",
    ...omarchy.servers.map(server => `Server = ${server}`),
    "",
  ].join("\n");

  return {
    bootstrapImage,
    desktopSession: "omarchy-hyprland",
    desktopSessionOwner: "factory/arch/omarchy/integration.json",
    desktopSessionState: "unqualified" as const,
    args: {
      ARCH_BOOTSTRAP_IMAGE: bootstrapImage,
      PACMAN_KEYS: keys.join(" "),
    },
    files: {
      "pacman.conf": pacmanConf,
      "candidate.packages": `${candidatePackages.join("\n")}\n`,
    },
    qualification: {
      state: "unqualified",
      source: "omacom/omarchy stable 4.0.4; package recipe pin c668141e9c42b13c80c9ca4ea108e11708c5e8a5",
      packageResolution: "signed repository resolution; build-time pacman -Q receipt, not an immutable closure",
      releaseEligible: false,
    },
  };
}
