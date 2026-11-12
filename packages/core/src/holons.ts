import {
  compareVersions,
  createCanvas,
  createCanvasItem,
  createRelease,
  foldRecords,
  revise,
  isCanvasEdge,
  liveCanvasItems,
  type Author,
  type CanvasItem,
  type CanvasItemRecord,
  type CanvasNode,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type LabRecord,
  type NodeRecord,
  type NodeTypeRecord,
  type Pin,
  type RelationRecord,
  type RelationTypeRecord,
  type ReleaseRecord,
} from "@dg/contract/records.ts";
import type {
  CanvasDiff,
  CanvasHolon,
  Credit,
  Crossing,
  Gap,
  HolonCanvas,
  HolonCanvasCard,
  HolonEdge,
  HolonEvent,
  HolonLevel,
  HolonPart,
  HolonRef,
  HolonView,
  Prefs,
  Privacy,
  ReleaseSummary,
  RepositoryCanvas,
  Stance,
} from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { baseOf, claimSupport, evidenceChain, protocolCids, unitCid } from "./process.ts";

/**
 * The argument holarchy. A lab holds questions; a question holds the claims
 * that address it and the evidence that informs it; a claim holds the evidence
 * and claims for and against it; evidence holds the outputs it rests on.
 * Containment isn't exclusive, so one claim can sit inside two questions.
 * Views only read: anything a person changes goes back as new records.
 */

const LEVEL_OF: Record<string, HolonLevel> = { question: "question", claim: "claim", evidence: "evidence", output: "output" };
const ARGUMENTS = new Set(["supports", "opposes", "addresses", "informs"]);
const SPACE = "space:";

type Argument = { record: RelationRecord; base: string; state: "active" | "pending" };

export type HolonInput = {
  graph: FoldedGraph;
  records: DgRecord[];
  me: Author;
  localSpace: string;
  protocols: Map<DgId, string>;
  credit?: (record: { by: Author; lab?: string }) => Credit;
};

/** The unit a text card stands for, if it stands for one. */
const unitOn = (item: CanvasItem): DgId | undefined =>
  !isCanvasEdge(item) && item.type === "text" ? item.dg?.node : undefined;
const canvasOn = (item: CanvasItem): DgId | undefined =>
  !isCanvasEdge(item) && item.type === "file" ? item.dg?.canvas : undefined;
const placeOf = (item: CanvasItem): string => (isCanvasEdge(item) ? "" : `${item.x},${item.y}`);

/** A laid-out card's height: its type line, the title at about 30 characters a line at 240 px, and its flags. */
const cardHeight = (title: string, flags: number): number => 40 + 19 * Math.ceil(title.length / 30) + (flags ? 26 : 0);
/** Cards are 240 px wide in every base, so three columns fit a 725 px frame. */
const CARD_WIDTH = 240;

export const holonIndex = (input: HolonInput, stance: Stance = "lab") => {
  const { graph, records, me, localSpace } = input;
  const nodes = [...graph.documents.values()].filter(
    (r): r is NodeRecord => r.kind === "node" && !r.removed && !graph.withdrawn.has(r.id),
  );
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const base = (id: DgId | undefined): string | undefined => baseOf(graph, id ? nodeById.get(id) : undefined);
  const typeOf = (node: NodeRecord): NodeTypeRecord | undefined => {
    const type = node.type ? graph.documents.get(node.type) : undefined;
    return type?.kind === "node-type" ? type : undefined;
  };
  const labs = [...graph.documents.values()].filter((r): r is LabRecord => r.kind === "lab");
  const labName = (did: string | undefined): string | undefined => labs.find((l) => l.did === did)?.name;
  const homeOf = (record: { lab?: string; space: string }): string => record.lab ?? `${SPACE}${record.space}`;
  const credit = input.credit ?? ((record) => ({ kind: "person" as const, id: record.by.id, name: record.by.name }));

  // Arguments under the chosen stance. Withdrawn and rejected ones never count.
  const argumentsList: Argument[] = [];
  for (const { record, state } of graph.relations.values()) {
    if (state === "withdrawn" || state === "rejected") continue;
    const relationBase = (graph.documents.get(record.type) as RelationTypeRecord | undefined)?.base;
    if (!relationBase || !ARGUMENTS.has(relationBase)) continue;
    if (!nodeById.has(record.source) || !nodeById.has(record.target)) continue;
    const target = nodeById.get(record.target)!;
    const counts =
      stance === "everyone" ||
      record.by.id === me.id ||
      (stance === "lab" && record.lab !== undefined && record.lab === target.lab) ||
      (stance === "lab" && state === "active" && record.space !== localSpace && record.lab === undefined && record.space === target.space);
    argumentsList.push({ record, base: relationBase, state: counts ? "active" : "pending" });
  }
  const active = argumentsList.filter((a) => a.state === "active");
  // The same graph, with each argument active or pending under this stance, so
  // claim support and gaps follow the stance rather than how the base folded it.
  const stanceGraph: FoldedGraph = {
    ...graph,
    relations: new Map(
      [...graph.relations].map(([id, entry]) => {
        const counted = argumentsList.find((a) => a.record.id === id);
        return [id, counted ? { record: entry.record, state: counted.state } : entry];
      }),
    ),
  };
  const into = (id: DgId, kinds: string[], list = active) => list.filter((a) => a.record.target === id && kinds.includes(a.base));
  const outOf = (id: DgId, kinds: string[], list = active) => list.filter((a) => a.record.source === id && kinds.includes(a.base));

  // Published releases make their pinned units public.
  const releases = [...graph.documents.values()].filter((r): r is ReleaseRecord => r.kind === "release" && !r.removed);
  const published = new Set(releases.filter((r) => r.published).flatMap((r) => r.units.map((u) => u.uri)));
  const privacyOf = (record: { id: DgId; lab?: string }): Privacy =>
    published.has(record.id) ? "published" : record.lab ? "lab" : "private";

  /** A MIRA request asks for work on a claim. It's a question by base, but not one of the lab's. */
  const isRequest = (node: NodeRecord): boolean =>
    typeOf(node)?.lexicon === "science.mira.request" ||
    [...graph.relations.values()].some(({ record }) => record.source === node.id && (graph.documents.get(record.type) as RelationTypeRecord | undefined)?.base === "requestTarget");

  const children = (ref: HolonRef): NodeRecord[] => {
    const pick = (ids: DgId[]) => [...new Set(ids)].map((id) => nodeById.get(id)!).filter(Boolean);
    switch (ref.level) {
      case "lab":
        return nodes.filter((n) => base(n.id) === "question" && homeOf(n) === ref.id && !isRequest(n));
      case "question":
        return pick([...into(ref.id, ["addresses"]).map((a) => a.record.source), ...into(ref.id, ["informs"]).map((a) => a.record.source)]);
      case "claim":
        return pick(into(ref.id, ["supports", "opposes"]).map((a) => a.record.source));
      case "evidence":
        return pick((nodeById.get(ref.id)?.prov?.observationBase ?? []).map((pin) => pin.uri).filter((id) => nodeById.has(id)));
      default:
        return [];
    }
  };

  const refOf = (node: NodeRecord): HolonRef | undefined => {
    const level = LEVEL_OF[base(node.id) ?? ""];
    return level ? { level, id: node.id } : undefined;
  };

  const parents = (ref: HolonRef): { ref: HolonRef; title: string }[] => {
    const holon = (n: NodeRecord) => ({ ref: refOf(n)!, title: n.title });
    switch (ref.level) {
      case "question": {
        const node = nodeById.get(ref.id);
        if (!node) return [];
        const home = homeOf(node);
        return [{ ref: { level: "lab", id: home }, title: rootTitle(home) }];
      }
      case "claim":
        return outOf(ref.id, ["addresses"]).map((a) => holon(nodeById.get(a.record.target)!));
      case "evidence":
        return [...outOf(ref.id, ["supports", "opposes"]), ...outOf(ref.id, ["informs"])]
          .map((a) => nodeById.get(a.record.target)!)
          .filter((n) => refOf(n))
          .map(holon);
      case "output": {
        const output = nodeById.get(ref.id);
        return nodes
          .filter((n) => (n.prov?.observationBase ?? []).some((pin) => pin.uri === ref.id || (output?.facts?.cid && pin.cid === output.facts.cid)))
          .map(holon);
      }
      default:
        return [];
    }
  };

  const rootTitle = (id: string): string =>
    id.startsWith(SPACE) ? (id.slice(SPACE.length) === localSpace ? "My space" : `Space ${id.slice(SPACE.length, SPACE.length + 8)}`) : (labName(id) ?? id);

  const titleOf = (ref: HolonRef): string => (ref.level === "lab" ? rootTitle(ref.id) : (nodeById.get(ref.id)?.title ?? ref.id));

  const pathTo = (ref: HolonRef): { ref: HolonRef; title: string }[] => {
    const path: { ref: HolonRef; title: string }[] = [];
    let current: HolonRef | undefined = ref;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift({ ref: current, title: titleOf(current) });
      current = parents(current)[0]?.ref;
    }
    return path;
  };

  const flagsOf = (node: NodeRecord): string[] => {
    const b = base(node.id);
    if (b === "claim") {
      const support = claimSupport(stanceGraph, node.id, input.protocols);
      const flags: string[] = [];
      if (!support.supporting.length) flags.push("unsupported");
      if (support.flags.singleRun) flags.push("single run");
      if (support.flags.replicated) flags.push("replicated");
      if (support.opposing.length) flags.push("contested");
      if (support.flags.drift) flags.push("drift");
      if (support.flags.staleOutput) flags.push("stale output");
      if (support.flags.failedRuns.length) flags.push("failed run");
      return flags;
    }
    if (b === "evidence") {
      const chain = evidenceChain(stanceGraph, node.id, input.protocols);
      const flags: string[] = [];
      if (chain.ungrounded) flags.push("ungrounded");
      if (chain.protocol?.changed || chain.code.some((c) => c.changed)) flags.push("drift");
      if (chain.outputs.some((o) => o.changed || o.missing)) flags.push("stale output");
      if (chain.runStatus === "failed") flags.push("failed run");
      return flags;
    }
    return [];
  };

  const part = (node: NodeRecord): HolonPart => {
    const ref = refOf(node);
    return {
      id: node.id,
      title: node.title,
      base: base(node.id) ?? "none",
      label: typeOf(node)?.label ?? "Untyped",
      credit: credit(node),
      privacy: privacyOf(node),
      ...(ref ? { ref, holds: children(ref).length } : {}),
      flags: flagsOf(node),
    };
  };

  return {
    graph: stanceGraph,
    nodes, nodeById, base, typeOf, labs, homeOf, rootTitle, titleOf, credit, privacyOf, releases,
    argumentsList, active, into, outOf, children, refOf, parents, pathTo, part, flagsOf,
  };
};

type Index = ReturnType<typeof holonIndex>;

/** What stands behind evidence or an output: the run, its study, protocol, code, and the source. */
const behindOf = (input: HolonInput, index: Index, ref: HolonRef): NodeRecord[] => {
  const ids: DgId[] = [];
  if (ref.level === "evidence") {
    const chain = evidenceChain(input.graph, ref.id, input.protocols);
    if (chain.run) ids.push(chain.run);
    if (chain.study) ids.push(chain.study);
    if (chain.protocol) ids.push(chain.protocol.id);
    ids.push(...chain.code.map((c) => c.id));
    if (chain.source) ids.push(chain.source);
  }
  if (ref.level === "output") {
    const output = index.nodeById.get(ref.id);
    const cid = output?.facts?.cid;
    const twins = index.nodes.filter((n) => n.id !== ref.id && cid && n.facts?.cid === cid);
    for (const n of [output, ...twins]) {
      if (n && n !== output) ids.push(n.id);
      const run = n?.prov?.generatedBy;
      if (run) {
        ids.push(run);
        const runNode = index.nodeById.get(run);
        if (runNode?.prov?.follows) ids.push(runNode.prov.follows.uri);
        ids.push(...(runNode?.prov?.instrument ?? []).map((pin) => pin.uri));
      }
    }
  }
  return [...new Set(ids)].map((id) => index.nodeById.get(id)!).filter(Boolean);
};

const edgesAmong = (index: Index, ids: Set<DgId>): HolonEdge[] => {
  const edges: HolonEdge[] = [];
  for (const a of index.argumentsList) {
    if (ids.has(a.record.source) && ids.has(a.record.target)) {
      edges.push({ id: a.record.id, from: a.record.source, to: a.record.target, kind: a.base, state: a.state, by: a.record.by.name });
    }
  }
  const field = (from: DgId, to: DgId | undefined, kind: string) => {
    if (to && ids.has(from) && ids.has(to)) edges.push({ id: `${from}>${kind}>${to}`, from, to, kind, state: "field" });
  };
  for (const id of ids) {
    const n = index.nodeById.get(id);
    if (!n?.prov) continue;
    for (const pin of n.prov.observationBase ?? []) field(id, pin.uri, "observationBase");
    field(id, n.prov.isGroundedIn, "isGroundedIn");
    field(id, n.prov.sourceDocument, "sourceDocument");
    field(id, n.prov.generatedBy, "generatedBy");
    field(id, n.prov.partOf, "partOf");
    field(id, n.prov.follows?.uri, "follows");
    for (const pin of n.prov.instrument ?? []) field(id, pin.uri, "instrument");
  }
  return edges;
};

const gapsOf = (input: HolonInput, index: Index, ref: HolonRef, parts: NodeRecord[]): Gap[] => {
  const gaps = new Map<string, Gap>();
  const add = (rule: string, severity: Gap["severity"], message: string, unit: DgId) => {
    const gap = gaps.get(rule) ?? { rule, severity, message, units: [] };
    if (!gap.units.includes(unit)) gap.units.push(unit);
    gaps.set(rule, gap);
  };
  const claims = ref.level === "claim" ? [index.nodeById.get(ref.id)!] : parts.filter((p) => index.base(p.id) === "claim");
  const evidence =
    ref.level === "evidence" ? [index.nodeById.get(ref.id)!] : ref.level === "claim" ? parts.filter((p) => index.base(p.id) === "evidence") : [];
  if (ref.level === "lab") {
    for (const q of parts) if (!index.children({ level: "question", id: q.id }).length) add("open", "warning", "Questions no claim addresses yet", q.id);
    const unfiled = index.nodes.filter((n) => index.base(n.id) === "claim" && index.homeOf(n) === ref.id && !index.outOf(n.id, ["addresses"]).length);
    for (const c of unfiled) add("unfiled", "warning", "Claims that address no question", c.id);
    for (const q of parts) for (const c of index.children({ level: "question", id: q.id })) claims.push(c);
  }
  for (const claim of claims) {
    if (!claim) continue;
    const support = claimSupport(index.graph, claim.id, input.protocols);
    if (!support.supporting.length) add("unsupported", "warning", "Claims nothing supports yet", claim.id);
    if (support.flags.singleRun) add("single-run", "warning", "Claims that rest on a single run", claim.id);
    if (support.flags.drift) add("drift", "warning", "The protocol or code changed after the run behind the evidence", claim.id);
    if (support.flags.staleOutput) add("stale", "warning", "An output no longer matches what the evidence pinned", claim.id);
    for (const run of support.flags.failedRuns) add("failed", "warning", "Evidence from a failed run", run);
    for (const id of support.flags.ungrounded) add("ungrounded", "warning", "Evidence with nothing behind it", id);
    if (!input.graph.documents.size || ![...input.graph.documents.values()].some((r) => r.kind === "evaluation" && r.target === claim.id && !r.removed)) {
      add("unreviewed", "warning", "Claims no one has evaluated", claim.id);
    }
  }
  for (const e of evidence) {
    if (!e) continue;
    const chain = evidenceChain(index.graph, e.id, input.protocols);
    if (chain.ungrounded) add("ungrounded", "warning", "Evidence with nothing behind it", e.id);
    for (const pin of e.prov?.observationBase ?? []) if (!pin.cid) add("unpinned", "warning", "Evidence cites an output without pinning its bytes", e.id);
    if (chain.run && !chain.study) add("no-study", "warning", "A run that belongs to no study", chain.run);
    for (const code of chain.code) if (!code.pinned) add("unpinned-code", "warning", "A run's code isn't pinned to a version", chain.run!);
    if (chain.protocol?.changed || chain.code.some((c) => c.changed)) add("drift", "warning", "The protocol or code changed after the run", e.id);
  }
  if (ref.level === "output") {
    const output = index.nodeById.get(ref.id);
    if (output && !output.prov?.generatedBy) add("orphan", "violation", "An output that no run produced", output.id);
  }
  const pending = index.argumentsList.filter((a) => a.state === "pending" && (a.record.target === ref.id || parts.some((p) => p.id === a.record.target)));
  for (const a of pending) add("pending", "warning", "Arguments waiting for someone to accept them", a.record.source);
  return [...gaps.values()];
};

const crossingsOf = (index: Index, ref: HolonRef, parts: NodeRecord[], behind: NodeRecord[]): Crossing[] => {
  const crossings: Crossing[] = [];
  const holonNode = index.nodeById.get(ref.id);
  const home = ref.level === "lab" ? ref.id : holonNode ? index.homeOf(holonNode) : undefined;
  const as = (n: NodeRecord) => ({ id: n.id, title: n.title, base: index.base(n.id) ?? "none" });
  for (const n of [...parts, ...behind]) {
    if (home && index.homeOf(n) !== home) crossings.push({ ...as(n), direction: "in", why: `From ${index.rootTitle(index.homeOf(n))}` });
  }
  for (const n of [...(holonNode ? [holonNode] : []), ...parts]) {
    const source = n.prov?.sourceDocument ? index.nodeById.get(n.prov.sourceDocument) : undefined;
    if (source && index.base(n.id) === "evidence") crossings.push({ ...as(n), direction: "in", why: `Reported in ${source.title}` });
  }
  for (const a of index.argumentsList) {
    if (a.state !== "pending") continue;
    if (a.record.target === ref.id || parts.some((p) => p.id === a.record.target)) {
      const from = index.nodeById.get(a.record.source);
      if (from) crossings.push({ ...as(from), direction: "in", why: `Proposed by ${a.record.by.name}, not yet counted` });
    }
  }
  if (ref.level === "output" && holonNode?.facts?.cid) {
    for (const twin of behind.filter((b) => b.id !== ref.id && b.facts?.cid === holonNode.facts!.cid)) {
      crossings.push({ ...as(twin), direction: "in", why: "The same bytes, made by another run" });
    }
  }
  for (const n of parts) {
    const elsewhere = index.parents(index.refOf(n) ?? { level: "output", id: n.id }).filter((p) => p.ref.id !== ref.id);
    for (const other of elsewhere) crossings.push({ ...as(n), direction: "out", why: `Also in ${other.title}`, other });
    if (index.privacyOf(n) === "published") crossings.push({ ...as(n), direction: "out", why: "Published in a release" });
  }
  return crossings;
};

/** A saved canvas for the holon, or one laid out in columns from the graph. */
const canvasFor = (input: HolonInput, index: Index, ref: HolonRef, parts: NodeRecord[], behind: NodeRecord[], edges: HolonEdge[]): HolonCanvas => {
  const own = [...input.graph.documents.values()]
    .filter((r): r is CanvasRecord => r.kind === "canvas" && !r.removed && r.holon === ref.id)
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
  const others = own.slice(1).map((c) => ({ id: c.id, title: c.title }));
  if (own[0]) return { ...cardsOf(input.graph, own[0].id), others };

  const focus = index.nodeById.get(ref.id);
  const byBase = (bases: string[]) => parts.filter((p) => bases.includes(index.base(p.id) ?? ""));
  const opposing = new Set(index.into(ref.id, ["opposes"]).map((a) => a.record.source));
  const columns: NodeRecord[][] =
    ref.level === "lab"
      ? [parts]
      : ref.level === "question"
        ? [[focus!], byBase(["claim"]), byBase(["evidence"])]
        : ref.level === "claim"
          ? [parts.filter((p) => !opposing.has(p.id)), [focus!], parts.filter((p) => opposing.has(p.id))]
          : [
              [focus!],
              parts,
              behind.filter((b) => ["run", "source", "output"].includes(index.base(b.id) ?? "")),
              behind.filter((b) => !["run", "source", "output"].includes(index.base(b.id) ?? "")),
            ];
  const cards: HolonCanvasCard[] = [];
  columns.forEach((column, x) => {
    let y = 0;
    for (const n of column.filter(Boolean)) {
      if (cards.some((c) => c.unit === n.id)) continue;
      const height = cardHeight(n.title, index.flagsOf(n).length);
      cards.push({ id: n.id, unit: n.id, text: n.title, x: x * (CARD_WIDTH + 96), y, width: CARD_WIDTH, height });
      y += height + 28;
    }
  });
  const onCanvas = new Set(cards.map((c) => c.id));
  const links = edges
    .filter((e) => onCanvas.has(e.from) && onCanvas.has(e.to))
    .map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.kind, ...(e.state !== "field" ? { relation: e.id } : {}) }));
  return { id: null, title: `${index.titleOf(ref)}`, cards, links, others };
};

const cardsOf = (graph: FoldedGraph, canvasId: DgId): Omit<HolonCanvas, "others"> => {
  const canvas = graph.documents.get(canvasId) as CanvasRecord;
  const items = liveCanvasItems({ graph, canvas: canvasId }).map((r) => r.item);
  const cards: HolonCanvasCard[] = items
    .filter((i): i is CanvasNode => !isCanvasEdge(i) && i.type !== "stroke" && (i as CanvasNode).type !== "group")
    .map((i) => ({
      id: i.id,
      ...(i.type === "text" && i.dg?.node ? { unit: i.dg.node } : {}),
      ...(i.type === "file" && i.dg?.canvas ? { canvas: i.dg.canvas } : {}),
      text: i.type === "text" ? i.text : i.type === "file" ? ((i.dg?.canvas && (graph.documents.get(i.dg.canvas) as CanvasRecord | undefined)?.title) || i.file) : i.type === "link" ? i.url : "",
      x: i.x, y: i.y, width: i.width, height: i.height,
    }));
  const ids = new Set(cards.map((c) => c.id));
  const links = items
    .filter(isCanvasEdge)
    .filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
    .map((e) => ({ id: e.id, from: e.fromNode, to: e.toNode, ...(e.label ? { label: e.label } : {}), ...(e.dg?.relation ? { relation: e.dg.relation } : {}) }));
  return { id: canvasId, title: canvas?.title ?? "Canvas", cards, links };
};

const describe = (record: DgRecord, index: Index): string => {
  const verb = "rev" in record && record.rev > 1 ? "Edited" : "Created";
  switch (record.kind) {
    case "node": return `${verb} ${index.typeOf(record)?.label ?? "unit"}: ${record.title}`;
    case "relation": return `Linked ${(index.argumentsList.find((a) => a.record.id === record.id)?.base) ?? "a relation"}`;
    case "canvas": return `${verb} canvas ${record.title}`;
    case "canvas-item": return record.rev > 1 ? "Moved or edited a card" : "Placed a card";
    case "release": return `Released ${record.name}`;
    case "evaluation": return `Evaluated (${record.method})`;
    default: return `${verb} ${record.kind}`;
  }
};

const editedAt = (r: DgRecord): string => ("editedAt" in r ? r.editedAt : r.at);

export const holonView = (input: HolonInput, ref: HolonRef, stance: Stance): HolonView => {
  const index = holonIndex(input, stance);
  const parts = index.children(ref);
  const behind = behindOf(input, index, ref);
  const ids = new Set([...(ref.level === "lab" ? [] : [ref.id]), ...parts.map((p) => p.id), ...behind.map((b) => b.id)]);
  const edges = edgesAmong(index, ids);
  const focus = index.nodeById.get(ref.id);
  const privacy = { private: 0, lab: 0, published: 0 } as Record<Privacy, number>;
  for (const p of parts) privacy[index.privacyOf(p)] += 1;
  const unpublished = privacy.private + privacy.lab;
  const relevant = index.argumentsList.filter((a) => a.record.target === ref.id || parts.some((p) => p.id === a.record.target));
  const canvas = canvasFor(input, index, ref, parts, behind, edges);
  const canvasItems = canvas.id ? new Set(liveCanvasItems({ graph: input.graph, canvas: canvas.id }).map((r) => r.id)) : new Set<DgId>();
  const historyIds = new Set([...ids, ...relevant.map((a) => a.record.id), ...(canvas.id ? [canvas.id, ...canvasItems] : [])]);
  const history: HolonEvent[] = input.records
    .filter((r) => historyIds.has(r.id) || (r.kind === "release" && r.canvas === canvas.id))
    .sort((a, b) => editedAt(b).localeCompare(editedAt(a)))
    .slice(0, 40)
    .map((r) => ({ at: editedAt(r), by: ("editedBy" in r ? r.editedBy : r.by).name, what: describe(r, index), ...(r.kind === "node" ? { unit: r.id } : {}) }));
  const crossings = crossingsOf(index, ref, parts, behind);
  const gaps = gapsOf(input, index, ref, parts);
  const names: HolonView["names"] = {};
  const cardUnits = canvasFor(input, index, ref, parts, behind, edgesAmong(index, ids)).cards.flatMap((c) => c.unit ?? []);
  for (const id of new Set([...gaps.flatMap((g) => g.units), ...crossings.map((c) => c.id), ...parts.map((p) => p.id), ...behind.map((b) => b.id), ...cardUnits])) {
    const n = index.nodeById.get(id);
    if (!n) continue;
    const nRef = index.refOf(n);
    names[id] = { title: n.title, base: index.base(id) ?? "none", label: index.typeOf(n)?.label ?? "Unit", ...(nRef ? { ref: nRef } : {}) };
  }
  return {
    ref,
    names,
    flags: focus ? index.flagsOf(focus) : [],
    title: index.titleOf(ref),
    label: ref.level === "lab" ? "Lab" : focus ? (index.typeOf(focus)?.label ?? "Unit") : ref.level,
    base: ref.level === "lab" ? "lab" : (index.base(ref.id) ?? ref.level),
    path: index.pathTo(ref),
    within: index.parents(ref),
    parts: parts.map(index.part),
    behind: behind.map(index.part),
    edges,
    boundary: {
      crossings,
      gaps,
      privacy: {
        counts: privacy,
        next: unpublished
          ? `Publishing a release of this holon would make ${unpublished} ${unpublished === 1 ? "unit" : "units"} public under ${[...new Set(parts.map((p) => p.by.id))].length} authors' DIDs.`
          : parts.length ? "Everything here is already published." : "Nothing here yet.",
      },
      stance: {
        stance,
        active: relevant.filter((a) => a.state === "active").length,
        pending: relevant.filter((a) => a.state === "pending").length,
        pendingBy: [...new Set(relevant.filter((a) => a.state === "pending").map((a) => a.record.by.name))],
      },
    },
    canvas,
    history,
  };
};

/** The holon a unit opens as. Process units open as the first evidence they stand behind. */
export const locateHolon = (input: HolonInput, id: DgId): HolonRef | null => {
  const index = holonIndex(input);
  const node = index.nodeById.get(id);
  if (!node) return index.labs.some((l) => l.did === id) ? { level: "lab", id } : null;
  const own = index.refOf(node);
  if (own) return own;
  for (const evidence of index.nodes.filter((n) => index.base(n.id) === "evidence")) {
    const chain = evidenceChain(input.graph, evidence.id, input.protocols);
    const behind = [chain.run, chain.study, chain.protocol?.id, chain.source, ...chain.code.map((c) => c.id)];
    if (behind.includes(id)) return { level: "evidence", id: evidence.id };
  }
  return null;
};

export const holonRoots = (input: HolonInput): { ref: HolonRef; title: string; holds: number }[] => {
  const index = holonIndex(input);
  const homes = new Set(index.nodes.filter((n) => index.base(n.id) === "question").map(index.homeOf));
  return [...homes].map((id) => ({ ref: { level: "lab" as const, id }, title: index.rootTitle(id), holds: index.children({ level: "lab", id }).length }));
};

const releaseSummary = (r: ReleaseRecord): ReleaseSummary => ({
  id: r.id, canvas: r.canvas, name: r.name, ...(r.note ? { note: r.note } : {}), at: r.at, by: r.by.name, units: r.units.length, published: Boolean(r.published),
});

export const repository = (input: HolonInput): RepositoryCanvas[] => {
  const index = holonIndex(input);
  const canvases = [...input.graph.documents.values()].filter((r): r is CanvasRecord => r.kind === "canvas" && !r.removed);
  const papers = [...input.graph.documents.values()].filter((r): r is Extract<DgRecord, { kind: "paper" }> => r.kind === "paper" && !("removed" in r && r.removed));
  const releasesOf = (id: DgId) => index.releases.filter((r) => r.canvas === id).sort((a, b) => a.at.localeCompare(b.at));
  const embeds = (id: DgId) => liveCanvasItems({ graph: input.graph, canvas: id }).flatMap((r) => canvasOn(r.item) ?? []);
  return canvases
    .map((canvas) => {
      const items = liveCanvasItems({ graph: input.graph, canvas: canvas.id });
      const itemIds = new Set(items.map((i) => i.id));
      const units = items.flatMap((i) => unitOn(i.item) ?? []);
      const byBase: Record<string, number> = {};
      for (const u of units) {
        const b = index.base(u) ?? "none";
        byBase[b] = (byBase[b] ?? 0) + 1;
      }
      const flagged = units.filter((u) => {
        const n = index.nodeById.get(u);
        return n && index.flagsOf(n).some((f) => f !== "replicated");
      });
      const paper = papers.find((item) => item.canvas === canvas.id);
      // The picture is the canvas itself: every card at its own place and size, capped so a huge canvas stays light.
      const laid = cardsOf(input.graph, canvas.id);
      const drawn = laid.cards.slice(0, 160);
      const left = Math.min(0, ...drawn.map((card) => card.x));
      const top = Math.min(0, ...drawn.map((card) => card.y));
      const at = new Map(drawn.map((card, position) => [card.id, position]));
      const thumb = {
        width: Math.max(1, ...drawn.map((card) => card.x + card.width - left)),
        height: Math.max(1, ...drawn.map((card) => card.y + card.height - top)),
        cards: drawn.map((card) => ({
          x: Math.round(card.x - left),
          y: Math.round(card.y - top),
          w: Math.round(card.width),
          h: Math.round(card.height),
          base: card.canvas ? "canvas" : ((card.unit && index.base(card.unit)) ?? "none"),
        })),
        links: laid.links.flatMap((link): [number, number][] => (at.has(link.from) && at.has(link.to) ? [[at.get(link.from)!, at.get(link.to)!]] : [])),
      };
      const labDid = canvas.shared ?? canvas.lab;
      const labName = labDid ? index.labs.find((lab) => lab.did === labDid)?.name : undefined;
      const releases = releasesOf(canvas.id);
      const forkSource = canvas.forkOf ? index.releases.find((r) => r.id === canvas.forkOf!.uri) : undefined;
      const sourceCanvas = forkSource ? (input.graph.documents.get(forkSource.canvas) as CanvasRecord | undefined) : undefined;
      const holonNode = canvas.holon ? index.nodeById.get(canvas.holon) : undefined;
      const holonRef = holonNode ? index.refOf(holonNode) : canvas.holon && index.labs.some((l) => l.did === canvas.holon) ? ({ level: "lab", id: canvas.holon } as HolonRef) : undefined;
      return {
        id: canvas.id,
        title: canvas.title,
        ...(holonRef ? { holon: { ref: holonRef, title: index.titleOf(holonRef) } } : {}),
        cards: items.filter((i) => !isCanvasEdge(i.item)).length,
        links: items.filter((i) => isCanvasEdge(i.item)).length,
        units: byBase,
        people: [...new Set([canvas, ...items].map((r) => r.editedBy.name))],
        editedAt: [canvas, ...items].map((r) => r.editedAt).sort().at(-1)!,
        edits: input.records.filter((r) => r.id === canvas.id || itemIds.has(r.id) || (r.kind === "canvas-item" && r.canvas === canvas.id)).length,
        releases: releases.map(releaseSummary),
        ...(forkSource && sourceCanvas ? { forkOf: { id: sourceCanvas.id, title: sourceCanvas.title, release: forkSource.name } } : {}),
        forks: canvases.filter((c) => c.forkOf && releases.some((r) => r.id === c.forkOf!.uri)).length,
        nested: embeds(canvas.id),
        nestedIn: canvases.filter((c) => embeds(c.id).includes(canvas.id)).map((c) => c.id),
        gaps: flagged.length,
        privacy: releases.some((r) => r.published) ? "published" : canvas.shared || canvas.lab ? "lab" : "private",
        kind: paper ? "paper" : "workspace",
        ...(paper ? { paper: paper.title } : {}),
        by: canvas.by.name,
        mine: canvas.by.id === input.me.id,
        ...(labDid ? { lab: labName ?? "A lab" } : {}),
        thumb,
      } satisfies RepositoryCanvas;
    })
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
};

/** The canvas as it stood at a moment: every record up to then, folded. */
export const canvasAt = (input: HolonInput, id: DgId, at: string): HolonCanvas => {
  const upTo = input.records.filter((r) => editedAt(r) <= at);
  const graph = foldRecords({ records: upTo, localSpace: input.localSpace });
  if (!graph.documents.has(id)) return { id, title: "Not yet made", cards: [], links: [], others: [] };
  return { ...cardsOf(graph, id), others: [] };
};

export const canvasHistory = (input: HolonInput, id: DgId): { events: HolonEvent[]; releases: ReleaseSummary[] } => {
  const index = holonIndex(input);
  const events = input.records
    .filter((r) => r.id === id || (r.kind === "canvas-item" && r.canvas === id) || (r.kind === "release" && r.canvas === id))
    .sort((a, b) => editedAt(a).localeCompare(editedAt(b)))
    .map((r) => ({ at: editedAt(r), by: ("editedBy" in r ? r.editedBy : r.by).name, what: describe(r, index) }));
  return { events, releases: index.releases.filter((r) => r.canvas === id).sort((a, b) => a.at.localeCompare(b.at)).map(releaseSummary) };
};

type Stamp = { space: string; by: Author; at?: string; lab?: string };

/** Pins every card's unit and every item's revision, so the release stays fixed. */
export const planRelease = async (input: HolonInput, id: DgId, name: string, note: string | undefined, stamp: Stamp): Promise<ReleaseRecord> => {
  const items = liveCanvasItems({ graph: input.graph, canvas: id });
  const units = [...new Set(items.flatMap((i) => unitOn(i.item) ?? []))];
  const pins: Pin[] = [];
  for (const unit of units) {
    const node = input.graph.documents.get(unit);
    if (node?.kind === "node") pins.push({ uri: unit, cid: await unitCid(node) });
  }
  const parent = [...input.graph.documents.values()]
    .filter((r): r is ReleaseRecord => r.kind === "release" && r.canvas === id)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const canvas = input.graph.documents.get(id) as CanvasRecord | undefined;
  return createRelease({
    ...stamp,
    ...(canvas?.lab ? { lab: canvas.lab } : {}),
    fields: { canvas: id, name, ...(note ? { note } : {}), ...(parent ? { parent: parent.id } : {}), items: items.map((i) => ({ id: i.id, rev: i.rev })), units: pins },
  });
};

/** The item versions a release names, read from the log. */
const releasedItems = (input: HolonInput, release: ReleaseRecord): CanvasItemRecord[] =>
  release.items.flatMap(({ id, rev }) => {
    const found = input.records.find((r): r is CanvasItemRecord => r.kind === "canvas-item" && r.id === id && r.rev === rev);
    return found ? [found] : [];
  });

/** A new canvas that starts from a release, keeping where every card was. */
export const planFork = (input: HolonInput, releaseId: DgId, title: string | undefined, stamp: Stamp): DgRecord[] => {
  const release = input.graph.documents.get(releaseId) as ReleaseRecord;
  const source = input.graph.documents.get(release.canvas) as CanvasRecord;
  const canvas = createCanvas({
    ...stamp,
    title: title ?? `${source.title} (fork of ${release.name})`,
    fields: { forkOf: { uri: release.id }, ...(source.holon ? { holon: source.holon } : {}) },
  });
  const items = releasedItems(input, release);
  const renamed = new Map<DgId, DgId>();
  const out: DgRecord[] = [canvas];
  for (const record of items.filter((r) => !isCanvasEdge(r.item))) {
    const { id: _id, ...item } = record.item;
    const copy = createCanvasItem({ ...stamp, canvas: canvas.id, z: record.z, item: item as never });
    renamed.set(record.id, copy.id);
    out.push(copy);
  }
  for (const record of items.filter((r) => isCanvasEdge(r.item))) {
    const edge = record.item as CanvasItem & { fromNode: string; toNode: string };
    const fromNode = renamed.get(edge.fromNode);
    const toNode = renamed.get(edge.toNode);
    if (!fromNode || !toNode) continue;
    const { id: _id, ...rest } = edge;
    out.push(createCanvasItem({ ...stamp, canvas: canvas.id, z: record.z, item: { ...rest, fromNode, toNode } as never }));
  }
  return out;
};

type Side = { units: Map<DgId, string | undefined>; places: Map<DgId, string> };

const sideOf = async (input: HolonInput, canvas: DgId, which: DgId | "now"): Promise<Side> => {
  const units = new Map<DgId, string | undefined>();
  const places = new Map<DgId, string>();
  if (which === "now") {
    for (const r of liveCanvasItems({ graph: input.graph, canvas })) {
      const unit = unitOn(r.item);
      if (!unit) continue;
      const node = input.graph.documents.get(unit);
      units.set(unit, node?.kind === "node" ? await unitCid(node) : undefined);
      places.set(unit, placeOf(r.item));
    }
    return { units, places };
  }
  const release = input.graph.documents.get(which) as ReleaseRecord;
  for (const pin of release.units) units.set(pin.uri, pin.cid);
  for (const r of releasedItems(input, release)) {
    const unit = unitOn(r.item);
    if (unit) places.set(unit, placeOf(r.item));
  }
  return { units, places };
};

export const diffCanvas = async (input: HolonInput, canvas: DgId, from: DgId | "now", to: DgId | "now"): Promise<CanvasDiff> => {
  const a = await sideOf(input, canvas, from);
  const b = await sideOf(input, canvas, to);
  const title = (unit: DgId) => (input.graph.documents.get(unit) as NodeRecord | undefined)?.title ?? unit;
  const name = (side: DgId | "now") => (side === "now" ? "now" : ((input.graph.documents.get(side) as ReleaseRecord | undefined)?.name ?? side));
  return {
    from: name(from),
    to: name(to),
    added: [...b.units.keys()].filter((u) => !a.units.has(u)).map((unit) => ({ unit, title: title(unit) })),
    removed: [...a.units.keys()].filter((u) => !b.units.has(u)).map((unit) => ({ unit, title: title(unit) })),
    changed: [...b.units.keys()].filter((u) => a.units.has(u) && a.units.get(u) !== b.units.get(u)).map((unit) => ({ unit, title: title(unit) })),
    moved: [...b.places.keys()].filter((u) => a.places.has(u) && a.places.get(u) !== b.places.get(u)).map((unit) => ({ unit, title: title(unit) })),
  };
};

/** Saves the laid-out canvas of a holon as an authored one. */
export const planHolonCanvas = (input: HolonInput, ref: HolonRef, stamp: Stamp): DgRecord[] => {
  const view = holonView(input, ref, "lab");
  // Placed by a tool, so the canvas tab tidies it the first time it opens.
  const canvas = createCanvas({ ...stamp, title: view.title, fields: { holon: ref.id, needsLayout: true } });
  const out: DgRecord[] = [canvas];
  const items = new Map<string, DgId>();
  let z = 1;
  for (const card of view.canvas.cards) {
    const item = createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { type: "text", text: card.text, x: card.x, y: card.y, width: card.width, height: card.height, ...(card.unit ? { dg: { node: card.unit } } : {}) } });
    items.set(card.id, item.id);
    out.push(item);
  }
  for (const link of view.canvas.links) {
    const fromNode = items.get(link.from);
    const toNode = items.get(link.to);
    if (fromNode && toNode) {
      out.push(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { fromNode, toNode, toEnd: "arrow", ...(link.label ? { label: link.label } : {}), ...(link.relation && !link.relation.includes(">") ? { dg: { relation: link.relation } } : {}) } }));
    }
  }
  return out;
};

/** Where a canvas sits in the holarchy, and what it could be tied to. */
export const canvasHolon = (input: HolonInput, id: DgId): CanvasHolon => {
  const index = holonIndex(input);
  const canvas = input.graph.documents.get(id) as CanvasRecord | undefined;
  const holonId = canvas?.holon;
  const node = holonId ? index.nodeById.get(holonId) : undefined;
  const ref: HolonRef | null = node ? (index.refOf(node) ?? null) : holonId && index.labs.some((l) => l.did === holonId) ? { level: "lab", id: holonId } : null;
  const onCanvas = liveCanvasItems({ graph: input.graph, canvas: id }).flatMap((r) => unitOn(r.item) ?? []);
  const units = [...new Set(onCanvas)].flatMap((u) => {
    const n = index.nodeById.get(u);
    const r = n ? index.refOf(n) : undefined;
    return r && n ? [{ ref: r, title: n.title, order: ["question", "claim", "evidence", "output"].indexOf(r.level) }] : [];
  });
  units.sort((a, b) => a.order - b.order);
  const labs = [...new Set(onCanvas.flatMap((u) => { const n = index.nodeById.get(u); return n?.lab ? [n.lab] : []; }))]
    .map((did) => ({ ref: { level: "lab" as const, id: did }, title: index.rootTitle(did) }));
  return { ref, path: ref ? index.pathTo(ref) : [], candidates: [...labs, ...units.map(({ ref: r, title }) => ({ ref: r, title }))] };
};

/** The holon's newest canvas, if it has one. */
export const canvasOfHolon = (input: HolonInput, holon: string): DgId | null =>
  [...input.graph.documents.values()]
    .filter((r): r is CanvasRecord => r.kind === "canvas" && !r.removed && r.holon === holon)
    .sort((a, b) => b.editedAt.localeCompare(a.editedAt))[0]?.id ?? null;

export const DEFAULT_PREFS: Prefs = { holonGesture: "button", linkDelete: "ask", captureKey: "\\", notebookText: false };
const PREFS_KEY = "prefs";

const latest = (records: DgRecord[]): DgRecord[] => {
  const winners = new Map<DgId, DgRecord>();
  for (const r of records) {
    const current = winners.get(r.id);
    if (!current || compareVersions(r, current) > 0) winners.set(r.id, r);
  }
  return [...winners.values()];
};

/** The holon handlers every base gets through its core, and the hooks core calls. */
export const holonFeature = (context: Context) => {
  const input = async (): Promise<HolonInput> => {
    const graph = context.graph();
    return { graph, records: context.records(), me: context.me(), localSpace: context.localSpace, protocols: await protocolCids(graph), credit: context.creditFor };
  };
  // The holon in focus, which the boundary panel follows.
  let focus: { ref: HolonRef | null; canvas: DgId | null } = { ref: null, canvas: null };
  const setFocus = (next: { ref: HolonRef | null; canvas: DgId | null }) => {
    if (next.ref?.id === focus.ref?.id && next.ref?.level === focus.ref?.level && next.canvas === focus.canvas) return;
    focus = next;
    context.send({ event: "holon-focus-changed", ...focus });
  };
  const focusCanvas = async (canvas: DgId) => setFocus({ ref: canvasHolon(await input(), canvas).ref, canvas });
  /** A note was opened: its unit's holon comes into focus, unless it has none. */
  const followNote = async (node: DgId) => {
    const ref = locateHolon(await input(), node);
    if (ref) setFocus({ ref, canvas: null });
  };
  const holonCanvas = async (ref: HolonRef): Promise<{ id: DgId; made: boolean }> => {
    const known = canvasOfHolon(await input(), ref.id);
    if (known) return { id: known, made: false };
    const records = planHolonCanvas(await input(), ref, context.stamp());
    await context.put(records);
    return { id: records[0]!.id, made: true };
  };
  const prefs = async (): Promise<Prefs> => {
    const stored = await context.getLocal(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(stored && typeof stored === "object" ? (stored as Partial<Prefs>) : {}) };
  };
  const setPrefs = async (changes: Partial<Prefs>): Promise<Prefs> => {
    const next = { ...(await prefs()), ...changes };
    await context.setLocal(PREFS_KEY, next);
    context.send({ event: "prefs-changed", prefs: next });
    return next;
  };
  const handlers: Pick<
    Handlers,
    | "holon.view" | "holon.locate" | "holon.roots" | "holon.focus.get" | "holon.focus.set" | "holon.ofCanvas" | "holon.canvas"
    | "repository.canvases" | "canvas.at" | "canvas.history" | "canvas.saveHolon" | "canvas.release" | "canvas.fork" | "canvas.diff"
    | "canvas.setHolon" | "canvas.highlight" | "prefs.get" | "prefs.set"
  > = {
    "holon.view": async ({ ref, stance }) => holonView(await input(), ref, stance),
    "holon.roots": async () => holonRoots(await input()),
    "holon.locate": async ({ id }) => locateHolon(await input(), id),
    "holon.focus.get": async () => focus,
    "holon.focus.set": async ({ canvas, ref }) => {
      if (canvas) await focusCanvas(canvas);
      else if (ref) setFocus({ ref, canvas: null });
      return null;
    },
    "holon.ofCanvas": async ({ id }) => canvasHolon(await input(), id),
    "holon.canvas": async ({ ref }) => holonCanvas(ref),
    "repository.canvases": async () => repository(await input()),
    "canvas.at": async ({ id, at }) => canvasAt(await input(), id, at),
    "canvas.history": async ({ id }) => canvasHistory(await input(), id),
    "canvas.saveHolon": async ({ ref }) => ({ id: (await holonCanvas(ref)).id }),
    "canvas.release": async ({ id, name, note }) => {
      const release = await planRelease(await input(), id, name, note, context.stamp());
      await context.put([release]);
      return releaseSummary(release);
    },
    "canvas.fork": async ({ release, title }) => {
      const records = planFork(await input(), release, title, context.stamp());
      await context.put(latest(records));
      return { id: records[0]!.id };
    },
    "canvas.diff": async ({ canvas, from, to }) => diffCanvas(await input(), canvas, from, to),
    "canvas.setHolon": async ({ id, holon }) => {
      const canvas = context.graph().documents.get(id) as CanvasRecord | undefined;
      if (!canvas) return null;
      const { holon: _old, ...rest } = canvas;
      const changed = revise({ record: holon ? { ...canvas, holon } : (rest as CanvasRecord), changes: {}, by: context.me() });
      await context.put([changed]);
      if (focus.canvas === id) await focusCanvas(id);
      return null;
    },
    "canvas.highlight": async ({ units }) => {
      context.send({ event: "highlight", units });
      return null;
    },
    "prefs.get": async () => prefs(),
    "prefs.set": async (changes) => setPrefs(changes),
  };
  return { handlers, followNote, focusCanvas, holonCanvas, prefs, setPrefs, locate: async (id: DgId) => locateHolon(await input(), id) };
};
