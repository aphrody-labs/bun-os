import { twMerge } from "tailwind-merge";
import type { VFXSubTab } from "./types";

const TABS: { id: VFXSubTab; label: string }[] = [
  { id: "history", label: "History" },
  { id: "showcase", label: "Showcase" },
];

interface SubTabStripProps {
  activeTab: VFXSubTab;
  onChange: (tab: VFXSubTab) => void;
  className?: string;
}

export const SubTabStrip = ({ activeTab, onChange, className }: SubTabStripProps) => (
  <div
    className={twMerge(
      "flex shrink-0 items-center justify-center gap-1 border-b border-outline-variant bg-on-surface/[0.04] px-6 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
      className,
    )}
  >
    {TABS.map(t => (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        className={twMerge(
          "rounded-md px-3 py-1.5 text-sm font-medium uppercase tracking-wider transition-colors",
          activeTab === t.id ? "bg-on-surface/10 text-on-surface" : "text-on-surface/50 hover:bg-on-surface/5 hover:text-on-surface/80",
        )}
      >
        {t.label}
      </button>
    ))}
  </div>
);
