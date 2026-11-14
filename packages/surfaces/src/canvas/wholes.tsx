import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasWhole, WholeRef, Prefs } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";

/**
 * The canvas tab as a whole. A canvas tied to a whole shows where it sits
 * (lab / question / claim), and a card that is itself a whole opens into that
 * whole's own canvas in the same tab. Nothing here writes except tying a
 * canvas to a whole and making a whole's first canvas.
 */

export const WHOLE_LEVELS = new Set(["question", "claim", "evidence", "output"]);
export const isWhole = (base: string | undefined): base is WholeRef["level"] => Boolean(base && WHOLE_LEVELS.has(base));

export const useWholeCanvas = ({
  connection,
  current,
  switchTo,
  report,
  notify,
}: {
  connection: Connection;
  current: string | undefined;
  switchTo: (id: string) => void;
  report: (error: unknown) => void;
  notify: (message: string) => void;
}) => {
  const { call, on, route } = connection;
  const [info, setInfo] = useState<CanvasWhole | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ linkDelete: "ask", captureKey: "\\", notebookText: false, cardFields: ["source"], sidePinned: false, miniMap: true, zoteroLibrary: false });
  const [lit, setLit] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!current) return setInfo(null);
    setInfo(await call("overview.ofCanvas", { id: current }));
  }, [call, current]);
  useEffect(() => void load().catch(report), [load, report]);
  useEffect(() => on("graph-changed", () => void load().catch(report)), [on, load, report]);
  useEffect(() => void call("prefs.get", {}).then(setPrefs).catch(report), [call, report]);
  useEffect(() => on("prefs-changed", ({ prefs: next }) => setPrefs(next)), [on]);
  // A mark that only points something out lets go by itself.
  const release = useRef(0);
  useEffect(() => on("highlight", ({ units, brief }) => {
    window.clearTimeout(release.current);
    setLit(units);
    if (brief) release.current = window.setTimeout(() => setLit([]), 2200);
  }), [on]);
  useEffect(() => () => window.clearTimeout(release.current), []);
  // A highlight belongs to the canvas it was made on.
  useEffect(() => setLit([]), [current]);

  // Say which canvas is in front, so the boundary panel follows: on a switch,
  // when the tab is shown again (its frame grows from nothing), and on focus.
  const shownWidth = useRef(0);
  useEffect(() => {
    if (!current) return;
    const tell = () => void call("overview.focus.set", { canvas: current }).catch(() => undefined);
    tell();
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      if (width > 0 && shownWidth.current === 0) tell();
      shownWidth.current = width;
    });
    observer.observe(document.documentElement);
    window.addEventListener("focus", tell);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", tell);
    };
  }, [call, current]);

  const openInside = useCallback(
    async (ref: WholeRef) => {
      try {
        const { id, made } = await call("overview.canvas", { ref });
        if (id === current) return;
        // A canvas on its own page moves by going to the other page.
        if (route.pinned) await call("canvas.show", { id });
        else switchTo(id);
        if (made) notify("Made a canvas from its graph");
      } catch (error) {
        report(error);
      }
    },
    [call, current, route.pinned, switchTo, notify, report],
  );

  return { info, prefs, lit, setLit, openInside };
};

const LEVEL_WORD: Record<string, string> = { lab: "Lab", question: "Question", claim: "Claim", evidence: "Evidence", output: "Output" };

/** Where this canvas sits (its lab, and the question or claim it is about), and its boundary. */
export const WholeBar = ({
  connection,
  current,
  info,
  lit,
  onClearLit,
  onOpen,
  report,
}: {
  connection: Connection;
  current: string | undefined;
  info: CanvasWhole | null;
  lit: string[];
  onClearLit: () => void;
  onOpen: (ref: WholeRef) => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const [menu, setMenu] = useState<"whole" | "tie" | null>(null);
  if (!current || !info) return null;
  const tie = (whole: string | null) => {
    setMenu(null);
    void call("canvas.setWhole", { id: current, whole }).catch(report);
  };
  return (
    <div className="whole-bar" data-dg="whole-bar">
      <nav className="whole-path" aria-label="Where this canvas sits">
        {info.ref ? (
          info.path.map((step, i) => {
            const last = i === info.path.length - 1;
            return (
              <span key={step.ref.id} className="whole-step">
                {i > 0 ? <span className="whole-sep" aria-hidden="true">/</span> : null}
                {last ? (
                  <span aria-current="page" title={plain(step.title)}>
                    <span className="chip" data-base={step.ref.level}>{LEVEL_WORD[step.ref.level]}</span> <span className="whole-step-title">{plain(step.title)}</span>
                  </span>
                ) : (
                  <button type="button" className="whole-link" onClick={() => onOpen(step.ref)} title={`Go up to ${plain(step.title)}`} data-dg={`whole-up-${step.ref.level}`}>
                    {plain(step.title)}
                  </button>
                )}
              </span>
            );
          })
        ) : null}
      </nav>
      <span className="whole-end">
        {lit.length ? (
          <button type="button" className="whole-link" onClick={onClearLit}>Clear highlight ({lit.length})</button>
        ) : null}
        <button type="button" className="tool" aria-label="Boundary" title="Show what this canvas rests on and leaves open, in the side panel" onClick={() => void call("panel.open", { surface: "boundary" }).catch(report)} data-dg="open-boundary">
          <Icon name="context" />
          <span className="tool-label">Boundary</span>
        </button>
        <button type="button" className="tool caret" aria-label="Boundary options" title="Boundary options" aria-haspopup="menu" aria-expanded={menu === "whole"} onClick={() => setMenu(menu === "whole" ? null : "whole")} data-dg="whole-menu">
          <Icon name="chevron" />
        </button>
      </span>
      {menu === "tie" ? (
        <div className="popover whole-menu whole-tie" role="menu" aria-label="Make it the canvas of">
          <p>This canvas becomes the view of:</p>
          {info.candidates.length ? (
            info.candidates.map((c) => (
              <button key={c.ref.id} type="button" role="menuitem" onClick={() => tie(c.ref.id)} data-dg={`tie-${c.ref.level}`}>
                <span className="chip" data-base={c.ref.level}>{LEVEL_WORD[c.ref.level]}</span> {plain(c.title)}
              </button>
            ))
          ) : (
            <p>Put a question, claim or evidence on it first.</p>
          )}
        </div>
      ) : null}
      {menu === "whole" ? (
        <div className="popover whole-menu" role="menu" aria-label="Boundary options">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void call("panel.open", { surface: "boundary" }).catch(report); }}>Show the boundary panel</button>
          {info.ref ? null : (
            <button type="button" role="menuitem" onClick={() => setMenu("tie")} data-dg="whole-tie">Make this the canvas of a question or claim…</button>
          )}
          {info.ref ? (
            <button type="button" role="menuitem" onClick={() => tie(null)} data-dg="whole-untie">Stop being the canvas of this question or claim</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
