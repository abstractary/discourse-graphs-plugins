import { useEffect, useState } from "react";
import type { ComputeServer } from "@dg/contract/services.ts";
import type { LabView } from "@dg/contract/surface.ts";
import type { Connection } from "./rpc.ts";

/** Joining or starting a lab, used on first run and from the Library. */
export const LabJoin = ({ connection, onChange }: { connection: Connection; onChange: (view: LabView) => void }) => {
  const { call } = connection;
  const [servers, setServers] = useState<ComputeServer[]>([]);
  const [server, setServer] = useState("");
  const [mode, setMode] = useState<"join" | "start">("join");
  const [text, setText] = useState("");
  const [found, setFound] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("server.list", {}).then((list) => {
      setServers(list);
      setServer((list.find(({ kind }) => kind === "managed") ?? list[0])?.url ?? "");
    });
  }, [call]);

  const report = (error: unknown): void => setNotice(error instanceof Error ? error.message : String(error));

  const look = async (): Promise<void> => {
    setNotice("");
    setFound("");
    try {
      setFound((await call("lab.find", { server, id: text.trim() })).name);
    } catch (error) {
      report(error);
    }
  };

  const go = async (): Promise<void> => {
    if (!text.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      onChange(
        mode === "join"
          ? await call("lab.requestJoin", { server, id: text.trim() })
          : await call("lab.register", { server, name: text.trim() }),
      );
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="segments" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "join"} data-dg="lab-mode-join" onClick={() => { setMode("join"); setText(""); setFound(""); }}>Join a lab</button>
        <button type="button" role="tab" aria-selected={mode === "start"} data-dg="lab-mode-start" onClick={() => { setMode("start"); setText(""); setFound(""); }}>Start a lab</button>
      </div>
      <label className="field">
        <span>{mode === "join" ? "Lab identifier" : "Lab name"}</span>
        <input
          data-dg="lab-text"
          value={text}
          placeholder={mode === "join" ? "Like tension-lab-4k2" : "Your lab's name"}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => mode === "join" && text.trim() && void look()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void go();
          }}
        />
      </label>
      {found ? <p className="note" data-dg="lab-found">Found {found}.</p> : null}
      {servers.length > 1 ? (
        <label className="field">
          <span>Server</span>
          <select data-dg="lab-server" value={server} onChange={(event) => setServer(event.target.value)}>
            {servers.map(({ id, name, url }) => <option key={id} value={url}>{name}</option>)}
          </select>
        </label>
      ) : null}
      <p className="note">
        {mode === "join"
          ? "Your lab's PI sees your request. Once accepted, you get AI and the lab's shared canvases."
          : "You become the lab's custodian, and you accept the people who ask to join."}
      </p>
      {notice ? <p className="problem" role="alert">{notice}</p> : null}
      <button type="button" className="primary" data-dg="lab-go" disabled={busy || !text.trim()} onClick={() => void go()}>
        {mode === "join" ? "Ask to join" : "Start the lab"}
      </button>
    </div>
  );
};
