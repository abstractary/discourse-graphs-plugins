import { useEffect, useState } from "react";
import type { CanvasRecord } from "@dg/contract/records.ts";
import type { CanvasView, ExportTarget, LabView } from "@dg/contract/surface.ts";
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
  const [format, setFormat] = useState<"zip" | "eln">("zip");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("folder.list", {}).then(setFolders);
    void call("canvas.list", {}).then((list) => setCanvases(list.filter(({ id }) => id !== view.canvas.id)));
    void call("lab.view", {}).then(setLab);
    void call("crate.licenses", {}).then(setLicenses);
  }, [call, view.canvas.id]);

  const nodes = scope === "all" ? all : picked;

  const go = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      if (destination === "crate") {
        const made = await call("crate.export", {
          canvas: view.canvas.id,
          ...(scope === "picked" ? { nodes } : {}),
          ...(license ? { license } : {}),
          pdfs,
          format,
        });
        onDone(`Saved ${made.name} to ${made.where}: ${made.units} ${made.units === 1 ? "unit" : "units"}${made.added > 0 ? `, ${made.added} of them brought in because the others rest on them` : ""}`);
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
        <option value="workspace">My workspace</option>
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
        </div>
      ) : null}
      {destination === "new-folder" ? (
        <div className="field">
          <input data-dg="export-folder-name" aria-label="Folder name" placeholder="Folder name" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
      ) : null}
      {destination === "crate" ? (
        <p className="note">One archive with the metadata, a page to read it by, the graph, its records, this canvas and DataCite metadata. Units the chosen ones rest on come along.</p>
      ) : (
        <p className="note">Exported units get their own {`note or page`}, and stay on this canvas too.</p>
      )}
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="row end go">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" data-dg="export-go" disabled={busy || nodes.length === 0} onClick={() => void go()}>{busy ? `Exporting ${nodes.length}` : destination === "crate" ? "Save crate" : "Export"}</button>
      </div>
    </div>
  );
};
