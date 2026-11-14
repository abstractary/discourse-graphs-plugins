import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

/** The bar is one tab stop; arrow keys move along it, as a toolbar's should. */
export const useBarKeys = (bar: RefObject<HTMLElement | null>) => {
  const barFocus = useRef(0);
  const barButtons = (): HTMLButtonElement[] =>
    Array.from(bar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter((button) => button.offsetParent !== null);
  const onFocus = (event: FocusEvent) => {
    const at = barButtons().indexOf(event.target as HTMLButtonElement);
    if (at >= 0) barFocus.current = at;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const list = barButtons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !list.length) return;
    const to =
      event.key === "ArrowRight" ? (at + 1) % list.length
      : event.key === "ArrowLeft" ? (at - 1 + list.length) % list.length
      : event.key === "Home" ? 0
      : event.key === "End" ? list.length - 1
      : null;
    if (to === null) return;
    event.preventDefault();
    list[to]!.focus();
  };
  // Every render: which buttons are shown, and which are disabled, changes with what the bar fits.
  useEffect(() => {
    const list = barButtons();
    const keep = Math.min(barFocus.current, list.length - 1);
    list.forEach((button, index) => {
      button.tabIndex = index === keep ? 0 : -1;
    });
  });
  return { onKeyDown, onFocus };
};
