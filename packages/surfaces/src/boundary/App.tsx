import { useCallback, useEffect, useState } from "react";
import type { HolonRef, HolonView, Stance } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";
import { BaseChip, Boundary, Flag, LEVEL_WORD, PartRow, StanceSwitch } from "../holon/parts.tsx";

/**
 * The boundary of whichever holon is in focus, beside the context panel: the
 * open canvas's holon, or the holon of the note being read. A unit picked here
 * moves the context panel to it and lights it on the canvas; a holon opened
 * here opens its canvas.
 */
export const App = ({ connection, onShowCanvas }: { connection: Connection; onShowCanvas?: (id: string) => void }) => {
  const { call, on } = connection;
  const [focus, setFocus] = useState<{ ref: HolonRef | null; canvas: string | null } | null>(null);
  const [stance, setStance] = useState<Stance>("lab");
  const [view, setView] = useState<HolonView | null>(null);
  const [lit, setLit] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState("");

  useEffect(() => void call("holon.focus.get", {}).then(setFocus), [call]);
  useEffect(() => on("holon-focus-changed", ({ ref, canvas }) => setFocus({ ref, canvas })), [on]);
  useEffect(() => on("graph-changed", () => setVersion((v) => v + 1)), [on]);
  useEffect(() => on("highlight", ({ units }) => setLit(units)), [on]);
  useEffect(() => {
    if (!focus?.ref) return setView(null);
    void call("holon.view", { ref: focus.ref, stance }).then(setView).catch((e: Error) => setNotice(e.message));
  }, [call, focus?.ref?.id, focus?.ref?.level, stance, version]);

  const pick = useCallback(
    (unit: string) => {
      void call("focus.set", { node: unit }).catch(() => undefined);
      void call("canvas.highlight", { units: [unit] }).catch(() => undefined);
    },
    [call],
  );
  const light = useCallback((units: string[]) => void call("canvas.highlight", { units }).catch(() => undefined), [call]);
  const open = useCallback(
    async (ref: HolonRef) => {
      try {
        const { id } = await call("holon.canvas", { ref });
        if (onShowCanvas) onShowCanvas(id);
        else await call("canvas.show", { id });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [call, onShowCanvas],
  );

  if (!focus?.ref || !view) {
    return (
      <main className="bd bd-empty">
        <p className="hv-muted">
          {focus?.canvas
            ? "This canvas isn't tied to a question or claim yet. Use the Boundary menu above the canvas to tie it to one."
            : "Open a canvas that is about a question or claim, or a note of a question, claim or evidence, and its boundary shows here."}
        </p>
      </main>
    );
  }

  return (
    <main className="bd" data-dg="boundary-panel">
      <header className="bd-head">
        <nav className="hv-path" aria-label="Holarchy">
          {view.path.slice(0, -1).map((p, i) => (
            <span key={p.ref.id}>
              {i > 0 ? <span className="hv-sep" aria-hidden="true">/</span> : null}
              <button type="button" className="hv-link" onClick={() => void open(p.ref)} title={plain(p.title)}>{plain(p.title)}</button>
            </span>
          ))}
        </nav>
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
        {notice ? <p className="problem" role="alert">{notice}</p> : null}
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
      {focus.canvas ? null : (
        <p className="bd-foot">
          <button type="button" className="hv-link" onClick={() => void open(view.ref)} data-dg="boundary-open-canvas">
            <Icon name="canvas" /> Open its canvas
          </button>
        </p>
      )}
    </main>
  );
};
