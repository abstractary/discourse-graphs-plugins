import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";
import {
  canonicalJson,
  createNode,
  createNodeType,
  revise,
  type Author,
  type BaseNodeType,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type NodeRecord,
  type NodeTypeRecord,
  type OutputKind,
  type OutputLocator,
  type Pin,
  type ProvenanceLinks,
  type RelationTypeRecord,
  type RunStatus,
} from "@dg/contract/records.ts";

/**
 * The process layer: Protocol and Study are the logic, a Run is one execution,
 * Code is the plan in code form and an Output is what a run produced. These
 * functions read a folded graph and plan records; nothing here writes.
 */

type Stamp = { space: string; by: Author; at?: string; lab?: string };

const encoder = new TextEncoder();

/** CIDv1, raw codec, SHA-256: the form a file's bytes get on IPFS and in Logseq. */
export const cidOfBytes = async (bytes: Uint8Array): Promise<string> =>
  CID.createV1(raw.code, await sha256.digest(bytes)).toString();

export const cidOfText = (text: string): Promise<string> => cidOfBytes(encoder.encode(text));

/**
 * One version of a unit: its title, type, links and facts, without who edited
 * it or when. A run pins the protocol by this, so an edit that changes nothing
 * a reader would see doesn't count as drift.
 */
export const unitCid = (node: NodeRecord): Promise<string> =>
  cidOfText(canonicalJson({ title: node.title, type: node.type ?? null, prov: node.prov ?? {}, facts: node.facts ?? {} }));

// ---------------------------------------------------------------------------
// Types

/** Default labels. A lab can rename any of them; the base is what interoperates. */
export const PROCESS_TYPES: Record<
  "protocol" | "study" | "run" | "code" | "output",
  { label: string; abbreviation: string; color: string }
> = {
  protocol: { label: "Protocol", abbreviation: "PRO", color: "#8fbf6f" },
  study: { label: "Experiment", abbreviation: "EXP", color: "#d98ab0" },
  run: { label: "Run", abbreviation: "RUN", color: "#c9a0dc" },
  code: { label: "Code", abbreviation: "COD", color: "#7aa6c2" },
  output: { label: "Output", abbreviation: "OUT", color: "#c2a878" },
};

/** The space's type for each process base, creating the ones it lacks. */
export const ensureProcessTypes = ({
  nodeTypes,
  stamp,
  titleFormat = (abbreviation) => `${abbreviation} - {content}`,
}: {
  nodeTypes: NodeTypeRecord[];
  stamp: Stamp;
  titleFormat?: (abbreviation: string) => string;
}): { types: Record<keyof typeof PROCESS_TYPES, NodeTypeRecord>; created: NodeTypeRecord[] } => {
  const created: NodeTypeRecord[] = [];
  const entries = (Object.keys(PROCESS_TYPES) as (keyof typeof PROCESS_TYPES)[]).map((base) => {
    const found = nodeTypes.find((type) => type.base === base);
    if (found) return [base, found] as const;
    const spec = PROCESS_TYPES[base];
    const made = createNodeType({
      ...stamp,
      fields: { label: spec.label, base, abbreviation: spec.abbreviation, color: spec.color, titleFormat: titleFormat(spec.abbreviation) },
    });
    created.push(made);
    return [base, made] as const;
  });
  return { types: Object.fromEntries(entries) as Record<keyof typeof PROCESS_TYPES, NodeTypeRecord>, created };
};

export const baseOf = (graph: FoldedGraph, node: NodeRecord | undefined): BaseNodeType | undefined => {
  if (!node?.type) return undefined;
  const type = graph.documents.get(node.type);
  return type?.kind === "node-type" ? type.base : undefined;
};

const nodeIn = (graph: FoldedGraph, id: DgId | undefined): NodeRecord | undefined => {
  const record = id ? graph.documents.get(id) : undefined;
  return record?.kind === "node" && !record.removed && !graph.withdrawn.has(record.id) ? record : undefined;
};

// ---------------------------------------------------------------------------
// Notebooks

export type NotebookOutput = {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
};
export type NotebookCell = {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: NotebookOutput[];
  execution_count?: number | null;
};
export type Notebook = {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
};

const joined = (value: string | string[] | undefined): string => (Array.isArray(value) ? value.join("") : (value ?? ""));

/** The plan, outputs stripped: every cell's type and source, in order. */
export const notebookSourceCid = (notebook: Notebook): Promise<string> =>
  cidOfText(canonicalJson(notebook.cells.map((cell) => [cell.cell_type, joined(cell.source)])));

/** `#| label: fig-x`, as MyST and Quarto write it, or `# label: fig-x`. */
const labelOf = (cell: NotebookCell): string | undefined => {
  for (const line of joined(cell.source).split("\n").slice(0, 8)) {
    const match = /^#\|?\s*label:\s*(\S+)/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
};

const PREFERRED: { mime: string; kind: OutputKind }[] = [
  { mime: "image/png", kind: "figure" },
  { mime: "image/jpeg", kind: "figure" },
  { mime: "image/svg+xml", kind: "figure" },
  { mime: "text/csv", kind: "table" },
  { mime: "text/html", kind: "table" },
  { mime: "application/json", kind: "dataset" },
  { mime: "text/plain", kind: "text" },
];

const base64Bytes = (text: string): Uint8Array => {
  const clean = text.replace(/\s+/g, "");
  return Uint8Array.from(atob(clean), (char) => char.charCodeAt(0));
};

/** The bytes an output would have as its own file, and what kind of thing it is. */
const outputBytes = (
  output: NotebookOutput,
  { text }: { text: boolean },
): { mime: string; kind: OutputKind; bytes: Uint8Array } | null => {
  if (output.output_type === "stream" || output.output_type === "error") {
    if (!text || output.output_type === "error") return null;
    return { mime: "text/plain", kind: "text", bytes: encoder.encode(joined(output.text)) };
  }
  const data = output.data ?? {};
  for (const { mime, kind } of PREFERRED) {
    const value = data[mime];
    if (value === undefined) continue;
    if (mime === "text/html" && !/<table/i.test(joined(value as string | string[]))) continue;
    if (mime === "text/plain" && !text) continue;
    if (mime === "image/png" || mime === "image/jpeg") return { mime, kind, bytes: base64Bytes(joined(value as string | string[])) };
    if (mime === "application/json") return { mime, kind, bytes: encoder.encode(canonicalJson(value)) };
    return { mime, kind, bytes: encoder.encode(joined(value as string | string[])) };
  }
  return null;
};

export type NotebookImport = {
  /** Records to write: new or revised Code, a Run unless it's already here, its Outputs. */
  records: DgRecord[];
  code: NodeRecord;
  run: NodeRecord;
  outputs: NodeRecord[];
  /** True when this exact execution was imported before. */
  known: boolean;
};

const titleOf = (notebook: Notebook, path: string): string => {
  for (const cell of notebook.cells) {
    if (cell.cell_type !== "markdown") continue;
    const heading = /^#\s+(.+)$/m.exec(joined(cell.source));
    if (heading) return heading[1]!.trim();
  }
  return path.split("/").pop() ?? path;
};

/** Timings papermill or JupyterLab saved, when they did. */
const timesOf = (notebook: Notebook): { startedAt?: string; endedAt?: string } => {
  const papermill = notebook.metadata.papermill as { start_time?: string; end_time?: string } | undefined;
  if (papermill?.start_time) return { startedAt: papermill.start_time, ...(papermill.end_time ? { endedAt: papermill.end_time } : {}) };
  const stamps = notebook.cells.flatMap((cell) => {
    const execution = cell.metadata?.execution as Record<string, string> | undefined;
    return execution ? Object.values(execution).filter((value) => !Number.isNaN(Date.parse(value))) : [];
  });
  if (!stamps.length) return {};
  stamps.sort();
  return { startedAt: new Date(stamps[0]!).toISOString(), endedAt: new Date(stamps.at(-1)!).toISOString() };
};

/**
 * One saved notebook becomes three kinds of record:
 * - Code, identified by a hash of its sources alone;
 * - a Run, the saved execution, deduplicated by a fingerprint;
 * - one Output per saved figure or table, identified by a hash of its own bytes.
 * Cell ids, output positions and labels are kept as locators, never as identity.
 */
export const planNotebookImport = async ({
  notebook,
  path,
  repo,
  commit,
  graph,
  types,
  stamp,
  agents,
  text = false,
  partOf,
  follows,
}: {
  notebook: Notebook;
  path: string;
  repo?: string;
  commit?: string;
  graph: FoldedGraph;
  types: { code: NodeTypeRecord; run: NodeTypeRecord; output: NodeTypeRecord };
  stamp: Stamp;
  /** Who ran it, as DIDs or ORCID iDs. */
  agents?: string[];
  /** Also keep printed text and plain results as outputs. */
  text?: boolean;
  partOf?: DgId;
  follows?: Pin;
}): Promise<NotebookImport> => {
  const sourceCid = await notebookSourceCid(notebook);
  const language = (notebook.metadata.language_info as { name?: string; version?: string } | undefined) ?? {};
  const kernel = (notebook.metadata.kernelspec as { name?: string } | undefined)?.name;
  const nodes = [...graph.documents.values()].filter((record): record is NodeRecord => record.kind === "node");
  const records: DgRecord[] = [];

  // Code: the same repo and path is the same unit; changed sources are a new version of it.
  const facts = { ...(repo ? { repo } : {}), ...(commit ? { commit } : {}), path, sourceCid, ...(language.name ? { language: language.name } : {}) };
  // The same repo and path is the same unit. Failing that, the same sources are: a notebook read from a
  // repository and again from a copy in the base is one piece of code, not two.
  const existingCode =
    nodes.find((node) => node.type === types.code.id && node.facts?.path === path && node.facts?.repo === repo) ??
    nodes.find((node) => node.type === types.code.id && node.facts?.sourceCid === sourceCid);
  let code: NodeRecord;
  if (!existingCode) {
    code = createNode({ ...stamp, title: titleOf(notebook, path), type: types.code.id, facts: { ...facts, provenance: { method: "imported", agent: "nbformat import" } } });
    records.push(code);
  } else if (existingCode.facts?.sourceCid !== sourceCid) {
    code = revise({ record: existingCode, changes: { facts: { ...existingCode.facts, ...facts } }, by: stamp.by, ...(stamp.at ? { at: stamp.at } : {}) });
    records.push(code);
  } else {
    code = existingCode;
  }

  // Outputs, with their content hashes.
  type Found = { cid: string; mime: string; kind: OutputKind; size: number; locator: OutputLocator };
  const found: Found[] = [];
  let failed = false;
  let unexecuted = false;
  for (const [cellIndex, cell] of notebook.cells.entries()) {
    if (cell.cell_type !== "code") continue;
    if (cell.execution_count === null && joined(cell.source).trim()) unexecuted = true;
    const label = labelOf(cell);
    for (const [outputIndex, output] of (cell.outputs ?? []).entries()) {
      if (output.output_type === "error") failed = true;
      const bytes = outputBytes(output, { text });
      if (!bytes) continue;
      found.push({
        cid: await cidOfBytes(bytes.bytes),
        mime: bytes.mime,
        kind: bytes.kind,
        size: bytes.bytes.length,
        locator: {
          path,
          ...(commit ? { commit } : {}),
          ...(cell.id ? { cellId: cell.id } : {}),
          cellIndex,
          outputIndex,
          mime: bytes.mime,
          ...(label ? { label } : {}),
        },
      });
    }
  }

  const times = timesOf(notebook);
  const fingerprint = await cidOfText(canonicalJson({ sourceCid, outputs: found.map(({ cid }) => cid), times }));
  const existingRun = nodes.find((node) => node.type === types.run.id && node.facts?.fingerprint === fingerprint);
  const status: RunStatus = failed ? "failed" : unexecuted && !found.length ? "planned" : "completed";
  const run =
    existingRun ??
    createNode({
      ...stamp,
      title: `${titleOf(notebook, path)}, run of ${commit ? commit.slice(0, 7) : path}`,
      type: types.run.id,
      prov: {
        instrument: [{ uri: code.id, cid: sourceCid }],
        ...(partOf ? { partOf } : {}),
        ...(follows ? { follows } : {}),
      },
      facts: {
        status,
        fingerprint,
        ...times,
        ...(agents?.length ? { agents } : {}),
        environment: { ...(kernel ? { kernel } : {}), ...(language.name ? { language: language.name } : {}), ...(language.version ? { languageVersion: language.version } : {}) },
        provenance: { method: "imported", agent: "nbformat import" },
      },
    });
  if (!existingRun) records.push(run);

  const outputs: NodeRecord[] = [];
  const counts = new Map<OutputKind, number>();
  for (const item of found) {
    const same = nodes.find((node) => node.type === types.output.id && node.facts?.cid === item.cid && node.prov?.generatedBy === run.id);
    if (same) {
      outputs.push(same);
      continue;
    }
    const n = (counts.get(item.kind) ?? 0) + 1;
    counts.set(item.kind, n);
    const where = item.locator.label ?? `cell ${item.locator.cellIndex! + 1}`;
    const output = createNode({
      ...stamp,
      title: `${item.kind[0]!.toUpperCase()}${item.kind.slice(1)} ${n} of ${titleOf(notebook, path)} (${where})`,
      type: types.output.id,
      prov: { generatedBy: run.id },
      facts: { cid: item.cid, mediaType: item.mime, size: item.size, outputKind: item.kind, locator: item.locator, provenance: { method: "imported", agent: "nbformat import" } },
    });
    outputs.push(output);
    records.push(output);
  }

  return { records, code, run, outputs, known: Boolean(existingRun) };
};

// ---------------------------------------------------------------------------
// Chains and statuses

/**
 * A unit's provenance links, including older graphs that wrote them as
 * relation records (`derivedFrom`, `grounds`, `follows`, `describesActivity`).
 */
export const provenanceOf = (graph: FoldedGraph, id: DgId): ProvenanceLinks => {
  const node = nodeIn(graph, id);
  const prov: ProvenanceLinks = { ...(node?.prov ?? {}) };
  for (const { record, state } of graph.relations.values()) {
    if (state === "rejected" || state === "withdrawn") continue;
    const type = graph.documents.get(record.type) as RelationTypeRecord | undefined;
    const kind = type?.base;
    if (!kind) continue;
    const from = nodeIn(graph, record.source);
    const to = nodeIn(graph, record.target);
    const fromBase = baseOf(graph, from);
    const toBase = baseOf(graph, to);
    if (record.source === id) {
      if (kind === "derivedFrom" && fromBase === "evidence" && toBase === "source") prov.sourceDocument ??= record.target;
      if (kind === "derivedFrom" && fromBase === "evidence" && toBase === "run") prov.isGroundedIn ??= record.target;
      if (kind === "follows" && fromBase === "run" && toBase === "protocol") prov.follows ??= { uri: record.target };
      if (kind === "describesActivity" && fromBase === "source" && toBase === "run") {
        prov.describesActivity = [...new Set([...(prov.describesActivity ?? []), record.target])];
      }
    }
    if (record.target === id && kind === "grounds" && fromBase === "run" && toBase === "evidence") prov.isGroundedIn ??= record.source;
  }
  // Evidence read from a paper rests on that paper, whether or not the extraction drew the link.
  if (node?.source?.paper && baseOf(graph, node) === "evidence" && !prov.sourceDocument) {
    const own = paperSource(graph, node.source.paper);
    if (own) prov.sourceDocument = own;
  }
  return prov;
};

/** The source unit that stands for a paper itself, among the sources it cites. */
export const paperSource = (graph: FoldedGraph, paper: DgId): DgId | undefined => {
  let fallback: DgId | undefined;
  for (const record of graph.documents.values()) {
    if (record.kind !== "node" || record.removed || record.source?.paper !== paper || baseOf(graph, record) !== "source") continue;
    if (record.source.own) return record.id;
    fallback ??= record.id;
  }
  return fallback;
};

/** Every protocol a run followed. A lab's run pins one; a run a paper reports often names several methods. */
export const protocolsFollowed = (graph: FoldedGraph, run: DgId): Pin[] => {
  const node = nodeIn(graph, run);
  const pins: Pin[] = node?.prov?.follows ? [node.prov.follows] : [];
  for (const { record, state } of graph.relations.values()) {
    if (state === "rejected" || state === "withdrawn" || record.source !== run) continue;
    const type = graph.documents.get(record.type) as RelationTypeRecord | undefined;
    if (type?.base !== "follows" || baseOf(graph, nodeIn(graph, record.target)) !== "protocol") continue;
    if (!pins.some((pin) => pin.uri === record.target)) pins.push({ uri: record.target });
  }
  return pins;
};

export type Pinned = { id: DgId; pinned?: string; current?: string; changed: boolean; missing: boolean };

export type EvidenceChain = {
  evidence: DgId;
  outputs: Pinned[];
  run?: DgId;
  runStatus?: RunStatus;
  study?: DgId;
  question?: DgId;
  protocol?: Pinned;
  /** Every protocol the run followed, the pinned one first. */
  protocols: Pinned[];
  code: Pinned[];
  source?: DgId;
  /** Lab evidence with neither an output nor a run, and no source either. */
  ungrounded: boolean;
};

/** Content hashes for every protocol, so pins can be checked without awaiting. */
export const protocolCids = async (graph: FoldedGraph): Promise<Map<DgId, string>> => {
  const out = new Map<DgId, string>();
  for (const record of graph.documents.values()) {
    if (record.kind === "node" && baseOf(graph, record) === "protocol") out.set(record.id, await unitCid(record));
  }
  return out;
};

const check = (id: DgId, pinned: string | undefined, current: string | undefined, exists: boolean): Pinned => ({
  id,
  ...(pinned ? { pinned } : {}),
  ...(current ? { current } : {}),
  changed: Boolean(pinned && current && pinned !== current),
  missing: !exists,
});

/** Evidence, back to the output, the run, the code and protocol it used, and its source. */
export const evidenceChain = (graph: FoldedGraph, evidence: DgId, protocols: Map<DgId, string>): EvidenceChain => {
  const prov = provenanceOf(graph, evidence);
  const outputs = (prov.observationBase ?? []).map((pin) => {
    const output = nodeIn(graph, pin.uri);
    return check(pin.uri, pin.cid, output?.facts?.cid, Boolean(output));
  });
  let runId = prov.isGroundedIn;
  if (!runId) {
    for (const pin of prov.observationBase ?? []) {
      const generatedBy = nodeIn(graph, pin.uri)?.prov?.generatedBy;
      if (generatedBy) {
        runId = generatedBy;
        break;
      }
    }
  }
  const run = nodeIn(graph, runId);
  const runProv = run ? provenanceOf(graph, run.id) : {};
  const study = nodeIn(graph, runProv.partOf);
  const followed = (run ? protocolsFollowed(graph, run.id) : []).map((pin) => check(pin.uri, pin.cid, protocols.get(pin.uri), Boolean(nodeIn(graph, pin.uri))));
  const protocol = followed[0];
  const code = (runProv.instrument ?? []).map((pin) => {
    const record = nodeIn(graph, pin.uri);
    return check(pin.uri, pin.cid, record?.facts?.sourceCid, Boolean(record));
  });
  return {
    evidence,
    outputs,
    ...(run ? { run: run.id } : {}),
    ...(run?.facts?.status ? { runStatus: run.facts.status } : {}),
    ...(study ? { study: study.id } : {}),
    ...(study?.prov?.question ? { question: study.prov.question } : {}),
    ...(protocol ? { protocol } : {}),
    protocols: followed,
    code,
    ...(prov.sourceDocument ? { source: prov.sourceDocument } : {}),
    ungrounded: !outputs.length && !run && !prov.sourceDocument,
  };
};

export type ClaimSupport = {
  claim: DgId;
  supporting: EvidenceChain[];
  opposing: EvidenceChain[];
  /** Distinct runs behind the supporting evidence. */
  runs: DgId[];
  /** Distinct protocols those runs followed. */
  protocols: DgId[];
  flags: {
    /** All support comes from one run, whether a lab's or one a paper reports. */
    singleRun: boolean;
    /** Two or more runs of the same protocol each support it. */
    replicated: boolean;
    /** All support follows one protocol. */
    singleMethod: boolean;
    /** A protocol or code version changed after the run that made the evidence. */
    drift: boolean;
    /** An output no longer matches its pin, or is gone. */
    staleOutput: boolean;
    failedRuns: DgId[];
    ungrounded: DgId[];
  };
};

const argumentsInto = (graph: FoldedGraph, claim: DgId, base: "supports" | "opposes"): DgId[] =>
  [...graph.relations.values()]
    .filter(({ record, state }) => {
      if (state !== "active" || record.target !== claim) return false;
      const type = graph.documents.get(record.type) as RelationTypeRecord | undefined;
      return type?.base === base && baseOf(graph, nodeIn(graph, record.source)) === "evidence";
    })
    .map(({ record }) => record.source);

/** What stands behind a claim, as the replication and drift checks see it. */
export const claimSupport = (graph: FoldedGraph, claim: DgId, protocols: Map<DgId, string>): ClaimSupport => {
  const supporting = argumentsInto(graph, claim, "supports").map((id) => evidenceChain(graph, id, protocols));
  const opposing = argumentsInto(graph, claim, "opposes").map((id) => evidenceChain(graph, id, protocols));
  const runs = [...new Set(supporting.flatMap((chain) => (chain.run ? [chain.run] : [])))];
  const protocolIds = [...new Set(supporting.flatMap((chain) => chain.protocols.map((item) => item.id)))];
  const runsByProtocol = new Map<DgId, Set<DgId>>();
  for (const chain of supporting) {
    if (!chain.protocol || !chain.run) continue;
    const set = runsByProtocol.get(chain.protocol.id) ?? new Set();
    set.add(chain.run);
    runsByProtocol.set(chain.protocol.id, set);
  }
  const all = [...supporting, ...opposing];
  return {
    claim,
    supporting,
    opposing,
    runs,
    protocols: protocolIds,
    flags: {
      singleRun: supporting.length > 0 && supporting.every((chain) => chain.run) && runs.length === 1,
      replicated: [...runsByProtocol.values()].some((set) => set.size >= 2),
      singleMethod: protocolIds.length === 1 && supporting.length > 1,
      drift: all.some((chain) => chain.protocols.some((item) => item.changed) || chain.code.some((item) => item.changed)),
      staleOutput: all.some((chain) => chain.outputs.some((item) => item.changed || item.missing)),
      failedRuns: [...new Set(all.flatMap((chain) => (chain.runStatus === "failed" && chain.run ? [chain.run] : [])))],
      ungrounded: all.filter((chain) => chain.ungrounded).map((chain) => chain.evidence),
    },
  };
};
