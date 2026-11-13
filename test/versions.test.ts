import assert from "node:assert/strict";
import test from "node:test";
import { createNode, foldRecords, revise, versionKey, type DgRecord, type NodeRecord, type PersonRecord } from "@dg/contract/records.ts";
import { createIdentity, memoryKeys } from "@dg/core/identity.ts";
import { checkSignatures, signRecord } from "@dg/core/signing.ts";

// Which version of a record stands, and whose word a record is. First found wanting by the
// four-vault simulation, `node harness/four-vaults.ts`.

const mira = { id: "did:plc:mira", name: "Mira" };
const tomas = { id: "did:plc:tomas", name: "Tomas" };
const at = (seconds: number): string => new Date(Date.UTC(2026, 10, 13, 12, 0, seconds)).toISOString();
const title = (records: DgRecord[], id: string): string => (foldRecords({ records, localSpace: "s" }).documents.get(id) as NodeRecord).title;
const shuffled = <T>(list: T[], turn: number): T[] => list.map((item, index) => ({ item, key: (index * 7 + turn * 13) % list.length })).sort((a, b) => a.key - b.key).map(({ item }) => item);

test("a version beats what it replaces, and of two made apart the later stands", () => {
  const first = createNode({ space: "s", by: mira, title: "One", at: at(0) });
  // Mira rewords it twice. Then, without having seen either, she rewords it once more on another device, later.
  const second = revise({ record: first, changes: { title: "Two" }, by: mira, at: at(1) });
  const third = revise({ record: second, changes: { title: "Three" }, by: mira, at: at(2) });
  const apart = revise({ record: first, changes: { title: "Apart, and later" }, by: mira, at: at(3) });
  assert.equal(third.prev, versionKey(second));
  assert.equal(third.rev, 3);
  assert.equal(apart.rev, 2, "fewer edits behind it");
  const all = [first, second, third, apart];
  for (let turn = 0; turn < 6; turn += 1) assert.equal(title(shuffled(all, turn), first.id), "Apart, and later", "the later one stands, whatever the count of edits and whatever order they arrive in");
  // Without the later one, the end of the chain stands, even though an earlier version carries a later time.
  const skewed = { ...second, editedAt: at(50) };
  const chained = revise({ record: skewed, changes: { title: "After the skewed one" }, by: mira, at: at(2) });
  assert.ok(chained.editedAt > skewed.editedAt, "a new version is never stamped before the one it replaces");
  assert.equal(title([first, skewed, chained], first.id), "After the skewed one");
});

test("a unit's words are its author's, and a labmate can still add what is known about it", () => {
  const unit = createNode({ space: "s", by: mira, title: "Actin rises with tension", at: at(0) });
  const reworded = revise({ record: unit, changes: { title: "Tomas rewrote this" }, by: tomas, at: at(5) });
  const removed = revise({ record: unit, changes: { removed: true }, by: tomas, at: at(6) });
  const added = revise({ record: unit, changes: { facts: { doi: "10.1000/x" } }, by: tomas, at: at(7) });
  const onTop = revise({ record: reworded, changes: { facts: { doi: "10.1000/y" } }, by: tomas, at: at(8) });
  const folded = foldRecords({ records: [unit, reworded, removed, added, onTop], localSpace: "s" }).documents.get(unit.id) as NodeRecord;
  assert.equal(folded.title, "Actin rises with tension", "a labmate's rewording is never read");
  assert.equal(folded.removed, undefined, "nor their removal");
  assert.equal(folded.facts?.doi, "10.1000/x", "a fact they added stands. One added on top of their rewording doesn't");
  // Under someone else's name: the id says whose it is.
  const impostor = { ...unit, by: tomas, editedBy: tomas, title: "Mine now", editedAt: at(9), rev: 9 };
  assert.equal(title([unit, impostor], unit.id), "Actin rises with tension");
});

test("a record that says a labmate wrote it needs that labmate's signature", async () => {
  const keys = memoryKeys();
  const who = await createIdentity(keys);
  const author = { id: who.did, name: "Mira" };
  const person = { id: `${who.did}#p`, kind: "person", did: who.did, plc: who.plc, by: author, editedBy: author, rev: 1 } as unknown as PersonRecord;
  const pair = (await keys.get(`signing:${who.did}`))!;
  const unit = await signRecord(createNode({ space: "s", by: author, title: "Signed by Mira" }), pair);
  assert.match(unit.sig ?? "", /^[A-Za-z0-9_-]{86}$/);

  const forged = { ...unit, title: "Not what she wrote" };
  const bare = createNode({ space: "s", by: author, title: "No signature at all" });
  const stranger = createNode({ space: "s", by: { id: "did:plc:someoneelse", name: "Elsewhere" }, title: "From outside the lab" });
  const { kept, refused } = await checkSignatures([unit, forged, bare, stranger], [person]);
  assert.deepEqual(kept.map((record) => (record as NodeRecord).title), ["Signed by Mira", "From outside the lab"], "a writer nobody has a key for can't be checked, and can't pass for a labmate");
  assert.deepEqual(refused.map((record) => (record as NodeRecord).title), ["Not what she wrote", "No signature at all"]);

  // A person record that claims a DID its own first operation doesn't hash to proves nothing.
  const other = await createIdentity(memoryKeys());
  const lying = { ...person, plc: other.plc };
  assert.equal((await checkSignatures([forged], [lying])).kept.length, 1, "with no key that holds up, the record can't be checked");
  // A revision drops the old signature, so a stale one is never carried forward.
  assert.equal(revise({ record: unit, changes: { title: "Next" }, by: author }).sig, undefined);
});
