import {
  BASE_NODE_TYPES,
  BASE_RELATION_TYPES,
  createNodeType,
  createRelationType,
  revise,
  type BaseNodeType,
  type BaseRelationType,
  type DgId,
  type DgRecord,
  type NodeTypeRecord,
  type RelationRule,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import { STARTER_TEMPLATES, fillTemplate } from "@dg/contract/grammar.ts";
import type { Context, Handlers } from "./context.ts";

export { STARTER_TEMPLATES, fillTemplate };

/**
 * The grammar: a lab's own node types and relation types, and which types a
 * relation may join. A node type always sits on one of the nine bases. The
 * base is what other tools understand; the label, abbreviation, colour and
 * template are the lab's.
 *
 * A schema file carries the grammar between bases by label, never by id, so it
 * reads the same anywhere. Reading one adds what is missing and changes nothing
 * that is already here.
 */

export const SCHEMA_FORMAT = "discourse-graphs-schema";
export const SCHEMA_FILE = "discourse-graphs-schema.json";

export type SchemaFile = {
  format: typeof SCHEMA_FORMAT;
  version: 1;
  exportedAt: string;
  nodeTypes: { label: string; base?: BaseNodeType; abbreviation?: string; titleFormat?: string; color?: string; template?: string }[];
  relationTypes: { label: string; complement: string; base?: BaseRelationType; color?: string; rules: { source: string; target: string }[] }[];
};

/** The official Obsidian plugin's schema export, as far as this reads it. */
type OfficialSchema = {
  nodeTypes: { id: string; name: string; format?: string; template?: string; color?: string }[];
  relationTypes: { id: string; label: string; complement: string }[];
  discourseRelations: { sourceId: string; destinationId: string; relationshipTypeId: string }[];
  templates?: { name: string; content: string }[];
};

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const tidy = (value: string | undefined): string | undefined => (value?.trim() ? value.trim() : undefined);

/** The base a label most plainly names, for a schema that doesn't say. */
const baseOfLabel = (label: string): BaseNodeType | undefined => {
  const word = label.trim().toLowerCase();
  const found = (BASE_NODE_TYPES as readonly string[]).find((base) => base === word);
  if (found) return found as BaseNodeType;
  const hints: [RegExp, BaseNodeType][] = [[/^(result|finding|observation)$/, "evidence"], [/^(hypothesis|conclusion)$/, "claim"], [/^(experiment)$/, "study"], [/^(issue|problem)$/, "question"], [/^(paper|reference|article)$/, "source"], [/^(method)$/, "protocol"]];
  return hints.find(([pattern]) => pattern.test(word))?.[1];
};
const relationBaseOfLabel = (label: string): BaseRelationType | undefined => {
  const word = label.trim().toLowerCase().replace(/\s+/g, "");
  return (BASE_RELATION_TYPES as readonly string[]).find((base) => base.toLowerCase() === word) as BaseRelationType | undefined;
};
/** `CLM - {content}` says the abbreviation is CLM. */
const abbreviationOf = (format: string | undefined): string | undefined => /^\W*([A-Za-z]{2,6})\W/.exec(format ?? "")?.[1]?.toUpperCase();

export const grammarFeature = (context: Context) => {
  const nodeTypes = (): NodeTypeRecord[] => context.nodeTypes();
  const relationTypes = (): RelationTypeRecord[] => context.relationTypes();

  const uses = (): Record<DgId, number> => {
    const count: Record<DgId, number> = {};
    for (const node of context.documents("node")) if (!node.removed && node.type) count[node.type] = (count[node.type] ?? 0) + 1;
    for (const { record, state } of context.graph().relations.values()) if (state === "active") count[record.type] = (count[record.type] ?? 0) + 1;
    return count;
  };

  const checkedFormat = (format: string | undefined, abbreviation: string | undefined): string | undefined => {
    const given = tidy(format) ?? (abbreviation ? `${abbreviation} - {content}` : undefined);
    if (given === undefined) return undefined;
    const blanks = given.match(/\{[^}]*\}/g) ?? [];
    if (blanks.length !== 1 || blanks[0] !== "{content}") throw new Error("A title pattern needs {content} once, and nothing else in braces.");
    return given;
  };

  const saveNodeType: Handlers["grammar.saveNodeType"] = async ({ id, label, base, abbreviation, titleFormat, color, template }) => {
    const name = label.trim();
    if (!name) throw new Error("A type needs a name.");
    if (!(BASE_NODE_TYPES as readonly string[]).includes(base)) throw new Error("A type sits on one of the nine kinds of unit.");
    const short = tidy(abbreviation)?.toUpperCase();
    if (short && !/^[A-Z0-9]{1,6}$/.test(short)) throw new Error("An abbreviation is up to six letters or digits.");
    const clash = nodeTypes().find((type) => type.id !== id && same(type.label, name));
    if (clash) throw new Error(`There is already a type called ${clash.label}.`);
    const fields = { label: name, base, ...(short ? { abbreviation: short } : {}), ...(checkedFormat(titleFormat, short) ? { titleFormat: checkedFormat(titleFormat, short)! } : {}), ...(tidy(color) ? { color: tidy(color)! } : {}), ...(template?.trim() ? { template } : {}) };
    if (!id) {
      const made = createNodeType({ ...context.stamp(), fields });
      await context.put([made]);
      return made;
    }
    const held = context.typeOf(id);
    if (!held) throw new Error("That type isn't here any more.");
    // A cleared field is cleared, so the whole set is written.
    const next = revise({ record: held, changes: { abbreviation: undefined, titleFormat: undefined, color: undefined, template: undefined, ...fields } as never, by: context.me() });
    const clean = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as NodeTypeRecord;
    await context.put([clean]);
    return clean;
  };

  const removeNodeType: Handlers["grammar.removeNodeType"] = async ({ id }) => {
    const held = context.typeOf(id);
    if (!held) return null;
    const count = uses()[id] ?? 0;
    if (count > 0) throw new Error(`${count} ${count === 1 ? "unit has" : "units have"} this type. Give ${count === 1 ? "it" : "them"} another type first.`);
    const left = nodeTypes().filter((type) => type.id !== id && type.base === held.base);
    if (held.base && left.length === 0 && ["question", "claim", "evidence", "source"].includes(held.base)) throw new Error(`This is the only ${held.base} type. An argument needs one.`);
    // Relation rules that named it no longer mean anything.
    const rules = relationTypes().flatMap((type) => {
      const kept = type.rules.filter((rule) => rule.source !== id && rule.target !== id);
      return kept.length === type.rules.length ? [] : [revise({ record: type, changes: { rules: kept }, by: context.me() })];
    });
    await context.put([revise({ record: held, changes: { removed: true }, by: context.me() }), ...rules]);
    return null;
  };

  const saveRelationType: Handlers["grammar.saveRelationType"] = async ({ id, label, complement, base, rules, color }) => {
    const name = label.trim();
    const back = complement.trim();
    if (!name || !back) throw new Error("A relation needs its wording both ways, such as Supports and Supported by.");
    if (base && !(BASE_RELATION_TYPES as readonly string[]).includes(base)) throw new Error("That isn't a kind of relation.");
    const clash = relationTypes().find((type) => type.id !== id && (same(type.label, name) || same(type.complement, name) || same(type.label, back)));
    if (clash) throw new Error(`${clash.label} already uses that wording.`);
    const known = new Set(nodeTypes().map((type) => type.id));
    const pairs: RelationRule[] = [];
    for (const rule of rules) {
      if (!known.has(rule.source) || !known.has(rule.target)) throw new Error("A relation can only join types that are in use.");
      if (!pairs.some((pair) => pair.source === rule.source && pair.target === rule.target)) pairs.push({ source: rule.source, target: rule.target });
    }
    const fields = { label: name, complement: back, ...(base ? { base } : {}), rules: pairs, ...(tidy(color) ? { color: tidy(color)! } : {}) };
    if (!id) {
      const made = createRelationType({ ...context.stamp(), fields });
      await context.put([made]);
      return made;
    }
    const held = context.relationTypeOf(id);
    if (!held) throw new Error("That relation isn't here any more.");
    const next = revise({ record: held, changes: { base: undefined, color: undefined, ...fields } as never, by: context.me() });
    const clean = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)) as RelationTypeRecord;
    await context.put([clean]);
    return clean;
  };

  const removeRelationType: Handlers["grammar.removeRelationType"] = async ({ id }) => {
    const held = context.relationTypeOf(id);
    if (!held) return null;
    const count = uses()[id] ?? 0;
    if (count > 0) throw new Error(`${count} ${count === 1 ? "link uses" : "links use"} this relation. Remove ${count === 1 ? "it" : "them"} first.`);
    await context.put([revise({ record: held, changes: { removed: true }, by: context.me() })]);
    return null;
  };

  const schema = (): SchemaFile => {
    const labelOf = new Map(nodeTypes().map((type) => [type.id, type.label]));
    return {
      format: SCHEMA_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      nodeTypes: nodeTypes().map(({ label, base, abbreviation, titleFormat, color, template }) => ({ label, ...(base ? { base } : {}), ...(abbreviation ? { abbreviation } : {}), ...(titleFormat ? { titleFormat } : {}), ...(color ? { color } : {}), ...(template ? { template } : {}) })),
      relationTypes: relationTypes().map(({ label, complement, base, color, rules }) => ({
        label,
        complement,
        ...(base ? { base } : {}),
        ...(color ? { color } : {}),
        rules: rules.flatMap((rule) => (labelOf.has(rule.source) && labelOf.has(rule.target) ? [{ source: labelOf.get(rule.source)!, target: labelOf.get(rule.target)! }] : [])),
      })),
    };
  };

  /** Either schema shape, as ours. */
  const readSchema = (raw: unknown): { schema: SchemaFile; from: "discourse-graphs" | "official-plugin" } => {
    const file = raw as Partial<SchemaFile> & Partial<OfficialSchema>;
    if (file?.format === SCHEMA_FORMAT && Array.isArray(file.nodeTypes) && Array.isArray(file.relationTypes)) return { schema: file as SchemaFile, from: "discourse-graphs" };
    if (Array.isArray(file?.nodeTypes) && Array.isArray(file?.discourseRelations) && file.nodeTypes.every((type) => typeof (type as { name?: unknown }).name === "string")) {
      const official = file as OfficialSchema;
      const nameOf = new Map(official.nodeTypes.map((type) => [type.id, type.name]));
      const bodies = new Map((official.templates ?? []).map((item) => [item.name, item.content]));
      return {
        from: "official-plugin",
        schema: {
          format: SCHEMA_FORMAT,
          version: 1,
          exportedAt: new Date().toISOString(),
          nodeTypes: official.nodeTypes.map((type) => {
            const format = type.format && (type.format.match(/\{[^}]*\}/g) ?? []).join() === "{content}" ? type.format : undefined;
            const body = type.template ? bodies.get(type.template) : undefined;
            return { label: type.name, ...(baseOfLabel(type.name) ? { base: baseOfLabel(type.name)! } : {}), ...(abbreviationOf(format) ? { abbreviation: abbreviationOf(format)! } : {}), ...(format ? { titleFormat: format } : {}), ...(type.color ? { color: type.color } : {}), ...(body ? { template: body } : {}) };
          }),
          relationTypes: (official.relationTypes ?? []).map((type) => ({
            label: type.label,
            complement: type.complement,
            ...(relationBaseOfLabel(type.label) ? { base: relationBaseOfLabel(type.label)! } : {}),
            rules: official.discourseRelations.flatMap((rule) => (rule.relationshipTypeId === type.id && nameOf.has(rule.sourceId) && nameOf.has(rule.destinationId) ? [{ source: nameOf.get(rule.sourceId)!, target: nameOf.get(rule.destinationId)! }] : [])),
          })),
        },
      };
    }
    throw new Error("This file isn't a Discourse Graphs schema.");
  };

  const handlers: Pick<Handlers, "grammar.saveNodeType" | "grammar.removeNodeType" | "grammar.saveRelationType" | "grammar.removeRelationType" | "grammar.export" | "grammar.files" | "grammar.import" | "table.open"> = {
    "grammar.saveNodeType": saveNodeType,
    "grammar.removeNodeType": removeNodeType,
    "grammar.saveRelationType": saveRelationType,
    "grammar.removeRelationType": removeRelationType,

    "grammar.export": async () => {
      const file = schema();
      const bytes = new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const saved = await context.host.saveFile({ name: SCHEMA_FILE, mediaType: "application/json", dataBase64: btoa(binary) });
      if (!saved.ok) throw new Error(saved.error.message);
      return { where: saved.value.where, name: SCHEMA_FILE, nodeTypes: file.nodeTypes.length, relationTypes: file.relationTypes.length };
    },

    "grammar.files": async () => {
      const listing = await context.host.listFiles({ extensions: ["json"], limit: 200 });
      if (!listing.ok) return [];
      // A base keeps other JSON too. A schema is small, and nothing under the record store is one.
      return listing.value
        .filter((file) => !(file.folder ?? "").startsWith("discourse-graph") && (file.size ?? 0) < 2_000_000 && !/^(ro-crate-metadata|relations|manifest|package)/.test(file.name))
        .map(({ ref, name, folder }) => ({ ref, name, ...(folder ? { folder } : {}) }));
    },

    "grammar.import": async ({ ref }) => {
      const asset = await context.host.readAsset({ ref });
      if (!asset.ok) throw new Error(asset.error.message);
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(asset.value.dataUrl.split(",")[1] ?? ""), (char) => char.charCodeAt(0))));
      } catch {
        throw new Error(`${asset.value.name} doesn't read as JSON.`);
      }
      const { schema: file, from } = readSchema(raw);
      const stamp = context.stamp();
      const fresh: DgRecord[] = [];
      const byLabel = new Map(nodeTypes().map((type) => [type.label.trim().toLowerCase(), type]));
      let kept = 0;
      let addedTypes = 0;
      for (const type of file.nodeTypes) {
        const key = type.label.trim().toLowerCase();
        if (!key) continue;
        if (byLabel.has(key)) {
          kept += 1;
          continue;
        }
        const short = tidy(type.abbreviation)?.toUpperCase();
        let format: string | undefined;
        try {
          format = checkedFormat(type.titleFormat, short);
        } catch {
          format = short ? `${short} - {content}` : undefined;
        }
        const made = createNodeType({ ...stamp, fields: { label: type.label.trim(), ...(type.base && (BASE_NODE_TYPES as readonly string[]).includes(type.base) ? { base: type.base } : {}), ...(short ? { abbreviation: short } : {}), ...(format ? { titleFormat: format } : {}), ...(type.color ? { color: type.color } : {}), ...(type.template ? { template: type.template } : {}) } });
        fresh.push(made);
        byLabel.set(key, made);
        addedTypes += 1;
      }
      const relations = new Map(relationTypes().map((type) => [type.label.trim().toLowerCase(), type]));
      let addedRelations = 0;
      let addedRules = 0;
      for (const type of file.relationTypes) {
        const key = type.label.trim().toLowerCase();
        if (!key || !type.complement?.trim()) continue;
        const rules = (type.rules ?? []).flatMap((rule) => {
          const source = byLabel.get(String(rule.source).trim().toLowerCase());
          const target = byLabel.get(String(rule.target).trim().toLowerCase());
          return source && target ? [{ source: source.id, target: target.id }] : [];
        });
        const held = relations.get(key);
        if (!held) {
          fresh.push(createRelationType({ ...stamp, fields: { label: type.label.trim(), complement: type.complement.trim(), ...(type.base && (BASE_RELATION_TYPES as readonly string[]).includes(type.base) ? { base: type.base } : {}), rules, ...(type.color ? { color: type.color } : {}) } }));
          addedRelations += 1;
          addedRules += rules.length;
          continue;
        }
        // A relation that is already here keeps its wording and gains the pairs it lacked.
        const missing = rules.filter((rule) => !held.rules.some((pair) => pair.source === rule.source && pair.target === rule.target));
        if (missing.length) {
          fresh.push(revise({ record: held, changes: { rules: [...held.rules, ...missing] }, by: context.me() }));
          addedRules += missing.length;
        } else kept += 1;
      }
      if (fresh.length) await context.put(fresh);
      return { nodeTypes: addedTypes, relationTypes: addedRelations, rules: addedRules, kept, from };
    },

    "table.open": async ({ type }) => {
      const held = context.typeOf(type);
      if (!held) throw new Error("That type isn't here any more.");
      if (!context.host.openTable) throw new Error("This base has no tables of its own.");
      const made = await context.host.openTable({ name: held.label, property: FACT_KEYS.type, value: held.label, columns: TABLE_COLUMNS.filter(({ only }) => !only || only === held.base).map(({ property, label }) => ({ property, label })) });
      if (!made.ok) throw new Error(made.error.message);
      return made.value;
    },
  };
  return { handlers, uses };
};

/** The facts written into a unit's note, so a base's own tables can sort and filter by them. */
export const FACT_KEYS = { type: "dg-type", made: "dg-made", by: "dg-by", status: "dg-status", source: "dg-source" } as const;
const TABLE_COLUMNS: { property: string; label: string; only?: BaseNodeType }[] = [
  { property: FACT_KEYS.made, label: "Made" },
  { property: FACT_KEYS.by, label: "By" },
  { property: FACT_KEYS.status, label: "Status", only: "run" },
  { property: FACT_KEYS.source, label: "Source" },
];
