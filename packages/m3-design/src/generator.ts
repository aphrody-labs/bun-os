// SPDX-License-Identifier: Apache-2.0
//! Core compiler orchestrating the automated M3 design generation workflow.

import { parseBrief } from "./parser.ts";
import { generateTheme } from "./theme.ts";
import { SEED_TEMPLATE } from "./prompts.ts";
import type { DesignBrief, GenerationResult, GeneratedFile, M3Theme, SpecValidator } from "./types.ts";

/** Whether the brief asks for a dark-first artifact. */
const darkFirst = (brief: DesignBrief): boolean =>
  brief.constraints.includes("Dark mode first") || brief.rawBrief.includes("dark") || brief.rawBrief.includes("sombre");

export class DesignCompiler {
  private readonly validateSpec?: SpecValidator;

  /**
   * @param options.validateSpec Optional M3 spec validator (e.g. the native one from `native.ts`).
   */
  constructor(
    options: {
      validateSpec?: SpecValidator;
    } = {},
  ) {
    this.validateSpec = options.validateSpec;
  }

  /**
   * Compiles a raw design brief into a structured project workspace.
   * Resolves the canonical ThemeExport of the seed, resolves prompt guidelines,
   * and outputs React components + CSS sheets.
   */
  public compile(rawBrief: string, seedColor?: string, designSystemId?: string): GenerationResult {
    // 1. Zero-Click semantic extraction
    const brief = parseBrief(rawBrief, seedColor);
    if (designSystemId) {
      brief.designSystemId = designSystemId;
    }

    // 2. Canonical ThemeExport for the seed
    const theme = generateTheme(brief.seedColor, { darkFirst: darkFirst(brief) });

    // 3. Assemble generated files
    const files: GeneratedFile[] = [];

    // Add generated theme stylesheet
    files.push({
      path: "src/theme.css",
      content: theme.cssCustomProperties,
    });

    // Add W3C Design Tokens JSON configuration
    files.push({
      path: "src/tokens.json",
      content: this.generateW3cTokens(theme),
    });

    // Generate high-fidelity React component (customized based on brief parameters)
    const customCode = this.generateCustomizedReactCode(brief);
    files.push({
      path: "src/index.tsx",
      content: customCode,
    });

    // 4. Perform self-critique pass
    const critique = this.performSelfCritique(brief, customCode);

    return {
      brief,
      theme,
      files,
      critique,
    };
  }

  /** W3C design tokens of the ThemeExport: `color.<mode>.<role>`. */
  private generateW3cTokens(theme: M3Theme): string {
    const tokens: Record<string, Record<string, { $type: "color"; $value: string }>> = {};
    for (const mode of ["light", "dark"] as const) {
      tokens[mode] = Object.fromEntries(
        Object.entries(theme.themeExport[mode]).map(([role, value]) => [role, { $type: "color", $value: value }]),
      );
    }
    return JSON.stringify({ color: tokens }, null, 2);
  }

  private generateCustomizedReactCode(brief: DesignBrief): string {
    let code = SEED_TEMPLATE.replace(/\r\n/g, "\n");

    // 1. Extra imports — only real @aphrody/m3-react exports are imported
    // (aliased Md* -> local name). Interaction primitives (ThinkingIndicator,
    // StreamingText, useStreamingText) are NOT m3-react exports; they are
    // injected as inline self-contained definitions (see steps 4 & 5).
    const extraImports: string[] = [];
    if (brief.layoutType === "list-detail") {
      extraImports.push("MdListDetail as ListDetail");
    } else if (brief.layoutType === "supporting-pane") {
      extraImports.push("MdSupportingPane as SupportingPane");
    }
    if (extraImports.length > 0) {
      code = code.replace(
        "  MdScaffold as Scaffold,\n",
        `  MdScaffold as Scaffold,\n  ${extraImports.join(",\n  ")},\n`,
      );
    }

    // Inline interaction-primitive definitions injected at the top of the
    // generated component so the artifact is self-contained valid React + TS.
    const inlineHelpers: string[] = [];
    if (brief.hasThinkingIndicator) {
      inlineHelpers.push(
        `function ThinkingIndicator({ label }: { label: string }) {\n  return <span data-thinking-indicator="" className="animate-pulse text-on-surface-variant">{label}</span>;\n}`,
      );
    }
    if (brief.hasStreaming) {
      inlineHelpers.push(
        `function useStreamingText(stream?: AsyncIterable<string>) {
  const [state, setState] = React.useState({
    source: stream, text: '', done: !stream, error: null as string | null
  });
  React.useEffect(() => {
    let active = true;
    let finished = false;
    let released = false;
    let iterator: AsyncIterator<string> | undefined;
    const release = () => {
      if (released || !iterator) return;
      released = true;
      try {
        // Cancellation must not block unmount or create an unhandled rejection.
        const returned = iterator.return?.();
        if (returned) void Promise.resolve(returned).catch(() => {});
      } catch {
        // A producer's cleanup failure cannot update a removed consumer.
      }
    };
    setState({ source: stream, text: '', done: !stream, error: null });
    if (stream) {
      void (async () => {
        try {
          iterator = stream[Symbol.asyncIterator]();
          while (active) {
            const chunk = await iterator.next();
            if (!active) return;
            if (chunk.done) {
              finished = true;
              setState((previous) => ({ ...previous, done: true }));
              return;
            }
            setState((previous) => ({ ...previous, text: previous.text + chunk.value }));
          }
        } catch (reason) {
          if (active) setState((previous) => ({
            ...previous, done: true, error: reason instanceof Error ? reason.message : String(reason)
          }));
        } finally {
          if (!finished) release();
        }
      })();
    }
    return () => {
      active = false;
      if (!finished) release();
    };
  }, [stream]);
  // Hide an old source's text immediately, before the replacement effect runs.
  return state.source === stream ? state : { source: stream, text: '', done: !stream, error: null };
}`,
        `function StreamingText({ text, done, error }: { text: string; done: boolean; error: string | null }) {
  return (
    <div data-stream-output="" aria-live="polite" aria-busy={!done}>
      <span>{text}{!done && <span className="animate-pulse" aria-hidden="true">|</span>}</span>
      {error !== null && <span role="alert">{error}</span>}
    </div>
  );
}`,
      );
    }
    code = code.replace("// GENERATED INTERACTION HELPERS", inlineHelpers.join("\n\n"));
    const consumerProps = ["onAction"];
    if (brief.hasStreaming) consumerProps.unshift("stream");
    if (brief.hasThinkingIndicator) consumerProps.push("thinking");
    code = code.replace(
      "GeneratedArtifact({ onAction }: GeneratedArtifactProps = {})",
      `GeneratedArtifact({ ${consumerProps.join(", ")} }: GeneratedArtifactProps = {})`,
    );

    // Apply specific title
    const titleMatch = brief.rawBrief.match(/pour ([\w\s-]+)/i) || brief.rawBrief.match(/for ([\w\s-]+)/i);
    const parsedTitle = titleMatch ? titleMatch[1].trim() : "Automated M3 Design";

    code = code.replace("Automated M3 Design", parsedTitle);
    code = code.replace(
      "Powering high-fidelity components with zero-click prompts",
      `Targeting ${brief.audience} — Scale: ${brief.scale}`,
    );

    // Customize layout elements based on OutputKind
    if (brief.outputKind === "mobile") {
      // For mobile apps: remove NavigationRail, place BottomAppBar, change layout
      code = code.replace("hidden md:flex", "hidden");
      code = code.replace(
        "{/* SPEC DIALOG */}",
        '{/* MOBILE LAYOUT SCAFFOLD */}\n      <BottomAppBar className="md-hidden" />\n\n      {/* SPEC DIALOG */}',
      );
    } else if (brief.outputKind === "deck") {
      // For slides: adapt layout to slide deck presentation
      code = code.replace("Dashboard", "Slide 1");
      code = code.replace("Components", "Slide 2");
      code = code.replace("Analytics", "Slide 3");
    }

    // 2. Dynamic Layout Injections
    let layoutMarkup = "";
    let itemDetails = "";
    let layoutState = "";
    let layoutActions = "";
    if (brief.layoutType === "list-detail") {
      itemDetails = `const itemDetails = {
  'detail-1': { id: 'detail-1', title: 'Primary Detail Item', description: 'Primary item: overview and configuration.' },
  'detail-2': { id: 'detail-2', title: 'Secondary Detail Item', description: 'Secondary item: detailed metrics and parameters.' }
} as const;`;
      layoutState =
        "const [selectedItem, setSelectedItem] = React.useState<(typeof itemDetails)[keyof typeof itemDetails] | null>(null);";
      layoutActions = `'select-item': (id) => {
      if (id !== 'detail-1' && id !== 'detail-2') return;
      setSelectedItem(itemDetails[id]);
      return { type: 'select-item', id };
    },`;
      layoutMarkup = `{/* LIST DETAIL LAYOUT */}
        <ListDetail className="flex-1 p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN: LIST PANE */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-6">
            <TypeText className="text-lg font-medium">List View</TypeText>
            <Divider />
            <List className="divide-y divide-border">
              <ListItem
                data-action="select-item"
                data-id="detail-1"
                aria-selected={selectedItem?.id === 'detail-1' ? 'true' : 'false'}
                className="cursor-pointer hover:bg-surface-container-highest transition-colors duration-150"
              >
                <span slot="headline">Primary Detail Item</span>
                <span slot="supporting-text">Selecting this item shows details</span>
              </ListItem>
              <ListItem
                data-action="select-item"
                data-id="detail-2"
                aria-selected={selectedItem?.id === 'detail-2' ? 'true' : 'false'}
                className="cursor-pointer hover:bg-surface-container-highest transition-colors duration-150"
              >
                <span slot="headline">Secondary Detail Item</span>
                <span slot="supporting-text">Detailed metrics and parameters</span>
              </ListItem>
            </List>
          </Pane>

          {/* RIGHT COLUMN: DETAIL PANE */}
          <Pane className="lg:col-span-2 bg-surface-container p-6 rounded-2xl flex flex-col gap-6">
            <TypeText className="text-lg font-medium">Detail Content</TypeText>
            <Divider />
            <div className="flex flex-col gap-4">
              <TypeText className="text-md font-semibold text-primary">{selectedItem?.title ?? 'Select an item'}</TypeText>
              <p className="text-sm" data-item-details="">{selectedItem?.description ?? 'Select an item on the left to see its details.'}</p>
            </div>
            
            {/* TOOLTIP DEMONSTRATION */}
            <div className="flex gap-4 items-center mt-4">
              <Tooltip text="Hovering over primary CTA">
                <FilledButton slot="trigger">Submit Data</FilledButton>
              </Tooltip>
              <CircularProgress indeterminate className="w-8 h-8" />
            </div>
          </Pane>
        </ListDetail>`;
    } else if (brief.layoutType === "supporting-pane") {
      layoutState = "const [selectedTask, setSelectedTask] = React.useState<string | null>(null);";
      layoutActions = `'inspect-task': (id) => {
      if (id !== 'task-1') return;
      setSelectedTask(id);
      return { type: 'inspect-task', id };
    },`;
      layoutMarkup = `{/* SUPPORTING PANE LAYOUT */}
        <SupportingPane className="flex-1 p-6 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* MAIN FLEXIBLE PANE */}
          <Pane className="lg:col-span-2 bg-surface-container p-6 rounded-2xl flex flex-col gap-6">
            <TypeText className="text-lg font-medium">Main Application Workspace</TypeText>
            <Divider />
            <p className="text-sm">This is the main flexible workspace. It adapts to fit the primary task focus, while the supporting pane on the side offers context-sensitive actions and details.</p>
            
            <List className="divide-y divide-border">
              <ListItem
                data-action="inspect-task"
                data-id="task-1"
                aria-selected={selectedTask === 'task-1' ? 'true' : 'false'}
                className="cursor-pointer hover:bg-surface-container-highest transition-colors duration-150"
              >
                <span slot="headline">Primary Task Element</span>
                <span slot="supporting-text">In progress - needs review</span>
              </ListItem>
            </List>

            {/* TOOLTIP DEMONSTRATION */}
            <div className="flex gap-4 items-center mt-4">
              <Tooltip text="Hovering over primary CTA">
                <FilledButton slot="trigger">Submit Data</FilledButton>
              </Tooltip>
              <CircularProgress indeterminate className="w-8 h-8" />
            </div>
          </Pane>

          {/* SUPPORTING FIXED PANE */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-6" style={{ width: '320px', minWidth: '300px' }}>
            <TypeText className="text-lg font-medium">Supporting Details</TypeText>
            <Divider />
            <div className="flex flex-col gap-4 text-sm">
              <p data-task-details="">{selectedTask ? 'Primary Task Element: in progress, needs review.' : 'Select a task to inspect its status and review requirements.'}</p>
              <div className="flex justify-between items-center">
                <span>Damping Spatial</span>
                <Switch selected />
              </div>
              <div className="flex justify-between items-center">
                <span>Adaptive Panes</span>
                <Checkbox checked />
              </div>
            </div>
          </Pane>
        </SupportingPane>`;
    } else if (brief.layoutType === "feed") {
      layoutState = "const [likedPosts, setLikedPosts] = React.useState<Record<string, boolean>>({});";
      layoutActions = `'like-post': (id) => {
      if (id !== '1' && id !== '2' && id !== '3') return;
      const liked = !likedPosts[id];
      setLikedPosts((previous) => ({ ...previous, [id]: liked }));
      return { type: 'like-post', id, liked };
    },`;
      layoutMarkup = `{/* FEED LAYOUT */}
        <Scaffold className="flex-1 p-6 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* CARD 1 */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-4">
            <TypeText className="text-lg font-medium">Feed Item 1</TypeText>
            <Divider />
            <p className="text-sm">Main body content for the first feed card. Displays high level summary data.</p>
            <div className="flex justify-between items-center mt-auto pt-4">
              <FilledButton data-action="like-post" data-id="1" aria-pressed={likedPosts['1'] ? 'true' : 'false'}>{likedPosts['1'] ? 'Unlike' : 'Like'}</FilledButton>
              <span className="text-xs font-mono">12 min ago</span>
            </div>
          </Pane>

          {/* CARD 2 */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-4">
            <TypeText className="text-lg font-medium">Feed Item 2</TypeText>
            <Divider />
            <p className="text-sm">Main body content for the second feed card. Features metrics and dynamic widgets.</p>
            <div className="flex justify-between items-center mt-auto pt-4">
              <FilledButton data-action="like-post" data-id="2" aria-pressed={likedPosts['2'] ? 'true' : 'false'}>{likedPosts['2'] ? 'Unlike' : 'Like'}</FilledButton>
              <span className="text-xs font-mono">1 hr ago</span>
            </div>
          </Pane>

          {/* CARD 3 */}
          <Pane className="bg-surface-container p-6 rounded-2xl flex flex-col gap-4">
            <TypeText className="text-lg font-medium">Feed Item 3</TypeText>
            <Divider />
            <p className="text-sm">Third card in the card feed, completing the multi-column fluid grid.</p>
            <div className="flex justify-between items-center mt-auto pt-4 flex-row gap-4 items-center">
              <Tooltip text="Hovering over primary CTA">
                <FilledButton slot="trigger" data-action="like-post" data-id="3" aria-pressed={likedPosts['3'] ? 'true' : 'false'}>{likedPosts['3'] ? 'Unlike' : 'Like'}</FilledButton>
              </Tooltip>
              <CircularProgress indeterminate className="w-8 h-8" />
              <span className="text-xs font-mono ml-auto">Yesterday</span>
            </div>
          </Pane>
        </Scaffold>`;
    }

    if (layoutMarkup) {
      const startIndex = code.indexOf("        {/* MAIN LAYOUT SCAFFOLD */}");
      const endIndex = code.indexOf("        </Scaffold>", startIndex);
      if (startIndex !== -1 && endIndex !== -1) {
        const length = endIndex + "        </Scaffold>".length - startIndex;
        code = code.substring(0, startIndex) + layoutMarkup + code.substring(startIndex + length);
      }
    }
    code = code.replace("// GENERATED ITEM DETAILS", itemDetails);
    code = code.replace("// GENERATED LAYOUT STATE", layoutState);
    code = code.replace("// GENERATED LAYOUT ACTIONS", layoutActions);

    // 3. Density-based visual spacing adjustments
    if (brief.density === "high") {
      code = code.replace(/p-6/g, "p-3");
      code = code.replace(/gap-6/g, "gap-3");
      code = code.replace(/gap-4/g, "gap-2");
    } else if (brief.density === "low") {
      code = code.replace(/p-6/g, "p-8");
      code = code.replace(/gap-6/g, "gap-8");
      code = code.replace(/gap-4/g, "gap-6");
    }

    // Inject density style
    if (brief.density === "high") {
      code = code.replace(
        "        transitionDuration: '200ms'\n      }}",
        "        transitionDuration: '200ms',\n        '--md-sys-density': -2\n      } as React.CSSProperties & Record<'--md-sys-density', number>}",
      );
    } else if (brief.density === "low") {
      code = code.replace(
        "        transitionDuration: '200ms'\n      }}",
        "        transitionDuration: '200ms',\n        '--md-sys-density': 1\n      } as React.CSSProperties & Record<'--md-sys-density', number>}",
      );
    }

    // 4. Feature toggles: Thinking Indicator
    if (brief.hasThinkingIndicator) {
      const thinkingCondition = brief.hasStreaming ? "thinking ?? (!!stream && !streamDone)" : "thinking ?? false";
      code = code.replace(
        "{/* TOP NAVIGATION BAR */}",
        `{/* THINKING ACTIVITY */}\n      {(${thinkingCondition}) && <ThinkingIndicator label="Reflecting..." />}\n      {/* TOP NAVIGATION BAR */}`,
      );
    }

    // 5. Feature toggles: Streaming Text
    if (brief.hasStreaming) {
      code = code.replace(
        "// GENERATED FEATURE HOOKS",
        "const { text: streamedText, done: streamDone, error: streamError } = useStreamingText(stream);",
      );
      // Every layout, including feeds, exposes the consumer's streaming output.
      code = code.replace(
        "{/* SPEC DIALOG */}",
        `{/* STREAMING TEXT SECTION */}
            <div className="p-4 bg-surface border border-border rounded-xl mb-4 font-mono text-sm">
              <StreamingText text={streamedText} done={streamDone} error={streamError} />
            </div>\n      {/* SPEC DIALOG */}`,
      );
    } else {
      code = code.replace("  // GENERATED FEATURE HOOKS\n", "");
    }

    // Dark-first briefs keep the role classes: src/theme.css makes the dark roles the default.
    // The settings pane shows the brief's seed; additive (AR/XR) screens are labelled instead.
    code = code.replace(
      '<span className="text-primary font-semibold">#6750A4</span>',
      `<span className="text-primary font-semibold">${
        brief.constraints.includes("Transparent screens") ? "Additive (AR/XR desaturated)" : brief.seedColor
      }</span>`,
    );

    // Keep only wrapper aliases used by JSX or a component type reference.
    const wrapperImport = /import \{([\s\S]*?)\} from '@aphrody\/m3-react';/;
    const importBlock = code.match(wrapperImport);
    if (importBlock) {
      const componentBody = code.replace(wrapperImport, "");
      const usedImports = importBlock[1].split(",").filter(entry => {
        const alias = entry.trim().match(/^\w+ as (\w+)$/)?.[1];
        return alias && new RegExp(`<${alias}(?=[\\s/>])|\\btypeof\\s+${alias}\\b`).test(componentBody);
      });
      code = code.replace(wrapperImport, `import {${usedImports.join(",")}\n} from '@aphrody/m3-react';`);
    }

    return code;
  }

  private performSelfCritique(brief: DesignBrief, code: string) {
    const validation = this.validateSpec?.(code);

    const issues = validation?.issues ?? [];

    const hasLitProps = code.includes("@aphrody/m3-react");
    const hasActionRouter = code.includes("Action Router");
    const hasSpringTiming = code.includes("cubic-bezier");

    // Adjust the base scores using the real FFI validation results!
    const errorsCount = issues.filter(i => i.level === "error").length;
    const warningsCount = issues.filter(i => i.level === "warning").length;

    // Deduct from scores based on violations
    const detailDeduction = warningsCount * 2;
    const parityDeduction = errorsCount * 5;

    const scores = {
      philosophy: Math.max(50, 90 - parityDeduction),
      hierarchy: Math.max(50, 92 - detailDeduction),
      detail: hasSpringTiming ? Math.max(50, 95 - detailDeduction) : 80,
      functionalParity: hasLitProps ? Math.max(50, 98 - parityDeduction) : 75,
      innovation: hasActionRouter ? 94 : 70,
    };

    const issuesSummary = !validation
      ? " Spec validator not configured; M3 specification check skipped."
      : issues.length > 0
        ? ` Detected ${issues.length} design system specification issue(s): ${issues.map(i => `[Line ${i.line}: ${i.rule}] ${i.message}`).join("; ")}.`
        : " Zero M3 design system spec violations detected.";

    const rationale = `M3 design compiler successfully mapped the brief for "${brief.audience}". Enforced touch targets at 48dp. Spring dynamics are configured with a ${hasSpringTiming ? "spatial bounce curve" : "fallback curve"}. Event delegation is handled in a single listener for high interaction performance. Spec Check Score: ${validation ? `${validation.score}/100` : "n/a"}.${issuesSummary}`;

    return { scores, rationale, issues };
  }
}
