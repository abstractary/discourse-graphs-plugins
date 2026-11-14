import assert from "node:assert/strict";
import test from "node:test";
import { makeCore } from "./support.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG2 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const notebook = ({ png = PNG, source = "plot(df)" }: { png?: string; source?: string } = {}) => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" }, language_info: { name: "python", version: "3.12.4" }, papermill: { start_time: "2026-11-01T09:00:00Z", end_time: "2026-11-01T09:02:00Z" } },
  cells: [
    { cell_type: "markdown", id: "a1", source: "# Staining intensity\nCounts per field." },
    { cell_type: "code", id: "b2", source: "import pandas as pd\ndf = pd.read_csv('counts.csv')", execution_count: 1, outputs: [] },
    { cell_type: "code", id: "c3", source: `#| label: fig-intensity\n${source}`, execution_count: 2, outputs: [{ output_type: "display_data", data: { "image/png": png, "text/plain": "<Figure>" } }] },
  ],
});

const setup = async () => {
  const { core, call, events, store, host } = await makeCore();
  const save = async (body: unknown, name = "intensity.ipynb"): Promise<string> => {
    const written = await host.writeAsset({ asset: { name, mime: "application/x-ipynb+json", dataUrl: `data:application/x-ipynb+json;base64,${Buffer.from(JSON.stringify(body)).toString("base64")}` } });
    if (!written.ok) throw new Error("no asset");
    return written.value.ref;
  };
  const replace = (ref: string, body: unknown): void => {
    const asset = store.assets.get(ref)!;
    store.assets.set(ref, { ...asset, dataUrl: `data:application/x-ipynb+json;base64,${Buffer.from(JSON.stringify(body)).toString("base64")}` });
  };
  return { call, events, save, replace, core };
};

test("a saved notebook becomes code, a run and its outputs, and the same execution twice writes nothing", async () => {
  const { call, save } = await setup();
  const ref = await save(notebook());
  const [listed] = await call("notebook.list", {});
  assert.deepEqual([listed!.name, listed!.runs, listed!.code], ["intensity.ipynb", 0, undefined]);

  const first = await call("notebook.import", { ref });
  assert.deepEqual([first.known, first.revised, first.status, first.outputs.length], [false, false, "completed", 1]);
  assert.equal(first.code.title, "Staining intensity");
  assert.deepEqual([first.code.base, first.run.base, first.outputs[0]!.base], ["code", "run", "output"]);

  const again = await call("notebook.import", { ref });
  assert.deepEqual([again.known, again.run.id, again.outputs[0]!.id], [true, first.run.id, first.outputs[0]!.id]);
  const [after] = await call("notebook.list", {});
  assert.deepEqual([after!.code, after!.runs], [first.code.id, 1]);
  await assert.rejects(call("notebook.import", { ref: await save({ cells: "no" }, "bad.ipynb") }), /isn't a Jupyter notebook/);
});

test("a run page shows what ran, the cell behind each output, and the figure only while its bytes still match", async () => {
  const { call, save, replace } = await setup();
  const ref = await save(notebook());
  const { run, outputs, code } = await call("notebook.import", { ref });
  const page = await call("process.run", { id: run.id });
  assert.deepEqual([page.status, page.startedAt, page.endedAt], ["completed", "2026-11-01T09:00:00Z", "2026-11-01T09:02:00Z"]);
  assert.deepEqual(page.environment, [{ name: "kernel", value: "python3" }, { name: "language", value: "python" }, { name: "languageVersion", value: "3.12.4" }]);
  assert.deepEqual([page.code[0]!.id, page.code[0]!.drift], [code.id, undefined]);
  const [output] = page.outputs;
  assert.deepEqual([output!.unit.id, output!.kind, output!.cell, output!.label, output!.stale], [outputs[0]!.id, "figure", 3, "fig-intensity", undefined]);
  assert.equal(output!.preview, `data:image/png;base64,${PNG}`);
  assert.equal(page.notebook!.current, true);
  assert.deepEqual(page.notebook!.cells.map((cell) => [cell.index, cell.kind, cell.outputs.length]), [[1, "markdown", 0], [2, "code", 0], [3, "code", 1]]);
  assert.deepEqual(page.problems.map((problem) => problem.rule), ["run-no-study"]);

  // The notebook is rerun and saved: the page stops showing its figure as this run's output.
  replace(ref, notebook({ png: PNG2, source: "plot(df, log=True)" }));
  const later = await call("process.run", { id: run.id });
  assert.deepEqual([later.outputs[0]!.preview, later.outputs[0]!.stale, later.notebook!.current], [undefined, true, false]);
  const rerun = await call("notebook.import", { ref });
  assert.deepEqual([rerun.known, rerun.revised, rerun.code.id === code.id, rerun.run.id === run.id], [false, true, true, false]);
  // The first run now pins a version of the code that has moved on.
  const drifted = await call("process.run", { id: run.id });
  assert.equal(drifted.code[0]!.drift, "changed");
  assert.ok(drifted.problems.some((problem) => problem.rule === "run-code-drift"));
});

test("evidence made from an output is pinned to its bytes, and a claim's method reads back to the code", async () => {
  const { call, save, events } = await setup();
  const { run, outputs, code } = await call("notebook.import", { ref: await save(notebook()) });
  const evidence = await call("evidence.fromOutput", { output: outputs[0]!.id, title: "Intensity rises with dose" });
  assert.equal(evidence.base, "evidence");
  assert.ok(events.some((event) => event.event === "place-node" && event.node === evidence.id), "the open canvas is offered the new card");

  const grammar = await call("grammar.get", {});
  const claimType = grammar.nodeTypes.find((type) => type.base === "claim")!;
  const supports = grammar.relationTypes.find((type) => type.base === "supports")!;
  const claim = await call("node.create", { title: "Dose drives staining", type: claimType.id });
  await call("relation.assert", { type: supports.id, source: evidence.id, target: claim.id });

  const method = await call("process.method", { id: claim.id });
  assert.equal(method.chains.length, 1);
  assert.deepEqual(method.chains[0]!.steps.map((step) => step.role), ["code", "run", "output", "evidence"]);
  assert.deepEqual(method.chains[0]!.steps.map((step) => step.id), [code.id, run.id, outputs[0]!.id, evidence.id]);
  assert.deepEqual([method.chains[0]!.stance, method.chains[0]!.ungrounded, method.run], ["supports", false, run.id]);
  assert.deepEqual([method.flags!.singleRun, method.flags!.replicated, method.flags!.drift, method.flags!.runs], [true, false, false, 1]);
  assert.match(method.chains[0]!.steps[2]!.detail!, /figure, fig-intensity/);

  const page = await call("process.run", { id: run.id, previews: false });
  assert.deepEqual(page.outputs[0]!.evidence.map((item) => [item.unit.id, item.pinned, item.changed]), [[evidence.id, true, false]]);
  assert.deepEqual(page.claims.map((item) => [item.unit.id, item.stance]), [[claim.id, "supports"]]);
  assert.equal((await call("process.method", { id: run.id })).chains.length, 1, "a run's own method lists the evidence resting on it");
});

test("a protocol, an experiment and a run each take their own fields, and a run pins the protocol it follows", async () => {
  const { call, save } = await setup();
  const { run } = await call("notebook.import", { ref: await save(notebook()) });
  const grammar = await call("grammar.get", {});
  const typeOf = (base: string) => grammar.nodeTypes.find((type) => type.base === base)!.id;
  const question = await call("node.create", { title: "Does dose drive staining?", type: typeOf("question") });
  const protocol = await call("node.create", { title: "Immunostaining", type: typeOf("protocol") });
  const study = await call("node.create", { title: "Dose series", type: typeOf("study") });

  await call("process.setFacts", { id: protocol.id, facts: { steps: ["Fix", "Stain", "Image"], materials: ["RRID:AB_2314866"], version: "2" } });
  await call("process.setFacts", { id: study.id, facts: { design: "experimental", conditions: ["low", "high"], hypothesis: "High dose stains more." }, links: { question: question.id, protocols: [protocol.id] } });
  await assert.rejects(call("process.setFacts", { id: study.id, facts: { deviations: ["x"] } }), /has no deviations/);
  await assert.rejects(call("process.setFacts", { id: run.id, facts: {}, links: { partOf: protocol.id } }), /isn't a study/);

  const wrong = await call("process.setFacts", { id: run.id, facts: { condition: "medium", deviations: ["Imaged a day late."] }, links: { partOf: study.id, follows: protocol.id } });
  assert.ok(wrong.problems.some((problem) => problem.rule === "run-condition-unknown"));
  const right = await call("process.setFacts", { id: run.id, facts: { condition: "high" } });
  assert.deepEqual(right.problems, []);

  const page = await call("process.run", { id: run.id, previews: false });
  assert.deepEqual([page.study!.unit.id, page.study!.question!.id, page.study!.design, page.condition], [study.id, question.id, "experimental", "high"]);
  assert.deepEqual([page.protocol!.id, page.protocol!.steps, page.protocol!.drift, page.deviations], [protocol.id, ["Fix", "Stain", "Image"], undefined, ["Imaged a day late."]]);

  // Editing the protocol afterwards doesn't rewrite what the run followed. It shows as drift.
  await call("process.setFacts", { id: protocol.id, facts: { steps: ["Fix", "Block", "Stain", "Image"] } });
  const after = await call("process.run", { id: run.id, previews: false });
  assert.equal(after.protocol!.drift, "changed");
  assert.ok(after.problems.some((problem) => problem.rule === "run-protocol-drift"));
});
