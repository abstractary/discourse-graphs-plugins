// The newer surfaces inside real Obsidian, checked and photographed for the user guide:
// the canvas picker's pictures, the Library's scopes, the Method section, Ask AI with
// a person's own model, runs and notebooks, the reader, search, and the settings page.
//   npm run build:test, then: node harness/guide-test.mjs
// The AI steps talk to a stand-in model server on localhost:18434 (see docs/testing.md).
// Pictures go to docs/guide/media. Set DG_SHOTS=0 to check without taking them.
// Leaves the worked example's records file, the same one every run, and the code, run and output units read from
// the notebook. The model setup and the left sidebar go back to how they were.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const OUT = resolve("docs/guide/media");
const SHOTS = process.env.DG_SHOTS !== "0";
const MODEL = process.env.DG_STUB_MODEL ?? "http://localhost:18434/v1";
const NOTEBOOK = "Notebooks/evd1_evd7_analysis.ipynb";
mkdirSync("reports/guide", { recursive: true });

const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8"));
writeFileSync(`${VAULT}/discourse-graph/records/worked-example.jsonl`, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
// Left behind: the records file above. The worked example is the same file every run, and other suites read it.
// The build is copied in and the plugin reloaded by the session.
const { host, s, results, check, until, shot, at, click, typeKeys, key, cleanup } = await session({ vault: VAULT, out: OUT, shots: SHOTS, shotPause: 700, wait: { timeout: 20000, every: 400 }, settle: 300 });
const node = (start) => records.find((r) => r.kind === "node" && r.title.startsWith(start));
const canvas = records.find((r) => r.kind === "canvas" && r.title.startsWith("Issue exchange"));
const TITLE = canvas.title;

try {
  await s("s.test(true)");
  await s("s.closeAll()");
  cleanup("the left sidebar", () => s("app.workspace.leftSplit.expand()"));
  await s("app.workspace.leftSplit.collapse()");
  const before = await s(`s.call("ai.settings", {})`);
  // Put the model setup back as it was. No key was saved by this suite.
  const modelBack = cleanup("the model setup", () => s(`s.call("ai.configure", ${q({ source: before.source, provider: before.provider, model: before.model, baseUrl: before.baseUrl ?? "", route: before.route })})`));

  // ---------------------------------------------------------------- The canvas and its picker
  await s(`s.open(${q(canvas.id)})`);
  await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) > 5);
  await sleep(1500);
  await shot("canvas");
  await click("canvas", '[data-dg="canvas-menu"]');
  const pictures = await until(async () => ((await at("canvas", "count", ".canvas-menu .thumb rect")) ?? 0) > 5 ? at("canvas", "count", ".canvas-menu svg.thumb") : null);
  check("picker.shows-each-canvas-as-its-graph", pictures >= 2, `${pictures} pictures`);
  const kind = await at("canvas", "text", `[data-dg="canvas-${TITLE}"] .repo-kind`);
  check("picker.says-canvas-or-pdf-canvas", /^\s*Canvas/.test(kind ?? ""), kind);
  await shot("canvas-picker");
  await key("Escape", 27);

  // ---------------------------------------------------------------- The Library: scopes and kinds
  await s("s.openLibrary()");
  const row = await until(() => at("canvases", "text", `[data-dg="repo-kind-${TITLE}"]`));
  check("library.kind", /^\s*Canvas/.test(row ?? ""), row);
  const pdfRow = await at("canvases", "text", '[data-kind="paper"] .repo-kind');
  check("library.pdf-kind", /PDF canvas/.test(pdfRow ?? ""), pdfRow);
  const everyone = Number(((await at("canvases", "text", '[data-dg="scope-everyone"] span')) ?? "0").trim());
  await click("canvases", '[data-dg="scope-mine"]');
  const mine = await until(async () => ((await at("canvases", "count", ".repo-list > li")) ?? 99) < everyone ? at("canvases", "count", ".repo-list > li") : null, 6000);
  check("library.scope-narrows", mine !== null && mine < everyone, `${mine} of ${everyone}`);
  await click("canvases", '[data-dg="scope-everyone"]');
  await shot("library");

  // ---------------------------------------------------------------- Method, on evidence
  // Provenance links are the author's own fields, so the chain shows even where a
  // teammate's argument relations are still waiting to be accepted.
  const evidence = records.find((r) => r.kind === "node" && r.title === "29% of MATSUlab issues (n=445) were claimed as experiments" && r.prov?.observationBase);
  await s(`s.call("focus.set", ${q({ node: evidence.id })})`);
  await s(`s.openSide("context")`);
  const chain = await until(() => at("context", "text", '[data-dg="method-chain"]'));
  check("method.chain-reads-back-to-the-run", /Run/.test(chain ?? "") && /Protocol/.test(chain ?? "") && /Output/.test(chain ?? ""), (chain ?? "").slice(0, 140));
  check("method.opens-the-run", await at("context", "count", '[data-dg="method-open-run"]'));
  await shot("context-method");

  // ---------------------------------------------------------------- Ask AI with your own model
  await s(`s.call("ai.configure", ${q({ source: "own", provider: "anthropic", model: "claude-opus-5-5", key: null })})`);
  await s(`s.open(${q(canvas.id)})`);
  await click("canvas", '[data-dg="ai"]');
  const none = await until(() => at("canvas", "text", '[data-dg="ai-model-line"]'));
  check("ai.no-model-says-so", /No model/.test(none ?? ""), none);
  await click("canvas", '[data-dg="ai-setup-open"]');
  check("ai.key-form-opens-from-the-bar", await until(() => at("canvas", "count", '[data-dg="ai-key"]')));
  const kept = await at("canvas", "text", '[data-dg="ai-setup"]');
  check("ai.says-where-the-key-is-kept", /keychain/.test(kept ?? ""), (kept ?? "").slice(0, 160));
  await shot("ai-setup");
  const stub = await fetch(`${MODEL}/models`).then((r) => r.ok, () => false);
  if (stub) {
    await s(`s.call("ai.configure", ${q({ source: "own", provider: "openai", baseUrl: MODEL, model: "qwen3:8b" })})`);
    await click("canvas", '[data-dg="ai-setup-cancel"]');
    const local = await until(async () => /on this computer/.test((await at("canvas", "text", '[data-dg="ai-model-line"]')) ?? "") ? at("canvas", "text", '[data-dg="ai-model-line"]') : null);
    check("ai.local-model-line", local, local);
    await click("canvas", '[data-dg="ai-input"]');
    await typeKeys("What do the claims here rest on?");
    await key("Enter", 13);
    const answered = await until(async () => /Answered by/.test((await at("canvas", "text", '[data-dg="ai-mode"]')) ?? "") ? at("canvas", "text", '[data-dg="ai-bar"]') : null);
    check("ai.answers-with-citations", answered && (await at("canvas", "count", '[data-dg="ai-citations"] button')) >= 1, (answered ?? "").slice(0, 120));
    await shot("ai-answer");
  } else {
    console.log(`SKIP ai answer: no stand-in model at ${MODEL}`);
  }
  await key("Escape", 27);
  check("ai.escape-closes", await until(async () => ((await at("canvas", "count", '[data-dg="ai-bar"]')) ?? 1) === 0));
  await modelBack();

  // ---------------------------------------------------------------- Runs and notebooks
  if (existsSync(`${VAULT}/${NOTEBOOK}`)) {
    await s("s.openRuns()");
    check("runs.lists-the-notebook", await until(() => at("run", "count", '[data-dg^="notebook-import-"]')));
    await shot("runs");
    // Left behind: the code, run and output units this reads in. Core has no call that takes a notebook's import back,
    // and whether a run removed with node.remove is read in again by the next import hasn't been tried.
    const made = await s(`s.call("notebook.import", ${q({ ref: NOTEBOOK })})`);
    check("notebook.reads-code-run-outputs", made.run && made.outputs.length === 9, `${made.status}, ${made.outputs.length} outputs, known ${made.known}`);
    await s(`s.openRuns(${q(made.run.id)})`);
    const page = await until(() => at("run", "text", '[data-dg="run-what"]'));
    check("run.page-names-the-code", /evd1_evd7_analysis\.ipynb/.test(page ?? ""), (page ?? "").slice(0, 120));
    const figures = await until(async () => ((await at("run", "count", ".run-output img")) ?? 0) >= 1 ? at("run", "count", ".run-output img") : null);
    check("run.figures-shown-while-bytes-match", figures >= 1, `${figures} figures`);
    await shot("run-page");
    const method = await s(`s.call("process.method", ${q({ id: made.run.id })})`);
    check("run.problems-come-from-the-shapes", Array.isArray(method.problems), method.problems.map((p) => p.rule).join(", "));
  } else {
    console.log(`SKIP runs: put a notebook at ${VAULT}/${NOTEBOOK}`);
  }

  // ---------------------------------------------------------------- The reader and search
  await s(`s.open(${q(canvas.id)})`);
  await s(`s.openPdf("Paper files/preclinical-sle-mediators.pdf")`);
  check("pdf.opens-beside-the-canvas", await until(async () => ((await at("pdf", "count", ".textLayer span, canvas")) ?? 0) > 0), "");
  await sleep(2500);
  await shot("pdf-reader");
  await s(`s.call("search.show", ${q({ query: { text: "claimed" } })})`);
  const hits = await until(async () => ((await at("search", "count", "mark")) ?? 0) > 0 ? at("search", "count", "mark") : null);
  check("search.marks-found-words", hits > 0, `${hits} marks`);
  await shot("search");

  // ---------------------------------------------------------------- Settings
  // Obsidian shows settings in a window of their own, so the page is read through the tab and photographed there.
  await s("s.openSettings()");
  const tab = `app.setting.activeTab.containerEl`;
  const sections = await until(async () => {
    const found = await s(`[...${tab}.querySelectorAll(".setting-item-heading .setting-item-name")].map((el) => el.textContent)`);
    return found.length >= 6 ? found : null;
  });
  check("settings.sections", sections, (sections ?? []).join(", "));
  check("settings.fills-in", await until(async () => ((await s(`${tab}.querySelectorAll("select").length`)) ?? 0) >= 3));
  check("settings.no-key-in-the-page", !(await s(`${tab}.innerHTML.includes("sk-ant-api")`)));
  const shotSettings = (name) =>
    SHOTS
      ? s(`(async () => {
          const { BrowserWindow } = require("@electron/remote");
          const doc = ${tab}.ownerDocument;
          const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getTitle() === doc.title && doc !== document) ?? BrowserWindow.getFocusedWindow();
          const image = await win.webContents.capturePage();
          require("fs").writeFileSync(${q(OUT)} + "/" + ${q(name)} + ".png", image.toPNG());
          return win.webContents.getTitle();
        })()`)
      : null;
  await sleep(800);
  await shotSettings("settings");
  await s(`[...${tab}.querySelectorAll(".setting-item-heading")][2]?.scrollIntoView()`);
  await sleep(500);
  await shotSettings("settings-notes");
  await s("app.setting.close()");

  await s("s.closeAll()");
  await s("app.workspace.leftSplit.expand()");
} finally {
  await cleanup.run();
}
await host.finish();
writeFileSync("reports/guide/results.json", JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
