import type { CoreForAdapter } from "@dg/contract/core.ts";
import {
  BADGE_CLASS,
  createBadge,
  installBadgeStyle,
  paintBadge,
  refOfBadge,
} from "@dg/native/link-badge.ts";

const SWEEP_MS = 100;
// A page's own title links to itself, so a badge there says nothing new.
const SKIPPED = ".rm-title-display, .rm-zoom";

/**
 * Draws a badge after each link to a node. Roam renders a block again whenever
 * it leaves editing, so this watches the page and puts badges back.
 */
export const startBadges = ({ core }: { core: CoreForAdapter }): (() => void) => {
  const removeStyle = installBadgeStyle();
  const open = (ref: string): void => void core.showContext({ ref });

  const sweep = (): void => {
    for (const link of Array.from(document.querySelectorAll<HTMLElement>("[data-link-uid]"))) {
      // Titles hold links of their own, such as [[CLM]], and one badge is enough.
      if (link.parentElement?.closest("[data-link-uid]") || link.closest(SKIPPED)) continue;
      const ref = link.dataset.linkUid!;
      // An alias sits in a popover wrapper, which is where its text ends.
      const spot = link.matches("a.rm-alias") ? (link.closest(".bp3-popover-wrapper") ?? link) : link;
      const next = spot.nextElementSibling;
      const existing = next?.classList.contains(BADGE_CLASS) ? (next as HTMLElement) : null;
      const badge = core.badgeFor({ ref });
      if (!badge) existing?.remove();
      else if (existing && refOfBadge(existing) === ref) paintBadge(existing, badge);
      else {
        existing?.remove();
        spot.after(createBadge({ ref, badge, onOpen: open }));
      }
    }
  };

  let timer: number | undefined;
  const later = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sweep, SWEEP_MS);
  };
  const observer = new MutationObserver(later);
  observer.observe(document.body, { childList: true, subtree: true });
  const stopListening = core.onGraphChange(later);
  sweep();

  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
    stopListening();
    removeStyle();
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
  };
};
