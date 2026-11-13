import { useCallback, useEffect, useMemo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import type { PaperMap, PaperMapLink, PaperMapPaper, PaperMapTie, PaperScope, PaperScopeChoice } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { plain } from "../shared/ui.tsx";

/**
 * Papers placed by how far they have been worked into each other. Distance is
 * the reading: close papers are tied by many links or a citation, far ones by
 * few, and a paper nobody has connected waits underneath. The line between
 * two papers says what the links amount to, in words as well as in color.
 */

type Loaded = PaperMap & { scopes: PaperScopeChoice[] };
type Picked = { paper: string } | { tie: string } | null;

const keyOf = (scope: PaperScope): string => ("id" in scope ? `${scope.kind}:${scope.id}` : scope.kind);
const tieKey = (tie: { a: string; b: string }): string => `${tie.a}|${tie.b}`;
const count = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a tie amounts to, in a few words. */
const sayTie = (tie: PaperMapTie): string =>
  [
    tie.supports ? count(tie.supports, "supports", "support") : "",
    tie.opposes ? count(tie.opposes, "opposes", "oppose") : "",
    tie.other ? count(tie.other, "other link", "other links") : "",
    tie.cites ? (tie.cites === "both" ? "cite each other" : "cites") : "",
  ]
    .filter(Boolean)
    .join(" · ");

const PaperCard = ({ data, selected }: NodeProps) => {
  const paper = (data as { paper: PaperMapPaper }).paper;
  return (
    <div className="pm-card" data-dg="pm-paper" data-paper={paper.id} data-apart={paper.apart ? "" : undefined} data-selected={selected ? "" : undefined}>
      <Handle type="source" position={Position.Top} className="pm-pin" isConnectable={false} />
      <Handle type="target" position={Position.Top} className="pm-pin" isConnectable={false} />
      <strong>{paper.label}</strong>
      <span className="pm-title">{plain(paper.title)}</span>
      <span className="pm-meta">
        {count(paper.units, "unit", "units")}
        {paper.tiedTo ? ` · ${paper.reaching} linked out · ${count(paper.tiedTo, "paper", "papers")}` : " · tied to nothing here"}
      </span>
    </div>
  );
};

const TieLine = ({ sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps) => {
  const tie = (data as { tie: PaperMapTie }).tie;
  const width = 1.5 + tie.strength * 6;
  const length = Math.max(1, Math.hypot(targetX - sourceX, targetY - sourceY));
  // Agreement and conflict between the same two papers run side by side, so neither hides the other.
  const offset = tie.stance === "mixed" ? width / 2 + 1 : 0;
  const nx = (-(targetY - sourceY) / length) * offset, ny = ((targetX - sourceX) / length) * offset;
  const line = (dx: number, dy: number): string => `M ${sourceX + dx},${sourceY + dy} L ${targetX + dx},${targetY + dy}`;
  return (
    <>
      {tie.stance === "mixed" ? (
        <>
          <BaseEdge path={line(nx, ny)} className="pm-tie" style={{ strokeWidth: width, stroke: "var(--rel-supports)" }} interactionWidth={0} />
          <BaseEdge path={line(-nx, -ny)} className="pm-tie" style={{ strokeWidth: width, stroke: "var(--rel-opposes)" }} interactionWidth={0} />
          <BaseEdge path={line(0, 0)} style={{ stroke: "transparent" }} interactionWidth={22} />
        </>
      ) : (
        <BaseEdge path={line(0, 0)} className="pm-tie" data-stance={tie.stance} style={{ strokeWidth: width }} interactionWidth={22} />
      )}
      <EdgeLabelRenderer>
        <span className="pm-tie-label nodrag nopan" data-dg="pm-tie-label" data-stance={tie.stance} data-selected={selected ? "" : undefined} style={{ transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)` }}>
          {sayTie(tie)}
        </span>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { paper: PaperCard };
const edgeTypes = { tie: TieLine };

const LinkRow = ({ link, onOpen }: { link: PaperMapLink; onOpen: (unit: PaperMapLink["from"]) => void }) => (
  <li data-stance={link.stance ?? "other"}>
    <button type="button" className="pm-unit" onClick={() => onOpen(link.from)}>
      <span className="chip" data-base={link.from.base ?? "none"}>{link.from.abbreviation ?? "Unit"}</span>
      <span>{plain(link.from.title)}</span>
    </button>
    <span className="pm-rel" data-stance={link.stance ?? "other"}>{link.label}</span>
    <button type="button" className="pm-unit" onClick={() => onOpen(link.to)}>
      <span className="chip" data-base={link.to.base ?? "none"}>{link.to.abbreviation ?? "Unit"}</span>
      <span>{plain(link.to.title)}</span>
    </button>
  </li>
);

const Map = ({ connection }: { connection: Connection }) => {
  const { call, on, route } = connection;
  const [scope, setScope] = useState<PaperScope>(route.id ? { kind: "canvas", id: route.id } : { kind: "own" });
  const [map, setMap] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [problem, setProblem] = useState("");
  const flow = useReactFlow();

  const load = useCallback(() => {
    void call("papers.map", { scope })
      .then((next) => {
        setMap(next);
        setProblem("");
      })
      .catch((error: Error) => setProblem(error.message));
  }, [call, scope]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  const shownKey = map ? `${keyOf(map.scope)}:${map.papers.length}:${map.ties.length}` : "";
  // The whole picture comes into view once its cards have a size, and again whenever the scope changes it.
  const measured = useNodesInitialized();
  useEffect(() => {
    if (!shownKey || !measured) return;
    const timer = window.setTimeout(() => void flow.fitView({ padding: 0.12, duration: 250, maxZoom: 1 }), 150);
    return () => window.clearTimeout(timer);
  }, [flow, shownKey, measured]);

  const nodes = useMemo<Node[]>(
    () =>
      (map?.papers ?? []).map((paper) => ({
        id: paper.id,
        type: "paper",
        position: { x: paper.x, y: paper.y },
        data: { paper },
        width: map!.card.width,
        height: map!.card.height,
        draggable: false,
        connectable: false,
        selected: picked !== null && "paper" in picked && picked.paper === paper.id,
      })),
    [map, picked],
  );
  const edges = useMemo<Edge[]>(
    () =>
      (map?.ties ?? []).map((tie) => ({
        id: tieKey(tie),
        type: "tie",
        source: tie.a,
        target: tie.b,
        data: { tie },
        selected: picked !== null && "tie" in picked && picked.tie === tieKey(tie),
      })),
    [map, picked],
  );

  if (problem) return <main className="pm"><p className="pm-none" role="alert">{problem}</p></main>;
  if (!map) return <main className="pm" aria-busy="true" />;

  const paperAt = new globalThis.Map(map.papers.map((paper) => [paper.id, paper]));
  const apart = map.papers.filter((paper) => paper.apart).length;
  const tie = picked && "tie" in picked ? map.ties.find((item) => tieKey(item) === picked.tie) : undefined;
  const paper = picked && "paper" in picked ? paperAt.get(picked.paper) : undefined;
  const tiesOf = paper ? map.ties.filter((item) => item.a === paper.id || item.b === paper.id) : [];
  const openUnit = (unit: PaperMapLink["from"]) => {
    const home = paperAt.get(unit.paper);
    if (home) void call("canvas.reveal", { id: home.canvas, unit: unit.id }).catch((error: Error) => setProblem(error.message));
  };
  const citing = (item: PaperMapTie): string | null =>
    !item.cites ? null : item.cites === "both" ? "Each cites the other." : `${paperAt.get(item.cites === "a-b" ? item.a : item.b)?.label} cites ${paperAt.get(item.cites === "a-b" ? item.b : item.a)?.label}.`;

  return (
    <main className="pm" data-dg="papers">
      <header className="pm-bar">
        <h1>Paper map</h1>
        <div className="pm-scopes" role="tablist" aria-label="Whose work counts">
          {map.scopes.map((choice) => (
            <button key={keyOf(choice.scope)} type="button" role="tab" aria-selected={keyOf(choice.scope) === keyOf(map.scope)} title={choice.hint} data-dg={`pm-scope-${choice.scope.kind}`} onClick={() => { setPicked(null); setScope(choice.scope); }}>
              {choice.label}
            </button>
          ))}
        </div>
        <p className="pm-sum" data-dg="pm-summary">
          {map.papers.length === 0
            ? "No papers here yet."
            : `${count(map.papers.length, "paper", "papers")}, ${count(map.ties.length, "tie", "ties")}.${apart ? ` ${count(apart, "paper is", "papers are")} tied to nothing here.` : ""}`}
        </p>
      </header>
      {map.papers.length === 0 ? (
        <p className="pm-none" data-dg="pm-empty">Papers appear here once they are read. Open a PDF and choose Extract graph, then link units of different papers on a canvas.</p>
      ) : (
        <div className="pm-body">
          <div className="pm-flow">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              minZoom={0.15}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, node) => setPicked({ paper: node.id })}
              onNodeDoubleClick={(_, node) => void call("canvas.show", { id: paperAt.get(node.id)!.canvas })}
              onEdgeClick={(_, edge) => setPicked({ tie: edge.id })}
              onPaneClick={() => setPicked(null)}
            />
            <ul className="pm-legend" aria-label="What the lines mean">
              <li><i data-stance="agree" /> Supports</li>
              <li><i data-stance="conflict" /> Opposes</li>
              <li><i data-stance="linked" /> Other links</li>
              <li><i data-stance="cites" /> Cites only</li>
              <li className="pm-legend-note">Closer and thicker: more tied</li>
            </ul>
          </div>
          <aside className="pm-side" data-dg="pm-side" aria-live="polite">
            {tie ? (
              <>
                <h2>{paperAt.get(tie.a)?.label} and {paperAt.get(tie.b)?.label}</h2>
                <p className="pm-say" data-dg="pm-tie-says">{sayTie(tie)}</p>
                {citing(tie) ? <p className="pm-note">{citing(tie)}</p> : null}
                {tie.links.length ? <ol className="pm-links">{tie.links.map((link) => <LinkRow key={link.relation} link={link} onOpen={openUnit} />)}</ol> : <p className="pm-note">Nobody has linked their units in this scope.</p>}
              </>
            ) : paper ? (
              <>
                <h2>{paper.label}</h2>
                <p className="pm-note">{plain(paper.title)}</p>
                <p className="pm-say">{count(paper.units, "unit", "units")}, {paper.reaching} linked to another paper.</p>
                <button type="button" className="pm-open" data-dg="pm-open" onClick={() => void call("canvas.show", { id: paper.canvas })}>Open its PDF canvas</button>
                {tiesOf.length ? (
                  <ul className="pm-ties">
                    {tiesOf.map((item) => {
                      const other = paperAt.get(item.a === paper.id ? item.b : item.a);
                      return (
                        <li key={tieKey(item)}>
                          <button type="button" onClick={() => setPicked({ tie: tieKey(item) })}>
                            <strong>{other?.label}</strong>
                            <span data-stance={item.stance}>{sayTie(item)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="pm-note">Tied to no other paper in this scope.</p>}
              </>
            ) : (
              <>
                <h2>How to read this</h2>
                <p className="pm-note">Two papers sit closer the more they are tied: by links people drew between their units, and by one citing the other. Wording alone never ties them.</p>
                <p className="pm-note">Pick a paper or a line to see what is behind it. The scope at the top decides whose links count, so the picture changes with it.</p>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
};

export const App = ({ connection }: { connection: Connection }) => (
  <ReactFlowProvider>
    <Map connection={connection} />
  </ReactFlowProvider>
);
