import assert from "node:assert/strict";
import test from "node:test";
import type { DgId } from "@dg/contract/records.ts";
import { openWorld, personalZotero, ZOTERO_FILE, type Vault } from "../harness/vaults/world.ts";

// Two members of one lab, each with a vault of their own, and the reference server between them.
// What these hold was first found broken by the four-vault simulation, `node harness/four-vaults.ts`.

const typeOf = async (vault: Vault, base: string): Promise<DgId> => (await vault.call("grammar.get", {})).nodeTypes.find((type) => type.base === base)!.id;
const relationOf = async (vault: Vault, label: string): Promise<DgId> => (await vault.call("grammar.get", {})).relationTypes.find((type) => type.label.toLowerCase() === label)!.id;
const card = async (vault: Vault, canvas: DgId, node: { id: DgId; title: string }, x: number): Promise<DgId> =>
  (await vault.call("canvas.write", { canvas, upserts: [{ z: x + 1, item: { type: "text", text: node.title, x, y: 0, width: 240, height: 90, dg: { node: node.id } } as never }] })).ids[0]!;

const lab = async (t: test.TestContext) => {
  const world = await openWorld([{ name: "Mira" }, { name: "Tomas", zotero: personalZotero }]);
  t.after(() => world.close());
  const [mira, tomas] = world.vaults as [Vault, Vault];
  mira.online = tomas.online = true;
  await mira.call("lab.register", { server: world.server, name: "Tension Lab" });
  await tomas.call("lab.acceptInvite", { invite: (await mira.call("lab.invite", {})).invite });
  mira.online = tomas.online = false;
  const canvas = (await mira.call("canvas.create", { title: "Shared" })).id;
  const claim = await mira.call("node.create", { title: "Actin rises with tension", type: await typeOf(mira, "claim") });
  const evidence = await mira.call("node.create", { title: "Actin doubled", type: await typeOf(mira, "evidence") });
  const cards = { claim: await card(mira, canvas, claim, 0), evidence: await card(mira, canvas, evidence, 300) };
  await mira.call("relation.assert", { type: await relationOf(mira, "supports"), source: evidence.id, target: claim.id, draw: true });
  await mira.call("canvas.share", { id: canvas });
  await world.settle();
  const titles = async (vault: Vault): Promise<string[]> => Object.values((await vault.call("canvas.open", { id: canvas })).nodes).map((node) => node.title).sort();
  return { world, mira, tomas, canvas, claim, evidence, cards, titles };
};

test("what one member takes away is taken away for the other", async (t) => {
  const { world, mira, tomas, canvas, claim, evidence, cards, titles } = await lab(t);
  assert.deepEqual(await titles(tomas), ["Actin doubled", "Actin rises with tension"]);

  // A card taken off the canvas.
  await mira.call("canvas.write", { canvas, removes: [cards.claim] });
  await world.settle();
  assert.deepEqual(await titles(tomas), ["Actin doubled"]);

  // A unit removed by its author: the unit itself goes, not only its card, and no line is left to it.
  await mira.call("node.remove", { id: evidence.id });
  await world.settle();
  assert.deepEqual(await titles(tomas), []);
  assert.equal((tomas.core.graph().documents.get(evidence.id) as { removed?: boolean }).removed, true);
  assert.deepEqual(Object.keys((await tomas.call("canvas.open", { id: canvas })).relations), []);

  // Once its card is off the canvas, a unit's later wording stays with its author.
  await mira.call("node.rename", { id: claim.id, title: "A private second thought" });
  await world.settle();
  assert.ok(!JSON.stringify(mira.sent).includes("private second thought"));

  // The canvas itself.
  await mira.call("canvas.remove", { id: canvas });
  await world.settle();
  assert.ok(!(await tomas.call("canvas.list", {})).some((item) => item.id === canvas && !item.removed));
});

test("a member's relation, its withdrawal and a check all reach the other member", async (t) => {
  const { world, mira, tomas, canvas, claim, titles } = await lab(t);
  const counter = await tomas.call("node.create", { title: "Flat above a threshold", type: await typeOf(tomas, "claim") });
  await card(tomas, canvas, counter, 600);
  // Drawn on the lab's canvas, which is Mira's, because Tomas works on it too.
  const opposes = await tomas.call("relation.assert", { type: await relationOf(tomas, "opposes"), source: counter.id, target: claim.id, draw: true });
  await tomas.call("unit.check", { unit: claim.id, verdict: "checked" });
  await world.settle();
  assert.ok((await titles(mira)).includes("Flat above a threshold"));
  assert.equal((await mira.call("canvas.open", { id: canvas })).relations[opposes.id]?.state, "active");
  const seen = await mira.call("node.view", { id: claim.id });
  assert.equal(seen.checks?.length, 1);
  assert.equal(seen.checks![0]!.credit.name, "Tomas");
  assert.equal(seen.checks![0]!.mine, false);

  await tomas.call("relation.withdraw", { id: opposes.id });
  await world.settle();
  assert.equal(mira.core.graph().relations.get(opposes.id)?.state, "withdrawn");
});

test("evidence read from a paper travels with its source, and never with where the file is", async (t) => {
  const { world, mira, tomas, canvas } = await lab(t);
  await tomas.call("prefs.set", { zoteroLibrary: true });
  const cut = await tomas.call("pdf.cut", { ref: ZOTERO_FILE, exact: "the smallest testing error", page: 3, title: "The smallest error is at the edge", canvas });
  await world.settle();
  const seen = await mira.call("node.view", { id: cut.node.id });
  assert.equal(seen.node.card.source?.name, "Carroll 2020", "Mira sees which paper it came from");
  assert.equal(seen.node.card.library, undefined, "and no mark for a library that is Tomas's");
  assert.ok(!JSON.stringify(tomas.sent).includes("/Users/reader"));
});

test("a card that outlives its unit is not shown", async (t) => {
  const { world, mira, tomas, canvas, evidence, cards, titles } = await lab(t);
  // Mira removes her evidence while Tomas, apart, moves its card. His move is the later change to the card.
  await mira.call("node.remove", { id: evidence.id });
  // A real wait: his change has to be stamped later than hers to be the later one.
  await new Promise((done) => setTimeout(done, 5));
  const held = (await tomas.call("canvas.open", { id: canvas })).items.find((item) => item.id === cards.evidence)!;
  await tomas.call("canvas.write", { canvas, upserts: [{ id: cards.evidence, z: held.z, item: { ...(held.item as object), x: 900 } as never }] });
  await world.settle();
  for (const vault of [mira, tomas]) {
    assert.deepEqual(await titles(vault), ["Actin rises with tension"]);
    assert.ok(!(await vault.call("canvas.open", { id: canvas })).items.some((item) => item.id === cards.evidence), `${vault.name} sees no card for it`);
  }
});
