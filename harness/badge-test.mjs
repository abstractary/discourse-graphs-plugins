// Drives link badges with real clicks and keys in a real host, then reads the base back.
//   node harness/badge-test.mjs obsidian|roam
// Leaves nothing: its units, their relations and its three pages are taken back.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam } from "./hosts.mjs";
import { q, sleep, tools } from "./lib.mjs";

const target = process.argv[2];
const OUT = resolve("reports/badges");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const { s, results, check, until, clickAt, typeChar, key, cleanup, removeTitled, removePage, makeUnit } = tools(host, { wait: { timeout: 6000, every: 200, strict: true } });

const BADGE = '[data-dg="link-badge"]';
// What the page shows now, in reading order.
const badges = () => s(`Array.from(document.querySelectorAll(${q(BADGE)})).filter((b) => b.getClientRects().length > 0).map((b) => ({ text: b.textContent, label: b.getAttribute("aria-label"), ref: b.getAttribute("data-dg-ref") }))`);
const badgeBox = (index = 0) => s(`(() => { const r = Array.from(document.querySelectorAll(${q(BADGE)})).filter((b) => b.getClientRects().length > 0)[${index}]?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
const stamp = Date.now() % 1000000;

try {
  await s("s.test(true)");
  await s("s.closeAll()");
  await sleep(800);
  cleanup("the pages written for this run", async () => {
    for (const title of ["Reading notes", "Plain page", "More notes"]) await removePage(`${title} ${stamp}`);
  });
  // The captured claim comes from real keys, with no id handed back, so it is found again by its title.
  cleanup("the claim captured", () => removeTitled(`Tension gates assembly ${stamp}`));

  const grammar = await s(`s.call("grammar.get", {})`);
  const typeId = (base) => grammar.nodeTypes.find((type) => type.base === base).id;
  const relationId = (base) => grammar.relationTypes.find((type) => type.base === base).id;
  const make = async (content, base) => {
    const node = await makeUnit({ title: content, type: typeId(base) });
    await sleep(300);
    const ref = await until(() => s(`s.findRef(${q(content)})`));
    const text = await s(`s.readText(${q(ref)})`);
    return { ...node, ref, baseTitle: text.title };
  };
  const claim = await make(`Actin scales with tension ${stamp}`, "claim");
  const evidence = await make(`Actin rose twofold ${stamp}`, "evidence");
  const lonely = await make(`Nobody has answered this ${stamp}`, "question");
  const relation = await s(`s.call("relation.assert", ${q({ type: relationId("supports"), source: evidence.id, target: claim.id })})`);

  const plainTitle = `Plain page ${stamp}`;
  await s(`s.writePage(${q(plainTitle)}, ["Nothing here"])`);
  const lines = [
    `Linked to [[${claim.baseTitle}]] in passing`,
    `And to [[${plainTitle}]], which is only a page`,
    `And to [[${lonely.baseTitle}]], which nobody has joined yet`,
    `In code: \`[[${claim.baseTitle}]]\` stays literal`,
  ];
  const pageTitle = `Reading notes ${stamp}`;
  const page = await s(`s.writePage(${q(pageTitle)}, ${q(lines)})`);
  await s(`s.openNote(${q(page)})`);
  const before = (await s(`s.readText(${q(page)})`))?.body;

  const drawn = await until(async () => {
    const list = await badges();
    return list.length >= 2 ? list : null;
  }, 8000);
  check("badge.beside-each-node-link", drawn?.length === 2, JSON.stringify(drawn));
  check("badge.counts-relations", drawn?.[0]?.text === "1", drawn?.[0]?.text);
  check("badge.says-what-it-is", drawn?.[0]?.label === "Claim, 1 relation. Open context", drawn?.[0]?.label);
  check("badge.points-at-the-node", drawn?.[0]?.ref === claim.ref, drawn?.[0]?.ref);
  check("badge.dot-alone-with-no-relations", drawn?.[1]?.text === "" && /no relations yet/.test(drawn?.[1]?.label ?? ""), drawn?.[1]?.label);
  const look = await s(`(() => { const b = document.querySelector(${q(BADGE)}); const p = b.parentElement; const x = getComputedStyle(b), y = getComputedStyle(p); return { font: x.fontFamily === y.fontFamily, color: x.color === y.color, ratio: Number.parseFloat(x.fontSize) / Number.parseFloat(y.fontSize), hue: b.style.getPropertyValue("--dg-badge-hue") }; })()`);
  check("badge.takes-the-text-around-it", look?.font && look?.color, JSON.stringify(look));
  check("badge.colored-by-node-type", Boolean(look?.hue), look?.hue);
  await host.shot(`${OUT}/${host.name}.png`);

  // Live: the count changes with the graph, with no reload.
  const second = await make(`Actin fell under load ${stamp}`, "evidence");
  const added = await s(`s.call("relation.assert", ${q({ type: relationId("opposes"), source: second.id, target: claim.id })})`);
  check("badge.count-follows-a-new-relation", await until(async () => (await badges())[0]?.text === "2"), (await badges())[0]?.text);
  await s(`s.call("relation.withdraw", ${q({ id: added.id })})`);
  check("badge.count-follows-a-withdrawal", await until(async () => (await badges())[0]?.text === "1"), (await badges())[0]?.text);

  // A click opens context on the link's node, and the page stays put.
  const pageBefore = await s("s.openPageRef()");
  const caretBefore = await s("s.caret()");
  const box = await badgeBox(0);
  await clickAt(box.x, box.y);
  const opened = await until(async () => (await s(`s.ctx.count('.ctx')`)) > 0, 9000);
  check("badge.click-opens-the-context-panel", opened);
  const shown = await until(async () => {
    const title = await s(`s.ctx.text('[data-dg="ctx-title"]')`);
    return title?.includes(`Actin scales with tension ${stamp}`) ? title : null;
  }, 6000);
  check("badge.panel-shows-the-linked-node", shown, shown ?? (await s(`s.ctx.text('[data-dg="ctx-title"]')`)));
  await sleep(900);
  check("badge.click-leaves-the-page-open", (await s("s.openPageRef()")) === pageBefore, await s("s.openPageRef()"));
  const caretAfter = await s("s.caret()");
  check("badge.click-leaves-the-caret-alone", target === "roam" ? !caretAfter.focused : caretAfter?.line === caretBefore?.line && caretAfter?.ch === caretBefore?.ch, JSON.stringify({ caretBefore, caretAfter }));
  const stillThere = await s(`s.ctx.text('[data-dg="ctx-title"]')`);
  check("badge.panel-stays-on-the-node", stillThere?.includes(`Actin scales with tension ${stamp}`), stillThere);

  // The keyboard reaches the same place.
  await s(`s.call("focus.set", { node: null })`);
  await s(`document.querySelectorAll(${q(BADGE)})[1].focus()`);
  await key("Enter", 13);
  const byKey = await until(async () => {
    const title = await s(`s.ctx.text('[data-dg="ctx-title"]')`);
    return title?.includes(`Nobody has answered this ${stamp}`) ? title : null;
  }, 6000);
  check("badge.enter-opens-context", byKey, byKey ?? (await s(`s.ctx.text('[data-dg="ctx-title"]')`)));
  check("badge.text-is-never-touched", (await s(`s.readText(${q(page)})`))?.body === before);

  // Editing puts the block back through the base's own rendering.
  if (target === "roam") {
    const block = await s(`(() => { const r = Array.from(document.querySelectorAll(".rm-block-text")).find((e) => e.textContent.startsWith("And to"))?.getBoundingClientRect(); return r ? { x: r.x + 30, y: r.y + r.height / 2 } : null; })()`);
    await clickAt(block.x, block.y);
    await until(() => s(`Boolean(document.querySelector("textarea.rm-block-input"))`), 3000);
    await key("Escape", 27);
    await s(`document.activeElement?.blur?.()`);
    await clickAt(block.x + 500, block.y + 400);
    check("badge.returns-after-editing", await until(async () => (await badges()).length === 2, 5000), (await badges()).length);
    await s(`s.openInSidebar(${q(page)})`);
    check("badge.draws-in-the-sidebar", await until(async () => (await badges()).length >= 4, 6000), (await badges()).length);
    await s(`s.focusCanvas()`);
    await s(`s.openNote(${q(claim.ref)})`);
    await sleep(1200);
    check("badge.none-on-a-page-title", (await s(`document.querySelectorAll(${q(`.rm-title-display ${BADGE}`)}).length`)) === 0);
    await s(`s.openNote(${q(page)})`);
    await until(async () => (await badges()).length === 2, 5000);
  } else {
    cleanup("the editing view", () => s("s.readingMode(false)"));
    await s("s.readingMode(true)");
    await sleep(900);
    const reading = await until(async () => {
      const count = await s(`document.querySelectorAll(${q(`.markdown-reading-view ${BADGE}`)}).length`);
      return count === 2 ? count : null;
    }, 6000);
    check("badge.draws-in-reading-view", reading === 2, reading);
    await s(`s.call("relation.assert", ${q({ type: relationId("opposes"), source: second.id, target: claim.id })})`);
    const live = await until(async () => (await s(`document.querySelector(${q(`.markdown-reading-view ${BADGE}`)})?.textContent`)) === "2");
    check("badge.reading-view-stays-live", live);
    await s("s.readingMode(false)");
    await sleep(700);
  }

  // A rename keeps the id, so the badge follows the node.
  const renamed = target === "roam" ? `[[CLM]] - Actin tracks tension ${stamp}` : `CLM - Actin tracks tension ${stamp}`;
  await s(`s.renameInBase(${q(claim.ref)}, ${q(renamed)})`);
  await sleep(1600);
  check("badge.survives-a-rename", await until(async () => (await badges())[0]?.ref === claim.ref), JSON.stringify((await badges())[0]));

  // The off switch, kept per device.
  const badgesBack = cleanup("the badges, switched on", () => s("s.core().then((core) => core.toggleBadges())"));
  await s("s.core().then((core) => core.toggleBadges())");
  check("badge.toggle-clears-them", await until(async () => (await badges()).length === 0));
  await badgesBack();
  check("badge.toggle-brings-them-back", await until(async () => (await badges()).length === 2), (await badges()).length);

  // Capture leaves a link, and a link to a node gets its badge.
  const capturedText = `Tension gates assembly ${stamp}`;
  await s(`s.prepareSelection(${q(`More notes ${stamp}`)}, ${q(`We think ${capturedText} in cells`)}, ${q(capturedText)})`);
  await sleep(500);
  await key("\\", 220, 0, { code: "Backslash" });
  await until(async () => (await s(`s.hostCount('[data-dg="capture-menu"]')`)) === 1, 3000);
  await typeChar("c", "KeyC", 67);
  await sleep(1200);
  if (target === "roam") {
    await s(`document.activeElement?.blur?.()`);
    await clickAt(900, 620);
  }
  check("badge.appears-after-capture", await until(async () => (await badges()).some((badge) => badge.label?.startsWith("Claim, no relations"))), JSON.stringify(await badges()));

  // With its text gone, a link isn't a node any more.
  await s(`s.openNote(${q(page)})`);
  await until(async () => (await badges()).length >= 2, 5000);
  await s(`s.removeOutside(${q(lonely.ref)})`);
  check("badge.goes-with-the-text", await until(async () => !(await badges()).some((badge) => badge.ref === lonely.ref), 8000), JSON.stringify(await badges()));

  await s("s.closeAll()");
} finally {
  await cleanup.run();
}
await host.finish();
const passed = results.filter((result) => result.pass).length;
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
