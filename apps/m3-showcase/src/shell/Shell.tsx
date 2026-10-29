// The adaptive shell. One component tree, three layouts chosen from the window size class and the layout mode:
//   mobile  (compact)          top app bar, content, bottom navigation bar, "More" sheet for the other destinations
//   desktop (medium and up)    navigation rail (medium, expanded) or standard drawer (large, extra large) beside the content
//   tv                         10-foot drawer, large type, focus ring, D-pad (arrow keys + Enter + Back) navigation
import { useM3Theme } from "@aphrody/m3-theme/react";
import {
  Component,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import closeIcon from "m3:icons/close";
import contrastIcon from "m3:icons/contrast";
import darkIcon from "m3:icons/dark_mode";
import lightIcon from "m3:icons/light_mode";
import { attachDpad } from "@aphrody/app-ui/material/adaptive/dpad.ts";
import { useAdaptive, type AdaptiveState } from "@aphrody/app-ui/material/adaptive/window.ts";
import { Svg } from "@aphrody/app-ui/material/ui.tsx";
import { PAGES } from "@aphrody/app-ui/material/pages/index.ts";
import { useRoute } from "../router.ts";
import {
  DESTINATIONS,
  MORE_ICON,
  MORE_ICON_FILLED,
  PRIMARY_IDS,
  findDestination,
  type Destination,
} from "@aphrody/app-ui/material/nav.ts";

const MODE_LABEL = { light: "Light", dark: "Dark", system: "System" } as const;

function ThemeModeButton() {
  const { themeMode, setThemeMode } = useM3Theme();
  const next =
    themeMode === "system"
      ? "light"
      : themeMode === "light"
        ? "dark"
        : "system";
  const icon =
    themeMode === "light"
      ? lightIcon
      : themeMode === "dark"
        ? darkIcon
        : contrastIcon;
  return (
    <button
      type="button"
      className="state-layer inline-flex size-12 items-center justify-center rounded-full text-on-surface-variant"
      aria-label={`Colour scheme: ${MODE_LABEL[themeMode]}. Switch to ${MODE_LABEL[next]}`}
      title={`Colour scheme: ${MODE_LABEL[themeMode]}`}
      onClick={() => setThemeMode(next)}
    >
      <Svg html={icon} />
    </button>
  );
}

function TopBar({ a, current }: { a: AdaptiveState; current: Destination }) {
  return (
    <header
      className="flex h-16 shrink-0 items-center gap-2 bg-surface px-(--m3-gutter) text-on-surface"
      role="banner"
    >
      <div
        className={`${a.mode === "tv" ? "text-headline-medium" : "text-title-large"} flex-1 truncate`}
        data-testid="top-title"
      >
        {a.mode === "mobile" ? current.label : `Aphrody M3 / ${current.label}`}
      </div>
      <span
        className="hidden rounded-full bg-secondary-container px-3 py-1 text-label-medium text-on-secondary-container expanded:inline"
        data-testid="window-class"
        title="Window size class, M3 breakpoints"
      >
        {a.width} · {a.mode}
      </span>
      <ThemeModeButton />
    </header>
  );
}

function NavItem({
  item,
  selected,
  variant,
  onSelect,
}: {
  item: Destination;
  selected: boolean;
  variant: "bar" | "rail" | "drawer";
  onSelect: (id: string) => void;
}) {
  const icon = <Svg html={selected ? item.iconFilled : item.icon} />;
  if (variant === "drawer") {
    return (
      <a
        href={`#/${item.id}`}
        data-dpad
        data-testid={`nav-${item.id}`}
        aria-current={selected ? "page" : undefined}
        className={`state-layer flex h-14 w-full items-center gap-3 rounded-full px-4 text-label-large ${selected ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"}`}
        onClick={(event) => {
          if (
            event.button === 0 &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            onSelect(item.id);
          }
        }}
      >
        {icon}
        <span className="truncate">{item.label}</span>
      </a>
    );
  }
  return (
    <a
      href={`#/${item.id}`}
      data-dpad
      data-testid={`nav-${item.id}`}
      aria-current={selected ? "page" : undefined}
      className={`state-layer group flex ${variant === "bar" ? "flex-1 py-3" : "w-full py-1.5"} flex-col items-center gap-1 text-label-medium ${selected ? "text-on-surface" : "text-on-surface-variant"}`}
      onClick={() => onSelect(item.id)}
    >
      <span
        className={`flex h-8 w-16 items-center justify-center rounded-full ${selected ? "bg-secondary-container text-on-secondary-container" : ""}`}
      >
        {icon}
      </span>
      <span className="max-w-full truncate px-1">{item.label}</span>
    </a>
  );
}

function SideNav({
  a,
  route,
  navigate,
}: {
  a: AdaptiveState;
  route: string;
  navigate: (id: string) => void;
}) {
  const drawer = a.mode === "tv" || a.navigation === "rail-expanded";
  return (
    <nav
      aria-label="Destinations"
      className={`m3-scroll flex shrink-0 flex-col gap-1 overflow-y-auto bg-surface p-3 ${drawer ? (a.mode === "tv" ? "w-[19rem]" : "w-[22.5rem]") : "w-24"}`}
      data-testid={drawer ? "drawer" : "rail"}
    >
      {DESTINATIONS.map((item) => (
        <NavItem
          key={item.id}
          item={item}
          selected={route === item.id}
          variant={drawer ? "drawer" : "rail"}
          onSelect={navigate}
        />
      ))}
    </nav>
  );
}

function BottomBar({
  route,
  navigate,
  onMore,
}: {
  route: string;
  navigate: (id: string) => void;
  onMore: () => void;
}) {
  const primary = PRIMARY_IDS.map(findDestination);
  const moreSelected = !PRIMARY_IDS.includes(
    route as (typeof PRIMARY_IDS)[number],
  );
  return (
    <nav
      aria-label="Destinations"
      className="flex h-20 shrink-0 items-stretch bg-surface-container px-2 pb-[env(safe-area-inset-bottom)]"
      data-testid="bottom-bar"
    >
      {primary.map((item) => (
        <NavItem
          key={item.id}
          item={item}
          selected={route === item.id}
          variant="bar"
          onSelect={navigate}
        />
      ))}
      <button
        type="button"
        data-testid="nav-more"
        aria-haspopup="dialog"
        className={`state-layer flex flex-1 flex-col items-center gap-1 py-3 text-label-medium ${moreSelected ? "text-on-surface" : "text-on-surface-variant"}`}
        onClick={onMore}
      >
        <span
          className={`flex h-8 w-16 items-center justify-center rounded-full ${moreSelected ? "bg-secondary-container text-on-secondary-container" : ""}`}
        >
          <Svg html={moreSelected ? MORE_ICON_FILLED : MORE_ICON} />
        </span>
        <span>More</span>
      </button>
    </nav>
  );
}

/** The destinations behind "More", as a modal bottom sheet on a native <dialog> (focus trap and Escape for free). */
function MoreSheet({
  open,
  route,
  navigate,
  onClose,
}: {
  open: boolean;
  route: string;
  navigate: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-extra-large bg-surface-container-low p-4 text-on-surface backdrop:bg-scrim/32"
      data-testid="more-sheet"
      aria-label="All destinations"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-title-large">All destinations</h2>
        <button
          type="button"
          className="state-layer inline-flex size-12 items-center justify-center rounded-full"
          aria-label="Close"
          onClick={onClose}
        >
          <Svg html={closeIcon} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {DESTINATIONS.map((item) => (
          <a
            key={item.id}
            href={`#/${item.id}`}
            data-testid={`more-${item.id}`}
            aria-current={route === item.id ? "page" : undefined}
            className={`state-layer flex flex-col items-center gap-1 rounded-large p-3 text-label-medium ${route === item.id ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant"}`}
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                navigate(item.id);
                onClose();
              }
            }}
          >
            <Svg html={route === item.id ? item.iconFilled : item.icon} />
            <span className="truncate">{item.label}</span>
          </a>
        ))}
      </div>
    </dialog>
  );
}

function PageSlot({
  a,
  route,
  children,
}: {
  a: AdaptiveState;
  route: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // After a route change the page, not the nav, takes focus: screen readers announce the new title. TV keeps the nav focused.
    if (a.mode !== "tv") heading.current?.focus({ preventScroll: true });
  }, [route, a.mode]);
  return (
    <main
      id="main"
      ref={heading}
      tabIndex={-1}
      className="m3-scroll min-w-0 flex-1 overflow-y-auto rounded-tl-extra-large bg-surface-container-lowest outline-none"
      data-testid="main"
      data-route={route}
      aria-labelledby="page-title"
    >
      {children}
    </main>
  );
}

class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return (
        <div className="p-6" role="alert">
          <h1 id="page-title" className="text-headline-medium">
            Unable to load this page
          </h1>
          <p>Reload to try again.</p>
          <button
            type="button"
            className="state-layer rounded-full bg-primary px-6 py-3 text-on-primary"
            onClick={() => location.reload()}
          >
            Reload
          </button>
        </div>
      );
    return this.props.children;
  }
}

export function Shell() {
  const a = useAdaptive();
  const { route, navigate } = useRoute();
  const [more, setMore] = useState(false);
  const current = findDestination(route);
  const Page = PAGES[current.id];

  useEffect(
    () =>
      a.mode === "tv" || document.documentElement.dataset["dpad"] === "on"
        ? attachDpad({ onBack: () => history.back() })
        : undefined,
    [a.mode],
  );
  useEffect(() => {
    document.title = `${current.label} · Aphrody M3 Showcase`;
  }, [current.label]);

  return (
    <div
      className="flex h-full flex-col bg-surface"
      data-testid="shell"
      data-layout={a.mode}
    >
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-on-primary"
      >
        Skip to content
      </a>
      <TopBar a={a} current={current} />
      <div className="flex min-h-0 flex-1">
        {a.mode !== "mobile" ? (
          <SideNav a={a} route={current.id} navigate={navigate} />
        ) : null}
        <PageSlot a={a} route={current.id}>
          <PageBoundary key={current.id}>
            <Suspense
              fallback={
                <div
                  className="p-6 text-body-medium text-on-surface-variant"
                  role="status"
                >
                  Loading {current.label}…
                </div>
              }
            >
              <Page adaptive={a} />
            </Suspense>
          </PageBoundary>
        </PageSlot>
      </div>
      {a.mode === "mobile" ? (
        <BottomBar
          route={current.id}
          navigate={navigate}
          onMore={() => setMore(true)}
        />
      ) : null}
      {a.mode === "mobile" ? (
        <MoreSheet
          open={more}
          route={current.id}
          navigate={navigate}
          onClose={() => setMore(false)}
        />
      ) : null}
    </div>
  );
}
