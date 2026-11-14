import { useCallback, useEffect, useState } from "react";
import type { WholeRef, WholeView, Stance } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain, Problem } from "../shared/ui.tsx";
import { BaseChip, Boundary, Flag, LEVEL_WORD, PartRow, StanceSwitch } from "../shared/overview-parts.tsx";
import { LoadProblem, useLoad } from "../shared/load.tsx";
import { goneOf, sayOf } from "../shared/words.ts";

/**
 * The boundary of whichever whole is in focus, beside the context panel: the
 * open canvas's whole, or the whole of the note being read. A unit picked here
 * moves the context panel to it and lights it on the canvas; a whole opened
 * here opens its canvas.
 */
export const App = ({ connection, onShowCanvas }: { connection: Connection; onShowCanvas?: (id: string) => void }) => {
  const { call, on } = connection;
  const [focus, setFocus] = useState<{ ref: WholeRef | null; canvas: string | null } | null>(null);
  const [stance, setStance] = useState<Stance>("lab");
  const [view, setView] = useState<WholeView | null>(null);
  const [lit, setLit] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");

  const report = useCallback((error: unknown) => setNotice(sayOf(error)), []);
  const focused = useLoad(() => call("overview.focus.get", {}).then(setFocus), [call]);
  useEffect(() => on("overview-focus-changed", ({ ref, canvas }) => setFocus({ ref, canvas })), [on]);
  useEffect(() => on("graph-changed", () => setVersion((v) => v + 1)), [on]);
  useEffect(() => on("highlight", ({ units }) => setLit(units)), [on]);
  // The selected question, claim or evidence is what the panel is about. With none selected, it is the canvas's own.
  const [picked, setPicked] = useState<WholeRef | null>(null);
  const follow = useCallback(
    (node: string | null) => {
      if (!node) return setPicked(null);
      void call("overview.locate", { id: node }).then((ref) => setPicked(ref && ref.level !== "lab" ? ref : null)).catch(() => setPicked(null)); // Dropped: a selection that can't be placed leaves the panel on the canvas's own subject.
    },
    [call],
  );
  useEffect(() => void call("focus.get", {}).then(follow).catch(() => undefined), [call, follow]); // Dropped: with no selection known, the panel is about the canvas, and the next selection is heard as an event.
  useEffect(() => on("focus-changed", ({ node }) => follow(node)), [on, follow]);
  const subject = picked ?? focus?.ref ?? null;
  const opened = useLoad(async () => {
    if (!subject) return setView(null);
    try {
      setView(await call("overview.get", { ref: subject, stance }));
    } catch (error) {
      // What was shown is about something else by now, so it goes rather than sit under the problem.
      setView(null);
      throw error;
    }
  }, [call, subject?.id, subject?.level, stance, version]);

  const pick = useCallback(
    (unit: string) => {
      void call("focus.set", { id: unit }).catch(report);
      void call("canvas.highlight", { units: [unit] }).catch(() => undefined); // Dropped: lighting the card is a courtesy, and there may be no canvas open to light.
    },
    [call, report],
  );
  // Dropped: lighting cards is a courtesy, and there may be no canvas open to light.
  const light = useCallback((units: string[]) => void call("canvas.highlight", { units }).catch(() => undefined), [call]);
  const open = useCallback(
    async (ref: WholeRef) => {
      try {
        const { id } = await call("overview.canvas", { ref });
        if (onShowCanvas) onShowCanvas(id);
        else await call("canvas.show", { id });
      } catch (error) {
        report(error);
      }
    },
    [call, onShowCanvas, report],
  );

  const failed = focused.failed ?? opened.failed;
  if (failed !== undefined) {
    return (
      <main className="bd bd-empty">
        <LoadProblem failed={failed} again={focused.failed !== undefined ? focused.again : opened.again} gone={goneOf()} />
      </main>
    );
  }
  if (!subject || !view) {
    return (
      <main className="bd bd-empty">
        <p className="hv-muted">
          {focus?.canvas
            ? "Select a question, a claim or a piece of evidence, and what it rests on and leaves open shows here."
            : "Open a canvas and select a question, a claim or a piece of evidence. What it rests on and leaves open shows here."}
        </p>
      </main>
    );
  }

  return (
    <main className="bd" data-dg="boundary-panel">
      <header className="bd-head">
        <nav className="hv-path" aria-label="Where it sits">
          {view.path.slice(0, -1).map((p, i) => (
            <span key={p.ref.id}>
              {i > 0 ? <span className="hv-sep" aria-hidden="true">/</span> : null}
              <button type="button" className="hv-link" onClick={() => void open(p.ref)} title={plain(p.title)}>{plain(p.title)}</button>
            </span>
          ))}
        </nav>
        <p className="bd-about" data-dg="boundary-about">{picked ? "The selected unit" : "This canvas is about"}</p>
        <div className="hv-title-row">
          <BaseChip base={view.base} label={view.label ?? LEVEL_WORD[view.base]} />
          <h1 className="bd-title" data-dg="boundary-title">{plain(view.title)}</h1>
        </div>
        {view.flags.length ? <div className="hv-flags">{view.flags.map((f) => <Flag key={f} name={f} />)}</div> : null}
        <div className="bd-row">
          <StanceSwitch stance={stance} onChange={setStance} />
          {lit.length ? (
            <button type="button" className="hv-link" onClick={() => light([])}>Clear highlight</button>
          ) : null}
        </div>
        <Problem text={notice} />
      </header>
      <Boundary
        key={view.ref.id}
        view={view}
        onPick={pick}
        onLight={light}
        onOpen={(ref) => void open(ref)}
        parts={
          view.parts.length || view.behind.length ? (
            <>
              <ul className="bd-parts">{view.parts.map((p) => <PartRow key={p.id} part={p} lit={lit.includes(p.id)} onPick={pick} onOpen={(ref) => void open(ref)} compact />)}</ul>
              {view.behind.length ? (
                <>
                  <h3>What stands behind it</h3>
                  <ul className="bd-parts">{view.behind.map((p) => <PartRow key={p.id} part={p} lit={lit.includes(p.id)} onPick={pick} onOpen={(ref) => void open(ref)} compact />)}</ul>
                </>
              ) : null}
            </>
          ) : (
            <p className="hv-muted">Holds nothing yet.</p>
          )
        }
      />
      {focus?.canvas && !picked ? null : (
        <p className="bd-foot">
          <button type="button" className="hv-link" onClick={() => void open(view.ref)} data-dg="boundary-open-canvas">
            <Icon name="canvas" /> Open its canvas
          </button>
        </p>
      )}
    </main>
  );
};
