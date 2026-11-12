// The holonic canvas inside real Obsidian: a note opens as its holon's canvas,
// the breadcrumb goes up, a card's open-inside button goes in, the boundary
// panel follows, a highlight crosses panels, the Library is the repository,
// and the gesture choice lives in the plugin's settings.
//   npm run build:test, then: node harness/holons-test.mjs
// It copies the build into the throwaway vault and adds the worked example as
// one more device's log.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, sleep } from "./hosts.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const OUT = resolve("reports/holons");
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
// A canvas fits itself after a switch, so wait until the target stops moving.
const settled = async (selector) => {
  let last = null;
  for (let i = 0; i < 30; i += 1) {
    const box = await s(`s.locate(${q(selector)})`).catch(() => null);
    if (box && last && Math.abs(box.x - last.x) < 1 && Math.abs(box.y - last.y) < 1) return box;
    last = box;
    await sleep(300);
  }
  return last;
};
const click = async (selector) => {
  const box = await settled(selector);
  if (!box) throw new Error(`Couldn't find ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y, 1, 1);
  await mouse("mouseReleased", x, y, 0, 1);
};
const holonBar = () => s(`s.text('[data-dg="holon-bar"]')`);
const boundaryTitle = () => s(`s.boundaryText('[data-dg="boundary-title"]')`);
const node = (start) => records.find((r) => r.kind === "node" && r.title.startsWith(start));

await s("s.test(true)");
await s("s.closeAll()");

const roots = await until(async () => {
  const found = await s(`s.call("holon.roots", {})`);
  return found.some((r) => r.title === "Akamatsu Lab") ? found : null;
});
check("core.roots", roots, roots?.map((r) => r.title).join(", "));

// A note's unit opens as its holon: its own canvas, with the boundary beside it.
const evd7 = records.find((r) => r.kind === "node" && r.title.startsWith("Three undergraduate researchers") && r.title.endsWith("month."));
await s(`s.call("focus.set", ${q({ node: evd7.id })})`);
await s("s.openNoteAsHolon()");
const claimBar = await until(async () => ((await holonBar()) ?? "").includes("Three undergraduate") ? holonBar() : null);
check("canvas.note-opens-its-holon", claimBar, claimBar);
const claimBoundary = await until(async () => ((await boundaryTitle()) ?? "").startsWith("Three undergraduate") ? boundaryTitle() : null);
check("boundary.follows-the-canvas", claimBoundary, claimBoundary);
await host.shot(`${OUT}/obsidian-claim-canvas.png`);

// The breadcrumb goes up, in the same tab.
await click('[data-dg="holon-up-question"]');
const questionBar = await until(async () => ((await holonBar()) ?? "").includes("How does a shared issue board") && !((await holonBar()) ?? "").includes("Three undergraduate") ? holonBar() : null);
check("canvas.breadcrumb-goes-up", questionBar, questionBar);
const questionBoundary = await until(async () => ((await boundaryTitle()) ?? "").startsWith("How does a shared issue board") ? boundaryTitle() : null);
check("boundary.follows-up", questionBoundary, questionBoundary);
const tabTitle = () => s(`s.hostText('.mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-title')`);
const followed = await until(async () => ((await tabTitle()) ?? "").startsWith("Issue exchange") ? tabTitle() : null);
check("tab.title-follows-the-canvas", followed, followed);
check("canvas.nested-card", ((await s(`s.text('[data-dg="nested-EVD 7: from claim to the notebook"]')`)) ?? "").includes("A canvas inside this one"));

// A card's open-inside button goes in; a holon without a canvas gets one.
const first = node("29% of MATSUlab issues (n=445) were claimed as experiments.");
await click(`[data-dg="inside-${first.title}"]`);
const madeBar = await until(async () => ((await holonBar()) ?? "").includes("29% of MATSUlab") ? holonBar() : null);
check("canvas.open-inside-makes-and-opens", madeBar, madeBar);
await host.shot(`${OUT}/obsidian-made-canvas.png`);

// A highlight from any panel lands on the canvas.
await s(`s.call("canvas.highlight", ${q({ units: [first.id] })})`);
const lit = await until(async () => ((await s(`s.count(".react-flow__node.lit")`)) === 1 ? 1 : null));
check("canvas.highlight-crosses-panels", lit === 1);

// The Library's Canvases tab is the repository.
await s("s.openLibrary()");
const meta = await until(() => s(`s.libraryText('[data-dg="repo-meta-Issue exchange: what the analysis shows"]')`));
check("library.is-the-repository", (meta ?? "").includes("holds 1 canvas"), meta);
await host.shot(`${OUT}/obsidian-library.png`);

// The gesture choice is in the plugin's settings, and every panel sees changes.
check("settings.tab", await s(`app.setting.pluginTabs.some((tab) => tab.plugin?.manifest?.id === "discourse-graphs-demo")`));
await s(`s.call("prefs.set", { holonGesture: "doubleClick" })`);
check("prefs.round-trip", (await s(`s.call("prefs.get", {})`)).holonGesture === "doubleClick");
await s(`s.call("prefs.set", { holonGesture: "button" })`);

check("boundary.theme", (await s("s.boundaryTheme()")) === (await s("s.theme()")));

await s("s.closeAll()");
await host.finish();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
