import { Fragment, type ReactNode } from "react";
import type { NodeSummary } from "@dg/contract/surface.ts";
import { marksOf, wordsOf, type TextMarks } from "@dg/contract/words.ts";

const PATHS: Record<string, ReactNode> = {
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  note: <path d="M3.5 3.5h9v6l-3 3h-6zM9.5 12.5v-3h3" />,
  pen: <path d="M3 13l.8-3L10.6 3.2a1.1 1.1 0 0 1 1.6 0l.6.6a1.1 1.1 0 0 1 0 1.6L6 12.2zM9.5 4.3l2.2 2.2" />,
  chevron: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  sidebar: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M6.5 3v10M4 5.5h1M4 7.5h1" /></>,
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
  inside: <path d="M2.5 2.5h11v11h-11zM5.5 5.5h5v5h-5zM5.5 5.5 2.5 2.5M10.5 10.5l3 3" />,
  marker: <path d="M2.5 13.5h11M4.5 11.5l1-3 5.5-5.5 2 2-5.5 5.5zM9.5 4l2 2" />,
  search: <path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3l3.2 3.2" />,
  undo: <path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13 6.5H6.5a3.5 3.5 0 0 0 0 7H9" />,
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />,
  pdf: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8.5h4M6 10.5h4" />,
  card: <path d="M2.5 3.5h11v9h-11zM5 6.5h6M5 9h3.5M10.5 9h.5" />,
  library: <path d="M3 2.5v11M6 2.5v11M9 3l3.2 10.3" />,
};

export type IconName = keyof typeof PATHS;

export const Icon = ({ name }: { name: IconName }) => (
  <svg className="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    {PATHS[name]}
  </svg>
);

export const Chip = ({ node }: { node?: NodeSummary | undefined }) => (
  <span className="chip" data-base={node?.base ?? "none"} style={typeStyle(node)}>
    {node?.abbreviation ?? "Type"}
  </span>
);

export { Mark } from "./people.tsx";

/** Titles can hold links, and a card reads better without the brackets. */
export const plain = (title: string): string => title.replace(/\[\[([^\]]+)\]\]/g, "$1");

/** A type's own color wins. Without one, the stylesheet colors by base type. */
export const typeStyle = (node?: NodeSummary): React.CSSProperties | undefined =>
  node?.color ? ({ "--type": node.color } as React.CSSProperties) : undefined;

/** Text with the searched words marked. Link brackets come out first, as on a card. */
export const Marked = ({ text, marks }: { text: string; marks: TextMarks }) => {
  if (!marks.length) return <>{plain(text)}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  marks.forEach(([start, end], index) => {
    if (start > at) parts.push(<Fragment key={`t${index}`}>{text.slice(at, start)}</Fragment>);
    parts.push(<mark key={`m${index}`}>{text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
};

/** Marks a search's words in any text, folded the way search folds them. */
export const Highlighted = ({ text, query }: { text: string; query: string }) => {
  const shown = plain(text);
  const words = wordsOf(query);
  return <Marked text={shown} marks={words.length ? marksOf(shown, words) : []} />;
};
