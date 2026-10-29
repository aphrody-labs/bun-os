// SPDX-License-Identifier: Apache-2.0
import { CircleButton } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { usePlatform } from "../contexts/PlatformContext";
import { useChatStore, getProjectGroups } from "../stores/chat-store";
import { useI18n } from "../i18n";
import { browserOnlyRoutes, desktopRoutes } from "../desktop-navigation";
import { publicDestinations } from "../public-navigation";
import { useKitVisible } from "../routes/kit/use-kit-visible";
import { usesBrowserBackend } from "../tauri-bridge";

// Application settings and native product settings share this navigation shell.
const SETTINGS_SECTIONS = [
  { id: "general", label: "Général", icon: "settings" },
  { id: "appearance", label: "Apparence", icon: "palette" },
  { id: "agent", label: "Agent", icon: "smart_toy" },
  { id: "models", label: "Modèles", icon: "model_training" },
  { id: "web", label: "Web", icon: "language" },
  { id: "keyboard", label: "Clavier", icon: "keyboard" },
];

export function AppSidebar({ isPreviewActive = false }: AppSidebarProps) {
  const platform = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Settings section search filter
  const [settingsSearch, setSettingsSearch] = useState("");

  // Chat Store connection
  const {
    threads,
    activeThreadId,
    unreadThreadIds,
    expandedProjects,
    setActiveThreadId,
    toggleProjectExpanded,
    requestNewSession,
  } = useChatStore();

  const projectGroups = useMemo(() => getProjectGroups(threads, expandedProjects), [threads, expandedProjects]);

  const recentThreads = useMemo(() => {
    return [...threads].toSorted((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).slice(0, 8);
  }, [threads]);

  const { language, setLanguage } = useI18n();

  // Active Area Detection
  const isChatActive =
    location.pathname === "/chat" || location.pathname === "/codex" || location.pathname.startsWith("/chat/");
  const isFilesActive =
    location.pathname === "/os" || location.pathname.startsWith("/explorer") || location.pathname.startsWith("/files");
  const isModelsActive = location.pathname.startsWith("/models");
  const isStudioActive = location.pathname.startsWith("/studio");
  const isTerminalActive = location.pathname.startsWith(browserOnlyRoutes.terminal);
  const isGamesActive = location.pathname.startsWith(browserOnlyRoutes.games);
  const isCreatorActive = location.pathname.startsWith(desktopRoutes.creator);
  const isAdminActive = location.pathname.startsWith(desktopRoutes.admin);
  const showCreator = useKitVisible("creator") || isCreatorActive;
  const showAdmin = useKitVisible("omar", true) || isAdminActive;
  const isSettingsActive = location.pathname.startsWith("/settings");
  // Chat, Models, Studio, Drive jobs and sync drive the native agent service, desktop commands and
  // Drive daemon; the in-browser backend has none of them, so they are listed only where those run.
  const nativeServices = !usesBrowserBackend();

  // Active setting section
  const currentSettingsSection = searchParams.get("section") || "general";

  // Filtered settings sections
  const filteredSettingsSections = useMemo(() => {
    if (!settingsSearch.trim()) return SETTINGS_SECTIONS;
    const q = settingsSearch.toLowerCase();
    return SETTINGS_SECTIONS.filter(s => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [settingsSearch]);

  return (
    <div className="flex h-full w-[280px] min-w-[240px] max-w-[360px] flex-col bg-transparent p-2">
      <div
        className={clsx(
          "flex h-full flex-col overflow-hidden rounded-large",
          isPreviewActive ? "bg-surface-container-low/80 backdrop-blur-2xl" : "bg-surface-container-low/65",
        )}
      >
        <nav
          className={clsx(
            "relative z-[51] flex h-full flex-col gap-2 p-3 pb-2",
            platform.platform === "tauri" && "pt-[43px]",
          )}
        >
          {/* Les 4 zones principales (icônes M3, 48dp, label-large 18px) */}
          <div className="flex flex-col gap-1 border-b border-outline-variant/30 pb-2">
            {publicDestinations.map(({ route, label, icon }) => {
              const selected =
                route === "/"
                  ? location.pathname === "/"
                  : location.pathname === route ||
                    location.pathname.startsWith(`${route}/`) ||
                    (route === "/material-3" && location.pathname.startsWith("/showcase"));
              return (
                <button
                  key={route}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigate(route)}
                  className={clsx(
                    "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                    selected
                      ? "bg-secondary-container text-on-secondary-container"
                      : "text-on-surface-variant hover:bg-secondary-container/20",
                  )}
                >
                  <span className="material-symbol text-title-medium" aria-hidden="true">
                    {icon}
                  </span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
            {nativeServices && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.chat)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isChatActive && !isSettingsActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isChatActive && !isSettingsActive && "font-bold",
                  )}
                >
                  chat
                </span>
                <span className="truncate">{language === "fr" ? "Chat" : "Chat"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => navigate(desktopRoutes.files)}
              className={clsx(
                "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                isFilesActive && !isSettingsActive
                  ? "bg-secondary-container text-on-secondary-container font-semibold"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
              )}
            >
              <span
                className={clsx("material-symbol text-title-medium", isFilesActive && !isSettingsActive && "font-bold")}
              >
                folder_open
              </span>
              <span className="truncate">{language === "fr" ? "Fichiers" : "Files"}</span>
            </button>

            {platform.platform !== "tauri" && (
              <button
                type="button"
                onClick={() => navigate(browserOnlyRoutes.terminal)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isTerminalActive && !isSettingsActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isTerminalActive && !isSettingsActive && "font-bold",
                  )}
                >
                  terminal
                </span>
                <span className="truncate">Terminal</span>
              </button>
            )}
            {platform.platform !== "tauri" && (
              <button
                type="button"
                onClick={() => navigate(browserOnlyRoutes.games)}
                aria-current={isGamesActive ? "page" : undefined}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isGamesActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span aria-hidden="true" className="material-symbol text-title-medium">
                  sports_esports
                </span>
                <span className="truncate">{language === "fr" ? "Jeux" : "Games"}</span>
              </button>
            )}
            {nativeServices && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.models)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isModelsActive && !isSettingsActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isModelsActive && !isSettingsActive && "font-bold",
                  )}
                >
                  model_training
                </span>
                <span className="truncate">{language === "fr" ? "Modèles" : "Models"}</span>
              </button>
            )}
            {nativeServices && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.studio)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isStudioActive && !isSettingsActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span
                  className={clsx(
                    "material-symbol text-title-medium",
                    isStudioActive && !isSettingsActive && "font-bold",
                  )}
                >
                  auto_stories
                </span>
                <span className="truncate">Studio</span>
              </button>
            )}
            {showCreator && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.creator)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isCreatorActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span className={clsx("material-symbol text-title-medium", isCreatorActive && "font-bold")}>brush</span>
                <span className="truncate">{language === "fr" ? "Créateur" : "Creator"}</span>
              </button>
            )}
            {showAdmin && (
              <button
                type="button"
                onClick={() => navigate(desktopRoutes.admin)}
                className={clsx(
                  "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                  isAdminActive
                    ? "bg-secondary-container text-on-secondary-container font-semibold"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                )}
              >
                <span className={clsx("material-symbol text-title-medium", isAdminActive && "font-bold")}>
                  admin_panel_settings
                </span>
                <span className="truncate">{language === "fr" ? "Administration" : "Administration"}</span>
              </button>
            )}
          </div>

          {/* Corps dynamique de la barre latérale selon la zone active */}
          <div className="no-scrollbar mask-fade-out mt-1 flex grow flex-col space-y-4 overflow-x-hidden overflow-y-auto pb-4">
            {/* --- CAS 1 : PARAMÈTRES ACTIFS (UI-DESIGN.md §4.6) --- */}
            {isSettingsActive && (
              <div className="space-y-3">
                {/* Champ de recherche dans les paramètres */}
                <div className="px-0.5">
                  <div className="flex h-12 items-center gap-2.5 rounded-full bg-surface-container-high px-3 border border-outline-variant/30 text-on-surface">
                    <span className="material-symbol text-title-small text-on-surface-variant">search</span>
                    <input
                      type="text"
                      value={settingsSearch}
                      onChange={e => setSettingsSearch(e.target.value)}
                      placeholder="Rechercher..."
                      className="w-full bg-transparent text-label-large text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none"
                    />
                    {settingsSearch && (
                      <button
                        type="button"
                        onClick={() => setSettingsSearch("")}
                        className="text-on-surface-variant hover:text-on-surface"
                      >
                        <span className="material-symbol text-title-small">close</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Les 6 sections STRICTES */}
                <div className="space-y-1">
                  {filteredSettingsSections.map(section => {
                    const isSelected = currentSettingsSection === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => navigate(`/settings?section=${section.id}`)}
                        className={clsx(
                          "flex h-12 w-full items-center gap-3 rounded-full px-3 text-label-large font-medium transition-colors cursor-pointer text-left select-none",
                          isSelected
                            ? "bg-secondary-container text-primary font-semibold"
                            : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                        )}
                      >
                        <span className="material-symbol text-title-small opacity-80">{section.icon}</span>
                        <span className="truncate">{section.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* --- CAS 2 : CHAT ACTIF (Nouveau chat, Projets, Récents) --- */}
            {isChatActive && !isSettingsActive && (
              <div className="space-y-4">
                {/* Bouton Nouveau chat avec icône compose */}
                <button
                  type="button"
                  onClick={() => {
                    requestNewSession();
                    navigate(desktopRoutes.chat);
                  }}
                  className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container px-4 text-label-large font-medium transition-colors cursor-pointer select-none"
                >
                  <span className="material-symbol text-title-small">edit_square</span>
                  <span>Nouveau chat</span>
                </button>

                {/* Section Projets avec arborescence et puce bleue non-lue */}
                <div className="space-y-1.5">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">Projets</div>
                  <div className="space-y-1">
                    {projectGroups.map(project => {
                      return (
                        <div key={project.name} className="space-y-0.5">
                          {/* Dossier du projet */}
                          <button
                            type="button"
                            onClick={() => toggleProjectExpanded(project.name)}
                            className="flex h-10 w-full items-center justify-between rounded-full px-3 text-label-large font-medium text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                          >
                            <div className="flex items-center gap-2 overflow-hidden">
                              <span className="material-symbol text-title-small text-primary shrink-0">folder</span>
                              <span className="truncate font-semibold">{project.name}</span>
                            </div>
                            <span className="material-symbol text-title-small text-on-surface-variant">
                              {project.expanded ? "expand_more" : "chevron_right"}
                            </span>
                          </button>

                          {/* Fils imbriqués (indentation 24px) */}
                          {project.expanded && (
                            <div className="ml-6 space-y-0.5 border-l border-outline-variant/30 pl-2">
                              {project.threads.length === 0 ? (
                                <div className="px-3 py-1 text-body-large text-on-surface-variant/50 italic">
                                  Aucun chat : ouvrez-en un dans ce projet
                                </div>
                              ) : (
                                project.threads.map(thread => {
                                  const isActive = thread.id === activeThreadId;
                                  const isUnread = !!unreadThreadIds[thread.id];
                                  return (
                                    <button
                                      key={thread.id}
                                      type="button"
                                      onClick={() => {
                                        setActiveThreadId(thread.id);
                                        navigate(desktopRoutes.chat);
                                      }}
                                      className={clsx(
                                        "flex h-10 w-full items-center justify-between rounded-full px-3 text-body-large font-medium transition-colors cursor-pointer text-left select-none",
                                        isActive
                                          ? "bg-secondary-container text-on-secondary-container font-semibold"
                                          : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                                      )}
                                    >
                                      <span className="truncate">{thread.name || thread.preview || "Sans titre"}</span>
                                      {isUnread && <span className="size-2 rounded-full bg-primary shrink-0 ml-1.5" />}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section Récents */}
                <div className="space-y-1.5 pt-2 border-t border-outline-variant/20">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">Récents</div>
                  <div className="space-y-0.5">
                    {recentThreads.map(thread => {
                      const isActive = thread.id === activeThreadId;
                      const isUnread = !!unreadThreadIds[thread.id];
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          onClick={() => {
                            setActiveThreadId(thread.id);
                            navigate(desktopRoutes.chat);
                          }}
                          className={clsx(
                            "flex h-10 w-full items-center justify-between rounded-full px-3 text-body-large font-medium transition-colors cursor-pointer text-left select-none",
                            isActive
                              ? "bg-secondary-container text-on-secondary-container font-semibold"
                              : "text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20",
                          )}
                        >
                          <span className="truncate">{thread.name || thread.preview || "Sans titre"}</span>
                          {isUnread && <span className="size-2 rounded-full bg-primary shrink-0 ml-1.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* --- CAS 5 : MODÈLES ACTIF (Installés, Catalogue) --- */}
            {isModelsActive && !isSettingsActive && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="px-2 text-label-large font-medium text-on-surface-variant">Modèles locaux</div>
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => navigate("/models?tab=installed")}
                      className="flex h-10 w-full items-center gap-2.5 rounded-full px-2 text-body-large font-medium text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                    >
                      <span className="material-symbol text-title-small text-success shrink-0">check_circle</span>
                      <span className="truncate">Installés</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate("/models?tab=catalog")}
                      className="flex h-10 w-full items-center gap-2.5 rounded-full px-2 text-body-large font-medium text-on-surface-variant hover:text-on-surface hover:bg-secondary-container/20 cursor-pointer text-left select-none transition-colors"
                    >
                      <span className="material-symbol text-title-small text-primary shrink-0">explore</span>
                      <span className="truncate">Catalogue</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pied de sidebar : Paramètres */}
          <div className="flex items-center justify-end border-t border-outline-variant/30 pt-2.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLanguage(language === "fr" ? "en" : "fr")}
                className="flex h-9 items-center justify-center rounded-full px-2.5 text-[13px] font-semibold text-on-surface-variant hover:text-on-surface bg-surface-container-high hover:bg-surface-container-highest transition-colors cursor-pointer border border-outline-variant/40"
                title={language === "fr" ? "Switch to English" : "Passer en Français"}
              >
                {language.toUpperCase()}
              </button>

              <CircleButton
                icon={GearSix}
                title="Paramètres"
                active={isSettingsActive}
                onClick={() => navigate(desktopRoutes.settings)}
              />
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
}
