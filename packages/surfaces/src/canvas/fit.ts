import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * How much a toolbar can show in the width it has: every label, only the
 * labels no icon can stand in for, icons only, or icons with the least-used
 * tools folded into a More menu. It measures
 * rather than guessing a breakpoint, because a canvas name or a translated
 * label changes what fits. Each level's width is remembered once it's been
 * seen, so the bar steps back up as soon as there's room, without flicker.
 */

export type Fit = "labels" | "compact" | "icons" | "more";
/** Every label; then only the words no icon can say (marked `keep`); then icons; then a More menu. */
const LEVELS: Fit[] = ["labels", "compact", "icons", "more"];
/** Room kept spare before stepping back up, so a pixel's change doesn't flip it. */
const SLACK = 12;

/** What a bar needs at its current level: its fixed parts, plus a little of the parts that shrink. */
const needed = (bar: HTMLElement): number => {
  const style = getComputedStyle(bar);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
  const parts = Array.from(bar.children) as HTMLElement[];
  const width = parts.reduce((sum, part) => {
    // A part that shrinks, such as the canvas name or the status line, asks only for its floor.
    const floor = Number.parseFloat(part.dataset.fitMin ?? "");
    if (!Number.isNaN(floor)) return sum + Math.min(floor, part.scrollWidth);
    return sum + part.getBoundingClientRect().width;
  }, 0);
  return width + gap * Math.max(0, parts.length - 1) + padding;
};

export const useFit = (bar: RefObject<HTMLElement | null>, watch: unknown[] = []): Fit => {
  const [level, setLevel] = useState(0);
  const need = useRef<(number | null)[]>([null, null, null, null]);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return undefined;
    const settle = () => {
      const room = element.clientWidth;
      if (!room) return;
      const here = needed(element);
      need.current[level] = here;
      if (here > room && level < LEVELS.length - 1) {
        setLevel(level + 1);
        return;
      }
      const above = level > 0 ? (need.current[level - 1] ?? null) : null;
      if (above !== null && above + SLACK <= room) setLevel(level - 1);
    };
    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar, level, ...watch]);

  return LEVELS[level]!;
};
