// The holonic canvas inside real Obsidian: a note opens as its holon's canvas,
// the breadcrumb goes up, a card's open-inside button goes in, the boundary
// panel follows, a highlight crosses panels, the Library is the repository,
// and the gesture choice lives in the plugin's settings.
//   npm run build:test, then: node harness/holons-test.mjs
// It copies the build into the throwaway vault and adds the worked example as
// one more device's log.
// Leaves the worked example's records file, the same one every run. The notebook setting goes back to what it was.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { q, session } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const OUT = resolve("reports/holons");

const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8"));
writeFileSync(`${VAULT}/discourse-graph/records/worked-example.jsonl`, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
// Left behind: the records file above. The worked example is the same file every run, and other suites read it.
// The build is copied in and the plugin reloaded by the session.
const { host, s, results, check, until, call, cleanup } = await session({ vault: VAULT, out: OUT, wait: { timeout: 20000, every: 400 } });
const holonBar = () => s(`s.text('[data-dg="holon-bar"]')`);
const boundaryTitle = () => s(`s.boundaryText('[data-dg="boundary-title"]')`);
const node = (start) => records.find((r) => r.kind === "node" && r.title.startsWith(start));

try {
  await s("s.test(true)");
  await s("s.closeAll()");

  const roots = await until(async () => {
    const found = await s(`s.call("holon.roots", {})`);
    return found.some((r) => r.title === "Akamatsu Lab") ? found : null;
  });
  check("core.roots", roots, roots?.map((r) => r.title).join(", "));

  // A canvas tied to a question shows where it sits, and the boundary panel follows it.
  // A unit no longer opens as a graph of its own (12 Nov 2026): it is a leaf.
  const exchange = records.find((r) => r.kind === "canvas" && r.title.startsWith("Issue exchange"));
  await s(`s.open(${q(exchange.id)})`);
  await s("s.openBoundary()");
  const questionBar = await until(async () => ((await holonBar()) ?? "").includes("How does a shared issue board") ? holonBar() : null);
  check("canvas.shows-its-place", questionBar, questionBar);
  const questionBoundary = await until(async () => ((await boundaryTitle()) ?? "").startsWith("How does a shared issue board") ? boundaryTitle() : null);
  check("boundary.follows-the-canvas", questionBoundary, questionBoundary);
  await host.shot(`${OUT}/obsidian-question-canvas.png`);
  const tabTitle = () => s(`s.hostText('.mod-root .workspace-tab-header.is-active .workspace-tab-header-inner-title')`);
  const followed = await until(async () => ((await tabTitle()) ?? "").startsWith("Issue exchange") ? tabTitle() : null);
  check("tab.title-follows-the-canvas", followed, followed);
  check("canvas.nested-card", ((await s(`s.text('[data-dg="nested-EVD 7: from claim to the notebook"]')`)) ?? "").includes("A canvas inside this one"));

  // No unit card offers to open as a graph of its own.
  const first = node("29% of MATSUlab issues (n=445) were claimed as experiments.");
  check("canvas.units-are-leaves", (await s(`s.count('[data-dg^="inside-"]')`)) === 0);

  // A highlight from any panel lands on the canvas.
  await s(`s.call("canvas.highlight", ${q({ units: [first.id] })})`);
  const lit = await until(async () => ((await s(`s.count(".react-flow__node.lit")`)) === 1 ? 1 : null));
  check("canvas.highlight-crosses-panels", lit === 1);

  // The Library's Canvases tab is the repository.
  await s("s.openLibrary()");
  const meta = await until(() => s(`s.libraryText('[data-dg="repo-meta-Issue exchange: what the analysis shows"]')`));
  check("library.is-the-repository", (meta ?? "").includes("holds 1 canvas"), meta);
  check("library.pictures", (await s(`s.libraryCount(".repo-list svg.thumb")`)) >= 2);
  await host.shot(`${OUT}/obsidian-library.png`);

  // Choices live in the plugin's settings, and every panel sees changes.
  check("settings.tab", await s(`app.setting.pluginTabs.some((tab) => tab.plugin?.manifest?.id === "discourse-graphs-demo")`));
  const notebookText = (await call("prefs.get")).notebookText;
  cleanup("the notebook setting", () => call("prefs.set", { notebookText }));
  await s(`s.call("prefs.set", { notebookText: true })`);
  check("prefs.round-trip", (await s(`s.call("prefs.get", {})`)).notebookText === true);
  await s(`s.call("prefs.set", { notebookText: false })`);

  check("boundary.theme", (await s("s.boundaryTheme()")) === (await s("s.theme()")));

  await s("s.closeAll()");
} finally {
  await cleanup.run();
}
await host.finish();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
