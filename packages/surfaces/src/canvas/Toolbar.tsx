import { useRef, type RefObject } from "react";
import type { Fit } from "../shared/fit.ts";
import { MOD } from "../shared/keys.ts";
import { Icon, type IconName } from "../shared/ui.tsx";
import type { HistoryStatus } from "./history.ts";
import { useBarKeys } from "./useBarKeys.ts";

const MOD_KEY = MOD === "Ctrl" ? "Ctrl+" : MOD;
const FIXED_WHY = "A PDF canvas holds only what comes from its paper. Build on it to add your own.";

/** What the bar shows. All of it is the canvas's own state, read here and changed only through `ToolbarActions`. */
export type ToolbarState = {
  /** How much fits, measured on the bar itself. */
  fit: Fit;
  /** The canvas's name, on the button that opens the canvas menu. */
  title: string;
  sideOpen: boolean;
  menuOpen: boolean;
  /** A PDF canvas, which takes units only from its paper. */
  reading: boolean;
  adding: boolean;
  drawing: boolean;
  modeLabel: string;
  tidyOpen: boolean;
  fieldsOpen: boolean;
  aiOn: boolean;
  moreOpen: boolean;
  notice: string;
  /** How many cards cover another after cards grew to show more. */
  crowded: number;
  done: HistoryStatus | null;
  next: { undo: string | null; redo: string | null };
  /** The PDF most of this canvas's cards came from. */
  parentPdf: { name: string } | undefined;
};

export type ToolbarActions = {
  toggleSide: () => void;
  toggleCanvasMenu: () => void;
  openAdd: () => void;
  closeAdd: () => void;
  addNote: () => void;
  toggleDraw: () => void;
  tidy: () => void;
  openTidyMenu: () => void;
  openFieldsMenu: () => void;
  tidyAfterFields: () => void;
  askLinksAgain: () => void;
  undo: () => void;
  redo: () => void;
  toggleAi: () => void;
  toggleMore: () => void;
  closeMore: () => void;
  openSearch: () => void;
  openContext: () => void;
  openPdf: () => void;
};

/** The buttons the canvas measures from or places a menu under. */
export type ToolbarRefs = {
  bar: RefObject<HTMLElement | null>;
  add: RefObject<HTMLButtonElement | null>;
  tidy: RefObject<HTMLButtonElement | null>;
  fields: RefObject<HTMLButtonElement | null>;
};

/** The canvas's bar, and the More menu its least-used tools fold into when the bar is narrow. */
export const Toolbar = ({ state, actions, refs }: { state: ToolbarState; actions: ToolbarActions; refs: ToolbarRefs }) => {
  const { fit, title, sideOpen, menuOpen, reading, adding, drawing, modeLabel, tidyOpen, fieldsOpen, aiOn, moreOpen, notice, crowded, done, next, parentPdf } = state;
  const { addNote, openPdf } = actions;
  const barKeys = useBarKeys(refs.bar);
  const moreButton = useRef<HTMLButtonElement>(null);
  /** The panels that work beside a canvas, opened from its bar. */
  // Panels open beside the canvas. Context keeps its word longest, since no icon says "context".
  const panelButtons: { dg: string; label: string; title: string; icon: IconName; keep?: boolean; open: () => void }[] = [
    { dg: "open-search", label: "Search units", title: "Search units, in the sidebar", icon: "search", open: actions.openSearch },
    { dg: "open-context", label: "Context", title: "Open the context panel", icon: "context", keep: true, open: actions.openContext },
    { dg: "open-pdf", label: "PDF", title: parentPdf ? `Read ${parentPdf.name}, the PDF most of these cards came from. Its title there lists the others` : "Read a PDF beside the canvas", icon: "pdf", open: openPdf },
  ];
  return (
    <>
      <header className="bar" ref={refs.bar} data-fit={fit} role="toolbar" aria-label="Canvas" onKeyDown={barKeys.onKeyDown} onFocus={barKeys.onFocus}>
        <button type="button" className="tool side-toggle" data-dg="side-toggle" aria-label="Library, search units and units to place" aria-expanded={sideOpen} title="Library, search units and units to place" onClick={actions.toggleSide}>
          <Icon name="sidebar" />
        </button>
        <div className="picker" data-fit-min="96">
          <button
            type="button"
            className="canvas-button"
            data-dg="canvas-menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={`${title}: canvases, export and more`}
            onClick={actions.toggleCanvasMenu}
          >
            <span>{title}</span>
            <Icon name="chevron" />
          </button>
        </div>
        <div className="tool-group create" role="group" aria-label="Add">
          <button
            ref={refs.add}
            type="button"
            className="tool"
            data-dg="add-node"
            aria-label={reading ? "Highlight in the PDF" : "Add unit"}
            title={reading ? "Add a unit by highlighting it in this paper's PDF" : "Add unit · N"}
            aria-expanded={reading ? undefined : adding}
            onClick={() => (reading ? openPdf() : adding ? actions.closeAdd() : actions.openAdd())}
          >
            <Icon name={reading ? "pdf" : "plus"} />
            <span className="tool-label">{reading ? "Highlight" : "Add unit"}</span>
          </button>
          {fit !== "more" ? (
            <>
              <button type="button" className="tool" data-dg="add-note" aria-label="Add sticky" disabled={reading} title={reading ? FIXED_WHY : "Add a sticky · T"} onClick={() => addNote()}>
                <Icon name="note" />
                <span className="tool-label">Sticky</span>
              </button>
              <button
                type="button"
                className="tool"
                data-dg="draw"
                aria-label="Draw"
                disabled={reading}
                title={reading ? FIXED_WHY : "Draw · D"}
                aria-pressed={drawing}
                onClick={actions.toggleDraw}
              >
                <Icon name="pen" />
                <span className="tool-label">Draw</span>
              </button>
            </>
          ) : null}
        </div>
        <div className="tool-group split" role="group" aria-label="Tidy">
          <button
            type="button"
            className="tool keep"
            data-dg="tidy"
            aria-label={`Tidy by ${modeLabel}`}
            title={`Tidy by ${modeLabel} · L`}
            onClick={actions.tidy}
          >
            <Icon name="tidy" />
            <span className="tool-label">
              Tidy <span className="tool-mode">{modeLabel}</span>
            </span>
          </button>
          <button
            ref={refs.tidy}
            type="button"
            className="tool caret"
            data-dg="tidy-menu"
            aria-label="Choose how to tidy"
            title="Choose how to tidy"
            aria-haspopup="menu"
            aria-expanded={tidyOpen}
            onClick={actions.openTidyMenu}
          >
            <Icon name="chevron" />
          </button>
        </div>
        <div className="tool-group" role="group" aria-label="Cards">
          <button
            ref={refs.fields}
            type="button"
            className="tool"
            data-dg="card-fields"
            aria-label="What cards show"
            title="Choose what every card shows"
            aria-haspopup="menu"
            aria-expanded={fieldsOpen}
            onClick={actions.openFieldsMenu}
          >
            <Icon name="card" />
            <span className="tool-label">Cards</span>
            <Icon name="chevron" />
          </button>
        </div>
        <div className="status" role="status" data-fit-min="0">
          <span data-dg="status-text">{notice || (crowded ? `${crowded} ${crowded === 1 ? "card now covers" : "cards now cover"} another` : "") || done?.label || ""}</span>
          {!notice && crowded ? (
            <button type="button" className="status-link" data-dg="tidy-after-fields" title={`Tidy by ${modeLabel} to make room`} onClick={actions.tidyAfterFields}>
              Tidy
            </button>
          ) : null}
          {!notice && !crowded && done?.remembered ? (
            <button
              type="button"
              className="status-link"
              data-dg="link-delete-ask-again"
              title="Ask again each time a link is deleted"
              onClick={actions.askLinksAgain}
            >
              Ask next time
            </button>
          ) : null}
        </div>
        <div className="tool-group history" role="group" aria-label="History">
          <button
            type="button"
            className="tool icon-only"
            data-dg="undo"
            aria-label={next.undo ? `Undo: ${next.undo}` : "Nothing to undo"}
            title={next.undo ? `Undo: ${next.undo} · ${MOD_KEY}Z` : "Nothing to undo"}
            disabled={!next.undo}
            onClick={actions.undo}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="tool icon-only"
            data-dg="redo"
            aria-label={next.redo ? `Redo: ${next.redo}` : "Nothing to redo"}
            title={next.redo ? `Redo: ${next.redo} · ${MOD_KEY}⇧Z` : "Nothing to redo"}
            disabled={!next.redo}
            onClick={actions.redo}
          >
            <Icon name="redo" />
          </button>
        </div>
        <div className="tool-group panels" role="group" aria-label="Panels">
          {fit !== "more" ? (
            <button
              type="button"
              className="tool keep"
              data-dg="ai"
              aria-label="Ask AI"
              title="Ask about this canvas"
              aria-pressed={aiOn}
              onClick={actions.toggleAi}
            >
              <Icon name="ai" />
              <span className="tool-label">Ask AI</span>
            </button>
          ) : null}
          {panelButtons
            .filter((panel) => fit !== "more" || panel.dg !== "open-pdf")
            .map((panel) => (
              <button key={panel.dg} type="button" className={panel.keep ? "tool keep" : "tool"} data-dg={panel.dg} aria-label={panel.label} title={panel.title} onClick={panel.open}>
                <Icon name={panel.icon} />
                <span className="tool-label">{panel.label}</span>
              </button>
            ))}
          {fit === "more" ? (
            <button
              ref={moreButton}
              type="button"
              className="tool icon-only"
              data-dg="toolbar-more"
              aria-label="More tools"
              title="Note, Draw, Ask AI and PDF"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={actions.toggleMore}
            >
              <Icon name="more" />
            </button>
          ) : null}
        </div>
      </header>
      {moreOpen && fit === "more" ? (
        <div className="popover menu more-menu" role="menu" aria-label="More tools">
          <button type="button" role="menuitem" data-dg="add-note" onClick={() => { actions.closeMore(); addNote(); }}>
            <Icon name="note" /> Note <kbd>T</kbd>
          </button>
          <button type="button" role="menuitem" data-dg="draw" onClick={() => { actions.closeMore(); actions.toggleDraw(); }}>
            <Icon name="pen" /> Draw <kbd>D</kbd>
          </button>
          <hr />
          <button type="button" role="menuitem" data-dg="ai" onClick={() => { actions.closeMore(); actions.toggleAi(); }}>
            <Icon name="ai" /> Ask AI
          </button>
          <button type="button" role="menuitem" data-dg="open-pdf" onClick={() => { actions.closeMore(); openPdf(); }}>
            <Icon name="pdf" /> {parentPdf ? "Read its PDF" : "Read a PDF"}
          </button>
        </div>
      ) : null}
    </>
  );
};
