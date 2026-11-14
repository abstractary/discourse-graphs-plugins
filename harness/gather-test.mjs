// Growing an argument from what is at hand, in real Obsidian: a picture dropped on a canvas and said to
// show something, a card's relations bringing in what isn't there yet, a tagged line made a unit, canvas
// actions run as Obsidian commands, and a dialog that is one of Obsidian's own modals.
//   npm run build:test, then: node harness/gather-test.mjs
// Leaves nothing: the canvas, the units, the picture, the meeting note and the tag on Claim are taken back.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const RUN = String(Date.now()).slice(-5);
// A 2x2 PNG, unlike any other picture in the vault.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7cFBgAAAAASUVORK5CYII=";
const PICTURE = `gel ${RUN}.png`;
const SAID = `The 42 kDa band is absent in the knockout ${RUN}`;

const t = await session({ out: resolve("reports/gather"), reload: !process.env.DG_NO_RELOAD });
const { s, check, until, shot, at, click, has, type, key, call, cleanup, makeCanvas } = t;
try {
  await s("s.test(true)");
  const made = [];
  const cards = () => at("canvas", "count", ".react-flow__node");

  // A run that stopped early leaves its canvas, units and picture behind. They go before this one starts.
  for (const canvas of (await call("canvas.list")).filter((item) => /^Bench \d{5}$/.test(item.title))) await call("canvas.remove", { id: canvas.id }).catch(() => undefined);
  for (const text of ["gel ", "The 42 kDa band is absent in the knockout ", "The protein is lost ", "Load sets the assembly rate "]) {
    for (const unit of await call("node.query", { text, limit: 50 })) if (new RegExp(`^${text}\\d{5}$`).test(unit.title)) await call("node.remove", { id: unit.id }).catch(() => undefined);
  }
  for (const name of existsSync(`${VAULT}/Discourse pictures`) ? readdirSync(`${VAULT}/Discourse pictures`) : []) if (/^gel \d{5}( \d+)?\.png$/.test(name)) rmSync(`${VAULT}/Discourse pictures/${name}`, { force: true });
  for (const name of readdirSync(VAULT)) if (/^Meeting \d{5}\.md$/.test(name)) rmSync(`${VAULT}/${name}`, { force: true });

  cleanup("the meeting note and the picture", async () => {
    await sleep(500);
    rmSync(`${VAULT}/Meeting ${RUN}.md`, { force: true });
    rmSync(`${VAULT}/Discourse pictures/${PICTURE}`, { force: true });
  });
  const board = await makeCanvas(`Bench ${RUN}`);
  cleanup("the units this run made", async () => {
    for (const id of made) await call("node.remove", { id }).catch((error) => t.note(`cleanup: couldn't remove ${id}: ${error}`));
  });
  await s("s.closeAll()");
  await s(`s.open(${q(board.id)})`);
  await until(() => has("canvas", ".area"), 8000);

  // ---------------------------------------------------------------- A picture becomes an output, then evidence
  await s(`s.canvasDropFile(".area", ${JSON.stringify({ name: PICTURE, type: "image/png", base64: PNG })})`);
  check("picture.card-appears", await until(async () => ((await cards()) ?? 0) === 1, 8000), `${await cards()} cards`);
  check("picture.is-drawn-on-its-card", await until(() => has("canvas", ".card-picture img"), 8000));
  check("picture.file-is-kept-under-its-name", existsSync(`${VAULT}/Discourse pictures/${PICTURE}`), readdirSync(VAULT).join(", ").slice(0, 120));
  let view = await call("canvas.open", { id: board.id });
  const picture = Object.values(view.nodes)[0];
  if (picture) made.push(picture.id);
  check("picture.is-an-output", picture?.base === "output" && picture.image === true, JSON.stringify(picture)?.slice(0, 160));
  await click("canvas", '[data-dg="fit"]');
  await sleep(700);
  await click("canvas", `[data-dg="say-gel ${RUN}"]`);
  await until(() => has("canvas", '[data-dg="say-input"]'), 4000);
  // Picking up the card takes the keyboard for a moment; the field takes it back.
  await sleep(250);
  await type(SAID);
  await key("Enter", 13);
  check("evidence.card-appears", await until(async () => ((await cards()) ?? 0) === 2, 8000), `${await cards()} cards`);
  view = await call("canvas.open", { id: board.id });
  const evidence = Object.values(view.nodes).find((unit) => unit.title === SAID);
  if (evidence) made.push(evidence.id);
  check("evidence.rests-on-the-picture", evidence?.base === "evidence", JSON.stringify(evidence)?.slice(0, 120));
  await click("canvas", '[data-dg="fit"]');
  await sleep(700);
  await shot("01-picture-and-what-it-shows");

  // ---------------------------------------------------------------- A card's relations
  const grammar = await call("grammar.get");
  const typeOf = (label) => grammar.nodeTypes.find((item) => item.label === label);
  const claim = await call("node.create", { title: `The protein is lost ${RUN}`, type: typeOf("Claim").id });
  made.push(claim.id);
  if (evidence) await call("relation.assert", { type: grammar.relationTypes.find((item) => item.label === "Supports").id, source: evidence.id, target: claim.id });
  await click("canvas", `[data-dg="card-${SAID}"]`);
  await until(() => has("canvas", `[data-dg="related-${SAID}"]`), 4000);
  await click("canvas", `[data-dg="related-${SAID}"]`);
  check("related.lists-the-claim-as-not-here", await until(() => has("canvas", `[data-dg="related-add-The protein is lost ${RUN}"]`), 6000), await at("canvas", "text", '[data-dg="related-menu"]'));
  await shot("02-what-a-card-is-related-to");
  await click("canvas", `[data-dg="related-add-The protein is lost ${RUN}"]`);
  check("related.brings-it-onto-the-canvas", await until(async () => ((await cards()) ?? 0) === 3, 8000), `${await cards()} cards`);
  view = await call("canvas.open", { id: board.id });
  check("related.draws-the-link", Object.values(view.relations).some((relation) => relation.source === evidence?.id && relation.target === claim.id), `${Object.keys(view.relations).length} links`);

  // ---------------------------------------------------------------- Canvas actions are Obsidian commands
  check("command.is-registered-and-runs", (await s('s.runCommand("canvas-export")')) === true);
  check("command.opens-export", await until(() => has("canvas", '[data-dg="export-menu"]'), 5000));
  await key("Escape", 27);
  await s('s.runCommand("canvas-fit")');
  await sleep(500);

  // ---------------------------------------------------------------- A tagged line becomes a unit
  const tagged = typeOf("Claim");
  cleanup("the tag on Claim", () => call("grammar.saveNodeType", { id: tagged.id, label: tagged.label, base: tagged.base, ...(tagged.abbreviation ? { abbreviation: tagged.abbreviation } : {}), ...(tagged.titleFormat ? { titleFormat: tagged.titleFormat } : {}), ...(tagged.template ? { template: tagged.template } : {}), ...(tagged.tag ? { tag: tagged.tag } : {}) }));
  await call("grammar.saveNodeType", { id: tagged.id, label: tagged.label, base: tagged.base, ...(tagged.abbreviation ? { abbreviation: tagged.abbreviation } : {}), ...(tagged.titleFormat ? { titleFormat: tagged.titleFormat } : {}), ...(tagged.template ? { template: tagged.template } : {}), tag: "clm-candidate" });
  const daily = `${VAULT}/Meeting ${RUN}.md`;
  const LINE = `Load sets the assembly rate ${RUN}`;
  writeFileSync(daily, `Lab meeting\n\n- ${LINE} #clm-candidate\n- buy tips\n`);
  const listed = await until(async () => (await call("candidate.list")).candidates.find((item) => item.text === LINE), 12000);
  check("candidate.is-found-in-the-note", Boolean(listed), JSON.stringify(await call("candidate.list")).slice(0, 200));
  await s('s.openSide("search")');
  check("candidate.search-says-there-is-one", await until(() => s(`s.search.count('[data-dg="candidates-toggle"]')`), 8000));
  const toggle = await s(`s.search.locate('[data-dg="candidates-toggle"]')`);
  if (toggle) await t.clickAt(toggle.x + 60, toggle.y + toggle.height / 2);
  const make = await until(() => s(`s.search.locate(${JSON.stringify(`[data-dg="candidate-make-${LINE}"]`)})`), 6000);
  await shot("03-a-candidate-in-search");
  if (make) await t.clickAt(make.x + make.width / 2, make.y + make.height / 2);
  const swapped = await until(async () => /\[\[CLM - Load sets the assembly rate/.test(readFileSync(daily, "utf8")) && readFileSync(daily, "utf8"), 10000);
  check("candidate.line-becomes-a-link", Boolean(swapped), readFileSync(daily, "utf8"));
  const promoted = (await call("node.query", { text: LINE, limit: 5 })).find((unit) => unit.title === LINE);
  if (promoted) made.push(promoted.id);
  check("candidate.is-now-a-claim", promoted?.base === "claim", JSON.stringify(promoted)?.slice(0, 120));

  // ---------------------------------------------------------------- A dialog is one of Obsidian's modals
  await call("dialog.open", { surface: "grammar" });
  check("modal.is-obsidians-own", await until(() => s("s.dialogIsModal()"), 6000));
  const field = await until(() => s(`s.dialog.locate('[data-dg="grammar-add-type"]')`), 6000);
  if (field) await t.clickAt(field.x + 20, field.y + field.height / 2);
  await sleep(300);
  await shot("04-a-dialog-as-a-modal");
  // The frame has the keyboard now, which is where Escape used to stop working.
  await key("Escape", 27);
  check("modal.escape-closes-it-from-inside", await until(async () => !(await s("s.dialogOpen()")), 5000));
} finally {
  await cleanup.run();
}

process.exit(await t.finish("gather"));
