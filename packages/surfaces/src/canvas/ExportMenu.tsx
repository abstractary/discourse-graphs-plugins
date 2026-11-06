import { useEffect, useState } from "react";
import type { CanvasRecord } from "@dg/contract/records.ts";
import type { CanvasView, ExportTarget, LabView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";

type Destination = "workspace" | "lab" | "new-folder" | `folder:${string}` | `canvas:${string}`;

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
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("folder.list", {}).then(setFolders);
    void call("canvas.list", {}).then((list) => setCanvases(list.filter(({ id }) => id !== view.canvas.id)));
    void call("lab.view", {}).then(setLab);
  }, [call, view.canvas.id]);

  const nodes = scope === "all" ? all : picked;

  const go = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
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
      </select>
      {destination === "new-folder" ? (
        <div className="field">
          <input data-dg="export-folder-name" aria-label="Folder name" placeholder="Folder name" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
      ) : null}
      <p className="note">Exported units get their own {`note or page`}, and stay on this canvas too.</p>
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="row end go">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" data-dg="export-go" disabled={busy || nodes.length === 0} onClick={() => void go()}>{busy ? `Exporting ${nodes.length}` : "Export"}</button>
      </div>
    </div>
  );
};
