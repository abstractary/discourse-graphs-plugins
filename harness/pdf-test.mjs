// The PDF reader and the units drawer inside real Obsidian: the reader opens
// beside the canvas, renders with selectable text and lights a paper's units;
// a real mouse highlight brings up the popup, a letter picks the type, and
// saving puts the unit on the canvas, with Undo; a dropped PDF is kept and
// opened. Under the canvas, the drawer lists what isn't on it yet, by canvas
// and folder, as a list or a grid; units go on by dragging, as a selection,
// or a whole group at once.
//   npm run build:test, then: node harness/pdf-test.mjs
// It copies the build into the throwaway vault, adds the worked example as one
// more device's log, and puts the example paper's PDF in "Paper files".
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, sleep } from "./hosts.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const OUT = resolve("reports/pdf");
mkdirSync(OUT, { recursive: true });

const PAPER = "Paper files/preclinical-sle-mediators.pdf";
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8"));
writeFileSync(`${VAULT}/discourse-graph/records/worked-example.jsonl`, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
mkdirSync(`${VAULT}/Paper files`, { recursive: true });
copyFileSync("demo/papers/preclinical-sle-mediators.pdf", `${VAULT}/${PAPER}`);
for (const name of ["Dropped paper.pdf", "Dropped paper 2.pdf", "Dropped paper 3.pdf"]) rmSync(`${VAULT}/Paper files/${name}`, { force: true });
for (const file of ["main.js", "manifest.json"]) copyFileSync(`dist/obsidian/${file}`, `${VAULT}/.obsidian/plugins/discourse-graphs-demo/${file}`);

const host = obsidian();
await host.reload();
const s = host.slice;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 160)}` : ""}`);
};
const until = async (work, timeout = 20000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work().catch(() => null);
    if (value || Date.now() > deadline) return value;
    await sleep(400);
  }
};
const q = JSON.stringify;
const mouse = (type, x, y, buttons = 0, clickCount = 1) =>
  host.input("Input.dispatchMouseEvent", { type, x, y, buttons, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount });
const key = async (text) => {
  await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: text, text, unmodifiedText: text });
  await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: text });
};
const clickAt = async ({ x, y }) => {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, 1, 1);
  await mouse("mouseReleased", x, y, 0, 1);
};
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const pdfClick = async (selector) => {
  const box = await until(() => s(`s.pdfLocate(${q(selector)})`));
  if (!box) throw new Error(`Couldn't find ${selector}`);
  await clickAt(centre(box));
};
const canvasClick = async (selector) => {
  await s(`s.canvasReveal(${q(selector)})`);
  await sleep(150);
  const box = await until(() => s(`s.locate(${q(selector)})`));
  if (!box) throw new Error(`Couldn't find ${selector}`);
  await clickAt(centre(box));
};

await s("s.test(true)");
await s("s.closeAll()");

// The canvas, then the reader beside it.
const canvas = await until(async () => (await s(`s.call("canvas.summaries", {})`)).find((c) => c.title.startsWith("Issue exchange")));
// Whatever this run puts on the shared example canvas comes off again at the end, so other suites see it as it was.
const original = new Set(records.filter((r) => r.kind === "canvas-item" && r.canvas === canvas.id).map((r) => r.id));
const tidyUp = async () => {
  const view = await s(`s.call("canvas.open", { id: ${q(canvas.id)} })`);
  const extra = view.items.map((item) => item.id).filter((id) => !original.has(id));
  if (extra.length) await s(`s.call("canvas.write", { canvas: ${q(canvas.id)}, removes: ${q(extra)} })`);
  return extra.length;
};
await tidyUp();
await s(`s.open(${q(canvas.id)})`);
await until(() => s(`s.text('[data-dg="canvas-menu"]')`).then((t) => (t ?? "").startsWith("Issue exchange")));
await s(`s.openPdf(${q(PAPER)})`);
const pages = await until(async () => ((await s(`s.pdfCount(".pdf-page")`)) === 12 ? 12 : null));
const layout = await s("s.layout()");
const reader = layout.find((l) => l.surface === "pdf");
const shownCanvas = layout.find((l) => l.surface === "canvas" && l.shown);
check("pdf.beside-the-canvas", reader?.shown && shownCanvas && reader.x !== shownCanvas.x, JSON.stringify(layout.map((l) => [l.surface, l.x, l.width, l.shown])));
check("pdf.tab-title-is-the-file", reader?.title === "preclinical-sle-mediators", reader?.title);
check("panel-headers-say-what-they-show", reader?.header === "preclinical-sle-mediators" && shownCanvas?.header?.startsWith("Issue exchange"), `${reader?.header} | ${shownCanvas?.header}`);
check("pdf.renders-pages", pages === 12);
const spans = await until(async () => ((await s(`s.pdfCount('[data-dg="pdf-page-1"] .textLayer span')`)) > 20 ? s(`s.pdfCount('[data-dg="pdf-page-1"] .textLayer span')`) : null));
check("pdf.text-layer", spans > 20, `${spans} spans on page 1`);
const units = await until(async () => {
  const text = (await s(`s.pdfText('[data-dg="pdf-units"]')`)) ?? "";
  return /\d/.test(text) && Number(text.replace(/\D/g, "")) > 0 ? text : null;
});
check("pdf.lights-the-papers-units", units, units);
check("pdf.theme", (await s("s.pdfTheme()")) === (await s("s.theme()")));
await host.shot(`${OUT}/obsidian-pdf-beside-canvas.png`);

// A real highlight, with the mouse, on a long run of page 1's text.
let span = null;
for (let n = 1; n <= Math.min(spans, 120); n += 1) {
  const text = (await s(`s.pdfText('[data-dg="pdf-page-1"] .textLayer span:nth-of-type(${n})')`)) ?? "";
  if (text.length > 40 && /[a-z]{4}/.test(text)) {
    span = { n, text };
    break;
  }
}
const spanBox = span ? await s(`s.pdfLocate('[data-dg="pdf-page-1"] .textLayer span:nth-of-type(${span.n})')`) : null;
if (spanBox) {
  const y = spanBox.y + spanBox.height / 2;
  await mouse("mouseMoved", spanBox.x + 2, y);
  await mouse("mousePressed", spanBox.x + 2, y, 1, 1);
  for (let step = 1; step <= 6; step += 1) await mouse("mouseMoved", spanBox.x + 2 + ((spanBox.width - 6) * step) / 6, y, 1);
  await mouse("mouseReleased", spanBox.x + spanBox.width - 4, y, 0, 1);
}
const popup = await until(() => s(`s.pdfCount('[data-dg="pdf-cut"]')`).then((n) => n === 1));
const selected = await s("s.pdfSelection()");
check("pdf.highlight-opens-the-popup", popup && selected?.length > 10, selected);
check("pdf.popup-defaults-to-the-open-canvas", (await s(`s.pdfValue('[data-dg="cut-canvas"]')`)) === canvas.id);
await host.shot(`${OUT}/obsidian-pdf-popup.png`);
await key("c");
const picked = await until(() => s(`s.pdfCount('[data-dg="cut-type-Claim"][aria-checked="true"]')`).then((n) => n === 1));
check("pdf.letter-picks-the-type", picked);
const title = await s(`s.pdfValue('[data-dg="cut-title"]')`);
const marksBefore = await s(`s.pdfCount(".pdf-mark:not(.pending)")`);
await pdfClick('[data-dg="cut-save"]');
const notice = await until(async () => {
  const text = (await s(`s.pdfText('[data-dg="pdf-notice"]')`)) ?? "";
  return text.includes("Saved as Claim") ? text : null;
});
check("pdf.save-says-where", notice?.includes("Issue exchange"), notice);
const onCanvas = await until(async () => {
  const view = await s(`s.call("canvas.open", { id: ${q(canvas.id)} })`);
  return Object.values(view.nodes).find((n) => n.title === title) ?? null;
});
check("canvas.gets-the-highlighted-unit", onCanvas?.typeLabel === "Claim" && onCanvas?.staged, onCanvas?.title);
const marksAfter = await until(async () => {
  const n = await s(`s.pdfCount(".pdf-mark:not(.pending)")`);
  return n > marksBefore ? n : null;
});
check("pdf.new-passage-lit", marksAfter > marksBefore, `${marksBefore} -> ${marksAfter}`);
const card = await until(() => s(`s.text(${q(`[data-dg="card-${title}"]`)})`));
check("canvas.shows-the-card", card);
const provenance = onCanvas ? await s(`s.call("node.view", { id: ${q(onCanvas.id)} })`) : null;
check("context.knows-the-passage", provenance?.provenance.pdf?.ref === PAPER && provenance.provenance.pdf.page === 1, JSON.stringify(provenance?.provenance.pdf ?? null));
await host.shot(`${OUT}/obsidian-pdf-saved.png`);

// Undo takes it back.
await pdfClick('[data-dg="pdf-undo"]');
const undone = await until(async () => {
  const view = await s(`s.call("canvas.open", { id: ${q(canvas.id)} })`);
  return Object.values(view.nodes).some((n) => n.title === title) ? null : true;
});
check("pdf.undo-takes-it-back", undone);

// The context panel's link goes to the passage.
const evidence = (await s(`s.call("pdf.open", { ref: ${q(PAPER)}, data: false })`)).marks.find((m) => m.page === undefined || m.page > 3);
await s(`s.call("pdf.show", { ref: ${q(PAPER)}, unit: ${q(evidence.unit.id)} })`);
const scrolled = await until(async () => {
  const page = Number(await s(`s.pdfValue('[data-dg="pdf-page"] input')`));
  return page > 1 ? page : null;
});
check("pdf.show-scrolls-to-the-passage", scrolled > 1, `page ${scrolled}`);
const active = await until(() => s(`s.pdfCount(".pdf-mark[data-active]")`).then((n) => (n > 0 ? n : null)));
check("pdf.show-marks-it-active", active > 0);

// A PDF dropped on the reader is kept with the papers and opened.
await s(`s.pdfDropVaultFile('[data-dg="pdf-shell"]', ${q(PAPER)}, "Dropped paper.pdf")`);
const dropped = await until(async () => (await s("s.layout()")).find((l) => l.surface === "pdf" && l.id === "Paper files/Dropped paper.pdf"));
check("pdf.drop-keeps-and-opens", dropped && dropped.header === "Dropped paper", `${dropped?.title} | ${dropped?.header}`);
check("obsidian.read-this-pdf-command", await s(`Boolean(app.commands.commands["discourse-graphs-demo:read-this-pdf"])`));

// The drawer under the canvas.
await canvasClick('[data-dg="drawer-toggle"]');
const segments = await until(async () => ((await s(`s.count(".drawer-seg")`)) > 0 ? s(`s.count(".drawer-seg")`) : null));
const count = Number(((await s(`s.text('[data-dg="drawer-count"]')`)) ?? "").replace(/\D/g, ""));
const onIt = Object.keys((await s(`s.call("canvas.open", { id: ${q(canvas.id)} })`)).nodes).length;
const available = await s(`s.call("units.available", { canvas: ${q(canvas.id)} })`);
check("drawer.lists-what-isnt-here", count === Object.keys(available.units).length && count > 0, `${count} to place, ${onIt} here, ${segments} groups`);
check("drawer.groups-by-canvas-and-folder", available.segments.some((g) => g.kind === "canvas"), available.segments.map((g) => `${g.kind}:${g.title}`).join(", "));
await canvasClick('[data-dg="drawer-grid"]');
check("drawer.grid", (await s(`s.count('[data-dg="drawer-body"][data-view="grid"]')`)) === 1);
await host.shot(`${OUT}/obsidian-drawer-grid.png`);
await canvasClick('[data-dg="drawer-list"]');

const paperGroup = available.segments.find((g) => g.kind === "canvas" && g.title.startsWith("Preclinical"));
const related = available.relations.find((r) => paperGroup.units.includes(r.source) && paperGroup.units.includes(r.target));
const pair = related ? [related.source, related.target] : paperGroup.units.slice(0, 2);
const edgesBefore = await s(`s.count(".react-flow__edge")`);
const cardsBefore = await s(`s.count(".react-flow__node")`);
for (const id of pair) {
  const unitTitle = available.units[id].title;
  await canvasClick(`[data-dg="drawer-seg-${paperGroup.title}"] [data-dg="drawer-unit-${unitTitle}"]`);
}
const label = await until(() => s(`s.text('[data-dg="drawer-place"]')`));
check("drawer.click-selects", label === "Place 2 together", label);
await canvasClick('[data-dg="drawer-place"]');
const placed = await until(async () => ((await s(`s.count(".react-flow__node")`)) >= cardsBefore + 2 ? s(`s.count(".react-flow__node")`) : null));
const edgesAfter = await s(`s.count(".react-flow__edge")`);
check("drawer.place-together", placed >= cardsBefore + 2, `${cardsBefore} -> ${placed} cards`);
check("drawer.links-come-along", !related || edgesAfter > edgesBefore, `${edgesBefore} -> ${edgesAfter} links`);

// Drag one onto the canvas, where it's dropped.
const next = await s(`s.call("units.available", { canvas: ${q(canvas.id)} })`);
const loose = next.segments.find((g) => g.kind !== "canvas" || !g.title.startsWith("Preclinical")) ?? next.segments[0];
const dragged = next.units[loose.units[0]];
const area = await s(`s.locate(".area")`);
const frame = await s(`s.locate("html")`);
const drop = { x: area.x - frame.x + area.width * 0.35, y: area.y - frame.y + area.height * 0.3 };
const types = await s(`s.dragTo(${q(`[data-dg="drawer-seg-${loose.title}"] [data-dg="drawer-unit-${dragged.title}"]`)}, ${q(drop)})`);
const landed = await until(() => s(`s.locate(${q(`[data-dg="card-${dragged.title}"]`)})`));
const off = landed ? Math.hypot(landed.x + Math.min(landed.width, 240) / 2 - (drop.x + frame.x), landed.y - (drop.y + frame.y)) : Infinity;
check("drawer.drag-drops-where-dropped", off < 60, `${JSON.stringify(types)}, ${Math.round(off)} px from the drop point`);

// A whole group at once.
const group = (await s(`s.call("units.available", { canvas: ${q(canvas.id)} })`)).segments.find((g) => g.kind === "canvas");
if (group) {
  await canvasClick(`[data-dg="drawer-place-all-${group.title}"]`);
  const gone = await until(async () => ((await s(`s.call("units.available", { canvas: ${q(canvas.id)} })`)).segments.some((g) => g.id === group.id) ? null : true));
  check("drawer.place-a-whole-group", gone, group.title);
} else check("drawer.place-a-whole-group", false, "no group left");
await host.shot(`${OUT}/obsidian-drawer-placed.png`);

console.log(`took ${await tidyUp()} placed items back off the example canvas`);
await s("s.closeAll()");
await host.finish();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
