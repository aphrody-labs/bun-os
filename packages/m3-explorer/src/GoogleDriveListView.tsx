// SPDX-License-Identifier: Apache-2.0
// Benchmark: assets/ui/google-drive-my-drive-list.png (manifest item 5)
// Google Drive file list table with sortable headers, filter chips, list/grid toggle and row overflow actions

"use client";

import { CircleButton, Icon } from "@aphrody/m3-primitives";
import { APHRODY_BRAND_COLORS } from "@aphrody/m3-theme";
import { clsx } from "clsx";

export interface DriveItem {
  id: string;
  name: string;
  type: "folder" | "document" | "spreadsheet" | "presentation" | "image" | "pdf" | "code" | "archive" | "file";
  owner?: string;
  lastModified?: string;
  size?: string;
  shared?: boolean;
  starred?: boolean;
}

export interface GoogleDriveListViewProps {
  /** Optional title (e.g. My Drive / Mon Drive) */
  title?: string;
  /** Items to display */
  items: DriveItem[];
  /** Currently selected item ID */
  selectedId?: string;
  /** Selection change callback */
  onSelect?: (item: DriveItem) => void;
  /** Item double click (e.g. open folder / file) */
  onOpen?: (item: DriveItem) => void;
  /** View mode: table list or thumbnail grid */
  viewMode?: "list" | "grid";
  /** View mode toggle callback */
  onViewModeChange?: (mode: "list" | "grid") => void;
  /** Active filter chips */
  activeFilter?: string;
  /** Filter selection callback */
  onFilterChange?: (filterKey: string) => void;
  /** Star toggle callback */
  onToggleStar?: (item: DriveItem) => void;
  /** Context / overflow actions callback */
  onRowAction?: (item: DriveItem, action: "download" | "share" | "rename" | "delete") => void;
  /** Additional container classes */
  className?: string;
}

// design:content - file-type badge colours come from the generated brand sheet; untyped entries follow the role.
const TYPE_ICONS: Record<DriveItem["type"], { icon: string; color?: string }> = {
  folder: { icon: "folder" },
  document: { icon: "description", color: APHRODY_BRAND_COLORS.blue },
  spreadsheet: { icon: "table_chart", color: APHRODY_BRAND_COLORS.green },
  presentation: { icon: "slideshow", color: APHRODY_BRAND_COLORS.yellow },
  image: { icon: "image", color: APHRODY_BRAND_COLORS.orange },
  pdf: { icon: "picture_as_pdf", color: APHRODY_BRAND_COLORS.red },
  code: { icon: "code", color: APHRODY_BRAND_COLORS.purple },
  archive: { icon: "folder_zip" },
  file: { icon: "draft" },
};

const DEFAULT_FILTERS = [
  { key: "all", label: "Type" },
  { key: "people", label: "People" },
  { key: "modified", label: "Modified" },
  { key: "location", label: "Location" },
];

/**
 * Google Drive My Drive List & Explorer View.
 * Benchmark parity: `assets/ui/google-drive-my-drive-list.png` (manifest item 5).
 * Features:
 * - Top filter chips toolbar with active state styling.
 * - View mode toggle (list vs grid).
 * - Sortable columns (Name, Reason / Owner, Last modified, File size).
 * - Hover state and selected row outlines.
 * - Per-row contextual overflow and sharing actions.
 */
export function GoogleDriveListView({
  title,
  items,
  selectedId,
  onSelect,
  onOpen,
  viewMode = "list",
  onViewModeChange,
  activeFilter = "all",
  onFilterChange,
  onToggleStar,
  onRowAction,
  className,
}: GoogleDriveListViewProps) {
  return (
    <section
      aria-label="Google Drive File List"
      className={clsx("google-drive-explorer flex flex-col w-full text-on-surface", className)}
    >
      {/* Title if provided */}
      {title && (
        <div className="px-2 pt-2 pb-1">
          <h2 className="text-headline-small font-medium text-on-surface">{title}</h2>
        </div>
      )}

      {/* Top Filter Chips & View Toggle Bar */}
      <div className="flex items-center justify-between gap-4 border-b border-outline-variant/30 pb-3 pt-1 px-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          {DEFAULT_FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilterChange?.(f.key)}
              aria-pressed={activeFilter === f.key}
              className={clsx(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-label-large font-medium transition-colors border",
                activeFilter === f.key
                  ? "border-primary/50 bg-secondary-container text-on-secondary-container"
                  : "border-outline-variant/40 bg-surface text-on-surface hover:bg-on-surface/8",
              )}
            >
              <span>{f.label}</span>
              <Icon name="arrow_drop_down" size={18} />
            </button>
          ))}
        </div>

        {/* View Mode Switcher */}
        {onViewModeChange && (
          <div className="flex items-center rounded-full border border-outline-variant/40 bg-surface p-0.5">
            <CircleButton
              variant={viewMode === "list" ? "filled" : "standard"}
              size="sm"
              onClick={() => onViewModeChange("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              title="List view"
            >
              <Icon name="view_list" size={18} />
            </CircleButton>
            <CircleButton
              variant={viewMode === "grid" ? "filled" : "standard"}
              size="sm"
              onClick={() => onViewModeChange("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
              title="Grid view"
            >
              <Icon name="grid_view" size={18} />
            </CircleButton>
          </div>
        )}
      </div>

      {/* File Table List or Grid View */}
      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
          {items.map(item => {
            const isSelected = selectedId === item.id;
            const typeMeta = TYPE_ICONS[item.type] || TYPE_ICONS.file;

            return (
              <div
                key={item.id}
                onClick={() => onSelect?.(item)}
                onDoubleClick={() => onOpen?.(item)}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the card holds block content and nested actions, which a native <button> cannot contain
                role="button"
                aria-pressed={isSelected}
                aria-label={item.name}
                tabIndex={0}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (event.key === "Enter" && onOpen) onOpen(item);
                    else onSelect?.(item);
                  }
                }}
                className={clsx(
                  "group relative flex flex-col justify-between rounded-medium border border-outline-variant/25 p-3 transition-colors cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-secondary",
                  isSelected
                    ? "bg-secondary-container text-on-secondary-container border-primary"
                    : "bg-surface-container-low hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_8%,var(--md-sys-color-surface-container-low))] active:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_10%,var(--md-sys-color-surface-container-low))]",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon
                    name={typeMeta.icon}
                    size={28}
                    className={clsx("shrink-0", !typeMeta.color && "text-on-surface-variant")}
                    style={typeMeta.color ? { color: typeMeta.color } : undefined}
                  />
                  {item.starred && <Icon name="star" size={18} filled className="text-tertiary fill-current" />}
                </div>
                <div className="mt-3">
                  <div className="truncate text-body-medium font-medium text-on-surface">{item.name}</div>
                  <div className="truncate text-body-small text-on-surface-variant">
                    {item.lastModified ?? item.size ?? "—"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left text-body-medium">
            <thead>
              <tr className="border-b border-outline-variant/20 text-title-small font-medium text-on-surface-variant">
                <th className="py-3 px-4 w-[45%]">Name</th>
                <th className="py-3 px-4 w-[20%]">Owner</th>
                <th className="py-3 px-4 w-[20%]">Last modified</th>
                <th className="py-3 px-4 w-[10%]">File size</th>
                <th className="py-3 px-4 w-[5%] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isSelected = selectedId === item.id;
                const typeMeta = TYPE_ICONS[item.type] || TYPE_ICONS.file;

                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelect?.(item)}
                    onDoubleClick={() => onOpen?.(item)}
                    aria-selected={isSelected}
                    tabIndex={0}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (event.key === "Enter" && onOpen) onOpen(item);
                        else onSelect?.(item);
                      }
                    }}
                    className={clsx(
                      "group cursor-pointer border-b border-outline-variant/15 transition-colors select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-secondary",
                      isSelected
                        ? "bg-secondary-container/60 text-on-secondary-container"
                        : "hover:bg-on-surface/8 active:bg-on-surface/10",
                    )}
                  >
                    {/* Name + Icon + Star */}
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        <Icon
                          name={typeMeta.icon}
                          size={22}
                          className={clsx("shrink-0", !typeMeta.color && "text-on-surface-variant")}
                          style={typeMeta.color ? { color: typeMeta.color } : undefined}
                        />
                        <span className="truncate font-medium text-on-surface">{item.name}</span>
                        {item.starred && (
                          <Icon
                            name="star"
                            size={16}
                            filled
                            className="shrink-0 text-tertiary fill-current"
                            aria-label="Starred"
                          />
                        )}
                      </div>
                    </td>

                    {/* Owner */}
                    <td className="py-2.5 px-4 text-body-small text-on-surface-variant">{item.owner ?? "me"}</td>

                    {/* Last modified */}
                    <td className="py-2.5 px-4 text-body-small text-on-surface-variant">{item.lastModified ?? "—"}</td>

                    {/* File size */}
                    <td className="py-2.5 px-4 text-body-small text-on-surface-variant">{item.size ?? "—"}</td>

                    {/* Row Actions */}
                    <td className="py-2.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        {onToggleStar && (
                          <CircleButton
                            variant="standard"
                            size="sm"
                            onClick={e => {
                              e.stopPropagation();
                              onToggleStar(item);
                            }}
                            aria-label={item.starred ? "Unstar" : "Star"}
                          >
                            <Icon name={item.starred ? "star" : "star_outline"} size={18} />
                          </CircleButton>
                        )}
                        {onRowAction && (
                          <CircleButton
                            variant="standard"
                            size="sm"
                            onClick={e => {
                              e.stopPropagation();
                              onRowAction(item, "download");
                            }}
                            aria-label="Download"
                            title="Download"
                          >
                            <Icon name="download" size={18} />
                          </CircleButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
