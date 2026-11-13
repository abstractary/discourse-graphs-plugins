// The paper map and the type colors, in real Obsidian, on the sandbox vault.
import { resolve } from "node:path";
import { session, sleep } from "./lib.mjs";

const t = await session({ out: resolve("reports/papermap") });
const { call, check, note, until, shot, at, has, click } = t;
await t.s("s.test(true)");
await t.s("s.closeAll()");

await call("papers.show", {});
check("map.opens", await until(() => has("papers", '[data-dg="papers"]'), 8000));
await sleep(900);
const everyone = await call("papers.map", { scope: { kind: "everyone" } });
note(`everyone: ${everyone.papers.length} papers, ${everyone.ties.length} ties: ${everyone.ties.map((tie) => `${tie.stance} ${tie.strength}`).join(", ")}`);
check("map.offers-the-ladder", (await at("papers", "count", ".pm-scopes [role=tab]")) === everyone.scopes.length, await at("papers", "text", ".pm-scopes"));
await click("papers", '[data-dg="pm-scope-everyone"]');
await until(async () => (await at("papers", "count", '[data-dg="pm-paper"]')) === everyone.papers.length, 6000);
check("map.shows-every-paper", (await at("papers", "count", '[data-dg="pm-paper"]')) === everyone.papers.length, `${await at("papers", "count", '[data-dg="pm-paper"]')} of ${everyone.papers.length}`);
check("map.says-what-each-tie-is", (await at("papers", "count", '[data-dg="pm-tie-label"]')) === everyone.ties.length, await at("papers", "text", '[data-dg="pm-tie-label"]'));
check("map.sums-it-up", /paper/.test((await at("papers", "text", '[data-dg="pm-summary"]')) ?? ""), await at("papers", "text", '[data-dg="pm-summary"]'));
await sleep(700);
await shot("01-everyone");
if (everyone.papers.length) {
  await click("papers", '[data-dg="pm-paper"]');
  check("map.a-paper-says-its-ties", await until(() => has("papers", '[data-dg="pm-open"]'), 4000), await at("papers", "text", '[data-dg="pm-side"]'));
  await shot("02-paper-picked");
}
await click("papers", '[data-dg="pm-scope-own"]');
await sleep(900);
const own = await call("papers.map", { scope: { kind: "own" } });
check("map.own-scope-matches-core", (await at("papers", "count", '[data-dg="pm-paper"]')) === own.papers.length, `${own.papers.length} papers, ${own.ties.length} ties`);
await shot("03-only-you");

// The type colors on a real canvas.
const canvases = await call("repository.canvases", {});
const busy = [...canvases].sort((a, b) => b.cards - a.cards)[0];
if (busy) {
  await call("canvas.show", { id: busy.id });
  await until(() => has("canvas", ".card"), 8000);
  await sleep(1200);
  await shot("04-canvas-colors");
}
process.exit(await t.finish("papermap"));
