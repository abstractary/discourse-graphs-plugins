// Tidy modes, canvas finding and attribution, with real clicks in a real host.
//   node harness/modes-test.mjs obsidian|roam
// Leaves nothing: its five units, their relations and its canvas are taken back.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam } from "./hosts.mjs";
import { q, sleep, tools } from "./lib.mjs";

const target = process.argv[2];
const OUT = resolve("reports/modes");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const { s, results, check, until, mouse, clickIn, type, call, cleanup, makeUnit } = tools(host, { wait: { timeout: 8000, every: 200, strict: true } });
const click = (selector) => clickIn("s", selector, { timeout: 6000 });
const clickList = (selector) => clickIn("s.list", selector, { timeout: 6000 });
const card = (title) => `[data-dg=${q(`card-${title}`)}]`;
const xOf = async (title) => (await s(`s.locate(${q(card(title))})`))?.x;
const tidyAs = async (mode) => {
  await click('[data-dg="tidy-menu"]');
  await click(`[data-dg="tidy-${mode}"]`);
  await sleep(1500);
};
const guides = () => s(`s.drawn().then(() => null)`).then(() => s(`s.text('[data-dg^="guide-"]')`));
const guideCount = () => s(`s.count('[data-dg^="guide-"]')`);

try {
  await s("s.test(true)");
  await s("s.closeAll()");
  await sleep(700);

  const stamp = Date.now() % 1000000;
  const grammar = await s(`s.call("grammar.get", {})`);
  const typeId = (base) => grammar.nodeTypes.find((type) => type.base === base).id;
  const relationId = (base) => grammar.relationTypes.find((type) => type.base === base)?.id;
  const make = (title, base) => makeUnit({ title, type: typeId(base) });
  const [source, evidence, claim, against, question] = [
    await make(`Lab notebook ${stamp}`, "source"),
    await make(`Actin rose twofold ${stamp}`, "evidence"),
    await make(`Actin scales with tension ${stamp}`, "claim"),
    await make(`Actin stayed flat ${stamp}`, "evidence"),
    await make(`What sets actin levels ${stamp}`, "question"),
  ];

  // Found the way a person would: the panel, then the base's own listing.
  const name = `Tension map ${stamp}`;
  // The canvas is made with the panel's own buttons and renamed further down, so it is found again by either name.
  cleanup("the canvas", async () => {
    for (const canvas of await call("canvas.summaries", {})) if (canvas.title === name || canvas.title === `Renamed ${stamp}`) await call("canvas.remove", { id: canvas.id });
  });
  await s("s.openCanvases()");
  await until(async () => (await s(`s.list.count('.cvs')`)) === 1, 8000);
  await clickList('[data-dg="canvases-new"]');
  await clickList('[data-dg="canvases-name"]');
  await type(name);
  await clickList('[data-dg="canvases-create"]');
  const opened = await until(async () => (await s(`s.count('.shell, .empty')`)) > 0, 9000);
  check("panel.creates-and-opens-a-canvas", opened);
  const home = target === "roam" ? `Canvas/${name}` : `Canvas - ${name}`;
  check("home.exists-in-the-base", (await s(`s.searchBase(${q(name)})`)).some((found) => found.includes(home)), q(await s(`s.searchBase(${q(name)})`)));

  const id = await s(`s.call("canvas.summaries", {}).then((list) => list.find((c) => c.title === ${q(name)}).id)`);
  const items = [source, evidence, claim, against, question];
  const written = await s(`s.call("canvas.write", ${q({
    canvas: id,
    upserts: items.map((node, index) => ({ z: index + 1, item: { type: "text", text: node.title, x: index * 280, y: (index % 2) * 160, width: 240, height: 90, dg: { node: node.id } } })),
  })})`);
  const itemOf = new Map(items.map((node, index) => [node.id, written.ids[index]]));
  const relate = async (from, to, base) => {
    const relation = await s(`s.call("relation.options", ${q({ source: from.id, target: to.id })}).then(async (options) => { const wanted = options.find((option) => option.type === ${q(relationId(base))}) ?? options[0]; return wanted ? s.call("relation.assert", { type: wanted.type, source: ${q(from.id)}, target: ${q(to.id)} }) : null; })`);
    if (!relation) return null;
    await s(`s.call("canvas.write", ${q({ canvas: id, upserts: [{ z: 50, item: { fromNode: itemOf.get(from.id), toNode: itemOf.get(to.id), dg: { relation: relation.id } } }] })})`);
    return relation;
  };
  await relate(evidence, claim, "supports");
  await relate(against, claim, "opposes");
  await relate(claim, question, "addresses");
  const derived = await relate(evidence, source, "derivedFrom");
  check("canvas.has-a-derivation", derived !== null, derived?.id);
  await until(async () => (await s(`s.count('.react-flow__edge')`)) >= 4, 6000);
  await sleep(800);

  // Logic: what something rests on sits to its left, whichever way the arrow runs.
  await tidyAs("logic");
  const [xs, xe, xc, xa, xq] = await Promise.all([source, evidence, claim, against, question].map((node) => xOf(node.title)));
  check("logic.derived-from-sits-left", xs < xe, q({ source: xs, evidence: xe }));
  check("logic.support-sits-left-of-the-claim", xe < xc, q({ evidence: xe, claim: xc }));
  check("logic.opposition-stays-with-support", xa < xc, q({ against: xa, claim: xc }));
  await host.shot(`${OUT}/${host.name}-logic.png`);

  // Every link says who made it, on hover.
  const label = await s(`s.locate(".react-flow__edge-textwrapper")`);
  await mouse("mouseMoved", label.x + label.width / 2, label.y + label.height / 2);
  const tipped = await until(async () => (await s(`s.count('[data-dg="edge-credit"]')`)) === 1, 3000);
  check("link.says-who-made-it", tipped, await s(`s.text('[data-dg="edge-credit"]')`));
  await mouse("mouseMoved", 4, 4);

  await tidyAs("debate");
  const [dc, da, de] = await Promise.all([claim, against, evidence].map((node) => xOf(node.title)));
  check("debate.opposition-goes-to-the-far-side", dc < da, q({ claim: dc, against: da }));
  check("debate.support-stays-left", de < dc, q({ evidence: de, claim: dc }));
  await host.shot(`${OUT}/${host.name}-debate.png`);

  await tidyAs("kinds");
  check("kinds.labels-each-type", (await guideCount()) >= 3, await guideCount());
  await host.shot(`${OUT}/${host.name}-kinds.png`);
  await tidyAs("people");
  check("people.labels-who", (await guideCount()) >= 1, await guideCount());
  await tidyAs("timeline");
  check("timeline.draws-a-period", (await guideCount()) >= 1, await guides());
  await host.shot(`${OUT}/${host.name}-timeline.png`);

  await tidyAs("connected");
  check("central.shows-scores", (await s(`s.count('[data-dg^="score-"]')`)) === 5, await s(`s.count('[data-dg^="score-"]')`));
  check("central.ranks-the-hub-first", (await s(`s.text(${q(`[data-dg="score-${claim.title}"]`)})`)) === "3 links", await s(`s.text(${q(`[data-dg="score-${claim.title}"]`)})`));
  check("central.links-step-back", (await s(`s.count('.area.links-quiet')`)) === 1);
  await host.shot(`${OUT}/${host.name}-connected.png`);

  // A mode stays with the canvas, for teammates too.
  check("layout.is-stored", (await s(`s.call("canvas.open", ${q({ id })}).then((view) => view.canvas.layout?.mode)`)) === "connected");
  await click('[data-dg="undo"]');
  await sleep(900);
  check("undo.brings-back-the-last-mode", (await s(`s.call("canvas.open", ${q({ id })}).then((view) => view.canvas.layout?.mode)`)) === "timeline");

  // Focus needs a card.
  await click('[data-dg="tidy-menu"]');
  await click('[data-dg="tidy-focus"]');
  await sleep(600);
  const noted = await s(`s.text(".status span")`);
  await click(card(claim.title));
  await sleep(400);
  await tidyAs("focus");
  check("focus.centers-the-selected-card", (await xOf(evidence.title)) < (await xOf(claim.title)) && (await xOf(claim.title)) < (await xOf(question.title)), noted);
  await host.shot(`${OUT}/${host.name}-focus.png`);

  await tidyAs("logic");
  check("logic.clears-the-headings", (await guideCount()) === 0, await guideCount());

  // The base's own route back: open the note or page, and the canvas is there.
  await s("s.closeAll()");
  await sleep(900);
  await s(`s.openHome(${q(home)})`);
  check("home.opens-the-canvas", await until(async () => (await s(`s.count('.card')`)) === 5, 9000));

  // Renaming in the base renames the canvas.
  const renamed = target === "roam" ? `Canvas/Renamed ${stamp}` : `Canvas - Renamed ${stamp}`;
  const homeRef = await s(`s.findRef(${q(name)})`);
  await s(`s.renameInBase(${q(homeRef)}, ${q(renamed)})`);
  const renamedTo = await until(async () => {
    const list = await s(`s.call("canvas.summaries", {})`);
    return list.find((canvas) => canvas.id === id)?.title === `Renamed ${stamp}`;
  }, 6000);
  check("home.rename-renames-the-canvas", renamedTo, q((await s(`s.call("canvas.summaries", {})`)).find((canvas) => canvas.id === id)?.title));

  await s("s.closeAll()");
} finally {
  await cleanup.run();
}
await host.finish();
const passed = results.filter((result) => result.pass).length;
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
