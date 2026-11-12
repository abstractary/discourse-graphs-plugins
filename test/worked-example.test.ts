import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { foldRecords, validateRecord, type DgRecord, type JsonObject, type NodeRecord } from "@dg/contract/records.ts";
import { toProcessJsonLd } from "@dg/core/jsonld.ts";
import { baseOf, claimSupport, protocolCids } from "@dg/core/process.ts";
import { shapeProblems } from "@dg/core/shapes.ts";

// The worked example is generated from real files by examples/worked-example/build.ts.
// These checks keep it in step with the code without needing the MATSUlab checkout.
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const LAB = "did:web:lab.records.example";
const graph = foldRecords({ records, localSpace: "matsulab", trustedLab: LAB });

test("the worked example's records are all valid", () => {
  assert.deepEqual(records.flatMap(validateRecord), []);
});

test("every claim in the worked example rests on a single run", async () => {
  const cids = await protocolCids(graph);
  const claims = [...graph.documents.values()].filter((r): r is NodeRecord => r.kind === "node" && baseOf(graph, r) === "claim");
  assert.equal(claims.length, 12);
  for (const claim of claims) {
    const support = claimSupport(graph, claim.id, cids);
    assert.equal(support.flags.singleRun, true, claim.title);
    assert.equal(support.flags.drift, false, claim.title);
    assert.equal(support.flags.staleOutput, false, claim.title);
  }
});

test("a notebook output and a bundle file with the same bytes have the same CID", () => {
  const outputs = [...graph.documents.values()].filter((r): r is NodeRecord => r.kind === "node" && baseOf(graph, r) === "output");
  const byCid = new Map<string, NodeRecord[]>();
  for (const output of outputs) byCid.set(output.facts!.cid!, [...(byCid.get(output.facts!.cid!) ?? []), output]);
  const shared = [...byCid.values()].filter((list) => list.length > 1);
  assert.equal(shared.length, 1);
  assert.ok(shared[0]!.some((o) => o.title === "fig7_student_timelines.png"));
  assert.notEqual(shared[0]![0]!.prov?.generatedBy, shared[0]![1]!.prov?.generatedBy, "two runs made the same bytes");
});

test("the JSON-LD view matches the committed graph", async () => {
  const context = JSON.parse(readFileSync("ontology/dg_process.context.jsonld", "utf8"))["@context"] as JsonObject;
  const committed = JSON.parse(readFileSync("examples/worked-example/graph.jsonld", "utf8"));
  const document = toProcessJsonLd(graph, context, await protocolCids(graph));
  assert.deepEqual(document, committed);
  // The in-app shapes agree with pyshacl on it: nothing wrong, one known gap.
  const problems = shapeProblems(document);
  assert.deepEqual(problems.filter((problem) => problem.severity === "Violation"), []);
  assert.deepEqual([...new Set(problems.filter((problem) => problem.severity === "Warning").map((problem) => problem.rule))], ["run-no-study"]);
});
