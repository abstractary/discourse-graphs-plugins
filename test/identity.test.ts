import assert from "node:assert/strict";
import test from "node:test";
import * as plc from "@did-plc/lib";
import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { createCore } from "@dg/core/index.ts";
import { addCustodian, createIdentity, createLabIdentity, memoryKeys } from "@dg/core/identity.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { isUnitId, isTid, splitUnitId, tid } from "@dg/contract/ids.ts";

test("TIDs meet the AT Protocol syntax and always rise", () => {
  const ids = Array.from({ length: 2000 }, tid);
  assert.ok(ids.every(isTid));
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, ids.length);
});

test("a DID computed offline is valid to the reference PLC library", async () => {
  const keys = memoryKeys();
  const identity = await createIdentity(keys);
  assert.match(identity.did, /^did:plc:[a-z2-7]{24}$/);
  await plc.assureValidCreationOp(identity.did, identity.plc[0] as never);
});

test("signatures stay low-S across many keys", async () => {
  for (let round = 0; round < 12; round += 1) {
    const identity = await createIdentity(memoryKeys());
    await plc.assureValidCreationOp(identity.did, identity.plc[0] as never);
  }
});

test("a lab's DID can only be changed by the PI's key", async () => {
  const keys = memoryKeys();
  const pi = await createIdentity(keys);
  const lab = await createLabIdentity({ keys, custodian: pi });
  await plc.assureValidCreationOp(lab.did, lab.plc[0] as never);
  assert.deepEqual(lab.plc[0]!.rotationKeys, [pi.rotationKey]);
});

test("joining a lab ranks the PI's key above the member's, in a valid operation", async () => {
  const keys = memoryKeys();
  const pi = await createIdentity(keys);
  const member = await createIdentity(keys);
  const joined = await addCustodian({ keys, identity: member, custodianKey: pi.rotationKey });
  const [first, second] = joined.plc;
  assert.equal(joined.did, member.did);
  assert.deepEqual(second!.rotationKeys, [pi.rotationKey, member.rotationKey]);
  await plc.assureValidSig([member.rotationKey], second as never);
  const cid = CID.createV1(dagCbor.code, await sha256.digest(dagCbor.encode(first)));
  assert.equal(second!.prev, cid.toString());
});

const core = (store = createMemoryStore(), keys = memoryKeys()) =>
  createCore({ host: createMemoryHost({ store }).host, keys });

test("every record gets a DID and TID id, with no duplicates", async () => {
  const ready = await core();
  const did = ready.identity().did;
  const ids = [...ready.graph().documents.keys()];
  assert.ok(ids.length > 5);
  assert.ok(ids.every((id) => isUnitId(id) && splitUnitId(id).did === did));
  assert.equal(new Set(ids).size, ids.length);
});

test("the same person keeps one DID on a second device", async () => {
  const store = createMemoryStore();
  const first = await core(store);
  const second = await core(store, memoryKeys());
  assert.equal(second.identity().did, first.identity().did);
});

test("setting up a lab makes the author its custodian and credits new units", async () => {
  const ready = await core();
  const view = await ready.createLab("Akamatsu Lab");
  assert.equal(view.lab?.custodian, ready.identity().did);
  const captured = await ready.capture({ text: "A claim" });
  assert.ok(captured.ok);
  const node = ready.graph().documents.get(captured.value.node);
  assert.equal(node?.lab, view.lab?.did);
});

test("a member joins by choice, and the PI can then withdraw their relation", async () => {
  const store = createMemoryStore();
  const pi = await core(store);
  await pi.createLab("Akamatsu Lab");
  const { host: otherHost } = createMemoryHost({ store });
  const member = await createCore({
    host: { ...otherHost, describe: async () => {
      const info = await otherHost.describe();
      return info.ok ? { ...info, value: { ...info.value, person: { id: "someone-else", name: "Student" } } } : info;
    } },
    keys: memoryKeys(),
  });
  assert.ok(member.identity().availableLab, "the lab is offered");
  assert.equal(member.identity().lab, undefined, "joining is not automatic");
  await member.joinLab();
  assert.equal(member.identity().lab?.custodian, pi.identity().did);
  assert.equal(member.plc().length, 2);
});
