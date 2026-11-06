// The paper flows, in both real apps, against the reference server:
// upload, compute choices, paper canvases, export, provenance, link colours,
// then two people in one lab sharing a paper, reacting, and leaving breadcrumbs.
//   npm run server   (in another terminal)
//   node harness/papers-test.mjs [all|solo|lab|colours]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam, sleep } from "./hosts.mjs";

const OUT = resolve("reports/papers");
mkdirSync(OUT, { recursive: true });
const SERVICE = "http://localhost:8788";
const PAPERS = resolve("demo/papers");
const NEPHRITIS = "lupus-nephritis-prediction";
const MEDIATORS = "preclinical-sle-mediators";
const graphOf = (name) => JSON.parse(readFileSync(`${PAPERS}/${name}.graph.json`, "utf8"));
const q = JSON.stringify;
const part = process.argv[2] ?? "all";

const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 240) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail !== "" ? ` - ${String(detail).slice(0, 200)}` : ""}`);
};
const until = async (work, timeout = 9000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work();
    if (value || Date.now() > deadline) return value;
    await sleep(250);
  }
};

const driver = (host, person) => {
  const s = host.slice;
  const mouse = (type, x, y, buttons = 0, modifiers = 0) =>
    host.input("Input.dispatchMouseEvent", { type, x, y, buttons, modifiers, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  const clickAt = async (x, y, modifiers = 0) => {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y, 1, modifiers);
    await mouse("mouseReleased", x, y, 0, modifiers);
  };
  const box = (frame, selector) => until(async () => {
    const found = await s(`${frame}.locate(${q(selector)})`);
    return found?.width > 0 ? found : null;
  }, 7000);
  const click = async (frame, selector, modifiers = 0) => {
    const found = await box(frame, selector);
    if (!found) throw new Error(`${host.name}: couldn't find ${selector} in ${frame}`);
    await clickAt(found.x + found.width / 2, found.y + found.height / 2, modifiers);
  };
  const hover = async (frame, selector) => {
    const found = await box(frame, selector);
    if (found) await mouse("mouseMoved", found.x + found.width / 2, found.y + found.height / 2);
  };
  const type = async (frame, selector, text) => {
    await click(frame, selector);
    await sleep(120);
    await host.input("Input.insertText", { text });
  };
  const pressEnter = async () => {
    await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  };
  const hostClick = async (selector) => {
    const found = await until(() => s(`(() => { const r = document.querySelector(${q(selector)})?.getBoundingClientRect(); return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`), 6000);
    if (!found) throw new Error(`${host.name}: couldn't find ${selector}`);
    await clickAt(found.x, found.y);
  };
  const dialogOpen = () => s(`document.querySelector('[data-dg="dialog"]') !== null`);
  const titleOfNode = (view, label) => Object.values(view.nodes).find(({ typeLabel }) => typeLabel === label);
  return { host, person, name: host.name, s, click, hover, type, pressEnter, hostClick, clickAt, dialogOpen, titleOfNode };
};

const openUpload = async (side) => {
  await side.s(`s.openDialog("upload")`);
  await until(() => side.s(`s.dialog.count('[data-dg="upload-model"] option')`), 8000);
};

const pickFile = async (side, path) => {
  const seen = await side.host.chooseFile(path, () => side.click("s.dialog", '[data-dg="upload-drop"]'));
  await until(() => side.s(`s.dialog.count('[data-dg="upload-file"]')`), 5000);
  return seen;
};

const uploaded = async (side, before, timeout = 25000) => {
  await side.click("s.dialog", '[data-dg="upload-go"]');
  await until(async () => !(await side.dialogOpen()), timeout);
  return until(async () => {
    const papers = await side.s(`s.call("paper.list", {})`);
    return papers.length > before ? papers : null;
  }, 5000);
};

const countCards = (side) => side.s(`s.count('[data-dg^="card-"]')`);

const overlaps = ({ cards }) => {
  let found = 0;
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const [a, b] = [cards[i], cards[j]];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) found += 1;
    }
  }
  return found;
};

const paletteOf = async (side, id) => {
  const view = await side.s(`s.call("canvas.open", { id: ${q(id)} })`);
  const relationOf = Object.fromEntries(view.items.map(({ id: item, item: drawn }) => [item, drawn.dg?.relation]));
  const drawn = await side.s(`s.drawn()`);
  const kinds = {};
  for (const { id: edge, stroke } of drawn.links) {
    const kind = view.relations[relationOf[edge]]?.kind;
    if (kind) (kinds[kind] ??= new Set()).add(stroke);
  }
  return Object.fromEntries(Object.entries(kinds).sort().map(([kind, strokes]) => [kind, [...strokes].sort().join("|")]));
};

// One colour for each kind of link, in every arrangement.
const colours = async (side, id, units) => {
  const { s, name, click } = side;
  await s(`s.open(${q(id)})`);
  await until(async () => (await countCards(side)) >= units, 8000);
  await sleep(800);
  const palettes = {};
  for (const mode of ["logic", "debate", "timeline", "kinds", "people", "focus", "connected", "bridges", "load"]) {
    await click("s", '[data-dg="tidy-menu"]');
    await click("s", `[data-dg="tidy-${mode}"]`);
    await sleep(900);
    palettes[mode] = await paletteOf(side, id);
  }
  const seen = new Set(Object.values(palettes).map((palette) => q(palette)));
  const kinds = Object.keys(palettes.logic);
  check(`${name}.links.colours-were-read`, kinds.length >= 3, kinds.join(", "));
  check(`${name}.links.same-colours-in-every-mode`, seen.size === 1, `${seen.size} palettes`);
  check(`${name}.links.one-colour-per-kind`, Object.values(palettes.logic).every((stroke) => !stroke.includes("|")), q(palettes.logic));
  check(`${name}.links.each-kind-its-own-colour`, new Set(Object.values(palettes.logic)).size === kinds.length);
  side.palette = palettes.logic;
  side.theme = await s("s.frameTheme()");
};

const solo = async (side) => {
  const { s, name, click, type } = side;
  await s("s.test(true)");
  await s("s.closeAll()");
  await sleep(600);
  for (const key of ["lab-link", "compute-servers", "welcome-shown", "breadcrumb-default"]) await s(`s.setLocal(${q(key)}, null)`);
  await s(`s.core().then((core) => core.setName(${q(side.person)}))`);
  const papersBefore = (await s(`s.call("paper.list", {})`)).length;

  // The pop-up: where it runs, what reads it, which schema.
  await openUpload(side);
  check(`${name}.upload.opens-as-a-frame`, await s(`document.querySelector('[data-dg="dialog"] iframe')?.getAttribute("sandbox") === "allow-scripts"`));
  check(`${name}.upload.lists-servers`, (await s(`s.dialog.count('[data-dg="upload-server"] option')`)) === 2);
  check(`${name}.upload.lists-models`, (await s(`s.dialog.count('[data-dg="upload-model"] option')`)) >= 2, await s(`s.dialog.text('[data-dg="upload-model"]')`));
  check(`${name}.upload.lists-schemas`, (await s(`s.dialog.count('[data-dg="upload-schema"] option')`)) === 2);
  check(`${name}.upload.needs-a-file`, await s(`s.dialog.locate('[data-dg="upload-go"]').then(Boolean)`));
  await host_shot(side, "upload");

  // Adding a place to compute, from inside the pop-up.
  await click("s.dialog", '[data-dg="upload-add-server"]');
  await until(() => s(`s.dialog.count('[data-dg="add-server"]')`));
  await click("s.dialog", '[data-dg="server-url"]');
  await side.host.input("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 4, windowsVirtualKeyCode: 65, commands: ["selectAll"] });
  await side.host.input("Input.insertText", { text: "http://127.0.0.1:8787" });
  await sleep(200);
  await click("s.dialog", '[data-dg="server-test"]');
  const connected = await until(() => s(`s.dialog.text('[data-dg="server-result"]')`), 5000);
  check(`${name}.add-server.tests-the-address`, /Connected/.test(connected ?? ""), connected);
  await type("s.dialog", '[data-dg="server-name"]', " box");
  await host_shot(side, "add-server");
  await click("s.dialog", '[data-dg="server-save"]');
  await until(async () => (await s(`s.dialog.count('[data-dg="upload-server"] option')`)) === 3, 5000);
  check(`${name}.add-server.joins-the-list`, (await s(`s.dialog.value('[data-dg="upload-server"]')`)) === "http://127.0.0.1:8787");
  check(`${name}.add-server.has-its-models`, await until(() => s(`s.dialog.count('[data-dg="upload-model"] option')`), 4000));

  // A real file through the real chooser, inside a sandboxed frame.
  const chooser = await pickFile(side, `${PAPERS}/${NEPHRITIS}.pdf`);
  check(`${name}.file.chooser-opens-from-the-frame`, Boolean(chooser?.backendNodeId), q(chooser));
  check(`${name}.file.is-read`, /lupus-nephritis-prediction\.pdf/.test((await s(`s.dialog.text('[data-dg="upload-file"]')`)) ?? ""), await s(`s.dialog.text('[data-dg="upload-file"]')`));
  let papers = await uploaded(side, papersBefore);
  check(`${name}.extract.makes-a-paper`, papers?.length === papersBefore + 1, q(papers?.map(({ title, units }) => [title.slice(0, 30), units])));
  const paper = papers?.find(({ title }) => title.startsWith("Predicting eventual"));
  const expected = graphOf(NEPHRITIS);
  check(`${name}.extract.keeps-every-unit`, paper?.units === expected.nodes.length && paper?.relations === expected.edges.length, `${paper?.units} units, ${paper?.relations} relations`);
  await until(async () => (await countCards(side)) >= expected.nodes.length, 9000);
  check(`${name}.canvas.opens-the-paper`, (await countCards(side)) === expected.nodes.length, await countCards(side));
  await sleep(1500);
  const drawn = await s("s.drawn()");
  check(`${name}.canvas.lays-itself-out`, overlaps(drawn) === 0, `${overlaps(drawn)} overlaps, ${drawn.cards.length} cards, zoom ${drawn.zoom}`);
  await host_shot(side, "paper-canvas");

  const stored = await (await fetch(`${SERVICE}/v1/graphs?doi=${encodeURIComponent(paper.doi)}`)).json();
  check(`${name}.backend.keeps-the-graph`, stored.graphs?.length >= 1 && paper.stored === true, q(stored).slice(0, 120));
  const raw = q(stored);
  check(`${name}.backend.keeps-no-file`, !/dataBase64|fileBase64|%PDF/.test(raw));

  // No DOI, so nothing leaves.
  const before = (await (await fetch(`${SERVICE}/v1/graphs`)).json()).graphs?.length ?? 0;
  const note = resolve(OUT, "no-doi-note.md");
  writeFileSync(note, "# A note with no DOI\n\nDoes tension scale with actin? We found tension rose with actin in every cell. This suggests actin sets the load.\n");
  await openUpload(side);
  await s(`s.dialog.choose('[data-dg="upload-model"]', "sentence-split")`);
  await pickFile(side, note);
  const count = (await s(`s.call("paper.list", {})`)).length;
  papers = await uploaded(side, count);
  const noDoi = papers?.find(({ doi, title }) => !doi && /no DOI/i.test(title));
  check(`${name}.no-doi.still-gets-a-canvas`, Boolean(noDoi), q(papers?.map(({ title }) => title.slice(0, 30))));
  check(`${name}.no-doi.stays-off-the-server`, ((await (await fetch(`${SERVICE}/v1/graphs`)).json()).graphs?.length ?? 0) === before && noDoi?.stored !== true);

  // Demo papers load from the Library, once.
  await s("s.closeAll()");
  await sleep(500);
  await s("s.openCanvases()");
  await sleep(900); // the sidebar slides open, and a click mid-slide lands somewhere else
  await click("s.list", '[data-dg="library-papers"]');
  const hadDemo = (await s(`s.call("paper.list", {})`)).some(({ title }) => title.startsWith("Dysregulation"));
  await click("s.list", '[data-dg="library-demo"]');
  const withDemo = await until(async () => {
    const list = await s(`s.call("paper.list", {})`);
    return list.some(({ title }) => title.startsWith("Dysregulation")) ? list : null;
  }, 12000);
  check(`${name}.demo.adds-the-missing-paper`, withDemo?.length === papers.length + (hadDemo ? 0 : 1), q(withDemo?.map(({ title }) => title.slice(0, 26))));
  await click("s.list", '[data-dg="library-demo"]');
  await sleep(1500);
  check(`${name}.demo.only-once`, (await s(`s.call("paper.list", {})`)).length === withDemo?.length);
  await host_shot(side, "library-papers");

  // Export a few cards to a new folder.
  await s(`s.open(${q(paper.canvas)})`);
  await until(async () => (await countCards(side)) >= expected.nodes.length, 8000);
  await sleep(1000);
  // Every card in view, so no click lands on a panel beside the canvas.
  await click("s", '[data-dg="fit"]');
  await sleep(600);
  const view = await s(`s.call("canvas.open", { id: ${q(paper.canvas)} })`);
  const claims = Object.values(view.nodes).filter(({ typeLabel }) => typeLabel === "Claim").slice(0, 2);
  await click("s", `[data-dg="card-${claims[0].title}"]`);
  await side.host.input("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, modifiers: 8 });
  await click("s", `[data-dg="card-${claims[1].title}"]`, 8);
  await side.host.input("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
  await sleep(300);
  await click("s", '[data-dg="export"]');
  await until(() => s(`s.count('[data-dg="export-menu"]')`));
  check(`${name}.export.defaults-to-the-picked`, (await s(`s.text('[data-dg="export-menu"]')`))?.includes("Selected cards (2)"), await s(`s.text('[data-dg="export-menu"]')`));
  await s(`s.choose('[data-dg="export-target"]', "new-folder")`);
  await type("s", '[data-dg="export-folder-name"]', "Prognosis");
  await host_shot(side, "export");
  await click("s", '[data-dg="export-go"]');
  const folders = await until(async () => {
    const list = await s(`s.call("folder.list", {})`);
    return list.length ? list : null;
  }, 5000);
  check(`${name}.export.fills-a-folder`, folders?.[0]?.units === 2, q(folders));
  const found = await until(async () => {
    const hits = await s(`s.searchBase(${q(claims[0].title.slice(0, 40))})`);
    return hits.length ? hits : null;
  }, 5000);
  check(`${name}.export.makes-real-text`, found?.length >= 1, q(found));
  check(`${name}.export.lands-in-the-base's-folder`, name === "obsidian" ? found?.some((path) => path.startsWith("Discourse Units/Prognosis/")) : (await s(`s.searchBase("Folder/Prognosis")`)).length === 1, q(found));
  const unstaged = await s(`s.call("canvas.open", { id: ${q(paper.canvas)} })`);
  check(`${name}.export.others-stay-on-the-canvas-only`, Object.values(unstaged.nodes).filter(({ hasText }) => hasText).length === 2);

  // Opening a unit says where it came from and where it lives.
  await s(`s.call("panel.open", { surface: "context" })`);
  await sleep(900);
  await until(() => s(`s.ctx.count('[data-dg="ctx-provenance"]')`), 6000);
  const provenance = (await s(`s.ctx.text('[data-dg="ctx-provenance"]')`)) ?? "";
  check(`${name}.provenance.names-the-paper`, provenance.includes("Predicting eventual"), provenance.slice(0, 200));
  check(`${name}.provenance.gives-the-doi`, provenance.includes(paper.doi));
  check(`${name}.provenance.gives-the-model`, provenance.includes("nemotron"));
  const lives = (await s(`s.ctx.text('[data-dg="ctx-lives"]')`)) ?? "";
  check(`${name}.provenance.says-where-it-lives`, lives.includes("Prognosis") && lives.includes("Predicting eventual"), lives.slice(0, 200));
  await host_shot(side, "provenance");

  // The whole paper, to the workspace.
  await click("s", '[data-dg="export"]');
  await until(() => s(`s.count('[data-dg="export-menu"]')`));
  await click("s", '[data-dg="export-all"]');
  const exportStarted = Date.now();
  await click("s", '[data-dg="export-go"]');
  const workspace = await until(async () => {
    const list = await s(`s.call("canvas.list", {})`);
    return list.find(({ personal }) => personal) ?? null;
  }, 60000);
  side.exportMs = Date.now() - exportStarted;
  check(`${name}.export.reaches-the-workspace`, Boolean(workspace), `${workspace?.title} in ${side.exportMs} ms`);
  if (workspace) {
    const held = await s(`s.call("canvas.open", { id: ${q(workspace.id)} })`);
    check(`${name}.export.whole-paper-arrives`, Object.keys(held.nodes).length === expected.nodes.length, Object.keys(held.nodes).length);
    check(`${name}.export.links-come-along`, Object.keys(held.relations).length === expected.edges.length, Object.keys(held.relations).length);
  }

  await colours(side, paper.canvas, expected.nodes.length);
};

const host_shot = async (side, label) => {
  await side.host.shot(`${OUT}/${side.name}-${label}.png`);
};

const lab = async (ana, ben) => {
  const stamp = Date.now() % 100000;
  const labName = `Tension Lab ${stamp}`;
  for (const side of [ana, ben]) {
    await side.s("s.test(true)");
    await side.s("s.closeAll()");
    for (const key of ["lab-link", "welcome-shown", "breadcrumb-default"]) await side.s(`s.setLocal(${q(key)}, null)`);
    await side.s(`s.core().then((core) => core.setName(${q(side.person)}))`);
  }
  await sleep(600);

  // First boot, in each app.
  await ana.s("s.firstRun()");
  await until(() => ana.s(`s.dialog.count('[data-dg="lab-text"]')`), 8000);
  check("lab.first-run.offers-the-question", (await ana.s(`document.querySelector('[data-dg="dialog"]')?.dataset.surface`)) === "welcome");
  await host_shot(ana, "welcome");
  await ana.click("s.dialog", '[data-dg="lab-mode-start"]');
  await ana.type("s.dialog", '[data-dg="lab-text"]', labName);
  await ana.click("s.dialog", '[data-dg="lab-go"]');
  await until(() => ana.s(`s.dialog.count('[data-dg="welcome-joined"]')`), 8000);
  check("lab.start.makes-a-pi", (await ana.s(`s.call("lab.view", {})`)).link?.role === "admin");
  await ana.click("s.dialog", '[data-dg="welcome-done"]');
  const id = (await ana.s(`s.call("lab.view", {})`)).link.id;

  await ben.s("s.firstRun()");
  await until(() => ben.s(`s.dialog.count('[data-dg="lab-text"]')`), 8000);
  await ben.type("s.dialog", '[data-dg="lab-text"]', id);
  await ben.click("s.dialog", '[data-dg="lab-go"]');
  await until(() => ben.s(`s.dialog.count('[data-dg="welcome-pending"]')`), 8000);
  check("lab.join.waits-for-the-pi", (await ben.s(`s.dialog.text('[data-dg="welcome-pending"]')`))?.includes(labName));
  const before = await ben.s(`s.call("ai.status", {})`);
  check("lab.join.no-ai-until-accepted", before.ready === false, before.why);
  await host_shot(ben, "pending");

  // The PI accepts from the Library.
  await ana.s("s.openCanvases()");
  await sleep(900);
  await ana.click("s.list", '[data-dg="library-lab"]');
  await until(() => ana.s(`s.list.count('[data-dg="accept-${ben.person}"]')`), 12000);
  await host_shot(ana, "lab-request");
  await ana.click("s.list", `[data-dg="accept-${ben.person}"]`);
  await until(() => ben.s(`s.dialog.count('[data-dg="welcome-joined"]')`), 9000);
  check("lab.join.acceptance-reaches-them", await ben.s(`s.dialog.count('[data-dg="welcome-joined"]')`));
  const after = await ben.s(`s.call("ai.status", {})`);
  check("lab.join.token-brings-ai", after.ready === true, q(after));
  await ben.click("s.dialog", '[data-dg="welcome-done"]');
  check("lab.members.both-listed", (await ana.s(`s.call("lab.view", {})`)).members.length === 2);

  // A paper goes to the lab, file and all.
  const mediators = graphOf(MEDIATORS);
  await openUpload(ana);
  check("share.offered-to-members", await ana.s(`s.dialog.count('[data-dg="upload-share"]')`));
  await pickFile(ana, `${PAPERS}/${MEDIATORS}.pdf`);
  await host_shot(ana, "upload-to-lab");
  const count = (await ana.s(`s.call("paper.list", {})`)).length;
  // Already loaded as a demo? Then it's the same paper, and sharing is the point.
  await ana.click("s.dialog", '[data-dg="upload-go"]');
  await until(async () => !(await ana.dialogOpen()), 25000);
  const inRepo = await until(async () => {
    const view = await ana.s(`s.call("lab.view", {})`);
    return view.papers.find(({ title }) => title.startsWith("Dysregulation")) ?? null;
  }, 8000);
  check("share.reaches-the-repository", Boolean(inRepo), q(inRepo)?.slice(0, 200));
  check("share.says-who-uploaded", inRepo?.uploadedBy.name === ana.person && inRepo?.extractedBy.name === ana.person);
  check("share.carries-the-file", inRepo?.hasFile === true);
  check("share.count-is-stable", (await ana.s(`s.call("paper.list", {})`)).length >= count);

  // It arrives at the other person's app, and the canvas with it.
  await ana.s("s.syncNow()");
  await ben.s("s.syncNow()");
  const arrived = await until(async () => {
    await ben.s("s.syncNow()");
    const list = await ben.s(`s.call("canvas.list", {})`);
    return list.find(({ id: canvas }) => canvas === inRepo?.canvas) ?? null;
  }, 25000);
  check("sync.brings-the-shared-canvas", Boolean(arrived), arrived?.title);
  await ben.s("s.openCanvases()");
  await sleep(900);
  await ben.click("s.list", '[data-dg="library-lab"]');
  await until(() => ben.s(`s.list.count('[data-dg^="lab-paper-"]')`), 8000);
  const line = await ben.s(`s.list.text('[data-dg="lab-papers"]')`);
  check("repository.shows-who-uploaded", line?.includes(`Uploaded by ${ana.person}`), line);
  await host_shot(ben, "lab-repository");
  if (ben.name === "roam") await ben.host.input("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });
  await ben.s(`s.list.reveal(${q(`[data-dg="lab-file-${inRepo.title}"]`)})`);
  await sleep(200);
  await ben.click("s.list", `[data-dg="lab-file-${inRepo.title}"]`);
  check("repository.gives-the-file", /downloads/.test((await until(() => ben.s(`s.list.text('[data-dg="lab-file-saved"]')`), 6000)) ?? ""), await ben.s(`s.list.text('[data-dg="lab-file-saved"]')`));
  await ben.click("s.list", `[data-dg="lab-paper-${inRepo.title}"]`);
  await until(async () => (await countCards(ben)) >= mediators.nodes.length, 12000);
  check("sync.every-unit-arrives", (await countCards(ben)) === mediators.nodes.length, await countCards(ben));
  await sleep(1200);
  await ben.click("s", '[data-dg="fit"]');
  await sleep(600);

  // Reactions and notes, compact on the card.
  const view = await ben.s(`s.call("canvas.open", { id: ${q(inRepo.canvas)} })`);
  const unit = Object.values(view.nodes).find(({ typeLabel }) => typeLabel === "Claim");
  await ben.hover("s", `[data-dg="card-${unit.title}"]`);
  await sleep(250);
  await ben.click("s", `[data-dg="react-disagree-${unit.title}"]`);
  const mine = await until(async () => (await ben.s(`s.call("canvas.open", { id: ${q(inRepo.canvas)} })`)).social?.[unit.id]?.mine, 5000);
  check("reaction.is-recorded", mine === "disagree", mine);
  await ben.click("s", `[data-dg="card-${unit.title}"]`);
  await ben.s(`s.call("panel.open", { surface: "context" })`);
  await sleep(900);
  await until(() => ben.s(`s.ctx.count('[data-dg="ctx-social"]')`), 6000);
  await ben.s(`s.ctx.reveal('[data-dg="ctx-note"]')`);
  await sleep(200);
  await ben.type("s.ctx", '[data-dg="ctx-note"]', "The cut-off looks tuned to this cohort");
  await ben.pressEnter();
  await until(() => ben.s(`s.ctx.count('[data-dg="ctx-notes"] li')`), 5000);
  check("note.stays-apart-from-the-unit", (await ben.s(`s.ctx.text('[data-dg="ctx-notes"]')`))?.includes("cut-off"));
  await host_shot(ben, "reaction");
  await ben.s("s.syncNow()");
  await ana.s(`s.open(${q(inRepo.canvas)})`);
  await until(async () => (await countCards(ana)) >= mediators.nodes.length, 9000);
  await sleep(800);
  await ana.click("s", '[data-dg="fit"]');
  const seen = await until(async () => {
    await ana.s("s.syncNow()");
    return (await ana.s(`s.text('[data-dg="react-disagree-${unit.title}"]')`))?.includes("1") ? true : null;
  }, 15000);
  check("reaction.reaches-the-lab", Boolean(seen), await ana.s(`s.text('[data-dg="react-disagree-${unit.title}"]')`));
  check("note.shows-on-the-card", (await until(() => ana.s(`s.count('[data-dg="notes-${unit.title}"]')`), 4000)) === 1);
  await host_shot(ana, "reactions-on-card");
  const opened = await ana.s(`s.call("node.view", { id: ${q(unit.id)} })`);
  check("reaction.names-who", opened.social?.who.disagree?.[0] === ben.person || opened.social?.who.disagree?.[0]?.name === ben.person, q(opened.social?.who));

  // Leaving a breadcrumb is a choice made on closing.
  await ben.s("s.leaveCanvas()");
  const asked = await until(() => ben.s(`s.hostCount('[data-dg="breadcrumb"]')`), 6000);
  check("breadcrumb.asks-on-closing", asked === 1);
  await host_shot(ben, "breadcrumb");
  check("breadcrumb.nothing-before-the-answer", (await ana.s(`s.call("lab.view", {})`)).papers.find(({ id: paperId }) => paperId === inRepo.id)?.breadcrumbs.length === 0);
  await ben.hostClick('[data-dg="breadcrumb-remember"]');
  await ben.hostClick('[data-dg="breadcrumb-leave"]');
  const crumb = await until(async () => {
    const paper = (await ana.s(`s.call("lab.view", {})`)).papers.find(({ id: paperId }) => paperId === inRepo.id);
    return paper?.breadcrumbs.length ? paper.breadcrumbs : null;
  }, 8000);
  check("breadcrumb.reaches-the-repository", crumb?.[0]?.name === ben.person, q(crumb));
  check("breadcrumb.remembers-the-default", (await ben.s(`s.call("lab.view", {})`)).breadcrumbs === "always");
  await ben.s(`s.open(${q(inRepo.canvas)})`);
  await sleep(1500);
  await ben.s("s.leaveCanvas()");
  await sleep(800);
  check("breadcrumb.default-stops-asking", (await ben.s(`s.hostCount('[data-dg="breadcrumb"]')`)) === 0);

  // A paper already in the Library can go to the lab too, and the other base asks as well.
  await ben.s(`s.call("paper.loadDemo", {})`);
  await ben.s("s.openCanvases()");
  await sleep(900);
  await ben.click("s.list", '[data-dg="library-papers"]');
  await sleep(600);
  const shareable = (await ben.s(`s.call("paper.list", {})`)).find(({ labPaper, title }) => !labPaper && title.startsWith("Predicting"));
  await ben.s(`s.list.reveal(${q(`[data-dg="paper-share-${shareable.title}"]`)})`);
  await sleep(200);
  await ben.click("s.list", `[data-dg="paper-share-${shareable.title}"]`);
  const second = await until(async () => {
    await ben.s("s.syncNow()");
    await ana.s("s.syncNow()");
    const list = await ana.s(`s.call("canvas.list", {})`);
    return list.find(({ id: canvas }) => canvas === shareable.canvas) ?? null;
  }, 25000);
  check("share.later-from-the-library", Boolean(second), second?.title);
  await ana.s(`s.open(${q(shareable.canvas)})`);
  await sleep(1500);
  await ana.s("s.leaveCanvas()");
  check("breadcrumb.asks-in-the-other-base", (await until(() => ana.s(`s.hostCount('[data-dg="breadcrumb"]')`), 5000)) === 1);
  await ana.hostClick('[data-dg="breadcrumb-skip"]');
  await sleep(600);
  const skipped = (await ana.s(`s.call("lab.view", {})`)).papers.find(({ id: paperId }) => paperId === shareable.id);
  check("breadcrumb.skipping-leaves-nothing", skipped?.breadcrumbs.length === 0, q(skipped?.breadcrumbs));
  await ana.s(`s.open(${q(inRepo.canvas)})`);
  await until(async () => (await countCards(ana)) >= mediators.nodes.length, 9000);
  await sleep(800);
  await ana.click("s", '[data-dg="fit"]');
  await sleep(500);
  await ana.s("s.leaveCanvas()");
  await sleep(400);
  check("breadcrumb.uploader-isn't-asked", (await ana.s(`s.hostCount('[data-dg="breadcrumb"]')`)) === 0);
  await ana.s(`s.open(${q(inRepo.canvas)})`);
  await until(async () => (await countCards(ana)) >= mediators.nodes.length, 9000);
  await sleep(800);
  await ana.click("s", '[data-dg="fit"]');
  await sleep(500);

  // Exporting into the lab's own canvas, which the other person then sees.
  await ana.click("s", `[data-dg="card-${unit.title}"]`);
  await sleep(300);
  await ana.click("s", '[data-dg="export"]');
  await until(() => ana.s(`s.count('[data-dg="export-menu"]')`));
  await ana.s(`s.choose('[data-dg="export-target"]', "lab")`);
  await ana.click("s", '[data-dg="export-go"]');
  const labCanvas = await until(async () => {
    const list = await ana.s(`s.call("canvas.list", {})`);
    return list.find(({ shared, paper }) => shared && !paper) ?? null;
  }, 9000);
  check("export.reaches-the-lab-canvas", Boolean(labCanvas), labCanvas?.title);
  const onBens = await until(async () => {
    await ana.s("s.syncNow()");
    await ben.s("s.syncNow()");
    const list = await ben.s(`s.call("canvas.list", {})`);
    return list.find(({ id: canvas }) => canvas === labCanvas?.id) ?? null;
  }, 20000);
  check("export.lab-canvas-reaches-the-others", Boolean(onBens));
  await ana.s(`s.open(${q(inRepo.canvas)})`);
  await until(async () => (await countCards(ana)) >= mediators.nodes.length, 9000);
  await sleep(800);
  await ana.click("s", '[data-dg="fit"]');
  await sleep(500);

  // AI: type to ask, click cards to ground.
  await ana.click("s", '[data-dg="ai"]');
  await until(() => ana.s(`s.count('[data-dg="ai-input"]')`), 4000);
  check("ai.takes-the-keyboard", (await ana.s("s.focus()")) === "ai-input", await ana.s("s.focus()"));
  await ana.host.input("Input.insertText", { text: "Which mediators predict classification?" });
  await ana.pressEnter();
  const answer = await until(async () => {
    const text = await ana.s(`s.text('[data-dg="ai-answer"]')`);
    return (await ana.s(`s.count('[data-dg="ai-citations"] button')`)) > 0 ? text : null;
  }, 15000);
  check("ai.answers-from-the-canvas", Boolean(answer), answer?.slice(0, 160));
  check("ai.shows-numbers-not-ids", !/did:plc/.test(answer ?? "") && /\[1\]/.test(answer ?? ""));
  check("ai.says-how-it-answered", (await ana.s(`s.text('[data-dg="ai-mode"]')`))?.length > 0, await ana.s(`s.text('[data-dg="ai-mode"]')`));
  await host_shot(ana, "ai");
  await ana.click("s", `[data-dg="card-${unit.title}"]`);
  await sleep(300);
  check("ai.clicking-a-card-grounds-it", (await ana.s(`s.text('[data-dg="ai-ground"]')`))?.includes("Grounded in 1 unit"), await ana.s(`s.text('[data-dg="ai-ground"]')`));
  await ana.click("s", '[data-dg="ai-clear"]');
  await ana.click("s", '[data-dg="ai"]');
};

const hosts = { obsidian: obsidian(), roam: await roam() };
const ana = driver(hosts.obsidian, "Ana Ruiz");
const ben = driver(hosts.roam, "Ben Okafor");
try {
  if (part === "colours") {
    for (const side of [ana, ben]) {
      await side.s("s.test(true)");
      await side.s("s.closeAll()");
      await sleep(600);
      await side.s(`s.call("paper.loadDemo", {})`);
      const paper = (await side.s(`s.call("paper.list", {})`)).find(({ title }) => title.startsWith("Predicting"));
      await colours(side, paper.canvas, paper.units);
    }
  }
  if (part === "all" || part === "solo") {
    await solo(ana);
    await solo(ben);
  }
  if (ana.palette && ben.palette && ana.theme === ben.theme) check("links.same-colours-in-both-bases", q(ana.palette) === q(ben.palette), q(ben.palette));
  if (part === "all" || part === "lab") await lab(ana, ben);
} catch (error) {
  check("run.finished", false, error.stack ?? error);
}
const failed = results.filter(({ pass }) => !pass);
console.log(`=== ${results.length - failed.length} of ${results.length} passed`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
await hosts.obsidian.finish();
await hosts.roam.finish();
process.exit(failed.length ? 1 : 0);
