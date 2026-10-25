import { useState } from "react";
import { DotsThree } from "@phosphor-icons/react";
import { CircleButton, DropdownMenu } from "@aphrody/m3-primitives";
import { TopBarItem } from "./Context";

interface OverflowButtonProps {
  items: TopBarItem[];
}

export function OverflowButton({ items }: OverflowButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger asChild>
        <CircleButton icon={DotsThree} active={isOpen} />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="min-w-[180px] rounded-small bg-surface border border-outline-variant shadow-md3-5 py-1 z-50"
          sideOffset={8}
          align="start"
        >
          {items.map(item => {
            const isSimpleAction = !!item.onClick;

            if (isSimpleAction) {
              return (
                <DropdownMenu.Item
                  key={item.id}
                  onClick={() => item.onClick?.()}
                  className="px-3 py-2 text-body-medium text-on-surface hover:bg-on-surface/4 transition-colors outline-none cursor-pointer data-[highlighted]:bg-on-surface/8 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                >
                  {item.label}
                </DropdownMenu.Item>
              );
            }

            return (
              <DropdownMenu.Sub key={item.id}>
                <DropdownMenu.SubTrigger className="px-3 py-2 text-body-medium text-on-surface hover:bg-on-surface/4 transition-colors flex items-center justify-between outline-none cursor-pointer data-[highlighted]:bg-on-surface/8 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2">
                  <span>{item.label}</span>
                  <span className="text-on-surface-variant text-body-small">▶</span>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="z-50" sideOffset={8}>
                    {item.submenuContent || item.element}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
