import { useCallback, useEffect, useState } from "react";
import type { NodeSummary, NotebookFile, NotebookImported, RunOutput, RunPage, SurfaceMethods } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Icon, plain } from "../shared/ui.tsx";

const DRIFT = { changed: "edited since this run", missing: "not in this graph" };

const span = (start?: string, end?: string): string => {
  if (!start) return "";
  const from = new Date(start);
  const day = from.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = from.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!end) return `${day}, ${time}`;
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  const took = seconds < 90 ? `${seconds} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;
  return `${day}, ${time}, took ${took}`;
};
const bytes = (size?: number): string => (size === undefined ? "" : size < 1024 ? `${size} B` : size < 1048576 ? `${(size / 1024).toFixed(0)} KB` : `${(size / 1048576).toFixed(1)} MB`);
const who = (agent: string): string => (agent.startsWith("https://orcid.org/") ? `ORCID ${agent.slice(18)}` : agent);

type Open = (id: string) => void;

const Unit = ({ unit, onOpen, dg }: { unit: NodeSummary; onOpen: Open; dg?: string }) => (
  <button type="button" className="run-unit" data-dg={dg} onClick={() => onOpen(unit.id)} title="Show in the Context panel">
    <Chip node={unit} /> <span>{plain(unit.title)}</span>
  </button>
);

const Output = ({ output, onOpen, onEvidence }: { output: RunOutput; onOpen: Open; onEvidence: (id: string) => void }) => (
  <li className="run-output" data-dg="run-output" id={`out-${output.unit.id}`}>
    {output.preview ? <img src={output.preview} alt={plain(output.unit.title)} /> : null}
    <div className="run-output-text">
      <Unit unit={output.unit} onOpen={onOpen} />
      <p className="run-meta">
        {[output.kind, output.cell ? `cell ${output.cell}` : "", output.label ?? "", output.mediaType, bytes(output.size)].filter(Boolean).join(" · ")}
      </p>
      {output.cid ? <p className="run-cid" title="A hash of this output's own bytes. It is the output's identity.">{output.cid}</p> : null}
      {output.stale ? <p className="run-warn" data-dg="run-stale">The notebook on this device now holds different bytes here, so its figure isn't shown as this run's.</p> : null}
      {output.evidence.length ? (
        <ul className="run-rests">
          {output.evidence.map((item) => (
            <li key={item.unit.id}>
              <span className="run-meta">Evidence resting on it</span> <Unit unit={item.unit} onOpen={onOpen} />
              {item.changed ? <span className="run-drift">cites older bytes</span> : !item.pinned ? <span className="run-drift">not pinned</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="run-act" data-dg="run-make-evidence" onClick={() => onEvidence(output.unit.id)} title="Makes evidence pinned to these bytes, and offers it to the open canvas">
        <Icon name="plus" /> Make evidence from this
      </button>
    </div>
  </li>
);

/** One run as a page, read top to bottom in the order the work happened: why, how, what ran, what came out, what rests on it. */
const Page = ({ connection, id, onBack }: { connection: Connection; id: string; onBack: () => void }) => {
  const { call, on } = connection;
  const [page, setPage] = useState<RunPage | null>(null);
  const [problem, setProblem] = useState("");
  const [cells, setCells] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    void call("process.run", { id })
      .then(setPage)
      .catch((error: Error) => setProblem(error.message));
  }, [call, id]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  const open: Open = (unit) => {
    void call("focus.set", { node: unit });
    void call("panel.open", { surface: "context" }).catch(() => {});
  };
  const evidence = (output: string) =>
    void call("evidence.fromOutput", { output })
      .then((made) => {
        setNotice(`Made “${plain(made.title)}”. It is offered to the open canvas, and it's in the units drawer.`);
        open(made.id);
      })
      .catch((error: Error) => setNotice(error.message));

  if (problem) return <main className="run"><p className="run-warn" role="alert">{problem}</p><button type="button" onClick={onBack}>All runs and notebooks</button></main>;
  if (!page) return <main className="run" aria-busy="true" />;
  const { run, study, protocol } = page;

  return (
    <main className="run" data-dg="run-page">
      <header className="run-head">
        <button type="button" className="run-back" data-dg="run-back" onClick={onBack}><Icon name="back" /> Runs and notebooks</button>
        <div className="run-title">
          <Chip node={run} />
          <span className="run-status" data-status={page.status ?? ""} data-dg="run-status">{page.status ?? (page.reportedIn ? "reported in a paper" : "no status")}</span>
          <span className="run-meta">{span(page.startedAt, page.endedAt)}</span>
        </div>
        <h1>{plain(run.title)}</h1>
        {page.agents.length ? <p className="run-meta">Carried out by {page.agents.map(who).join(", ")}</p> : null}
        <div className="run-actions">
          <button type="button" data-dg="run-context" onClick={() => open(run.id)}><Icon name="context" /> Show in Context</button>
          <button type="button" data-dg="run-place" onClick={() => void call("canvas.place", { node: run.id })}><Icon name="canvas" /> Add to canvas</button>
        </div>
        {page.problems.length ? (
          <ul className="run-problems" data-dg="run-problems">
            {page.problems.map((item) => (
              <li key={item.rule} data-severity={item.severity} title={`Rule: ${item.rule}`}>{item.message}</li>
            ))}
          </ul>
        ) : null}
        {notice ? <p className="run-note" role="status">{notice}</p> : null}
      </header>

      <section className="run-section" data-dg="run-why">
        <h2>Why: the experiment</h2>
        {study ? (
          <>
            <Unit unit={study.unit} onOpen={open} dg="run-study" />
            <dl className="run-facts">
              {study.question ? (<><dt>Question</dt><dd><Unit unit={study.question} onOpen={open} /></dd></>) : null}
              {study.hypothesis ? (<><dt>Hypothesis</dt><dd>{study.hypothesis}</dd></>) : null}
              {study.design ? (<><dt>Design</dt><dd>{study.design}</dd></>) : null}
              {study.conditions.length ? (
                <>
                  <dt>Conditions</dt>
                  <dd className="run-conditions">
                    {study.conditions.map((condition) => (
                      <span key={condition} data-this={condition === page.condition}>{condition}{condition === page.condition ? " (this run)" : ""}</span>
                    ))}
                  </dd>
                </>
              ) : null}
            </dl>
          </>
        ) : page.reportedIn ? (
          <div data-dg="run-reported">
            <p className="run-meta">A paper reports this run, so its design is in the paper and not in this graph.</p>
            {page.reportedIn.source ? <Unit unit={page.reportedIn.source} onOpen={open} dg="run-source" /> : null}
            {page.reportedIn.paper ? (
              <button type="button" className="run-act" data-dg="run-paper" onClick={() => void call("canvas.show", { id: page.reportedIn!.paper!.canvas })}>
                <Icon name="canvas" /> Open {page.reportedIn.paper.label}'s canvas
              </button>
            ) : null}
          </div>
        ) : (
          <p className="run-none">This run isn't part of an experiment. Set one from the run's Method section in the Context panel.</p>
        )}
      </section>

      <section className="run-section" data-dg="run-how">
        <h2>{page.alsoFollowed.length ? `How: the ${page.alsoFollowed.length + 1} methods it followed` : "How: the protocol it followed"}</h2>
        {protocol ? (
          <>
            {protocol.unit ? <Unit unit={protocol.unit} onOpen={open} dg="run-protocol" /> : <span className="run-meta">{protocol.id}</span>}
            <p className="run-meta">
              {[protocol.version ? `version ${protocol.version}` : "", protocol.pinned ? `pinned at ${protocol.pinned}` : page.reportedIn ? "" : "not pinned to a version"].filter(Boolean).join(" · ")}
              {protocol.drift ? <span className="run-drift" data-dg="run-protocol-drift">{DRIFT[protocol.drift]}</span> : null}
            </p>
            {protocol.steps.length ? <ol className="run-steps">{protocol.steps.map((step, index) => <li key={index}>{step}</li>)}</ol> : null}
            {protocol.materials.length ? <p className="run-meta">Calls for {protocol.materials.join(", ")}</p> : null}
            {page.alsoFollowed.length ? (
              <ul className="run-code" data-dg="run-also-followed">
                {page.alsoFollowed.map((unit) => <li key={unit.id}><Unit unit={unit} onOpen={open} /></li>)}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="run-none">No protocol is recorded for this run.</p>
        )}
        {page.deviations.length ? (
          <div className="run-deviations" data-dg="run-deviations">
            <h3>Where this run departed from it</h3>
            <ul>{page.deviations.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </div>
        ) : null}
        {page.parameters.length ? (
          <table className="run-table">
            <thead><tr><th>Parameter</th><th>This run</th><th>Default</th></tr></thead>
            <tbody>
              {page.parameters.map((item) => (
                <tr key={item.name} data-set={item.value !== undefined && item.value !== item.default}>
                  <td>{item.name}{item.declared ? "" : " (not declared by the protocol)"}</td>
                  <td>{item.value ?? "—"}{item.value && item.unit ? ` ${item.unit}` : ""}</td>
                  <td>{item.default ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="run-section" data-dg="run-what">
        <h2>What ran</h2>
        {page.code.length ? (
          <ul className="run-code">
            {page.code.map((code) => (
              <li key={code.id}>
                {code.unit ? <Unit unit={code.unit} onOpen={open} dg="run-code" /> : <span className="run-meta">{code.id}</span>}
                <p className="run-meta">
                  {[code.path, code.language, code.commit ? `commit ${code.commit.slice(0, 7)}` : "", code.pinned ? `pinned at ${code.pinned}` : "not pinned"].filter(Boolean).join(" · ")}
                  {code.drift ? <span className="run-drift" data-dg="run-code-drift">{DRIFT[code.drift]}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="run-none">No code is recorded for this run.</p>
        )}
        {page.environment.length ? <p className="run-meta">Environment: {page.environment.map((item) => `${item.name} ${item.value}`).join(", ")}</p> : null}
        {page.inputs.length ? <p className="run-meta">Took in {page.inputs.map((item) => (item.unit ? plain(item.unit.title) : item.id)).join(", ")}</p> : null}
        {page.seeAlso.length ? <p className="run-meta">Lab notebook entry: {page.seeAlso.join(", ")}</p> : null}
        {page.notebook ? (
          <div className="run-notebook">
            <button type="button" className="run-act" aria-expanded={cells} data-dg="run-cells-toggle" onClick={() => setCells((show) => !show)}>
              <Icon name="chevron" /> {cells ? "Hide" : "Show"} the notebook's {page.notebook.cells.length} cells
            </button>
            {!page.notebook.current ? <span className="run-drift" data-dg="run-notebook-moved">the notebook has changed since this run</span> : null}
            {cells ? (
              <ol className="run-cells" data-dg="run-cells">
                {page.notebook.cells.map((cell) => (
                  <li key={cell.index} data-kind={cell.kind}>
                    <span className="run-cell-n">{cell.index}</span>
                    <pre>{cell.source}</pre>
                    {cell.outputs.length ? (
                      <p className="run-meta">
                        Made{" "}
                        {cell.outputs.map((output, index) => (
                          <a key={output} href={`#out-${output}`}>{index ? ", " : ""}{plain(page.outputs.find((item) => item.unit.id === output)?.unit.title ?? "an output")}</a>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="run-section" data-dg="run-out">
        <h2>What came out <span>{page.outputs.length}</span></h2>
        {page.outputs.length ? (
          <ul className="run-outputs">{page.outputs.map((output) => <Output key={output.unit.id} output={output} onOpen={open} onEvidence={evidence} />)}</ul>
        ) : (
          <p className="run-none">No outputs are recorded. Evidence can still rest on the run itself.</p>
        )}
      </section>

      <section className="run-section" data-dg="run-claims">
        <h2>What it is used to argue <span>{page.claims.length}</span></h2>
        {page.claims.length ? (
          <ul className="run-claims">
            {page.claims.map((claim) => (
              <li key={`${claim.unit.id}-${claim.through}`} data-stance={claim.stance}>
                <span className="run-meta">{claim.stance === "supports" ? "Supports" : "Opposes"}</span> <Unit unit={claim.unit} onOpen={open} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="run-none">No claim rests on this run yet.</p>
        )}
      </section>
    </main>
  );
};

type Listed = SurfaceMethods["run.list"]["result"];

/** The notebooks in the base, ready to read in, and the runs already here. */
const Chooser = ({ connection, onOpen }: { connection: Connection; onOpen: Open }) => {
  const { call, on } = connection;
  const [files, setFiles] = useState<NotebookFile[] | null>(null);
  const [runs, setRuns] = useState<Listed>([]);
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState<{ text: string; run?: string } | null>(null);
  const [text, setText] = useState(false);

  const load = useCallback(() => {
    void call("notebook.list", {}).then(setFiles).catch(() => setFiles([]));
    void call("run.list", {}).then(setRuns).catch(() => {});
  }, [call]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  const tell = (made: NotebookImported): string => {
    const outputs = `${made.outputs.length} ${made.outputs.length === 1 ? "output" : "outputs"}`;
    if (made.known) return "This exact run is already here, so nothing was added.";
    if (made.status === "planned") return "Read the code. The notebook hasn't been run, so there are no outputs yet.";
    return `${made.revised ? "The code changed, so this is a new run of a new version. " : ""}Read a ${made.status} run with ${outputs}.`;
  };
  const read = async (file: NotebookFile): Promise<void> => {
    setBusy(file.ref);
    setSaid(null);
    try {
      const made = await call("notebook.import", { ref: file.ref, text });
      setSaid({ text: tell(made), run: made.run.id });
    } catch (error) {
      setSaid({ text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="run" data-dg="run-chooser">
      <header className="run-head">
        <h1>Runs and notebooks</h1>
        <p className="run-meta">A saved Jupyter notebook is read as three things: its code, the run that was saved in it, and one output for each figure or table. Reading it again after a rerun adds the new run beside the old one.</p>
      </header>
      <section className="run-section">
        <h2>Notebooks in this base <span>{files?.length ?? ""}</span></h2>
        <label className="run-option"><input type="checkbox" checked={text} onChange={(event) => setText(event.target.checked)} data-dg="notebook-text" /> Also keep printed text and plain results as outputs</label>
        {said ? (
          <p className="run-note" role="status" data-dg="notebook-said">
            {said.text} {said.run ? <button type="button" className="run-inline" data-dg="notebook-open-run" onClick={() => onOpen(said.run!)}>Open the run</button> : null}
          </p>
        ) : null}
        {files && files.length === 0 ? <p className="run-none">No .ipynb files here yet. Save or copy a notebook into this base, and it appears in this list.</p> : null}
        <ul className="run-files">
          {(files ?? []).map((file) => (
            <li key={file.ref}>
              <span className="run-file">
                <strong>{file.name}</strong>
                <span className="run-meta">{[file.folder, file.code ? `${file.runs} ${file.runs === 1 ? "run" : "runs"} here` : "not read yet"].filter(Boolean).join(" · ")}</span>
              </span>
              <button type="button" className="primary" disabled={busy === file.ref} data-dg={`notebook-import-${file.name}`} onClick={() => void read(file)}>
                {busy === file.ref ? "Reading…" : file.code ? "Read again" : "Read into the graph"}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="run-section">
        <h2>Runs <span>{runs.length}</span></h2>
        {runs.length === 0 ? <p className="run-none">No runs yet.</p> : null}
        <ul className="run-list">
          {runs.map((item) => (
            <li key={item.run.id}>
              <button type="button" data-dg={`run-open-${item.run.title}`} onClick={() => onOpen(item.run.id)}>
                <span className="run-status" data-status={item.status ?? ""}>{item.status ?? (item.reported ? "reported" : "no status")}</span>
                <span className="run-list-title">{plain(item.run.title)}</span>
                <span className="run-meta">
                  {item.reported
                    ? `${item.run.paper?.label ?? "a paper"} · ${item.evidence} evidence`
                    : `${item.at.slice(0, 10)} · ${item.outputs} ${item.outputs === 1 ? "output" : "outputs"} · ${item.evidence} evidence`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};

export const App = ({ connection }: { connection: Connection }) => {
  const [id, setId] = useState<string | null>(connection.route.id ?? null);
  return id ? <Page key={id} connection={connection} id={id} onBack={() => setId(null)} /> : <Chooser connection={connection} onOpen={setId} />;
};
