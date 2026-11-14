import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createNode, type DgRecord } from "@dg/contract/records.ts";
import { createCore } from "@dg/core/index.ts";
import { QUOTED, readTools } from "../local/src/mcp-tools.ts";
import { openVault } from "../local/src/vault.ts";
import { makeCore } from "./support.ts";

// The six tools an agent reads with, first against a core in memory and then through a real MCP
// client talking to the server over stdio.

const OTHER = { id: "did:plc:someoneelse", name: "Someone Else" };

const seeded = async (options: { widen?: boolean; modelHere?: boolean } = {}) => {
  const made = await makeCore();
  const { call, core } = made;
  const grammar = await call("grammar.get", {});
  const typeOf = (base: string) => grammar.nodeTypes.find((type) => type.base === base)!.id;
  const relation = (base: string) => grammar.relationTypes.find((type) => type.base === base)!.id;
  const claim = await call("node.create", { title: "Shared boards help newcomers start", type: typeOf("claim") });
  const support = await call("node.create", { title: "Newcomers with a board opened a first issue sooner", type: typeOf("evidence") });
  const against = await call("node.create", { title: "One lab saw no change after adding a board", type: typeOf("evidence") });
  await call("relation.assert", { type: relation("supports"), source: support.id, target: claim.id });
  await call("relation.assert", { type: relation("opposes"), source: against.id, target: claim.id });
  const canvas = await call("canvas.create", { title: "Onboarding" });
  await core.addToCanvas({ canvas: canvas.id, nodes: [claim.id, support.id] });
  // Someone else's unit, as it would sit in the log after a lab exchange.
  const theirs = createNode({ space: core.info.space.id, by: OTHER, title: "A labmate's claim about onboarding", type: typeOf("claim") });
  made.store.records.push(theirs);
  made.emit({ type: "records-changed" });
  await made.arrive(theirs);
  const tools = Object.fromEntries(readTools({ core, call, ...options }).map((tool) => [tool.name, tool]));
  return { ...made, tools, claim, support, against, canvas, theirs };
};

test("there are six tools, each says what it takes and returns, and none writes", async () => {
  const { tools, nodes, core } = await seeded();
  assert.deepEqual(Object.keys(tools), ["dg_search", "dg_unit", "dg_argument", "dg_canvas", "dg_paper", "dg_grammar"]);
  for (const tool of Object.values(tools)) {
    assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/, "a name every client accepts");
    assert.ok(tool.description.length > 80, `${tool.name} says when to use it`);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema.type, "object");
  }
  const before = { units: nodes().length, relations: core.graph().relations.size, documents: core.graph().documents.size };
  for (const tool of Object.values(tools)) await tool.run({}).catch(() => undefined);
  assert.deepEqual({ units: nodes().length, relations: core.graph().relations.size, documents: core.graph().documents.size }, before);
});

test("search finds units by words, type, person and date, and pages", async () => {
  const { tools, claim } = await seeded();
  const search = tools.dg_search!;
  const byWords = (await search.run({ query: "newcomers" })) as { units: { id: string; text: string }[]; total: number; note: string };
  assert.ok(byWords.units.some((unit) => unit.id === claim.id));
  assert.equal(byWords.note, QUOTED);
  const claims = (await search.run({ type: "claim" })) as { units: { id: string }[]; total: number };
  assert.deepEqual(claims.units.map((unit) => unit.id), [claim.id]);
  assert.equal(((await search.run({ by: "me" })) as { total: number }).total, 3);
  assert.equal(((await search.run({ since: "2999-01-01" })) as { total: number }).total, 0);
  const first = (await search.run({ limit: 2 })) as { units: unknown[]; total: number; more?: string };
  assert.equal(first.units.length, 2);
  assert.equal(first.total, 3);
  assert.match(first.more!, /offset 2/);
  assert.equal(((await search.run({ limit: 2, offset: 2 })) as { units: unknown[] }).units.length, 1);
});

test("a unit comes back with its relations, and an argument as a tree with what is contested", async () => {
  const { tools, claim, support, against } = await seeded();
  const one = (await tools.dg_unit!.run({ id: claim.id })) as { unit: { text: string; mine: boolean }; relations: { reads: string; other: { id: string } }[] };
  assert.equal(one.unit.text, "Shared boards help newcomers start");
  assert.equal(one.unit.mine, true);
  assert.deepEqual(one.relations.map((relation) => relation.other.id).sort(), [support.id, against.id].sort());
  const tree = (await tools.dg_argument!.run({ id: claim.id })) as { root: { under: { how: string; id: string }[] }; summary: Record<string, number> };
  assert.deepEqual(tree.root.under.map((item) => [item.how, item.id]).sort(), [["opposes", against.id], ["supports", support.id]].sort());
  assert.deepEqual({ ...tree.summary }, { units: 3, supporting: 1, opposing: 1, contested: 1, unchecked: 3, changedSinceChecked: 0, cutShort: 0 });
  await assert.rejects(tools.dg_unit!.run({ id: "nothing" }), /dg_search/);
});

test("canvases, papers and the grammar read out", async () => {
  const { tools, canvas, claim, support } = await seeded();
  const list = (await tools.dg_canvas!.run({})) as { canvases: { id: string; title: string; cards: number }[] };
  assert.deepEqual(list.canvases.map((item) => [item.title, item.cards]), [["Onboarding", 2]]);
  const one = (await tools.dg_canvas!.run({ id: canvas.id })) as { units: { id: string }[] };
  assert.deepEqual(one.units.map((unit) => unit.id).sort(), [claim.id, support.id].sort());
  assert.deepEqual(((await tools.dg_paper!.run({})) as { papers: unknown[] }).papers, []);
  const grammar = (await tools.dg_grammar!.run({})) as { types: { name: string; kind?: string; units: number }[]; relations: { name: string; joins: { from: string; to: string }[] }[] };
  assert.equal(grammar.types.find((type) => type.kind === "evidence")!.units, 2);
  const supports = grammar.relations.find((item) => item.name.toLowerCase().startsWith("support"))!;
  assert.ok(supports.joins.length > 0 && supports.joins.every((rule) => rule.from && rule.to));
});

test("an agent reads its person's own work until it is let further, and then only as far as the lab's reach", async () => {
  const narrow = await seeded();
  const all = (await narrow.tools.dg_search!.run({})) as { units: { id: string }[]; scope: string };
  assert.ok(!all.units.some((unit) => unit.id === narrow.theirs.id), "someone else's unit is not read out");
  assert.match(all.scope, /own work only/i);
  await assert.rejects(narrow.tools.dg_unit!.run({ id: narrow.theirs.id }));

  const wide = await seeded({ widen: true });
  const more = (await wide.tools.dg_search!.run({})) as { units: { id: string }[] };
  assert.ok(more.units.some((unit) => unit.id === wide.theirs.id), "let further, and in no lab that says otherwise");

  // In a lab, whose reach is its own servers unless its PI says otherwise, a model elsewhere is not read to.
  await wide.call("lab.create", { name: "Board Lab" });
  const inLab = (await wide.tools.dg_search!.run({})) as { units: { id: string }[]; scope: string };
  assert.ok(!inLab.units.some((unit) => unit.id === wide.theirs.id));
  assert.match(inLab.scope, /wasn't said to run on this computer/);
  const here = Object.fromEntries(readTools({ core: wide.core, call: wide.call, widen: true, modelHere: true }).map((tool) => [tool.name, tool]));
  assert.ok(((await here.dg_search!.run({})) as { units: { id: string }[] }).units.some((unit) => unit.id === wide.theirs.id));
});

test("a real MCP client lists the tools and calls them over stdio", async (t) => {
  const vault = mkdtempSync(join(tmpdir(), "dg-mcp-"));
  const keys = join(vault, ".keys");
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  execFileSync(process.execPath, ["local/src/seed.ts", vault]);
  // The vault's person, through the local app's own way in, writes a claim of her own.
  const opened = openVault({ vault, keys: join(keys, "app"), name: "Mira" });
  const core = await createCore({ host: opened.host, keys: opened.keys });
  const made = await core.capture({ text: "Boards only help when someone tends them" });
  assert.equal(made.ok, true);
  core.stop();
  opened.stop();

  const transport = new StdioClientTransport({ command: process.execPath, args: ["local/src/mcp.ts", "--vault", vault, "--keys", join(keys, "agent"), "--name", "Test agent"], stderr: "ignore" });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name), ["dg_search", "dg_unit", "dg_argument", "dg_canvas", "dg_paper", "dg_grammar"]);
  assert.ok(tools.every((tool) => tool.outputSchema && tool.annotations?.readOnlyHint === true));

  const found = await client.callTool({ name: "dg_search", arguments: { query: "tends" } });
  const result = found.structuredContent as { units: { id: string; text: string; mine?: boolean }[]; total: number };
  assert.equal(result.total, 1);
  assert.equal(result.units[0]!.text, "Boards only help when someone tends them");
  assert.equal(result.units[0]!.mine, true, "the agent reads as the vault's person");

  const everything = (await client.callTool({ name: "dg_search", arguments: { limit: 100 } })).structuredContent as { total: number };
  assert.equal(everything.total, 1, "the worked example is other people's, and this agent was not let further");

  const missing = await client.callTool({ name: "dg_unit", arguments: { id: "nothing" } });
  assert.equal(missing.isError, true);

  // The agent is one more device in the log, waiting to be let in, and it wrote nothing else.
  const logs = readdirSync(join(vault, "discourse-graph/records")).filter((name) => name.startsWith("agent-"));
  assert.equal(logs.length, 1);
  const written = readFileSync(join(vault, "discourse-graph/records", logs[0]!), "utf8").trim().split("\n").map((line) => JSON.parse(line) as DgRecord);
  assert.deepEqual(written.map((record) => record.kind), ["device"]);
  assert.equal((written[0] as Extract<DgRecord, { kind: "device" }>).role, "agent");
});
