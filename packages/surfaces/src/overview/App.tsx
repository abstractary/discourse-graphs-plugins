import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { WholePart, WholeRef, WholeView, Prefs } from "@dg/contract/surface.ts";
import { LoadProblem, useLoad } from "../shared/load.tsx";
import { arrange } from "@dg/layout/modes.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, Mark, Problem, plain } from "../shared/ui.tsx";
import { goneOf, sayOf } from "../shared/words.ts";
import { BaseChip, Flag, KIND_WORD, LEVEL_WORD, PartRow, counted } from "../shared/overview-parts.tsx";

/**
 * The whole explorer: for wholes nobody has made a canvas for yet, and for the
 * top of the holarchy. It draws the whole laid out from the graph with Tidy's
 * Logic arrangement, read-only. A whole with a canvas opens in the canvas tab;
 * one without can be made into one. Its boundary is in the boundary panel.
 */

// Provenance links rest on what they point at, so Tidy reads them like derivedFrom.
const RESTS_ON = new Set(["observationBase", "isGroundedIn", "sourceDocument", "generatedBy", "partOf", "follows", "instrument"]);
// A canvas never opens below 70% zoom, so titles stay readable.
const READABLE = 0.7;
const CARD_WIDTH = 240;

/** `<level>|<id>`, `unit|<id>` for a unit to be located, or nothing for the top. */
const parseStart = (id: string | undefined): { ref: WholeRef | null; locate?: string } => {
  if (!id || id === "canvases") return { ref: null };
  const split = id.indexOf("|");
  const level = id.slice(0, split);
  const rest = id.slice(split + 1);
  return level === "unit" ? { ref: null, locate: rest } : { ref: { level: level as WholeRef["level"], id: rest } };
};

type CardData = {
  part?: WholePart;
  text: string;
  focus: boolean;
  lit: boolean;
  dim: boolean;
  opens: boolean;
  onInside: () => void;
  onText: () => void;
};

const ExplorerCard = ({ data }: NodeProps<Node<CardData>>) => (
  <div
    className="card hv-card"
    data-base={data.part?.base ?? "none"}
    data-focus={data.focus}
    data-lit={data.lit}
    data-dim={data.dim}
    onDoubleClick={() => data.onText()}
  >
    <Handle id="l-t" type="target" position={Position.Left} isConnectable={false} />
    <Handle id="l-s" type="source" position={Position.Left} isConnectable={false} />
    <div className="card-head">
      {data.part ? <BaseChip base={data.part.base} label={data.part.label} /> : null}
      <span className="card-end">
        {data.opens ? (
          <button
            type="button"
            className="open inside nodrag"
            aria-label="Open inside"
            title={data.part?.holds ? `Open inside: ${counted(data.part.holds, "part")}` : "Open inside"}
            onClick={data.onInside}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Icon name="inside" />
          </button>
        ) : null}
        {data.part?.credit.name ? <Mark credit={data.part.credit} /> : null}
      </span>
    </div>
    <div className="card-title">{plain(data.text)}</div>
    {data.part?.flags.length ? <div className="hv-flags">{data.part.flags.map((f) => <Flag key={f} name={f} />)}</div> : null}
    <Handle id="r-s" type="source" position={Position.Right} isConnectable={false} />
    <Handle id="r-t" type="target" position={Position.Right} isConnectable={false} />
  </div>
);
const nodeTypes = { whole: ExplorerCard };

const FitReadable = () => {
  const initialized = useNodesInitialized();
  const { fitView, getZoom, setViewport } = useReactFlow();
  useEffect(() => {
    if (!initialized) return;
    void fitView({ padding: 0.08, maxZoom: 1 }).then(() => {
      if (getZoom() < READABLE) void setViewport({ x: 24, y: 16, zoom: READABLE });
    });
  }, [initialized, fitView, getZoom, setViewport]);
  return null;
};

const LaidOut = ({
  view,
  lit,
  onPick,
  onInside,
  onText,
}: {
  view: WholeView;
  lit: Set<string>;
  onPick: (unit: string) => void;
  onInside: (ref: WholeRef) => void;
  onText: (unit: string) => void;
}) => {
  const partOf = useMemo(() => {
    const map = new Map<string, WholePart>();
    for (const p of [...view.parts, ...view.behind]) map.set(p.id, p);
    for (const [id, n] of Object.entries(view.names)) {
      if (!map.has(id)) map.set(id, { id, title: n.title, base: n.base, label: n.label, credit: { kind: "person", id: "", name: "" }, privacy: "lab", flags: [], ...(n.ref ? { ref: n.ref } : {}) });
    }
    if (view.ref.level !== "lab") {
      map.set(view.ref.id, { id: view.ref.id, title: view.title, base: view.base, label: view.label, credit: { kind: "person", id: "", name: "" }, privacy: "lab", flags: view.flags, ref: view.ref });
    }
    return map;
  }, [view]);
  const kinds = useMemo(() => new Map(view.edges.map((e) => [e.id, e])), [view]);

  // Tidy's Logic arrangement: what a card rests on sits to its left.
  const places = useMemo(() => {
    const boxes = view.canvas.cards.map((c) => ({ id: c.id, x: c.x, y: c.y, width: CARD_WIDTH, height: c.height }));
    const links = view.canvas.links.map((l) => {
      const kind = (l.relation ? kinds.get(l.relation)?.kind : undefined) ?? l.label ?? "";
      return { from: l.from, to: l.to, kind: RESTS_ON.has(kind) ? "derivedFrom" : kind };
    });
    try {
      return arrange({ mode: "logic", boxes, links, frame: { width: 900, height: 560 } }).places;
    } catch {
      return new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
    }
  }, [view, kinds]);

  const nodes: Node<CardData>[] = view.canvas.cards.map((card) => {
    const part = card.unit ? partOf.get(card.unit) : undefined;
    const opens = Boolean(part?.ref && part.ref.id !== view.ref.id);
    return {
      id: card.id,
      type: "overview",
      position: places.get(card.id) ?? { x: card.x, y: card.y },
      style: { width: CARD_WIDTH },
      draggable: false,
      data: {
        ...(part ? { part } : {}),
        text: card.text,
        focus: card.unit === view.ref.id,
        lit: Boolean(card.unit && lit.has(card.unit)),
        dim: lit.size > 0 && !(card.unit && lit.has(card.unit)),
        opens,
        onInside: () => {
          if (part?.ref) onInside(part.ref);
        },
        onText: () => {
          if (card.unit) onText(card.unit);
        },
      },
    };
  });
  const xOf = new Map(nodes.map((n) => [n.id, n.position.x]));
  const edges: Edge[] = view.canvas.links.map((link) => {
    const known = link.relation ? kinds.get(link.relation) : undefined;
    const kind = known?.kind ?? link.label ?? "";
    const leftward = (xOf.get(link.from) ?? 0) > (xOf.get(link.to) ?? 0);
    return {
      id: link.id,
      source: link.from,
      target: link.to,
      sourceHandle: leftward ? "l-s" : "r-s",
      targetHandle: leftward ? "r-t" : "l-t",
      label: KIND_WORD[kind] ?? link.label,
      className: `hv-edge ${!known || known.state === "field" ? "hv-field" : ""} ${known?.state === "pending" ? "hv-pending" : ""}`,
      style: { stroke: `var(--rel-${kind}, var(--dg-muted))` },
      markerEnd: { type: MarkerType.ArrowClosed, color: `var(--rel-${kind}, var(--dg-muted))` },
    };
  });
  return (
    <div className="hv-flow" data-dg="whole-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={2}
        onNodeClick={(_, node) => node.data.part && onPick(node.data.part.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
        <FitReadable />
      </ReactFlow>
    </div>
  );
};

export const App = ({ connection, onShowCanvas }: { connection: Connection; onShowCanvas?: (id: string) => void }) => {
  const { call, on } = connection;
  const start = useMemo(() => parseStart(connection.route.id), [connection.route.id]);
  const [ref, setRef] = useState<WholeRef | null>(start.ref);
  const [past, setPast] = useState<WholeRef[]>([]);
  const [roots, setRoots] = useState<{ ref: WholeRef; title: string; holds: number }[] | null>(null);
  const [view, setView] = useState<WholeView | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ linkDelete: "ask", captureKey: "\\", notebookText: false, cardFields: ["source"], sidePinned: false, miniMap: true, zoteroLibrary: false });
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const report = useCallback((error: unknown) => setNotice(sayOf(error)), []);

  useEffect(() => on("graph-changed", () => setVersion((v) => v + 1)), [on]);
  useEffect(() => on("highlight", ({ units }) => setLit(new Set(units))), [on]);
  useEffect(() => on("prefs-changed", ({ prefs: next }) => setPrefs(next)), [on]);
  useEffect(() => void call("prefs.get", {}).then(setPrefs).catch(() => undefined), [call]); // Dropped: the settings above stand until the base says otherwise.
  const listed = useLoad(() => call("overview.list", {}).then(setRoots), [call, version]);
  useEffect(() => {
    if (start.locate) void call("overview.locate", { id: start.locate }).then((found) => found && setRef(found)).catch(report);
  }, [call, start.locate, report]);
  const current = ref ?? roots?.find((r) => r.holds > 0)?.ref ?? roots?.[0]?.ref ?? null;
  const opened = useLoad(async () => {
    if (!current) return;
    // The boundary panel follows what this tab shows. Dropped when it fails: that panel then keeps what it had, and this one is whole without it.
    void call("overview.focus.set", { ref: current }).catch(() => undefined);
    setView(await call("overview.get", { ref: current, stance: "lab" }));
  }, [call, current?.id, current?.level, version]);

  const go = useCallback(
    (next: WholeRef) => {
      if (current) setPast((list) => [...list.slice(-30), current]);
      setLit(new Set());
      setRef(next);
    },
    [current],
  );
  const showCanvas = useCallback(
    (id: string) => (onShowCanvas ? onShowCanvas(id) : void call("canvas.show", { id }).catch(report)),
    [call, onShowCanvas, report],
  );
  // A whole with a canvas opens there; one without stays here until someone makes one.
  const openInside = useCallback(
    async (next: WholeRef) => {
      try {
        const target = await call("overview.get", { ref: next, stance: "lab" });
        if (target.canvas.id) showCanvas(target.canvas.id);
        else go(next);
      } catch (error) {
        report(error);
      }
    },
    [call, go, showCanvas, report],
  );
  const pick = useCallback(
    (unit: string) => {
      setLit(new Set([unit]));
      void call("focus.set", { id: unit }).catch(report);
    },
    [call, report],
  );
  const makeCanvas = async () => {
    if (!current) return;
    try {
      const { id } = await call("overview.canvas", { ref: current });
      showCanvas(id);
    } catch (error) {
      report(error);
    }
  };

  if (listed.failed !== undefined) return <LoadProblem failed={listed.failed} again={listed.again} className="hv-error" />;
  if (opened.failed !== undefined) {
    return (
      <>
        <LoadProblem failed={opened.failed} again={opened.again} gone={goneOf("part of the graph")} className="hv-error" />
        {ref ? <p className="hv-pad"><button type="button" className="hv-link" onClick={() => setRef(null)}>Back to the workspace</button></p> : null}
      </>
    );
  }
  if (!roots) return <p className="hv-muted hv-pad">Reading the graph…</p>;
  if (!roots.length) return <p className="hv-muted hv-pad">No questions yet. A workspace's overview starts from its questions.</p>;
  if (!view) return <p className="hv-muted hv-pad">Opening…</p>;

  return (
    <div className="hv hv-explorer">
      <main className="hv-main">
        <header className="hv-head">
          <div className="hv-path-row">
            {past.length ? (
              <button
                type="button"
                className="hv-back"
                aria-label="Back"
                onClick={() => {
                  setRef(past[past.length - 1]!);
                  setPast((l) => l.slice(0, -1));
                }}
                data-dg="whole-back"
              >
                <Icon name="back" />
              </button>
            ) : null}
            <nav className="hv-path" aria-label="Where this sits">
              {view.path.map((p, i) => (
                <span key={p.ref.id}>
                  {i > 0 ? <span className="hv-sep" aria-hidden="true">/</span> : null}
                  {i < view.path.length - 1 ? (
                    <button type="button" className="hv-link" onClick={() => go(p.ref)}>{plain(p.title)}</button>
                  ) : (
                    <span aria-current="page">{LEVEL_WORD[p.ref.level]}</span>
                  )}
                </span>
              ))}
            </nav>
            {roots.length > 1 && view.ref.level === "lab" ? (
              <select className="hv-roots" value={view.ref.id} aria-label="Workspace" onChange={(e) => go({ level: "lab", id: e.target.value })}>
                {roots.map((r) => <option key={r.ref.id} value={r.ref.id}>{r.title}</option>)}
              </select>
            ) : null}
          </div>
          <div className="hv-title-row">
            <BaseChip base={view.base} label={view.label} />
            <h1 className="hv-title">{plain(view.title)}</h1>
          </div>
          {view.flags.length ? <div className="hv-flags">{view.flags.map((f) => <Flag key={f} name={f} />)}</div> : null}
          <Problem text={notice} dg="overview-problem" />
        </header>
        <section className="hv-canvas" aria-label="Laid out from the graph">
          <div className="hv-canvas-bar">
            <span className="hv-muted">
              {view.canvas.id ? <>Its canvas: <strong>{view.canvas.title}</strong></> : "No canvas yet: laid out from the graph by Logic"}
            </span>
            <span className="hv-actions">
              {lit.size ? <button type="button" onClick={() => setLit(new Set())}>Clear highlight</button> : null}
              {view.canvas.id ? (
                <button type="button" onClick={() => showCanvas(view.canvas.id!)} data-dg="open-whole-canvas"><Icon name="canvas" /> Open its canvas</button>
              ) : view.ref.level !== "lab" || view.parts.length ? (
                <button type="button" onClick={() => void makeCanvas()} data-dg="make-whole-canvas"><Icon name="canvas" /> Make it a canvas</button>
              ) : null}
              <button type="button" onClick={() => void call("panel.open", { surface: "boundary" }).catch(report)} data-dg="explorer-boundary">
                <Icon name="context" /> Boundary
              </button>
            </span>
          </div>
          <LaidOut
            key={`${view.ref.id}:${version}`}
            view={view}
            lit={lit}
            onPick={pick}
            onInside={(next) => void openInside(next)}
            onText={(unit) => void call("base.reveal", { id: unit, placement: "main" }).catch(report)}
          />
        </section>
        <section className="hv-parts" aria-label="Parts">
          <h2>{view.parts.length ? `Holds ${counted(view.parts.length, view.ref.level === "lab" ? "question" : "part")}` : "Holds nothing yet"}</h2>
          <ul>{view.parts.map((p) => <PartRow key={p.id} part={p} lit={lit.has(p.id)} onPick={pick} onOpen={(next) => void openInside(next)} />)}</ul>
          {view.behind.length ? (
            <>
              <h2>What stands behind it</h2>
              <ul>{view.behind.map((p) => <PartRow key={p.id} part={p} lit={lit.has(p.id)} onPick={pick} onOpen={(next) => void openInside(next)} />)}</ul>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
};
