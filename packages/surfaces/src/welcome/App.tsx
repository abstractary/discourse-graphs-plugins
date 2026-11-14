import { useEffect, useState } from "react";
import type { LabView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { LabJoin } from "../shared/LabJoin.tsx";
import { LoadProblem, useLoad } from "../shared/load.tsx";
import { Problem } from "../shared/ui.tsx";
import { sayOf } from "../shared/words.ts";

const CHECK_MS = 3000;

/** The first thing a person sees: join a lab, start one, or carry on alone. */
export const App = ({ connection }: { connection: Connection }) => {
  const { call } = connection;
  const [lab, setLab] = useState<LabView | null>(null);

  const [notice, setNotice] = useState("");
  const { failed, again } = useLoad(() => call("lab.get", {}).then(setLab), [call]);

  const pending = Boolean(lab?.link?.pending);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => void call("lab.check", {}).then(setLab).catch(() => {}), CHECK_MS); // Dropped: the next check, a few seconds on, asks again.
    return () => window.clearInterval(timer);
  }, [call, pending]);

  const close = (): void => void call("dialog.close", {}).catch((error: unknown) => setNotice(sayOf(error)));
  const problems = (
    <>
      <LoadProblem failed={failed} again={again} />
      <Problem text={notice} />
    </>
  );

  if (lab?.link?.token) {
    return (
      <main className="sheet" data-dg="welcome-joined">
        <h1>You're in {lab.link.name}</h1>
        <p>AI is on, and the lab's shared canvases are in your Library.</p>
        {problems}
        <div className="row end"><button type="button" className="primary" data-dg="welcome-done" onClick={close}>Done</button></div>
      </main>
    );
  }

  if (pending) {
    return (
      <main className="sheet" data-dg="welcome-pending">
        <h1>Waiting for {lab!.link!.name}</h1>
        <p>Your request is with the lab's PI. You can carry on working, and you'll be added as soon as they accept.</p>
        {problems}
        <div className="row end"><button type="button" data-dg="welcome-later" onClick={close}>Carry on</button></div>
      </main>
    );
  }

  return (
    <main className="sheet">
      <h1>Welcome to Discourse Graphs</h1>
      <p>Working with a lab? Enter its identifier to ask to join. You can also do this later from the Library.</p>
      <LabJoin connection={connection} onChange={setLab} />
      {problems}
      <div className="row end"><button type="button" data-dg="welcome-skip" onClick={close}>Work on my own</button></div>
    </main>
  );
};
