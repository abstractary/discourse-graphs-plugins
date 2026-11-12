// Builds the worked example: a real lab analysis and a real paper, recorded end
// to end in the process ontology. Run from the repository root:
//   node examples/worked-example/build.ts
// MATSULAB_REPO points at a checkout of DiscourseGraphs/MATSUlab-issue-exchange-analysis
// (CC BY 4.0); it defaults to ../org-repos/MATSUlab-issue-exchange-analysis.
// Every hash is computed from the real files. Ids and times are fixed, so the
// output is the same on every run.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertRelation,
  createCanvas,
  createCanvasItem,
  createLab,
  createNode,
  createNodeType,
  createPaper,
  createRelationType,
  createSnapshot,
  defaultGrammar,
  foldRecords,
  validateRecord,
  type Author,
  type DgId,
  type DgRecord,
  type JsonObject,
  type NodeRecord,
  type NodeTypeRecord,
  type OutputKind,
  type Pin,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import {
  cidOfBytes,
  claimSupport,
  ensureProcessTypes,
  planNotebookImport,
  protocolCids,
  unitCid,
  type Notebook,
} from "@dg/core/process.ts";
import { toProcessJsonLd } from "@dg/core/jsonld.ts";

const OUT = "examples/worked-example";
const REPO = process.env.MATSULAB_REPO ?? "../org-repos/MATSUlab-issue-exchange-analysis";
const REPO_URL = "https://github.com/DiscourseGraphs/MATSUlab-issue-exchange-analysis";
const COMMIT = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const blob = (path: string): string => `${REPO_URL}/blob/${COMMIT}/${path}`;

// ---------------------------------------------------------------------------
// Fixed ids: a TID is microseconds and a clock id in base32-sortable.

const SORTABLE = "234567abcdefghijklmnopqrstuvwxyz";
let counter = 0;
const nextTid = (): string => {
  let value = (BigInt(Date.UTC(2026, 1, 14) * 1000 + counter++) << 10n) | 7n;
  let out = "";
  for (let i = 0; i < 13; i += 1) {
    out = SORTABLE[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
};
/** Swaps every random id in a batch for a fixed one, references included. */
const stable = <T extends DgRecord>(batch: T[]): T[] => {
  let text = JSON.stringify(batch);
  for (const record of batch) {
    const did = record.id.slice(0, record.id.lastIndexOf("#"));
    text = text.split(record.id).join(`${did}#${nextTid()}`);
  }
  return JSON.parse(text) as T[];
};
const one = <T extends DgRecord>(record: T): T => stable([record])[0]!;

const records: DgRecord[] = [];
const keep = <T extends DgRecord>(record: T): T => {
  records.push(record);
  return record;
};

// ---------------------------------------------------------------------------
// People and grammar

const matt: Author = { id: "did:web:records.example", name: "Matt Akamatsu" };
const reader: Author = { id: "did:web:reader.example", name: "Demo reader" };
const MATT_ORCID = "https://orcid.org/0000-0002-0286-5310";
const LAB = "did:web:lab.records.example";
const labStamp = { space: "matsulab", by: matt, at: "2026-02-14T00:00:00.000Z", lab: LAB };
// The reader is a lab member reading a paper for the lab, so the lab's view trusts their links.
const readerStamp = { space: "reading", by: reader, at: "2026-11-06T00:00:00.000Z", lab: LAB };

keep(one(createLab({ ...labStamp, name: "Akamatsu Lab", did: LAB, custodian: matt.id, custodianKey: "example-key-not-real", plc: [] })));

const grammar = stable(defaultGrammar(labStamp));
grammar.forEach(keep);
const nodeTypes = grammar.filter((r): r is NodeTypeRecord => r.kind === "node-type");
const relationTypes = grammar.filter((r): r is RelationTypeRecord => r.kind === "relation-type");
const processTypes = ensureProcessTypes({ nodeTypes, stamp: labStamp });
const madeTypes = stable(processTypes.created);
madeTypes.forEach(keep);
const T = Object.fromEntries(madeTypes.map((t) => [t.base, t])) as Record<"protocol" | "study" | "run" | "code" | "output", NodeTypeRecord>;
const type = (base: string): NodeTypeRecord => nodeTypes.find((t) => t.base === base) ?? T[base as keyof typeof T];
const requestType = keep(one(createNodeType({ ...labStamp, fields: { label: "Request", base: "question", abbreviation: "REQ", lexicon: "science.mira.request", titleFormat: "REQ - {content}" } })));
const relation = (base: string): RelationTypeRecord => relationTypes.find((t) => t.base === base)!;
const asksAbout = keep(one(createRelationType({ ...labStamp, fields: { label: "Asks about", complement: "Asked about by", base: "requestTarget", rules: [] } })));

const node = (stamp: typeof labStamp | typeof readerStamp, fields: Omit<Parameters<typeof createNode>[0], "space" | "by">): NodeRecord =>
  keep(one(createNode({ ...stamp, ...fields })));
const relate = (stamp: typeof labStamp | typeof readerStamp, base: string | RelationTypeRecord, source: DgId, target: DgId) =>
  keep(one(assertRelation({ ...stamp, type: typeof base === "string" ? relation(base).id : base.id, source, target })));
const snapshot = (stamp: typeof labStamp | typeof readerStamp, of: NodeRecord, body: string | undefined) => {
  if (body?.trim()) keep(one(createSnapshot({ ...stamp, node: of.id, body })));
};

// ---------------------------------------------------------------------------
// Part 1. The MATSUlab issue-exchange analysis: a lab result, from question to bytes.

const question = node(labStamp, {
  title: "How does a shared issue board shape idea exchange, knowledge production and onboarding in a research lab?",
  type: type("question").id,
  facts: { provenance: { method: "authored", agent: "Paraphrased from the repository README" } },
});
const narrative = node(labStamp, {
  title: "Narrative post describing the MATSUlab discourse graph analysis",
  type: type("source").id,
  facts: { sameAs: ["https://experiment.com/u/Hd2AYg"] },
});

const readJson = (path: string) => JSON.parse(readFileSync(join(REPO, path), "utf8"));

/** One Code unit per script, identified by the hash of its bytes at this commit. */
const scripts = new Map<string, NodeRecord>();
const codeFor = async (path: string, description: string): Promise<NodeRecord> => {
  const known = scripts.get(path);
  if (known) return known;
  const code = node(labStamp, {
    title: `${path.split("/").pop()}: ${description}`,
    type: T.code.id,
    facts: { repo: REPO_URL, commit: COMMIT, path, sourceCid: await cidOfBytes(readFileSync(join(REPO, path))), language: "python", license: "CC-BY-4.0" },
  });
  scripts.set(path, code);
  return code;
};

const MEDIA: Record<string, { mime: string; kind: OutputKind }> = {
  png: { mime: "image/png", kind: "figure" },
  gif: { mime: "image/gif", kind: "figure" },
  json: { mime: "application/json", kind: "dataset" },
  csv: { mime: "text/csv", kind: "table" },
};

const BUNDLES = [
  { dir: "evd1-conversion-rate", fixture: "evd1-conversion-rate.json", study: "claiming" },
  { dir: "evd5-issue-funnel", fixture: "evd5-issue-funnel.json", study: "claiming" },
  { dir: "evd6-time-to-result", fixture: "evd6-time-to-result.json", study: "claiming" },
  { dir: "evd7-student-onboarding", fixture: "evd7-student-onboarding.json", study: "onboarding" },
] as const;

type Bundle = { evidence: NodeRecord; claim: NodeRecord; run: NodeRecord; protocol: NodeRecord; outputs: NodeRecord[]; code: NodeRecord[] };
const bundles: Bundle[] = [];
const studies = new Map<string, NodeRecord>();
const protocolsByStudy = new Map<string, DgId[]>();

// The studies and protocols are named in each bundle's MIRA metadata.
const metadata = BUNDLES.map((b) => {
  const graph = readJson(`output/evidence_bundles/${b.dir}/evidence.jsonld`)["@graph"] as Record<string, unknown>[];
  const byType = (t: string) => graph.find((item) => item["@type"] === t)!;
  return { ...b, graph, studyNode: byType("Study"), protocolNode: byType("Protocol"), claimNode: byType("Claim") };
});
for (const m of metadata) {
  const title = String(m.studyNode.title);
  if (!studies.has(m.study)) {
    studies.set(m.study, node(labStamp, {
      title: title.replace(/^@analysis\//, ""),
      type: T.study.id,
      prov: { question: question.id },
      facts: { seeAlso: [`${blob(`output/evidence_bundles/${m.dir}/README.md`)}`], conditions: ["Discourse graph exports of 11 and 13 February 2026"] },
    }));
  }
}

for (const m of metadata) {
  const study = studies.get(m.study)!;
  const codeItems = m.graph.filter((item) => String(item["@type"]).includes("SoftwareSourceCode"));
  const code = await Promise.all(codeItems.map((item) => codeFor(String(item["@id"]).split("/blob/main/")[1]!, String(item.title))));
  const protocol = node(labStamp, {
    title: String(m.protocolNode.title),
    type: T.protocol.id,
    prov: { implementedBy: code.map((c) => c.id) },
    facts: { version: COMMIT.slice(0, 7) },
  });
  protocolsByStudy.set(m.study, [...(protocolsByStudy.get(m.study) ?? []), protocol.id]);
  const follows: Pin = { uri: protocol.id, cid: await unitCid(protocol) };
  const run = node(labStamp, {
    title: `${protocol.title}, run at ${COMMIT.slice(0, 7)}`,
    type: T.run.id,
    prov: { partOf: study.id, follows, instrument: code.map((c) => ({ uri: c.id, cid: c.facts!.sourceCid! })) },
    facts: { status: "completed", agents: [MATT_ORCID], seeAlso: [blob(`output/evidence_bundles/${m.dir}/README.md`)] },
  });
  const files = [
    ...readdirSync(join(REPO, "output/evidence_bundles", m.dir)).filter((f) => /\.(png|gif)$/.test(f)).map((f) => `output/evidence_bundles/${m.dir}/${f}`),
    ...readdirSync(join(REPO, "output/evidence_bundles", m.dir, "data")).filter((f) => /\.(json|csv)$/.test(f)).map((f) => `output/evidence_bundles/${m.dir}/data/${f}`),
  ].sort();
  const outputs: NodeRecord[] = [];
  for (const path of files) {
    const bytes = readFileSync(join(REPO, path));
    const media = MEDIA[path.split(".").pop()!]!;
    outputs.push(node(labStamp, {
      title: path.split("/").pop()!,
      type: T.output.id,
      prov: { generatedBy: run.id },
      facts: { cid: await cidOfBytes(bytes), uri: blob(path), mediaType: media.mime, size: bytes.length, outputKind: media.kind, locator: { path, commit: COMMIT } },
    }));
  }
  const fixture = JSON.parse(readFileSync(`test/fixtures/matsulab-records/${m.fixture}`, "utf8"))[0].value as Record<string, unknown>;
  const figures = outputs.filter((o) => o.facts?.outputKind === "figure");
  const evidence = node(labStamp, {
    title: String(fixture.title).replace(/^\[\[RES\]\] - /, "").replace(/ - \[\[@[^\]]+\]\]$/, ""),
    type: type("evidence").id,
    prov: {
      observationBase: [...figures, ...outputs.filter((o) => o.facts?.outputKind !== "figure")].map((o) => ({ uri: o.id, cid: o.facts!.cid! })),
      isGroundedIn: run.id,
      sourceDocument: narrative.id,
    },
    facts: { provenance: { method: "aiAssisted", agent: "Claude (Anthropic), with Matt Akamatsu", reviewedBy: ["https://orcid.org/0000-0003-3000-4160"] } },
  });
  snapshot(labStamp, evidence, String(fixture.content ?? ""));
  const claim = node(labStamp, { title: String(m.claimNode.title), type: type("claim").id });
  relate(labStamp, "supports", evidence.id, claim.id);
  relate(labStamp, "addresses", claim.id, question.id);
  bundles.push({ evidence, claim, run, protocol, outputs, code });
}

// The studies list their protocols once all are known.
for (const [key, study] of studies) {
  const index = records.indexOf(study);
  records[index] = { ...study, prov: { ...study.prov, protocols: protocolsByStudy.get(key) } } as NodeRecord;
  studies.set(key, records[index] as NodeRecord);
}

// The pre-executed notebook: Code, a Run and its Outputs, by the same import a lab member would use.
const notebook = readJson("notebooks/evd1_evd7_analysis.ipynb") as Notebook;
const before = foldRecords({ records, localSpace: "matsulab" });
const imported = await planNotebookImport({
  notebook,
  path: "notebooks/evd1_evd7_analysis.ipynb",
  repo: REPO_URL,
  commit: COMMIT,
  graph: before,
  types: { code: T.code, run: T.run, output: T.output },
  stamp: labStamp,
  agents: [MATT_ORCID],
  partOf: studies.get("claiming")!.id,
});
const importedRecords = stable(imported.records);
importedRecords.forEach(keep);
const renamed = new Map(imported.records.map((r, i) => [r.id, importedRecords[i]!.id]));
const fresh = (record: NodeRecord): NodeRecord => records.find((r) => r.id === (renamed.get(record.id) ?? record.id)) as NodeRecord;
const notebookRun = fresh(imported.run);
const notebookCode = fresh(imported.code);
const notebookOutputs = imported.outputs.map(fresh);

// ---------------------------------------------------------------------------
// Part 2. A real paper: Lu et al. 2016, J Autoimmun 74:182-193, from the demo's
// MIRA extraction. The paper's study becomes a Run it reports; its grounds,
// follows and describesActivity links become provenance fields.

const paper = JSON.parse(readFileSync("demo/papers/preclinical-sle-mediators.graph.json", "utf8")) as {
  paper: { title: string; doi: string; authors: { name: string }[] };
  models?: Record<string, string>;
  nodes: { id: string; type: string; text: string; description?: string; anchor?: string }[];
  edges: { relation: string; subject: string; object: string; anchor?: string }[];
};
const byId = new Map(paper.nodes.map((n) => [n.id, n]));
const edgesOf = (relation: string) => paper.edges.filter((e) => e.relation === relation);
const made = new Map<string, NodeRecord>();
const BASES: Record<string, NodeTypeRecord> = {
  Question: type("question"), Claim: type("claim"), Evidence: type("evidence"), SourceDocument: type("source"),
  Protocol: T.protocol, Study: T.run, Request: requestType,
};
const source = paper.nodes.find((n) => n.type === "SourceDocument")!;
const make = (n: (typeof paper.nodes)[number], extra: Partial<Pick<NodeRecord, "prov" | "facts">> = {}) => {
  const record = node(readerStamp, {
    title: n.text,
    type: BASES[n.type]!.id,
    ...extra,
    facts: { ...(extra.facts ?? {}), provenance: { method: "aiGenerated", agent: "MIRA extraction app (demo replay)" } },
  });
  snapshot(readerStamp, record, [n.description, n.anchor ? `> ${n.anchor}` : ""].filter(Boolean).join("\n\n"));
  made.set(n.id, record);
  return record;
};
for (const n of paper.nodes.filter((n) => n.type === "Protocol")) make(n);
for (const n of paper.nodes.filter((n) => n.type === "Study")) {
  const followed = edgesOf("follows").find((e) => e.subject === n.id);
  const protocol = followed ? made.get(followed.object) : undefined;
  make(n, { prov: protocol ? { follows: { uri: protocol.id, cid: await unitCid(protocol) } } : {}, facts: { status: "completed" } });
}
make(source, {
  prov: { describesActivity: edgesOf("describesActivity").map((e) => made.get(e.object)!.id) },
  facts: { doi: paper.paper.doi },
});
for (const n of paper.nodes.filter((n) => ["Question", "Claim", "Request"].includes(n.type))) make(n);
for (const n of paper.nodes.filter((n) => n.type === "Evidence")) {
  const grounded = edgesOf("grounds").find((e) => e.object === n.id);
  make(n, {
    prov: { ...(grounded ? { isGroundedIn: made.get(grounded.subject)!.id } : {}), sourceDocument: made.get(source.id)!.id },
    facts: { anchor: { source: `https://doi.org/${paper.paper.doi}`, ...(n.anchor ? { exact: n.anchor } : {}) } },
  });
}
for (const e of paper.edges) {
  const from = made.get(e.subject)!.id;
  const to = made.get(e.object)!.id;
  if (e.relation === "supports" || e.relation === "addresses") relate(readerStamp, e.relation, from, to);
  if (e.relation === "request_target") relate(readerStamp, asksAbout, from, to);
}

// ---------------------------------------------------------------------------
// Canvases: one per holon a person would arrange, to feed the repository view.

const heightOf = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));
const canvasOf = (
  stamp: typeof labStamp | typeof readerStamp,
  title: string,
  columns: NodeRecord[][],
  links: { from: DgId; to: DgId; label: string; relation?: DgId }[],
  fields?: Parameters<typeof createCanvas>[0]["fields"],
  nested: { canvas: { id: DgId; title: string }; beside: DgId }[] = [],
) => {
  const canvas = keep(one(createCanvas({ ...stamp, title, ...(fields ? { fields } : {}) })));
  const cards = new Map<DgId, DgId>();
  let z = 1;
  columns.forEach((column, x) => {
    let y = 0;
    for (const unit of column) {
      const card = keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { type: "text", text: unit.title, x: x * 340, y, width: 280, height: heightOf(unit.title), dg: { node: unit.id } } })));
      cards.set(unit.id, card.id);
      y += heightOf(unit.title) + 40;
    }
  });
  for (const link of links) {
    const fromNode = cards.get(link.from);
    const toNode = cards.get(link.to);
    if (fromNode && toNode) keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { fromNode, toNode, toEnd: "arrow", label: link.label, ...(link.relation ? { dg: { relation: link.relation } } : {}) } })));
  }
  // A canvas inside this one, as a file node beside the unit it opens up. Obsidian draws it as that canvas.
  for (const { canvas: inner, beside } of nested) {
    const card = records.find((r) => r.id === cards.get(beside));
    const at = card && card.kind === "canvas-item" && "x" in card.item ? card.item : { x: 0, y: 0, width: 280, height: 80 };
    const embed = keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { type: "file", file: `discourse-graph/canvases/${inner.title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()}.canvas`, x: at.x + 340, y: at.y, width: 360, height: 240, dg: { canvas: inner.id } } })));
    keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { fromNode: cards.get(beside)!, toNode: embed.id, toEnd: "arrow", label: "Opens into" } })));
  }
  return canvas;
};
const relationsNow = () => records.filter((r) => r.kind === "relation");
const relationFor = (from: DgId, to: DgId) => relationsNow().find((r) => r.kind === "relation" && r.source === from && r.target === to)?.id;

const evd7 = bundles[3]!;

const sameBytes = notebookOutputs.find((o) => evd7.outputs.some((p) => p.facts?.cid === o.facts?.cid));
const evd7Canvas = canvasOf(labStamp, "EVD 7: from claim to the notebook", [
  [evd7.claim],
  [evd7.evidence],
  [...evd7.outputs.filter((o) => o.facts?.outputKind === "figure"), ...(sameBytes ? [sameBytes] : [])],
  [evd7.run, ...(sameBytes ? [notebookRun] : [])],
  [evd7.protocol, ...evd7.code, notebookCode],
], [
  { from: evd7.evidence.id, to: evd7.claim.id, label: "Supports", relation: relationFor(evd7.evidence.id, evd7.claim.id) },
  ...evd7.outputs.filter((o) => o.facts?.outputKind === "figure").map((o) => ({ from: evd7.evidence.id, to: o.id, label: "Observation base" })),
  ...evd7.outputs.filter((o) => o.facts?.outputKind === "figure").map((o) => ({ from: o.id, to: evd7.run.id, label: "Generated by" })),
  { from: evd7.run.id, to: evd7.protocol.id, label: "Follows" },
  ...evd7.code.map((c) => ({ from: evd7.run.id, to: c.id, label: "Instrument" })),
  ...(sameBytes ? [{ from: sameBytes.id, to: notebookRun.id, label: "Generated by" }, { from: notebookRun.id, to: notebookCode.id, label: "Instrument" }] : []),
], { holon: evd7.claim.id });
canvasOf(labStamp, "Issue exchange: what the analysis shows", [
  [question],
  bundles.map((b) => b.claim),
  bundles.map((b) => b.evidence),
  bundles.map((b) => b.run),
], [
  ...bundles.map((b) => ({ from: b.claim.id, to: question.id, label: "Addresses", relation: relationFor(b.claim.id, question.id) })),
  ...bundles.map((b) => ({ from: b.evidence.id, to: b.claim.id, label: "Supports", relation: relationFor(b.evidence.id, b.claim.id) })),
  ...bundles.map((b) => ({ from: b.evidence.id, to: b.run.id, label: "Grounded in" })),
], { holon: question.id }, [{ canvas: evd7Canvas, beside: evd7.run.id }]);

const paperCanvas = canvasOf(readerStamp, "Preclinical SLE mediators (Lu et al. 2016)", [
  paper.nodes.filter((n) => n.type === "Question" || n.type === "Request").map((n) => made.get(n.id)!),
  paper.nodes.filter((n) => n.type === "Claim").map((n) => made.get(n.id)!),
  paper.nodes.filter((n) => n.type === "Evidence").map((n) => made.get(n.id)!),
  [...paper.nodes.filter((n) => n.type === "Study" || n.type === "Protocol" || n.type === "SourceDocument").map((n) => made.get(n.id)!)],
], paper.edges.flatMap((e) => {
  const from = made.get(e.subject)!.id;
  const to = made.get(e.object)!.id;
  return [{ from, to, label: e.relation, ...(relationFor(from, to) ? { relation: relationFor(from, to)! } : {}) }];
}), { holon: made.get(paper.nodes.find((n) => n.type === "Question")!.id)!.id });
keep(one(createPaper({
  ...readerStamp,
  fields: {
    title: paper.paper.title,
    canvas: paperCanvas.id,
    filename: "preclinical-sle-mediators.pdf",
    authors: paper.paper.authors.map((a) => a.name),
    doi: paper.paper.doi,
    model: Object.values(paper.models ?? {})[0] ?? "unknown",
    schema: "MIRA",
    server: "demo replay",
  },
})));

// ---------------------------------------------------------------------------
// Check and write.

const problems = records.flatMap((r) => validateRecord(r).map((p) => `${r.kind} ${r.id}: ${p}`));
if (problems.length) throw new Error(problems.join("\n"));
const graph = foldRecords({ records, localSpace: "matsulab", trustedLab: LAB });
const context = JSON.parse(readFileSync("ontology/dg_process.context.jsonld", "utf8"))["@context"] as JsonObject;
const cids = await protocolCids(graph);
const claims = records.filter((r): r is NodeRecord => r.kind === "node" && r.type === type("claim").id);
const summary = claims.map((c) => {
  const support = claimSupport(graph, c.id, cids);
  return { claim: c.title, supporting: support.supporting.length, runs: support.runs.length, protocols: support.protocols.length, flags: support.flags };
});
writeFileSync(join(OUT, "records.json"), `${JSON.stringify(records, null, 1)}\n`);
writeFileSync(join(OUT, "graph.jsonld"), `${JSON.stringify(toProcessJsonLd(graph, context), null, 1)}\n`);
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify({ commit: COMMIT, records: records.length, sameBytes: sameBytes ? { notebookOutput: sameBytes.title, bundleOutput: evd7.outputs.find((o) => o.facts?.cid === sameBytes.facts?.cid)?.title, cid: sameBytes.facts?.cid } : null, claims: summary }, null, 1)}\n`);
const count = (kind: string) => records.filter((r) => r.kind === kind).length;
console.log(`${records.length} records: ${count("node")} units, ${count("relation")} relations, ${count("canvas")} canvases, ${count("canvas-item")} canvas items, ${count("snapshot")} snapshots`);
console.log(`MATSUlab commit ${COMMIT.slice(0, 7)}; notebook import: ${notebookOutputs.length} outputs; same bytes as a bundle file: ${sameBytes ? "yes" : "no"}`);
