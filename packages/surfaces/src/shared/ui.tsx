import type { ReactNode } from "react";
import type { Credit, NodeSummary } from "@dg/contract/surface.ts";

const PATHS: Record<string, ReactNode> = {
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  note: <path d="M3.5 3.5h9v6l-3 3h-6zM9.5 12.5v-3h3" />,
  pen: <path d="M3 13l.8-3L10.6 3.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L6 12.2zM9.5 4.3l2.2 2.2" />,
  chevron: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  open: <path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.3 3.7 7.5 8.5" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  pin: <path d="M6 2.5h4l-.5 4 2 2.5h-7l2-2.5zM8 9v4.5" />,
  link: <path d="M6.8 9.2a2.4 2.4 0 0 0 3.4 0l2-2a2.4 2.4 0 0 0-3.4-3.4l-.8.8M9.2 6.8a2.4 2.4 0 0 0-3.4 0l-2 2a2.4 2.4 0 0 0 3.4 3.4l.8-.8" />,
  canvas: <path d="M3 3.5h4v4H3zM9 8.5h4v4H9zM7 5.5h3.5v3" />,
  tidy: <path d="M3 3.5h4v3H3zM3 9.5h4v3H3zM10 6.5h3v3h-3zM7 5h1.5v6H7M8.5 8H10" />,
  context: <path d="M2.5 3.5h11v9h-11zM9.5 3.5v9M11 6h1M11 8h1" />,
  back: <path d="M9.5 3.5 5 8l4.5 4.5" />,
  star: <path d="m8 2.8 1.6 3.3 3.6.5-2.6 2.5.6 3.6L8 11l-3.2 1.7.6-3.6L2.8 6.6l3.6-.5z" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  ai: <path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.5 4.5l1.8 1.8M9.7 9.7l1.8 1.8M11.5 4.5 9.7 6.3M6.3 9.7l-1.8 1.8" />,
  export: <path d="M8 10V2.5M5 5.5l3-3 3 3M3.5 9.5v4h9v-4" />,
  comment: <path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" />,
};

export const Icon = ({ name }: { name: keyof typeof PATHS }) => (
  <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {PATHS[name]}
  </svg>
);

export const Chip = ({ node }: { node?: NodeSummary | undefined }) => (
  <span className="chip" data-base={node?.base ?? "none"} style={typeStyle(node)}>
    {node?.abbreviation ?? "Type"}
  </span>
);

const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters.map((word) => word[0]!.toUpperCase()).join("").slice(0, 2) || "?";
};

/**
 * Who a unit is credited to. A circle is a person and a square is a lab, so the
 * mark reads without color, and nothing depends on an image being set.
 */
export const Mark = ({ credit, dg }: { credit: Credit; dg?: string }) => (
  <span
    className="mark"
    data-kind={credit.kind}
    data-dg={dg}
    role="img"
    aria-label={credit.kind === "lab" ? `From ${credit.name}` : `By ${credit.name}`}
    title={credit.kind === "lab" ? `From ${credit.name}` : `By ${credit.name}`}
  >
    {initialsOf(credit.name)}
  </span>
);

/** Titles can hold links, and a card reads better without the brackets. */
export const plain = (title: string): string => title.replace(/\[\[([^\]]+)\]\]/g, "$1");

/** A type's own color wins. Without one, the stylesheet colors by base type. */
export const typeStyle = (node?: NodeSummary): React.CSSProperties | undefined =>
  node?.color ? ({ "--type": node.color } as React.CSSProperties) : undefined;
