import LaptopIcon from "@aphrody/assets/icons/Laptop.png";
import type { Device, SdPath } from "@aphrody/drive-client";
import { getDeviceIcon, useLibraryMutation, useNormalizedQuery } from "@aphrody/drive-client";
import { m3Durations, m3Easings } from "@aphrody/m3-motion";
import { Button, CircleButton, Icon, m3FocusRing, Popover, usePopover } from "@aphrody/m3-primitives";
import { clsx } from "clsx";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useExplorer } from "../context";
import { useSelection } from "../SelectionContext";
import { sdPathToUri } from "../utils";
import { useAddStorageDialog } from "./AddStorageModal";

interface PathBarProps {
  path: SdPath;
  devices: Map<string, Device>;
  onNavigate: (path: SdPath) => void;
}

interface PathSegment {
  name: string;
  path: SdPath;
}

function getCurrentDirectoryName(sdPath: SdPath): string {
  if ("Physical" in sdPath) {
    const parts = sdPath.Physical.path.split("/").filter(Boolean);
    return parts[parts.length - 1] || "/";
  }

  if ("Cloud" in sdPath) {
    const parts = sdPath.Cloud.path.split("/").filter(Boolean);
    return parts[parts.length - 1] || sdPath.Cloud.identifier;
  }

  if ("Content" in sdPath) {
    return "Content";
  }

  return "";
}

function parsePathSegments(sdPath: SdPath): PathSegment[] {
  if ("Physical" in sdPath) {
    const { device_slug, path } = sdPath.Physical;
    const parts = path.split("/").filter(Boolean);

    return [
      {
        name: `/`,
        path: {
          Physical: {
            device_slug,
            path: "/",
          },
        },
      },
      ...parts.map((part, index) => ({
        name: part,
        path: {
          Physical: {
            device_slug,
            path: "/" + parts.slice(0, index + 1).join("/"),
          },
        },
      })),
    ];
  }

  if ("Cloud" in sdPath) {
    const { service, identifier, path } = sdPath.Cloud;
    const parts = path.split("/").filter(Boolean);

    return [
      {
        name: identifier,
        path: {
          Cloud: {
            service,
            identifier,
            path: "",
          },
        },
      },
      ...parts.map((part, index) => ({
        name: part,
        path: {
          Cloud: {
            service,
            identifier,
            path: parts.slice(0, index + 1).join("/"),
          },
        },
      })),
    ];
  }

  return [];
}

function IndexIndicator({ path }: { path: SdPath }) {
  const popover = usePopover();
  const enableIndexing = useLibraryMutation("locations.enable_indexing");
  const { clearSelection } = useSelection();
  const { setInspectorVisible } = useExplorer();

  // Fetch all locations
  const { data: locationsData } = useNormalizedQuery({
    query: "locations.list",
    input: null,
    resourceType: "location",
  });

  const locations = (locationsData as any)?.locations ?? [];

  // Find location that contains this path
  const matchingLocation = (() => {
    if ("Physical" in path) {
      const pathStr = path.Physical.path;
      // Find location with longest matching prefix
      return locations
        .filter((loc: any) => {
          if (!loc.sd_path || !("Physical" in loc.sd_path)) return false;
          const locPath = loc.sd_path.Physical.path;
          return pathStr.startsWith(locPath);
        })
        .toSorted((a: any, b: any) => {
          const aPath = "Physical" in a.sd_path! ? a.sd_path!.Physical.path : "";
          const bPath = "Physical" in b.sd_path! ? b.sd_path!.Physical.path : "";
          return bPath.length - aPath.length;
        })[0];
    }
    return undefined;
  })();

  const isIndexed = matchingLocation?.index_mode !== undefined && matchingLocation.index_mode !== "none";

  return (
    <Popover.Root open={popover.open} onOpenChange={popover.setOpen}>
      <Popover.Trigger asChild>
        <CircleButton
          icon={
            <Icon name={isIndexed ? "radio_button_checked" : "radio_button_unchecked"} size={20} filled={isIndexed} />
          }
          active={!isIndexed}
          className={isIndexed ? "!text-primary" : undefined}
          title={isIndexed ? "Location is indexed" : "Not indexed"}
        />
      </Popover.Trigger>
      <Popover.Content>
        <div className="p-2">
          {matchingLocation ? (
            <>
              <div className="mb-2">
                <div className="px-2 py-1.5">
                  <div className="text-on-surface text-title-small">{matchingLocation.name}</div>
                  <div className="text-on-surface-variant mt-0.5 text-body-small">
                    {isIndexed ? `Indexed (${matchingLocation.index_mode})` : "Not indexed"}
                  </div>
                </div>
              </div>

              <hr className="border-outline-variant my-2 border-t" />

              <div>
                {!isIndexed && (
                  <button
                    onClick={async () => {
                      await enableIndexing.mutateAsync({
                        id: matchingLocation.id,
                        index_mode: "deep",
                      });
                      popover.setOpen(false);
                    }}
                    className={clsx(
                      "text-on-surface hover:bg-on-surface/8 flex h-10 w-full items-center gap-3 rounded-extra-small px-3 text-label-large transition-colors ease-standard",
                      m3FocusRing,
                    )}
                  >
                    <Icon name="visibility" size={20} className="text-on-surface-variant" />
                    Activer l'indexation
                  </button>
                )}
                <button
                  onClick={() => {
                    clearSelection();
                    setInspectorVisible(true);
                    popover.setOpen(false);
                  }}
                  className={clsx(
                    "text-on-surface hover:bg-on-surface/8 flex h-10 w-full items-center gap-3 rounded-extra-small px-3 text-label-large transition-colors ease-standard",
                    m3FocusRing,
                  )}
                >
                  <Icon name="folder" size={20} className="text-on-surface-variant" />
                  Ouvrir l'inspecteur d'emplacement
                </button>
              </div>
            </>
          ) : (
            <div>
              <div className="px-2 py-1.5">
                <div className="text-on-surface-variant mb-2 text-body-small">Chemin en dehors de tout emplacement</div>
                <Button
                  size="sm"
                  variant="filled"
                  onClick={() => {
                    const initialPath = "Physical" in path ? path.Physical.path : undefined;
                    // oxlint-disable-next-line react/hooks -- useAddStorageDialog n'appelle aucun hook : il ouvre une boîte de dialogue (dialogManager.create) depuis un gestionnaire d'événement
                    useAddStorageDialog(undefined, initialPath);
                    popover.setOpen(false);
                  }}
                >
                  Ajouter un emplacement
                </Button>
              </div>
            </div>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

export function PathBar({ path, devices, onNavigate }: PathBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editingAsUri, setEditingAsUri] = useState(false);
  const { navigateToView } = useExplorer();
  const uri = sdPathToUri(path);
  const currentDir = getCurrentDirectoryName(path);
  const segments = parsePathSegments(path);

  // Get device icon and device info based on the device_slug
  const deviceInfo = (() => {
    if ("Physical" in path) {
      const deviceSlug = path.Physical.device_slug;
      // Find device by slug
      const device = Array.from(devices.values()).find(d => d.slug === deviceSlug);
      return {
        icon: device ? getDeviceIcon(device) : LaptopIcon,
        device,
      };
    }
    // For Cloud paths, we don't have a device
    return { icon: LaptopIcon, device: undefined };
  })();

  const handleDeviceClick = () => {
    if (deviceInfo.device) {
      navigateToView("device", deviceInfo.device.id);
    }
  };

  const enterEditMode = (initialValue: string, asUri: boolean) => {
    setIsEditing(true);
    setEditValue(initialValue);
    setEditingAsUri(asUri);
  };

  const exitEditMode = () => {
    setIsEditing(false);
    setEditValue("");
    setEditingAsUri(false);
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    // Only enter edit mode if clicking the container itself, not buttons/segments
    if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "INPUT") {
      const isUriMode = showUri;
      const valueToEdit = isUriMode ? uri : "Physical" in path ? path.Physical.path : uri;
      enterEditMode(valueToEdit, isUriMode);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      exitEditMode();
    }
  };

  const submitEdit = () => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      exitEditMode();
      return;
    }

    try {
      if (editingAsUri) {
        // Try to parse as SdPath JSON
        const parsed = JSON.parse(trimmed) as SdPath;
        onNavigate(parsed);
      } else {
        // Parse as file path string
        if ("Physical" in path) {
          const newPath: SdPath = {
            Physical: {
              device_slug: path.Physical.device_slug,
              path: trimmed.startsWith("/") ? trimmed : `/${trimmed}`,
            },
          };
          onNavigate(newPath);
        }
      }
    } catch (error) {
      console.error("Failed to parse path:", error);
    }

    exitEditMode();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const showUri = isExpanded && isShiftHeld;

  // Calculate widths for different states
  const collapsedWidth = currentDir.length * 8.5 + 70;
  const breadcrumbsWidth = Math.min(
    segments.reduce((sum, seg) => sum + seg.name.length * 6.5, 0) +
      (segments.length - 1) * 16 + // separators
      70, // base padding + icon
    600,
  );
  const uriWidth = Math.min(uri.length * 7 + 70, 600);
  const editWidth = Math.max(200, Math.min(editValue.length * 7 + 70, 600));

  const currentWidth = isEditing ? editWidth : !isExpanded ? collapsedWidth : showUri ? uriWidth : breadcrumbsWidth;

  return (
    <div className="flex items-center gap-2">
      <motion.div
        animate={{ width: currentWidth }}
        transition={{ duration: m3Durations.short4, ease: m3Easings.standard }}
        onMouseEnter={() => !isEditing && setIsExpanded(true)}
        onMouseLeave={() => !isEditing && setIsExpanded(false)}
        onClick={handleContainerClick}
        className={clsx(
          "flex h-10 items-center gap-1.5 rounded-full px-3",
          "bg-surface-container-high transition-colors ease-standard",
          "focus-within:bg-surface-container-highest focus-within:outline-2 focus-within:outline-primary",
          !isEditing && "cursor-text",
        )}
      >
        <button
          onClick={e => {
            e.stopPropagation();
            handleDeviceClick();
          }}
          disabled={!deviceInfo.device}
          title={deviceInfo.device ? `Go to ${deviceInfo.device.name}` : "Device"}
          className={clsx(
            "size-5 flex-shrink-0 rounded-full transition-opacity",
            m3FocusRing,
            deviceInfo.device ? "cursor-pointer opacity-60 hover:opacity-100" : "cursor-default opacity-60",
          )}
        >
          <img src={deviceInfo.icon} alt="Device" className="size-full" />
        </button>

        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={exitEditMode}

            className={clsx(
              "min-w-0 flex-1 border-0 bg-transparent outline-none ring-0",
              "text-on-surface text-label-medium",
              "placeholder:text-on-surface-variant",
              "focus:outline-none focus:ring-0 rounded-extra-small focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
              editingAsUri && "font-mono",
            )}
            placeholder={editingAsUri ? "Enter SdPath JSON..." : "Enter path..."}
          />
        ) : showUri ? (
          <input
            type="text"
            value={uri}
            readOnly
            className={clsx(
              "min-w-0 flex-1 border-0 bg-transparent outline-none ring-0",
              "text-on-surface text-label-medium",
              "placeholder:text-on-surface-variant",
              "cursor-text select-all",
              "focus:outline-none focus:ring-0 rounded-extra-small focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
            )}
            placeholder="No path selected"
          />
        ) : isExpanded ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1;
              return (
                <div key={sdPathToUri(segment.path)} className="flex flex-shrink-0 items-center gap-1">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (!isLast) onNavigate(segment.path);
                    }}
                    disabled={isLast}
                    className={clsx(
                      "whitespace-nowrap rounded-extra-small text-label-medium transition-colors ease-standard",
                      m3FocusRing,
                      isLast
                        ? "text-on-surface cursor-default"
                        : "text-on-surface-variant hover:text-on-surface cursor-pointer",
                    )}
                  >
                    {segment.name}
                  </button>
                  {!isLast && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        const valueToEdit = "Physical" in path ? path.Physical.path : uri;
                        enterEditMode(valueToEdit, false);
                      }}
                      className="text-on-surface-variant cursor-text opacity-60 transition-opacity hover:opacity-100"
                      aria-label="Edit path"
                    >
                      <Icon name="chevron_right" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <input
            type="text"
            value={currentDir}
            readOnly
            className={clsx(
              "min-w-0 flex-1 border-0 bg-transparent outline-none ring-0",
              "text-on-surface text-label-medium",
              "placeholder:text-on-surface-variant",
              "cursor-text select-all",
              "focus:outline-none focus:ring-0 rounded-extra-small focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
            )}
            placeholder="No path selected"
          />
        )}
      </motion.div>
      <IndexIndicator path={path} />
    </div>
  );
}
