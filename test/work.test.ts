import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNode, createPaper, type NodeRecord, type PaperRecord } from "@dg/contract/records.ts";
import type { ExtractionGraph } from "@dg/contract/services.ts";
import { keyOfPaper, keyOfSource, paperOfWork, sameWork, standsFor } from "@dg/core/work.ts";
import { makeCore } from "./support.ts";

const stamp = { space: "here", by: { id: "did:plc:me", name: "Me" } };
const paper = (fields: Partial<PaperRecord> & { title: string }): PaperRecord =>
  createPaper({ ...stamp, fields: { canvas: "c", filename: "paper.pdf", authors: [], model: "m", schema: "mira", server: "s", ...fields } as never });
const source = (title: string, facts: NodeRecord["facts"] = {}): NodeRecord => createNode({ ...stamp, title, facts });

test("an identifier decides first, however it was written", () => {
  const read = paper({ title: "Edge of chaos", doi: "10.1063/5.0038163" });
  const fromLibrary = source("Do reservoir computers work best at the edge of chaos?", { identifiers: [{ scheme: "doi", value: "10.1063/5.0038163" }] });
  const shouting = source("EDGE OF CHAOS", { doi: "https://doi.org/10.1063/5.0038163" });
  assert.equal(sameWork(keyOfPaper(read), keyOfSource(fromLibrary)), "identifier");
  assert.equal(sameWork(keyOfPaper(read), keyOfSource(shouting)), "identifier");
  assert.ok(standsFor(fromLibrary, read));
});

test("two works with the same title and different DOIs stay two works", () => {
  const first = paper({ title: "Introduction", doi: "10.5555/aaa", filename: "a.pdf" });
  const second = source("Introduction", { doi: "10.5555/bbb" });
  assert.equal(sameWork(keyOfPaper(first), keyOfSource(second)), null);
  // Even the same file name doesn't join them once their identifiers disagree.
  assert.equal(sameWork(keyOfPaper({ ...first, filename: "paper.pdf" }), { ...keyOfSource(second), filename: "paper.pdf" }), null);
});

test("the same bytes are the same paper, and a title joins only what has no identifier", () => {
  const cid = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
  const read = paper({ title: "Scan 0041", filename: "scan-0041.pdf", fileCid: cid });
  const renamed = source("My renamed copy", { cid, uri: "Papers/renamed.pdf" });
  assert.equal(sameWork(keyOfPaper(read), keyOfSource(renamed)), "file");
  assert.equal(sameWork(keyOfPaper(paper({ title: "A  Title", filename: "x.pdf" })), keyOfSource(source("a title"))), "name");
  // Once either side has an identifier, a matching title is not enough.
  assert.equal(sameWork(keyOfPaper(paper({ title: "A Title", filename: "x.pdf", doi: "10.5555/aaa" })), keyOfSource(source("A Title"))), null);
});

test("a source finds its paper by the strongest tie, and a library key names no work", () => {
  const byName = paper({ title: "Edge of chaos", filename: "edge.pdf" });
  const byDoi = paper({ title: "Something else entirely", filename: "other.pdf", doi: "10.1063/5.0038163" });
  const held = source("Edge of chaos", { doi: "10.1063/5.0038163", uri: "Papers/edge.pdf" });
  assert.equal(paperOfWork([byName, byDoi], held)?.id, byDoi.id);
  const shelved = source("Unrelated", { identifiers: [{ scheme: "zotero", value: "users/1/items/ABC" }] });
  const alsoShelved = paper({ title: "Different", filename: "d.pdf", identifiers: [{ scheme: "zotero", value: "users/1/items/ABC" }] } as never);
  assert.equal(sameWork(keyOfPaper(alsoShelved), keyOfSource(shelved)), null);
});

const demo = JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")) as ExtractionGraph;

test("a reading keeps the hash of the PDF it read, and its DOI in one form", async () => {
  const shouted = { ...demo, paper: { ...demo.paper, doi: "https://doi.org/10.1016/J.JAUT.2016.06.001" } } as ExtractionGraph;
  const { call } = await makeCore({ services: { extract: async () => shouted }, demoGraphs: [] });
  const pdf = Buffer.from("%PDF-1.7 not really").toString("base64");
  const read = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: pdf }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  assert.equal(read.doi, "10.1016/j.jaut.2016.06.001");
  const record = (await call("canvas.open", { id: read.canvas })).canvas.paper;
  assert.ok(record, "its canvas names the reading");
  const again = await call("paper.extract", { file: { name: "renamed.pdf", mediaType: "application/pdf", dataBase64: pdf }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  assert.notEqual(again.id, read.id, "a second reading is its own reading");
});
