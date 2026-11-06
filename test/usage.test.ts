import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { neverRejects } from "@dg/contract/host.ts";
import { withUsageLog, type UsageEvent } from "@dg/contract/usage.ts";

test("usage logging records outcomes and never content", async () => {
  const events: UsageEvent[] = [];
  const { host } = createMemoryHost({ store: createMemoryStore() });
  const logged = withUsageLog({ host, record: (event) => events.push(event) });
  await logged.createText({ title: "Unpublished result", body: "Secret finding" });
  await logged.readText({ ref: "missing" });
  assert.deepEqual(
    events.map(({ op, ok, code }) => ({ op, ok, code })),
    [
      { op: "createText", ok: true, code: undefined },
      { op: "readText", ok: false, code: "not-found" },
    ],
  );
  assert.ok(!JSON.stringify(events).includes("Secret"));
  assert.ok(!JSON.stringify(events).includes("Unpublished"));
});

test("a thrown error from a base becomes a returned failure", async () => {
  const { host } = createMemoryHost({ store: createMemoryStore() });
  const guarded = neverRejects({
    ...host,
    createText: async () => {
      throw new Error("maximum mutation rate limit exceeded");
    },
  });
  const result = await guarded.createText({ title: "x" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.code === "unavailable");
  assert.ok(!result.ok && result.error.message.includes("rate limit"));
});
