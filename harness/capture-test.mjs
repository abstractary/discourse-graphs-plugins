// Drives editor capture with real keys in a real host, then reads the base back.
//   node harness/capture-test.mjs obsidian|roam
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam, sleep } from "./hosts.mjs";

const target = process.argv[2];
const OUT = resolve("reports/capture");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const s = host.slice;
const q = JSON.stringify;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 170)}` : ""}`);
};
const until = async (work, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work();
    if (value || Date.now() > deadline) return value;
    await sleep(200);
  }
};
const press = async (key, code, windowsVirtualKeyCode) => {
  for (const type of ["rawKeyDown", "keyUp"]) {
    await host.input("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode });
  }
};
const typeChar = async (text, code, windowsVirtualKeyCode) => {
  await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: text, code, text, windowsVirtualKeyCode });
  await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: text, code, windowsVirtualKeyCode });
};
const stamp = Date.now() % 1000000;
const titleOf = (abbreviation, content) => (target === "roam" ? `[[${abbreviation}]] - ${content}` : `${abbreviation} - ${content}`);
const menu = () => s(`s.hostCount('[data-dg="capture-menu"]')`);
const nodes = async () => (await s("s.summary()")).nodes;
const coreNode = (title) => s(`s.core().then((core) => { const node = [...core.graph().documents.values()].find((d) => d.kind === "node" && d.title === ${q(title)}); return node ? { id: node.id, by: node.by.id, lab: node.lab ?? null } : null; })`);
const uriOf = (id) => s(`s.core().then((core) => core.atRecords()).then((all) => all.find((r) => r.uri.endsWith(${q(`/${id.split("#")[1]}`)}))?.uri ?? null)`);

await s("s.test(true)");
// A canvas in Roam's main view covers the page, so this starts with none open.
await s("s.closeAll()");
await sleep(800);
const identity = await s("s.core().then((core) => core.identity())");
check("identity.offline-did", /^did:plc:[a-z2-7]{24}$/.test(identity.did), identity.did);

// The main gesture: select, press the key, press a letter.
const claim = `Actin scales with tension ${stamp}`;
const page = await s(`s.prepareSelection(${q(`Reading notes ${stamp}`)}, ${q(`We think ${claim} in cells`)}, ${q(claim)})`);
await sleep(400);
await press("\\", "Backslash", 220);
check("capture.key-opens-menu", await until(async () => (await menu()) === 1, 3000));
const labels = await s(`Array.from(document.querySelectorAll('[data-dg="capture-menu"] button')).map((row) => row.dataset.dg)`);
check("capture.menu-lists-each-type-once", new Set(labels).size === labels.length && labels.length >= 5, labels.join(", "));
await host.shot(`${OUT}/${host.name}-menu.png`);
await typeChar("c", "KeyC", 67);
const made = await until(() => coreNode(claim));
check("capture.creates-a-node", made, made?.id);
check("capture.menu-closes", (await menu()) === 0);
check("capture.title-in-base-format", await until(() => s(`s.findRef(${q(titleOf("CLM", claim))})`), 3000), titleOf("CLM", claim));
await sleep(600);
const after = await s(`s.readText(${q(page)})`);
const link = `[[${titleOf("CLM", claim)}]]`;
check("capture.link-replaces-selection", after?.body.includes(link), after?.body.slice(0, 120));
check("capture.words-around-it-stay", after?.body.includes("We think") && after?.body.includes("in cells"));
check("id.is-did-and-tid", made && made.id.startsWith(`${identity.did}#`) && /^[234567a-j][2-7a-z]{12}$/.test(made.id.split("#")[1]), made?.id);
check("id.lives-in-the-text", (await s(`s.unitInText(${q(titleOf("CLM", claim))})`)) === made?.id, await s(`s.unitInText(${q(titleOf("CLM", claim))})`));
const uri = await uriOf(made.id);
check("id.has-an-at-uri", uri?.startsWith(`at://${identity.did}/science.mira.claim/`), uri);

// Escape leaves everything as it was.
const before = (await nodes()).length;
const left = `Leave this alone ${stamp}`;
const second = await s(`s.prepareSelection(${q(`Second page ${stamp}`)}, ${q(`${left} please`)}, ${q(left)})`);
await sleep(400);
await press("\\", "Backslash", 220);
await until(async () => (await menu()) === 1, 3000);
await press("Escape", "Escape", 27);
await sleep(500);
check("capture.escape-cancels", (await menu()) === 0 && (await nodes()).length === before);
check("capture.escape-keeps-text", (await s(`s.readText(${q(second)})`))?.body.includes(left));

// With nothing selected, a backslash is just a backslash.
const plain = await s(`s.prepareSelection(${q(`Third page ${stamp}`)}, "typing here", null)`);
await sleep(400);
await typeChar("\\", "Backslash", 220);
await sleep(700);
check("capture.plain-key-passes-through", (await menu()) === 0, "no menu without a selection");

// The same words again reach the same node.
const third = await s(`s.prepareSelection(${q(`Fourth page ${stamp}`)}, ${q(`Again ${claim} here`)}, ${q(claim)})`);
await sleep(400);
const count = (await nodes()).length;
await press("\\", "Backslash", 220);
await until(async () => (await menu()) === 1, 3000);
await typeChar("c", "KeyC", 67);
await sleep(1200);
check("capture.same-title-reuses-node", (await nodes()).length === count, `${count} nodes`);
check("capture.same-title-still-links", (await s(`s.readText(${q(third)})`))?.body.includes(link));

// The command palette takes the same path as the key.
const loose = `A loose thought ${stamp}`;
await s(`s.prepareSelection(${q(`Fifth page ${stamp}`)}, ${q(`${loose} today`)}, ${q(loose)})`);
await sleep(400);
await s(`s.runCapture("selection")`);
check("capture.command-opens-menu", await until(async () => (await menu()) === 1, 3000));
await typeChar("n", "KeyN", 78);
const draft = await until(() => coreNode(loose));
check("capture.no-type-yet", draft, draft?.id);
check("id.draft-collection", (await uriOf(draft.id))?.includes("/org.discoursegraphs.draft/"), await uriOf(draft.id));

// Convert a whole page.
const named = `Plain page ${stamp}`;
const whole = await s(`s.prepareSelection(${q(named)}, "some notes", null)`);
await s(`s.openNote(${q(whole)})`);
await sleep(1300);
await s(`s.runCapture("page")`);
await until(async () => (await menu()) === 1, 3000);
await typeChar("q", "KeyQ", 81);
const converted = await until(() => coreNode(named));
check("convert.makes-a-node", converted, converted?.id);
check("convert.renames-to-format", await until(() => s(`s.findRef(${q(titleOf("QUE", named))})`), 4000), titleOf("QUE", named));

// A lab: its custodian is the person who sets it up, and it's credited from then on.
const lab = await s(`s.core().then((core) => core.identity().lab ? core.identity() : core.createLab(${q(`Test Lab ${stamp}`)}))`);
check("lab.custodian-is-the-pi", lab.lab?.custodian === identity.did && lab.lab?.did.startsWith("did:plc:"), lab.lab?.did);
const credited = `Credited to the lab ${stamp}`;
await s(`s.prepareSelection(${q(`Sixth page ${stamp}`)}, ${q(`${credited} now`)}, ${q(credited)})`);
await sleep(400);
await press("\\", "Backslash", 220);
await until(async () => (await menu()) === 1, 3000);
await typeChar("c", "KeyC", 67);
const labNode = await until(() => coreNode(credited));
check("lab.credited-on-new-units", labNode?.lab === lab.lab?.did, labNode?.lab);

// The panel shows who made it, and the address.
await s(`s.call("panel.open", { surface: "context" })`);
await until(async () => (await s(`s.ctx.count('.ctx, .ctx-empty')`)) > 0, 8000);
await sleep(600);
await s(`s.call("focus.set", { node: ${q(labNode.id)} })`);
await until(async () => (await s(`s.ctx.count('[data-dg="ctx-uri"]')`)) === 1, 5000);
const shown = await s(`s.ctx.text('[data-dg="ctx-uri"]')`);
check("panel.shows-the-unit-id", /^did:plc:[a-z0-9]+#[a-z0-9]+$/.test(shown ?? ""), shown);
await sleep(300);
await host.shot(`${OUT}/${host.name}-panel.png`);

const passed = results.filter((item) => item.pass).length;
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ host: host.name, passed, total: results.length, results }, null, 2));
await host.finish();
process.exit(passed === results.length ? 0 : 1);
