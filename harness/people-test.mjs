// People and libraries in real Obsidian: initials that open a profile, the profile's three audiences,
// who wrote a note, the time on a card, and bringing a source and its highlights in from Zotero.
//   npm run build:test, then: node harness/people-test.mjs [stage ...]
// The Zotero stages need `node harness/stub-zotero.mjs` running, and are skipped without it.
// Never run this beside a real Zotero: the stand-in uses Zotero's own port. Pictures go to reports/people.
// Leaves the "People test" canvas, and on it the source and highlights brought in from the stand-in Zotero.
// The note and the line it puts there are taken back, and the card facts setting goes back to what it was.
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const stages = process.argv.slice(2);
const wants = (name) => stages.length === 0 || stages.includes(name);
const t = await session({ out: resolve("reports/people"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call, mouse, type, cleanup } = t;
try {
  await s("s.test(true)");
  const cards = () => at("canvas", "count", ".react-flow__node");
  const fields = (await call("prefs.get")).cardFields;
  cleanup("the card facts setting", () => call("prefs.set", { cardFields: fields }));
  // Left behind: this canvas, which sidebar-test.mjs also opens. The Zotero stage's source and highlights stay on it
  // with their units: whether units removed with node.remove are brought in again by the next import hasn't been tried.
  const board = (await call("canvas.list")).find((canvas) => canvas.title === "People test") ?? (await call("canvas.create", { title: "People test" }));
  const itemsBefore = new Set((await call("canvas.open", { id: board.id })).items.map((entry) => entry.id));
  cleanup("the note and the line put on the People test canvas", async () => {
    const loose = (await call("canvas.open", { id: board.id })).items.filter((entry) => !itemsBefore.has(entry.id) && !entry.item.dg && !("fromNode" in entry.item)).map((entry) => entry.id);
    if (loose.length) await call("canvas.write", { canvas: board.id, removes: loose });
  });

  if (wants("cards")) {
    await call("prefs.set", { cardFields: ["source", "created"] });
    await s("s.closeAll()");
    const paper = (await call("paper.list"))[0];
    await s(`s.open(${q(paper.canvas)})`);
    await until(async () => ((await cards()) ?? 0) >= 5);
    await sleep(1200);
    const made = await at("canvas", "text", '.card .fact[data-field="created"] time');
    check("cards.date-carries-the-time", /\d{1,2}:\d{2}/.test(made ?? ""), made);
    check("cards.no-open-inside-button", (await at("canvas", "count", '[data-dg^="inside-"]')) === 0);
    check("cards.bar-says-nothing-of-holons", !/holon|holarch/i.test((await at("canvas", "text", '[data-dg="holon-bar"]')) ?? ""));

    // A person's initials, anywhere: hover for a card, click for their profile.
    let mark = null;
    for (const title of Object.values((await call("canvas.open", { id: paper.canvas })).nodes).map((node) => node.title)) {
      const box = await at("canvas", "locate", `[data-dg="credit-${title}"]`).catch(() => null);
      if (box && box.x > 320 && box.x < 1300 && box.y > 220 && box.y < 900) { mark = box; break; }
    }
    check("people.initials-are-on-a-card", Boolean(mark));
    if (mark) {
      await mouse("mouseMoved", mark.x + mark.width / 2, mark.y + mark.height / 2);
      const card = await until(() => at("canvas", "text", '[data-dg="person-card"]'), 4000);
      check("people.hover-shows-a-card", /units written/.test(card ?? "") && /Last active|Nothing of theirs/.test(card ?? ""), card);
      await sleep(500);
      await shot("01-hover-card");
      await mouse("mouseMoved", mark.x - 200, mark.y - 100);
      check("people.card-goes-when-the-pointer-leaves", await until(async () => !(await has("canvas", '[data-dg="person-card"]')), 3000));
      await t.clickAt(mark.x + mark.width / 2, mark.y + mark.height / 2);
      check("people.click-opens-the-profile", await until(() => has("profile", '[data-dg="profile"]'), 8000));
    }
    await call("prefs.set", { cardFields: ["source"] });
  }

  if (wants("profile")) {
    if (!(await has("profile", '[data-dg="profile"]').catch(() => false))) await call("profile.show", {});
    await until(() => has("profile", '[data-dg="profile-stats"]'), 8000);
    await sleep(600);
    const me = await call("profile.view", {});
    check("profile.names-the-person", (await at("profile", "text", '[data-dg="profile-name"]'))?.includes(me.person.name));
    check("profile.offers-three-audiences-to-oneself", (await at("profile", "count", ".profile-tabs [role=tab]")) === 3, await at("profile", "text", ".profile-tabs"));
    check("profile.says-who-sees-the-private-view", /Only you can see this/.test((await at("profile", "text", '[data-dg="profile-audience"]')) ?? ""));
    check("profile.private-has-a-history", (await at("profile", "count", ".profile-day li")) > 0, `${await at("profile", "count", ".profile-day li")} events`);
    check("profile.counts-match-core", (await at("profile", "text", '[data-dg="profile-written"]')) === me.private.stats.written.toLocaleString(), await at("profile", "text", '[data-dg="profile-written"]'));
    await shot("02-profile-only-you");
    await click("profile", '[data-dg="profile-tab-lab"]');
    await sleep(500);
    check("profile.lab-view-says-who-sees-it", /lab/i.test((await at("profile", "text", '[data-dg="profile-audience"]')) ?? ""), await at("profile", "text", '[data-dg="profile-audience"]'));
    await click("profile", '[data-dg="profile-tab-public"]');
    await sleep(500);
    check("profile.public-is-counts-alone", !(await has("profile", '[data-dg="profile-history"]')) && (await has("profile", '[data-dg="profile-stats"]')) && /counts alone/.test((await at("profile", "text", '[data-dg="profile-audience"]')) ?? ""));
    await shot("03-profile-everyone");
    // A history line leads to the unit it is about.
    await click("profile", '[data-dg="profile-tab-private"]');
    await sleep(500);
    if (await has("profile", ".profile-unit")) {
      const title = await at("profile", "text", ".profile-unit span:last-child");
      await click("profile", ".profile-unit");
      check("profile.a-line-leads-to-its-unit", await until(async () => (await at("context", "text", '[data-dg="ctx-title"]')) === title, 8000), `${title} / context says: ${await at("context", "text", '[data-dg="ctx-title"]')}`);
    }
  }

  if (wants("ink")) {
    // A freehand line shows it is selected, and who drew it.
    await s("s.closeAll()");
    await s(`s.open(${q(board.id)})`);
    await sleep(2500);
    await call("canvas.write", { canvas: board.id, upserts: [{ z: 999, item: { type: "stroke", x: 40, y: -160, width: 120, height: 14, path: "M0,4 L120,4 L120,10 L0,10 Z" } }] });
    await until(() => has("canvas", '[data-dg="ink"]'), 5000);
    await s(`s.canvasReveal('[data-dg="ink"]')`).catch(() => null);
    await click("canvas", '[data-dg="ink"]');
    check("ink.selected-shows-a-frame", await until(() => has("canvas", '[data-dg="ink"][data-selected]'), 4000));
    const drawnBy = await at("canvas", "text", '[data-dg="ink-credit"]');
    check("ink.selected-says-who-drew-it", (drawnBy ?? "").length > 2, drawnBy);
    await shot("09-line-selected");
    const drawn = (await call("canvas.open", { id: board.id })).items.filter((entry) => entry.item.type === "stroke").map((entry) => entry.id);
    await call("canvas.write", { canvas: board.id, removes: drawn });
  }

  if (wants("notes")) {
    await s("s.closeAll()");
    await s(`s.open(${q(board.id)})`);
    await sleep(1500);
    if ((await at("canvas", "count", ".note")) === 0) {
      await click("canvas", '[data-dg="add-note"]');
      await sleep(600);
      await type("Check the Lorenz case again");
      await t.clickAt(700, 800);
      await sleep(900);
    }
    const by = await until(() => at("canvas", "text", '.note [data-dg="note-by"]'), 6000);
    const me = (await call("profile.view", {})).person.name;
    check("notes.say-who-wrote-them-and-when", (by ?? "").includes(me) && /\d{1,2}:\d{2}/.test(by ?? ""), by);
    await shot("04-note-author");
  }

  if (wants("zotero")) {
    const status = await call("zotero.status", {});
    await s("s.closeAll()");
    await s(`s.open(${q(board.id)})`);
    await sleep(1200);
    await click("canvas", '[data-dg="canvas-menu"]');
    await click("canvas", '[data-dg="from-zotero"]');
    if (!status.ok) {
      const off = await until(() => s(`s.dialog.text('[data-dg="zotero-off"]')`), 12000);
      check("zotero.says-what-to-do-when-zotero-is-not-there", /Open Zotero on this computer|Settings, then Advanced/.test(off ?? ""), off);
      await shot("05-zotero-not-running");
      note("SKIP the rest: no stand-in Zotero. Run `node harness/stub-zotero.mjs` and run this stage again.");
      await s("s.closeDialog()").catch(() => null);
    } else {
      await until(() => s(`s.dialog.count('[data-dg="zotero-search"]')`), 8000);
      await sleep(400);
      await type("reservoir");
      const hit = await until(() => s(`s.dialog.locate('[data-dg="zotero-hit-ABCD2345"]')`), 8000);
      check("zotero.search-finds-the-reference", Boolean(hit), await s(`s.dialog.text('[data-dg="zotero-hits"]')`));
      await shot("05-zotero-search");
      await t.clickAt(hit.x + 60, hit.y + 14);
      await until(() => s(`s.dialog.count('[data-dg="zotero-marks"]')`), 8000);
      const marks = await s(`s.dialog.count('[data-dg="zotero-marks"] li')`);
      const chosen = await s(`s.dialog.count('[data-dg="zotero-marks"] li[data-on="true"]')`);
      check("zotero.shows-every-highlight", marks === 4, `${marks} marks`);
      check("zotero.chooses-what-has-words-and-is-new", chosen >= 0 && chosen <= 3, `${chosen} chosen`);
      await sleep(400);
      await shot("06-zotero-highlights");
      const before = (await cards()) ?? 0;
      const go = await s(`s.dialog.locate('[data-dg="zotero-bring"]')`);
      await t.clickAt(go.x + go.width / 2, go.y + go.height / 2);
      check("zotero.dialog-closes", await until(async () => !(await s("s.dialogOpen()")), 12000));
      const units = Object.values((await call("canvas.open", { id: board.id })).nodes);
      const source = units.find((unit) => unit.base === "source" && /reservoir computers work best/i.test(unit.title));
      const claim = units.find((unit) => /largest entropy/.test(unit.title));
      check("zotero.source-and-highlights-are-on-the-canvas", Boolean(source) && Boolean(claim), units.map((unit) => `${unit.abbreviation}: ${unit.title.slice(0, 30)}`).join(" | "));
      check("zotero.a-tagged-highlight-keeps-its-type", claim?.base === "claim", claim?.typeLabel);
      check("zotero.card-cites-the-source-and-says-by-hand", claim?.card.source?.name === "Carroll 2020" && claim?.card.source?.how === "manual", JSON.stringify(claim?.card.source));
      if (claim) {
        const view = await call("node.view", { id: claim.id });
        check("zotero.passage-opens-in-zotero", /^zotero:\/\/open-pdf\/library\/items\/PDFA0001\?page=6&annotation=ANNO0002$/.test(view.provenance.library?.open ?? ""), view.provenance.library?.open);
        await s(`s.openSide("context")`);
        await call("focus.set", { node: claim.id });
        await until(async () => /largest entropy/.test((await at("context", "text", '[data-dg="ctx-title"]')) ?? ""), 6000);
        check("zotero.panel-keeps-the-readers-note", /cuts against/.test((await at("context", "text", '[data-dg="ctx-library"]')) ?? ""), await at("context", "text", '[data-dg="ctx-library"]'));
      }
      await click("canvas", '[data-dg="fit"]').catch(() => null);
      await sleep(1200);
      await shot("07-from-zotero-on-the-canvas");
      const again = await call("zotero.import", { ref: "users/123456/items/ABCD2345", annotations: [{ key: "ANNO0001" }, { key: "ANNO0002" }], canvas: board.id });
      check("zotero.again-makes-nothing-new", again.made === 0 && again.wasHere, JSON.stringify({ made: again.made, already: again.already }));
      note(`cards before ${before}, after ${await cards()}`);
    }
  }
} finally {
  await cleanup.run();
}

process.exit(await t.finish("people"));
