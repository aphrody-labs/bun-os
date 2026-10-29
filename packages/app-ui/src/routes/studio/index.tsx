// SPDX-License-Identifier: Apache-2.0
// Studio of the desktop app: agent tools, Aphrody search and engine.
// Each section calls an existing native owner through typed Studio commands.
import { useState, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import { studioLabel, studioSection, studioSections, type StudioSection } from "./navigation";
import { useI18n } from "../../i18n";
export { studioSections, type StudioSection } from "./navigation";
import { A2AStudio } from "./A2AStudio";
import { RuntimeStudio } from "./RuntimeStudio";
import { GoogleStudio } from "./GoogleStudio";

const panels: Record<StudioSection, ComponentType> = {
  a2a: A2AStudio,
  runtime: RuntimeStudio,
  google: GoogleStudio,
};

export function StudioRoute() {
  const language = useI18n(state => state.language);
  const [params, setParams] = useSearchParams();
  const section = studioSection(params.get("section"));
  const [visited, setVisited] = useState<ReadonlySet<StudioSection>>(() => new Set([section]));
  const [prevSection, setPrevSection] = useState(section);
  if (section !== prevSection) {
    setPrevSection(section);
    setVisited(current => (current.has(section) ? current : new Set([...current, section])));
  }
  const setSection = (value: StudioSection) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set("section", value);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-6">
      <header className="flex flex-col gap-4">
        <h1 className="text-headline-medium">Studio</h1>
        <div role="tablist" aria-label="Sections du studio" className="flex flex-wrap gap-2">
          {studioSections.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={"studio-tab-" + entry.id}
              aria-controls={"studio-panel-" + entry.id}
              aria-selected={section === entry.id}
              tabIndex={section === entry.id ? 0 : -1}
              onClick={() => setSection(entry.id)}
              onKeyDown={event => {
                const nextIndex =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? studioSections.length - 1
                      : event.key === "ArrowRight"
                        ? (index + 1) % studioSections.length
                        : event.key === "ArrowLeft"
                          ? (index + studioSections.length - 1) % studioSections.length
                          : null;
                if (nextIndex === null) return;
                event.preventDefault();
                const next = studioSections[nextIndex];
                if (!next) return;
                setSection(next.id);
                document.getElementById("studio-tab-" + next.id)?.focus();
              }}
              className={
                section === entry.id
                  ? "flex min-h-12 items-center gap-2 rounded-full bg-secondary-container px-4 text-[18px] font-semibold text-on-secondary-container"
                  : "flex min-h-12 items-center gap-2 rounded-full px-4 text-[18px] text-on-surface-variant hover:bg-secondary-container/20"
              }
            >
              <span className="material-symbol text-title-medium" aria-hidden="true">
                {entry.icon}
              </span>
              {studioLabel(entry.id, language)}
            </button>
          ))}
        </div>
      </header>

      {studioSections
        .filter(entry => visited.has(entry.id) || entry.id === section)
        .map(entry => {
          const Panel = panels[entry.id];
          return (
            <section
              key={entry.id}
              id={"studio-panel-" + entry.id}
              role="tabpanel"
              aria-labelledby={"studio-tab-" + entry.id}
              hidden={entry.id !== section}
            >
              <Panel />
            </section>
          );
        })}
    </div>
  );
}
