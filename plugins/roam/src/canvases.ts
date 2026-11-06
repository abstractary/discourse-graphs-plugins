import type { CoreForAdapter } from "@dg/contract/core.ts";

const HOLDER = "dg-canvas-page";
const STYLE = "dg-canvas-page-style";
const ENTRY = "dg-left-canvases";
const WATCH_MS = 700;

const CSS = `
.dg-canvas-on { max-width: none !important; padding: 8px 12px 0 !important; }
.dg-canvas-on .rm-block-children.rm-level-0, .dg-canvas-on .rm-reference-wrapper { display: none !important; }
.dg-canvas-on .rm-title-display { font-size: 1.15em; margin: 0 0 6px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${HOLDER} { height: calc(100vh - 110px); border: 1px solid rgba(16, 22, 26, 0.15); border-radius: 4px; overflow: hidden; }
`;

export const canvasShowing = (): boolean => Boolean(document.getElementById(HOLDER)?.isConnected);

// Roam reuses the article when it changes page, so this has to come off by hand.
const clearPage = (): void => {
  document.querySelectorAll(".dg-canvas-on").forEach((article) => article.classList.remove("dg-canvas-on"));
  document.getElementById(HOLDER)?.remove();
};

/**
 * A canvas lives on its own page, so All Pages, search, shortcuts and links all
 * find it, and leaving is just going somewhere else. The left sidebar gets one
 * entry beside Roam's own.
 */
export const startCanvasPages = ({
  core,
  openPage,
  mountCanvas,
  onUnmount,
  openPanel,
}: {
  core: () => CoreForAdapter | undefined;
  openPage: () => Promise<string | null>;
  mountCanvas: (id: string) => HTMLIFrameElement;
  onUnmount: () => void;
  openPanel: () => void;
}): (() => void) => {
  // Roam can take the page away before this notices, so the holder alone can't say.
  let mounted = false;
  const removeHolder = (): void => {
    clearPage();
    if (!mounted) return;
    mounted = false;
    onUnmount();
  };

  const placeEntry = (): void => {
    if (document.getElementById(ENTRY)) return;
    const after = document.querySelector(".rm-left-sidebar__all-pages");
    if (!after) return;
    const entry = document.createElement("div");
    entry.id = ENTRY;
    entry.className = "log-button";
    entry.dataset.dg = "roam-canvases";
    entry.setAttribute("role", "button");
    const icon = document.createElement("span");
    icon.className = "bp3-icon bp3-icon-layout-auto icon bp3-icon-small";
    entry.append(icon, "Canvases");
    entry.addEventListener("click", openPanel);
    after.after(entry);
  };

  const check = async (): Promise<void> => {
    placeEntry();
    const uid = await openPage();
    const id = uid ? (core()?.canvasOfRef({ ref: uid }) ?? null) : null;
    const holder = document.getElementById(HOLDER);
    if (holder?.isConnected && holder.dataset.canvas === id) return;
    removeHolder();
    if (!id) return;
    const title = document.querySelector(".roam-article .rm-title-display-container");
    if (!title) return;
    const next = document.createElement("div");
    next.id = HOLDER;
    next.dataset.canvas = id;
    next.append(mountCanvas(id));
    mounted = true;
    title.after(next);
    title.closest(".roam-article")?.classList.add("dg-canvas-on");
  };

  const style = document.createElement("style");
  style.id = STYLE;
  style.textContent = CSS;
  document.getElementById(STYLE)?.remove();
  document.head.append(style);

  const later = (): void => void check();
  window.addEventListener("hashchange", later);
  const timer = window.setInterval(later, WATCH_MS);
  void check();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("hashchange", later);
    removeHolder();
    style.remove();
    document.getElementById(ENTRY)?.remove();
  };
};

export const leaveCanvasPage = clearPage;
