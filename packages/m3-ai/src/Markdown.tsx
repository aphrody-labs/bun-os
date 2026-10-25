// SPDX-License-Identifier: Apache-2.0 AND MIT
// Derived from SpaceUI (packages/aphrody-spaceui/packages/ai/src/Markdown.tsx), MIT, rebuilt on Material Design 3.

"use client";

import { clsx } from "clsx";
import { forwardRef, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { type ChatLabels, resolveChatLabels } from "./chatLabels";
import { ChatIcon } from "./chatIcons";

type MarkdownSize = "small" | "medium" | "large";

interface MarkdownProps {
  content: string;
  className?: string;
  /** Body typescale of paragraphs and lists: `text-body-small|medium|large`. Default `medium`. */
  size?: MarkdownSize;
  /**
   * Render raw HTML embedded in the markdown (rehype-raw). Off by default: only enable it for
   * trusted content.
   */
  allowHtml?: boolean;
  /** Element overrides merged over the M3 renderers (e.g. citation links). */
  components?: Components;
  /**
   * Called on every link activation. Call `event.preventDefault()` to handle it yourself (e.g.
   * open the system browser from a Tauri webview).
   */
  onLinkClick?: MarkdownLinkHandler;
  /** Replaces the link element entirely. */
  renderLink?: MarkdownLinkRenderer;
  /** Visible strings of the code blocks; English defaults. */
  labels?: Partial<ChatLabels>;
}

/** Link activation callback of {@link Markdown}. */
export type MarkdownLinkHandler = (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void;

/** Custom link renderer of {@link Markdown}. */
export type MarkdownLinkRenderer = (link: {
  href: string;
  children: React.ReactNode;
  external: boolean;
}) => React.ReactNode;

/** Whether `href` leaves the page: an absolute URL with a scheme, or protocol-relative. */
export function isExternalHref(href: string | undefined): boolean {
  if (!href) return false;
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/** Safe defaults of an external link: a new browsing context without opener or referrer. */
export const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

const bodyClass: Record<MarkdownSize, string> = {
  small: "text-body-small",
  medium: "text-body-medium",
  large: "text-body-large",
};

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) return extractText((node.props as { children?: ReactNode }).children);
  return "";
}

// ---------------------------------------------------------------------------
// Language detection & mapping
// ---------------------------------------------------------------------------

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  js: "JavaScript",
  jsx: "JSX",
  python: "Python",
  py: "Python",
  rust: "Rust",
  rs: "Rust",
  bash: "Bash",
  sh: "Bash",
  shell: "Bash",
  zsh: "Bash",
  json: "JSON",
  jsonc: "JSONC",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  go: "Go",
  golang: "Go",
  java: "Java",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  csharp: "C#",
  cs: "C#",
  "c#": "C#",
  ruby: "Ruby",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  kt: "Kotlin",
  xml: "XML",
  toml: "TOML",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  graphql: "GraphQL",
  gql: "GraphQL",
  wasm: "WebAssembly",
  lua: "Lua",
  r: "R",
  diff: "Diff",
  plaintext: "Text",
  text: "Text",
  txt: "Text",
};

export function detectLanguage(raw?: string): { raw: string; label: string } {
  if (!raw) return { raw: "", label: "Code" };
  const cleaned = raw
    .replace(/^language-|^lang-/, "")
    .toLowerCase()
    .trim();
  if (LANGUAGE_MAP[cleaned]) {
    return { raw: cleaned, label: LANGUAGE_MAP[cleaned] };
  }
  const label = cleaned.length <= 3 ? cleaned.toUpperCase() : cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return { raw: cleaned, label };
}

// ---------------------------------------------------------------------------
// CodeBlock component
// ---------------------------------------------------------------------------

export interface CodeBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onCopy"> {
  code?: string;
  language?: string;
  onCopy?: (code: string) => void;
  children?: ReactNode;
  /** `copy`, `copyCode`, `copied`; English defaults. */
  labels?: Partial<ChatLabels>;
}

export function CodeBlock({
  code: explicitCode,
  language: explicitLang,
  onCopy,
  className,
  children,
  labels,
  ...restProps
}: CodeBlockProps) {
  const l = resolveChatLabels(labels);
  // Strip node passed by ReactMarkdown to avoid rendering node="[object Object]" in DOM
  const { node: _node, ...props } = restProps as Record<string, any>;

  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const childElement = isValidElement(children) ? children : null;
  const childProps = childElement ? (childElement.props as { className?: string; children?: ReactNode }) : null;

  const rawLangMatch =
    explicitLang ??
    className?.match(/language-([a-zA-Z0-9_+#-]+)/)?.[1] ??
    childProps?.className?.match(/language-([a-zA-Z0-9_+#-]+)/)?.[1];

  const { raw: rawLang, label: languageLabel } = detectLanguage(rawLangMatch);

  const rawCode = explicitCode ?? (childProps?.children ? extractText(childProps.children) : extractText(children));

  const codeContent = rawCode;
  const codeToCopy = rawCode.replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(codeToCopy);
      }
    } catch {
      // Ignore clipboard API failures in non-secure or test environments
    }
    onCopy?.(codeToCopy);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      className={clsx(
        "my-3 overflow-hidden rounded-medium border border-outline-variant bg-surface-container-highest",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container px-3 py-1.5">
        <span className="inline-flex items-center rounded-extra-small bg-surface-container-high px-2 py-0.5 text-label-small font-medium text-on-surface-variant border border-outline-variant/60">
          {languageLabel}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-small px-2 py-1 text-label-small font-medium transition-colors duration-200",
            copied
              ? "text-success"
              : "text-on-surface-variant hover:bg-on-surface/8 hover:text-on-surface active:bg-on-surface/12",
            "focus-visible:outline-2 focus-visible:outline-primary",
          )}
          aria-label={copied ? l.copied : l.copyCode}
          title={copied ? l.copied : l.copyCode}
        >
          <ChatIcon
            name={copied ? "check" : "content_copy"}
            size={16}
            className={copied ? "text-success" : undefined}
          />
          <span>{copied ? l.copied : l.copy}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-code text-body-small text-on-surface bg-surface-container-highest [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[length:inherit]">
        <code className={rawLang ? `language-${rawLang}` : undefined}>{codeContent}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Math formula rendering & typography
// ---------------------------------------------------------------------------

const GREEK_AND_SYMBOLS: Record<string, string> = {
  // Greek letters (lowercase)
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  // Greek letters (uppercase)
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  // Operators & Relations
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  approx: "≈",
  neq: "≠",
  ne: "≠",
  infty: "∞",
  cdot: "·",
  circ: "°",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  sqrt: "√",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  cup: "∪",
  cap: "∩",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  forall: "∀",
  exists: "∃",
};

function formatSubSup(text: string): ReactNode {
  const parts = text.split(
    /(\^\{[^}]+\}|\^[-+]?[a-zA-Z0-9\u0370-\u03FF\u2100-\u214F]|_\{[^}]+\}|_[-+]?[a-zA-Z0-9\u0370-\u03FF\u2100-\u214F])/g,
  );
  if (parts.length === 1) return text;

  const occurrences = new Map<string, number>();
  return parts.map(part => {
    const occurrence = occurrences.get(part) ?? 0;
    occurrences.set(part, occurrence + 1);
    const key = `${part}:${occurrence}`;
    if (part.startsWith("^")) {
      const val = part.startsWith("^{") && part.endsWith("}") ? part.slice(2, -1) : part.slice(1);
      return (
        <sup key={key} className="text-[0.75em] leading-none">
          {val}
        </sup>
      );
    }
    if (part.startsWith("_")) {
      const val = part.startsWith("_{") && part.endsWith("}") ? part.slice(2, -1) : part.slice(1);
      return (
        <sub key={key} className="text-[0.75em] leading-none">
          {val}
        </sub>
      );
    }
    return part;
  });
}

export function formatMathContent(math: string): ReactNode {
  // Step 1: Replace LaTeX symbol commands \name (or \\name)
  const text = math.replace(/\\+([a-zA-Z]+)/g, (match, name) => {
    return GREEK_AND_SYMBOLS[name] ?? match;
  });

  // Step 2: Handle \frac{num}{den}
  const fracRegex = /\\+frac\{([^{}]+)\}\{([^{}]+)\}/g;
  if (fracRegex.test(text)) {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    text.replace(fracRegex, (match, num, den, offset) => {
      if (offset > lastIndex) {
        parts.push(formatSubSup(text.slice(lastIndex, offset)));
      }
      parts.push(
        <span
          key={`frac-${offset}`}
          className="inline-flex flex-col items-center align-middle mx-1 text-center text-[0.85em] leading-none not-italic"
        >
          <span className="border-b border-current px-0.5 pb-0.5">{formatSubSup(num)}</span>
          <span className="px-0.5 pt-0.5">{formatSubSup(den)}</span>
        </span>,
      );
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < text.length) {
      parts.push(formatSubSup(text.slice(lastIndex)));
    }
    return parts;
  }

  return formatSubSup(text);
}

export interface InlineMathProps extends React.HTMLAttributes<HTMLSpanElement> {
  math: string;
}

export function InlineMath({ math, className, ...props }: InlineMathProps) {
  return (
    <span
      className={clsx("inline-flex items-center px-1 font-serif italic font-medium text-primary", className)}
      {...props}
    >
      {formatMathContent(math)}
    </span>
  );
}

export interface BlockMathProps extends React.HTMLAttributes<HTMLDivElement> {
  math: string;
}

export function BlockMath({ math, className, ...props }: BlockMathProps) {
  return (
    <div
      className={clsx(
        "my-3 flex justify-center overflow-x-auto rounded-medium bg-surface-container-low/40 px-4 py-2 text-title-medium font-serif italic font-medium text-primary",
        className,
      )}
      {...props}
    >
      {formatMathContent(math)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remark plugin for recognizing $...$ and $$...$$ expressions
// ---------------------------------------------------------------------------

function transformBlocks(parent: any) {
  if (!parent.children) return;
  const newChildren: any[] = [];
  for (const child of parent.children) {
    if (child.type === "paragraph" && Array.isArray(child.children)) {
      const hasBlockMath = child.children.some((c: any) => c.type === "text" && /\$\$[\s\S]+?\$\$/.test(c.value));
      if (hasBlockMath) {
        let currentParagraphChildren: any[] = [];
        for (const item of child.children) {
          if (item.type === "text" && /\$\$[\s\S]+?\$\$/.test(item.value)) {
            const parts = item.value.split(/(\$\$[\s\S]+?\$\$)/g);
            for (const part of parts) {
              if (part.startsWith("$$") && part.endsWith("$$") && part.length >= 4) {
                if (currentParagraphChildren.length > 0) {
                  newChildren.push({
                    type: "paragraph",
                    children: currentParagraphChildren,
                  });
                  currentParagraphChildren = [];
                }
                const mathVal = part.slice(2, -2).trim();
                newChildren.push({
                  type: "mathBlock",
                  data: {
                    hName: "div",
                    hProperties: {
                      className: "math-block",
                      "data-math": mathVal,
                    },
                    hChildren: [{ type: "text", value: mathVal }],
                  },
                  children: [{ type: "text", value: mathVal }],
                });
              } else if (part.trim().length > 0) {
                currentParagraphChildren.push({ type: "text", value: part });
              }
            }
          } else {
            currentParagraphChildren.push(item);
          }
        }
        if (currentParagraphChildren.length > 0) {
          newChildren.push({
            type: "paragraph",
            children: currentParagraphChildren,
          });
        }
        continue;
      }
    }
    transformBlocks(child);
    newChildren.push(child);
  }
  parent.children = newChildren;
}

function transformInlines(node: any) {
  if (!node.children) return;
  const newChildren: any[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("$")) {
      const parts = child.value.split(/((?<!\\)\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d))/g);
      for (const part of parts) {
        if (part.startsWith("$") && part.endsWith("$") && !part.startsWith("$$") && part.length > 2) {
          const mathVal = part.slice(1, -1).trim();
          newChildren.push({
            type: "mathInline",
            data: {
              hName: "span",
              hProperties: { className: "math-inline", "data-math": mathVal },
              hChildren: [{ type: "text", value: mathVal }],
            },
            children: [{ type: "text", value: mathVal }],
          });
        } else if (part) {
          newChildren.push({ type: "text", value: part });
        }
      }
    } else {
      transformInlines(child);
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

function transformMathTree(tree: any) {
  transformBlocks(tree);
  transformInlines(tree);
}

export function remarkMathPlugin() {
  return transformMathTree;
}

// ---------------------------------------------------------------------------
// Element overrides mapping markdown onto M3 typescale and color roles
// ---------------------------------------------------------------------------

interface LinkOptions {
  onLinkClick?: MarkdownLinkHandler;
  renderLink?: MarkdownLinkRenderer;
  labels?: Partial<ChatLabels>;
}

function m3Components(size: MarkdownSize, link: LinkOptions = {}): Components {
  const body = bodyClass[size];
  return {
    h1: ({ node: _node, className, children, ...props }) => (
      <h1 className={clsx("mt-4 mb-2 text-headline-small text-on-surface first:mt-0", className)} {...props}>
        {children}
      </h1>
    ),
    h2: ({ node: _node, className, children, ...props }) => (
      <h2 className={clsx("mt-4 mb-2 text-title-large text-on-surface first:mt-0", className)} {...props}>
        {children}
      </h2>
    ),
    h3: ({ node: _node, className, children, ...props }) => (
      <h3 className={clsx("mt-3 mb-1.5 text-title-medium text-on-surface first:mt-0", className)} {...props}>
        {children}
      </h3>
    ),
    h4: ({ node: _node, className, children, ...props }) => (
      <h4 className={clsx("mt-3 mb-1 text-title-small text-on-surface first:mt-0", className)} {...props}>
        {children}
      </h4>
    ),
    h5: ({ node: _node, className, children, ...props }) => (
      <h5 className={clsx("mt-3 mb-1 text-title-small text-on-surface-variant first:mt-0", className)} {...props}>
        {children}
      </h5>
    ),
    h6: ({ node: _node, className, children, ...props }) => (
      <h6 className={clsx("mt-3 mb-1 text-label-large text-on-surface-variant first:mt-0", className)} {...props}>
        {children}
      </h6>
    ),
    p: ({ node: _node, className, ...props }) => (
      <p className={clsx("my-2 first:mt-0 last:mb-0", body, className)} {...props} />
    ),
    a: ({ node: _node, className, children, href, onClick, ...props }) => {
      const external = isExternalHref(href);
      if (link.renderLink) return <>{link.renderLink({ href: href ?? "", children, external })}</>;
      return (
        <a
          className={clsx(
            "text-primary underline underline-offset-2 hover:decoration-2",
            "rounded-extra-small outline-none focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-secondary focus-visible:outline-offset-2",
            className,
          )}
          href={href}
          {...(external ? externalLinkProps : {})}
          onClick={event => {
            onClick?.(event);
            if (href) link.onLinkClick?.(href, event);
          }}
          {...props}
        >
          {children}
        </a>
      );
    },
    strong: ({ node: _node, className, ...props }) => (
      <strong className={clsx("font-semibold text-on-surface", className)} {...props} />
    ),
    ul: ({ node: _node, className, ...props }) => (
      <ul className={clsx("my-2 list-disc pl-6 marker:text-on-surface-variant", body, className)} {...props} />
    ),
    ol: ({ node: _node, className, ...props }) => (
      <ol className={clsx("my-2 list-decimal pl-6 marker:text-on-surface-variant", body, className)} {...props} />
    ),
    li: ({ node: _node, className, ...props }) => <li className={clsx("my-1", className)} {...props} />,
    blockquote: ({ node: _node, className, ...props }) => (
      <blockquote
        className={clsx("my-3 border-l-4 border-outline-variant pl-4 text-on-surface-variant", className)}
        {...props}
      />
    ),
    code: ({ node: _node, className, ...props }) => (
      <code
        className={clsx(
          "rounded-extra-small bg-surface-container-highest px-1 py-0.5 font-code text-[0.9em] text-on-surface",
          className,
        )}
        {...props}
      />
    ),
    pre: ({ node: _node, children, className, style }) => (
      <CodeBlock className={className} style={style} labels={link.labels}>
        {children}
      </CodeBlock>
    ),
    hr: ({ node: _node, className, ...props }) => (
      <hr className={clsx("my-4 border-outline-variant", className)} {...props} />
    ),
    table: ({ node: _node, className, ...props }) => (
      <div className="my-3 overflow-x-auto rounded-small border border-outline-variant">
        <table className={clsx("w-full border-collapse", body, className)} {...props} />
      </div>
    ),
    thead: ({ node: _node, className, ...props }) => (
      <thead className={clsx("bg-surface-container", className)} {...props} />
    ),
    th: ({ node: _node, className, ...props }) => (
      <th
        className={clsx(
          "border-b border-outline-variant px-3 py-2 text-left text-title-small text-on-surface",
          className,
        )}
        {...props}
      />
    ),
    td: ({ node: _node, className, ...props }) => (
      <td className={clsx("border-t border-outline-variant px-3 py-2 text-on-surface", className)} {...props} />
    ),
    img: ({ node: _node, className, alt, ...props }) => (
      <img className={clsx("my-2 max-w-full rounded-medium", className)} alt={alt ?? ""} {...props} />
    ),
    input: ({ node: _node, className, ...props }) => (
      <input className={clsx("mr-2 accent-primary", className)} {...props} />
    ),
    div: ({ node: _node, className, children, ...props }) => {
      if (className?.includes("math-block")) {
        const math = (props as Record<string, any>)["data-math"] ?? extractText(children);
        return <BlockMath math={math} className={className} />;
      }
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    },
    span: ({ node: _node, className, children, ...props }) => {
      if (className?.includes("math-inline")) {
        const math = (props as Record<string, any>)["data-math"] ?? extractText(children);
        return <InlineMath math={math} className={className} />;
      }
      return (
        <span className={className} {...props}>
          {children}
        </span>
      );
    },
  };
}

const Markdown = forwardRef<HTMLDivElement, MarkdownProps>(
  ({ content, className, size = "medium", allowHtml = false, components, onLinkClick, renderLink, labels }, ref) => {
    const base = m3Components(size, { onLinkClick, renderLink, labels });
    return (
      <div ref={ref} className={clsx("markdown min-w-0 text-on-surface", bodyClass[size], className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMathPlugin]}
          rehypePlugins={allowHtml ? [rehypeRaw] : undefined}
          components={components ? { ...base, ...components } : base}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  },
);

Markdown.displayName = "Markdown";

export { Markdown };
export type { MarkdownProps };
