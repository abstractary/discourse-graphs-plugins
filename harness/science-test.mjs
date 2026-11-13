// A scientist's session in real Obsidian, on three reservoir computing papers:
// Extract graph three ways, then read, search, compare and argue across them.
//   npm run build:test, then: node harness/science-test.mjs [stage ...]
// Needs the three PDFs and their saved extractions in the sandbox vault under
// "Paper files/reservoir-computing" (see docs/testing.md). Pictures go to reports/science.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const FOLDER = "Paper files/reservoir-computing";
const PAPERS = {
  carroll: { file: "Carroll-2020-edge-of-chaos.pdf", title: "Do Reservoir Computers Work Best at the Edge of Chaos?", units: 36, relations: 59 },
  dambre: { file: "Dambre-2012-information-processing-capacity.pdf", title: "Information Processing Capacity of Dynamical Systems", units: 28, relations: 28 },
  gauthier: { file: "Gauthier-2021-next-generation-reservoir-computing.pdf", title: "Next Generation Reservoir Computing", units: 45, relations: 70 },
};
if (!existsSync(`${VAULT}/${FOLDER}/${PAPERS.carroll.file}`)) {
  console.log(`SKIP: put the three papers and their .graph.json files in ${VAULT}/${FOLDER} first.`);
  process.exit(0);
}

const stages = process.argv.slice(2);
const wants = (name) => stages.length === 0 || stages.includes(name);
const t = await session({ out: resolve("reports/science"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call, type, key } = t;

await s("s.test(true)");
const paperOf = async (name) => (await call("paper.list")).find((paper) => paper.filename === PAPERS[name].file);
const cards = () => at("canvas", "count", ".react-flow__node");

// ---------------------------------------------------------------- Extract graph, three ways in
if (wants("extract")) {
  await s("s.closeAll()");
  // 1. From the reader: open the PDF, press Extract graph.
  const fresh = !(await paperOf("carroll"));
  if (fresh) {
    await s(`s.openPdf(${q(`${FOLDER}/${PAPERS.carroll.file}`)})`);
    const offered = await until(() => has("pdf", '[data-dg="pdf-extract"]'));
    check("extract.reader-offers-it", offered);
    await shot("01-reader-before-extract");
    await click("pdf", '[data-dg="pdf-extract"]');
    await until(() => paperOf("carroll"));
  }
  let paper = await paperOf("carroll");
  check("extract.reader-makes-the-paper", paper?.units === PAPERS.carroll.units && paper?.relations === PAPERS.carroll.relations, `${paper?.units} units, ${paper?.relations} links, ${paper?.server}`);
  if (fresh) {
    await until(async () => ((await cards()) ?? 0) >= PAPERS.carroll.units, 15000);
    check("extract.canvas-opens-beside-the-reader", (await cards()) >= PAPERS.carroll.units && (await has("pdf", '[data-dg="pdf-canvas"]')), `${await cards()} cards`);
    const marks = await at("pdf", "text", '[data-dg="pdf-units"] .pdf-count');
    check("extract.reader-marks-the-passages", Number(marks) >= 30, `${marks} marks`);
    await sleep(1500);
    await shot("02-after-extract");
  }

  // 2. From the file's own menu, with no reader open.
  await s("s.closeAll()");
  // Asked again for a paper already read, it opens the paper it has and reads nothing twice.
  await s(`s.extractGraph(${q(`${FOLDER}/${PAPERS.dambre.file}`)})`);
  paper = await until(() => paperOf("dambre"));
  check("extract.file-menu-makes-the-paper", paper?.units === PAPERS.dambre.units && paper?.relations === PAPERS.dambre.relations, `${paper?.units} units, ${paper?.relations} links`);
  await until(async () => ((await cards()) ?? 0) >= PAPERS.dambre.units, 15000);
  check("extract.file-menu-opens-the-canvas", (await cards()) >= PAPERS.dambre.units, `${await cards()} cards`);

  // 3. From Upload a paper: a PDF picked from the computer, its saved extraction found by name.
  await s("s.closeAll()");
  if (!(await paperOf("gauthier"))) {
    await s(`s.openDialog("upload")`);
    await until(() => s(`s.dialog.count('[data-dg="upload-drop"]')`));
    const outside = resolve(`../papers/reservoir-computing/${PAPERS.gauthier.file}`);
    const source = existsSync(outside) ? outside : resolve(`${VAULT}/${FOLDER}/${PAPERS.gauthier.file}`);
    await t.host.chooseFile(source, async () => {
      const box = await until(() => s(`s.dialog.locate('[data-dg="upload-drop"]')`));
      await t.clickAt(box.x + box.width / 2, box.y + box.height / 2);
    });
    const found = await until(() => s(`s.dialog.text('[data-dg="upload-saved"]')`), 8000);
    check("extract.upload-finds-the-saved-extraction", /45 units and 70 links/.test(found ?? ""), found);
    check("extract.upload-needs-no-server-then", (await s(`s.dialog.count('[data-dg="upload-server"]')`)) === 0);
    await shot("03-upload-with-saved-extraction");
    const go = await s(`s.dialog.locate('[data-dg="upload-go"]')`);
    await t.clickAt(go.x + go.width / 2, go.y + go.height / 2);
    await until(async () => !(await s("s.dialogOpen()")), 15000);
  }
  paper = await until(() => paperOf("gauthier"));
  check("extract.upload-makes-the-paper", paper?.units === PAPERS.gauthier.units && paper?.relations === PAPERS.gauthier.relations, `${paper?.units} units, ${paper?.relations} links`);
  const copies = (await call("pdf.list")).filter((doc) => doc.name === PAPERS.gauthier.file).length;
  check("extract.upload-keeps-one-copy-of-the-file", copies === 1, `${copies} copies`);
  const all = (await call("paper.list")).filter((item) => Object.values(PAPERS).some(({ file }) => file === item.filename));
  check("extract.three-papers-once-each", all.length === 3, all.map((item) => item.title.slice(0, 24)).join(" | "));
}


const cardSel = (title) => `[data-dg="card-${title}"]`;
/** Fits the whole canvas in view, as a person would to find a card, then clicks it. */
const pick = async (title) => {
  await click("canvas", '[data-dg="fit"]');
  await sleep(900);
  await click("canvas", cardSel(title));
};
const canvasOf = async (name) => (await paperOf(name))?.canvas;
const unitsOf = async (name) => Object.values((await call("canvas.open", { id: await canvasOf(name) })).nodes);

// ---------------------------------------------------------------- Reading: card, context, passage
const EVIDENCE = "For polynomial map reservoir with Lorenz input, the smallest testing error is at the edge of stability.";
if (wants("read")) {
  await s("s.closeAll()");
  await s(`s.open(${q(await canvasOf("carroll"))})`);
  await until(async () => ((await cards()) ?? 0) >= PAPERS.carroll.units);
  check("read.no-holarchy-prompt", !/holarchy/i.test((await at("canvas", "text", '[data-dg="holon-bar"]')) ?? ""), await at("canvas", "text", '[data-dg="holon-bar"]'));
  check("read.every-card-names-its-source", (await at("canvas", "count", '.card .fact[data-field="source"]')) === (await at("canvas", "count", ".card:not(.nested)")));
  await s(`s.openSide("context")`);
  await pick(EVIDENCE);
  await until(async () => (await at("context", "text", '[data-dg="ctx-title"]')) === EVIDENCE);
  const from = await until(() => at("context", "text", '.ctx-head .fact[data-field="authors"]'));
  check("read.says-whose-claim-it-is", /Author\s*T\. L\. Carroll/.test(from ?? ""), from);
  const how = await at("context", "text", '[data-dg="ctx-paper"]');
  check("read.says-how-it-got-here", /from a saved extraction, Carroll-2020-edge-of-chaos\.graph\.json/.test(how ?? ""), (how ?? "").slice(-200));
  const chain = await until(() => at("context", "text", '[data-dg="method-chain"]'));
  check("method.chain-has-run-methods-and-source", /Source/.test(chain ?? "") && /Run/.test(chain ?? "") && /8 methods the run followed/.test(chain ?? ""), (chain ?? "").slice(0, 200));
  const method = await at("context", "text", '[data-dg="method"]');
  check("method.no-false-gap", !/nothing behind it/.test(method ?? "") && !/2026-11-/.test(chain ?? ""), (method ?? "").slice(-160));
  await shot("11-context-evidence");
  // The source at the head of the panel opens the passage, as it does on a selected card.
  await s(`s.ctx.reveal('.ctx-head button[data-dg="fact-source"]')`);
  await click("context", '.ctx-head button[data-dg="fact-source"]');
  await until(() => has("pdf", '[data-dg="pdf-units"]'));
  // The page number shown depends on the reader's width and zoom, so what is checked is the passage itself: marked, and in view.
  const inView = await until(async () => {
    const mark = await at("pdf", "locate", ".pdf-mark[data-active]").catch(() => null);
    return mark && mark.y > 80 && mark.y < 1000 ? mark : null;
  }, 12000);
  check("read.passage-opens-in-view", Boolean(inView), `page ${await at("pdf", "value", '[data-dg="pdf-page"] input')}, mark at ${inView ? Math.round(inView.y) : "none"}`);
  check("read.canvas-stays-beside-the-reader", (await has("canvas", cardSel(EVIDENCE))) && (await has("pdf", ".pdf-mark")));
  await sleep(1500);
  await shot("12-passage-in-pdf");
}

// ---------------------------------------------------------------- Runs a paper reports
if (wants("runs")) {
  await s("s.closeAll()");
  const run = (await unitsOf("carroll")).find((unit) => unit.abbreviation === "RUN");
  const listed = (await call("run.list")).find((item) => item.run.id === run.id);
  check("runs.a-paper-run-is-reported-not-dated", listed?.reported === true && listed.run.paper?.label === "Carroll 2020", q(listed?.run.paper));
  await s(`s.openRuns()`);
  await until(() => has("run", ".run-list"));
  await s(`s.openRuns(${q(run.id)})`);
  const why = await until(() => at("run", "text", '[data-dg="run-reported"]'));
  check("runs.page-names-the-paper", /A paper reports this run/.test(why ?? "") && /Carroll 2020/.test(why ?? ""), (why ?? "").slice(0, 160));
  const howText = await at("run", "text", '[data-dg="run-how"]');
  check("runs.page-lists-its-methods", /methods it followed/.test(howText ?? "") && (await at("run", "count", '[data-dg="run-also-followed"] li')) >= 2, (howText ?? "").slice(0, 120));
  const problems = (await at("run", "text", '[data-dg="run-problems"]')) ?? "";
  check("runs.no-false-warnings", !/no study|nothing says how/.test(problems), problems);
  const page = await call("process.run", { id: run.id });
  const keys = page.claims.map((claim) => `${claim.unit.id}|${claim.stance}`);
  check("runs.each-claim-listed-once", new Set(keys).size === keys.length && keys.length >= 2, `${keys.length} claims`);
  const tabs = await s(`app.workspace.getLeavesOfType(${q("dg-contract-panel")}).filter((leaf) => leaf.view.route?.surface === "run").length`).catch(() => null);
  if (tabs !== null) check("runs.one-tab-for-runs", tabs === 1, `${tabs} run tabs`);
  await shot("26-run-page");
}

// ---------------------------------------------------------------- A canvas across the three papers
const TITLE = "What makes a reservoir compute well?";
const MYQ = "What property of a system predicts how well it computes as a reservoir?";
const MYC = "Performance follows the match between a system's capacity profile and the task, with or without a reservoir.";
const POOR = "For some reservoir computers, computational capacity decreases near the edge of stability because the reservoir computer is a poor match to the problem being solved.";
const FOUND = [
  "universally the optimal operating",
  "poor match to the problem",
  "trade-off between linear memory",
  "same total normalized computational capacity",
  "incapable of computing basis functions of even degree",
  "mathematically equivalent to a linear reservoir",
  "requires even shorter training data sets",
  "total measured capacity CTOT remains close",
];
const overlaps = async () => {
  const drawn = await s("s.drawn()");
  let found = 0;
  for (let i = 0; i < drawn.cards.length; i += 1) {
    for (let j = i + 1; j < drawn.cards.length; j += 1) {
      const [a, b] = [drawn.cards[i], drawn.cards[j]];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) found += 1;
    }
  }
  return found;
};
if (wants("argue")) {
  await s("s.closeAll()");
  const canvas = (await call("canvas.list")).find((item) => item.title === TITLE) ?? (await call("canvas.create", { title: TITLE }));
  await s(`s.open(${q(canvas.id)})`);
  await until(() => has("canvas", '[data-dg="add-node"]'));
  const addNode = async (title, kind) => {
    if (await has("canvas", cardSel(title))) return true;
    await click("canvas", '[data-dg="add-node"]');
    await click("canvas", '[data-dg="node-search"]');
    await type(title);
    await sleep(500);
    await click("canvas", `[data-dg="create-${kind}"]`);
    return until(() => has("canvas", cardSel(title)), 6000);
  };
  check("argue.own-question", await addNode(MYQ, "Question"));
  check("argue.own-claim", await addNode(MYC, "Claim"));

  // Search across the papers, and put what's found on this canvas.
  await s("s.openSearch()");
  await until(() => s(`s.search.count('[data-dg="search-input"]')`));
  let tagged = null;
  const putFromSearch = async (text) => {
    const clear = await s(`s.search.locate('[data-dg="search-clear"]')`);
    if (clear) await t.clickAt(clear.x + clear.width / 2, clear.y + clear.height / 2);
    const box = await s(`s.search.locate('[data-dg="search-input"]')`);
    await t.clickAt(box.x + 40, box.y + box.height / 2);
    await sleep(250);
    await type(text);
    // The list settles on the new words before anything in it is clicked.
    await until(async () => (await s(`s.search.count('[data-dg="search-results"] li')`)) === 1, 6000);
    await sleep(500);
    const hit = await s(`s.search.locate('[data-dg="search-results"] li')`);
    if (!hit) return false;
    tagged ??= await s(`s.search.text('[data-dg="search-results"] li .from-paper')`);
    await t.clickAt(hit.x + 80, hit.y + 16);
    const put = await until(() => s(`s.search.locate('[data-dg="search-put"]')`), 4000);
    if (!put) return false;
    await t.clickAt(put.x + put.width / 2, put.y + put.height / 2);
    return Boolean(await until(() => s(`s.search.text('[data-dg="search-notice"]')`), 4000));
  };
  const before = (await cards()) ?? 0;
  let placed = 0;
  if (before < 10) for (const text of FOUND) placed += (await putFromSearch(text)) ? 1 : 0;
  await until(async () => ((await cards()) ?? 0) >= 10, 8000);
  check("argue.units-arrive-from-search", (await cards()) === 10, `${await cards()} cards, ${placed} placed now`);
  if (tagged !== null) check("search.hits-name-their-paper", /Carroll 2020|Dambre et al\. 2012|Gauthier et al\. 2021/.test(tagged ?? ""), tagged);
  await sleep(1200);
  check("argue.nothing-lands-on-another-card", (await overlaps()) === 0, `${await overlaps()} overlaps`);
  const tags = await at("canvas", "count", '.card .fact[data-field="source"]');
  check("argue.cards-name-their-paper", tags === 8, `${tags} tagged of 10`);
  await shot("17-units-from-three-papers");

  // Relate through the Context panel: the link has to show on the canvas it was made beside.
  await s(`s.openSide("context")`);
  await pick(MYC);
  await until(async () => (await at("context", "text", '[data-dg="ctx-title"]')) === MYC);
  const edgesBefore = (await at("canvas", "count", ".react-flow__edge")) ?? 0;
  if (!(await has("context", `[data-dg="row-${POOR}"]`))) {
    await click("context", '[data-dg="ctx-relate"]');
    await click("context", '[data-dg="relate-search"]');
    await type("poor match to the problem");
    const result = await until(() => at("context", "locate", `[data-dg="relate-result-${POOR}"]`));
    check("relate.results-name-their-paper", /Carroll 2020/.test((await at("context", "text", `[data-dg="relate-result-${POOR}"]`)) ?? ""));
    await t.clickAt(result.x + 60, result.y + result.height / 2);
    await click("context", '[data-dg="relate-Supported by"]');
    await until(() => has("context", `[data-dg="row-${POOR}"]`));
    check("relate.link-is-drawn-on-the-canvas", await until(async () => ((await at("canvas", "count", ".react-flow__edge")) ?? 0) === edgesBefore + 1, 6000), `${edgesBefore} -> ${await at("canvas", "count", ".react-flow__edge")}`);
  }

  // Elsewhere: asked for, it finds units in the other papers that read close to this claim.
  const view = await call("canvas.open", { id: canvas.id });
  const find = (start) => Object.values(view.nodes).find((unit) => unit.title.startsWith(start));
  const [mine, question, edge, trade, same, even, equivalent, shorter, total] = ["Performance follows", "What property", "The edge of stability is not", "There is a fundamental trade-off", "All dynamical systems", "The echo-state network", "The NG-RC is mathematically", "The NG-RC requires", "For the logistic map"].map(find);
  await call("focus.set", { node: edge.id });
  await until(async () => (await at("context", "text", '[data-dg="ctx-title"]'))?.startsWith("The edge of stability is not"));
  check("elsewhere.waits-to-be-asked", (await has("context", '[data-dg="ctx-similar-find"]')) && (await at("context", "count", '[data-dg^="similar-"]')) === 0);
  await s(`s.ctx.reveal('[data-dg="ctx-similar-find"]')`).catch(() => null);
  await sleep(500);
  await click("context", '[data-dg="ctx-similar-find"]');
  const elsewhere = await until(() => at("context", "text", '[data-dg="ctx-similar"] .rows'));
  const similar = await call("node.similar", { id: edge.id });
  check("elsewhere.finds-other-papers", similar.length >= 1 && similar.every((item) => item.node.paper?.label !== "Carroll 2020"), similar.map((item) => `${item.node.paper?.label ?? "own"}: ${item.node.title.slice(0, 40)} [${item.shared.join(" ")}]`).join(" | "));
  check("elsewhere.shows-what-they-share", /Shares:/.test(elsewhere ?? ""), (elsewhere ?? "").slice(0, 160));
  await shot("27-elsewhere");

  // The rest of the argument, stated the way the panel states it.
  const relate = async (a, b, label) => {
    const option = (await call("relation.options", { source: a.id, target: b.id })).find((item) => item.label === label);
    if (!option) return `${label} not offered`;
    await call("relation.assert", { type: option.type, source: option.flipped ? b.id : a.id, target: option.flipped ? a.id : b.id, draw: true });
    return "ok";
  };
  const made = [
    await relate(mine, question, "Addresses"), await relate(edge, question, "Addresses"),
    await relate(trade, mine, "Supports"), await relate(same, mine, "Supports"), await relate(even, mine, "Supports"), await relate(equivalent, mine, "Supports"),
    await relate(total, edge, "Supports"), await relate(shorter, mine, "Opposes"),
  ];
  check("argue.relations-across-papers", made.every((item) => item === "ok"), made.join(", "));
  await until(async () => ((await at("canvas", "count", ".react-flow__edge")) ?? 0) >= 9, 8000);
  check("argue.every-link-is-drawn", (await at("canvas", "count", ".react-flow__edge")) === 9, `${await at("canvas", "count", ".react-flow__edge")} edges`);
  await click("canvas", '[data-dg="tidy"]');
  await sleep(2200);
  await shot("21-argument");

  // What my claim rests on, across papers.
  await call("focus.set", { node: mine.id });
  const rests = await until(() => at("context", "text", '[data-dg="method-rests"]'));
  check("rests.counts-through-claims", /Rests on 5 claims/.test(rests ?? "") && /1 unit opposes it/.test(rests ?? ""), rests);
  check("rests.names-the-papers", /Carroll 2020/.test(rests ?? "") && /Dambre et al\. 2012/.test(rests ?? "") && /Gauthier et al\. 2021/.test(rests ?? ""), rests);
  await shot("22-what-it-rests-on");

  // A column for each paper.
  await click("canvas", '[data-dg="tidy-menu"]');
  await click("canvas", '[data-dg="tidy-sources"]');
  await sleep(2200);
  const status = await at("canvas", "text", '[data-dg="status-text"]');
  const columns = (await at("canvas", "text", ".react-flow__viewport")) ?? "";
  check("papers.arranges-by-paper", /Papers/.test(status ?? "") && /Written here/.test(columns) && /Dambre et al\. 2012/.test(columns), status);
  await shot("28-by-paper");
  await click("canvas", '[data-dg="tidy-menu"]');
  await click("canvas", '[data-dg="tidy-logic"]');
  await sleep(1500);

  // A paper tag opens its passage.
  await click("canvas", '[data-dg="fit"]');
  await sleep(900);
  // The first click picks the card up; its source link acts once it is selected.
  await click("canvas", `[data-dg="title-${POOR}"]`);
  await sleep(400);
  await click("canvas", `button[data-dg="fact-source-${POOR}"]`);
  check("tag.opens-the-passage", await until(() => has("pdf", ".pdf-mark"), 15000));
}

// ---------------------------------------------------------------- The Library
if (wants("library")) {
  await s("s.closeAll()");
  await s("s.openLibrary()");
  await until(() => has("canvases", ".repo-list > li"));
  const text = (await at("canvases", "text", ".repo-list")) ?? "";
  check("library.papers-are-from-a-pdf", (text.match(/From a PDF/g) ?? []).length >= 3 && /What makes a reservoir compute well\?\s*Workspace/.test(text), text.slice(0, 160));
  await shot("24-library");
}

process.exitCode = (await t.finish("report")) ? 1 : 0;
