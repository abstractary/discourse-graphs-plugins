import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Undo and redo for what a person does on this canvas, in this tab. Each step
 * knows how to go back and forward again, because the canvas is shared: going
 * back writes the earlier state rather than rewinding anything. Switching
 * canvas starts a fresh history.
 */

export type Step = {
  label: string;
  undo: () => Promise<unknown>;
  redo: () => Promise<unknown>;
  /** A remembered choice made this happen, so the status offers to ask again. */
  remembered?: boolean;
  /**
   * The edit itself, still finishing, such as a rename that updates links across a vault.
   * The step is recorded as the edit starts, so undo can't skip past it; undo waits for this.
   */
  ready?: Promise<unknown>;
};

export type HistoryStatus = { label: string; canUndo: boolean; canRedo: boolean; remembered?: boolean };

const MOST = 100;
/** The status line clears after this; the keys still work. */
const SHOWN_MS = 10_000;

export const useHistory = (key: string | undefined, report: (error: unknown) => void) => {
  const done = useRef<Step[]>([]);
  const undone = useRef<Step[]>([]);
  /** Presses made while a step is still going are queued, never dropped. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  /** What's there to undo and redo, for buttons that stay in place. */
  const [next, setNext] = useState<{ undo: string | null; redo: string | null }>({ undo: null, redo: null });
  const sync = () =>
    setNext({ undo: done.current[done.current.length - 1]?.label ?? null, redo: undone.current[undone.current.length - 1]?.label ?? null });

  useEffect(() => {
    done.current = [];
    undone.current = [];
    setStatus(null);
    setNext({ undo: null, redo: null });
  }, [key]);

  useEffect(() => {
    if (!status) return undefined;
    const timer = window.setTimeout(() => setStatus(null), SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  /** Takes back a step whose edit failed, so undo never reverses something that didn't happen. */
  const drop = useCallback((step: Step) => {
    done.current = done.current.filter((entry) => entry !== step);
    undone.current = undone.current.filter((entry) => entry !== step);
    setStatus(null);
    sync();
  }, []);

  const record = useCallback((step: Step) => {
    done.current.push(step);
    if (done.current.length > MOST) done.current.shift();
    undone.current = [];
    setStatus({ label: step.label, canUndo: true, canRedo: false, ...(step.remembered ? { remembered: true } : {}) });
    sync();
  }, []);

  const move = useCallback(
    async (from: { current: Step[] }, to: { current: Step[] }, back: boolean) => {
      const step = from.current.pop();
      if (!step) return;
      try {
        if (step.ready) await step.ready;
        await (back ? step.undo() : step.redo());
        to.current.push(step);
        setStatus({ label: back ? `Undid: ${step.label}` : step.label, canUndo: done.current.length > 0, canRedo: undone.current.length > 0 });
        sync();
      } catch (error) {
        // It couldn't be done, perhaps because a teammate changed it meanwhile. It stays where it was.
        from.current.push(step);
        report(error);
      }
    },
    [report],
  );

  const undo = useCallback(() => (queue.current = queue.current.then(() => move(done, undone, true))), [move]);
  const redo = useCallback(() => (queue.current = queue.current.then(() => move(undone, done, false))), [move]);
  const dismiss = useCallback(() => setStatus(null), []);

  return { record, drop, undo, redo, status, dismiss, next };
};
