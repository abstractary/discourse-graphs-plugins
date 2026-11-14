// Zotero as the PDF library, in real Obsidian against the real Zotero app on this computer.
//   Open Zotero (with "Allow other applications…" ticked under Settings, Advanced), then:
//   npm run build:test && node harness/zotero-real-test.mjs
// It reads Zotero and writes nothing to it. It needs at least one reference with a PDF, and skips
// if Zotero isn't answering or the stand-in is running in its place.
// Leaves nothing: the unit, its source, the canvas and the setting are taken back.
import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const RUN = String(Date.now()).slice(-5);
const pdfsIn = (folder) => (existsSync(folder) ? readdirSync(folder, { recursive: true }).filter((name) => String(name).toLowerCase().endsWith(".pdf")).length : 0);

const t = await session({ out: resolve("reports/zotero-real"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call, cleanup } = t;
await s("s.test(true)");

// ---------------------------------------------------------------- Is the real Zotero there?
const status = await call("zotero.status");
if (!status.ok || status.serverId === "stub") {
  note(`SKIP: ${status.ok ? "the stand-in is answering on Zotero's port, not Zotero" : status.problem}`);
  process.exit(await t.finish("zotero-real"));
}
check("zotero.answers-obsidians-own-request", status.ok && /^\d+\./.test(status.version ?? ""), JSON.stringify(status));
const before = await call("prefs.get");
const pdfsBefore = pdfsIn(VAULT);
for (const canvas of (await call("canvas.list")).filter((item) => /^From Zotero \d{5}$/.test(item.title))) await call("canvas.remove", { id: canvas.id }).catch(() => undefined);

try {
  // ---------------------------------------------------------------- Switched on, Zotero's PDFs are the list
  const settingBack = cleanup("the Zotero setting", () => call("prefs.set", { zoteroLibrary: before.zoteroLibrary }));
  await call("prefs.set", { zoteroLibrary: true });
  const library = await call("pdf.library");
  check("library.is-on-and-reachable", library.on && library.reachable && !library.problem, JSON.stringify(library));
  if (library.files === 0) {
    note("SKIP the rest: Zotero has no PDFs. Add a reference with a PDF and run this again.");
    await settingBack();
    process.exit(await t.finish("zotero-real"));
  }
  const docs = await call("pdf.list");
  const theirs = docs.filter((doc) => doc.library);
  check("library.lists-zoteros-pdfs-first", theirs.length === library.files && Boolean(docs[0].library), `${theirs.length} of ${docs.length} are Zotero's`);
  const doc = theirs[0];
  check("library.names-a-pdf-for-its-reference", doc.title && doc.library.label && doc.library.open.startsWith("zotero://select/"), JSON.stringify({ title: doc.title.slice(0, 50), label: doc.library.label, open: doc.library.open }));

  // What the settings screen says, from the same call it makes.
  const told = await s("app.plugins.plugins['discourse-graphs-demo'].zoteroState()");
  check("settings.says-zotero-is-answering-with-its-pdfs", told.ok && told.on && told.files === library.files && /^\d+\./.test(told.version ?? ""), JSON.stringify(told));

  // ---------------------------------------------------------------- The chooser, and the file read in place
  await s("s.closeAll()");
  await call("pdf.show", {});
  check("chooser.has-an-in-zotero-group", await until(() => has("pdf", '[data-dg="pdf-in-zotero"]'), 10000));
  check("chooser.marks-zoteros-rows", ((await at("pdf", "count", '.pdf-chooser [data-dg="library-mark"]')) ?? 0) >= 1);
  await sleep(300);
  await shot("01-zotero-as-the-pdf-library");
  // The file is measured inside the app: its bytes are megabytes, and only their size and first few come back here.
  const opened = await s(`s.call("pdf.open", ${JSON.stringify({ ref: doc.ref })}).then((file) => ({ size: file.dataBase64.length, head: file.dataBase64.slice(0, 8) }))`);
  check("file.is-read-from-where-zotero-keeps-it", opened.size > 1000 && atob(opened.head).startsWith("%PDF-"), `${Math.round((opened.size * 3) / 4 / 1024)} KB`);
  check("file.nothing-is-copied-into-the-vault", pdfsIn(VAULT) === pdfsBefore, `${pdfsIn(VAULT)} PDFs in the vault, ${pdfsBefore} before`);
  await call("pdf.show", { ref: doc.ref });
  const drawn = await until(async () => ((await at("pdf", "count", ".pdf-page canvas, .pdf-page .textLayer, [data-dg='pdf-page']")) ?? 0) > 0, 20000);
  check("reader.draws-zoteros-pdf", drawn, String(await at("pdf", "text", '[data-dg="pdf-page"]')));
  check("reader.has-a-zotero-button", await until(() => has("pdf", '[data-dg="pdf-zotero"]'), 6000));
  await sleep(800);
  await shot("02-zoteros-pdf-in-the-reader");

  // ---------------------------------------------------------------- A highlight from it is a unit of that reference
  const words = doc.title.split(/\s+/).slice(0, 3).join(" ");
  const cut = await call("pdf.cut", { ref: doc.ref, exact: words, page: 1, title: `${words} ${RUN}`, canvas: null, newCanvas: `From Zotero ${RUN}` });
  const unit = cut.node;
  cleanup("the canvas", async () => {
    if (cut.canvas) await call("canvas.remove", { id: cut.canvas });
  });
  cleanup("the unit", () => call("node.remove", { id: unit.id }));
  check("unit.says-it-is-in-zotero", unit.card.library?.app === "zotero" && unit.card.library.what === "item", JSON.stringify(unit.card.library));
  check("unit.cites-the-reference", unit.card.source?.name === doc.library.label, `${unit.card.source?.name} vs ${doc.library.label}`);
  const view = await call("node.view", { id: unit.id });
  const sourceId = view.provenance.pdf?.source ?? (await call("pdf.list")).find((item) => item.ref === doc.ref)?.source;
  const source = sourceId ? (await call("node.view", { id: sourceId })).node : null;
  // The source unit goes whether this run made it or an earlier one did, as it always has here.
  if (sourceId) cleanup("the source", () => call("node.remove", { id: sourceId }));
  check("source.carries-the-references-identifiers", Boolean(source) && source.card.identifiers.length >= 1 && source.title === doc.title, JSON.stringify(source?.card.identifiers));
  await s("s.closeAll()");
  await s(`s.open(${q(cut.canvas)})`);
  await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) >= 1, 8000);
  await click("canvas", '[data-dg="fit"]');
  await sleep(700);
  check("card.shows-the-zotero-mark", await until(() => has("canvas", '.card [data-dg^="library-"]'), 6000));
  await call("focus.set", { node: unit.id });
  await s('s.openSide("context")');
  check("context.offers-the-way-back", await until(() => has("context", '[data-dg="ctx-library-open"]'), 8000), await at("context", "text", '[data-dg="ctx-library"]'));
  await shot("03-a-unit-read-from-zoteros-pdf");

  // ---------------------------------------------------------------- Put things back
  await settingBack();
  check("setting.is-put-back", (await call("prefs.get")).zoteroLibrary === before.zoteroLibrary);
} finally {
  await cleanup.run();
}
process.exit(await t.finish("zotero-real"));
