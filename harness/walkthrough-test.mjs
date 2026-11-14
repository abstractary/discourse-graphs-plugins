// Takes the walkthrough with real keys and clicks in a real host, then reads the base back.
//   node harness/walkthrough-test.mjs obsidian|roam
// Leaves the name "Dana Lee" where the person had no name before; a name they had is put back. The examples the
// walkthrough makes are removed, which is part of what it checks.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam } from "./hosts.mjs";
import { centre, q, sleep, tools } from "./lib.mjs";

const target = process.argv[2];
const OUT = resolve("reports/walkthrough");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const { s, results, check, until, clickAt, clickIn, inPage, where, type, typeChar, key, cleanup } = tools(host, { wait: { timeout: 8000, every: 200, strict: true } });
const hostClick = (selector) => clickIn(inPage, selector, { timeout: 6000 });
const step = () => s(`document.querySelector('[data-dg="walkthrough-card"]')?.dataset.step ?? null`);
const atStep = (id, timeout = 9000) => until(async () => (await step()) === id, timeout);
// The card settles beside its target a moment after a step starts.
const next = async () => {
  await sleep(600);
  await hostClick('[data-dg="walkthrough-next"]');
};
const holeShown = () => s(`(() => { const r = document.querySelector('[data-dg="walkthrough-hole"]'); return r && r.style.display !== "none" ? r.getBoundingClientRect().width : 0; })()`);

const nodes = (text) => s(`s.core().then((core) => [...core.graph().documents.values()].filter((d) => d.kind === "node" && !d.removed && d.title.includes(${q(text)})).length)`);
const canvases = () => s(`s.call("canvas.summaries", {}).then((list) => list.filter((c) => c.title.startsWith("Walkthrough canvas")).length)`);

try {
  await s("s.test(true)");
  // macOS draws Obsidian's menus natively, where a test can't click them; its own menus are used for this run.
  const nativeMenus = target === "roam" ? null : await s(`app.vault.getConfig("nativeMenus") ?? null`);
  const menusBack = cleanup("Obsidian's menu setting", async () => {
    if (target !== "roam") await s(`(() => { app.vault.setConfig("nativeMenus", ${JSON.stringify(nativeMenus)}); return true; })()`);
  });
  if (target !== "roam") await s(`(() => { app.vault.setConfig("nativeMenus", false); return true; })()`);
  // A run that stops part-way leaves the walkthrough's examples. Asked again when there are none, this does nothing.
  cleanup("the walkthrough's examples", () => s("s.removeExamples()"));
  // Left behind when the person had no name: the run's own. Only a name they had is put back.
  const nameBefore = await s(`s.core().then((core) => core.personName() ?? null)`);
  cleanup("the person's name", async () => {
    if (nameBefore) await s(`s.core().then((core) => core.setName(${q(nameBefore)}))`);
  });
  await s("s.closeAll()");
  await sleep(700);
  await s(`s.setLocal("walkthrough-examples", null)`);
  // Counted from here, because an earlier run may have kept its examples.
  const start = { claim: await nodes("Cells under tension"), canvas: await canvases(), home: (await s(`s.searchBase("Walkthrough canvas")`)).length };

  // The offer: shown once, never forced.
  await s("s.offer()");
  check("offer.appears", await until(async () => (await s(`s.hostCount('[data-dg="walkthrough-offer"]')`)) === 1, 3000));
  await host.shot(`${OUT}/${host.name}-offer.png`);
  check("offer.does-not-start-by-itself", (await step()) === null);
  await hostClick('[data-dg="walkthrough-offer-start"]');

  check("welcome.opens", await atStep("welcome"));
  await host.shot(`${OUT}/${host.name}-welcome.png`);
  const name = "Dana Lee";
  await s(`(() => { const input = document.querySelector('[data-dg="walkthrough-name"]'); input.focus(); input.select(); })()`);
  await type(name);
  await hostClick('[data-dg="walkthrough-start"]');

  // Real capture.
  check("claim.waits-for-the-gesture", await atStep("claim"));
  await until(() => holeShown(), 5000);
  check("claim.points-at-the-selection", (await holeShown()) > 20, await holeShown());
  check("name.is-saved", (await s(`s.core().then((core) => core.personName())`)) === name);
  await host.shot(`${OUT}/${host.name}-claim.png`);
  await key("\\", 220, 0, { code: "Backslash" });
  await until(async () => (await s(`s.hostCount('[data-dg="capture-menu"]')`)) === 1, 3000);
  const keyOf = await s(`document.querySelector('[data-dg="capture-menu"] [data-dg="capture-Claim"] span')?.textContent`);
  await typeChar(keyOf.toLowerCase(), `Key${keyOf}`, keyOf.charCodeAt(0));
  check("evidence.follows-a-real-capture", await atStep("evidence"));
  await until(() => holeShown(), 5000);
  await key("\\", 220, 0, { code: "Backslash" });
  await until(async () => (await s(`s.hostCount('[data-dg="capture-menu"]')`)) === 1, 3000);
  const chosen = await s(`Array.from(document.querySelectorAll('[data-dg="capture-menu"] button')).map((b) => [b.dataset.dg, b.querySelector("span").textContent])`);
  const evidence = chosen.find(([label]) => label === "capture-Evidence") ?? chosen[2];
  await typeChar(evidence[1].toLowerCase(), `Key${evidence[1]}`, evidence[1].charCodeAt(0));

  check("badge.step-shows", await atStep("badge"));
  await until(() => holeShown(), 6000);
  check("badge.is-spotlit", (await holeShown()) > 4, await holeShown());
  const blocked = await s(`(() => { const hit = document.elementFromPoint(window.innerWidth - 8, window.innerHeight / 2); return hit?.closest('[data-dg="walkthrough"]') ? "shade" : hit?.tagName; })()`);
  check("stencil.blocks-everything-else", blocked === "shade", blocked);
  await host.shot(`${OUT}/${host.name}-badge.png`);
  const badge = await s(`(() => { const r = document.querySelector('[data-dg="walkthrough-hole"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await clickAt(badge.x, badge.y);
  check("context.follows-a-real-click", await atStep("context"));
  await next();

  check("canvases.step-shows", await atStep("canvases"));
  await until(() => holeShown(), 6000);
  await host.shot(`${OUT}/${host.name}-canvases.png`);
  await until(async () => (await canvases()) === start.canvas + 1, 8000);
  await sleep(600);
  if (target === "roam") await hostClick('[data-dg="roam-canvases"]');
  else {
    // Obsidian has one ribbon icon, whose menu holds the Library.
    await hostClick('.side-dock-ribbon-action[aria-label="Discourse Graphs"]');
    const item = await until(() => s(`(() => { const found = [...document.querySelectorAll(".menu .menu-item")].find((e) => e.textContent.trim() === "Library"); if (!found) return null; const r = found.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`), 4000);
    if (item) await clickAt(item.x, item.y);
  }
  check("open-canvas.follows-a-real-click", await atStep("open-canvas"));
  await until(() => holeShown(), 6000);
  const row = await where("s.list", '[data-dg="canvases-open-Walkthrough canvas"]', 6000);
  await clickAt(...centre(row));
  check("card.follows-opening-the-canvas", await atStep("card", 12000));
  await until(() => holeShown(), 6000);
  await host.shot(`${OUT}/${host.name}-card.png`);
  const credit = await s(`s.text('[data-dg^="credit-Cells under tension"]')`);
  check("card.shows-who-made-it", credit === "DL", credit);
  await next();

  check("relate.step-shows", await atStep("relate"));
  await until(() => holeShown(), 6000);
  await sleep(500);
  await hostClick('[data-dg="walkthrough-do"]');
  check("do-it-for-me.relates-the-cards", await atStep("tidy"));
  await until(() => holeShown(), 6000);
  await host.shot(`${OUT}/${host.name}-tidy.png`);
  await next();
  check("find.names-the-base-home", await atStep("find"));
  await host.shot(`${OUT}/${host.name}-find.png`);
  const copy = await s(`document.querySelector('[data-dg="walkthrough-card"]').textContent`);
  check("find.says-where", copy.includes(target === "roam" ? "All Pages" : "quick switcher"), copy.slice(0, 120));
  await next();
  check("lab.step-shows", await atStep("lab"));
  await next();
  check("finish.offers-keep-or-remove", await atStep("finish"));
  await host.shot(`${OUT}/${host.name}-finish.png`);

  const made = { claim: await nodes("Cells under tension"), canvas: await canvases(), home: (await s(`s.searchBase("Walkthrough canvas")`)).length };
  check("examples.were-really-made", made.claim === start.claim + 1 && made.canvas === start.canvas + 1 && made.home === start.home + 1, q({ start, made }));
  await hostClick('[data-dg="walkthrough-remove"]');
  await until(async () => (await step()) === null, 8000);
  await sleep(1200);
  const after = { claim: await nodes("Cells under tension"), canvas: await canvases(), home: (await s(`s.searchBase("Walkthrough canvas")`)).length };
  check("remove.takes-everything-back", after.claim === start.claim && after.canvas === start.canvas && after.home === start.home && (await s(`s.searchBase("Walkthrough notes")`)).length === 0, q({ start, after }));
  check("remove.leaves-the-name", (await s(`s.core().then((core) => core.personName())`)) === name);

  // Second run: every step by button, then keep, then change your mind.
  await s("s.walkthrough()");
  await atStep("welcome");
  await hostClick('[data-dg="walkthrough-start"]');
  for (const id of ["claim", "evidence", "badge"]) {
    await atStep(id);
    await until(() => holeShown(), 6000);
    await sleep(700);
    await hostClick('[data-dg="walkthrough-do"]');
  }
  await atStep("context");
  await next();
  await atStep("canvases");
  await until(async () => (await canvases()) === start.canvas + 1, 8000);
  await sleep(500);
  await hostClick('[data-dg="walkthrough-do"]');
  await atStep("open-canvas");
  await sleep(400);
  await hostClick('[data-dg="walkthrough-do"]');
  check("do-it-for-me.opens-the-canvas", await atStep("card", 12000));
  // Leaving early still offers the choice.
  await sleep(600);
  await hostClick('[data-dg="walkthrough-close"]');
  check("close.goes-to-the-choice", await atStep("finish"));
  await sleep(500);
  await hostClick('[data-dg="walkthrough-keep"]');
  await until(async () => (await step()) === null, 4000);
  check("keep.keeps-them", (await nodes("Cells under tension")) === start.claim + 1);
  await s("s.removeExamples()");
  await sleep(1500);
  check("command.removes-them-later", (await nodes("Cells under tension")) === start.claim && (await canvases()) === start.canvas);

  // With nothing made yet, leaving just leaves.
  await s("s.closeAll()");
  await sleep(400);
  await s("s.walkthrough()");
  await atStep("welcome");
  await key("Escape", 27);
  check("escape.leaves-when-nothing-was-made", await until(async () => (await step()) === null, 3000));

  await s("s.closeAll()");
  await menusBack();
} finally {
  await cleanup.run();
}
await host.finish();
const passed = results.filter((result) => result.pass).length;
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
