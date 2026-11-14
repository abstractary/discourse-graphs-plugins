import { useCallback, useEffect, useRef, useState } from "react";
import type { ComputeServer, ServerOption } from "@dg/contract/services.ts";
import type { LabView, SavedExtraction } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";
import { sizeOf } from "../shared/words.ts";

const ACCEPTED = ".pdf,.doc,.docx,.md,.txt,.json,.jsonld";
const isSaved = (name: string): boolean => /\.(json|jsonld)$/i.test(name);
const stemOf = (name: string): string => name.replace(/(\.graph\.json|\.mira\.jsonld|\.[^.]+)$/i, "");

/** `ref` is set for a file the base already holds, which is read there and never passes through this panel. */
type Picked = { name: string; mediaType: string; dataBase64: string; size: number; ref?: string };
type SavedPick = SavedExtraction & { text?: string };

const readText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });

const readFile = (file: File): Promise<Picked> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const dataBase64 = String(reader.result).split(",")[1] ?? "";
      resolve({ name: file.name, mediaType: file.type || "application/octet-stream", dataBase64, size: file.size });
    };
    reader.readAsDataURL(file);
  });


const KIND_LABELS: Record<string, string> = { local: "On your network", managed: "Discourse Graphs", custom: "Your own cloud" };

const AddServer = ({ connection, onDone, onCancel }: { connection: Connection; onDone: (server: ComputeServer) => void; onCancel: () => void }) => {
  const { call } = connection;
  const [name, setName] = useState("");
  const [url, setUrl] = useState("http://");
  const [kind, setKind] = useState<"local" | "custom">("local");
  const [result, setResult] = useState("");
  const [problem, setProblem] = useState("");

  const test = async (): Promise<boolean> => {
    setProblem("");
    setResult("");
    try {
      const info = await call("server.check", { url });
      setResult(`Connected to ${info.name}.`);
      if (!name) setName(info.name);
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const save = async (): Promise<void> => {
    if (await test()) onDone(await call("server.add", { name: name || url, url, kind }));
  };

  return (
    <div className="stack" data-dg="add-server">
      <h2>Add a compute server</h2>
      <label className="field">
        <span>Where it runs</span>
        <select data-dg="server-kind" value={kind} onChange={(event) => setKind(event.target.value as "local" | "custom")}>
          <option value="local">On your network</option>
          <option value="custom">In the cloud</option>
        </select>
      </label>
      <label className="field">
        <span>Address</span>
        <input data-dg="server-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://192.168.1.20:8787" />
      </label>
      <label className="field">
        <span>Name</span>
        <input data-dg="server-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Lab workstation" />
      </label>
      {result ? <p className="note" data-dg="server-result">{result}</p> : null}
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="row end">
        <button type="button" onClick={onCancel}>Back</button>
        <button type="button" data-dg="server-test" onClick={() => void test()}>Test</button>
        <button type="button" className="primary" data-dg="server-save" onClick={() => void save()}>Add server</button>
      </div>
    </div>
  );
};

/** Choosing a paper, where it runs, what reads it, and which schema it's read into. */
export const App = ({ connection }: { connection: Connection }) => {
  const { call, on } = connection;
  const [servers, setServers] = useState<ComputeServer[]>([]);
  const [server, setServer] = useState("");
  const [models, setModels] = useState<ServerOption[]>([]);
  const [schemas, setSchemas] = useState<ServerOption[]>([]);
  const [model, setModel] = useState("");
  const [schema, setSchema] = useState("");
  const [file, setFile] = useState<Picked | null>(null);
  const [saved, setSaved] = useState<SavedPick | null>(null);
  const [again, setAgain] = useState(false);
  const [lab, setLab] = useState<LabView | null>(null);
  const [share, setShare] = useState(true);
  const [includeFile, setIncludeFile] = useState(true);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const loadServers = useCallback(async (choose?: string) => {
    const list = await call("server.list", {});
    setServers(list);
    setServer((old) => choose ?? (old || (list[0]?.url ?? "")));
  }, [call]);

  useEffect(() => {
    void loadServers();
    void call("lab.view", {}).then(setLab);
  }, [call, loadServers]);

  useEffect(() => on("job-status", ({ message }) => setStatus(message)), [on]);

  // Opened on a file the base already holds, from the reader or the file's own menu.
  const given = connection.route.id;
  useEffect(() => {
    if (!given) return;
    const name = given.split("/").pop() ?? given;
    setFile({ name, mediaType: "application/pdf", dataBase64: "", size: 0, ref: given });
    void call("paper.saved", { name, ref: given }).then(setSaved, () => setSaved(null));
  }, [call, given]);

  useEffect(() => {
    if (!server) return;
    setProblem("");
    setModels([]);
    setSchemas([]);
    call("server.options", { url: server })
      .then((options) => {
        setModels(options.models);
        setSchemas(options.schemas);
        setModel((options.models.find((item) => item.default) ?? options.models[0])?.id ?? "");
        setSchema((options.schemas.find((item) => item.default) ?? options.schemas[0])?.id ?? "");
      })
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)));
  }, [call, server]);

  useEffect(() => {
    if (status === null) return undefined;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [status, started]);

  /** A paper, a saved extraction of it, or both at once. */
  const pick = async (chosen: File[]): Promise<void> => {
    if (!chosen.length) return;
    setProblem("");
    try {
      const paper = chosen.find((item) => !isSaved(item.name));
      const extraction = chosen.find((item) => isSaved(item.name));
      const next = paper ? await readFile(paper) : file;
      if (paper) setFile(next);
      if (extraction) {
        const text = await readText(extraction);
        const about = await call("paper.saved", { name: extraction.name, text });
        setSaved(about ? { ...about, text } : null);
        setAgain(false);
        // A saved extraction on its own still names its paper.
        if (!next) setFile({ name: `${stemOf(extraction.name)}.pdf`, mediaType: "application/pdf", dataBase64: "", size: 0 });
      } else if (paper && next) {
        setSaved(await call("paper.saved", { name: next.name }).catch(() => null));
        setAgain(false);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const inLab = Boolean(lab?.link?.token);
  const useSaved = Boolean(saved) && !again;
  const hasBytes = Boolean(file && (file.ref || file.dataBase64));

  const extract = async (): Promise<void> => {
    if (!file) return;
    setProblem("");
    setStarted(Date.now());
    setElapsed(0);
    setStatus(useSaved ? "Reading the saved extraction" : "Sending the paper");
    try {
      const paper = await call("paper.extract", {
        ...(file.ref ? { ref: file.ref } : { file: { name: file.name, mediaType: file.mediaType, dataBase64: file.dataBase64 } }),
        ...(useSaved ? { saved: saved!.text !== undefined ? { name: saved!.name, text: saved!.text } : (true as const) } : { server, model, schema }),
        ...(inLab && share ? { share: { includeFile: includeFile && hasBytes } } : {}),
      });
      await call("canvas.show", { id: paper.canvas });
      await call("dialog.close", {});
    } catch (error) {
      setStatus(null);
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  if (adding) {
    return (
      <main className="sheet">
        <AddServer
          connection={connection}
          onCancel={() => setAdding(false)}
          onDone={(added) => {
            setAdding(false);
            void loadServers(added.url);
          }}
        />
      </main>
    );
  }

  if (status !== null) {
    return (
      <main className="sheet working" data-dg="upload-working">
        <h1>Reading {file?.name}</h1>
        <p role="status" data-dg="upload-status">{status}</p>
        {useSaved ? null : <p className="note">{elapsed > 0 ? `${elapsed} seconds so far. ` : ""}A whole paper can take a few minutes on a hosted model.</p>}
      </main>
    );
  }

  return (
    <main className="sheet">
      <header className="sheet-head">
        <h1>Upload a paper</h1>
        <button type="button" className="icon-only" data-dg="upload-close" aria-label="Close" onClick={() => void call("dialog.close", {})}>
          <Icon name="close" />
        </button>
      </header>

      <div
        className={file ? "drop filled" : "drop"}
        data-dg="upload-drop"
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") input.current?.click();
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void pick(Array.from(event.dataTransfer.files));
        }}
      >
        {file ? (
          <span data-dg="upload-file">{file.name}{file.size ? ` (${sizeOf(file.size)})` : file.ref ? " (in this vault)" : ""}</span>
        ) : (
          <>
            <strong>Choose a file</strong>
            <span>or drop it here. PDF, Word, Markdown or text. Add a saved extraction with it, if you have one.</span>
          </>
        )}
        <input ref={input} data-dg="upload-input" type="file" accept={ACCEPTED} multiple hidden onClick={(event) => event.stopPropagation()} onChange={(event) => void pick(Array.from(event.target.files ?? []))} />
      </div>

      {saved ? (
        <div className="found" data-dg="upload-saved">
          <strong>This paper was already read</strong>
          <span>
            {saved.name} holds {saved.units} units and {saved.relations} links{saved.model ? `, read by ${saved.model}` : ""}. Extract graph will use it, so nothing is sent anywhere.
          </span>
          {hasBytes ? (
            <label>
              <input type="checkbox" data-dg="upload-again" checked={again} onChange={(event) => setAgain(event.target.checked)} />
              Read it again on a server instead
            </label>
          ) : null}
        </div>
      ) : null}

      {useSaved ? null : (
        <>
      <label className="field">
            <span>Compute server</span>
            <div className="row">
              <select data-dg="upload-server" value={server} onChange={(event) => setServer(event.target.value)}>
                {servers.map(({ id, name, url, kind }) => <option key={id} value={url}>{name} ({KIND_LABELS[kind]})</option>)}
              </select>
              <button type="button" data-dg="upload-add-server" onClick={() => setAdding(true)}>Add</button>
            </div>
          </label>

          <label className="field">
            <span>Extraction model</span>
            <select data-dg="upload-model" value={model} disabled={models.length === 0} onChange={(event) => setModel(event.target.value)}>
              {models.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
            {models.find(({ id }) => id === model)?.description ? <small>{models.find(({ id }) => id === model)!.description}</small> : null}
          </label>

          <label className="field">
            <span>Schema</span>
            <select data-dg="upload-schema" value={schema} disabled={schemas.length === 0} onChange={(event) => setSchema(event.target.value)}>
              {schemas.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </>
      )}

      {inLab ? (
        <fieldset className="choices">
          <label>
            <input type="checkbox" data-dg="upload-share" checked={share} onChange={(event) => setShare(event.target.checked)} />
            Add to {lab!.link!.name}'s shelf
          </label>
          {share && hasBytes ? (
            <label className="indent">
              <input type="checkbox" data-dg="upload-include-file" checked={includeFile} onChange={(event) => setIncludeFile(event.target.checked)} />
              Include the original file
            </label>
          ) : null}
        </fieldset>
      ) : null}

      {useSaved ? null : <p className="note">If this paper has a DOI, its extraction and DOI are kept on Discourse Graphs. The file isn't. With no DOI, nothing is kept there.</p>}
      {problem ? <p className="problem" role="alert" data-dg="upload-problem">{problem}</p> : null}
      <div className="row end">
        <button type="button" className="primary" data-dg="upload-go" disabled={!file || (useSaved ? false : !hasBytes || !model || !schema)} onClick={() => void extract()}>Extract graph</button>
      </div>
    </main>
  );
};
