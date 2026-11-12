import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasHolon, HolonGesture, HolonRef, Prefs } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";

/**
 * The canvas tab as a holon. A canvas tied to a holon shows where it sits
 * (lab / question / claim), and a card that is itself a holon opens into that
 * holon's own canvas in the same tab. Nothing here writes except tying a
 * canvas to a holon and making a holon's first canvas.
 */

export const HOLON_LEVELS = new Set(["question", "claim", "evidence", "output"]);
export const isHolon = (base: string | undefined): base is HolonRef["level"] => Boolean(base && HOLON_LEVELS.has(base));

export const GESTURES: { value: HolonGesture; label: string; hint: string }[] = [
  { value: "button", label: "Open-inside button", hint: "Each holon card has a button that opens it. Double-click opens the card's text, as everywhere else." },
  { value: "doubleClick", label: "Double-click", hint: "Double-click a holon card to open it. The card's open button still opens its text." },
  { value: "semantic", label: "Zooming in", hint: "Zoom far into a holon card to open it, and far out to go up a level." },
];

export const useHolonCanvas = ({
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
  const [info, setInfo] = useState<CanvasHolon | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ holonGesture: "button", linkDelete: "ask", captureKey: "\\", notebookText: false });
  const [lit, setLit] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!current) return setInfo(null);
    setInfo(await call("holon.ofCanvas", { id: current }));
  }, [call, current]);
  useEffect(() => void load().catch(report), [load, report]);
  useEffect(() => on("graph-changed", () => void load().catch(report)), [on, load, report]);
  useEffect(() => void call("prefs.get", {}).then(setPrefs).catch(report), [call, report]);
  useEffect(() => on("prefs-changed", ({ prefs: next }) => setPrefs(next)), [on]);
  useEffect(() => on("highlight", ({ units }) => setLit(units)), [on]);
  // A highlight belongs to the canvas it was made on.
  useEffect(() => setLit([]), [current]);

  // Say which canvas is in front, so the boundary panel follows: on a switch,
  // when the tab is shown again (its frame grows from nothing), and on focus.
  const shownWidth = useRef(0);
  useEffect(() => {
    if (!current) return;
    const tell = () => void call("holon.focus.set", { canvas: current }).catch(() => undefined);
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
    async (ref: HolonRef) => {
      try {
        const { id, made } = await call("holon.canvas", { ref });
        if (id === current) return;
        // A canvas on its own page moves by going to the other page.
        if (route.pinned) await call("canvas.show", { id });
        else switchTo(id);
        if (made) notify("Made this holon's canvas from its graph");
      } catch (error) {
        report(error);
      }
    },
    [call, current, route.pinned, switchTo, notify, report],
  );

  return { info, prefs, lit, setLit, openInside, setGesture: (holonGesture: HolonGesture) => void call("prefs.set", { holonGesture }).catch(report) };
};

const LEVEL_WORD: Record<string, string> = { lab: "Lab", question: "Question", claim: "Claim", evidence: "Evidence", output: "Output" };

/** The breadcrumb up the holarchy, and the Holon menu. */
export const HolonBar = ({
  connection,
  current,
  info,
  prefs,
  lit,
  onClearLit,
  onOpen,
  setGesture,
  report,
}: {
  connection: Connection;
  current: string | undefined;
  info: CanvasHolon | null;
  prefs: Prefs;
  lit: string[];
  onClearLit: () => void;
  onOpen: (ref: HolonRef) => void;
  setGesture: (gesture: HolonGesture) => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const [menu, setMenu] = useState<"holon" | "tie" | null>(null);
  if (!current || !info) return null;
  const tie = (holon: string | null) => {
    setMenu(null);
    void call("canvas.setHolon", { id: current, holon }).catch(report);
  };
  return (
    <div className="holon-bar" data-dg="holon-bar">
      <nav className="holon-path" aria-label="Holarchy">
        {info.ref ? (
          info.path.map((step, i) => {
            const last = i === info.path.length - 1;
            return (
              <span key={step.ref.id} className="holon-step">
                {i > 0 ? <span className="holon-sep" aria-hidden="true">/</span> : null}
                {last ? (
                  <span aria-current="page" title={plain(step.title)}>
                    <span className="chip" data-base={step.ref.level}>{LEVEL_WORD[step.ref.level]}</span> <span className="holon-step-title">{plain(step.title)}</span>
                  </span>
                ) : (
                  <button type="button" className="holon-link" onClick={() => onOpen(step.ref)} title={`Go up to ${plain(step.title)}`} data-dg={`holon-up-${step.ref.level}`}>
                    {plain(step.title)}
                  </button>
                )}
              </span>
            );
          })
        ) : null}
      </nav>
      <span className="holon-end">
        {lit.length ? (
          <button type="button" className="holon-link" onClick={onClearLit}>Clear highlight ({lit.length})</button>
        ) : null}
        <button type="button" className="tool" aria-label="Boundary" title="Show this holon's boundary in the side panel" onClick={() => void call("panel.open", { surface: "boundary" }).catch(report)} data-dg="open-boundary">
          <Icon name="context" />
          <span className="tool-label">Boundary</span>
        </button>
        <button type="button" className="tool caret" aria-label="Holon options" title="Holon options" aria-haspopup="menu" aria-expanded={menu === "holon"} onClick={() => setMenu(menu === "holon" ? null : "holon")} data-dg="holon-menu">
          <Icon name="chevron" />
        </button>
      </span>
      {menu === "tie" ? (
        <div className="popover holon-menu holon-tie" role="menu" aria-label="Make it the canvas of">
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
      {menu === "holon" ? (
        <div className="popover holon-menu" role="menu" aria-label="Holon options">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void call("panel.open", { surface: "boundary" }).catch(report); }}>Show the boundary panel</button>
          {info.ref ? null : (
            <button type="button" role="menuitem" onClick={() => setMenu("tie")} data-dg="holon-tie">Make this the canvas of a question or claim…</button>
          )}
          {info.ref ? (
            <button type="button" role="menuitem" onClick={() => tie(null)} data-dg="holon-untie">Stop being this holon's canvas</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
