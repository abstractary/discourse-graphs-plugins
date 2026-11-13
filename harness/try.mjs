// Unit search and the canvas basics inside real Obsidian. The search panel opens
// in the right sidebar and finds units by title, note text and PDF passage, with
// filters; a result goes on the open canvas, and undo takes it off. The quick
// finder opens over the vault, and opens, links or places a unit from the
// keyboard. On the canvas, a person renames their own unit on its card but not a
// teammate's; Delete on a link asks whether it's only coming off or being
// withdrawn, can remember the answer, and only a relation's author can withdraw
// it; cards copy and paste between canvases; and every edit undoes and redoes.
//   npm run build:test, then: node harness/search-test.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, sleep } from "./hosts.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const OUT = resolve("reports/search");
mkdirSync(OUT, { recursive: true });

const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8"));
writeFileSync(`${VAULT}/discourse-graph/records/worked-example.jsonl`, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
for (const file of ["main.js", "manifest.json"]) copyFileSync(`dist/obsidian/${file}`, `${VAULT}/.obsidian/plugins/discourse-graphs-demo/${file}`);

const host = obsidian();
await host.reload();
const s = host.slice;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 160)}` : ""}`);
};
const until = async (work, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work().catch(() => null);
    if (value || Date.now() > deadline) return value;
    await sleep(350);
  }
};
const q = JSON.stringify;
const mouse = (type, x, y, buttons = 0, clickCount = 1, modifiers = 0) =>
  host.input("Input.dispatchMouseEvent", { type, x, y, buttons, modifiers, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount });
const clickAt = async ({ x, y }, { count = 1, modifiers = 0 } = {}) => {
  await mouse("mouseMoved", x, y);
  for (let n = 1; n <= count; n += 1) {
    await mouse("mousePressed", x, y, 1, n, modifiers);
    await mouse("mouseReleased", x, y, 0, n, modifiers);
  }
};
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const KEYS = { Enter: 13, Escape: 27, Delete: 46, F2: 113, Backspace: 8 };
/** A key with modifiers; `commands` runs an editing command, as a base's Edit menu would. */
const press = async (key, { meta = false, shift = false, alt = false, commands } = {}) => {
  const modifiers = (alt ? 1 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
  const keyCode = KEYS[key] ?? key.toUpperCase().charCodeAt(0);
  const code = KEYS[key] ? key : `Key${key.toUpperCase()}`;
  await host.input("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(commands ? { commands } : {}) });
  await host.input("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
};
const typeText = (text) => host.input("Input.insertText", { text });
/** Typing key by key, as a person does, into whatever has the keyboard. */
const typeKeys = async (text) => {
  for (const char of text) {
    await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char, unmodifiedText: char });
    await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: char });
  }
};
const where = (probe, selector) => until(() => s(`${probe}.locate(${q(selector)})`));
const click = async (probe, selector, options) => {
  const box = await where(probe, selector);
  if (!box) throw new Error(`Couldn't find ${selector}`);
  await clickAt(centre(box), options);
};
const canvasClick = async (selector, options) => {
  await s(`s.canvasReveal(${q(selector)})`);
  await sleep(150);
  await click("s", selector, options);
};
/** A click on bare canvas, near its lower left, where no card sits: the middle can hold one. */
const paneClick = async () => {
  const frame = await s(`s.locate("html")`);
  await clickAt({ x: frame.x + 60, y: frame.y + frame.height - 120 });
};
const fitAll = async () => {
  await canvasClick('[data-dg="fit"]');
  await sleep(500);
};
const view = (id) => s(`s.call("canvas.open", { id: ${q(id)} })`);
const unitsOn = async (id) => Object.keys((await view(id)).nodes);
const status = () => s(`s.text('[data-dg="status-text"]')`);

var checkk = (name, pass, detail) => { if (!pass) console.log("FAILED", name, String(detail ?? "").slice(0, 200)); };
await s("s.test(true)");
await s("s.closeAll()");
await s(`s.setPrefs({ linkDelete: "ask" })`);

// Two units of this person's, with a relation between them, on a canvas of their own.
const grammar = await s(`s.call("grammar.get", {})`);
const typeId = (label) => grammar.nodeTypes.find((t) => t.label === label).id;
const A = await s(`s.call("node.create", { title: "ST claim about mediators", type: ${q(typeId("Claim"))} })`);
const B = await s(`s.call("node.create", { title: "ST evidence from the cohort", type: ${q(typeId("Evidence"))} })`);
const option = (await s(`s.call("relation.options", { source: ${q(B.id)}, target: ${q(A.id)} })`)).find((o) => !o.flipped);
await s(`s.call("relation.assert", { type: ${q(option.type)}, source: ${q(B.id)}, target: ${q(A.id)} })`);
const canvasNamed = async (title) => {
  const known = (await s(`s.call("canvas.summaries", {})`)).find((c) => c.title === title);
  const id = known?.id ?? (await s(`s.call("canvas.create", { title: ${q(title)} })`)).id;
  const items = (await view(id)).items.map((item) => item.id);
  if (items.length) await s(`s.call("canvas.write", { canvas: ${q(id)}, removes: ${q(items)} })`);
  return id;
};
const board = await canvasNamed("Search test");
const target = await canvasNamed("Paste target");
await s(`s.call("units.put", { canvas: ${q(board)}, nodes: ${q([A.id, B.id])} })`);
// A's note says something only it says.
await s(`(async () => { const f = app.vault.getMarkdownFiles().find((x) => x.basename.endsWith("ST claim about mediators")); await app.vault.modify(f, (await app.vault.read(f)) + "\\nMeasured with a quokka bead panel.\\n"); return true; })()`);
await s(`s.open(${q(board)})`);
await until(() => s(`s.text('[data-dg="canvas-menu"]')`).then((t) => t === "Search test"));
await until(() => s(`s.locate('[data-dg="card-ST claim about mediators"]')`));

// ---- The search panel ----
await s("s.openSearch()");
const panel = await until(async () => (await s("s.layout()")).find((l) => l.surface === "search" && l.shown));
checkk("search.opens-in-the-sidebar", panel?.title === "Search units" && panel.header === "Search units", JSON.stringify(panel));
await click("s.search", '[data-dg="search-input"]');
await typeText("quokka");
const noteHit = await until(async () => ((await s(`s.search.text('[data-dg="search-count"]')`)) === "1 unit" ? s(`s.search.text('[data-dg="search-results"]')`) : null));
checkk("search.finds-note-text", noteHit?.includes("ST claim about mediators") && /note/i.test(noteHit), noteHit);

// A word only in a worked-example unit's PDF passage.
let passageUnit = null;
let passageWord = null;
for (const unit of records.filter((r) => r.kind === "node" && (r.facts?.anchor?.exact || r.source?.anchor))) {
  const text = unit.facts?.anchor?.exact ?? unit.source.anchor;
  for (const word of text.split(/[^A-Za-z]+/).filter((w) => w.length > 7 && !unit.title.toLowerCase().includes(w.toLowerCase()))) {
    const found = await s(`s.call("search.query", { text: ${q(word)}, limit: 5 })`);
    if (found.hits.some((hit) => hit.node.id === unit.id && hit.match?.field === "passage")) {
      passageUnit = unit;
      passageWord = word;
      break;
    }
  }
  if (passageWord) break;
}
await click("s.search", '[data-dg="search-clear"]');
await click("s.search", '[data-dg="search-input"]');
await typeText(passageWord);
const passageHit = await until(async () => {
  const text = (await s(`s.search.text('[data-dg="search-results"]')`)) ?? "";
  return passageUnit && text.includes(passageUnit.title.slice(0, 30)) ? text : null;
});
checkk("search.finds-pdf-passages", passageHit && /passage/i.test(passageHit), `${passageWord}: ${passageHit?.slice(0, 120)}`);

await click("s.search", '[data-dg="search-clear"]');
await click("s.search", '[data-dg="search-input"]');
await typeText("ifn");
const ifn = (await s(`s.call("search.query", { text: "ifn", limit: 50 })`)).total;
const all = await until(async () => {
  const count = Number.parseInt((await s(`s.search.text('[data-dg="search-count"]')`)) ?? "", 10);
  return count === ifn ? count : null;
});
await s(`s.search.choose('[data-dg="search-type"]', ${q(typeId("Evidence"))})`);
const evidenceOnly = await until(async () => {
  const count = Number.parseInt((await s(`s.search.text('[data-dg="search-count"]')`)) ?? "", 10);
  return count && count < all ? count : null;
});
const core = await s(`s.call("search.query", { text: "ifn", types: [${q(typeId("Evidence"))}], limit: 50 })`);
checkk("search.filters-by-type", evidenceOnly === core.total, `${all} -> ${evidenceOnly} (core says ${core.total})`);
const credits = await s(`s.search.text('[data-dg="search-credit"]')`);
checkk("search.filters-by-person-or-lab", /Akamatsu Lab \(lab\)/.test(credits ?? ""), credits);
await host.shot(`${OUT}/obsidian-search-panel.png`);

// The first result not on this canvas, put on it from its preview; undo takes it off.
const notHere = core.hits.find((hit) => !hit.canvases.some((c) => c.id === board));
await click("s.search", `[data-dg="search-hit-${notHere.node.title}"]`);
console.log("B@172", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await click("s.search", `[data-dg="search-hit-${notHere.node');
await until(() => s(`s.search.count('[data-dg="search-preview"]')`).then((n) => n === 1));
await click("s.search", '[data-dg="search-put"]');
console.log("B@174", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await click("s.search", \'[data-dg="search-put"]\');');
const put = await until(async () => ((await unitsOn(board)).includes(notHere.node.id) ? true : null));
checkk("search.put-on-the-open-canvas", put, notHere.node.title);
console.log("B@176", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("search.put-on-the-open-canvas", put, notHere.node.ti');
await paneClick();
console.log("B@177", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await paneClick();');
await press("z", { meta: true });
console.log("B@178", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("z", { meta: true });');
const putUndone = await until(async () => ((await unitsOn(board)).includes(notHere.node.id) ? null : true));
checkk("undo.takes-off-units-put-from-search", putUndone, await status());
console.log("B@180", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("undo.takes-off-units-put-from-search", putUndone, aw');

// ---- The quick finder ----
await s("s.findUnit()");
const opened = await until(() => s("s.dialogOpen()"));
await until(() => s(`s.dialog.count('[data-dg="find-input"]')`).then((n) => n === 1));
await sleep(300);
// The finder's frame has the keyboard, and inside it the search box does.
const framed = await s(`document.activeElement === document.querySelector('[data-dg="dialog"] iframe')`);
const focused = framed ? await s(`s.dialog.focus()`) : "the finder's frame doesn't have the keyboard";
await typeKeys("nephritis");
const finderRows = await until(async () => {
  const text = (await s(`s.dialog.text('[data-dg="find-results"]')`)) ?? "";
  return (await s(`s.dialog.value('[data-dg="find-input"]')`)) === "nephritis" && text.toLowerCase().includes("nephritis") ? text : null;
});
checkk("find.opens-and-takes-typing", opened && focused === "find-input" && finderRows?.toLowerCase().includes("nephritis"), `${focused}: ${finderRows?.slice(0, 120)}`);
console.log("B@195", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("find.opens-and-takes-typing", opened && focused === ');
await host.shot(`${OUT}/obsidian-quick-finder.png`);
const firstFound = (await s(`s.call("search.query", { text: "nephritis", limit: 12 })`)).hits[0].node;
await press("Enter", { meta: true });
console.log("B@198", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("Enter", { meta: true });');
const finderPut = await until(async () => ((await unitsOn(board)).includes(firstFound.id) && !(await s("s.dialogOpen()")) ? true : null));
checkk("find.mod-enter-puts-it-on-the-canvas", finderPut, firstFound.title);
console.log("B@200", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("find.mod-enter-puts-it-on-the-canvas", finderPut, fi');

await s("s.findUnit()");
await until(() => s(`s.dialog.count('[data-dg="find-input"]')`).then((n) => n === 1));
await sleep(300);
await press("Escape");
console.log("B@205", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("Escape");');
checkk("find.escape-closes", await until(async () => ((await s("s.dialogOpen()")) ? null : true)));
console.log("B@206", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("find.escape-closes", await until(async () => ((await');

const noteRef = await s(`s.writeAtEnd("ST linking note ${Date.now()}", "Linking here: ")`);
await s("s.findUnit()");
await until(() => s(`s.dialog.count('[data-dg="find-input"]')`).then((n) => n === 1));
await sleep(300);
await typeKeys("ST claim about mediators");
await until(() => s(`s.dialog.count('[data-dg="find-hit-ST claim about mediators"]')`).then((n) => n === 1));
await press("Enter", { alt: true });
console.log("B@214", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("Enter", { alt: true });');
const linked = await until(async () => ((await s(`s.noteBody(${q(noteRef)})`)) ?? "").includes("[[CLM - ST claim about mediators]]"));
checkk("find.alt-enter-links-at-the-cursor", linked, await s(`s.noteBody(${q(noteRef)})`));
console.log("B@216", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("find.alt-enter-links-at-the-cursor", linked, await s');
// The note opened beside the canvas; closing it leaves one canvas in view, as a person would.
await s("s.focusCanvas()");

await s("s.findUnit()");
await until(() => s(`s.dialog.count('[data-dg="find-input"]')`).then((n) => n === 1));
await sleep(300);
await typeKeys("autoantibodies");
await until(() => s(`s.dialog.count(".find-row")`).then((n) => n > 0));
await click("s.dialog", '[data-dg="find-all"]');
console.log("B@225", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await click("s.dialog", \'[data-dg="find-all"]\');');
const carried = await until(async () => ((await s(`s.search.value('[data-dg="search-input"]')`)) === "autoantibodies" ? true : null));
checkk("find.hands-its-search-to-the-panel", carried && !(await s("s.dialogOpen()")));
console.log("B@227", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("find.hands-its-search-to-the-panel", carried && !(aw');

// ---- Card titles ----
await s(`s.open(${q(board)})`);
await canvasClick('[data-dg="title-ST claim about mediators"]', { count: 2 });
console.log("B@231", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await canvasClick(\'[data-dg="title-ST claim about mediators"');
const editing = await until(() => s(`s.count('[data-dg="card-title-edit"]')`).then((n) => n === 1));
await press("a", { meta: true, commands: ["selectAll"] });
console.log("B@233", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("a", { meta: true, commands: ["selectAll"] });');
await typeText("ST claim about soluble mediators");
await press("Enter");
console.log("B@235", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("Enter");');
const renamed = await until(async () => ((await s(`s.call("node.view", { id: ${q(A.id)} })`)).node.title === "ST claim about soluble mediators" ? true : null));
const file = await s(`s.searchBase("ST claim about soluble mediators")`);
checkk("card.renames-own-unit-and-note", editing && renamed && file.length === 1, JSON.stringify(file));
console.log("B@238", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("card.renames-own-unit-and-note", editing && renamed ');
await press("z", { meta: true });
console.log("B@239", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("z", { meta: true });');
const unrenamed = await until(async () => ((await s(`s.call("node.view", { id: ${q(A.id)} })`)).node.title === "ST claim about mediators" ? true : null));
checkk("undo.renames-back", unrenamed, await status());
console.log("B@241", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("undo.renames-back", unrenamed, await status());');
await press("z", { meta: true, shift: true });
console.log("B@242", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("z", { meta: true, shift: true });');
const redone = await until(async () => ((await s(`s.call("node.view", { id: ${q(A.id)} })`)).node.title === "ST claim about soluble mediators" ? true : null));
checkk("redo.renames-again", redone, await status());
console.log("B@244", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'checkk("redo.renames-again", redone, await status());');
await press("z", { meta: true });
console.log("B@245", (await view(board)).items.some((i) => i.item.dg?.node === B.id), 'await press("z", { meta: true });');
await until(async () => ((await s(`s.call("node.view", { id: ${q(A.id)} })`)).node.title === "ST claim about mediators" ? true : null));
console.log("C@270", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'await until(async () => ((await s(`s.call("node.vi');

// A teammate's unit, and a relation a teammate asserted between two of their units, from what core reports.
const me = (await s(`s.call("identity.get", {})`)).did;
const available = await s(`s.call("units.available", { canvas: ${q(board)} })`);
console.log("C@274", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'const available = await s(`s.call("units.available');
let theirRelation = null;
for (const link of available.relations) {
  if (link.source === link.target) continue;
  const entry = (await s(`s.call("node.view", { id: ${q(link.source)} })`)).context.find(
    (c) => c.other.id === link.target && c.relation.source !== c.relation.target && (c.state === "active" || c.state === "pending") && c.relation.by.id !== me,
  );
  if (!entry) continue;
  await s(`s.call("units.put", { canvas: ${q(board)}, nodes: ${q([link.source, link.target])} })`);
  if (await until(async () => ((await view(board)).items.some((item) => item.item.dg?.relation === entry.relation.id) ? true : null), 3000)) {
    theirRelation = entry.relation;
    break;
  }
}
const theirs = available.units[theirRelation.source];
console.log("C@288", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'const theirs = available.units[theirRelation.sourc');
await until(() => s(`s.locate(${q(`[data-dg="title-${theirs.title}"]`)})`));
await fitAll();
console.log("C@290", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'await fitAll();');
await canvasClick(`[data-dg="title-${theirs.title}"]`);
console.log("C@291", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'await canvasClick(`[data-dg="title-${theirs.title}');
await press("F2");
console.log("C@292", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'await press("F2");');
const refused = await until(async () => ((await status()) ?? "").match(/can rename/) ? status() : null);
console.log("C@293", (await view(board)).items.some((i) => i.item.dg?.node === B.id), (await view(board)).items.length, await status(), 'const refused = await until(async () => ((await st');
checkk("card.teammates-unit-stays-theirs", !theirs.mine && refused && (await s(`s.count('[data-dg="card-title-edit"]')`)) === 0, refused);

// ---- Deleting a link ----
const edgeOf = async (canvas, relation) => (await view(canvas)).items.find((item) => item.item.dg?.relation === relation)?.id;
const relationOf = async () => (await s(`s.call("node.view", { id: ${q(A.id)} })`)).context.find((c) => c.other.id === B.id && c.state === "active")?.relation.id;
let rel = await relationOf();
/** Clicks a link where no card covers it: a link's label can sit under a card. */
const pickEdge = async (canvas, relation) => {
  const id = await until(() => edgeOf(canvas, relation));
  await fitAll();
  const drawn = await until(() => s("s.drawn()").then((d) => (d?.links?.some((link) => link.id === id) ? d : null)));
  const frame = await s(`s.locate("html")`);
  const link = drawn.links.find((entry) => entry.id === id);
  const inside = ([x, y]) => drawn.cards.some((c) => x >= c.x - 4 && x <= c.x + c.width + 4 && y >= c.y - 4 && y <= c.y + c.height + 4);
  const [x, y] = link.points.slice(4, -4).find((point) => !inside(point)) ?? link.points[24];
  await clickAt({ x: frame.x + x, y: frame.y + y });
  await until(() => s(`s.count('.react-flow__edge.selected[data-id="${id}"]')`).then((n) => n === 1), 3000);
  return id;
};
let edge = await pickEdge(board, rel);
await sleep(800); await host.shot(`${OUT}/debug.png`); console.log("PICK", await s(`s.count('.react-flow__edge.selected')`), await s(`s.count('.react-flow__node.selected')`)); process.exit(0);
await press("Delete");
const asked = await until(() => s(`s.count('[data-dg="link-delete"]')`).then((n) => n === 1));
const withdrawable = (await s(`s.count('[data-dg="link-delete-withdraw"]:not([disabled])')`)) === 1;

const items = (await view(board)).items;
console.log("STATE", JSON.stringify({ rel, edge, hasB: items.some((i) => i.item.dg?.node === B.id), hasA: items.some((i) => i.item.dg?.node === A.id), n: items.length, edges: items.filter((i) => i.item.dg?.relation).length, sel: await s(`s.count('.react-flow__edge.selected')`), status: await status() }));
await host.shot(`${OUT}/debug.png`);
process.exit(0);
