import {
  assertRelation,
  createAnchor,
  createNode,
  createNodeType,
  createRelationType,
  parseTitle,
  revise,
  type AnchorRecord,
  type Author,
  type BaseNodeType,
  type BaseRelationType,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type HostRef,
  type NodeTypeRecord,
  type RelationRule,
  type RelationTypeRecord,
  type SpaceId,
} from "@dg/contract/records.ts";
import { unitIdOf } from "@dg/contract/atproto.ts";
import { splitUnitId } from "@dg/contract/ids.ts";

/** What an adapter reads out of today's plugin. Keys are that plugin's own ids. */
export type ExistingGraph = {
  nodeTypes: { key: string; label: string; format: string; color?: string }[];
  relationTypes: { key: string; label: string; complement: string; color?: string }[];
  rules: { relation: string; source: string; target: string }[];
  /** `createdAt` is when the text first appeared, so a timeline tells the truth. */
  nodes: { key: string; ref: HostRef; title: string; type: string; createdAt?: string }[];
  relations: { relation: string; source: string; target: string; tentative?: boolean }[];
};

export type ImportReport = {
  nodeTypes: { matched: number; added: number };
  relationTypes: { matched: number; added: number };
  nodes: { known: number; added: number; skipped: number };
  relations: { known: number; asserted: number; proposed: number; skipped: number };
  problems: string[];
};

const NODE_BASES: Record<string, BaseNodeType> = {
  QUE: "question",
  ISS: "question",
  CLM: "claim",
  HYP: "claim",
  CON: "claim",
  EVD: "evidence",
  RES: "evidence",
  SRC: "source",
  // An experiment is a designed investigation; a method is a reusable protocol.
  EXP: "study",
  MTD: "protocol",
};

/** Lab types with their own MIRA record. The rest follow their base type. */
const NODE_LEXICONS: Record<string, string> = {
  ISS: "science.mira.request",
};

const RELATION_BASES: Record<string, BaseRelationType> = {
  supports: "supports",
  opposes: "opposes",
  addresses: "addresses",
  informs: "informs",
  "derived from": "derivedFrom",
  "interpreted as": "derivedFrom",
  "curated to": "derivedFrom",
};

/** Decision 3: a title holds content only, so `{Source}` becomes a relation. */
const contentFormat = (format: string): string =>
  format.replace(/\s-\s\{(?!content\})[^}]+\}\s*$/, "");

const abbreviationOf = (format: string, label: string): string =>
  /^\[\[([A-Za-z]+)\]\]/.exec(format)?.[1] ??
  /^([A-Z]{2,})\s-\s/.exec(format)?.[1] ??
  label.slice(0, 3).toUpperCase();

const POSSIBLY_SOURCED = /^(.*\S) - \[\[(.+)\]\]$/s;

const PROBLEM_LIMIT = 20;

/**
 * Plans the records for a graph as today's plugins store it. It writes nothing,
 * and it never touches text: every record is additive, so running it twice is safe.
 */
export const planImport = ({
  existing,
  graph,
  space,
  by,
}: {
  existing: ExistingGraph;
  graph: FoldedGraph;
  space: SpaceId;
  by: Author;
}): { records: DgRecord[]; report: ImportReport } => {
  const stamp = { space, by };
  const records: DgRecord[] = [];
  const report: ImportReport = {
    nodeTypes: { matched: 0, added: 0 },
    relationTypes: { matched: 0, added: 0 },
    nodes: { known: 0, added: 0, skipped: 0 },
    relations: { known: 0, asserted: 0, proposed: 0, skipped: 0 },
    problems: [],
  };
  const problem = (text: string): void => {
    if (report.problems.length < PROBLEM_LIMIT) report.problems.push(text);
  };

  const documents = [...graph.documents.values()];
  const nodeTypesHere = documents.filter((item): item is NodeTypeRecord => item.kind === "node-type");
  const relationTypesHere = documents.filter(
    (item): item is RelationTypeRecord => item.kind === "relation-type",
  );

  const nodeTypeOf = new Map<string, NodeTypeRecord>();
  for (const type of existing.nodeTypes) {
    const format = contentFormat(type.format);
    const here = nodeTypesHere.find((item) => item.label.toLowerCase() === type.label.toLowerCase());
    if (here) {
      report.nodeTypes.matched += 1;
      const next = here.titleFormat === format && (!type.color || here.color === type.color)
        ? here
        : revise({
            record: here,
            changes: { titleFormat: format, ...(type.color ? { color: type.color } : {}) },
            by,
          });
      if (next !== here) records.push(next);
      nodeTypeOf.set(type.key, next);
      continue;
    }
    const abbreviation = abbreviationOf(format, type.label);
    const base = NODE_BASES[abbreviation];
    const created = createNodeType({
      ...stamp,
      fields: {
        label: type.label,
        abbreviation,
        titleFormat: format,
        ...(base ? { base } : {}),
        ...(type.color ? { color: type.color } : {}),
        ...(NODE_LEXICONS[abbreviation] ? { lexicon: NODE_LEXICONS[abbreviation] } : {}),
      },
    });
    report.nodeTypes.added += 1;
    records.push(created);
    nodeTypeOf.set(type.key, created);
  }

  // Roam keeps one schema block per pair of node types, so a label can repeat.
  const groups = new Map<string, { label: string; complement: string; color?: string; keys: string[]; rules: RelationRule[] }>();
  for (const type of existing.relationTypes) {
    const key = type.label.toLowerCase();
    const group = groups.get(key) ?? {
      label: type.label,
      complement: type.complement,
      ...(type.color ? { color: type.color } : {}),
      keys: [],
      rules: [],
    };
    group.keys.push(type.key);
    groups.set(key, group);
  }
  for (const { relation, source, target } of existing.rules) {
    const group = [...groups.values()].find((item) => item.keys.includes(relation));
    const from = nodeTypeOf.get(source);
    const to = nodeTypeOf.get(target);
    if (!group || !from || !to) {
      problem(`A relation rule names something that doesn't exist: ${relation}`);
      continue;
    }
    group.rules.push({ source: from.id, target: to.id });
  }

  const relationTypeOf = new Map<string, RelationTypeRecord>();
  for (const [key, group] of groups) {
    const base = RELATION_BASES[key];
    const here = relationTypesHere.find(
      (item) => item.label.toLowerCase() === key || (base !== undefined && item.base === base),
    );
    let record: RelationTypeRecord;
    if (here) {
      report.relationTypes.matched += 1;
      const missing = group.rules.filter(
        (rule) => !here.rules.some((old) => old.source === rule.source && old.target === rule.target),
      );
      record = missing.length === 0
        ? here
        : revise({ record: here, changes: { rules: [...here.rules, ...missing] }, by });
      if (record !== here) records.push(record);
    } else {
      record = createRelationType({
        ...stamp,
        fields: {
          label: group.label,
          complement: group.complement,
          rules: group.rules,
          ...(base ? { base } : {}),
          ...(group.color ? { color: group.color } : {}),
        },
      });
      report.relationTypes.added += 1;
      records.push(record);
    }
    for (const typeKey of group.keys) relationTypeOf.set(typeKey, record);
  }

  const anchors = new Map<HostRef, AnchorRecord>();
  for (const item of documents) if (item.kind === "anchor") anchors.set(item.ref, item);

  const nodeOf = new Map<string, DgId>();
  const nodeOfTitle = new Map<string, DgId>();
  const sources: { node: DgId; title: string }[] = [];
  const refsSeen = new Set<HostRef>();
  for (const node of existing.nodes) {
    // Sync tools make copies of a note, id included. The first one stands.
    if (refsSeen.has(node.ref)) {
      report.nodes.skipped += 1;
      problem(`"${node.title}" repeats the id of another note, so it looks like a copy`);
      continue;
    }
    refsSeen.add(node.ref);
    const type = nodeTypeOf.get(node.type);
    if (!type) {
      report.nodes.skipped += 1;
      problem(`"${node.title}" has an unknown node type`);
      continue;
    }
    const known = anchors.get(node.ref);
    if (known) {
      report.nodes.known += 1;
      nodeOf.set(node.key, known.node);
      nodeOfTitle.set(node.title, known.node);
      continue;
    }
    const parsed = type.titleFormat
      ? (parseTitle({ format: type.titleFormat, title: node.title }) ?? node.title)
      : node.title;
    const sourced = POSSIBLY_SOURCED.exec(parsed);
    const created = createNode({
      ...stamp,
      title: sourced?.[1] ?? parsed,
      type: type.id,
      ...(node.createdAt ? { at: node.createdAt } : {}),
    });
    records.push(created, createAnchor({ ...stamp, node: created.id, ref: node.ref }));
    report.nodes.added += 1;
    nodeOf.set(node.key, created.id);
    nodeOfTitle.set(node.title, created.id);
    if (sourced?.[2]) sources.push({ node: created.id, title: sourced[2] });
  }

  const seen = new Set(
    [...graph.relations.values()].map(({ record }) => `${record.type}|${record.source}|${record.target}`),
  );
  const add = (type: DgId, source: DgId, target: DgId, proposed: boolean): void => {
    const key = `${type}|${source}|${target}`;
    if (seen.has(key)) {
      report.relations.known += 1;
      return;
    }
    seen.add(key);
    records.push(assertRelation({ ...stamp, type, source, target, ...(proposed ? { proposed } : {}) }));
    if (proposed) report.relations.proposed += 1;
    else report.relations.asserted += 1;
  };

  for (const relation of existing.relations) {
    const type = relationTypeOf.get(relation.relation);
    const source = nodeOf.get(relation.source);
    const target = nodeOf.get(relation.target);
    if (!type || !source || !target) {
      report.relations.skipped += 1;
      problem(`A relation has a missing end or type: ${relation.relation}`);
      continue;
    }
    add(type.id, source, target, relation.tentative === true);
  }

  // A pattern isn't anyone's assertion (decision 4), so these wait for a person.
  const derived =
    [...relationTypeOf.values()].find((type) => type.base === "derivedFrom") ??
    relationTypesHere.find((type) => type.base === "derivedFrom");
  for (const { node, title } of sources) {
    const target = nodeOfTitle.get(title);
    if (!derived || !target) {
      report.relations.skipped += 1;
      problem(`"${title}" is named in a title but isn't a node`);
      continue;
    }
    add(derived.id, node, target, true);
  }

  return { records, report };
};

type AtInput = { uri: string; value: Record<string, unknown> };
type Ref = { uri: string };

/** MIRA collections our default grammar has no type for. */
const EXTRA_TYPES: Record<string, { label: string; abbreviation: string; base: BaseNodeType }> = {
  // MIRA's Study is one activity that produced evidence: DG's Run.
  "science.mira.study": { label: "Run", abbreviation: "RUN", base: "run" },
  "science.mira.protocol": { label: "Protocol", abbreviation: "PRO", base: "protocol" },
  "science.mira.request": { label: "Request", abbreviation: "REQ", base: "question" },
};
const MIRA_BASES: Record<string, BaseNodeType> = {
  "science.mira.question": "question",
  "science.mira.claim": "claim",
  "science.mira.evidence": "evidence",
  "science.mira.sourceDocument": "source",
};

/** How MIRA's inline references read as reified relations. */
const INLINE: { field: string; base: BaseRelationType }[] = [
  { field: "observationStatement", base: "supports" },
  { field: "supports", base: "supports" },
  { field: "opposes", base: "opposes" },
  { field: "addresses", base: "addresses" },
  { field: "isGroundedIn", base: "derivedFrom" },
  { field: "observationOriginActivity", base: "derivedFrom" },
  { field: "follows", base: "derivedFrom" },
  { field: "describesActivity", base: "informs" },
];
const PREDICATES: Record<string, BaseRelationType> = {
  supports: "supports",
  opposes: "opposes",
  addresses: "addresses",
  informs: "informs",
  derivedFrom: "derivedFrom",
  isGroundedIn: "derivedFrom",
  observationStatement: "supports",
  observationOriginActivity: "derivedFrom",
  follows: "derivedFrom",
  describesActivity: "informs",
};

/**
 * Reads AT records from anyone's repo. Each keeps the author's DID in its id, and
 * lands in a space named for that DID, so their relations wait as pending here.
 */
export const planAtImport = ({
  records,
  graph,
  space,
  by,
}: {
  records: AtInput[];
  graph: FoldedGraph;
  space: SpaceId;
  by: Author;
}): DgRecord[] => {
  const out: DgRecord[] = [];
  const documents = [...graph.documents.values()];
  const nodeTypes = documents.filter((item): item is NodeTypeRecord => item.kind === "node-type");
  const relationTypes = documents.filter(
    (item): item is RelationTypeRecord => item.kind === "relation-type",
  );

  const typeFor = (collection: string): DgId | undefined => {
    const known = nodeTypes.find((type) => type.lexicon === collection);
    if (known) return known.id;
    const base = MIRA_BASES[collection];
    if (base) return nodeTypes.find((type) => type.base === base && !type.lexicon)?.id;
    const extra = EXTRA_TYPES[collection];
    if (!extra) return undefined;
    const created = createNodeType({
      space,
      by,
      fields: { label: extra.label, abbreviation: extra.abbreviation, base: extra.base, lexicon: collection },
    });
    nodeTypes.push(created);
    out.push(created);
    return created.id;
  };

  const known = new Set<DgId>();
  for (const { uri, value } of records) {
    const collection = uri.replace("at://", "").split("/")[1] ?? "";
    if (collection === "science.mira.relation" || !collection.startsWith("science.mira.")) continue;
    const id = unitIdOf(uri);
    if (graph.documents.has(id) || known.has(id)) continue;
    known.add(id);
    const { did } = splitUnitId(id);
    const type = typeFor(collection);
    const raw = String(value.title ?? "");
    const sourced = POSSIBLY_SOURCED.exec(raw.replace(/^\[\[[A-Z]+\]\] - /, ""));
    out.push({
      ...createNode({
        space: did,
        by: { id: did, name: did },
        at: String(value.createdAt ?? new Date().toISOString()),
        title: sourced?.[1] ?? raw.replace(/^\[\[[A-Z]+\]\] - /, ""),
        ...(type ? { type } : {}),
      }),
      id,
    });
  }

  const typeId = (base: BaseRelationType): DgId | undefined =>
    relationTypes.find((type) => type.base === base)?.id;
  const seen = new Set(
    [...graph.relations.values()].map(({ record }) => `${record.type}|${record.source}|${record.target}`),
  );
  const relate = (base: BaseRelationType | undefined, from: DgId, to: DgId, did: string): void => {
    const type = base ? typeId(base) : undefined;
    if (!type || !known.has(to) || !known.has(from)) return;
    const key = `${type}|${from}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(assertRelation({ space: did, by: { id: did, name: did }, type, source: from, target: to }));
  };
  for (const { uri, value } of records) {
    const from = unitIdOf(uri);
    const { did } = splitUnitId(from);
    if (uri.includes("/science.mira.relation/")) {
      relate(
        PREDICATES[String(value.predicate)],
        unitIdOf((value.source as Ref).uri),
        unitIdOf((value.destination as Ref).uri),
        did,
      );
      continue;
    }
    for (const { field, base } of INLINE) {
      const refs = value[field];
      for (const ref of (Array.isArray(refs) ? refs : refs ? [refs] : []) as Ref[]) {
        if (ref.uri?.startsWith("at://")) relate(base, from, unitIdOf(ref.uri), did);
      }
    }
  }
  return out;
};
