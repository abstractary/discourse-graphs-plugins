import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertRelation, createNode, type DgRecord, type NodeRecord, type RelationTypeRecord } from "@dg/contract/records.ts";

// The local app opens a vault the way the Obsidian plugin does: every device's
// log in discourse-graph/records, and its own log as one more device.
const LAB = "did:web:lab.records.example";
const PORT = 18796;

const call = async (method: string, params: unknown): Promise<{ ok: boolean; result: never }> => {
  const response = await fetch(`http://127.0.0.1:${PORT}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tab: "test", id: `t${Math.random()}`, method, params }),
  });
  return (await response.json()) as { ok: boolean; result: never };
};

const waitFor = async (check: () => Promise<boolean>, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    // A real wait between looks: this asks another process, over the network, whether it is up yet.
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
};

test("the local app reads a vault's logs, sees another device's writes, and writes its own", async (t) => {
  const vault = mkdtempSync(join(tmpdir(), "dg-local-"));
  execFileSync(process.execPath, ["local/src/seed.ts", vault]);
  if (!existsSync("dist/local.html")) execFileSync(process.execPath, ["scripts/build-local.mjs"]);
  const server = spawn(process.execPath, ["local/src/main.ts", "--vault", vault, "--port", String(PORT), "--keys", join(vault, ".keys")], { stdio: "ignore" });
  t.after(() => {
    server.kill();
    rmSync(vault, { recursive: true, force: true });
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/about`)).ok);

  const roots = await call("holon.roots", {});
  assert.equal(roots.ok, true);
  const [root] = roots.result as { ref: { level: string; id: string }; title: string }[];
  assert.equal(root!.title, "Akamatsu Lab");

  // Obsidian, as another device, adds a claim to the lab's question.
  const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
  const question = records.find((r): r is NodeRecord => r.kind === "node" && r.title.startsWith("How does a shared issue board"))!;
  const claimType = records.find((r) => r.kind === "node-type" && r.base === "claim")!;
  const addresses = records.find((r): r is RelationTypeRecord => r.kind === "relation-type" && r.base === "addresses")!;
  const stamp = { space: "matsulab", by: { id: "did:web:student.example", name: "Student" }, lab: LAB };
  const claim = createNode({ ...stamp, title: "Issue boards help newcomers find a first project", type: claimType.id });
  const link = assertRelation({ ...stamp, type: addresses.id, source: claim.id, target: question.id });
  appendFileSync(join(vault, "discourse-graph/records/obsidian-device.jsonl"), `${JSON.stringify(claim)}\n${JSON.stringify(link)}\n`);
  await waitFor(async () => {
    const view = await call("holon.view", { ref: { level: "question", id: question.id }, stance: "lab" });
    return (view.result as { parts: unknown[] }).parts.length === 5;
  });

  // A release this app makes lands in its own device log, where Obsidian reads it.
  const shelf = (await call("repository.canvases", {})).result as { id: string; title: string; nested: string[] }[];
  const canvas = shelf.find((c) => c.title.startsWith("Issue exchange"))!;
  assert.equal(canvas.nested.length, 1);
  const release = await call("canvas.release", { id: canvas.id, name: "v1" });
  assert.equal(release.ok, true);
  const logs = readdirSync(join(vault, "discourse-graph/records")).filter((f) => f.startsWith("local-"));
  assert.equal(logs.length, 1);
  assert.ok(readFileSync(join(vault, "discourse-graph/records", logs[0]!), "utf8").includes('"kind":"release"'));

  // Each canvas is mirrored as JSON Canvas, with the nested one as a file node Obsidian opens.
  await waitFor(async () => existsSync(join(vault, "discourse-graph/canvases/Issue exchange what the analysis shows.canvas")));
  const mirrored = JSON.parse(readFileSync(join(vault, "discourse-graph/canvases/Issue exchange what the analysis shows.canvas"), "utf8")) as { nodes: { type: string; file?: string }[] };
  assert.ok(mirrored.nodes.some((n) => n.type === "file" && n.file === "discourse-graph/canvases/EVD 7 from claim to the notebook.canvas"));
});
