// Sign-off in real Obsidian: a unit is signed from the Context panel, its card and its note say so, and
// the mark reads as made on an earlier version once the unit is reworded. Then the canvas goes out as a
// lab-notebook file with the run as an entry and the sign-off as its comment.
//   npm run build:test, then: node harness/check-test.mjs
// Leaves nothing: the canvas, the unit with its note and sign-off, and the notebook file are taken back.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const RUN = String(Date.now()).slice(-5);
const TITLE = `Blot of knockout and wild type ${RUN}`;

const t = await session({ out: resolve("reports/check"), reload: !process.env.DG_NO_RELOAD });
const { s, check, until, shot, at, clickIn, has, type, call, cleanup, makeUnit, makeCanvas } = t;
try {
  await s("s.test(true)");
  // A run from before the cleanups were kept in a list may have left these.
  for (const canvas of (await call("canvas.list")).filter((item) => /^Sign-off \d{5}$/.test(item.title))) await call("canvas.remove", { id: canvas.id }).catch(() => undefined);
  for (const unit of await call("node.query", { text: "Blot of knockout and wild type", limit: 50 })) await call("node.remove", { id: unit.id }).catch(() => undefined);

  const grammar = await call("grammar.get");
  const runType = grammar.nodeTypes.find((item) => item.base === "run");
  const board = await makeCanvas(`Sign-off ${RUN}`);
  const unit = await makeUnit({ title: TITLE, type: runType.id });
  await call("units.export", { nodes: [unit.id], target: { kind: "canvas", id: board.id } });
  await s("s.closeAll()");
  await s(`s.open(${q(board.id)})`);
  await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) === 1, 8000);
  await call("focus.set", { node: unit.id });
  await s('s.openSide("context")');

  // ---------------------------------------------------------------- Signing
  check("context.says-no-one-has-checked", await until(async () => /No one has checked this yet/.test((await at("context", "text", '[data-dg="ctx-checks"]')) ?? ""), 8000), await at("context", "text", '[data-dg="ctx-checks"]'));
  const press = async (selector) => {
    await at("context", "locate", selector);
    await clickIn((wanted) => at("context", "locate", wanted), selector, { timeout: 6000 });
  };
  await press('[data-dg="ctx-check"]');
  await until(() => has("context", '[data-dg="ctx-check-form"]'), 4000);
  await press('[data-dg="ctx-check-note"]');
  await type("Lanes match the notebook");
  await shot("01-signing-a-run");
  await press('[data-dg="ctx-check-send"]');
  const signed = await until(async () => /Signed by its author/.test((await at("context", "text", '[data-dg="ctx-checks"]')) ?? "") && at("context", "text", '[data-dg="ctx-checks"]'), 8000);
  check("context.shows-the-signature", Boolean(signed) && /Lanes match the notebook/.test(signed || ""), String(signed));
  check("card.shows-it-is-checked", await until(() => has("canvas", `[data-dg="check-${TITLE}"][data-state="checked"]`), 8000));
  const file = `${VAULT}/RUN - ${TITLE}.md`;
  const marked = await until(async () => existsSync(file) && /dg-checked: Checked/.test(readFileSync(file, "utf8")), 10000);
  check("note.carries-checked-for-tables", Boolean(marked), existsSync(file) ? readFileSync(file, "utf8").slice(0, 300) : "no note");
  await shot("02-signed");

  // ---------------------------------------------------------------- The notebook file
  const made = await call("crate.export", { canvas: board.id, format: "eln" });
  const eln = `${VAULT}/${made.where}`;
  cleanup("the notebook file", () => rmSync(eln, { force: true }));
  check("eln.is-saved", existsSync(eln), made.where);
  if (existsSync(eln)) {
    const root = execFileSync("unzip", ["-Z1", eln]).toString().split("\n")[0].split("/")[0];
    const metadata = JSON.parse(execFileSync("unzip", ["-p", eln, `${root}/ro-crate-metadata.json`], { maxBuffer: 64e6 }).toString());
    const byId = new Map(metadata["@graph"].map((node) => [node["@id"], node]));
    const entries = byId.get("./").hasPart.map((part) => byId.get(part["@id"]));
    const experiment = entries.find((entry) => entry.genre === "experiment");
    check("eln.lists-the-run-as-an-experiment", experiment?.name === TITLE && entries.every((entry) => entry["@type"] === "Dataset"), entries.map((entry) => `${entry.genre}: ${entry.name}`).join(" | "));
    const comment = experiment?.comment?.[0] ? byId.get(experiment.comment[0]["@id"]) : null;
    check("eln.carries-the-sign-off-as-a-comment", /Signed by its author.*Lanes match the notebook/.test(comment?.text ?? ""), comment?.text);
  }

  // ---------------------------------------------------------------- A mark holds for the words it was made on
  await call("node.rename", { id: unit.id, title: `${TITLE}, repeated` });
  const stale = await until(() => has("context", '[data-dg="ctx-check-stale"]'), 10000);
  check("context.says-the-unit-changed-since", stale, await at("context", "text", '[data-dg="ctx-checks"]'));
  check("card.shows-it-changed", await until(() => has("canvas", `[data-dg="check-${TITLE}, repeated"][data-state="changed"]`), 8000));
  await sleep(300);
  await shot("03-changed-since-it-was-checked");
} finally {
  await cleanup.run();
}
process.exit(await t.finish("check"));
