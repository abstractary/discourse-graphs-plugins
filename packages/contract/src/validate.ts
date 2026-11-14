import { isUnitId } from "./ids.ts";
import { DOCUMENT_KINDS, EVALUATION_METHODS, FORMAT_VERSION, OUTPUT_KINDS, PROVENANCE_METHODS, RUN_STATUSES, STUDY_DESIGNS, VARIABLE_ROLES, type Author, type HowMade, type Pin, type RecordKind, type StudyVariable } from "./record.ts";
import { isIdentifier } from "./scholarly.ts";

/**
 * Whether something is a well-formed record of a kind this version knows. An
 * unknown kind or a newer version is not an error: it is kept in the log and
 * left out of the graph, so an older app never damages what a newer one wrote.
 */
const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isAuthor = (value: unknown): value is Author =>
  typeof value === "object" &&
  value !== null &&
  isString((value as Author).id) &&
  typeof (value as Author).name === "string";

const isTimestamp = (value: unknown): value is string =>
  isString(value) && !Number.isNaN(Date.parse(value));

const validateCanvasItem = (item: unknown): string[] => {
  if (typeof item !== "object" || item === null) return ["canvas item is empty"];
  const value = item as Record<string, unknown>;
  if ("fromNode" in value) {
    return isString(value.fromNode) && isString(value.toNode)
      ? []
      : ["canvas edge needs both ends"];
  }
  const problems = ["x", "y", "width", "height"]
    .filter((key) => !Number.isInteger(value[key]))
    .map((key) => `canvas ${key} must be an integer`);
  if (value.type === "stroke" && !isString(value.path)) {
    problems.push("canvas stroke needs a path");
  }
  return problems;
};

const validateTitleFormat = (format: unknown): string[] => {
  if (format === undefined) return [];
  const placeholders = String(format).match(/\{[^}]*\}/g) ?? [];
  return placeholders.length === 1 && placeholders[0] === "{content}"
    ? []
    : ["titleFormat must contain {content} and nothing else in braces"];
};

const requiredByKind: Record<RecordKind, string[]> = {
  node: ["title"],
  anchor: ["node", "ref"],
  "node-type": ["label"],
  "relation-type": ["label", "complement"],
  canvas: ["title"],
  "canvas-item": ["canvas"],
  snapshot: ["node", "format"],
  person: ["name"],
  lab: ["name", "did", "custodian", "custodianKey"],
  membership: ["lab", "member"],
  paper: ["title", "canvas", "filename", "model", "schema", "server"],
  folder: ["title"],
  "folder-item": ["folder", "node"],
  reaction: ["unit"],
  "unit-note": ["unit", "text"],
  evaluation: ["target", "method"],
  release: ["canvas", "name"],
  device: ["key", "name", "role"],
  relation: ["type", "source", "target"],
  retraction: ["target"],
  decision: ["target", "decision"],
};

const validateLabSettings = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["lab settings must be an object"];
  const settings = value as Record<string, unknown>;
  const problems: string[] = [];
  const group = settings.zoteroGroup as { id?: unknown; name?: unknown } | undefined;
  if (group !== undefined && !(typeof group === "object" && group !== null && isString(group.id) && isString(group.name))) problems.push("zoteroGroup needs id and name");
  if (settings.servers !== undefined) {
    const servers = settings.servers;
    const fine = Array.isArray(servers) && servers.every((server) => typeof server === "object" && server !== null && isString((server as { name?: unknown }).name) && isString((server as { url?: unknown }).url));
    if (!fine) problems.push("servers must be a list of name and url");
  }
  if (settings.compute !== undefined && !isString(settings.compute)) problems.push("compute must be text");
  if (settings.reach !== undefined && !["device", "lab", "anywhere"].includes(settings.reach as string)) problems.push("reach must be device, lab or anywhere");
  return problems;
};

/**
 * An empty array means valid. Unknown fields are allowed and must be kept.
 * So are records a newer client wrote, with a kind or format version this
 * build doesn't know: their envelope is checked, they are stored and synced,
 * and `foldRecords` leaves them out. Rejecting them would make an older device
 * drop a newer device's work.
 */
export const validateRecord = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null) return ["not an object"];
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const newer = Number.isInteger(record.v) && (record.v as number) > FORMAT_VERSION;
  if (record.v !== FORMAT_VERSION && !newer) problems.push("unknown format version");
  if (!isUnitId(record.id)) problems.push("id must be a DID and a TID");
  if (!isString(record.space)) problems.push("missing space");
  if (!isTimestamp(record.at)) problems.push("at must be a timestamp");
  if (!isAuthor(record.by)) problems.push("by must be an author");
  if (!isString(record.kind)) return [...problems, "missing kind"];
  if (newer || !isKnownRecord(record)) return problems;
  const kind = record.kind as RecordKind;
  const required = requiredByKind[kind];
  for (const key of required) {
    if (!isString(record[key])) problems.push(`${kind} needs ${key}`);
  }
  if ((DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    if (!Number.isInteger(record.rev) || (record.rev as number) < 1) {
      problems.push("rev must be a positive integer");
    }
    if (!isTimestamp(record.editedAt)) problems.push("editedAt is required");
    if (!isAuthor(record.editedBy)) problems.push("editedBy is required");
  }
  if (kind === "decision" && !["accepted", "rejected"].includes(record.decision as string)) {
    problems.push("decision must be accepted or rejected");
  }
  if (kind === "relation-type" && !Array.isArray(record.rules)) {
    problems.push("relation-type needs rules");
  }
  if (kind === "node-type") {
    problems.push(...validateTitleFormat(record.titleFormat));
  }
  if (kind === "canvas-item") {
    problems.push(...validateCanvasItem(record.item));
    if (typeof record.z !== "number") problems.push("canvas-item needs z");
  }
  if (kind === "snapshot" && typeof record.body !== "string") {
    problems.push("snapshot needs a body");
  }
  if (kind === "person" && !Array.isArray(record.aliases)) {
    problems.push("person needs aliases");
  }
  if (kind === "node") {
    problems.push(...validateProvenance(record.prov), ...validateFacts(record.facts));
  }
  if (kind === "release" && !(Array.isArray(record.items) && Array.isArray(record.units))) {
    problems.push("release needs items and units");
  }
  if (kind === "evaluation") {
    if (!(EVALUATION_METHODS as readonly string[]).includes(record.method as string)) {
      problems.push("evaluation method is not one of the known methods");
    }
    if (record.targetCid !== undefined && !isCid(record.targetCid)) problems.push("targetCid must be a CID");
  }
  if (kind === "lab" && record.settings !== undefined) problems.push(...validateLabSettings(record.settings));
  if (kind === "device") {
    if (!["device", "agent"].includes(record.role as string)) problems.push("device role must be device or agent");
    const vouch = record.vouch as { by?: unknown; sig?: unknown } | undefined;
    if (vouch !== undefined && !(typeof vouch === "object" && vouch !== null && isString(vouch.by) && isString(vouch.sig))) problems.push("vouch needs by and sig");
  }
  // What signing and versions add. Each is optional, and each is text when present.
  for (const key of ["sig", "sigBy", "prev", "acceptedFrom", "replacedBy"] as const) {
    if (record[key] !== undefined && !isString(record[key])) problems.push(`${key} must be text`);
  }
  return problems;
};

/** True for the kinds and format this build reads. Anything else is kept, not read. */
export const isKnownRecord = (record: { v?: unknown; kind?: unknown }): boolean =>
  record.v === FORMAT_VERSION && Object.hasOwn(requiredByKind, String(record.kind));

/** CIDv1 in base32, the form AT Protocol and multiformats print. */
export const isCid = (value: unknown): value is string =>
  typeof value === "string" && /^b[a-z2-7]{20,}$/.test(value);

const isPin = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  isString((value as Pin).uri) &&
  ((value as Pin).cid === undefined || isCid((value as Pin).cid));

const ID_LINKS = ["question", "partOf", "generatedBy", "isGroundedIn", "sourceDocument"] as const;
const ID_LIST_LINKS = ["protocols", "implementedBy", "describesActivity"] as const;
const PIN_LINKS = ["follows"] as const;
const PIN_LIST_LINKS = ["instrument", "used", "derivedFrom", "observationBase"] as const;

const validateProvenance = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null) return ["prov must be an object"];
  const prov = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ID_LINKS) {
    if (prov[key] !== undefined && !isString(prov[key])) problems.push(`prov.${key} must be an id`);
  }
  for (const key of ID_LIST_LINKS) {
    if (prov[key] !== undefined && !(Array.isArray(prov[key]) && (prov[key] as unknown[]).every(isString))) {
      problems.push(`prov.${key} must be a list of ids`);
    }
  }
  for (const key of PIN_LINKS) {
    if (prov[key] !== undefined && !isPin(prov[key])) problems.push(`prov.${key} must be {uri, cid}`);
  }
  for (const key of PIN_LIST_LINKS) {
    if (prov[key] !== undefined && !(Array.isArray(prov[key]) && (prov[key] as unknown[]).every(isPin))) {
      problems.push(`prov.${key} must be a list of {uri, cid}`);
    }
  }
  return problems;
};

const validateFacts = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null) return ["facts must be an object"];
  const facts = value as Record<string, unknown>;
  const problems: string[] = [];
  if (facts.status !== undefined && !(RUN_STATUSES as readonly string[]).includes(facts.status as string)) {
    problems.push("facts.status must be planned, running, completed or failed");
  }
  if (facts.outputKind !== undefined && !(OUTPUT_KINDS as readonly string[]).includes(facts.outputKind as string)) {
    problems.push("facts.outputKind is not a known kind");
  }
  for (const key of ["startedAt", "endedAt"]) {
    if (facts[key] !== undefined && !isTimestamp(facts[key])) problems.push(`facts.${key} must be a timestamp`);
  }
  for (const key of ["cid", "sourceCid"]) {
    if (facts[key] !== undefined && !isCid(facts[key])) problems.push(`facts.${key} must be a CID`);
  }
  if (facts.design !== undefined && !(STUDY_DESIGNS as readonly string[]).includes(facts.design as string)) {
    problems.push("facts.design is not a known design");
  }
  for (const key of ["steps", "materials", "deviations", "conditions"]) {
    if (facts[key] !== undefined && !(Array.isArray(facts[key]) && (facts[key] as unknown[]).every(isString))) {
      problems.push(`facts.${key} must be a list of text`);
    }
  }
  for (const key of ["hypothesis", "condition", "preregistration"]) {
    if (facts[key] !== undefined && !isString(facts[key])) problems.push(`facts.${key} must be text`);
  }
  if (facts.sampleSize !== undefined && !(Number.isInteger(facts.sampleSize) && (facts.sampleSize as number) >= 0)) {
    problems.push("facts.sampleSize must be a whole number");
  }
  if (
    facts.variables !== undefined &&
    !(
      Array.isArray(facts.variables) &&
      (facts.variables as StudyVariable[]).every((item) => isString(item?.name) && (VARIABLE_ROLES as readonly string[]).includes(item?.role))
    )
  ) {
    problems.push("facts.variables must be a list of {name, role}");
  }
  if (facts.identifiers !== undefined && !(Array.isArray(facts.identifiers) && (facts.identifiers as unknown[]).every(isIdentifier))) {
    problems.push("facts.identifiers must be a list of {scheme, value}");
  }
  const provenance = facts.provenance as HowMade | undefined;
  if (provenance !== undefined && !(PROVENANCE_METHODS as readonly string[]).includes(provenance?.method)) {
    problems.push("facts.provenance.method is not a known method");
  }
  return problems;
};
