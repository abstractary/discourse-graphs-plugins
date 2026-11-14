import assert from "node:assert/strict";
import test from "node:test";
import type { SecretStore } from "@dg/contract/llm.ts";
import { SANDBOX } from "@dg/contract/publish.ts";
import { createNode, type NodeRecord } from "@dg/contract/records.ts";
import type { RepoWrite, Services } from "@dg/contract/services.ts";
import { makeCore } from "./support.ts";

// Publishing to a person's own repository: only on their word, only what they wrote, all in one
// commit, with a receipt for each record and a way to take it back.

const REPO = "did:plc:accountmadeelsewhere";

/** A repository that keeps what it is sent, and says what it was asked. */
const fakeRepo = () => {
  const commits: RepoWrite[][] = [];
  const held = new Map<string, Record<string, unknown>>();
  const opened: { host: string; identifier: string; password: string }[] = [];
  let turn = 0;
  const repo: Services["repo"] = {
    find: async ({ handle }) => ({ did: REPO, host: `https://host.example/${handle}` }),
    open: async (args) => (opened.push(args), { did: REPO, handle: args.identifier, access: "access-0", refresh: "refresh-0" }),
    renew: async ({ refresh }) => {
      assert.equal(refresh, `refresh-${turn}`, "the newest refresh token is the one used");
      turn += 1;
      return { did: REPO, handle: "mira.example", access: `access-${turn}`, refresh: `refresh-${turn}` };
    },
    write: async ({ repo: to, access, writes }) => {
      assert.equal(to, REPO);
      assert.equal(access, `access-${turn}`);
      commits.push(writes);
      return writes.map((write) => {
        const uri = `at://${to}/${write.collection}/${write.rkey}`;
        if (write.action === "delete") held.delete(uri);
        else held.set(uri, write.value);
        return { uri, cid: `cid-of-${write.rkey}-${commits.length}` };
      });
    },
    list: async ({ repo: of, collection }) => [...held].filter(([uri]) => uri.startsWith(`at://${of}/${collection}/`)).map(([uri, value]) => ({ uri, cid: "", value })),
  };
  return { repo, commits, held, opened };
};

const setup = async () => {
  const kept = new Map<string, string>();
  const secrets: SecretStore = { kind: "plain", get: async (id) => kept.get(id) ?? null, set: async (id, value) => void (value === null ? kept.delete(id) : kept.set(id, value)) };
  const fake = fakeRepo();
  const made = await makeCore({ services: { repo: fake.repo }, secrets });
  const { call, core } = made;
  const types = (await call("grammar.get", {})).nodeTypes;
  const typed = (label: string) => types.find((type) => type.label === label)!.id;
  const claim = await call("unit.create", { title: "Higher speed gives a clearer lysate", type: typed("Claim") });
  const evidence = await call("unit.create", { title: "At 16,000 g the supernatant is clear", type: typed("Evidence") });
  const option = (await call("relation.options", { source: evidence.id, target: claim.id }))[0]!;
  const relation = await call("relation.assert", { type: option.type, source: evidence.id, target: claim.id });
  // A labmate's unit, which is not this person's to publish.
  const theirs = createNode({ space: "space:theirs", by: { id: "did:plc:labmate", name: "Tomas" }, at: new Date().toISOString(), title: "A labmate's claim", type: typed("Claim") }) as NodeRecord;
  await made.host.putRecords({ records: [theirs] });
  await made.arrive(theirs);
  const canvas = await call("canvas.create", { title: "To publish" });
  await call("unit.put", { canvas: canvas.id, units: [claim.id, evidence.id, theirs.id] });
  return { ...made, ...fake, kept, claim, evidence, relation, theirs, canvas, me: core.identity().did };
};

test("a preview says what would go and what would not, and sends nothing", async () => {
  const { call, commits, claim, evidence, relation, theirs, canvas } = await setup();
  const preview = await call("publish.preview", { canvas: canvas.id });
  assert.deepEqual(preview.rows.map((row) => row.id).sort(), [claim.id, evidence.id, relation.id].sort());
  assert.ok(preview.rows.every((row) => row.state === "new" && row.collection.startsWith(`${SANDBOX}.`)));
  assert.deepEqual(preview.leftOut.map((entry) => [entry.id, entry.why]), [[theirs.id, "not-yours"]]);
  assert.equal(commits.length, 0);
});

test("sending needs an account, and the password is used once and not kept", async () => {
  const { call, opened, kept, canvas } = await setup();
  await assert.rejects(call("publish.send", { canvas: canvas.id }), /Connect an account/);
  const account = await call("publish.connect", { handle: "@mira.example", password: "app-pass-word" });
  assert.deepEqual(account.connected, { handle: "mira.example", did: REPO, host: "https://host.example/mira.example" });
  assert.equal(opened.length, 1);
  assert.deepEqual([...kept.values()], ["refresh-0"], "only the session's refresh token is kept");
});

test("one commit carries the units and the link between them, under their own ids at a new address", async () => {
  const { call, commits, held, claim, evidence, relation, canvas } = await setup();
  await call("publish.connect", { handle: "mira.example", password: "app-pass-word" });
  const sent = await call("publish.send", { canvas: canvas.id });
  assert.deepEqual([sent.sent, sent.unchanged, sent.commits], [3, 0, 1]);
  assert.equal(commits.length, 1);
  assert.ok(commits[0]!.every((write) => write.action === "create"));
  const uriOf = (id: string) => sent.published.find((entry) => entry.id === id)!.uri;
  for (const id of [claim.id, evidence.id, relation.id]) {
    assert.ok(uriOf(id).startsWith(`at://${REPO}/${SANDBOX}.`), uriOf(id));
    assert.equal(uriOf(id).split("/").at(-1), id.split("#")[1], "the record key is the unit's own");
    assert.equal(held.get(uriOf(id))!.dgId, id);
    assert.equal(held.get(uriOf(id))!.$type, uriOf(id).split("/")[3]);
  }
  // The link names its ends where they now are, not where this device would have put them.
  const link = JSON.stringify(held.get(uriOf(relation.id)));
  assert.ok(link.includes(uriOf(claim.id)) && link.includes(uriOf(evidence.id)), link);
});

test("sending again sends only what changed, and taking back removes it", async () => {
  const { call, commits, held, claim, evidence, canvas } = await setup();
  await call("publish.connect", { handle: "mira.example", password: "app-pass-word" });
  await call("publish.send", { canvas: canvas.id });
  assert.deepEqual((await call("publish.send", { canvas: canvas.id })).sent, 0);
  assert.equal(commits.length, 1, "nothing changed, so nothing was written");

  await call("unit.rename", { id: claim.id, title: "Higher speed gives a clearer lysate, up to 16,000 g" });
  const preview = await call("publish.preview", { canvas: canvas.id });
  assert.deepEqual(preview.rows.filter((row) => row.state === "changed").map((row) => row.id), [claim.id]);
  const again = await call("publish.send", { canvas: canvas.id });
  assert.equal(again.sent, 1);
  assert.deepEqual(commits[1]!.map((write) => write.action), ["update"]);

  const left = await call("publish.withdraw", { ids: [evidence.id] });
  assert.ok(!left.some((entry) => entry.id === evidence.id));
  assert.deepEqual(commits[2]!.map((write) => write.action), ["delete"]);
  assert.equal([...held.keys()].some((uri) => uri.endsWith(`/${evidence.id.split("#")[1]}`)), false);
  // What was taken back is new again, and the link to it can no longer go.
  const after = await call("publish.preview", { canvas: canvas.id });
  assert.equal(after.rows.find((row) => row.id === evidence.id)!.state, "new");
});
