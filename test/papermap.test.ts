import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { layOut, tieStrength } from "@dg/core/papermap.ts";
import type { ExtractionGraph } from "@dg/contract/services.ts";
import { makeCore, type Call } from "./support.ts";

const graphs: Record<string, ExtractionGraph> = {
  "lupus.pdf": JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")),
  "sle.pdf": JSON.parse(readFileSync("demo/papers/preclinical-sle-mediators.graph.json", "utf8")),
};

const setup = async () => {
  let reading = "lupus.pdf";
  const { call } = await makeCore({ services: { extract: async () => graphs[reading]! } });
  const read = async (name: string, bytes: string) => {
    reading = name;
    return call("paper.extract", { file: { name, mediaType: "application/pdf", dataBase64: bytes }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  };
  return { call, read };
};

const unitsOn = async (call: Call, canvas: string, base: string) => {
  const view = await call("canvas.open", { id: canvas });
  return Object.values(view.nodes).filter((node) => node.base === base);
};

test("a tie grows with links and citations, each further link adding less", () => {
  assert.equal(tieStrength({ links: 0, cites: 0 }), 0);
  const one = tieStrength({ links: 1, cites: 0 }), two = tieStrength({ links: 2, cites: 0 }), three = tieStrength({ links: 3, cites: 0 });
  assert.ok(one > 0 && two > one && three > two && three < 1);
  assert.ok(two - one > three - two, "the second link adds more than the third");
  assert.ok(tieStrength({ links: 0, cites: 1 }) > 0 && tieStrength({ links: 0, cites: 1 }) < one, "a citation alone ties less than a link someone drew");
  assert.ok(tieStrength({ links: 1, cites: 1 }) > one);
});

test("more tied papers sit closer, untied ones sit apart, and the picture is the same every time", () => {
  const ties = [
    { a: "a", b: "b", strength: 0.9 },
    { a: "b", b: "c", strength: 0.2 },
  ];
  const at = layOut(["a", "b", "c", "d"], ties);
  const far = (x: string, y: string) => Math.hypot(at.get(x)!.x - at.get(y)!.x, at.get(x)!.y - at.get(y)!.y);
  assert.ok(far("a", "b") < far("b", "c"), `${far("a", "b")} < ${far("b", "c")}`);
  assert.ok(at.get("d")!.y > Math.max(at.get("a")!.y, at.get("b")!.y, at.get("c")!.y), "the untied paper waits underneath");
  assert.deepEqual([...layOut(["d", "c", "b", "a"], [...ties].reverse())], [...at], "order in, same picture out");
  const boxes = ["a", "b", "c", "d"].map((id) => at.get(id)!);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(Math.abs(boxes[i]!.x - boxes[j]!.x) >= 232 || Math.abs(boxes[i]!.y - boxes[j]!.y) >= 104, "no card covers another");
});

test("papers are tied by links people drew, in the scope where they drew them", async () => {
  const { call, read } = await setup();
  const lupus = await read("lupus.pdf", "AAAA");
  const sle = await read("sle.pdf", "BBBB");

  const before = await call("papers.map", { scope: { kind: "everyone" } });
  assert.equal(before.papers.length, 2);
  assert.equal(before.ties.filter((tie) => tie.supports + tie.opposes + tie.other > 0).length, 0, "reading two papers links nothing");
  assert.deepEqual(before.scopes.map(({ label }) => label), ["Only you", "Everyone"]);

  // On a canvas of their own, someone links a claim of one paper to evidence of the other.
  const [claim] = await unitsOn(call, lupus.canvas, "claim");
  const evidence = await unitsOn(call, sle.canvas, "evidence");
  const mine = await call("canvas.create", { title: "Synthesis" });
  await call("units.put", { canvas: mine.id, nodes: [claim!.id, evidence[0]!.id, evidence[1]!.id] });
  const options = await call("relation.options", { source: evidence[0]!.id, target: claim!.id });
  const supports = options.find((option) => option.label === "Supports" && !option.flipped)!, opposes = options.find((option) => option.label === "Opposes" && !option.flipped)!;
  assert.ok(supports && opposes, `evidence can support and oppose a claim: ${options.map(({ label }) => label).join(", ")}`);
  await call("relation.assert", { source: evidence[0]!.id, target: claim!.id, type: supports.type, draw: true });

  const after = await call("papers.map", { scope: { kind: "canvas", id: mine.id } });
  assert.equal(after.scopes[0]!.label, "Synthesis");
  const tie = after.ties.find((item) => item.supports > 0)!;
  assert.ok(tie, "the link ties the two papers");
  assert.equal(tie.stance, "agree");
  assert.equal(tie.links.length, 1);
  assert.deepEqual([tie.links[0]!.from.paper, tie.links[0]!.to.paper].sort(), [lupus.id, sle.id].sort());
  assert.ok(after.papers.every((paper) => !paper.apart && paper.reaching === 1 && paper.tiedTo === 1));

  // A second link that disagrees makes the tie stronger and mixed.
  await call("relation.assert", { source: evidence[1]!.id, target: claim!.id, type: opposes.type, draw: true });
  const mixed = (await call("papers.map", { scope: { kind: "canvas", id: mine.id } })).ties.find((item) => item.supports > 0)!;
  assert.equal(mixed.stance, "mixed");
  assert.ok(mixed.strength > tie.strength);

  // The same papers in the person's own workspace, and across everything, show the tie too.
  for (const kind of ["own", "everyone"] as const) assert.equal((await call("papers.map", { scope: { kind } })).ties.find((item) => item.supports > 0)?.stance, "mixed", kind);
  // A canvas that holds only one paper shows it alone.
  const alone = await call("papers.map", { scope: { kind: "canvas", id: lupus.canvas } });
  assert.deepEqual(alone.papers.map(({ id }) => id), [lupus.id]);
  assert.equal(alone.ties.length, 0);
});

test("a default color is not a lab's own choice, and a chosen one is", async () => {
  const { ownColor } = await import("@dg/core/process.ts");
  assert.equal(ownColor({ color: "#8fbf6f" }), undefined, "an earlier build's default");
  assert.equal(ownColor({ color: "#7DA13E" }), undefined, "the official plugin's default claim green");
  assert.equal(ownColor({ color: "#123456" }), "#123456");
  assert.equal(ownColor({}), undefined);
});
