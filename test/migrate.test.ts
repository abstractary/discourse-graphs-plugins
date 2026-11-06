import assert from "node:assert/strict";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import type { ExistingGraph } from "@dg/core/migrate.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";

const existing = (): ExistingGraph => ({
  nodeTypes: [
    { key: "res", label: "Result", format: "[[RES]] - {content} - {Source}" },
    { key: "clm", label: "Claim", format: "[[CLM]] - {content}", color: "#7DA13E" },
    { key: "exp", label: "Experiment", format: "@{content}" },
  ],
  relationTypes: [
    { key: "s1", label: "Supports", complement: "Supported By" },
    { key: "d1", label: "Derived From", complement: "Has Derivation" },
    { key: "d2", label: "Derived From", complement: "Has Derivation" },
  ],
  rules: [
    { relation: "s1", source: "res", target: "clm" },
    { relation: "d1", source: "res", target: "exp" },
    { relation: "d2", source: "exp", target: "exp" },
  ],
  nodes: [
    { key: "a", ref: "uid-a", title: "[[RES]] - 29% were claimed - [[@analysis/claiming]]", type: "res" },
    { key: "b", ref: "uid-b", title: "[[CLM]] - 29% of issues were claimed", type: "clm" },
    { key: "c", ref: "uid-c", title: "@analysis/claiming", type: "exp" },
  ],
  relations: [{ relation: "s1", source: "a", target: "b" }],
});

const setup = async () => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  return createCore({ host, titleFormat: (abbreviation) => `[[${abbreviation}]] - {content}` });
};

const nodesOf = (core: Awaited<ReturnType<typeof setup>>) =>
  [...core.graph().documents.values()].flatMap((item) => (item.kind === "node" ? [item] : []));

test("a dry run reports the plan and writes nothing", async () => {
  const core = await setup();
  const before = core.graph().documents.size;
  const report = await core.importExisting({ existing: existing(), dryRun: true });
  assert.equal(report.nodes.added, 3);
  assert.equal(core.graph().documents.size, before);
});

test("titles lose their format, and {Source} becomes a proposed relation", async () => {
  const core = await setup();
  const report = await core.importExisting({ existing: existing() });
  assert.deepEqual(nodesOf(core).map((node) => node.title).sort(), [
    "29% of issues were claimed",
    "29% were claimed",
    "analysis/claiming",
  ]);
  assert.equal(report.relations.asserted, 1);
  assert.equal(report.relations.proposed, 1);
  const states = [...core.graph().relations.values()].map(({ state }) => state).sort();
  assert.deepEqual(states, ["active", "pending"]);
});

test("a repeated relation label becomes one type with both rules", async () => {
  const core = await setup();
  await core.importExisting({ existing: existing() });
  const derived = [...core.graph().documents.values()].flatMap((item) =>
    item.kind === "relation-type" && item.base === "derivedFrom" ? [item] : [],
  );
  assert.equal(derived.length, 1);
  assert.equal(derived[0]!.rules.length, 3);
});

test("importing twice adds nothing", async () => {
  const core = await setup();
  await core.importExisting({ existing: existing() });
  const before = core.graph().documents.size;
  const report = await core.importExisting({ existing: existing() });
  assert.equal(report.nodes.added, 0);
  assert.equal(report.nodes.known, 3);
  assert.equal(report.relations.asserted + report.relations.proposed, 0);
  assert.equal(core.graph().documents.size, before);
});

test("a synced copy of a note is skipped and reported", async () => {
  const core = await setup();
  const graph = existing();
  graph.nodes.push({ key: "b", ref: "uid-b", title: "[[CLM]] - 29% of issues were claimed 2", type: "clm" });
  const report = await core.importExisting({ existing: graph });
  assert.equal(report.nodes.added, 3);
  assert.equal(report.nodes.skipped, 1);
  assert.ok(report.problems.some((text) => text.includes("copy")));
});

test("a node with an unknown type is reported, not guessed", async () => {
  const core = await setup();
  const graph = existing();
  graph.nodes.push({ key: "d", ref: "uid-d", title: "Mystery", type: "nope" });
  const report = await core.importExisting({ existing: graph });
  assert.equal(report.nodes.skipped, 1);
  assert.ok(report.problems.some((text) => text.includes("Mystery")));
});

test("an imported node keeps the date its text first appeared", async () => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const core = await createCore({ host });
  const graph = existing();
  graph.nodes[0]!.createdAt = "2023-04-01T10:00:00.000Z";
  await core.importExisting({ existing: graph });
  const dates = [...core.graph().documents.values()].filter((record) => record.kind === "node").map(({ at }) => at);
  assert.ok(dates.includes("2023-04-01T10:00:00.000Z"));
});
