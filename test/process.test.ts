import assert from "node:assert/strict";
import test from "node:test";
import { toAtRecord } from "@dg/contract/atproto.ts";
import {
  assertRelation,
  createNode,
  defaultGrammar,
  foldRecords,
  revise,
  validateRecord,
  type DgRecord,
  type NodeRecord,
  type NodeTypeRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import {
  claimSupport,
  cidOfBytes,
  ensureProcessTypes,
  evidenceChain,
  planNotebookImport,
  protocolCids,
  provenanceOf,
  unitCid,
  type Notebook,
} from "@dg/core/process.ts";

const ana = { id: "did:plc:ana", name: "Ana" };
const stamp = { space: "home", by: ana };
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const grammar = () => {
  const base = defaultGrammar(stamp);
  const { types, created } = ensureProcessTypes({ nodeTypes: base.filter((r): r is NodeTypeRecord => r.kind === "node-type"), stamp });
  const nodeType = (b: string) => base.find((r): r is NodeTypeRecord => r.kind === "node-type" && r.base === b)!;
  const relationType = (b: string) => base.find((r): r is RelationTypeRecord => r.kind === "relation-type" && r.base === b)!;
  return { records: [...base, ...created] as DgRecord[], types, nodeType, relationType };
};

const notebook = (overrides: { png?: string; source?: string; error?: boolean } = {}): Notebook => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" }, language_info: { name: "python", version: "3.12.7" } },
  cells: [
    { cell_type: "markdown", id: "a1", source: ["# Conversion rate\n", "Issues claimed as experiments."] },
    {
      cell_type: "code",
      id: "b2",
      execution_count: 1,
      source: overrides.source ?? "#| label: fig-conversion\nplot(rate)",
      outputs: [
        { output_type: "stream", name: "stdout", text: "29% claimed\n" },
        { output_type: "display_data", data: { "image/png": overrides.png ?? PNG, "text/plain": "<Figure>" } },
        ...(overrides.error ? [{ output_type: "error" as const, ename: "ValueError", evalue: "bad" }] : []),
      ],
    },
    {
      cell_type: "code",
      id: "c3",
      execution_count: 2,
      source: "table",
      outputs: [{ output_type: "execute_result", data: { "text/html": "<table><tr><td>29%</td></tr></table>", "text/plain": "29%" } }],
    },
  ],
});

test("a notebook becomes Code, a Run and Outputs, each with its own identity", async () => {
  const g = grammar();
  const graph = foldRecords({ records: g.records, localSpace: "home" });
  const plan = await planNotebookImport({ notebook: notebook(), path: "notebooks/rate.ipynb", repo: "https://github.com/lab/x", commit: "9c1e0aa", graph, types: g.types, stamp });
  assert.equal(plan.code.title, "Conversion rate");
  assert.equal(plan.outputs.length, 2, "the figure and the table; printed text only when asked");
  assert.deepEqual(plan.outputs.map((o) => o.facts?.outputKind), ["figure", "table"]);
  assert.equal(plan.outputs[0]!.facts?.locator?.label, "fig-conversion");
  assert.equal(plan.outputs[0]!.facts?.locator?.cellId, "b2");
  // The figure's CID is the hash of the PNG's own bytes, not of the notebook JSON.
  const bytes = Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0));
  assert.equal(plan.outputs[0]!.facts?.cid, await cidOfBytes(bytes));
  assert.equal(plan.run.facts?.status, "completed");
  assert.deepEqual(plan.run.prov?.instrument, [{ uri: plan.code.id, cid: plan.code.facts!.sourceCid! }]);
  assert.ok(plan.outputs.every((o) => o.prov?.generatedBy === plan.run.id));
  assert.deepEqual(plan.records.flatMap(validateRecord), []);
});

test("re-importing the same execution adds nothing; new outputs make a new run", async () => {
  const g = grammar();
  const first = await planNotebookImport({ notebook: notebook(), path: "n.ipynb", graph: foldRecords({ records: g.records, localSpace: "home" }), types: g.types, stamp });
  const after = foldRecords({ records: [...g.records, ...first.records], localSpace: "home" });
  const again = await planNotebookImport({ notebook: notebook(), path: "n.ipynb", graph: after, types: g.types, stamp });
  assert.equal(again.known, true);
  assert.deepEqual(again.records, []);

  const other = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const rerun = await planNotebookImport({ notebook: notebook({ png: other }), path: "n.ipynb", graph: after, types: g.types, stamp });
  assert.equal(rerun.known, false);
  assert.equal(rerun.code.id, first.code.id, "same sources, same code");
  assert.notEqual(rerun.run.id, first.run.id);
  assert.notEqual(rerun.outputs[0]!.facts?.cid, first.outputs[0]!.facts?.cid);

  const edited = await planNotebookImport({ notebook: notebook({ source: "plot(rate, log=True)" }), path: "n.ipynb", graph: after, types: g.types, stamp });
  assert.equal(edited.code.id, first.code.id, "changed sources are a new version of the same code");
  assert.equal(edited.code.rev, 2);
  assert.notEqual(edited.code.facts?.sourceCid, first.code.facts?.sourceCid);
});

test("an error output marks the run failed", async () => {
  const g = grammar();
  const plan = await planNotebookImport({ notebook: notebook({ error: true }), path: "n.ipynb", graph: foldRecords({ records: g.records, localSpace: "home" }), types: g.types, stamp });
  assert.equal(plan.run.facts?.status, "failed");
});

/** Two runs of one protocol, each behind its own evidence for the same claim. */
const replicated = async () => {
  const g = grammar();
  const question = createNode({ ...stamp, title: "Does the issue board spread ideas?", type: g.nodeType("question").id });
  const protocol = createNode({ ...stamp, title: "Count claimed issues", type: g.types.protocol.id, facts: { version: "1" } });
  const pin = { uri: protocol.id, cid: await unitCid(protocol) };
  const study = createNode({ ...stamp, title: "Issue exchange in MATSUlab", type: g.types.study.id, prov: { question: question.id, protocols: [protocol.id] } });
  const runs = [1, 2].map((n) =>
    createNode({ ...stamp, title: `Run ${n}`, type: g.types.run.id, prov: { partOf: study.id, follows: pin }, facts: { status: "completed" } }),
  );
  const outputs = await Promise.all(
    runs.map(async (run, n) =>
      createNode({ ...stamp, title: `Figure ${n}`, type: g.types.output.id, prov: { generatedBy: run.id }, facts: { cid: await cidOfBytes(new Uint8Array([n])) } }),
    ),
  );
  const evidence = outputs.map((output, n) =>
    createNode({ ...stamp, title: `Evidence ${n}`, type: g.nodeType("evidence").id, prov: { observationBase: [{ uri: output.id, cid: output.facts!.cid! }] } }),
  );
  const claim = createNode({ ...stamp, title: "The board spreads ideas", type: g.nodeType("claim").id });
  const supports = evidence.map((e) => assertRelation({ ...stamp, type: g.relationType("supports").id, source: e.id, target: claim.id }));
  return { g, question, protocol, study, runs, outputs, evidence, claim, records: [...g.records, question, protocol, study, ...runs, ...outputs, ...evidence, claim, ...supports] as DgRecord[] };
};

test("two runs of one protocol count as replicated, and the chain reaches the question", async () => {
  const w = await replicated();
  const graph = foldRecords({ records: w.records, localSpace: "home" });
  const cids = await protocolCids(graph);
  const support = claimSupport(graph, w.claim.id, cids);
  assert.equal(support.supporting.length, 2);
  assert.equal(support.flags.replicated, true);
  assert.equal(support.flags.singleRun, false);
  assert.equal(support.flags.drift, false);
  assert.equal(support.flags.staleOutput, false);
  const chain = evidenceChain(graph, w.evidence[0]!.id, cids);
  assert.equal(chain.run, w.runs[0]!.id, "read from the output when evidence doesn't name the run");
  assert.equal(chain.study, w.study.id);
  assert.equal(chain.question, w.question.id);
  assert.equal(chain.protocol?.id, w.protocol.id);
});

test("editing the protocol shows drift; changing an output shows it stale", async () => {
  const w = await replicated();
  const edited = revise({ record: w.protocol, changes: { facts: { version: "2" } }, by: ana });
  const changed = revise({ record: w.outputs[0]!, changes: { facts: { ...w.outputs[0]!.facts, cid: await cidOfBytes(new Uint8Array([9])) } }, by: ana });
  const graph = foldRecords({ records: [...w.records, edited, changed], localSpace: "home" });
  const support = claimSupport(graph, w.claim.id, await protocolCids(graph));
  assert.equal(support.flags.drift, true);
  assert.equal(support.flags.staleOutput, true);
});

test("older graphs' follows relations still read as provenance", async () => {
  const w = await replicated();
  const follows = defaultGrammar(stamp); // no follows type in the default grammar
  assert.ok(follows.every((r) => r.kind !== "relation-type" || r.base !== "follows"));
  const legacyType: RelationTypeRecord = { ...(w.g.relationType("supports") as RelationTypeRecord), id: "did:plc:ana#3lzzzzzzzzzz2", label: "Follows", complement: "Followed by", base: "follows", rules: [] };
  const run = createNode({ ...stamp, title: "Legacy run", type: w.g.types.run.id });
  const relation = assertRelation({ ...stamp, type: legacyType.id, source: run.id, target: w.protocol.id });
  const graph = foldRecords({ records: [...w.records, legacyType, run, relation], localSpace: "home" });
  assert.equal(provenanceOf(graph, run.id).follows?.uri, w.protocol.id);
});

test("process units publish under MIRA's names where MIRA has them", async () => {
  const w = await replicated();
  const graph = foldRecords({ records: w.records, localSpace: "home" });
  const run = toAtRecord(w.runs[0]!, graph)!;
  assert.equal(run.collection, "science.mira.study");
  assert.deepEqual(run.value.follows, [{ uri: `at://did:plc:ana/science.mira.protocol/${w.protocol.id.split("#")[1]}`, cid: w.runs[0]!.prov!.follows!.cid }]);
  assert.ok(String((run.value.partOf as { uri: string }).uri).includes("org.discoursegraphs.study"));
  const evidence = toAtRecord(w.evidence[0]!, graph)!;
  assert.equal(evidence.collection, "science.mira.evidence");
  assert.deepEqual(evidence.value.isGroundedIn, evidence.value.observationOriginActivity);
  assert.equal((evidence.value.observationBase as { cid: string }[])[0]!.cid, w.outputs[0]!.facts!.cid);
  assert.equal(toAtRecord(w.study, graph)!.collection, "org.discoursegraphs.study");
  assert.equal(toAtRecord(w.outputs[0]!, graph)!.collection, "org.discoursegraphs.output");
  assert.equal(toAtRecord(w.protocol, graph)!.collection, "science.mira.protocol");
});

test("provenance links and facts are checked", () => {
  const bad = (fields: Partial<NodeRecord>) => validateRecord({ ...createNode({ ...stamp, title: "x" }), ...fields });
  assert.notDeepEqual(bad({ prov: { follows: { cid: "x" } as never } }), []);
  assert.notDeepEqual(bad({ prov: { observationBase: [{ uri: "o", cid: "not-a-cid" }] } }), []);
  assert.notDeepEqual(bad({ facts: { status: "maybe" as never } }), []);
  assert.notDeepEqual(bad({ facts: { startedAt: "yesterday" } }), []);
  assert.deepEqual(bad({ prov: { partOf: "s", follows: { uri: "p" } }, facts: { status: "failed" } }), []);
});

test("every process record validates against its lexicon", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { Lexicons } = await import("@atproto/lexicon");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  const lex = new Lexicons();
  for (const file of walk("lexicons").filter((path) => path.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { lexicon?: number };
    if (doc.lexicon) lex.add(doc as never);
  }
  const w = await replicated();
  const g = w.g;
  const plan = await planNotebookImport({ notebook: notebook(), path: "n.ipynb", repo: "https://github.com/lab/x", commit: "9c1e0aa", graph: foldRecords({ records: w.records, localSpace: "home" }), types: g.types, stamp, agents: ["https://orcid.org/0000-0002-0286-5310"], partOf: w.study.id });
  const { createEvaluation } = await import("@dg/contract/records.ts");
  const review = createEvaluation({ ...stamp, fields: { target: w.claim.id, targetCid: await unitCid(w.claim), method: "dataReanalyzed", term: "endorsed" } });
  assert.deepEqual(validateRecord(review), []);
  const graph = foldRecords({ records: [...w.records, ...plan.records, review], localSpace: "home" });
  const collections = new Set<string>();
  for (const record of graph.documents.values()) {
    const projected = toAtRecord(record, graph);
    if (!projected) continue;
    collections.add(projected.collection);
    lex.assertValidRecord(projected.collection, projected.value);
  }
  for (const expected of ["science.mira.evaluation", "science.mira.protocol", "science.mira.study", "org.discoursegraphs.study", "org.discoursegraphs.code", "org.discoursegraphs.output", "science.mira.evidence"]) {
    assert.ok(collections.has(expected), expected);
  }
});
