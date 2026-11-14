// Types and relations in real Obsidian: add a type from the dialog with a template, see its note start
// from it, open the base's own table of a type, read a schema file back, and remove a canvas.
//   npm run build:test, then: node harness/grammar-test.mjs
// Leaves the vault as it found it, apart from the table file for Claim.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const NAME = `Hypothesis ${String(Date.now()).slice(-5)}`;

const t = await session({ out: resolve("reports/grammar"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, click, type, call } = t;
await s("s.test(true)");
const dialog = (method, selector) => s(`s.dialog.${method}(${JSON.stringify(selector)})`);
const clickIn = async (selector) => {
  const box = await until(() => dialog("locate", selector), 6000);
  if (!box) throw new Error(`Couldn't find ${selector} in the dialog`);
  await t.clickAt(box.x + box.width / 2, box.y + box.height / 2);
};

const canvasesBefore = new Set((await call("canvas.list")).map((item) => item.id));
// ---------------------------------------------------------------- The dialog
await call("dialog.open", { surface: "grammar" });
check("dialog.opens", await until(() => dialog("count", '[data-dg="grammar-types"]'), 8000));
const before = await call("grammar.get");
check("dialog.lists-every-type", (await dialog("count", '[data-dg="grammar-types"] li')) === before.nodeTypes.length, `${before.nodeTypes.length} types`);
await clickIn('[data-dg="grammar-add-type"]');
await until(() => dialog("count", '[data-dg="grammar-type-form"]'));
await clickIn('[data-dg="grammar-type-name"]');
await type(NAME);
await s(`s.dialog.choose('[data-dg="grammar-type-base"]', "claim")`);
await clickIn('[data-dg="grammar-type-short"]');
await type("hyp");
await clickIn('[data-dg="grammar-type-starter"]');
await sleep(200);
check("dialog.starter-fills-the-template", /What would change my mind/.test((await dialog("value", '[data-dg="grammar-type-template"]')) ?? ""));
await shot("01-add-a-type");
await clickIn('[data-dg="grammar-type-save"]');
const said = await until(async () => ((await dialog("text", '[data-dg="grammar-said"]')) ?? "").includes("Saved") && dialog("text", '[data-dg="grammar-said"]'), 6000);
check("dialog.saves-the-type", Boolean(said), String(said));
const made = (await call("grammar.get")).nodeTypes.find((item) => item.label === NAME);
check("type.is-a-claim-with-its-template", made?.base === "claim" && made.abbreviation === "HYP" && /What would change my mind/.test(made.template ?? ""), JSON.stringify(made)?.slice(0, 200));
check("dialog.offers-a-table", (await dialog("count", '[data-dg="grammar-type-table"]')) === 1);

// A relation, with what it may join.
await clickIn('[data-dg="grammar-relation-Supports"]');
await until(() => dialog("count", '[data-dg="grammar-relation-form"]'));
check("dialog.shows-what-a-relation-joins", ((await dialog("count", '[data-dg="grammar-rules"] li')) ?? 0) >= 2, await dialog("text", '[data-dg="grammar-rules"]'));
await shot("02-a-relation");

// ---------------------------------------------------------------- A unit of the new type
let unit;
if (made) {
  unit = await call("node.create", { title: "Load sets the rate", type: made.id });
  await call("units.export", { nodes: [unit.id], target: { kind: "workspace" } });
  const file = `${VAULT}/HYP - Load sets the rate.md`;
  check("note.is-made", await until(async () => existsSync(file), 8000), file);
  const text = await until(async () => existsSync(file) && /dg-type:/.test(readFileSync(file, "utf8")) && readFileSync(file, "utf8"), 8000);
  check("note.starts-from-the-template", /## The claim/.test(text || "") && /## What would change my mind/.test(text || ""), String(text).slice(0, 300));
  check("note.carries-its-type-and-date", new RegExp(`dg-type: ${NAME}`).test(text || "") && /dg-made: "?\d{4}-\d{2}-\d{2}/.test(text || "") && /dg-by: /.test(text || ""), String(text).slice(0, 300));
}

// ---------------------------------------------------------------- The base's own table
await call("dialog.close");
const claim = before.nodeTypes.find((item) => item.label === "Claim");
const table = await call("table.open", { type: claim.id });
check("table.file-is-made", existsSync(`${VAULT}/${table.where}`), table.where);
const yaml = existsSync(`${VAULT}/${table.where}`) ? readFileSync(`${VAULT}/${table.where}`, "utf8") : "";
check("table.filters-on-the-type", /note\["dg-type"\] == "Claim"/.test(yaml) && /note\.dg-made/.test(yaml), yaml.slice(0, 200));
const rows = await until(() => s(`document.querySelectorAll('.bases-view .bases-tr, .bases-view .bases-table-row, .bases-view [role="row"]').length`).then((count) => (count > 1 ? count : 0)), 10000);
check("table.shows-claims", Boolean(rows), `${rows} rows in Obsidian's own table`);
await sleep(600);
await shot("03-table-of-claims");

// ---------------------------------------------------------------- A schema file, out and back
const saved = await call("grammar.export");
const schema = `${VAULT}/${saved.where}`;
check("schema.is-saved", existsSync(schema), saved.where);
const file = existsSync(schema) ? JSON.parse(readFileSync(schema, "utf8")) : { nodeTypes: [] };
check("schema.names-the-new-type", file.nodeTypes.some((item) => item.label === NAME && item.base === "claim"), `${file.nodeTypes.length} types`);
const again = await call("grammar.import", { ref: saved.where });
check("schema.reads-back-with-nothing-new", again.nodeTypes === 0 && again.relationTypes === 0 && again.rules === 0, JSON.stringify(again));

// ---------------------------------------------------------------- A canvas goes, its units stay
const scratch = await call("canvas.create", { title: `Scratch ${NAME}` });
await call("canvas.place", { canvas: scratch.id, node: unit?.id }).catch(() => undefined);
await call("canvas.remove", { id: scratch.id });
check("canvas.is-removed", !(await call("canvas.list")).some((item) => item.id === scratch.id));
check("canvas.note-is-gone", !readdirSync(VAULT).some((name) => name.includes(`Scratch ${NAME}`)));

// ---------------------------------------------------------------- Put the vault back
if (made) {
  await assertRefused();
  if (unit) await call("node.remove", { id: unit.id }).catch((error) => note(`couldn't remove the test unit: ${error}`));
  await sleep(400);
  await call("grammar.removeNodeType", { id: made.id }).catch((error) => note(`couldn't remove the test type: ${error}`));
  check("type.is-no-longer-offered", !(await call("grammar.get")).nodeTypes.some((item) => item.id === made.id));
}
// Giving the test unit a note made a personal canvas if there wasn't one. It goes too.
for (const canvas of await call("canvas.list")) if (!canvasesBefore.has(canvas.id)) await call("canvas.remove", { id: canvas.id }).catch(() => undefined);
rmSync(schema, { force: true });
rmSync(`${VAULT}/HYP - Load sets the rate.md`, { force: true });

async function assertRefused() {
  const refused = await call("grammar.removeNodeType", { id: made.id }).then(() => "", (error) => String(error));
  check("type.in-use-cannot-be-removed", /1 u(nit has this type)?/.test(refused), refused);
}

process.exit(await t.finish("grammar"));
