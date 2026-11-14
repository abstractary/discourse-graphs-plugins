// Publishing, proved against a real AT Protocol network on this machine: a PLC directory and a
// PDS from `@atproto/dev-env`, with nothing stubbed between the core and the repository.
//
//   node harness/publish-proof.ts
//
// `@atproto/dev-env` is large and is not one of this repository's dependencies. Install it anywhere
// (`npm install @atproto/dev-env` in an empty folder) and name that folder in DG_DEVENV.
// Leaves nothing behind: the network lives in memory and is closed at the end.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cidOf } from "@dg/contract/atproto.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import { SANDBOX } from "@dg/contract/publish.ts";
import type { JsonObject } from "@dg/contract/records.ts";
import { createAtRepo } from "@dg/sync/atrepo.ts";
import { makeCore } from "../test/support.ts";

const home = resolve(process.env.DG_DEVENV ?? "");
if (!process.env.DG_DEVENV) {
  console.error("Set DG_DEVENV to a folder where @atproto/dev-env is installed.");
  process.exit(2);
}
const { TestNetworkNoAppView } = (await import(pathToFileURL(createRequire(join(home, "package.json")).resolve("@atproto/dev-env")).href)) as {
  TestNetworkNoAppView: { create: (options: Record<string, unknown>) => Promise<{ pds: { url: string }; plc: { url: string }; close: () => Promise<void> }> };
};

const results: { id: string; pass: boolean; detail: string }[] = [];
const check = (id: string, pass: unknown, detail = ""): void => {
  results.push({ id, pass: Boolean(pass), detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${detail.slice(0, 200)}` : ""}`);
};

const network = await TestNetworkNoAppView.create({ dbPostgresSchema: "dg_publish_proof" });
try {
  const HANDLE = "mira.test";
  const PASSWORD = "proof-only-password";
  const made = await fetch(`${network.pds.url}/xrpc/com.atproto.server.createAccount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle: HANDLE, email: "mira@example.test", password: PASSWORD }) });
  const account = (await made.json()) as { did: string };
  check("network.an-account-exists", made.ok && account.did.startsWith("did:plc:"), `${account.did} on ${network.pds.url}`);

  const kept = new Map<string, string>();
  const secrets: SecretStore = { kind: "plain", get: async (id) => kept.get(id) ?? null, set: async (id, value) => void (value === null ? kept.delete(id) : kept.set(id, value)) };
  const repo = createAtRepo({ fetch, directory: network.plc.url, resolver: network.pds.url });
  const { call, core } = await makeCore({ services: { repo }, secrets });
  const types = (await call("grammar.get", {})).nodeTypes;
  const typed = (label: string) => types.find((type) => type.label === label)!.id;
  const claim = await call("unit.create", { title: "Higher speed gives a clearer lysate", type: typed("Claim") });
  const evidence = await call("unit.create", { title: "At 16,000 g the supernatant is clear", type: typed("Evidence") });
  const question = await call("unit.create", { title: "Does spin speed change lysate clarity?", type: typed("Question") });
  const supports = await call("relation.assert", { type: (await call("relation.options", { source: evidence.id, target: claim.id }))[0]!.type, source: evidence.id, target: claim.id });
  const canvas = await call("canvas.create", { title: "Proof" });
  await call("unit.put", { canvas: canvas.id, units: [claim.id, evidence.id, question.id] });

  // The handle is found the way a real one is: asked of a resolver, then of the directory.
  const connected = await call("publish.connect", { handle: HANDLE, password: PASSWORD });
  check("connect.finds-the-repository-from-the-handle", connected.connected?.did === account.did && connected.connected.host === network.pds.url, JSON.stringify(connected.connected));
  check("connect.keeps-no-password", ![...kept.values()].some((value) => value.includes(PASSWORD)) && kept.size === 1);
  check("connect.the-repository-is-not-the-authors-did", account.did !== core.identity().did, `${core.identity().did} writes, ${account.did} keeps`);

  const preview = await call("publish.preview", { canvas: canvas.id });
  check("preview.lists-four-records", preview.rows.length === 4 && preview.rows.every((row) => row.state === "new"), preview.rows.map((row) => row.collection.split(".").at(-1)).join(", "));

  const sent = await call("publish.send", { canvas: canvas.id });
  check("send.one-commit", sent.sent === 4 && sent.commits === 1, JSON.stringify([sent.sent, sent.commits]));

  // Read back as the public would: no session, straight from the repository.
  const read = async (collection: string) => repo.list({ host: network.pds.url, repo: account.did, collection });
  const all = (await Promise.all(["claim", "evidence", "question", "relation"].map((name) => read(`${SANDBOX}.${name}`)))).flat();
  check("public.every-record-reads-back", all.length === 4, all.map((record) => record.uri.split("/").slice(3).join("/")).join(", "));
  const byId = new Map(all.map((record) => [record.value.dgId as string, record]));
  check("public.ids-are-unchanged", [claim, evidence, question, supports].every((unit) => byId.has(unit.id) && byId.get(unit.id)!.uri.endsWith(`/${unit.id.split("#")[1]}`)));
  // The repository names each record by the CID of its bytes. The same value hashed here gives the same name,
  // so what this device says it sent is exactly what is public.
  const same = await Promise.all(all.map(async (record) => (await cidOf(record.value as JsonObject)) === record.cid));
  check("public.cids-match-ours", same.every(Boolean), `${same.filter(Boolean).length} of ${same.length}`);
  const receipts = await call("publish.list", {});
  check("receipts.name-the-repositorys-cids", receipts.length === 4 && receipts.every((receipt) => all.some((record) => record.uri === receipt.uri && record.cid === receipt.cid)));
  const link = JSON.stringify(byId.get(supports.id)!.value);
  check("public.a-link-names-public-addresses", link.includes(byId.get(claim.id)!.uri) && link.includes(byId.get(evidence.id)!.uri), link);

  await call("unit.rename", { id: claim.id, title: "Higher speed gives a clearer lysate, up to 16,000 g" });
  const again = await call("publish.send", { canvas: canvas.id });
  const renamed = (await read(`${SANDBOX}.claim`))[0]!;
  check("update.only-the-changed-record-goes", again.sent === 1 && String(renamed.value.title ?? renamed.value.text ?? JSON.stringify(renamed.value)).includes("up to 16,000 g"), `${again.sent} sent`);

  await call("publish.withdraw", { ids: [evidence.id] });
  check("withdraw.it-is-gone-from-the-repository", (await read(`${SANDBOX}.evidence`)).length === 0 && (await call("publish.list", {})).length === 3);

  await call("publish.disconnect", {});
  check("disconnect.forgets-the-session", kept.size === 0 && !(await call("publish.account", {})).connected);
  await assert.rejects(call("publish.send", { canvas: canvas.id }));
} finally {
  await network.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`=== publish proof: ${results.length - failed} of ${results.length}`);
process.exit(failed ? 1 : 0);
