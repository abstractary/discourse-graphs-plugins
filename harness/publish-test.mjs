// Publishing in real Obsidian, to a real AT Protocol network on this machine (a PLC directory and a
// PDS from `@atproto/dev-env`): the canvas menu opens Publish, the dialog shows what would go, a
// second press sends it, the records read back from the repository as the public reads them, and
// Take back removes one.
//   npm run build:test, then: DG_DEVENV=<folder with @atproto/dev-env> node harness/publish-test.mjs
// Starts harness/at-network.mjs beside itself.
// Leaves nothing: the canvas and units are taken back, the account is disconnected, and the network
// lives in memory.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

if (!process.env.DG_DEVENV) {
  console.error("Set DG_DEVENV to a folder where @atproto/dev-env is installed.");
  process.exit(2);
}
const RUN = String(Date.now()).slice(-5);
const SANDBOX = "org.discoursegraphs.sandbox";

// The network runs in a process of its own: this one stops still while it waits on Obsidian, and Obsidian is waiting on the network.
const child = spawn(process.execPath, ["harness/at-network.mjs"], { stdio: ["ignore", "pipe", "ignore"] });
const network = await new Promise((done, fail) => {
  let text = "";
  child.stdout.on("data", (chunk) => {
    text += chunk;
    if (text.includes("\n")) done(JSON.parse(text.split("\n")[0]));
  });
  child.on("exit", () => fail(new Error("The test network didn't start.")));
});
const { handle: HANDLE, password: PASSWORD } = network;
const account = { did: network.did };
const t = await session({ out: resolve("reports/publish"), reload: !process.env.DG_NO_RELOAD });
const { s, check, until, shot, at, clickIn, has, call, cleanup, makeUnit, makeCanvas } = t;
const inDialog = (selector) => clickIn((wanted) => s(`s.dialog.locate(${q(wanted)})`), selector, { timeout: 8000 });
const dialogText = (selector) => s(`s.dialog.text(${q(selector)})`);
const listed = async (name, did) => (await (await fetch(`${network.pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${SANDBOX}.${name}`)).json()).records ?? [];
try {
  await s("s.test(true)");

  const grammar = await call("grammar.get");
  const typed = (base) => grammar.nodeTypes.find((item) => item.base === base).id;
  const board = await makeCanvas(`Publish ${RUN}`);
  const claim = await makeUnit({ title: `Higher speed gives a clearer lysate ${RUN}`, type: typed("claim") });
  const evidence = await makeUnit({ title: `At 16,000 g the supernatant is clear ${RUN}`, type: typed("evidence") });
  const option = (await call("relation.options", { source: evidence.id, target: claim.id }))[0];
  await call("relation.assert", { type: option.type, source: evidence.id, target: claim.id });
  await call("unit.put", { canvas: board.id, units: [claim.id, evidence.id] });

  // The dialog has no field for a test network's address, so the account is connected by a call. Everything after is the dialog.
  cleanup("the connected account", () => call("publish.disconnect", {}));
  const connected = await call("publish.connect", { handle: HANDLE, password: PASSWORD, host: network.pds });
  check("connect.the-account-is-the-test-networks", connected.connected?.did === account.did, JSON.stringify(connected.connected));

  await s("s.closeAll()");
  await s(`s.open(${q(board.id)})`);
  await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) === 2, 8000);
  await clickIn((wanted) => at("canvas", "locate", wanted), '[data-dg="canvas-menu"]', { timeout: 6000 });
  await clickIn((wanted) => at("canvas", "locate", wanted), '[data-dg="publish"]', { timeout: 6000 });
  check("dialog.opens-from-the-canvas-menu", await until(() => s(`s.dialog.count('[data-dg="publish"]')`).then((n) => n === 1), 8000));
  const rows = await until(async () => ((await s(`s.dialog.count('[data-dg="publish-preview"] li')`)) === 3 ? dialogText('[data-dg="publish-preview"]') : null), 8000);
  check("dialog.shows-what-would-go", /claim/i.test(rows ?? "") && /evidence/i.test(rows ?? "") && /relation/i.test(rows ?? "") && (rows.match(/New/g) ?? []).length === 3, rows);
  check("dialog.names-the-account", /@mira\.test/.test((await dialogText('[data-dg="publish-account"]')) ?? ""));
  check("dialog.says-it-is-public", /public at once/.test((await dialogText('[data-dg="publish-warning"]')) ?? ""));
  await shot("01-what-would-be-sent");
  check("nothing-sent-yet", (await listed("claim", account.did)).length === 0);

  await inDialog('[data-dg="publish-send"]');
  check("dialog.asks-before-sending", await until(() => s(`s.dialog.count('[data-dg="publish-send-yes"]')`).then((n) => n === 1), 4000));
  check("still-nothing-sent", (await listed("claim", account.did)).length === 0);
  await shot("02-asked-twice");
  await inDialog('[data-dg="publish-send-yes"]');
  const said = await until(async () => (/public now/.test((await dialogText('[data-dg="publish-said"]')) ?? "") ? dialogText('[data-dg="publish-said"]') : null), 15000);
  check("dialog.says-it-went", /3 records are public now/.test(said ?? ""), said);
  const [claims, evidences, relations] = await Promise.all(["claim", "evidence", "relation"].map((name) => listed(name, account.did)));
  check("public.the-records-are-in-the-repository", claims.length === 1 && evidences.length === 1 && relations.length === 1, `${claims.length}, ${evidences.length}, ${relations.length}`);
  check("public.the-claim-keeps-its-id", claims[0]?.value.dgId === claim.id && claims[0]?.uri.endsWith(`/${claim.id.split("#")[1]}`), claims[0]?.uri);
  check("dialog.lists-what-is-public", await until(() => s(`s.dialog.count('[data-dg="publish-list"] li')`).then((n) => n === 3), 6000));
  await shot("03-public");

  await inDialog(`[data-dg=${JSON.stringify(`publish-withdraw-${evidence.title}`)}]`);
  await inDialog(`[data-dg=${JSON.stringify(`publish-withdraw-${evidence.title}-yes`)}]`);
  check("withdraw.it-leaves-the-repository", await until(async () => (await listed("evidence", account.did)).length === 0, 10000));
  await sleep(400);
  await shot("04-taken-back");
  await s("s.closeDialog()").catch(() => null);
} finally {
  await cleanup.run();
  child.kill("SIGTERM");
}
process.exit(await t.finish("publish"));
