import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { foldRecords, revise, type DgRecord, type NodeRecord } from "@dg/contract/records.ts";
import { canvasAt, diffCanvas, holonRoots, holonView, planFork, planRelease, repository, type HolonInput } from "@dg/core/holons.ts";
import { baseOf, protocolCids } from "@dg/core/process.ts";

const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const LAB = "did:web:lab.records.example";
const matt = { id: "did:web:records.example", name: "Matt Akamatsu" };

const inputFor = async (all: DgRecord[], me = matt): Promise<HolonInput> => {
  const graph = foldRecords({ records: all, localSpace: "matsulab", trustedLab: LAB });
  return { graph, records: all, me, localSpace: "matsulab", protocols: await protocolCids(graph) };
};
const unit = (input: HolonInput, title: string) =>
  [...input.graph.documents.values()].find((r): r is NodeRecord => r.kind === "node" && r.title.startsWith(title))!;

test("the holarchy starts at the lab and holds its questions", async () => {
  const input = await inputFor(records);
  const roots = holonRoots(input);
  assert.deepEqual(roots.map((r) => r.title), ["Akamatsu Lab"]);
  const lab = holonView(input, roots[0]!.ref, "lab");
  assert.equal(lab.parts.length, 3, "the lab question and the paper's two; requests aren't questions of the lab");
  assert.ok(lab.parts.every((p) => p.base === "question" && p.ref?.level === "question"));
});

test("a question holds its claims, and every one rests on a single run", async () => {
  const input = await inputFor(records);
  const question = unit(input, "How does a shared issue board");
  const view = holonView(input, { level: "question", id: question.id }, "lab");
  assert.equal(view.parts.length, 4);
  assert.ok(view.parts.every((p) => p.flags.includes("single run")));
  const single = view.boundary.gaps.find((g) => g.rule === "single-run");
  assert.equal(single?.units.length, 4);
  assert.ok(view.boundary.gaps.some((g) => g.rule === "unreviewed"));
  assert.deepEqual(view.path.map((p) => p.title), ["Akamatsu Lab", question.title]);
  // The lab arranged a canvas for this question, so that canvas is the holon's view.
  assert.equal(view.canvas.title, "Issue exchange: what the analysis shows");
  assert.equal(view.canvas.cards.filter((c) => c.unit).length, 1 + 4 + 4 + 4);
  assert.equal(view.canvas.cards.filter((c) => c.canvas).length, 1, "the EVD 7 canvas sits inside it");
});

test("evidence holds its outputs and shows the run, protocol, code and source behind it", async () => {
  const input = await inputFor(records);
  const evidence = unit(input, "Three undergraduate researchers");
  const view = holonView(input, { level: "evidence", id: evidence.id }, "lab");
  assert.ok(view.parts.length >= 2);
  assert.ok(view.parts.every((p) => p.base === "output"));
  const behind = new Set(view.behind.map((b) => b.base));
  for (const b of ["run", "study", "protocol", "code", "source"]) assert.ok(behind.has(b), b);
  assert.ok(view.boundary.crossings.some((c) => c.direction === "in" && c.why.startsWith("Reported in")));
  assert.deepEqual(view.path.map((p) => p.ref.level), ["lab", "question", "claim", "evidence"]);
});

test("an output shows the other run that made the same bytes", async () => {
  const input = await inputFor(records);
  const output = unit(input, "fig7_student_timelines.png");
  const view = holonView(input, { level: "output", id: output.id }, "lab");
  const runs = view.behind.filter((b) => b.base === "run");
  assert.equal(runs.length, 2, "the bundle's run and the notebook's run");
  assert.equal(view.within.length, 1);
});

test("whose records count changes which arguments are active", async () => {
  const someone = { id: "did:web:someone.example", name: "Someone" };
  const input = await inputFor(records, someone);
  const question = unit(input, "How does a shared issue board");
  const mine = holonView(input, { level: "question", id: question.id }, "mine");
  const lab = holonView(input, { level: "question", id: question.id }, "lab");
  assert.equal(mine.parts.length, 0);
  assert.equal(mine.boundary.stance.pending, 4);
  assert.deepEqual(mine.boundary.stance.pendingBy, ["Matt Akamatsu"]);
  assert.equal(lab.parts.length, 4);
});

test("the repository lists canvases; a release pins them, and a fork starts from it", async () => {
  let input = await inputFor(records);
  const shelf = repository(input);
  assert.equal(shelf.length, 3);
  const canvas = shelf.find((c) => c.title.startsWith("Issue exchange"))!;
  assert.equal(canvas.units.claim, 4);
  assert.equal(canvas.releases.length, 0);
  assert.equal(canvas.holon?.ref.level, "question");
  const inner = shelf.find((c) => c.title.startsWith("EVD 7"))!;
  assert.deepEqual(canvas.nested, [inner.id]);
  assert.deepEqual(inner.nestedIn, [canvas.id]);

  const release = await planRelease(input, canvas.id, "v1", "As shared with the lab", { space: "matsulab", by: matt, at: "2026-03-01T00:00:00.000Z" });
  input = await inputFor([...records, release]);
  assert.equal(release.units.length, 13);
  assert.deepEqual(await diffCanvas(input, canvas.id, release.id, "now"), { from: "v1", to: "now", added: [], removed: [], changed: [], moved: [] });

  const claim = unit(input, "29% of MATSUlab issues");
  const edited = revise({ record: claim, changes: { title: `${claim.title} (as of February 2026)` }, by: matt, at: "2026-03-02T00:00:00.000Z" });
  input = await inputFor([...records, release, edited]);
  const diff = await diffCanvas(input, canvas.id, release.id, "now");
  assert.deepEqual(diff.changed.map((c) => c.unit), [claim.id]);

  const fork = planFork(input, release.id, undefined, { space: "home", by: { id: "did:web:student.example", name: "Student" }, at: "2026-03-03T00:00:00.000Z" });
  input = await inputFor([...records, release, edited, ...fork]);
  const after = repository(input);
  const copy = after.find((c) => c.id === fork[0]!.id)!;
  assert.equal(copy.cards, canvas.cards);
  assert.equal(copy.links, canvas.links);
  assert.equal(copy.forkOf?.release, "v1");
  assert.equal(after.find((c) => c.id === canvas.id)!.forks, 1);
});

test("a canvas can be read as it stood before it existed, and after", async () => {
  const input = await inputFor(records);
  const canvas = repository(input).find((c) => c.title.startsWith("Issue exchange"))!;
  assert.equal(canvasAt(input, canvas.id, "2026-01-01T00:00:00.000Z").cards.length, 0);
  assert.equal(canvasAt(input, canvas.id, "2026-12-01T00:00:00.000Z").cards.length, canvas.cards);
  assert.ok([...input.graph.documents.values()].some((r) => r.kind === "node" && baseOf(input.graph, r) === "run"));
});

test("in another vault, where the base folds the lab's arguments as pending, the lab stance still counts them", async () => {
  const graph = foldRecords({ records, localSpace: "someone-elses-vault" });
  const input: HolonInput = { graph, records, me: { id: "did:web:someone.example", name: "Someone" }, localSpace: "someone-elses-vault", protocols: await protocolCids(graph) };
  const question = unit(input, "How does a shared issue board");
  const view = holonView(input, { level: "question", id: question.id }, "lab");
  assert.equal(view.parts.length, 4);
  assert.ok(view.parts.every((p) => p.flags.includes("single run") && !p.flags.includes("unsupported")));
  assert.equal(view.boundary.gaps.find((g) => g.rule === "single-run")?.units.length, 4);
  const mine = holonView(input, { level: "question", id: question.id }, "mine");
  assert.equal(mine.parts.length, 0);
});
