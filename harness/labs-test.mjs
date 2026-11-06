// Two labs, one in each base, sharing work. Each sees its own people, and the other's lab.
//   node harness/labs-test.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam, sleep } from "./hosts.mjs";

const OUT = resolve("reports/labs");
mkdirSync(OUT, { recursive: true });
const ob = obsidian();
const ro = await roam();
const q = JSON.stringify;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 170)}` : ""}`);
};
const until = async (work, timeout = 9000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work();
    if (value || Date.now() > deadline) return value;
    await sleep(250);
  }
};

const stamp = Date.now() % 1000000;
const sides = [
  { host: ob, person: "Ana Ruiz", lab: `Obsidian Lab ${stamp}`, title: `Actin scales with tension ${stamp}` },
  { host: ro, person: "Ben Okafor", lab: `Roam Lab ${stamp}`, title: `Myosin sets the pace ${stamp}` },
];

for (const side of sides) {
  const s = side.host.slice;
  await s("s.test(true)");
  await s("s.closeAll()");
  await sleep(500);
  await s(`s.core().then(async (core) => { await core.setName(${q(side.person)}); await core.createLab(${q(side.lab)}); })`);
  const grammar = await s(`s.call("grammar.get", {})`);
  side.type = grammar.nodeTypes.find((type) => type.base === "claim").id;
  side.node = await s(`s.call("node.create", ${q({ title: side.title, type: side.type })})`);
  side.did = await s(`s.core().then((core) => core.identity().did)`);
  check(`${side.host.name}.own-work-credits-the-person`, side.node.credit.kind === "person" && side.node.credit.name === side.person, q(side.node.credit));
}

// Only what the other side needs: each record stays a record, with its lab and author.
const shared = (side) => side.host.slice(`s.exportRecords().then((records) => records.filter((record) => record.id === ${q(side.node.id)} || record.id === ${q(side.type)} || record.kind === "lab" || record.kind === "person"))`);
const [fromOb, fromRo] = [await shared(sides[0]), await shared(sides[1])];
await sides[1].host.slice(`s.importRecords(${q(fromOb)})`);
await sides[0].host.slice(`s.importRecords(${q(fromRo)})`);
await sleep(2500);

for (const [mine, theirs] of [[sides[0], sides[1]], [sides[1], sides[0]]]) {
  const s = mine.host.slice;
  const name = mine.host.name;
  const seen = await until(() => s(`s.call("node.query", ${q({ text: theirs.title, limit: 1 })}).then((list) => list[0] ?? null)`));
  check(`${name}.shared-work-arrives`, seen, seen?.title);
  check(`${name}.shared-work-credits-the-other-lab`, seen?.credit.kind === "lab" && seen?.credit.name === theirs.lab, q(seen?.credit));

  const canvas = await s(`s.call("canvas.create", ${q({ title: `Across labs ${stamp}` })})`);
  await s(`s.call("canvas.write", ${q({
    canvas: canvas.id,
    upserts: [mine.node, seen].map((node, index) => ({ z: index + 1, item: { type: "text", text: node.title, x: index * 320, y: 0, width: 240, height: 90, dg: { node: node.id } } })),
  })})`);
  await s(`s.open(${q(canvas.id)})`);
  await until(async () => (await s(`s.count('.card')`)) === 2, 9000);
  await sleep(1200);

  const mark = (title) => q(`[data-dg="credit-${title}"]`);
  const initials = (text) => text.split(/\s+/).filter(Boolean);
  const own = await s(`s.text(${mark(mine.title)})`);
  const other = await s(`s.text(${mark(theirs.title)})`);
  const [first, ...rest] = initials(mine.person);
  check(`${name}.card-shows-its-contributor`, own === `${first[0]}${rest[rest.length - 1][0]}`, own);
  check(`${name}.card-shows-the-other-lab`, (await s(`s.count('.mark[data-kind="lab"]')`)) === 1 && other.length === 2, other);
  check(`${name}.person-is-round-and-lab-is-square`, (await s(`s.style('.mark[data-kind="person"]', "border-radius")`)) === "50%" && (await s(`s.style('.mark[data-kind="lab"]', "border-radius")`)) === "3px");
  await mine.host.shot(`${OUT}/${name}.png`);
  mine.canvas = canvas.id;

  // The other lab reads as one group, not as a stranger's name.
  const groups = await s(`s.call("canvas.open", ${q({ id: canvas.id })}).then((view) => Object.values(view.nodes).map((node) => node.credit.name).sort())`);
  check(`${name}.people-mode-would-group-by-lab`, groups.includes(theirs.lab) && groups.includes(mine.person), q(groups));
  await s("s.closeAll()");
}

await ob.finish();
await ro.finish();
const passed = results.filter((result) => result.pass).length;
console.log(`=== labs: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/labs.json`, JSON.stringify({ passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
