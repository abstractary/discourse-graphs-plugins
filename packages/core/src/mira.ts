import { idsOf, listOf } from "./bytes.ts";
import type { BaseNodeType, JsonObject } from "@dg/contract/records.ts";

/**
 * The MIRA schema, in and out of a crate. This is the only file that knows
 * MIRA's names, so a change in the schema is a change here and nowhere else.
 *
 * Going out, every unit in a crate is also typed as its MIRA class and carries
 * MIRA's own properties beside ours, in the one metadata graph. A reader that
 * knows only MIRA finds the evidence, the study that grounds it and the
 * protocol it followed without a second file.
 *
 * Coming in, a MIRA graph such as a MATSUlab bundle's `evidence.jsonld` is
 * rewritten into the names a crate uses, so one importer reads both.
 */

export const MIRA = {
  namespace: "http://purl.org/mira-science/mira#",
  name: "MIRA schema",
  url: "https://github.com/MIRA-science/schema",
};

type Entity = JsonObject & { "@id": string };

/** A run is what MIRA calls a study: the activity that grounds evidence. Our Study, the design, has no MIRA class. */
const CLASS_OF_BASE: Partial<Record<BaseNodeType, string>> = {
  question: "Question",
  claim: "Claim",
  evidence: "Evidence",
  source: "SourceDocument",
  protocol: "Protocol",
  run: "Study",
};

/** Our property, then MIRA's name for the same thing. */
const SAME: [string, string][] = [
  ["supports", "supports"],
  ["opposes", "opposes"],
  ["addresses", "addresses"],
  ["observationBase", "observationBase"],
  ["isGroundedIn", "is_grounded_in"],
  ["follows", "follows"],
  ["describesActivity", "describesActivity"],
];

const ref = (id: string): JsonObject => ({ "@id": id });

/**
 * Adds MIRA's classes and properties to the crate's entities, in place.
 * `bases` says which entity is which kind of unit.
 */
export const addMiraLayer = (entities: Map<string, Entity>, bases: Map<string, BaseNodeType>): void => {
  const typed = (id: string, name: string): void => {
    const entity = entities.get(id);
    if (!entity) return;
    const types = listOf(entity["@type"]).map(String);
    if (!types.includes(`mira:${name}`)) entity["@type"] = [...types, `mira:${name}`];
  };
  let statements = 0;
  for (const [id, base] of bases) {
    const entity = entities.get(id);
    if (!entity) continue;
    const name = CLASS_OF_BASE[base];
    if (name) typed(id, name);
    for (const [ours, theirs] of SAME) if (entity[ours] !== undefined) entity[`mira:${theirs}`] = entity[ours]!;
    if (base !== "evidence") continue;
    // MIRA keeps what was observed as a statement of its own. Ours is the evidence's title.
    statements += 1;
    const statement = `#observation-${statements}`;
    entities.set(statement, { "@id": statement, "@type": ["CreativeWork", "mira:Claim"], name: entity.name ?? "", description: "What was observed, as a statement. The evidence it belongs to carries everything else." });
    entity["mira:observationStatement"] = ref(statement);
    const sources = idsOf(entity.isBasedOn);
    if (sources.length) {
      entity["mira:sourceDocument"] = sources.map(ref);
      for (const source of sources) typed(source, "SourceDocument");
    }
    for (const run of idsOf(entity.isGroundedIn)) {
      const study = entities.get(run);
      if (!study) continue;
      const held = idsOf(study["mira:grounds"]);
      if (!held.includes(id)) study["mira:grounds"] = [...held, id].map(ref);
    }
  }
  entities.set(MIRA.namespace, {
    "@id": MIRA.namespace,
    "@type": "DefinedTermSet",
    name: MIRA.name,
    description: "The MIRA schema's classes and properties. Every unit here is also typed in it, so a MIRA reader needs no second file.",
    url: MIRA.url,
  });
};

// Reading a MIRA graph

const contextsOf = (doc: unknown): JsonObject[] => listOf((doc as JsonObject | null)?.["@context"]).filter((item): item is JsonObject => Boolean(item) && typeof item === "object");

/** Whether a JSON-LD document is written with MIRA's own context, where a bare `Study` means MIRA's. */
export const isMiraDocument = (doc: unknown): boolean => {
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as JsonObject)["@graph"])) return false;
  const contexts = contextsOf(doc);
  if (contexts.some((context) => context.Evidence === "mira:Evidence" || context.Study === "mira:Study" || context.observationStatement !== undefined)) return true;
  return listOf((doc as JsonObject)["@context"]).some((item) => typeof item === "string" && /mira/i.test(item));
};

/** MIRA's context writes with Dublin Core, SIOC, FOAF and PROV names. These are the crate's names for the same. */
const KEY: Record<string, string> = {
  title: "name",
  content: "description",
  // In MIRA's context `description` is a link to a file that describes the thing.
  description: "subjectOf",
  format: "encodingFormat",
  created: "dateCreated",
  modified: "dateModified",
  accountName: "name",
  seeAlso: "sameAs",
  is_grounded_in: "isGroundedIn",
  "foaf:depiction": "image",
  "prov:startedAtTime": "startTime",
  "prov:endedAtTime": "endTime",
  "prov:wasAssociatedWith": "agent",
  "prov:used": "object",
  used: "object",
  "prov:wasGeneratedBy": "wasGeneratedBy",
};

/** A class in MIRA's context, as the importer should see it. `null` says nothing about what kind of unit it is. */
const TYPE: Record<string, string | null> = {
  Evidence: "mira:Evidence",
  Claim: "mira:Claim",
  Question: "mira:Question",
  Study: "mira:Study",
  Protocol: "mira:Protocol",
  Request: "mira:Request",
  SourceDocument: "mira:SourceDocument",
  UserAccount: "Person",
  Item: null,
  Container: null,
  Entity: null,
  Activity: null,
  "prov:Entity": null,
  "prov:Agent": null,
  "prov:SoftwareAgent": null,
  "prov:Activity": null,
};

/** A MIRA graph's nodes under the names a crate uses. Ids are left as written, so they meet the crate's own entities. */
export const miraEntities = (doc: unknown): Entity[] => {
  const graph = (doc as JsonObject | null)?.["@graph"];
  if (!Array.isArray(graph)) return [];
  return graph.flatMap((item): Entity[] => {
    if (!item || typeof item !== "object" || typeof (item as JsonObject)["@id"] !== "string") return [];
    const out: Entity = { "@id": String((item as JsonObject)["@id"]) };
    for (const [key, value] of Object.entries(item as JsonObject)) {
      if (key === "@id") continue;
      if (key === "@type") {
        const types = listOf(value).flatMap((type) => {
          const name = String(type);
          if (name in TYPE) return TYPE[name] ? [TYPE[name]!] : [];
          return [name.replace(/^schema:/, "")];
        });
        if (types.length) out["@type"] = types;
        continue;
      }
      const name = KEY[key] ?? key.replace(/^schema:/, "");
      if (out[name] === undefined) out[name] = value as never;
    }
    return [out];
  });
};

/**
 * One graph from a crate's entities and the MIRA graphs beside it. Where both
 * describe the same `@id`, the crate's own words win and MIRA adds what it lacks.
 */
export const mergeEntities = (crate: Entity[], others: Entity[][]): Entity[] => {
  const byId = new Map<string, Entity>(crate.map((entity) => [entity["@id"], { ...entity }]));
  for (const extra of others.flat()) {
    const known = byId.get(extra["@id"]);
    if (!known) {
      byId.set(extra["@id"], { ...extra });
      continue;
    }
    const types = [...new Set([...listOf(known["@type"]), ...listOf(extra["@type"])].map(String))];
    for (const [key, value] of Object.entries(extra)) if (known[key] === undefined) known[key] = value;
    if (types.length) known["@type"] = types.length === 1 ? types[0]! : types;
  }
  return [...byId.values()];
};

/** A property under our name or MIRA's, whichever the entity carries. */
export const miraValue = (entity: JsonObject, name: string): unknown => {
  const theirs = SAME.find(([ours]) => ours === name)?.[1] ?? name;
  return entity[name] ?? entity[`mira:${theirs}`] ?? entity[theirs] ?? entity[`mira:${name}`];
};

/** A type as the importer compares it: MIRA's full address becomes `mira:Name`. */
export const miraType = (type: string): string => (type.startsWith(MIRA.namespace) ? `mira:${type.slice(MIRA.namespace.length)}` : type);
