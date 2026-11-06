// Rebuilds the published MATSUlab records in today's plugin formats, so an
// import reads what a real install would hold. Text and links are all published.
//   node harness/matsulab.mjs obsidian <vault>
//   node harness/matsulab.mjs roam <out.js>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BUNDLES = process.env.MATSULAB_BUNDLES ?? "../org-repos/MATSUlab-issue-exchange-analysis/output/evidence_bundles";
const RECORDS = "test/fixtures/matsulab-records";

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.map((values) => Object.fromEntries(head.map((name, index) => [name, values[index] ?? ""])));
};

const uidOf = (text) => createHash("sha256").update(text).digest("base64url").replace(/[-_]/g, "x").slice(0, 9);

export const dataset = () => {
  const nodes = new Map();
  const add = (type, content, body = "") => {
    const key = `${type}:${content.toLowerCase()}`;
    if (!nodes.has(key)) nodes.set(key, { key: uidOf(key), type, content, body });
    return nodes.get(key);
  };

  const experiments = parseCsv(readFileSync(`${BUNDLES}/evd5-issue-funnel/data/experiment_details.csv`, "utf8"));
  for (const row of experiments) {
    add("experiment", row.title.replace(/^@/, ""), [
      `Created ${row.page_created}. Claimed ${row.claimed_timestamp} (${row.claim_type}).`,
      `Formal results: ${row.num_results}.${row.first_result_date ? ` First result ${row.first_result_date}.` : ""}`,
    ].join("\n"));
  }

  const relations = [];
  for (const file of readdirSync(RECORDS).filter((name) => name.endsWith(".json")).sort()) {
    const records = JSON.parse(readFileSync(join(RECORDS, file), "utf8"));
    const byUri = new Map(records.map((record) => [record.uri, record.value]));
    const of = (kind) => records.map((record) => record.value).find((value) => value.$type === `science.mira.${kind}`);
    const evidence = of("evidence");
    const [, content, study] = /^\[\[RES\]\] - (.*) - \[\[(.*)\]\]$/s.exec(evidence.title);
    const result = add("result", content, evidence.content ?? "");
    const claim = add("claim", byUri.get(evidence.observationStatement.uri).title);
    const experiment = add("experiment", study.replace(/^@/, ""));
    const activity = byUri.get(evidence.observationOriginActivity.uri);
    const protocol = byUri.get(activity.follows[0].uri);
    const method = add("method", protocol.title, protocol.content ?? "");
    const documentRecord = of("sourceDocument");
    const source = add("source", documentRecord.title, (documentRecord.sameAs ?? []).join("\n"));
    relations.push(
      { relation: "supports", source: result.key, target: claim.key },
      { relation: "derived", source: result.key, target: experiment.key, inTitle: true },
      { relation: "derived", source: experiment.key, target: method.key },
      { relation: "informs", source: source.key, target: experiment.key },
    );
    result.study = study;
  }
  const seen = new Set();
  return {
    nodes: [...nodes.values()],
    relations: relations.filter((item) => {
      const key = `${item.relation}|${item.source}|${item.target}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
};

const TYPES = {
  claim: { label: "Claim", roam: "[[CLM]] - {content}", obsidian: "CLM - {content}", color: "7DA13E" },
  result: { label: "Result", roam: "[[RES]] - {content} - {Source}", obsidian: "RES - {content}" },
  experiment: { label: "Experiment", roam: "@{content}", obsidian: "EXP - {content}" },
  method: { label: "Method", roam: "[[MTD]] - {content}", obsidian: "MTD - {content}" },
  source: { label: "Source", roam: "[[SRC]] - {content}", obsidian: "SRC - {content}" },
};
const RELATIONS = {
  supports: { roam: ["Supports", "Supported By"], obsidian: ["supports", "is supported by"] },
  derived: { roam: ["Derived From", "Has Derivation"], obsidian: ["derived from", "has derivation"] },
  informs: { roam: ["Informs", "Informed By"], obsidian: ["informs", "is informed by"] },
};
const RULES = [
  ["supports", "result", "claim"],
  ["derived", "result", "experiment"],
  ["derived", "experiment", "method"],
  ["informs", "source", "experiment"],
];

const safeName = (title) => title.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);

const seedObsidian = (vault) => {
  const { nodes, relations } = dataset();
  for (const entry of readdirSync(vault)) {
    if (entry !== ".obsidian") rmSync(join(vault, entry), { recursive: true, force: true });
  }
  const settingsDir = join(vault, ".obsidian/plugins/discourse-graph");
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, "data.json"), JSON.stringify({
    nodeTypes: Object.entries(TYPES).map(([id, type]) => ({ id, name: type.label, format: type.obsidian, ...(type.color ? { color: `#${type.color}` } : {}), created: 0, modified: 0 })),
    relationTypes: Object.entries(RELATIONS).map(([id, type]) => ({ id, label: type.obsidian[0], complement: type.obsidian[1], color: "grey", created: 0, modified: 0 })),
    discourseRelations: RULES.map(([relation, source, target], index) => ({ id: `rel${index}`, sourceId: source, destinationId: target, relationshipTypeId: relation, created: 0, modified: 0 })),
  }, null, 2));
  // A fresh folder each run: iCloud answers a quick delete and rewrite with " 2" copies.
  const folder = `Discourse Nodes ${Date.now() % 100000}`;
  mkdirSync(join(vault, folder), { recursive: true });
  for (const node of nodes) {
    const name = safeName(TYPES[node.type].obsidian.replace("{content}", node.content));
    const body = `---\nnodeTypeId: ${node.type}\nnodeInstanceId: ${node.key}\n---\n\n${node.body}\n`;
    writeFileSync(join(vault, folder, `${name}.md`), body);
  }
  const stored = Object.fromEntries(relations.map((item, index) => [`r${index}`, { id: `r${index}`, type: item.relation, source: item.source, destination: item.target, created: 0, ...(item.inTitle ? { tentative: true } : {}) }]));
  writeFileSync(join(vault, "relations.json"), JSON.stringify({ version: 1, lastModified: 0, relations: stored }, null, 2));
  return { nodes: nodes.length, relations: relations.length };
};

const seedRoam = (out) => {
  const { nodes, relations } = dataset();
  const titleOf = (node) => {
    const format = TYPES[node.type].roam.replace(" - {Source}", "");
    const title = format.replace("{content}", node.content);
    return node.study ? `${title} - [[${node.study}]]` : title;
  };
  const schema = RULES.map(([relation, source, target], index) => ({ uid: uidOf(`schema${index}`), relation, source, target }));
  const data = {
    types: Object.entries(TYPES).map(([id, type]) => ({ uid: uidOf(`type:${id}`), id, label: type.label, format: type.roam, color: type.color })),
    schema: schema.map((item) => ({
      ...item,
      label: RELATIONS[item.relation].roam[0],
      complement: RELATIONS[item.relation].roam[1],
      sourceType: uidOf(`type:${item.source}`),
      targetType: uidOf(`type:${item.target}`),
    })),
    nodes: nodes.map((node) => ({ uid: node.key, title: titleOf(node), body: node.body })),
    // A result's study is named in its title, so Roam doesn't store that link.
    stored: relations.filter((item) => !item.inTitle).map((item) => ({
      uid: uidOf(`stored:${item.relation}:${item.source}:${item.target}`),
      sourceUid: item.source,
      destinationUid: item.target,
      hasSchema: schema.find((row) => row.relation === item.relation)?.uid,
      item,
    })),
  };
  // Each stored relation points at the schema for its own pair of node types.
  const typeOfNode = new Map(nodes.map((node) => [node.key, node.type]));
  for (const row of data.stored) {
    row.hasSchema = schema.find((item) => item.relation === row.item.relation && item.source === typeOfNode.get(row.item.source) && item.target === typeOfNode.get(row.item.target)).uid;
    delete row.item;
  }
  writeFileSync(out, `(async () => {
  const data = ${JSON.stringify(data)};
  const a = window.roamAlphaAPI;
  let writes = 0;
  const pace = async (work) => {
    for (;;) {
      try { const value = await work(); writes += 1; if (writes % 200 === 0) await new Promise((r) => setTimeout(r, 400)); return value; }
      catch (error) { if (!/limit|too many/i.test(String(error))) throw error; await new Promise((r) => setTimeout(r, 2000)); }
    }
  };
  const page = (title, uid) => pace(() => a.data.page.create({ page: { title, uid } }));
  const block = (parent, string, uid) => pace(() => a.data.block.create({ location: { "parent-uid": parent, order: "last" }, block: { string, ...(uid ? { uid } : {}) } }));
  const child = async (parent, name, value) => { const uid = a.util.generateUID(); await block(parent, name, uid); await block(uid, value); };
  for (const type of data.types) {
    await page("discourse-graph/nodes/" + type.label, type.uid);
    await child(type.uid, "Format", type.format);
    if (type.color) { const canvas = a.util.generateUID(); await block(type.uid, "Canvas", canvas); await child(canvas, "color", type.color); }
  }
  const config = a.util.generateUID();
  await page("roam/js/discourse-graph", config);
  const grammar = a.util.generateUID();
  await block(config, "grammar", grammar);
  const relationsNode = a.util.generateUID();
  await block(grammar, "relations", relationsNode);
  for (const row of data.schema) {
    await block(relationsNode, row.label, row.uid);
    await child(row.uid, "Source", row.sourceType);
    await child(row.uid, "Destination", row.targetType);
    await child(row.uid, "complement", row.complement);
  }
  // A [[link]] in an earlier title may already have made this page.
  const actual = new Map();
  for (const node of data.nodes) {
    const made = a.data.fast.q("[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]", node.title)[0]?.[0];
    if (!made) await page(node.title, node.uid);
    const uid = made ?? node.uid;
    actual.set(node.uid, uid);
    for (const line of node.body.split("\\n").filter(Boolean)) await block(uid, line);
  }
  const storedPage = a.util.generateUID();
  await page("roam/js/discourse-graph/relations", storedPage);
  for (const row of data.stored) {
    await block(storedPage, row.uid, row.uid);
    await pace(() => a.data.block.update({ block: { uid: row.uid, props: { "discourse-graph": { sourceUid: actual.get(row.sourceUid), destinationUid: actual.get(row.destinationUid), hasSchema: row.hasSchema } } } }));
  }
  return JSON.stringify({ writes, nodes: data.nodes.length, stored: data.stored.length });
})()
`);
  return { nodes: nodes.length, relations: relations.length, stored: data.stored.length };
};

if (process.argv[1]?.endsWith("matsulab.mjs")) {
  const [, , where, target] = process.argv;
  console.log(JSON.stringify(where === "roam" ? seedRoam(target) : seedObsidian(target)));
}
