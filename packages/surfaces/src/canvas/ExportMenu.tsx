import { useEffect, useState } from "react";
import type { CanvasRecord } from "@dg/contract/records.ts";
import type { CanvasView, DepositSettings, ExportTarget, LabView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";

type Destination = "workspace" | "lab" | "new-folder" | "crate" | `folder:${string}` | `canvas:${string}`;

const targetOf = (destination: Destination, title: string): ExportTarget => {
  if (destination === "workspace" || destination === "lab") return { kind: destination };
  if (destination === "new-folder") return { kind: "new-folder", title };
  const [kind, id] = [destination.slice(0, destination.indexOf(":")), destination.slice(destination.indexOf(":") + 1)];
  return kind === "folder" ? { kind: "folder", id } : { kind: "canvas", id };
};

/** Sends a whole paper, or the cards picked, somewhere a person will keep working on them. */
export const ExportMenu = ({
  connection,
  view,
  picked,
  onClose,
  onDone,
}: {
  connection: Connection;
  view: CanvasView;
  picked: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}) => {
  const { call } = connection;
  const all = Object.keys(view.nodes);
  const [scope, setScope] = useState<"all" | "picked">(picked.length > 0 ? "picked" : "all");
  const [destination, setDestination] = useState<Destination>("workspace");
  const [title, setTitle] = useState("");
  const [folders, setFolders] = useState<{ id: string; title: string }[]>([]);
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [lab, setLab] = useState<LabView | null>(null);
  const [licenses, setLicenses] = useState<{ url: string; name: string }[]>([]);
  const [license, setLicense] = useState("");
  const [pdfs, setPdfs] = useState(false);
  const [outputs, setOutputs] = useState(true);
  const [zenodo, setZenodo] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [deposit, setDeposit] = useState<DepositSettings | null>(null);
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState<{ page: string; doi?: string; where: string } | null>(null);
  const [format, setFormat] = useState<"zip" | "eln">("zip");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("folder.list", {}).then(setFolders);
    void call("canvas.list", {}).then((list) => setCanvases(list.filter(({ id }) => id !== view.canvas.id)));
    void call("lab.view", {}).then(setLab);
    void call("crate.licenses", {}).then(setLicenses);
    void call("deposit.settings", {}).then(setDeposit);
  }, [call, view.canvas.id]);

  const nodes = scope === "all" ? all : picked;
  const place = sandbox ? "Zenodo's sandbox" : "Zenodo";
  const kept = deposit ? (sandbox ? deposit.sandbox : deposit.live) : null;
  const toZenodo = destination === "crate" && zenodo && format === "zip";
  const tokenPage = `https://${sandbox ? "sandbox." : ""}zenodo.org/account/settings/applications/tokens/new/`;

  const keepToken = async (value: string | null): Promise<void> => {
    setProblem("");
    try {
      setDeposit(await call("deposit.configure", { sandbox, token: value }));
      setToken("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const go = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      if (destination === "crate") {
        const asked = { canvas: view.canvas.id, ...(scope === "picked" ? { nodes } : {}), ...(license ? { license } : {}), pdfs, outputs };
        const packed = (made: { units: number; added: number; outputs: number; changed: number }): string =>
          `${made.units} ${made.units === 1 ? "unit" : "units"}${made.added > 0 ? `, ${made.added} of them brought in because the others rest on them` : ""}${made.outputs > 0 ? `, ${made.outputs} output ${made.outputs === 1 ? "file" : "files"}` : ""}${made.changed > 0 ? `. ${made.changed} output ${made.changed === 1 ? "file was" : "files were"} left out because ${made.changed === 1 ? "it has" : "they have"} changed since ${made.changed === 1 ? "it was" : "they were"} recorded` : ""}`;
        if (toZenodo) {
          const made = await call("crate.deposit", { ...asked, sandbox });
          // The draft stays on screen with its link: reviewing and publishing it happens on Zenodo, not here.
          setDraft({ page: made.page, where: made.where, ...(made.doi ? { doi: made.doi } : {}) });
          setBusy(false);
          void call("deposit.settings", {}).then(setDeposit);
          return;
        }
        const made = await call("crate.export", { ...asked, format });
        onDone(`Saved ${made.name} to ${made.where}: ${packed(made)}`);
        return;
      }
      const result = await call("units.export", { nodes, target: targetOf(destination, title.trim() || "New folder") });
      onDone(`Exported ${nodes.length} ${nodes.length === 1 ? "unit" : "units"}${result.made > 0 ? `, ${result.made} new` : ""}`);
      if (result.canvas) void call("canvas.show", { id: result.canvas });
    } catch (error) {
      setBusy(false);
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="popover export-menu" role="dialog" aria-label="Export" data-dg="export-menu">
      <h3>What</h3>
      <label>
        <input type="radio" name="scope" data-dg="export-all" checked={scope === "all"} onChange={() => setScope("all")} />
        {view.paper ? "The whole paper" : "The whole canvas"} ({all.length})
      </label>
      <label>
        <input type="radio" name="scope" data-dg="export-picked" checked={scope === "picked"} disabled={picked.length === 0} onChange={() => setScope("picked")} />
        Selected cards ({picked.length})
      </label>
      <h3>Where</h3>
      <select data-dg="export-target" aria-label="Where to export to" value={destination} onChange={(event) => setDestination(event.target.value as Destination)}>
        <option value="workspace">My canvas, in your workspace</option>
        {lab?.link?.token ? <option value="lab">{lab.link.name}'s canvas</option> : null}
        {folders.map(({ id, title: name }) => <option key={id} value={`folder:${id}`}>Folder: {name}</option>)}
        <option value="new-folder">New folder</option>
        {canvases.map(({ id, title: name }) => <option key={id} value={`canvas:${id}`}>Canvas: {name}</option>)}
        <option value="crate">A research crate (RO-Crate)</option>
      </select>
      {destination === "crate" ? (
        <div className="crate-options" data-dg="crate-options">
          <label className="field">
            <span>License</span>
            <select data-dg="crate-license" aria-label="License" value={license} onChange={(event) => setLicense(event.target.value)}>
              <option value="">Not chosen yet</option>
              {licenses.map(({ url, name }) => <option key={url} value={url}>{name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>File</span>
            <select data-dg="crate-format" aria-label="File type" value={format} onChange={(event) => setFormat(event.target.value as "zip" | "eln")}>
              <option value="zip">.crate.zip, for Zenodo, WorkflowHub and RO-Crate tools</option>
              <option value="eln">.eln, for eLabFTW, RSpace and other lab notebooks</option>
            </select>
          </label>
          <label>
            <input type="checkbox" data-dg="crate-pdfs" checked={pdfs} onChange={(event) => setPdfs(event.target.checked)} />
            Include the papers' PDFs
          </label>
          {pdfs ? <p className="note">Only include a PDF you may pass on. A paper's own license decides that, not the crate's.</p> : null}
          <label>
            <input type="checkbox" data-dg="crate-outputs" checked={outputs} onChange={(event) => setOutputs(event.target.checked)} />
            Include the output files
          </label>
          {format === "zip" && deposit?.reachable ? (
            <label>
              <input type="checkbox" data-dg="crate-zenodo" checked={zenodo} onChange={(event) => setZenodo(event.target.checked)} />
              Also start a draft on Zenodo
            </label>
          ) : null}
          {toZenodo ? (
            <div className="zenodo" data-dg="zenodo-options">
              <label>
                <input type="checkbox" data-dg="zenodo-sandbox" checked={sandbox} onChange={(event) => setSandbox(event.target.checked)} />
                Use Zenodo's sandbox, to try this out
              </label>
              {kept?.kept ? (
                <p className="note" data-dg="zenodo-token-kept">
                  A token for {place} is kept{kept.hint ? `, ending ${kept.hint}` : ""}. <button type="button" className="link" data-dg="zenodo-token-remove" onClick={() => void keepToken(null)}>Remove it</button>
                </p>
              ) : deposit?.canKeep ? (
                <>
                  <div className="row">
                    <input type="password" data-dg="zenodo-token" aria-label={`A token for ${place}`} placeholder={`A token for ${place}`} autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} />
                    <button type="button" data-dg="zenodo-token-save" disabled={!token.trim()} onClick={() => void keepToken(token)}>Keep</button>
                  </div>
                  <p className="note">
                    Make one on <button type="button" className="link" onClick={() => void call("link.open", { url: tokenPage })}>{place}</button> with only <code>deposit:write</code> ticked. That scope can add drafts and can't publish.
                  </p>
                </>
              ) : (
                <p className="note">This base has nowhere to keep a token, so it can't send to Zenodo.</p>
              )}
              <p className="note">This saves the crate here, starts a draft on {place} with the crate in it, and writes the DOI {place} reserves into the crate. Nothing is public until you publish the draft on Zenodo. Publishing can't be undone.</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {destination === "new-folder" ? (
        <div className="field">
          <input data-dg="export-folder-name" aria-label="Folder name" placeholder="Folder name" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
      ) : null}
      {destination === "crate" ? (
        <p className="note">One archive with a README that tells each finding, the metadata, the graph, its records, this canvas and DataCite metadata. Units the chosen ones rest on come along, and every unit is also described in the MIRA schema.</p>
      ) : (
        <p className="note">Exported units get their own {`note or page`}, and stay on this canvas too.</p>
      )}
      {draft ? (
        <div className="draft" data-dg="zenodo-draft" role="status">
          <p>
            A draft is waiting on {place}{draft.doi ? `, with ${draft.doi} reserved for it` : ""}. The same crate is saved in {draft.where}.
          </p>
          <div className="row end">
            <button type="button" onClick={() => onDone(`Draft started on ${place}`)}>Done</button>
            <button type="button" className="primary" data-dg="zenodo-open" onClick={() => void call("link.open", { url: draft.page })}>Review it on Zenodo</button>
          </div>
        </div>
      ) : null}
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="row end go">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" data-dg="export-go" disabled={busy || nodes.length === 0 || Boolean(draft) || (toZenodo && !kept?.kept)} onClick={() => void go()}>{busy ? `Exporting ${nodes.length}` : toZenodo ? "Save and start draft" : destination === "crate" ? "Save crate" : "Export"}</button>
      </div>
    </div>
  );
};
