import assert from "node:assert/strict";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { createEvaluation, type Author, type EvaluationRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { unitCid } from "@dg/core/process.ts";

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async () => {
  const store = createMemoryStore();
  const { host, emit } = createMemoryHost({ store });
  const core = await createCore({ host });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  return { core, call, store, settle, host, emit };
};

test("a unit is signed by its author, and the mark holds only for the version it was made on", async () => {
  const { call, core, settle } = await setup();
  const unit = await call("node.create", { title: "Actin tracks tension" });
  assert.equal(unit.checked, undefined);
  assert.deepEqual((await call("node.view", { id: unit.id })).checks, []);

  const [mark] = await call("unit.check", { unit: unit.id, verdict: "checked", way: "dataReanalyzed", note: "  Reran the fits  " });
  assert.equal(mark!.verdict, "checked");
  assert.equal(mark!.way, "dataReanalyzed");
  assert.equal(mark!.note, "Reran the fits");
  assert.equal(mark!.mine, true);
  assert.equal(mark!.own, true, "the author marking their own unit is signing it");
  assert.equal(mark!.current, true);
  const record = [...core.graph().documents.values()].find((item): item is EvaluationRecord => item.kind === "evaluation")!;
  assert.equal(record.term, "endorsed");
  assert.match(record.targetCid ?? "", /^bafkrei/, "pinned to a hash of the unit as it stood");
  assert.equal((await call("node.view", { id: unit.id })).node.checked, "checked");

  // The unit is reworded. The mark was made on other words, and says so.
  await call("node.rename", { id: unit.id, title: "Actin scales with tension" });
  await call("node.view", { id: unit.id });
  await settle();
  const after = await call("node.view", { id: unit.id });
  assert.equal(after.checks![0]!.current, false);
  assert.equal(after.node.checked, "changed");

  // Checking it again replaces the old mark with one on the new words.
  const again = await call("unit.check", { unit: unit.id, verdict: "checked" });
  assert.equal(again.length, 1, "one standing mark per person");
  assert.equal(again[0]!.current, true);
  assert.equal(again[0]!.way, "expertJudgment");
  assert.equal((await call("node.view", { id: unit.id })).node.checked, "checked");

  assert.deepEqual(await call("unit.uncheck", { id: again[0]!.id }), []);
  assert.equal((await call("node.view", { id: unit.id })).node.checked, undefined);
});

test("sending a unit back needs a reason, and outweighs a check on the same version", async () => {
  const { call, core, settle, host, emit } = await setup();
  const unit = await call("node.create", { title: "The band is absent" });
  await assert.rejects(call("unit.check", { unit: unit.id, verdict: "needsWork" }), /Say what needs work/);
  await call("unit.check", { unit: unit.id, verdict: "checked" });

  // A second person, the PI, looks at the same version and sends it back.
  const pi: Author = { id: "did:plc:pi", name: "Pat Investigator" };
  const node = core.graph().documents.get(unit.id) as never;
  // Their mark arrives the way a labmate's record does: written to the base by another device.
  await host.putRecords({ records: [createEvaluation({ space: "lab", by: pi, fields: { target: unit.id, targetCid: await unitCid(node), method: "sourceRead", term: "needsWork", note: "The loading control is missing" } })] });
  emit({ type: "records-changed" });
  await settle();
  await call("node.view", { id: unit.id });
  await settle();
  const view = await call("node.view", { id: unit.id });
  assert.equal(view.checks!.length, 2);
  const theirs = view.checks!.find((check) => !check.mine)!;
  assert.equal(theirs.credit.name, "Pat Investigator");
  assert.equal(theirs.own, false, "a second pair of eyes, not the author");
  assert.equal(theirs.verdict, "needsWork");
  assert.equal(view.node.checked, "needsWork");
  await assert.rejects(call("unit.uncheck", { id: theirs.id }), /Only the person who made a mark/);
});
