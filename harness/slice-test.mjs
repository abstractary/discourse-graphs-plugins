// Drives the same steps with real input in either host:
//   node harness/slice-test.mjs obsidian|roam [out-dir]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam, sleep } from "./hosts.mjs";
import { tid } from "@dg/contract/ids.ts";

const target = process.argv[2];
const OUT = resolve(process.argv[3] ?? "reports/slice");

const host = target === "roam" ? await roam() : obsidian();
const s = host.slice;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 160) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 110)}` : ""}`);
};
const q = (text) => JSON.stringify(text);
const until = async (work, timeout = 7000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work();
    if (value || Date.now() > deadline) return value;
    await sleep(200);
  }
};
const at = (selector, timeout) => until(() => s(`s.locate(${q(selector)})`), timeout);
const centre = (box) => [box.x + box.width / 2, box.y + box.height / 2];
const mouse = (type, x, y, buttons = 0, clickCount = 1) => host.input("Input.dispatchMouseEvent", {
  type, x, y, buttons, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount,
});
const clickAt = async (x, y, count = 1) => {
  await mouse("mouseMoved", x, y);
  for (let i = 1; i <= count; i += 1) {
    await mouse("mousePressed", x, y, 1, i);
    await mouse("mouseReleased", x, y, 0, i);
  }
};
const click = async (selector, count = 1) => {
  const box = await at(selector);
  if (!box) throw new Error(`Couldn't find ${selector}`);
  await clickAt(...centre(box), count);
};
const drag = async (from, to) => {
  await mouse("mouseMoved", ...from);
  await mouse("mousePressed", ...from, 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * step) / 8, from[1] + ((to[1] - from[1]) * step) / 8, 1);
  }
  await mouse("mouseReleased", ...to);
  await sleep(500);
};
const typeText = (text) => host.input("Input.insertText", { text });
const key = async (name, code) => {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await host.input("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: code });
  }
};
const summary = () => s("s.summary()");
const card = (title) => `[data-dg="card-${title}"]`;
const handle = (title, side) => `.react-flow__node:has(${card(title)}) .react-flow__handle-${side}`;

const stamp = Date.now() % 1000000;
const canvasName = `Tension map ${stamp}`;
const evidence = `Actin rose 2x ${stamp}`;
const claim = `Actin scales with tension ${stamp}`;
const thought = `Maybe load matters ${stamp}`;
const renamed = `Actin tracks tension ${stamp}`;

const addNode = async (title, type) => {
  await click('[data-dg="add-node"]');
  await click('[data-dg="node-search"]');
  await typeText(title);
  await sleep(250);
  await click(`[data-dg="${type}"]`);
  return at(card(title));
};

const build = await s("s.build");
console.log(`--- ${host.name}, canvas build ${build}`);
await s("s.test(true)");
await s("s.closeAll()");
await sleep(400);
await s("s.open()");
await until(async () => (await s(`s.count('[data-dg="canvas-menu"],[data-dg="canvas-name"]')`)) > 0, 9000);

if (!(await s(`s.locate('[data-dg="canvas-name"]')`))) {
  await click('[data-dg="canvas-menu"]');
  await click('[data-dg="new-canvas"]');
}
await click('[data-dg="canvas-name"]');
await sleep(250);
await typeText(canvasName);
await sleep(250);
await click('[data-dg="canvas-create"]');
await at('[data-dg="add-node"]');
await sleep(600);
check("canvas.created", (await summary()).canvases.includes(canvasName));

check("node.evidence-created", await addNode(evidence, "create-Evidence"));
check("node.claim-created", await addNode(claim, "create-Claim"));
check("node.untyped-created", await addNode(thought, "create-untyped"));
await sleep(500);
check("node.title-in-base", await s(`s.findRef(${q(host.titleOf("EVD", evidence))})`), host.titleOf("EVD", evidence));

const moveBy = async (title, dx, dy) => {
  const before = (await summary()).versions;
  const [x, y] = centre(await at(card(title)));
  await drag([x, y], [x + dx, y + dy]);
  await sleep(400);
  return (await summary()).versions - before;
};
await moveBy(thought, 0, 170);
const claimWrites = await moveBy(claim, 190, -10);
check("drag.one-record-per-move", claimWrites === 1, `${claimWrites} record(s)`);
await moveBy(evidence, -170, -20);

const before = await summary();
await drag(centre(await at(handle(evidence, "right"))), centre(await at(handle(claim, "left"))));
await click('[data-dg="relation-Supports"]');
await sleep(600);
const afterRelation = await summary();
check("relation.created", afterRelation.relations.filter((state) => state === "active").length === before.relations.filter((state) => state === "active").length + 1);
check("relation.edge-on-canvas", (await s(`s.count('.react-flow__edge')`)) >= 1);
check("relation.label-shown", (await s(`s.text('.react-flow__edge-text')`)) === "Supports", await s(`s.text('.react-flow__edge-text')`));

await drag(centre(await at(handle(evidence, "right"))), centre(await at(handle(thought, "left"))));
await sleep(500);
check("relation.grammar-blocks-untyped", (await s(`s.count('[data-dg^="relation-"]')`)) === 0, await s(`s.text('.relation-menu p')`));
await click(".relation-menu .quiet");

await click(`[data-dg="chip-${thought}"]`);
await click('[data-dg="type-Claim"]');
await sleep(1200);
check("type.chip-updates", (await s(`s.text('[data-dg="chip-${thought}"]')`)) === "CLM", await s(`s.text('[data-dg="chip-${thought}"]')`));
check("type.renames-text-in-base", await s(`s.findRef(${q(host.titleOf("CLM", thought))})`), host.titleOf("CLM", thought));

await drag(centre(await at(handle(claim, "left"))), centre(await at(handle(evidence, "right"))));
await sleep(400);
check("relation.offers-complement-backwards", await at('[data-dg="relation-Opposed by"]', 3000));
await click('[data-dg="relation-Opposed by"]');
await sleep(700);
check("relation.complement-stored", (await s(`s.count('.react-flow__edge')`)) >= 2);

await click('[data-dg="draw"]');
await at('[data-dg="ink-layer"]');
const area = await at(".react-flow");
const strokesBefore = (await summary()).strokes;
await drag([area.x + area.width * 0.55, area.y + area.height * 0.72], [area.x + area.width * 0.85, area.y + area.height * 0.84]);
await sleep(500);
check("stroke.saved", (await summary()).strokes === strokesBefore + 1);

await click('[data-dg="add-note"]');
await at('[data-dg="note-Note"]');
await sleep(300);
const noteBox = await at('[data-dg="note-Note"]');
await clickAt(...centre(noteBox), 2);
await sleep(300);
await typeText("A note about load");
await clickAt(area.x + area.width - 40, area.y + 30);
await sleep(700);
check("note.edited", await at('[data-dg="note-A note about load"]', 3000));

// Real research titles run long. A card grows, and never cuts a claim off.
const long = `Among 50 experiments that produced formal results, the median time from issue claiming to first result was 12 days ${stamp}`;
await addNode(long, "create-Claim");
await sleep(700);
const longCard = await at(card(long));
const longTitle = await at(`${card(long)} .card-title`);
check("card.long-title-fits", longTitle && longTitle.y + longTitle.height <= longCard.y + longCard.height + 1, `title ${Math.round(longTitle?.height)} in card ${Math.round(longCard?.height)}`);

// Dropping a connection on empty canvas starts the next card of the argument.
const next = `Follow-up evidence ${stamp}`;
const edgesBefore = await s(`s.count('.react-flow__edge')`);
await drag(centre(await at(handle(long, "right"))), [area.x + area.width - 90, area.y + 70]);
await sleep(300);
await click('[data-dg="node-search"]');
await typeText(next);
await sleep(250);
await click('[data-dg="create-Evidence"]');
await sleep(500);
await at('[data-dg^="relation-"]', 3000);
await click('[data-dg^="relation-"]');
await sleep(800);
check("connect.drop-on-empty-creates", (await s(`s.count('.react-flow__edge')`)) === edgesBefore + 1 && (await at(card(next))), `${edgesBefore} to ${await s(`s.count('.react-flow__edge')`)}`);

const ref = await s(`s.findRef(${q(host.titleOf("CLM", claim))})`);
await s(`s.renameOutside(${q(ref)}, ${q(host.titleOf("CLM", renamed))})`);
check("rename.reaches-open-canvas", await at(card(renamed), 9000), renamed);
await sleep(2500);
check("rename.keeps-text", (await s(`s.count('.card-note')`)) === 0, "no card says its text is gone");

const ids = await s(`s.core().then((core) => { const canvas = [...core.graph().documents.values()].filter((d) => d.kind === "canvas" && d.title === ${q(canvasName)})[0]; return { canvas: canvas.id, space: core.info.space.id }; })`);
const when = new Date().toISOString();
const teammate = { id: "did:plc:teammate7xzyoun6zhxrhs64", name: "Teammate" };
const itemId = `${teammate.id}#${tid()}`;
await s(`s.writeOutside(${JSON.stringify({ v: 2, id: itemId, kind: "canvas-item", space: ids.space, at: when, by: teammate, rev: 1, editedAt: when, editedBy: teammate, canvas: ids.canvas, z: 90, item: { id: itemId, type: "text", text: "From a teammate", x: -320, y: 0, width: 200, height: 70 } })})`);
check("outside.item-appears-live", await at('[data-dg="note-From a teammate"]', 9000));

const evidenceRef = await s(`s.findRef(${q(host.titleOf("EVD", evidence))})`);
// A person's own title edits on a double-click, so the open button opens the note.
await click(`[data-dg="open-${evidence}"]`);
await sleep(1200);
check("card.opens-in-base", await s(`s.visible(${q(evidenceRef)})`));
await s(`s.focusCanvas(${q(ids.canvas)})`);
await sleep(800);

const beforeDelete = await summary();
// A selected card is drawn above everything else, so clear it first, as a person would.
const pane = await at(".react-flow");
await clickAt(pane.x + pane.width - 24, pane.y + 24);
await sleep(250);
await click('[data-dg="note-A note about load"]');
await sleep(250);
await key("Backspace", 8);
await sleep(700);
check("delete.removes-item", (await summary()).liveItems === beforeDelete.liveItems - 1);

await click('[data-dg="undo"]');
await sleep(700);
check("delete.can-undo", (await at('[data-dg="note-A note about load"]', 3000)) && (await summary()).liveItems === beforeDelete.liveItems);
await clickAt(pane.x + pane.width - 24, pane.y + 24);
await sleep(250);
await click('[data-dg="note-A note about load"]');
await sleep(250);
await key("Backspace", 8);
await sleep(700);

const label = await at(".react-flow__edge-text");
await clickAt(...centre(label));
await sleep(250);
await key("Backspace", 8);
// Delete on a link asks whether it's only coming off this canvas; this one is.
const asked = await at('[data-dg="link-delete"]', 3000);
if (asked) await click('[data-dg="link-delete-canvas"]');
await sleep(800);
const afterEdge = await summary();
check("delete.edge-keeps-relation", asked && afterEdge.liveItems === beforeDelete.liveItems - 2 && afterEdge.relations.filter((state) => state === "active").length === beforeDelete.relations.filter((state) => state === "active").length, `${afterEdge.liveItems} items`);

check("theme.follows-host", (await s("s.frameTheme()")) === (await s("s.theme()")), await s("s.theme()"));
const skin = await s("s.skin()");
check("skin.follows-host", (await s(`s.style('html', '--dg-page')`)) === skin.page && (await s(`s.style('html', '--dg-size')`)) === `${skin.size}px`, skin.page);

// The widths come from measuring both bases: side panel, beside a sidebar, and a full pane.
mkdirSync(`${OUT}/../style`, { recursive: true });
for (const width of [300, 480, 725, null]) {
  await s(`s.frameWidth(${width})`);
  await sleep(500);
  const label = width ?? "full";
  const scroll = await s("s.scroll()");
  const tools = await at(".bar");
  check(`band.${label}-fits`, scroll.scrollWidth <= scroll.clientWidth && tools.height <= 44, `scroll ${scroll.scrollWidth}/${scroll.clientWidth}, tools ${Math.round(tools.height)} ${scroll.outside?.join(" ") ?? ""}`);
  await host.shot(`${OUT}/../style/${host.name}-${label}.png`);
}

const usage = JSON.stringify(await s("s.usage()"));
check("usage.logged-locally", usage.includes("surface:canvas.write"));
check("usage.has-no-content", !usage.includes("Actin") && !usage.includes("load matters"));

await sleep(600);
await host.shot(`${OUT}/${host.name}.png`);

const beforeReload = await summary();
await host.reload();
await s("s.test(true)");
await s("s.closeAll()");
await sleep(500);
await s(`s.open(${q(ids.canvas)})`);
const restored = await at(card(renamed), 12000);
check("reload.canvas-restored", restored);
const afterReload = await summary();
check("reload.nothing-lost", afterReload.liveItems === beforeReload.liveItems && afterReload.strokes === beforeReload.strokes && afterReload.relations.length === beforeReload.relations.length, `${afterReload.liveItems} items, ${afterReload.strokes} stroke`);

await sleep(600);
await host.shot(`${OUT}/${host.name}-after-reload.png`);
const passed = results.filter((item) => item.pass).length;
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ host: host.name, build, passed, total: results.length, canvas: ids.canvas, results }, null, 1));
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
await host.finish();
