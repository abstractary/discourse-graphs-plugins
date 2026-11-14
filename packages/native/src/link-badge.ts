import type { LinkBadge } from "@dg/contract/core.ts";

/**
 * Sits beside a link, in the base's own text, because a panel can't reach the
 * editor. It takes the size and color of the text around it, so it follows any
 * theme, and only the dot's hue is DG's. Both adapters draw this one badge.
 */
export const BADGE_CLASS = "dg-link-badge";

const STYLE_ID = "dg-link-badge-style";
const REF_ATTR = "data-dg-ref";

// One lightness per hue, because the badge sits on light and dark themes alike.
const HUES: Record<string, string> = {
  question: "oklch(0.66 0.12 245)",
  claim: "oklch(0.7 0.12 78)",
  evidence: "oklch(0.66 0.12 155)",
  source: "oklch(0.64 0.03 250)",
};

const CSS = `
.${BADGE_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 0.28em;
  margin-left: 0.3em;
  padding: 0 0.32em;
  height: 1.3em;
  border-radius: 0.65em;
  font-size: 0.74em;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  vertical-align: 0.08em;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  color: inherit;
  opacity: 0.72;
  transition: opacity 120ms ease-out, background-color 120ms ease-out;
}
.${BADGE_CLASS}::before {
  content: "";
  width: 0.56em;
  height: 0.56em;
  border-radius: 50%;
  background: var(--dg-badge-hue, currentColor);
}
.${BADGE_CLASS}:hover, .${BADGE_CLASS}:focus-visible {
  opacity: 1;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.${BADGE_CLASS}:focus-visible { outline: 1.5px solid currentColor; outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .${BADGE_CLASS} { transition: none; } }
`;

/** Returns what takes the styles out again. */
export const installBadgeStyle = (): (() => void) => {
  document.getElementById(STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
  return () => style.remove();
};

const describe = ({ count, typeLabel }: LinkBadge): string => {
  const relations = count === 0 ? "no relations yet" : `${count} ${count === 1 ? "relation" : "relations"}`;
  return `${typeLabel ?? "Unit"}, ${relations}. Open context`;
};

export const refOfBadge = (element: Element): string | null => element.getAttribute(REF_ATTR);

/** In place, so a count can change under a person's pointer without a redraw. */
export const paintBadge = (element: HTMLElement, badge: LinkBadge): void => {
  // With no relations, the dot alone says this is a node and what kind.
  element.textContent = badge.count > 0 ? String(badge.count) : "";
  const hue = badge.color ?? (badge.base ? HUES[badge.base] : undefined);
  if (hue) element.style.setProperty("--dg-badge-hue", hue);
  else element.style.removeProperty("--dg-badge-hue");
  const label = describe(badge);
  element.title = label;
  element.setAttribute("aria-label", label);
};

export const createBadge = ({
  ref,
  badge,
  onOpen,
}: {
  ref: string;
  badge: LinkBadge;
  onOpen: (ref: string) => void;
}): HTMLElement => {
  const element = document.createElement("span");
  element.className = BADGE_CLASS;
  element.dataset.dg = "link-badge";
  element.setAttribute(REF_ATTR, ref);
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute("contenteditable", "false");
  paintBadge(element, badge);
  // A press beside a link would otherwise follow it, or put the caret in the text.
  for (const name of ["pointerdown", "mousedown", "mouseup"]) {
    element.addEventListener(name, (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onOpen(ref);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(ref);
  });
  return element;
};
