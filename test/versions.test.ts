import assert from "node:assert/strict";
import test from "node:test";
import { createNode, foldRecords, revise, versionKey, type DgRecord, type NodeRecord, type PersonRecord } from "@dg/contract/records.ts";
import { createIdentity, memoryKeys } from "@dg/core/identity.ts";
import { createDevice } from "@dg/contract/records.ts";
import { didKeyFor, makeKeys } from "@dg/core/identity.ts";
import { checkSignatures, signRecord, trustedKeys, vouchFor } from "@dg/core/signing.ts";

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
  const { kept, refused } = await checkSignatures([unit, forged, bare, stranger], { persons: [person] });
  assert.deepEqual(kept.map((record) => (record as NodeRecord).title), ["Signed by Mira", "From outside the lab"], "a writer nobody has a key for can't be checked, and can't pass for a labmate");
  assert.deepEqual(refused.map((record) => (record as NodeRecord).title), ["Not what she wrote", "No signature at all"]);

  // A person record that claims a DID its own first operation doesn't hash to proves nothing.
  const other = await createIdentity(memoryKeys());
  const lying = { ...person, plc: other.plc };
  assert.equal((await checkSignatures([forged], { persons: [lying] })).kept.length, 1, "with no key that holds up, the record can't be checked");
  // A revision drops the old signature, so a stale one is never carried forward.
  assert.equal(revise({ record: unit, changes: { title: "Next" }, by: author }).sig, undefined);
});

test("a second device signs as its person only once a trusted device has vouched for it", async () => {
  const keys = memoryKeys();
  const who = await createIdentity(keys);
  const author = { id: who.did, name: "Mira" };
  const person = { id: `${who.did}#p`, kind: "person", did: who.did, plc: who.plc, by: author, editedBy: author, rev: 1 } as unknown as PersonRecord;
  const first = (await keys.get(`signing:${who.did}`))!;
  const [rootKey] = await trustedKeys(person, []);

  // The laptop makes a key of its own and asks.
  const laptop = await makeKeys(keys);
  const laptopKey = await didKeyFor(laptop);
  const asking = await signRecord(createDevice({ space: "s", by: author, key: laptopKey, name: "Laptop" }), laptop);
  const written = await signRecord(createNode({ space: "s", by: author, title: "Written on the laptop" }), laptop);
  assert.deepEqual(await trustedKeys(person, [asking]), [rootKey], "asking is not being let in");
  assert.equal((await checkSignatures([written], { persons: [person], devices: [asking] })).refused.length, 1);
  assert.equal((await checkSignatures([asking], { persons: [person] })).kept.length, 1, "the request itself travels, signed with the key it asks for");

  // The first device vouches. Now the laptop's signature holds, including on what it wrote before.
  const let_in = { ...asking, vouch: await vouchFor({ did: who.did, key: laptopKey, by: rootKey!, pair: first }) };
  assert.deepEqual(await trustedKeys(person, [let_in]), [rootKey, laptopKey]);
  assert.equal((await checkSignatures([written], { persons: [person], devices: [let_in] })).kept.length, 1);

  // A vouch can't be made by a key that isn't trusted, or moved to another key.
  const stranger = await makeKeys(keys);
  const strangerKey = await didKeyFor(stranger);
  const selfMade = { ...asking, key: strangerKey, vouch: await vouchFor({ did: who.did, key: strangerKey, by: strangerKey, pair: stranger }) };
  const moved = { ...asking, key: strangerKey, vouch: let_in.vouch };
  assert.deepEqual(await trustedKeys(person, [selfMade, moved]), [rootKey]);
  // The laptop can let a third device in, and taking the laptop out takes its word with it.
  const phone = await makeKeys(keys);
  const phoneKey = await didKeyFor(phone);
  const third = { ...createDevice({ space: "s", by: author, key: phoneKey, name: "Phone" }), vouch: await vouchFor({ did: who.did, key: phoneKey, by: laptopKey, pair: laptop }) };
  assert.deepEqual(await trustedKeys(person, [third, let_in]), [rootKey, laptopKey, phoneKey]);
  assert.deepEqual(await trustedKeys(person, [third, { ...let_in, removed: true }]), [rootKey]);

  // A labmate whose own record hasn't arrived: what they wrote waits, and is checked when it does.
  const early = await checkSignatures([written], { persons: [], members: new Set([who.did]) });
  assert.deepEqual([early.kept.length, early.held.length], [0, 1]);
});

test("on a canvas an edit made apart from a removal stands, and for access the removal does", () => {
  const item = { v: 2, id: "did:plc:mira#3aaaaaaaaaaaa", kind: "canvas-item", space: "s", at: at(0), by: mira, rev: 1, editedAt: at(0), editedBy: mira, canvas: "c", z: 1, item: { id: "i", type: "text", text: "x", x: 0, y: 0, width: 1, height: 1 } } as unknown as DgRecord & { rev: number; editedAt: string; editedBy: typeof mira };
  const taken = revise({ record: item as never, changes: { removed: true } as never, by: mira, at: at(9) }) as DgRecord;
  const moved = revise({ record: item as never, changes: { z: 2 } as never, by: tomas, at: at(5) }) as DgRecord;
  const seen = (records: DgRecord[]): unknown => (foldRecords({ records, localSpace: "s" }).documents.get(item.id) as { removed?: boolean; z: number });
  assert.deepEqual([(seen([item, taken, moved]) as { removed?: boolean }).removed, (seen([moved, taken, item]) as { z: number }).z], [undefined, 2], "the move stands though the removal is later");
  // Taken off after seeing the move: now it is gone.
  const again = revise({ record: moved as never, changes: { removed: true } as never, by: mira, at: at(12) }) as DgRecord;
  assert.equal((seen([item, taken, moved, again]) as { removed?: boolean }).removed, true);

  // A membership the lab's custodian ended, against the member's own edit made apart: it stays ended, and the member can't bring it back.
  const lab = { v: 2, id: "did:plc:mira#3bbbbbbbbbbbb", kind: "lab", space: "s", at: at(0), by: mira, rev: 1, editedAt: at(0), editedBy: mira, name: "L", did: "did:plc:lab", custodian: mira.id, custodianKey: "k", plc: [] } as unknown as DgRecord;
  const joined = { v: 2, id: "did:plc:tomas#3ccccccccccccc".slice(0, 28), kind: "membership", space: "s", at: at(1), by: tomas, rev: 1, editedAt: at(1), editedBy: tomas, lab: "did:plc:lab", member: tomas.id } as unknown as DgRecord;
  const ended = revise({ record: joined as never, changes: { removed: true } as never, by: mira, at: at(3) }) as DgRecord;
  const apart = revise({ record: joined as never, changes: {} as never, by: tomas, at: at(8) }) as DgRecord;
  const undone = revise({ record: ended as never, changes: { removed: false } as never, by: tomas, at: at(10) }) as DgRecord;
  const membership = foldRecords({ records: [lab, joined, ended, apart, undone], localSpace: "s" }).documents.get(joined.id) as { removed?: boolean };
  assert.equal(membership.removed, true);
});

test("a card from before versions were linked can still be taken off", () => {
  // Made, then moved, by an app that didn't yet say which version each replaced. Then taken off by this one.
  const made = { v: 2, id: "did:plc:mira#3ddddddddddd2", kind: "canvas-item", space: "s", at: at(0), by: mira, rev: 1, editedAt: at(0), editedBy: mira, canvas: "c", z: 1, item: { id: "i", type: "group", label: "Evidence", x: 0, y: 0, width: 1, height: 1 } } as unknown as DgRecord;
  const movedOld = { ...made, rev: 2, editedAt: at(1), z: 2 } as DgRecord;
  const taken = revise({ record: movedOld as never, changes: { removed: true } as never, by: mira, at: at(5) }) as DgRecord;
  for (const records of [[made, movedOld, taken], [taken, made, movedOld]]) {
    assert.equal((foldRecords({ records, localSpace: "s" }).documents.get(made.id) as { removed?: boolean }).removed, true);
  }
});

test("what an agent's key signs is a proposal, and never changes what a person wrote", () => {
  const AGENT = "did:key:zAgentKey";
  const device = { ...createDevice({ space: "s", by: mira, key: AGENT, name: "Reading agent", role: "agent", at: at(0) }), sigBy: AGENT } as DgRecord;
  const hers = createNode({ space: "s", by: mira, title: "Mira's claim", at: at(1) });
  const proposed = { ...createNode({ space: "s", by: mira, title: "The agent's claim", at: at(2) }), sigBy: AGENT } as DgRecord;
  const reworded = { ...revise({ record: hers, changes: { title: "The agent rewrote it" }, by: mira, at: at(3) }), sigBy: AGENT } as DgRecord;
  const removed = { ...revise({ record: hers, changes: { removed: true }, by: mira, at: at(4) }), sigBy: AGENT } as DgRecord;
  const itsOwn = { ...revise({ record: proposed as NodeRecord, changes: { title: "The agent's claim, tightened" }, by: mira, at: at(5) }), sigBy: AGENT } as DgRecord;
  const lab = { v: 2, id: "did:plc:mira#3eeeeeeeeeeee", kind: "lab", space: "s", at: at(0), by: mira, rev: 1, editedAt: at(0), editedBy: mira, name: "L", did: "did:plc:lab", custodian: mira.id, custodianKey: "k", plc: [], sigBy: AGENT } as unknown as DgRecord;

  const graph = foldRecords({ records: [device, hers, proposed, reworded, removed, itsOwn, lab], localSpace: "s" });
  const mine = graph.documents.get(hers.id) as NodeRecord;
  assert.deepEqual([mine.title, mine.removed], ["Mira's claim", undefined], "her unit is as she left it");
  assert.equal(graph.documents.has(proposed.id), false, "the proposal is not part of the graph");
  assert.equal((graph.proposals.get(proposed.id)!.record as NodeRecord).title, "The agent's claim, tightened", "an agent may change what it proposed itself");
  assert.equal(graph.documents.has(lab.id), false, "and it can't make a lab, or anything but units, relations and checks");
  // The agent, reading the same vault, sees what it proposed in place.
  assert.ok(foldRecords({ records: [device, hers, proposed], localSpace: "s", ownKey: AGENT }).documents.has(proposed.id));
});
