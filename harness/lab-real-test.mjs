// One real Obsidian in a lab with simulated labmates. The simulation shows what the core does; this
// shows it through a real base: Obsidian's own requests, its file watcher, the plugin starting and
// stopping, and what the Lab tab draws.
//   npm run build:test, then: node harness/lab-real-test.mjs   (Obsidian open on the sandbox vault)
// The sandbox person joins a throwaway lab run by a simulated PI, works in it, and is taken out again.
// It skips if the sandbox is already in a lab.
// Leaves the vault in no lab, with its own unit taken back. The lab's units that reached the vault stay in its
// records, put away with the lab: core has no call that forgets a lab's work.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";
import { openWorld } from "./vaults/world.ts";

const RUN = String(Date.now()).slice(-5);
const t = await session({ out: resolve("reports/lab-real"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call, cleanup } = t;
await s("s.test(true)");

const before = await call("lab.view");
if (before.link || before.identity.lab) {
  note(`SKIP the sandbox is already in a lab (${before.link?.name ?? before.identity.lab?.name}). Leave it first, then run this again.`);
  await t.finish("lab-real");
  process.exit(0);
}

// The lab server runs in a process of its own. This script talks to Obsidian with calls that block, and a
// server sharing this process could not answer Obsidian while one was waiting.
const PORT = 18000 + (Number(RUN) % 1000);
const dataDir = mkdtempSync(join(tmpdir(), "dg-lab-real-"));
const serverProcess = spawn(process.execPath, ["server/src/main.ts"], { env: { ...process.env, PORT: String(PORT), DG_DATA: dataDir }, stdio: "ignore" });
const SERVER = `http://127.0.0.1:${PORT}`;
for (let tries = 0; tries < 50; tries += 1) {
  if (await fetch(`${SERVER}/v1/info`).then((response) => response.ok, () => false)) break;
  await sleep(100);
}
const world = await openWorld([{ name: "Mira" }, { name: "Tomas" }], { server: SERVER });
// The real app keeps real time, so the simulated people do too.
world.time.ms = Date.now();
const tick = setInterval(() => void (world.time.ms = Date.now()), 250);
const [mira, tomas] = world.vaults;
const online = async (vault, work) => {
  vault.online = true;
  try {
    return await work();
  } finally {
    vault.online = false;
  }
};
const typeOf = async (who, base) => (await who("grammar.get", {})).nodeTypes.find((type) => type.base === base && !type.removed).id;

try {
  const lab = await online(mira, () => mira.call("lab.register", { server: world.server, name: `Real Lab ${RUN}` }));
  const forTomas = (await online(mira, () => mira.call("lab.invite", {}))).invite;
  await online(tomas, () => tomas.call("lab.acceptInvite", { invite: forTomas }));
  const claim = await mira.call("node.create", { title: `Actin follows tension ${RUN}`, type: await typeOf(mira.call, "claim") });
  const canvas = await mira.call("canvas.create", { title: `Real lab canvas ${RUN}` });
  await mira.call("canvas.write", { canvas: canvas.id, upserts: [{ z: 1, item: { type: "text", text: claim.title, x: 0, y: 0, width: 240, height: 90, dg: { node: claim.id } } }] });
  await mira.call("canvas.share", { id: canvas.id });
  await mira.call("lab.configure", { reach: "device", servers: [{ name: "Mira's workstation", url: "http://10.0.0.5:8787" }] });
  await world.settle(["Mira", "Tomas"]);

  // The real Obsidian joins with the PI's invitation, pasted as a person would paste it.
  const invite = (await online(mira, () => mira.call("lab.invite", {}))).invite;
  const joined = await call("lab.acceptInvite", { invite });
  check("join.the-invitation-lets-obsidian-in", joined.link?.name === `Real Lab ${RUN}` && joined.link?.token, joined.link?.name);
  await mira.sync();
  // Obsidian's own loop brings the lab's work in. Nothing here asks it to.
  const arrived = await until(async () => (await call("canvas.list")).find((item) => item.id === canvas.id), 20000);
  check("sync.the-shared-canvas-arrives-by-itself", Boolean(arrived), arrived?.title);
  const view = await until(async () => {
    const now = await call("lab.view");
    return now.identity.lab && now.settings.reach === "device" ? now : null;
  }, 15000);
  check("inherit.the-pis-settings-reach-obsidian", view?.settings.reach === "device" && view?.settings.servers?.[0]?.name === "Mira's workstation", q(view?.settings));
  check("inherit.obsidian-is-a-member-not-the-pi", view?.custodian === false && view?.deviceTrusted === true);
  const servers = await call("server.list");
  check("inherit.the-labs-server-is-offered", servers.some((server) => server.kind === "lab" && server.name === "Mira's workstation"), servers.map((server) => server.name).join(", "));
  const grammar = await call("grammar.get");
  const labels = grammar.nodeTypes.filter((type) => !type.removed).map((type) => type.label);
  check("inherit.one-grammar", new Set(labels).size === labels.length, labels.join(", "));

  // What the Lab tab draws for a member.
  await s("s.closeAll()");
  await s("s.openCanvases()");
  await until(() => has("canvases", '[data-dg="library-lab"]'), 15000);
  await sleep(400);
  await click("canvases", '[data-dg="library-lab"]');
  await until(() => has("canvases", '[data-dg="lab-settings"]'), 10000);
  const drawn = await at("canvases", "text", '[data-dg="lab-settings"]');
  check("tab.shows-what-the-lab-set", /Set by the lab/.test(drawn ?? "") && /own computer only/.test(drawn ?? "") && /Mira's workstation/.test(drawn ?? ""), drawn);
  check("tab.offers-a-member-no-invitations", !(await has("canvases", '[data-dg="lab-invite"]')));
  const members = await at("canvases", "text", '[data-dg="lab-members"]');
  check("tab.lists-the-members", /Mira/.test(members ?? "") && /Tomas/.test(members ?? ""), members);
  check("tab.offers-a-member-no-removal", !(await has("canvases", '[data-dg="remove-Tomas"]')));
  await shot("lab-tab-member");

  // The real person adds to the shared canvas. It reaches the simulated labmates, signed.
  const mine = await call("node.create", { title: `From the real Obsidian ${RUN}`, type: grammar.nodeTypes.find((type) => type.base === "evidence" && !type.removed).id });
  cleanup("the unit made in Obsidian", () => call("node.remove", { id: mine.id }));
  await call("canvas.write", { canvas: canvas.id, upserts: [{ z: 2, item: { type: "text", text: mine.title, x: 300, y: 0, width: 240, height: 90, dg: { node: mine.id } } }] });
  const reached = await until(async () => {
    await world.settle(["Mira", "Tomas"]);
    return (await tomas.call("node.query", { text: mine.title, limit: 1 }))[0];
  }, 25000);
  check("sync.obsidians-work-reaches-the-others", reached?.title === mine.title, reached?.title);
  check("sync.and-is-credited-to-its-person", reached?.credit.name === joined.identity.name, q(reached?.credit));
  const refused = (await online(tomas, () => tomas.call("lab.view", {}))).refused;
  check("sign.obsidians-records-carry-a-signature-that-holds", refused === 0, `Tomas refused ${refused}`);

  // The plugin is turned off and on again in the middle of things, as an update does.
  await t.host.reload();
  await s("s.test(true)");
  const again = await mira.call("node.create", { title: `Made while Obsidian restarted ${RUN}`, type: await typeOf(mira.call, "claim") });
  await mira.call("canvas.write", { canvas: canvas.id, upserts: [{ z: 3, item: { type: "text", text: again.title, x: 600, y: 0, width: 240, height: 90, dg: { node: again.id } } }] });
  await mira.sync();
  const caught = await until(async () => (await call("node.query", { text: again.title, limit: 1 }))[0], 25000);
  check("restart.obsidian-catches-up-after-the-plugin-restarts", caught?.title === again.title, caught?.title);
  check("restart.it-is-still-in-the-lab", Boolean((await call("lab.view")).link?.token));

  // The PI takes the real person out.
  await call("node.remove", { id: mine.id }).catch(() => undefined);
  await sleep(4500);
  await online(mira, () => mira.call("lab.remove", { did: joined.identity.did }));
  const out = await until(async () => {
    const now = await call("lab.view");
    return now.removedFrom ? now : null;
  }, 25000);
  check("remove.obsidian-is-told", out?.removedFrom === `Real Lab ${RUN}` && !out?.link, q({ removedFrom: out?.removedFrom }));
  const away = await until(async () => !(await call("canvas.list")).some((item) => item.id === canvas.id), 10000);
  check("remove.the-labs-shared-work-is-put-away", away);
  await s("s.closeAll()");
  await s("s.openCanvases()");
  await until(() => has("canvases", '[data-dg="library-lab"]'), 15000);
  await sleep(400);
  await click("canvases", '[data-dg="library-lab"]');
  await until(() => has("canvases", '[data-dg="lab-removed"]'), 10000);
  check("remove.the-tab-says-so", /removed from Real Lab/.test((await at("canvases", "text", '[data-dg="lab-removed"]')) ?? ""));
  await shot("lab-tab-removed");
  await click("canvases", '[data-dg="lab-removed-ok"]');
  await until(async () => !(await has("canvases", '[data-dg="lab-removed"]')), 8000);
  check("remove.the-notice-goes-once-read", !(await has("canvases", '[data-dg="lab-removed"]')));
} finally {
  clearInterval(tick);
  await cleanup.run();
  await call("lab.acknowledge").catch(() => undefined);
  await s("s.closeAll()").catch(() => undefined);
  await world.close();
  serverProcess.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
const left = await call("lab.view");
check("after.the-vault-is-in-no-lab", !left.link && !left.identity.lab && !left.removedFrom, q({ link: Boolean(left.link), lab: left.identity.lab?.name }));
await t.finish("lab-real");
