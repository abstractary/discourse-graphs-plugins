// Imports the rebuilt MATSUlab graph in a real host, then opens it on a canvas.
//   node harness/real-test.mjs obsidian|roam
// Seed first, with matsulab.mjs, in a throwaway vault or graph.
// Leaves the imported graph and the two proposals it decides, so it needs a freshly seeded vault or graph each run.
// Its canvas and the relation it makes in the panel are taken back.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam } from "./hosts.mjs";
import { q, sleep, tools } from "./lib.mjs";

const target = process.argv[2];
const OUT = resolve("reports/real");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const { s, results, check, until, clickIn, type, call, cleanup, makeCanvas } = tools(host, { wait: { timeout: 30000, every: 500, strict: true } });

try {
  await s("s.test(true)");
  const existing = await until(async () => {
    const graph = await s("s.existing()");
    return graph.nodes.length >= 140 ? graph : null;
  });
  // A link inside a real title made one more page in Roam: a citation key.
  const nodesExpected = target === "roam" ? 141 : 140;
  check("read.nodes", existing?.nodes.length === nodesExpected, existing?.nodes.length);
  check("read.grammar", existing?.nodeTypes.length === 5 && existing?.rules.length === 4, `${existing?.nodeTypes.length} types, ${existing?.rules.length} rules`);
  const storedExpected = target === "roam" ? 10 : 14;
  check("read.relations", existing?.relations.length === storedExpected, existing?.relations.length);

  const textBefore = await s("s.fingerprint()");
  const before = await s("s.summary()");
  const plan = await s("s.importExisting(true)");
  const afterPlan = await s("s.summary()");
  check("import.dry-run-writes-nothing", afterPlan.versions === before.versions && plan.nodes.added === nodesExpected, `plans ${plan.nodes.added} nodes`);

  // Left behind: the units and relations the import adds. Core has no call that takes an import back, and removing
  // them one by one with node.remove would trash the seeded notes they were read from.
  const started = Date.now();
  const report = await s("s.importExisting(false)");
  const seconds = (Date.now() - started) / 1000;
  check("import.nodes", report.nodes.added === nodesExpected && report.nodes.skipped === 0, JSON.stringify(report.nodes));
  // The same four links arrive as tentative in a vault, and as title text in Roam.
  check("import.relations", report.relations.asserted === 10 && report.relations.proposed === 4 && report.relations.skipped === 0, JSON.stringify(report.relations));
  check("import.no-problems", report.problems.length === 0, report.problems[0] ?? "");
  const again = await s("s.importExisting(false)");
  check("import.twice-adds-nothing", again.nodes.added === 0 && again.relations.asserted + again.relations.proposed === 0, JSON.stringify(again.nodes));
  check("import.text-untouched", (await s("s.fingerprint()")) === textBefore, textBefore);

  const expression = `s.core().then((core) => {
    const docs = [...core.graph().documents.values()];
    const typeOf = (id) => docs.find((d) => d.id === id);
    const nodes = docs.filter((d) => d.kind === "node").map((d) => ({ id: d.id, title: d.title, label: typeOf(d.type)?.label }));
    const relations = [...core.graph().relations.values()].map(({ record, state }) => ({ id: record.id, source: record.source, target: record.target, state }));
    return { nodes, relations };
  })`;
  const { nodes, relations } = await s(expression);
  const labelled = (label) => nodes.filter((node) => node.label === label);
  check("graph.types-kept", labelled("Result").length === 4 && labelled("Claim").length === 4 && labelled("Method").length === 4, `${labelled("Experiment").length} experiments`);
  check("graph.titles-clean", !nodes.some((node) => /^\[\[[A-Z]+\]\] - | - \[\[[^\]]+\]\]$/.test(node.title)), nodes.find((node) => node.label === "Result")?.title.slice(0, 80));

  // A real argument: what the analysis found, and what each finding rests on.
  const canvas = await makeCanvas("MATSUlab findings");
  const heightOf = (title) => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));
  const chosen = [...labelled("Result"), ...labelled("Claim")];
  const studies = new Set(relations.filter((item) => labelled("Result").some((node) => node.id === item.source) && !labelled("Claim").some((node) => node.id === item.target)).map((item) => item.target));
  const columns = [labelled("Result"), labelled("Claim"), nodes.filter((node) => studies.has(node.id))];
  const upserts = [];
  columns.forEach((column, index) => {
    let y = 0;
    for (const node of column) {
      const height = heightOf(node.title);
      upserts.push({ z: upserts.length + 1, item: { type: "text", text: node.title, x: index * 300, y, width: 240, height, dg: { node: node.id } } });
      y += height + 40;
    }
  });
  const { ids } = await call("canvas.write", { canvas: canvas.id, upserts });
  const itemOf = new Map(upserts.map((entry, index) => [entry.item.dg.node, ids[index]]));
  const edges = relations.filter((item) => itemOf.has(item.source) && itemOf.has(item.target));
  await call("canvas.write", { canvas: canvas.id, upserts: edges.map((item, index) => ({ z: 100 + index, item: { fromNode: itemOf.get(item.source), toNode: itemOf.get(item.target), dg: { relation: item.id } } })) });

  const opening = Date.now();
  await call("canvas.open", { id: canvas.id });
  const openMs = Date.now() - opening;
  await s("s.closeAll()");
  await sleep(500);
  await s(`s.open(${q(canvas.id)})`);
  await until(async () => (await s(`s.count('.card')`)) === upserts.length, 12000);
  await sleep(1500);
  check("canvas.real-cards", (await s(`s.count('.card')`)) === upserts.length, `${upserts.length} cards, ${edges.length} edges`);
  check("canvas.real-edges", (await s(`s.count('.react-flow__edge')`)) === edges.length, await s(`s.count('.react-flow__edge')`));
  const pending = relations.filter((item) => item.state === "pending").length;
  check("canvas.pending-marked", (await s(`s.count('.edge-pending')`)) === pending && pending === 4, `${pending} pending`);

  const click = (selector) => clickIn("s", selector, { timeout: 6000 });
  const clickPanel = (selector) => clickIn("s.ctx", selector, { timeout: 6000 });
  const panelText = (selector) => s(`s.ctx.text(${q(selector)})`);
  const card = (title) => `[data-dg=${q(`card-${title}`)}]`;
  const plain = (title) => title.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Tidy: real titles are long, so hand placement collides. One action fixes it.
  await click('[data-dg="tidy"]');
  await sleep(1500);
  const boxes = [];
  for (let index = 1; index <= upserts.length; index += 1) {
    boxes.push(await s(`s.locate('.react-flow__node:nth-child(${index})')`));
  }
  const collisions = boxes.filter((a, i) => boxes.some((b, j) => j > i && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)).length;
  check("tidy.no-overlaps", collisions === 0, `${collisions} overlapping`);
  await click('[data-dg="undo"]');
  await sleep(900);
  await click('[data-dg="tidy"]');
  await sleep(1500);

  await host.shot(`${OUT}/${host.name}.png`);

  // The context panel, on the same real graph.
  await click('[data-dg="open-context"]');
  await until(async () => (await s(`s.ctx.count('.ctx, .ctx-empty')`)) > 0, 9000);
  await sleep(800);
  check("context.opens-empty-handed", (await s(`s.ctx.count('.ctx, .ctx-empty')`)) === 1);
  // The panel takes room from the canvas, so bring every card back into view.
  await click('[data-dg="fit"]');
  await sleep(600);

  const [result] = labelled("Result");
  const link = relations.find((item) => item.source === result.id && labelled("Claim").some((node) => node.id === item.target));
  const claim = nodes.find((node) => node.id === link.target);
  await click(card(result.title));
  const followed = await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(result.title), 6000);
  check("context.follows-selection", followed, (await panelText('[data-dg="ctx-title"]'))?.slice(0, 80));
  check("context.groups-relations", (await s(`s.ctx.count('.ctx-group')`)) >= 2 && (await s(`s.ctx.count('[data-dg="group-Supports"]')`)) === 1, await s(`s.ctx.count('.ctx-group')`));
  check("context.shows-text", (await panelText('[data-dg="ctx-text"]'))?.length > 40, (await panelText('[data-dg="ctx-text"]'))?.slice(0, 70));

  await clickPanel(`[data-dg=${q(`row-${claim.title}`)}]`);
  const walked = await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(claim.title), 6000);
  check("context.walks-the-graph", walked);
  check("context.reads-from-this-node", (await s(`s.ctx.count('[data-dg="group-Supported by"]')`)) === 1, "incoming relation shows its complement");
  await clickPanel('[data-dg="ctx-back"]');
  check("context.back-returns", await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(result.title), 6000));

  await clickPanel('[data-dg="ctx-pin"]');
  await sleep(200);
  await click(card(claim.title));
  await sleep(900);
  check("context.pin-holds", (await panelText('[data-dg="ctx-title"]')) === plain(result.title));
  await clickPanel('[data-dg="ctx-pin"]');
  await click(card(result.title));
  await sleep(700);

  // Proposed relations wait for a person, here and on the canvas.
  const pendingOf = (node) => relations.find((item) => item.state === "pending" && item.source === node.id);
  // Left behind: one proposal accepted and one declined. A decision is a record of its own, and core has no call that takes one back.
  const proposal = pendingOf(result);
  const study = nodes.find((node) => node.id === proposal.target);
  await until(() => s(`s.ctx.locate(${q(`[data-dg=${q(`accept-${study.title}`)}]`)})`), 6000);
  await clickPanel(`[data-dg=${q(`accept-${study.title}`)}]`);
  await sleep(1000);
  check("context.accept-clears-proposal", (await s(`s.count('.edge-pending')`)) === pending - 1 && (await s(`s.ctx.count('[data-state="pending"]')`)) === 0, await s(`s.count('.edge-pending')`));

  const other = labelled("Result").find((node) => node.id !== result.id);
  await click(card(other.title));
  await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(other.title), 6000);
  const declined = nodes.find((node) => node.id === pendingOf(other).target);
  const edgesBefore = await s(`s.count('.react-flow__edge')`);
  await until(() => s(`s.ctx.locate(${q(`[data-dg=${q(`reject-${declined.title}`)}]`)})`), 6000);
  await clickPanel(`[data-dg=${q(`reject-${declined.title}`)}]`);
  await sleep(1000);
  check("context.reject-removes-edge", (await s(`s.count('.react-flow__edge')`)) === edgesBefore - 1, `${edgesBefore} to ${await s(`s.count('.react-flow__edge')`)}`);

  // Relating from the panel, with the grammar choosing the wording.
  const unrelated = labelled("Result").find((node) => node.id !== result.id && !relations.some((item) => item.source === node.id && item.target === claim.id));
  await click(card(claim.title));
  await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(claim.title), 6000);
  const supportedBefore = (await s(`s.ctx.text('[data-dg="group-Supported by"] h2')`));
  await clickPanel('[data-dg="ctx-relate"]');
  await clickPanel('[data-dg="relate-search"]');
  await type(unrelated.title.slice(0, 24));
  cleanup("the relation made in the panel", async () => {
    const made = (await call("node.view", { id: claim.id })).context.find((entry) => entry.other.id === unrelated.id && entry.state === "active");
    if (made) await call("relation.withdraw", { id: made.relation.id });
  });
  await sleep(500);
  await clickPanel(`[data-dg=${q(`relate-result-${unrelated.title}`)}]`);
  await sleep(400);
  await clickPanel('[data-dg="relate-Supported by"]');
  await sleep(900);
  check("context.relates-through-grammar", (await s(`s.ctx.text('[data-dg="group-Supported by"] h2')`)) !== supportedBefore, await s(`s.ctx.text('[data-dg="group-Supported by"] h2')`));

  // The base moves the panel too, and the panel can feed the canvas.
  const elsewhere = labelled("Experiment").find((node) => !studies.has(node.id) && node.title.length > 60);
  const anchorOf = await s(`s.core().then((core) => [...core.graph().documents.values()].find((d) => d.kind === "anchor" && d.node === ${q(elsewhere.id)})?.ref)`);
  await s(`s.focusOutside(${q(anchorOf)})`);
  const fromBase = await until(async () => (await panelText('[data-dg="ctx-title"]')) === plain(elsewhere.title), 8000);
  check("context.follows-the-base", fromBase, (await panelText('[data-dg="ctx-title"]'))?.slice(0, 70));
  await s(`s.afterFocus()`);
  await until(async () => (await s(`s.count('.card')`)) > 0, 9000);
  await sleep(1200);
  await click('[data-dg="fit"]');
  await sleep(600);
  const cardsBefore = await s(`s.count('.card')`);
  await clickPanel('[data-dg="ctx-place"]');
  await sleep(1000);
  check("context.adds-to-canvas", (await s(`s.count('.card')`)) === cardsBefore + 1, `${cardsBefore} cards before`);

  const scroll = await s("s.ctx.scroll()");
  check("context.fits-its-frame", scroll.scrollWidth <= scroll.clientWidth, `${scroll.scrollWidth}/${scroll.clientWidth}`);

  await click(card(result.title));
  await sleep(900);
  await host.shot(`${OUT}/${host.name}-context.png`);

  const passed = results.filter((item) => item.pass).length;
  console.log(`=== ${host.name}: ${passed} of ${results.length}`);
  writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ host: host.name, passed, total: results.length, importSeconds: seconds, openMs, report, canvas: canvas.id, results }, null, 2));
} finally {
  await cleanup.run();
}
await host.finish();
process.exit(results.every((item) => item.pass) ? 0 : 1);
