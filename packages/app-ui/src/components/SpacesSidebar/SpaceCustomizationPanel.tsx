import { motion, AnimatePresence } from "motion/react";
import { X, Plus } from "@phosphor-icons/react";
import { useDraggable } from "@dnd-kit/core";
import { clsx } from "clsx";
import type { ItemType, SpaceItem as SpaceItemType, GroupType } from "@aphrody/drive-client";
import { SpaceItem } from "./SpaceItem";
import { createPortal } from "react-dom";
import { useId, useRef, useState } from "react";
import { useLibraryMutation } from "../../contexts/SpacedriveContext";
import { Icon, Input } from "@aphrody/m3-primitives";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface PaletteItem {
  type: ItemType;
  label: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "Overview",
    label: "Overview",
  },
  {
    type: "Recents",
    label: "Recents",
  },
  {
    type: "FileKinds",
    label: "File kinds",
  },
  {
    type: "Sources",
    label: "Sources",
  },
  {
    type: "Redundancy",
    label: "Redundancy",
  },
];

// Fixed timestamp for palette previews: these items are never persisted.
const PALETTE_PREVIEW_CREATED_AT = "1970-01-01T00:00:00.000Z";

function DraggablePaletteItem({ item }: { item: PaletteItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${item.label}`,
    data: {
      type: "palette-item",
      itemType: item.type,
    },
  });

  // Create a mock SpaceItem for rendering
  const mockSpaceItem: SpaceItemType = {
    id: `palette-${item.label}`,
    space_id: "",
    group_id: null,
    item_type: item.type,
    order: 0,
    created_at: PALETTE_PREVIEW_CREATED_AT,
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={clsx("cursor-move transition-opacity", isDragging && "opacity-50")}
    >
      <SpaceItem
        item={mockSpaceItem}
        allowInsertion={false}
        onClick={e => {
          e?.preventDefault();
          e?.stopPropagation();
        }}
      />
    </div>
  );
}

interface SpaceCustomizationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  spaceId: string | null;
}

function getDefaultGroupName(groupType: GroupType): string {
  if (groupType === "Devices") return "Devices";
  if (groupType === "Locations") return "Locations";
  if (groupType === "Tags") return "Tags";
  if (groupType === "Cloud") return "Cloud";
  if (groupType === "Custom") return "Custom Group";
  if (typeof groupType === "object" && "Device" in groupType) return "Device";
  return "Group";
}

export function SpaceCustomizationPanel({ isOpen, onClose, spaceId }: SpaceCustomizationPanelProps) {
  const [groupType, setGroupType] = useState<GroupType>("Custom");
  const [groupName, setGroupName] = useState("");
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const addGroup = useLibraryMutation("spaces.add_group");
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(dialogRef, { open: isOpen && !!spaceId, onEscape: onClose });

  if (!spaceId) return null;

  const handleAddGroup = async () => {
    if (!spaceId) return;

    try {
      const result = await addGroup.mutateAsync({
        space_id: spaceId,
        name: groupName.trim() || getDefaultGroupName(groupType),
        group_type: groupType,
      });

      // Reset form
      setGroupName("");
      setGroupType("Custom");
      setIsAddingGroup(false);

      // Scroll to the newly created group in the sidebar after a brief delay
      // (allows time for the group to be added to the DOM)
      setTimeout(() => {
        const groupElement = document.querySelector(`[data-group-id="${result.group.id}"]`);
        if (groupElement) {
          groupElement.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
          // Add a temporary highlight effect
          groupElement.classList.add("ring-2", "ring-primary/50");
          setTimeout(() => {
            groupElement.classList.remove("ring-2", "ring-primary/50");
          }, 2000);
        }
      }, 100);
    } catch (err) {
      console.error("Failed to add group:", err);
    }
  };

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 z-[65]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.25, 1, 0.5, 1] }}
            className="fixed left-[228px] top-2 bottom-2 w-[220px] z-[70]"
          >
            <div className="h-full rounded-large bg-surface-container-low flex flex-col p-2.5">
              {/* Header */}
              <div className="flex items-center justify-between px-2 py-2 mb-2">
                <div>
                  <h2 id={titleId} className="text-label-large font-semibold text-on-surface">
                    Customize
                  </h2>
                  <p className="text-body-small text-sidebar-inkDull mt-0.5">Drag to sidebar</p>
                </div>
                <button aria-label="Close"
                  onClick={onClose}
                  className="p-1 rounded-small hover:bg-secondary-container/30 transition-colors"
                >
                  <X size={14} className="text-sidebar-inkDull" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto space-y-4">
                {/* Quick Access Items */}
                <div className="space-y-0.5">
                  {PALETTE_ITEMS.map(item => (
                    <DraggablePaletteItem key={item.label} item={item} />
                  ))}
                </div>

                {/* Add Group Section */}
                <div className="space-y-2 pt-2 border-t border-outline-variant/50">
                  <div className="flex items-center justify-between px-2">
                    <span className="text-label-medium font-semibold text-sidebar-inkDull uppercase tracking-wider">
                      Groups
                    </span>
                  </div>

                  {!isAddingGroup ? (
                    <button
                      onClick={() => setIsAddingGroup(true)}
                      className="flex w-full items-center gap-2 rounded-small px-2 py-1.5 text-label-large font-medium text-sidebar-inkDull hover:text-on-surface hover:bg-secondary-container/30 transition-colors"
                    >
                      <Plus size={16} weight="bold" />
                      <span>Add group</span>
                    </button>
                  ) : (
                    <div className="space-y-2 px-2">
                      <select
                        value={typeof groupType === "string" ? groupType : "Custom"}
                        onChange={e => setGroupType(e.target.value as GroupType)}
                        className="w-full rounded-small border border-outline-variant bg-surface-container px-2 py-1.5 text-body-small text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="Devices">All devices</option>
                        <option value="Locations">All locations</option>
                        <option value="Tags">Tags</option>
                        <option value="Cloud">Cloud storage</option>
                        <option value="Custom">Custom</option>
                      </select>

                      {groupType === "Custom" && (
                        <Input
                          value={groupName}
                          onChange={e => setGroupName(e.target.value)}
                          placeholder="Group name"
                          className="text-body-small"
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              handleAddGroup();
                            } else if (e.key === "Escape") {
                              // Cancel the new group only; a second Escape closes the panel.
                              e.preventDefault();
                              setIsAddingGroup(false);
                              setGroupName("");
                            }
                          }}
                        />
                      )}

                      <div className="flex gap-2">
                        <button
                          aria-label="Add"
                          title="Add"
                          onClick={handleAddGroup}
                          className="flex-1 px-2 py-1 rounded-small bg-primary text-white text-label-medium font-medium hover:bg-primary/90 transition-colors"
                        >
                          <Icon name="add" size={18} />
                        </button>
                        <button
                          aria-label="Cancel"
                          title="Cancel"
                          onClick={() => {
                            setIsAddingGroup(false);
                            setGroupName("");
                            setGroupType("Custom");
                          }}
                          className="px-2 py-1 rounded-small text-label-medium font-medium text-sidebar-inkDull hover:bg-secondary-container/30 transition-colors"
                        >
                          <Icon name="close" size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-2 py-2 mt-2 border-t border-outline-variant/50">
                <p className="text-body-small text-sidebar-inkFaint text-center">Drag items to your space</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
