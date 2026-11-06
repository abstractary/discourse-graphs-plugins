import { useEffect, useState } from "react";
import type { LabView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { LabJoin } from "../shared/LabJoin.tsx";

const CHECK_MS = 3000;

/** The first thing a person sees: join a lab, start one, or carry on alone. */
export const App = ({ connection }: { connection: Connection }) => {
  const { call } = connection;
  const [lab, setLab] = useState<LabView | null>(null);

  useEffect(() => {
    void call("lab.view", {}).then(setLab);
  }, [call]);

  const pending = Boolean(lab?.link?.pending);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = window.setInterval(() => void call("lab.check", {}).then(setLab).catch(() => {}), CHECK_MS);
    return () => window.clearInterval(timer);
  }, [call, pending]);

  const close = (): void => void call("dialog.close", {});

  if (lab?.link?.token) {
    return (
      <main className="sheet" data-dg="welcome-joined">
        <h1>You're in {lab.link.name}</h1>
        <p>AI is on, and the lab's shared canvases are in your Library.</p>
        <div className="row end"><button type="button" className="primary" data-dg="welcome-done" onClick={close}>Done</button></div>
      </main>
    );
  }

  if (pending) {
    return (
      <main className="sheet" data-dg="welcome-pending">
        <h1>Waiting for {lab!.link!.name}</h1>
        <p>Your request is with the lab's PI. You can carry on working, and you'll be added as soon as they accept.</p>
        <div className="row end"><button type="button" data-dg="welcome-later" onClick={close}>Carry on</button></div>
      </main>
    );
  }

  return (
    <main className="sheet">
      <h1>Welcome to Discourse Graphs</h1>
      <p>Working with a lab? Enter its identifier to ask to join. You can also do this later from the Library.</p>
      <LabJoin connection={connection} onChange={setLab} />
      <div className="row end"><button type="button" data-dg="welcome-skip" onClick={close}>Work on my own</button></div>
    </main>
  );
};
