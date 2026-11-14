import { useCallback, useEffect, useState, type DependencyList } from "react";
import { TRY_AGAIN, codeOf, sayOf } from "./words.ts";

/**
 * A panel's first read. `load` asks and keeps what came back, as the panel's own effect did; this
 * holds on to a failure, so the panel can say so with `LoadProblem` where it would have stayed blank.
 * `again` asks once more, and is also what an event that means "read it again" should call.
 */
export const useLoad = (load: () => Promise<unknown>, deps: DependencyList): { failed: unknown; again: () => void } => {
  const [failed, setFailed] = useState<unknown>(undefined);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      () => live && setFailed(undefined),
      (error: unknown) => live && setFailed(error ?? new Error("Failed")),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, turn]);
  const again = useCallback(() => setTurn((n) => n + 1), []);
  return { failed, again };
};

/**
 * What a failed read says, with a way to ask again. A panel that shows one thing passes `gone`,
 * which is said alone when the core answers that the thing isn't there: asking again won't bring it back.
 * Nothing is drawn while nothing has failed.
 */
export const LoadProblem = ({ failed, again, gone, className = "problem", dg = "load-problem" }: { failed: unknown; again: () => void; gone?: string | undefined; className?: string | undefined; dg?: string | undefined }) => {
  if (failed === undefined) return null;
  const isGone = Boolean(gone) && codeOf(failed) === "not-found";
  return (
    <p className={className} role="alert" data-dg={dg} data-code={codeOf(failed)}>
      {isGone ? gone : sayOf(failed)}
      {isGone ? null : <>{" "}<button type="button" className="load-again" data-dg="load-again" onClick={again}>{TRY_AGAIN}</button></>}
    </p>
  );
};

/**
 * How a part of a panel hands a failure to the one place the panel says problems. A read the part
 * can't draw without passes itself as `again`, and `Problem` then offers to try it once more.
 */
export type Report = (error: unknown, again?: () => void) => void;
