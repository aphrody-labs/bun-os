import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDistroStore } from "../store/distroStore";
import { DistroCard } from "./DistroCard";
import { wslService } from "../services/wslService";
import { CopyIcon, SourceIcon } from "./icons";
import type { InstallSource } from "../types/distribution";
import { INSTALL_SOURCE_COLORS, INSTALL_SOURCE_NAMES } from "../types/distribution";

type StatusFilter = "all" | "online" | "offline";

export function DistroList() {
  const { t } = useTranslation("dashboard");
  const { distributions, isLoading } = useDistroStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<InstallSource | "all">("all");
  // WSL version toggles - both enabled by default (show all)
  const [wsl1Enabled, setWsl1Enabled] = useState(true);
  const [wsl2Enabled, setWsl2Enabled] = useState(true);
  const [wslIp, setWslIp] = useState<string | null>(null);
  const [ipCopied, setIpCopied] = useState(false);

  // Fetch WSL IP - uses wsl --system so doesn't require user distros to be running
  useEffect(() => {
    wslService.getWslIp().then(setWslIp).catch(() => setWslIp(null));
  }, []);

  const copyIpToClipboard = useCallback(() => {
    if (wslIp) {
      navigator.clipboard.writeText(wslIp).then(() => {
        setIpCopied(true);
        setTimeout(() => setIpCopied(false), 1500);
      });
    }
  }, [wslIp]);

  if (isLoading && distributions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          {/* Cyber loading spinner */}
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 border-2 border-primary/30 rounded-full" />
            <div className="absolute inset-0 border-2 border-transparent border-t-primary rounded-full animate-spin" />
            <div className="absolute inset-2 border-2 border-transparent border-b-primary/50 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            </div>
          </div>
          <p className="text-on-surface-variant font-mono text-sm uppercase tracking-wider">{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (distributions.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center animate-fade-slide-in">
          {/* Empty state icon */}
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 bg-surface-container rounded-xl border border-outline-variant flex items-center justify-center">
              <svg
                className="w-10 h-10 text-outline"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                />
              </svg>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-on-surface-variant mb-2">{t('emptyState.title')}</h3>
          <p className="text-on-surface-variant text-sm font-mono">
            {t('emptyState.description')}
          </p>

          {/* Decorative line */}
          <div className="w-32 h-px mx-auto mt-6 bg-outline-variant" />
        </div>
      </div>
    );
  }

  // Filter distributions
  const filteredDistributions = distributions.filter((distro) => {
    // Status filter
    if (statusFilter === "online" && distro.state !== "Running") return false;
    if (statusFilter === "offline" && distro.state === "Running") return false;

    // Source filter
    if (sourceFilter !== "all") {
      const source = distro.metadata?.installSource || "unknown";
      if (source !== sourceFilter) return false;
    }

    // WSL version toggle filter
    if (distro.version === 1 && !wsl1Enabled) return false;
    if (distro.version === 2 && !wsl2Enabled) return false;

    return true;
  });

  // Sort: primary first, then alphabetically by name
  const sortedDistributions = [...filteredDistributions].sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.name.localeCompare(b.name);
  });

  // Get unique sources present in the distributions, in preferred display order
  const sourceOrder: InstallSource[] = ["store", "lxc", "container", "download", "import", "clone", "unknown"];
  const availableSources = sourceOrder.filter(source =>
    distributions.some(d => (d.metadata?.installSource || "unknown") === source)
  );

  // Check if we have WSL 1 or 2 distros
  const hasWsl1 = distributions.some(d => d.version === 1);
  const hasWsl2 = distributions.some(d => d.version === 2);
  const wsl1Count = distributions.filter(d => d.version === 1).length;
  const wsl2Count = distributions.filter(d => d.version === 2).length;

  // Count for filters
  const onlineCount = distributions.filter(d => d.state === "Running").length;
  const offlineCount = distributions.filter(d => d.state !== "Running").length;

  // Check if any filters are active
  const hasActiveFilters = statusFilter !== "all" || sourceFilter !== "all" || !wsl1Enabled || !wsl2Enabled;

  const clearFilters = () => {
    setStatusFilter("all");
    setSourceFilter("all");
    setWsl1Enabled(true);
    setWsl2Enabled(true);
  };

  return (
    <div>
      {/* Filter Bar - Two rows on mobile, one row on desktop */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 mb-1 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/50">
        <div className="relative">
        {/* IP Address - Always top right */}
        {wslIp && (
          <button
            onClick={copyIpToClipboard}
            data-testid="wsl-ip-display"
            className="absolute right-0 top-0 flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant rounded-lg whitespace-nowrap hover:bg-surface-container-high transition-colors group z-10"
            title={t('card.ipTooltip')}
          >
            <span className="text-xs font-mono text-on-surface-variant">{t('common:label.ip')}</span>
            <span className="text-sm font-mono text-primary" data-testid="wsl-ip-value">{wslIp}</span>
            <CopyIcon size="sm" className={`text-on-surface-variant group-hover:text-primary transition-colors ${ipCopied ? 'text-success' : ''}`} />
            {ipCopied && <span className="text-[10px] text-success" data-testid="ip-copied-indicator">{t('common:label.copied')}</span>}
          </button>
        )}

        {/* Filters */}
        <div className={`flex items-center gap-2 flex-wrap ${wslIp ? 'pr-44 lg:pr-48' : ''}`}>
          {/* Status Filters */}
          <div className="flex items-center gap-1 p-1 bg-surface-container/50 rounded-lg border border-outline-variant" data-testid="status-filter-group">
            <button
              onClick={() => setStatusFilter("all")}
              data-testid="status-filter-all"
              className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all border ${
                statusFilter === "all"
                  ? "bg-primary/20 text-primary border-primary/30"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              {t('filter.all')}
            </button>
            <button
              onClick={() => setStatusFilter("online")}
              data-testid="status-filter-online"
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all border flex items-center gap-1.5 ${
                statusFilter === "online"
                  ? "bg-success/20 text-success border-success/30"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
              title={t('filter.onlineTooltip', { count: onlineCount })}
            >
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[10px]" data-testid="online-count">{onlineCount}</span>
            </button>
            <button
              onClick={() => setStatusFilter("offline")}
              data-testid="status-filter-offline"
              className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all border flex items-center gap-1.5 ${
                statusFilter === "offline"
                  ? "bg-on-surface-variant/20 text-on-surface-variant border-on-surface-variant/30"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
              title={t('filter.offlineTooltip', { count: offlineCount })}
            >
              <span className="w-2 h-2 rounded-full bg-outline" />
              <span className="text-[10px]" data-testid="offline-count">{offlineCount}</span>
            </button>
          </div>

          {/* Divider - hidden on very small screens */}
          <div className="hidden sm:block w-px h-6 bg-outline-variant" />

          {/* Source Filters */}
          <div className="flex items-center gap-1 p-1 bg-surface-container/50 rounded-lg border border-outline-variant" data-testid="source-filter-group">
            <button
              onClick={() => setSourceFilter("all")}
              data-testid="source-filter-all"
              className={`px-2 sm:px-3 py-1.5 text-xs font-medium rounded-md transition-all border ${
                sourceFilter === "all"
                  ? "bg-primary/20 text-primary border-primary/30"
                  : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
              title={t('filter.allSources')}
            >
              <span className="hidden sm:inline">{t('filter.allSources')}</span>
              <span className="sm:hidden">{t('filter.allSourcesMobile')}</span>
            </button>
            {availableSources.map((source) => {
              const count = distributions.filter(d => (d.metadata?.installSource || "unknown") === source).length;
              const color = INSTALL_SOURCE_COLORS[source];
              const name = INSTALL_SOURCE_NAMES[source];
              const isSelected = sourceFilter === source;
              return (
                <button
                  key={source}
                  onClick={() => setSourceFilter(source)}
                  data-testid={`source-filter-${source}`}
                  className={`p-1.5 text-xs font-medium rounded-md transition-all border ${
                    isSelected ? "" : "border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                  }`}
                  style={isSelected ? {
                    backgroundColor: `${color}20`,
                    color: color,
                    borderColor: `${color}50`,
                  } : undefined}
                  title={`${name} (${count})`}
                >
                  <SourceIcon source={source} className="!w-[15px] !h-[15px]" />
                </button>
              );
            })}
          </div>

          {/* Divider - hidden on very small screens */}
          <div className="hidden sm:block w-px h-6 bg-outline-variant" />

          {/* WSL Version Toggle Buttons */}
          <div className="flex items-center gap-1 p-1 bg-surface-container/50 rounded-lg border border-outline-variant" data-testid="version-filter-group">
            {hasWsl1 && (
              <button
                onClick={() => setWsl1Enabled(!wsl1Enabled)}
                data-testid="version-filter-wsl1"
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all border flex items-center gap-1 ${
                  wsl1Enabled
                    ? "bg-secondary/20 text-secondary border-secondary/30"
                    : "border-transparent text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container-high line-through"
                }`}
                title={wsl1Enabled ? t('filter.hideWsl1', { count: wsl1Count }) : t('filter.showWsl1', { count: wsl1Count })}
              >
                {t('filter.v1')}
                <span className="text-[10px] opacity-70" data-testid="wsl1-count">{wsl1Count}</span>
              </button>
            )}
            {hasWsl2 && (
              <button
                onClick={() => setWsl2Enabled(!wsl2Enabled)}
                data-testid="version-filter-wsl2"
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all border flex items-center gap-1 ${
                  wsl2Enabled
                    ? "bg-secondary/20 text-secondary border-secondary/30"
                    : "border-transparent text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container-high line-through"
                }`}
                title={wsl2Enabled ? t('filter.hideWsl2', { count: wsl2Count }) : t('filter.showWsl2', { count: wsl2Count })}
              >
                {t('filter.v2')}
                <span className="text-[10px] opacity-70" data-testid="wsl2-count">{wsl2Count}</span>
              </button>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Distribution Grid */}
      {sortedDistributions.length === 0 ? (
        <div className="flex items-center justify-center h-40" data-testid="empty-filter-state">
          <div className="text-center">
            <p className="text-on-surface-variant text-sm" data-testid="empty-filter-message">
              {distributions.length === 0
                ? t('emptyFilter.noDistros')
                : t('emptyFilter.noMatch')}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                data-testid="clear-filters-button"
                className="mt-2 text-xs text-primary hover:underline"
              >
                {t('emptyFilter.clearFilters')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {sortedDistributions.map((distro, index) => (
            <DistroCard key={distro.name} distro={distro} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
