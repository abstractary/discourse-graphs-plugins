import assert from "node:assert/strict";
import test from "node:test";
import { createNode } from "@dg/contract/records.ts";
import { normalDoi, sameDoi } from "@dg/contract/scholarly.ts";
import { unitCid } from "@dg/core/process.ts";

test("a DOI is the same however it was written", () => {
  assert.equal(normalDoi("https://doi.org/10.1063/5.0038163"), "10.1063/5.0038163");
  assert.equal(normalDoi("doi:10.1016/J.JAUT.2016.06.001"), "10.1016/j.jaut.2016.06.001");
  assert.ok(sameDoi("10.1016/J.JAUT.2016.06.001", "https://dx.doi.org/10.1016/j.jaut.2016.06.001"));
  assert.ok(!sameDoi("10.1/a", "10.1/b"));
  assert.ok(!sameDoi(undefined, undefined), "two papers with no DOI are not thereby the same paper");
});

test("checking a paper with the registries doesn't make its units look edited", async () => {
  const unit = createNode({ space: "s", by: { id: "did:plc:me", name: "Me" }, title: "A source", facts: { doi: "10.1/x" } });
  const checked = { ...unit, facts: { ...unit.facts, standing: { checkedAt: "2026-11-13T00:00:00Z", services: [], citedBy: 87 } } } as typeof unit;
  assert.equal(await unitCid(checked), await unitCid(unit));
  assert.notEqual(await unitCid({ ...unit, title: "Another source" }), await unitCid(unit));
});
