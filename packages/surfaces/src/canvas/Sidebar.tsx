import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepositoryCanvas, UnitsAvailable } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";
import { App as Search } from "../search/App.tsx";
import { Drawer } from "./Drawer.tsx";

/**
 * The sidebar of a canvas: where things live, and what can be brought in.
 *
 * Three fixed tabs, always in this order. Library is the one map of every
 * workspace and what it holds, with the canvas on screen marked. Search finds
 * a unit anywhere. Units lists what isn't on this canvas yet. The selected
 * unit's own facts stay in the Context panel on the other side.
 *
 * It floats over the canvas and goes when the canvas is clicked. Pinned, the
 * canvas makes room for it and it stays.
 */

export type SideTab = "places" | "search" | "units";

const TABS: { id: SideTab; label: string; hint: string }[] = [
  { id: "places", label: "Library", hint: "Every workspace, and the canvases and papers in each" },
  { id: "search", label: "Search units", hint: "Find a unit anywhere" },
  { id: "units", label: "Units", hint: "Units that aren't on this canvas yet" },
];

const ORDER = { own: 0, lab: 1, other: 2 } as const;

const Places = ({ connection, current, onGo, report }: { connection: Connection; current: string | undefined; onGo: (id: string) => void; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [canvases, setCanvases] = useState<RepositoryCanvas[] | null>(null);
  const [find, setFind] = useState("");
  const load = useCallback(() => void call("repository.canvases", {}).then(setCanvases).catch(report), [call, report]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  const groups = useMemo(() => {
    const wanted = find.trim().toLowerCase();
    const byPlace = new Map<string, { workspace: RepositoryCanvas["workspace"]; canvases: RepositoryCanvas[]; papers: RepositoryCanvas[] }>();
    for (const canvas of canvases ?? []) {
      if (wanted && !canvas.title.toLowerCase().includes(wanted)) continue;
      const key = `${canvas.workspace.kind}:${canvas.workspace.id}`;
      if (!byPlace.has(key)) byPlace.set(key, { workspace: canvas.workspace, canvases: [], papers: [] });
      byPlace.get(key)![canvas.kind === "paper" ? "papers" : "canvases"].push(canvas);
    }
    const byTitle = (a: RepositoryCanvas, b: RepositoryCanvas) => a.title.localeCompare(b.title);
    return [...byPlace.values()]
      .map((group) => ({ ...group, canvases: group.canvases.sort(byTitle), papers: group.papers.sort(byTitle) }))
      .sort((a, b) => ORDER[a.workspace.kind] - ORDER[b.workspace.kind] || a.workspace.name.localeCompare(b.workspace.name));
  }, [canvases, find]);
  const here = (canvases ?? []).find((canvas) => canvas.id === current);

  const row = (canvas: RepositoryCanvas) => (
    <li key={canvas.id}>
      <button type="button" className="side-row" aria-current={canvas.id === current ? "page" : undefined} data-dg={`place-${canvas.title}`} title={canvas.title} onClick={() => onGo(canvas.id)}>
        <span className="side-row-title">{canvas.title}</span>
        <span className="side-row-count">{canvas.cards}</span>
      </button>
    </li>
  );

  return (
    <div className="side-places" data-dg="side-places">
      {here ? (
        <p className="side-here" data-dg="side-here">
          <span>You are in</span> <strong>{here.workspace.name}</strong> <span aria-hidden="true">›</span> <strong>{here.title}</strong>
        </p>
      ) : null}
      <input className="side-find" aria-label="Find a canvas or paper" placeholder="Find a canvas or paper" value={find} onChange={(event) => setFind(event.target.value)} data-dg="side-find" />
      <div className="side-scroll">
        {canvases !== null && groups.length === 0 ? <p className="side-none">{find ? "Nothing by that name." : "No canvases yet."}</p> : null}
        {groups.map(({ workspace, canvases: laid, papers }) => (
          <section key={`${workspace.kind}:${workspace.id}`} className="side-place" data-dg={`workspace-${workspace.name}`}>
            <h3>
              {workspace.name}
              <span>{workspace.kind === "own" ? "Only you" : workspace.kind === "lab" ? "Lab workspace" : "Not yours"}</span>
            </h3>
            {laid.length ? (
              <>
                <h4>Canvases <span>{laid.length}</span></h4>
                <ul>{laid.map(row)}</ul>
              </>
            ) : null}
            {papers.length ? (
              <>
                <h4>Papers <span>{papers.length}</span></h4>
                <ul>{papers.map(row)}</ul>
              </>
            ) : null}
          </section>
        ))}
      </div>
      <div className="side-foot">
        <button type="button" data-dg="side-new" onClick={() => void call("canvas.create", { title: "Untitled canvas" }).then((made) => onGo(made.id)).catch(report)}><Icon name="plus" /> New canvas</button>
        <button type="button" data-dg="side-upload" onClick={() => void call("dialog.open", { surface: "upload" }).catch(report)}>Upload a paper</button>
        <button type="button" data-dg="side-map" onClick={() => void call("papers.show", current ? { canvas: current } : {}).catch(report)}>Paper map</button>
      </div>
    </div>
  );
};

export const Sidebar = ({
  connection,
  current,
  tab,
  pinned,
  units,
  onTab,
  onPin,
  onClose,
  onGo,
  onPlace,
  report,
}: {
  connection: Connection;
  current: string | undefined;
  tab: SideTab;
  pinned: boolean;
  units: UnitsAvailable | null;
  onTab: (tab: SideTab) => void;
  onPin: (pinned: boolean) => void;
  onClose: () => void;
  onGo: (id: string) => void;
  onPlace: (units: string[]) => void;
  report: (error: unknown) => void;
}) => (
  <aside className="side" data-dg="side" data-pinned={pinned ? "" : undefined} aria-label="Library, search units and units to place">
    <header className="side-head">
      <div className="side-tabs" role="tablist" aria-label="Sidebar">
        {TABS.map(({ id, label, hint }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} title={hint} data-dg={`side-tab-${id}`} onClick={() => onTab(id)}>
            {label}
            {id === "units" && units ? <span className="side-count">{Object.keys(units.units).length}</span> : null}
          </button>
        ))}
      </div>
      <button type="button" className="side-pin" aria-pressed={pinned} data-dg="side-pin" title={pinned ? "Let it float over the canvas again" : "Keep it open beside the canvas"} onClick={() => onPin(!pinned)}>
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" className="side-close" aria-label="Close the sidebar" data-dg="side-close" onClick={onClose}>×</button>
    </header>
    <div className="side-body" role="tabpanel" data-tab={tab}>
      {tab === "places" ? <Places connection={connection} current={current} onGo={onGo} report={report} /> : null}
      {tab === "search" ? <Search connection={connection} /> : null}
      {tab === "units" ? <Drawer side data={units} open onToggle={onClose} onPlace={onPlace} height={0} onResize={() => undefined} /> : null}
    </div>
  </aside>
);
