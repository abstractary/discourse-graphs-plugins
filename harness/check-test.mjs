// Sign-off in real Obsidian: a unit is signed from the Context panel, its card and its note say so, and
// the mark reads as made on an earlier version once the unit is reworded. Then the canvas goes out as a
// lab-notebook file with the run as an entry and the sign-off as its comment.
//   npm run build:test, then: node harness/check-test.mjs
// Puts the vault back as it found it.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const RUN = String(Date.now()).slice(-5);
const TITLE = `Blot of knockout and wild type ${RUN}`;

const t = await session({ out: resolve("reports/check"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, type, call } = t;
await s("s.test(true)");
for (const canvas of (await call("canvas.list")).filter((item) => /^Sign-off \d{5}$/.test(item.title))) await call("canvas.remove", { id: canvas.id }).catch(() => undefined);
for (const unit of await call("node.query", { text: "Blot of knockout and wild type", limit: 50 })) await call("node.remove", { id: unit.id }).catch(() => undefined);

const grammar = await call("grammar.get");
const runType = grammar.nodeTypes.find((item) => item.base === "run");
const board = await call("canvas.create", { title: `Sign-off ${RUN}` });
const unit = await call("node.create", { title: TITLE, type: runType.id });
await call("units.export", { nodes: [unit.id], target: { kind: "canvas", id: board.id } });
await s("s.closeAll()");
await s(`s.open(${q(board.id)})`);
await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) === 1, 8000);
await call("focus.set", { node: unit.id });
await s('s.openSide("context")');

// ---------------------------------------------------------------- Signing
check("context.says-no-one-has-checked", await until(async () => /No one has checked this yet/.test((await at("context", "text", '[data-dg="ctx-checks"]')) ?? ""), 8000), await at("context", "text", '[data-dg="ctx-checks"]'));
const locate = (selector) => until(() => at("context", "locate", selector), 6000);
const press = async (selector) => {
  await s(`s.at("context", "locate", ${JSON.stringify(selector)})`);
  const box = await locate(selector);
  if (!box) throw new Error(`Couldn't find ${selector} in Context`);
  await t.clickAt(box.x + box.width / 2, box.y + box.height / 2);
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

// ---------------------------------------------------------------- Put the vault back
await call("node.remove", { id: unit.id }).catch((error) => note(`couldn't remove the unit: ${error}`));
await call("canvas.remove", { id: board.id }).catch((error) => note(`couldn't remove the canvas: ${error}`));
await sleep(400);
rmSync(eln, { force: true });
process.exit(await t.finish("check"));
