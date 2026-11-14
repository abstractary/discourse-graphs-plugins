import { useCallback, useState } from "react";
import type { PublishAccount, Published, PublishPreview } from "@dg/contract/surface.ts";
import { LoadProblem, useLoad } from "../shared/load.tsx";
import type { Connection } from "../shared/rpc.ts";
import { Problem, TwoStep } from "../shared/ui.tsx";
import { sayOf } from "../shared/words.ts";

/**
 * Publish: make a canvas's units public in the person's own repository on the AT Protocol network.
 * Three things are always on screen before anything goes: which account, exactly what would be
 * sent, and that it is public the moment it is sent. Nothing leaves without the last button.
 */

const WHY: Record<PublishPreview["leftOut"][number]["why"], string> = {
  "not-yours": "someone else wrote it",
  "local-only": "it stays on this device",
  "an-end-is-not-public": "one of the units it joins is not public",
};
const kindOf = (collection: string): string => collection.split(".").at(-1) ?? "";

export const App = ({ connection }: { connection: Connection }) => {
  const { call, route } = connection;
  const canvas = route.id;
  const [account, setAccount] = useState<PublishAccount | null>(null);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [published, setPublished] = useState<Published[]>([]);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");

  const read = useCallback(async () => {
    setAccount(await call("publish.account", {}));
    setPublished(await call("publish.list", {}));
    if (canvas) setPreview(await call("publish.preview", { canvas }));
  }, [call, canvas]);
  const { failed, again } = useLoad(read, [read]);

  const act = (work: () => Promise<string>): void => {
    setBusy(true);
    setProblem("");
    setSaid("");
    void work()
      .then(setSaid, (error: unknown) => setProblem(sayOf(error)))
      .then(read)
      .catch((error: unknown) => setProblem(sayOf(error)))
      .finally(() => setBusy(false));
  };
  const connect = (): void =>
    act(async () => {
      const next = await call("publish.connect", { handle, password });
      setPassword("");
      return `Connected to @${next.connected?.handle ?? handle}.`;
    });
  const send = (): void =>
    act(async () => {
      const sent = await call("publish.send", { canvas: canvas! });
      return sent.sent === 0 ? "Nothing had changed, so nothing was sent." : `${sent.sent} ${sent.sent === 1 ? "record is" : "records are"} public now.`;
    });

  const connected = account?.connected;
  const going = preview?.rows.filter((row) => row.state !== "same") ?? [];
  const onThisCanvas = new Set(preview?.rows.map((row) => row.id));

  return (
    <main className="sheet publish" data-dg="publish">
      <h1>Publish</h1>
      <LoadProblem failed={failed} again={again} />
      {problem ? <Problem text={problem} dg="publish-problem" /> : null}
      {said ? <p className="note" role="status" data-dg="publish-said">{said}</p> : null}

      <section className="publish-part" data-dg="publish-account">
        <h2>Account</h2>
        {account && !account.canConnect ? <p className="note">This base has nowhere to keep a sign-in, so it can't publish.</p> : null}
        {connected ? (
          <p className="publish-line">
            <span>@{connected.handle}</span>
            <span className="note">{connected.did}</span>
            <button type="button" className="publish-link" data-dg="publish-disconnect" disabled={busy} onClick={() => act(async () => (await call("publish.disconnect", {}), "Disconnected. What is public stays public."))}>Disconnect</button>
          </p>
        ) : account?.canConnect ? (
          <>
            <p className="note">Connect an AT Protocol account, such as a Bluesky one. Use an app password made in that account's settings, never its main password. The password is used once to sign in and is not kept.</p>
            <label className="field"><span>Handle</span><input data-dg="publish-handle" value={handle} placeholder="name.bsky.social" autoCapitalize="none" spellCheck={false} onChange={(event) => setHandle(event.target.value)} /></label>
            <label className="field"><span>App password</span><input data-dg="publish-password" type="password" value={password} autoComplete="off" onChange={(event) => setPassword(event.target.value)} /></label>
            <div className="row end"><button type="button" data-dg="publish-connect" disabled={busy || !handle.trim() || !password} onClick={connect}>Connect</button></div>
          </>
        ) : null}
      </section>

      {canvas && preview ? (
        <section className="publish-part" data-dg="publish-preview">
          <h2>What would be sent</h2>
          {preview.rows.length === 0 ? <p className="note">Nothing on this canvas is yours to publish.</p> : null}
          <ul className="publish-rows">
            {preview.rows.map((row) => (
              <li key={row.id} data-state={row.state} data-dg={`publish-row-${row.title}`}>
                <span className="publish-kind">{kindOf(row.collection)}</span>
                <span className="publish-title">{row.title}</span>
                <span className="note">{row.state === "new" ? "New" : row.state === "changed" ? "Changed" : "Already public"}</span>
              </li>
            ))}
          </ul>
          {preview.leftOut.length > 0 ? (
            <details className="publish-out" data-dg="publish-left-out">
              <summary>{preview.leftOut.length} left out</summary>
              <ul>{preview.leftOut.map((entry) => <li key={entry.id}>{entry.title}: {WHY[entry.why]}</li>)}</ul>
            </details>
          ) : null}
          {preview.fractions > 0 ? <p className="note">{preview.fractions} {preview.fractions === 1 ? "number with a fraction is" : "numbers with fractions are"} sent as text, since a repository holds whole numbers only.</p> : null}
          <p className="note" data-dg="publish-names">These go out under stand-in names ({account?.names}.*) until the public names are agreed. Each keeps its own id.</p>
          <p className="publish-warning" data-dg="publish-warning">Published records are public at once and anyone can copy them. Taking one back removes it from your repository, not from copies.</p>
          <div className="row end">
            <button type="button" data-dg="publish-close" onClick={() => void call("dialog.close", {}).catch((error: unknown) => setProblem(sayOf(error)))}>Close</button>
            {connected && going.length > 0 ? (
              <TwoStep label={`Publish ${going.length}…`} question={`Make ${going.length} ${going.length === 1 ? "record" : "records"} public as @${connected.handle}?`} yes="Publish" keep="Not now" dg="publish-send" disabled={busy} onYes={send} />
            ) : null}
          </div>
        </section>
      ) : null}

      {published.length > 0 ? (
        <section className="publish-part" data-dg="publish-list">
          <h2>Public from this device</h2>
          <ul className="publish-rows">
            {published.map((entry) => (
              <li key={entry.id} data-here={onThisCanvas.has(entry.id) ? "" : undefined}>
                <span className="publish-title">{entry.title}</span>
                <span className="note" title={entry.uri}>{new Date(entry.at).toLocaleDateString()}</span>
                <TwoStep label="Take back…" question="Remove it from your repository?" yes="Take back" dg={`publish-withdraw-${entry.title}`} buttonClass="publish-link" disabled={busy || !connected} onYes={() => act(async () => (await call("publish.withdraw", { ids: [entry.id] }), "Taken back."))} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
};
