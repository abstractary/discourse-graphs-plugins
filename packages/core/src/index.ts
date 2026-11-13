import { sameDoi } from "@dg/contract/scholarly.ts";
import { cardFacts } from "./card.ts";
import type { CardFacts } from "@dg/contract/scholarly.ts";
import type { CrateExported, CrateImported } from "@dg/contract/surface.ts";
import {
  assertRelation,
  buildCanvas,
  canonicalJson,
  createAnchor,
  createCanvas,
  createCanvasItem,
  type CanvasItem,
  createLab,
  createMembership,
  createNode,
  createPerson,
  decide,
  defaultGrammar,
  foldRecords,
  formatTitle,
  isDocument,
  liveCanvasItems,
  parseTitle,
  retract,
  revise,
  type AnchorRecord,
  type Author,
  type CanvasItemRecord,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type HostRef,
  type JsonObject,
  type LabRecord,
  type NodeRecord,
  type PaperRecord,
  type NodeTypeRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import { fail, ok, type Host, type HostInfo, type Result } from "@dg/contract/host.ts";
import type { Captured, CaptureRequest, CoreForAdapter, Examples } from "@dg/contract/core.ts";
import type { ExtractionGraph, Services } from "@dg/contract/services.ts";
import type {
  CanvasSummary,
  CanvasView,
  Credit,
  HolonRef,
  IdentityView,
  Prefs,
  NodeSummary,
  RelationOption,
  SurfaceMessage,
  SurfaceMethod,
  SurfaceMethods,
  NotebookImported,
  SurfacePort,
} from "@dg/contract/surface.ts";
import { withUsageLog, type UsageEvent } from "@dg/contract/usage.ts";
import { atUriOf, cidOf, toAtRecord, type AtRecord } from "@dg/contract/atproto.ts";
import { holonFeature } from "./holons.ts";
import { paperOfWork } from "./work.ts";
import { mayJoin, ofPaper, readingOf, refusal, sameThing } from "./locks.ts";
import { readingFeature } from "./reading.ts";
import { searchFeature } from "./search.ts";
import {
  addCustodian,
  createIdentity,
  createLabIdentity,
  memoryKeys,
  type Identity,
  type KeyStore,
} from "./identity.ts";
import { planAtImport, planImport, type ExistingGraph, type ImportReport } from "./migrate.ts";
import type { Context, Handlers } from "./context.ts";
import { labFeature } from "./labs.ts";
import { aiFeature } from "./ai.ts";
import { methodFeature } from "./method.ts";
import { similarFeature } from "./similar.ts";
import { worksFeature } from "./works.ts";
import { crateFeature } from "./crate.ts";
import { FACT_KEYS, fillTemplate, grammarFeature } from "./grammar.ts";
import { notifyFeature } from "./notify.ts";
import { profileFeature } from "./profile.ts";
import { paperMapFeature } from "./papermap.ts";
import { libraryFeature } from "./library.ts";
import type { AiModel, AiSettings, Llm, SecretStore } from "@dg/contract/llm.ts";
import { paperFeature, paperLabel } from "./papers.ts";
import { ownColor, paperSource } from "./process.ts";
import { unitFeature } from "./units.ts";

const USAGE_KEY = "usage";
const LAST_CANVAS_KEY = "last-canvas";
const BADGES_KEY = "link-badges";
const HOME_TEXT = "This page holds a Discourse Graphs canvas.";
const HOME_ATTEMPTS = 6;
const LOCATE_MS = 400;

type Located = { x: number; y: number; width: number; height: number } | null;
const USAGE_LIMIT = 2000;
const USAGE_FLUSH_MS = 2000;

const value = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

export type Core = CoreForAdapter & {
  info: HostInfo;
  /** Read-only, for tests and diagnostics. */
  graph: () => FoldedGraph;
  /** Takes in a graph as today's plugins store it. A dry run writes nothing. */
  importExisting: (args: { existing: ExistingGraph; dryRun?: boolean }) => Promise<ImportReport>;
  identity: () => IdentityView;
  /** The signed PLC operations for this person, ready to register. */
  plc: () => JsonObject[];
  createLab: (name: string) => Promise<IdentityView>;
  joinLab: () => Promise<IdentityView>;
  /** Takes in AT records from any repo, such as published `science.mira.*` ones. */
  importAtRecords: (records: { uri: string; value: Record<string, unknown> }[]) => Promise<number>;
  /** Everything that isn't local-only, as AT records with their CIDs. */
  atRecords: () => Promise<(AtRecord & { cid: string })[]>;
  flushUsage: () => Promise<void>;
  /** What sync sends to the lab, and where it hands back what arrived. */
  shareable: () => DgRecord[];
  take: (records: DgRecord[]) => Promise<void>;
  /** A holon's own canvas, made from its laid-out view if it has none. */
  /** The base says which canvas is in front, so the boundary panel can follow it. */
  focusCanvas: (id: DgId) => Promise<void>;
  prefs: () => Promise<Prefs>;
  setPrefs: (changes: Partial<Prefs>) => Promise<Prefs>;
  badgesOn: () => boolean;
  /** How many entries the on-device usage log holds, and emptying it. */
  usageCount: () => number;
  clearUsage: () => Promise<void>;
  /** A unit's title, for a tab that shows one. */
  unitTitle: (id: DgId) => string | null;
  /** Reads a saved Jupyter notebook in the base into Code, a Run and its Outputs. */
  importNotebook: (args: { ref: string; text?: boolean }) => Promise<NotebookImported>;
  /** The saved extraction beside a paper's file, and reading the paper into a graph. */
  savedExtraction: (args: SurfaceMethods["paper.saved"]["params"]) => Promise<SurfaceMethods["paper.saved"]["result"]>;
  extractPaper: (args: SurfaceMethods["paper.extract"]["params"]) => Promise<SurfaceMethods["paper.extract"]["result"]>;
  showCanvas: (id: DgId) => Promise<null>;
  /** Reads a research crate the base holds into the graph. */
  importCrate: (args: { ref: string }) => Promise<CrateImported>;
  exportCrate: (args: SurfaceMethods["crate.export"]["params"]) => Promise<CrateExported>;
  /** The model setup, and changing it, for a base's own settings page. */
  ai: {
    settings: () => Promise<AiSettings>;
    configure: (changes: SurfaceMethods["ai.configure"]["params"]) => Promise<AiSettings>;
    models: (args: SurfaceMethods["ai.models"]["params"]) => Promise<AiModel[]>;
    test: () => Promise<{ ok: boolean; message: string; model?: string }>;
  };
};

export const createCore = async ({
  host: baseHost,
  titleFormat,
  canvasFormat = "Canvas - {content}",
  keys = memoryKeys(),
  services,
  llm,
  secrets,
  demoGraphs = [],
  askBreadcrumb,
}: {
  /** Calls a model provider with a person's own key. Without it, the lab's model or quoted units answer. */
  llm?: Llm;
  /** Where a key is kept, such as the system keychain. */
  secrets?: SecretStore;
  host: Host;
  /** Servers and labs. Without this, everything else still works. */
  services?: Services;
  /** Saved extractions anyone can load to try things out. */
  demoGraphs?: { filename: string; graph: ExtractionGraph }[];
  askBreadcrumb?: (paper: { id: string; title: string }) => void;
  /** How a canvas's own page or note is named in this base. */
  canvasFormat?: string;
  /** Adapters pass `browserKeys()`. Memory is for tests. */
  keys?: KeyStore;
  /** How this base writes titles, such as `[[CLM]] - {content}` in Roam. */
  titleFormat?: (abbreviation: string) => string;
}): Promise<Core> => {
  const stored = await baseHost.getLocal({ key: USAGE_KEY });
  const usage: UsageEvent[] =
    stored.ok && Array.isArray(stored.value)
      ? (stored.value as unknown as UsageEvent[])
      : [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flushUsage = async (): Promise<void> => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    await baseHost.setLocal({
      key: USAGE_KEY,
      value: usage.slice(-USAGE_LIMIT) as unknown as never,
    });
  };
  const logUsage = (event: UsageEvent): void => {
    usage.push(event);
    flushTimer ??= setTimeout(() => void flushUsage(), USAGE_FLUSH_MS);
  };
  const host = withUsageLog({ host: baseHost, record: logUsage });

  const info = value(await host.describe());
  const localSpace = info.space.id;
  const badgeSetting = await baseHost.getLocal({ key: BADGES_KEY });
  let badgesShown = !(badgeSetting.ok && badgeSetting.value === false);
  // Replaced below, once records are read and this person's DID is known.
  let me: Author = info.person;
  let stamp: { space: string; by: Author; lab?: string } = { space: localSpace, by: me };

  const records: DgRecord[] = [];
  const seen = new Set<string>();
  // Set once the holon feature exists; a note opened before then just waits.
  let holonHooks: ReturnType<typeof holonFeature> | undefined;
  let searchHooks: ReturnType<typeof searchFeature> | undefined;
  const missingText = new Set<HostRef>();
  let { appearance, skin } = info;
  let focused: DgId | null = null;
  let graph: FoldedGraph = foldRecords({ records, localSpace });
  let anchorsByRef = new Map<HostRef, AnchorRecord>();
  let anchorsByNode = new Map<DgId, AnchorRecord>();
  let cursor: string | undefined;
  let trustedLab: string | undefined;

  const listeners = new Set<() => void>();
  const ports = new Set<SurfacePort>();
  // Set once relation types can be read; the first pass runs then.
  let mirrorLinks: () => void = () => {};
  let giveNotes: () => void = () => {};
  const notify = (): void => {
    giveNotes();
    mirrorLinks();
    for (const listener of listeners) listener();
    for (const port of ports) port.send({ event: "graph-changed" });
  };

  const keyOf = (record: DgRecord): string =>
    isDocument(record) ? `${record.id}:${canonicalJson(record)}` : record.id;

  const absorb = (incoming: DgRecord[]): boolean => {
    let changed = false;
    for (const record of incoming) {
      const key = keyOf(record);
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
      changed = true;
    }
    if (!changed) return false;
    graph = foldRecords({ records, localSpace, ...(trustedLab ? { trustedLab } : {}) });
    const joined = [...graph.documents.values()].find(
      (record) => record.kind === "membership" && record.member === me.id,
    ) as { lab: string } | undefined;
    if (joined && joined.lab !== trustedLab) {
      trustedLab = joined.lab;
      graph = foldRecords({ records, localSpace, trustedLab });
    }
    anchorsByRef = new Map();
    anchorsByNode = new Map();
    for (const record of graph.documents.values()) {
      if (record.kind === "anchor" && record.space === localSpace) {
        anchorsByRef.set(record.ref, record);
        anchorsByNode.set(record.node, record);
      }
    }
    return true;
  };

  let pulling: Promise<void> = Promise.resolve();
  const pull = (): Promise<void> => {
    pulling = pulling.then(async () => {
      let changed = false;
      for (;;) {
        const page = value(
          await host.listRecords({ limit: 2000, ...(cursor ? { after: cursor } : {}) }),
        );
        changed = absorb(page.items) || changed;
        cursor = page.next;
        if (page.done) break;
      }
      if (changed) notify();
    });
    return pulling;
  };

  const put = async (fresh: DgRecord[]): Promise<void> => {
    value(await host.putRecords({ records: fresh }));
    if (absorb(fresh)) notify();
  };

  const documents = <K extends DgRecord["kind"]>(
    kind: K,
  ): Extract<DgRecord, { kind: K }>[] =>
    [...graph.documents.values()].filter(
      (record) => record.kind === kind,
    ) as Extract<DgRecord, { kind: K }>[];

  await pull();

  /** One DID per person, however many devices they use. */
  const loadIdentity = async (): Promise<Identity> => {
    const known = documents("person").find((person) => person.hostId === info.person.id && person.did);
    if (known?.did) {
      const [first] = known.plc ?? [];
      const rotationKeys = (first?.rotationKeys ?? []) as string[];
      return { did: known.did, rotationKey: rotationKeys[rotationKeys.length - 1] ?? "", plc: known.plc ?? [] };
    }
    const fresh = await createIdentity(keys);
    const author = { id: fresh.did, name: info.person.name };
    await put([
      createPerson({
        space: localSpace,
        by: author,
        name: info.person.name,
        aliases: [],
        did: fresh.did,
        hostId: info.person.id,
        plc: fresh.plc,
      }),
    ]);
    return fresh;
  };
  let identity = await loadIdentity();
  me = {
    id: identity.did,
    name: documents("person").find((person) => person.did === identity.did)?.name ?? info.person.name,
  };

  const myLab = (): LabRecord | undefined => {
    const joined = documents("membership").find((item) => item.member === identity.did);
    return joined ? documents("lab").find((lab) => lab.did === joined.lab) : undefined;
  };
  const refreshStamp = (): void => {
    const lab = myLab();
    stamp = { space: localSpace, by: me, ...(lab ? { lab: lab.did } : {}) };
  };
  refreshStamp();

  const identityView = (): IdentityView => {
    const lab = myLab();
    const available = documents("lab")[0];
    return {
      did: identity.did,
      name: me.name,
      ...(lab ? { lab: { name: lab.name, did: lab.did, custodian: lab.custodian } } : {}),
      ...(!lab && available ? { availableLab: { name: available.name, custodian: available.custodian } } : {}),
    };
  };

  const savePlc = async (next: Identity): Promise<void> => {
    identity = next;
    const person = documents("person").find((item) => item.did === next.did);
    if (person) await put([revise({ record: person, changes: { plc: next.plc }, by: me })]);
  };

  /** The person who sets up a lab is its custodian, so this is for the PI to run. */
  const createLabRecord = async (name: string): Promise<IdentityView> => {
    if (documents("lab").some(({ space }) => space === localSpace)) throw new Error("This space already has a lab.");
    const labIdentity = await createLabIdentity({ keys, custodian: identity });
    const lab = createLab({
      space: localSpace,
      by: me,
      name,
      did: labIdentity.did,
      custodian: identity.did,
      custodianKey: identity.rotationKey,
      plc: labIdentity.plc,
    });
    await put([lab, createMembership({ space: localSpace, by: me, lab: lab.did, member: identity.did })]);
    refreshStamp();
    return identityView();
  };

  /** Joining is a person's choice, because it gives the PI custody of their DID. */
  const joinLab = async (name?: string): Promise<IdentityView> => {
    const lab = name ? documents("lab").find((item) => item.name === name) : documents("lab")[0];
    if (!lab) throw new Error("There's no lab here to join.");
    if (myLab()) return identityView();
    await savePlc(await addCustodian({ keys, identity, custodianKey: lab.custodianKey }));
    await put([createMembership({ space: localSpace, by: me, lab: lab.did, member: identity.did })]);
    refreshStamp();
    return identityView();
  };

  if (documents("node-type").length === 0) {
    await put(
      defaultGrammar({ ...stamp, ...(titleFormat ? { titleFormat } : {}) }),
    );
  }

  const nodeOf = (id: DgId): NodeRecord | undefined => {
    const record = graph.documents.get(id);
    return record?.kind === "node" && !record.removed ? record : undefined;
  };
  const canvasOf = (id: DgId): CanvasRecord | undefined => {
    const record = graph.documents.get(id);
    return record?.kind === "canvas" && !record.removed ? record : undefined;
  };
  const typeOf = (id: DgId | undefined): NodeTypeRecord | undefined => {
    const record = id ? graph.documents.get(id) : undefined;
    return record?.kind === "node-type" ? record : undefined;
  };
  const relationTypeOf = (id: DgId): RelationTypeRecord | undefined => {
    const record = graph.documents.get(id);
    return record?.kind === "relation-type" ? record : undefined;
  };

  const labOf = (record: { lab?: string }): LabRecord | undefined =>
    documents("lab").find((lab) => lab.did === record.lab);

  // A person's current name, so work done before they set one reads correctly too.
  const nameOf = (author: Author): string =>
    documents("person").find((person) => person.did === author.id)?.name ?? author.name;

  /** A lab's work reads as the lab's from outside it, and as a person's from inside. */
  const creditFor = (record: { by: Author; lab?: string }): Credit => {
    const lab = labOf(record);
    if (lab && lab.did !== myLab()?.did) return { kind: "lab", id: lab.did, name: lab.name };
    return { kind: "person", id: record.by.id, name: nameOf(record.by) };
  };

  const paperLabels = new Map<string, { version: string; label: string }>();
  /** The paper a unit was read from, in a few words. Kept per paper, since every card asks. */
  const paperOf = (node: NodeRecord): NodeSummary["paper"] => {
    const id = node.source?.paper;
    const paper = id ? (graph.documents.get(id) as PaperRecord | undefined) : undefined;
    if (!paper || paper.kind !== "paper") return undefined;
    const version = `${paper.title}|${paper.authors.join(",")}|${paper.filename}`;
    let kept = paperLabels.get(paper.id);
    if (!kept || kept.version !== version) {
      const own = paperSource(graph, paper.id);
      kept = { version, label: paperLabel(paper, own ? (nodeOf(own)?.title ?? "") : "") };
      paperLabels.set(paper.id, kept);
    }
    return { id: paper.id, label: kept.label, title: paper.title };
  };

  /** The paper a source unit stands for: the one it was read from, or one with its DOI or title. */
  const paperOfSource = (source: NodeRecord): PaperRecord | undefined => {
    const papers = documents("paper");
    return paperOfWork(papers, source);
  };
  const cardOf = (node: NodeRecord): CardFacts =>
    cardFacts({
      graph,
      node,
      localSpace,
      spaceName: info.space.name,
      nameOf,
      labName: (did) => labOf({ lab: did })?.name,
      labelOf: (paper) => paperOf({ source: { paper: paper.id } } as NodeRecord)?.label ?? paper.title,
      paperOfSource,
    });

  const summarize = (node: NodeRecord): NodeSummary => {
    const type = typeOf(node.type);
    const anchor = anchorsByNode.get(node.id);
    const paper = paperOf(node);
    return {
      id: node.id,
      title: node.title,
      credit: creditFor(node),
      at: node.at,
      hasText: Boolean(anchor && !missingText.has(anchor.ref)),
      card: cardOf(node),
      // Read from a paper or a PDF, and not given a note or page yet.
      ...((node.source || node.facts?.anchor?.exact) && !anchor ? { staged: true } : {}),
      ...(atUriOf(node.id, graph) ? { uri: atUriOf(node.id, graph)! } : {}),
      ...(node.by.id === me.id ? { mine: true as const } : {}),
      ...(paper ? { paper } : {}),
      ...(node.type ? { type: node.type } : {}),
      ...(type
        ? {
            typeLabel: type.label,
            ...(type.abbreviation ? { abbreviation: type.abbreviation } : {}),
            ...(type.base ? { base: type.base } : {}),
            ...(ownColor(type) ? { color: ownColor(type)! } : {}),
          }
        : {}),
    };
  };

  /**
   * Devices can each seed or import a grammar before they've synced, which is
   * normal when local comes first. The same label is the same type: the oldest
   * record speaks for it, and records using a later copy keep working. This
   * space's own record goes first, because a type also says how titles are
   * written here, and another lab's format would be wrong in this base.
   */
  const oldestByLabel = <T extends NodeTypeRecord | RelationTypeRecord>(types: T[]): T[] => {
    const kept = new Map<string, T>();
    const foreign = ({ space }: T): number => (space === localSpace ? 0 : 1);
    // A type taken out of use is no longer offered. Units that have it still read it by id.
    for (const type of [...types].filter((item) => !item.removed).sort((a, b) => foreign(a) - foreign(b) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
      const label = type.label.toLowerCase();
      if (!kept.has(label)) kept.set(label, type);
    }
    return [...kept.values()];
  };

  /** Two node types match if they're the same, or share a base type or label. */
  const sameType = (a: DgId | undefined, b: DgId): boolean => {
    if (!a) return false;
    if (a === b) return true;
    const [left, right] = [typeOf(a), typeOf(b)];
    if (left?.base !== undefined && left.base === right?.base) return true;
    return left !== undefined && left.label.toLowerCase() === right?.label.toLowerCase();
  };

  const relationOptions = (source: DgId, target: DgId): RelationOption[] => {
    const from = nodeOf(source)?.type;
    const to = nodeOf(target)?.type;
    const all = documents("relation-type");
    return oldestByLabel(all).flatMap((type) => {
      const rules = all
        .filter((other) => other.label.toLowerCase() === type.label.toLowerCase())
        .flatMap((other) => other.rules);
      const forward = rules.some(
        (rule) => sameType(from, rule.source) && sameType(to, rule.target),
      );
      const backward = rules.some(
        (rule) => sameType(to, rule.source) && sameType(from, rule.target),
      );
      return [
        ...(forward ? [{ type: type.id, label: type.label, flipped: false }] : []),
        ...(backward
          ? [{ type: type.id, label: type.complement, flipped: true }]
          : []),
      ];
    });
  };

  const relationLabel = (type: DgId): string =>
    relationTypeOf(type)?.label ?? "Related";

  /**
   * Relations live in the records, and a base's own tools only follow links in
   * its texts. So each note carries its relations as link properties, written
   * from the records and never read back.
   */
  const mirrored = new Map<HostRef, string>();
  /** What a base's own table can sort a unit by: its type, the day it was made, who by, a run's status and its paper. */
  const factsWanted = (): Map<HostRef, Record<string, string>> => {
    const byRef = new Map<HostRef, Record<string, string>>();
    for (const anchor of anchorsByNode.values()) {
      const node = nodeOf(anchor.node);
      if (!node || missingText.has(anchor.ref)) continue;
      const type = typeOf(node.type);
      const paper = node.source ? graph.documents.get(node.source.paper) : undefined;
      byRef.set(anchor.ref, {
        ...(type ? { [FACT_KEYS.type]: type.label } : {}),
        [FACT_KEYS.made]: node.at.slice(0, 10),
        [FACT_KEYS.by]: nameOf(node.by),
        ...(node.facts?.status ? { [FACT_KEYS.status]: node.facts.status } : {}),
        ...(paper?.kind === "paper" ? { [FACT_KEYS.source]: paper.title } : {}),
      });
    }
    return byRef;
  };
  const linksWanted = (): { managed: string[]; byRef: Map<HostRef, Record<string, HostRef[]>> } => {
    const managed = new Set<string>();
    for (const type of documents("relation-type")) {
      managed.add(type.label);
      managed.add(type.complement);
    }
    const byRef = new Map<HostRef, Record<string, HostRef[]>>();
    const liveRef = (id: DgId): HostRef | undefined => {
      const anchor = nodeOf(id) ? anchorsByNode.get(id) : undefined;
      return anchor && !missingText.has(anchor.ref) ? anchor.ref : undefined;
    };
    for (const anchor of anchorsByNode.values()) {
      if (nodeOf(anchor.node) && !missingText.has(anchor.ref)) byRef.set(anchor.ref, {});
    }
    for (const { record, state } of graph.relations.values()) {
      if (state !== "active" || record.proposed) continue;
      const type = relationTypeOf(record.type);
      const from = liveRef(record.source);
      const to = liveRef(record.target);
      if (!type || !from || !to || from === to) continue;
      for (const [ref, key, other] of [[from, type.label, to], [to, type.complement, from]] as const) {
        const held = byRef.get(ref)!;
        if (!(held[key] ??= []).includes(other)) held[key]!.push(other);
      }
    }
    return { managed: [...managed].filter(Boolean).sort(), byRef };
  };
  let mirroring: Promise<void> = Promise.resolve();
  let mirrorQueued = false;
  mirrorLinks = (): void => {
    if (mirrorQueued) return;
    mirrorQueued = true;
    mirroring = mirroring.then(async () => {
      mirrorQueued = false;
      const { managed, byRef } = linksWanted();
      const factsByRef = factsWanted();
      const managedFacts = Object.values(FACT_KEYS);
      for (const [ref, links] of byRef) {
        const facts = factsByRef.get(ref) ?? {};
        const wanted = canonicalJson({ managed, links, facts } as never);
        if (mirrored.get(ref) === wanted) continue;
        const done = await host.setLinks({ ref, links, managed, facts, managedFacts });
        // A note that can't be written now is tried again on the next change.
        if (done.ok) mirrored.set(ref, wanted);
      }
    });
  };
  mirrorLinks();

  const capture = async ({
    text,
    type,
  }: CaptureRequest): Promise<Result<Captured>> => {
    const nodeType = typeOf(type);
    const node = createNode({ ...stamp, title: text, ...(type ? { type } : {}) });
    const created = await host.createText({
      title: formatTitle({
        content: text,
        ...(nodeType?.titleFormat ? { format: nodeType.titleFormat } : {}),
      }),
      // A type's template is what its new note starts with.
      ...(nodeType?.template ? { body: fillTemplate(nodeType.template, { title: text, type: nodeType.label, author: me.name, date: node.at.slice(0, 10) }) } : {}),
      unit: node.id,
    });
    if (!created.ok) {
      const { code, ref } = created.error;
      if (code !== "conflict" || !ref) return created;
      // The same title again means the same idea, so link to it rather than fail.
      const known = anchorsByRef.get(ref);
      if (known) return ok({ node: known.node, ref, title: text });
      await put([node, createAnchor({ ...stamp, node: node.id, ref })]);
      return ok({ node: node.id, ref, title: text });
    }
    await put([node, createAnchor({ ...stamp, node: node.id, ref: created.value.ref })]);
    return ok({ node: node.id, ref: created.value.ref, title: text });
  };

  const captureSelection = async ({ type }: { type?: DgId }): Promise<Result<Captured>> => {
    const selection = await host.readSelection();
    if (!selection.ok) return selection;
    const text = selection.value?.text.replace(/\s+/g, " ").trim();
    if (!text) return fail("no-target", "Select some text first.");
    const captured = await capture({ text, ...(type ? { type } : {}) });
    if (!captured.ok) return captured;
    const replaced = await host.replaceSelection({ ref: captured.value.ref });
    if (!replaced.ok) return replaced;
    moveFocus(captured.value.node);
    return captured;
  };

  const convertFocused = async ({ type }: { type?: DgId }): Promise<Result<Captured>> => {
    const focus = await host.getFocus();
    if (!focus.ok) return focus;
    const { ref } = focus.value;
    if (!ref) return fail("no-target", "Open a page first.");
    const known = anchorsByRef.get(ref);
    if (known) return ok({ node: known.node, ref, title: nodeOf(known.node)?.title ?? "" });
    const text = await host.readText({ ref });
    if (!text.ok) return text;
    const content = text.value.title;
    const node = createNode({ ...stamp, title: content, ...(type ? { type } : {}) });
    const pinned = await host.pinText({ ref, unit: node.id });
    if (!pinned.ok) return pinned;
    await put([node, createAnchor({ ...stamp, node: node.id, ref: pinned.value.ref })]);
    const format = typeOf(type)?.titleFormat;
    if (format) {
      const renamed = await host.renameText({ ref: pinned.value.ref, title: formatTitle({ content, format }) });
      if (!renamed.ok) return renamed;
    }
    moveFocus(node.id);
    return ok({ node: node.id, ref: pinned.value.ref, title: content });
  };

  const onRenamed = async (ref: HostRef, title: string): Promise<void> => {
    const anchor = anchorsByRef.get(ref);
    const canvas = anchor ? canvasOf(anchor.node) : undefined;
    if (canvas) {
      const name = parseTitle({ format: canvasFormat, title }) ?? title;
      if (name === canvas.title) return;
      // A PDF canvas and its paper go by one name, so renaming the one renames the other.
      const paper = canvas.paper ? graph.documents.get(canvas.paper) : undefined;
      await put([
        revise({ record: canvas, changes: { title: name }, by: me }),
        ...(paper?.kind === "paper" && paper.title !== name ? [revise({ record: paper, changes: { title: name }, by: me })] : []),
      ]);
      return;
    }
    const node = anchor ? nodeOf(anchor.node) : undefined;
    if (!node) return;
    const format = typeOf(node.type)?.titleFormat;
    const content = (format ? parseTitle({ format, title }) : null) ?? title;
    if (content === node.title) return;
    await put([revise({ record: node, changes: { title: content }, by: me })]);
  };

  // Badges ask once per link on every draw, so the counts are worked out once per graph.
  let counted: { graph: FoldedGraph; counts: Map<DgId, number> } | undefined;
  const relationCounts = (): Map<DgId, number> => {
    if (counted?.graph === graph) return counted.counts;
    const counts = new Map<DgId, number>();
    for (const { record, state } of graph.relations.values()) {
      if (state !== "active") continue;
      for (const end of new Set([record.source, record.target])) {
        counts.set(end, (counts.get(end) ?? 0) + 1);
      }
    }
    counted = { graph, counts };
    return counts;
  };

  const moveFocus = (node: DgId | null): void => {
    if (node === focused) return;
    focused = node;
    for (const port of ports) port.send({ event: "focus-changed", node });
  };

  const unsubscribe = host.subscribe((event) => {
    switch (event.type) {
      case "records-changed":
        void pull();
        break;
      case "text-renamed": {
        // Restoring a note keeps its title, so nothing else would tell surfaces.
        const returned = missingText.delete(event.ref);
        void onRenamed(event.ref, event.title).then(() => {
          if (returned) notify();
        });
        break;
      }
      case "text-changed":
        // A hand edit to a note's link properties is put back on the next pass.
        mirrored.delete(event.ref);
        searchHooks?.invalidate(event.ref);
        break;
      case "text-removed":
        missingText.add(event.ref);
        mirrored.delete(event.ref);
        searchHooks?.invalidate(event.ref, true);
        notify();
        break;
      case "focus-changed": {
        const anchored = event.ref ? anchorsByRef.get(event.ref)?.node : undefined;
        // A page without a node keeps the last node in view, rather than blanking it.
        if (anchored && nodeOf(anchored)) {
          moveFocus(anchored);
          void holonHooks?.followNote(anchored);
        }
        break;
      }
      case "appearance-changed":
        ({ appearance, skin } = event);
        for (const port of ports) {
          port.send({ event: "appearance-changed", appearance, skin });
        }
        break;
      default:
        break;
    }
  });

  let lastCanvas: DgId | null = null;

  /** A canvas gets a page or note of its own, so the base's search and lists find it. */
  const placeHome = async (canvas: CanvasRecord): Promise<Result<HostRef>> => {
    for (let attempt = 1; attempt <= HOME_ATTEMPTS; attempt += 1) {
      const name = attempt === 1 ? canvas.title : `${canvas.title} ${attempt}`;
      const made = await host.createText({
        title: formatTitle({ content: name, format: canvasFormat }),
        body: HOME_TEXT,
        unit: canvas.id,
      });
      if (made.ok) {
        await put([createAnchor({ ...stamp, node: canvas.id, ref: made.value.ref })]);
        return ok(made.value.ref);
      }
      if (made.error.code !== "conflict") return made;
    }
    return fail("conflict", `Couldn't find a free name for "${canvas.title}".`);
  };

  const canvasHome = async (id: DgId): Promise<Result<HostRef>> => {
    const canvas = canvasOf(id);
    if (!canvas) return fail("not-found", "No such canvas.");
    const anchor = anchorsByNode.get(id);
    if (anchor && !missingText.has(anchor.ref)) return ok(anchor.ref);
    return placeHome(canvas);
  };

  const makeCanvas = async (title: string, fields: Parameters<typeof createCanvas>[0]["fields"] = {}): Promise<CanvasRecord> => {
    const canvas = createCanvas({ ...stamp, title, fields });
    await put([canvas]);
    await placeHome(canvas);
    return canvas;
  };

  /** The unit a canvas was last asked to point at, kept until that canvas collects it. */
  let pointedAt: { canvas: DgId; unit: DgId; at: number } | null = null;

  const lastUsedCanvas = async (): Promise<DgId | null> => {
    if (lastCanvas && canvasOf(lastCanvas)) return lastCanvas;
    const stored = await baseHost.getLocal({ key: LAST_CANVAS_KEY });
    const id = stored.ok && typeof stored.value === "string" ? stored.value : null;
    return id && canvasOf(id) ? id : null;
  };

  const usualCanvas = async (): Promise<DgId | null> => {
    const last = await lastUsedCanvas();
    if (last) return last;
    const [newest] = documents("canvas")
      .filter((canvas) => !canvas.removed)
      .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
    return newest?.id ?? null;
  };

  const summaryOfCanvas = (canvas: CanvasRecord): CanvasSummary => {
    const live = liveCanvasItems({ graph, canvas: canvas.id });
    return {
      id: canvas.id,
      title: canvas.title,
      cards: live.filter(({ item }) => "dg" in item && "x" in item).length,
      links: live.filter(({ item }) => "fromNode" in item).length,
      editedAt: live.reduce((latest, { editedAt }) => (editedAt > latest ? editedAt : latest), canvas.editedAt),
      credit: creditFor(canvas),
      kind: readingOf(graph, canvas.id) ? "paper" : "canvas",
    };
  };

  const setName = async (name: string): Promise<void> => {
    const person = documents("person").find((item) => item.did === identity.did);
    if (person) await put([revise({ record: person, changes: { name }, by: { ...me, name } })]);
    me = { ...me, name };
    refreshStamp();
    notify();
  };

  const removeExamples = async ({ texts, nodes, relations, canvases }: Examples): Promise<void> => {
    const fresh: DgRecord[] = [];
    const refs = new Set(texts);
    for (const id of relations) {
      const relation = graph.relations.get(id);
      if (relation && relation.state !== "withdrawn") fresh.push(retract({ ...stamp, target: id }));
    }
    for (const id of [...nodes, ...canvases]) {
      const record = nodeOf(id) ?? canvasOf(id);
      if (record) fresh.push(revise({ record, changes: { removed: true }, by: me } as never));
      const anchor = anchorsByNode.get(id);
      if (anchor) refs.add(anchor.ref);
    }
    await put(fresh);
    for (const ref of refs) await host.removeText({ ref });
  };

  let nextLocate = 0;
  const locating = new Map<number, { surface: string; done: (box: Located) => void }>();
  const locate = ({ surface, selector }: { surface: string; selector: string }): Promise<Located> =>
    new Promise((resolve) => {
      nextLocate += 1;
      const requestId = nextLocate;
      const timer = setTimeout(() => done(null), LOCATE_MS);
      const done = (box: Located): void => {
        clearTimeout(timer);
        locating.delete(requestId);
        resolve(box);
      };
      locating.set(requestId, { surface, done });
      for (const port of ports) port.send({ event: "locate", selector, requestId });
    });

  const canvasView = (id: DgId): CanvasView => {
    const canvas = canvasOf(id);
    if (!canvas) throw new Error(`No canvas ${id}`);
    const live = liveCanvasItems({ graph, canvas: id });
    const nodes: CanvasView["nodes"] = {};
    const relations: CanvasView["relations"] = {};
    for (const { item } of live) {
      const dg = (item as { dg?: { node?: DgId; relation?: DgId } }).dg;
      if (dg?.node) {
        const node = nodeOf(dg.node);
        if (node) nodes[dg.node] = summarize(node);
      }
      if (dg?.relation) {
        const relation = graph.relations.get(dg.relation);
        if (relation) {
          const kind = relationTypeOf(relation.record.type)?.base;
          relations[dg.relation] = {
            label: relationLabel(relation.record.type),
            state: relation.state,
            credit: creditFor(relation.record),
            ...(kind ? { kind } : {}),
            ...(relation.record.by.id === me.id ? { mine: true as const } : {}),
            type: relation.record.type,
            source: relation.record.source,
            target: relation.record.target,
          };
        }
      }
    }
    const paper = canvas.paper ? documents("paper").find(({ id: paperId }) => paperId === canvas.paper) : undefined;
    return {
      canvas,
      items: live.map((record) => ({ id: record.id, z: record.z, item: record.item, credit: creditFor(record), at: record.at })),
      nodes,
      relations,
      social: canvas.shared ? Object.fromEntries(Object.keys(nodes).map((node) => [node, units.social(node)])) : {},
      ...(paper ? { paper: paperSummary(paper) } : {}),
    };
  };

  const itemOf = (id: DgId): CanvasItemRecord | undefined => {
    const record = graph.documents.get(id);
    return record?.kind === "canvas-item" ? record : undefined;
  };

  const context: Context = {
    host,
    info,
    services,
    localSpace,
    titleFormat,
    graph: () => graph,
    records: () => records,
    documents,
    put,
    stamp: () => stamp,
    me: () => me,
    nodeOf,
    canvasOf,
    typeOf,
    relationTypeOf,
    nodeTypes: () => oldestByLabel(documents("node-type")),
    relationTypes: () => oldestByLabel(documents("relation-type")),
    summarize,
    creditFor,
    myLab,
    anchorOf: (node) => anchorsByNode.get(node),
    anchoredAt: (ref) => anchorsByRef.get(ref)?.node,
    hasLiveText: (ref) => !missingText.has(ref),
    makeCanvas,
    send: (event) => {
      for (const port of ports) port.send(event);
    },
    getLocal: async (key) => {
      const stored = await baseHost.getLocal({ key });
      return stored.ok ? stored.value : null;
    },
    setLocal: async (key, stored) => {
      await baseHost.setLocal({ key, value: stored as never });
    },
  };
  const { summary: paperSummary, graphOf: _graphOf, ...paperHandlers } = paperFeature(context, demoGraphs);
  const units = unitFeature(context);
  if (info.textForEveryUnit) {
    let giving: Promise<void> = Promise.resolve();
    let queued = false;
    giveNotes = (): void => {
      if (queued) return;
      queued = true;
      giving = giving.then(async () => {
        queued = false;
        // A unit that can't get a note now is tried again on the next change.
        await units.giveAll().catch(() => {});
      });
    };
    giveNotes();
  }
  const { provenance: _provenance, social: _social, ...unitHandlers } = units;
  const { shareable, take, canvasClosed, answerBreadcrumb, ...labHandlers } = labFeature(context, {
    identity: identityView,
    createLabRecord,
    joinLab,
    ...(askBreadcrumb ? { askBreadcrumb } : {}),
  });

  const onSharedCanvas = (node: DgId): boolean =>
    documents("canvas-item").some(
      (item) => !item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === node && canvasOf(item.canvas)?.shared !== undefined,
    );

  const { settings: _aiSettings, ...aiHandlers } = aiFeature(context, { ...(llm ? { llm } : {}), ...(secrets ? { secrets } : {}) });

  const holons = holonFeature(context);
  holonHooks = holons;
  const reading = readingFeature(context);
  const search = searchFeature(context);
  searchHooks = search;
  const { restsOn, ...similarHandlers } = similarFeature(context);
  const works = worksFeature(context);
  const crates = crateFeature(context, secrets ? { secrets } : {});
  const announcing = notifyFeature(context);
  const profiles = profileFeature(context, { shareable });
  const library = libraryFeature(context);
  const grammar = grammarFeature(context);
  const handlers: Handlers = {
    ...grammar.handlers,
    ...holons.handlers,
    ...aiHandlers,
    ...methodFeature(context, restsOn),
    ...similarHandlers,
    ...works.handlers,
    ...crates.handlers,
    ...announcing.handlers,
    ...profiles.handlers,
    ...paperMapFeature(context).handlers,
    ...library.handlers,
    ...reading.handlers,
    ...search.handlers,
    ...paperHandlers,
    ...unitHandlers,
    ...labHandlers,
    "node.query": async ({ text, types, limit }) => {
      const needle = text?.toLowerCase();
      return documents("node")
        .filter((node) => !node.removed)
        .filter((node) => !needle || node.title.toLowerCase().includes(needle))
        .filter((node) => !types || (node.type && types.includes(node.type)))
        .slice(0, limit)
        .map(summarize);
    },
    "node.create": async ({ title, type }) => {
      const created = value(
        await capture({ text: title, ...(type ? { type } : {}) }),
      );
      return summarize(nodeOf(created.node)!);
    },
    "node.setType": async ({ id, type }) => {
      const node = nodeOf(id);
      if (!node) throw new Error(`No node ${id}`);
      // The type goes first: the rename fires an event, and parsing that title
      // needs the new format, or the prefix would land in the node's title.
      if (type === null) {
        const { type: _gone, ...untyped } = node;
        await put([revise({ record: untyped as NodeRecord, changes: {}, by: me })]);
      } else {
        await put([revise({ record: node, changes: { type }, by: me })]);
      }
      const format = type === null ? undefined : typeOf(type)?.titleFormat;
      const anchor = anchorsByNode.get(id);
      if (anchor && (format || type === null)) {
        const renamed = await host.renameText({
          ref: anchor.ref,
          title: formatTitle({ ...(format ? { format } : {}), content: node.title }),
        });
        if (!renamed.ok && renamed.error.code !== "conflict") {
          throw new Error(renamed.error.message);
        }
      }
      return summarize(nodeOf(id)!);
    },
    "node.remove": async ({ id }) => {
      const node = nodeOf(id);
      if (!node || node.removed) return null;
      if (node.by.id !== me.id) throw new Error(`Only ${nameOf(node.by)} can remove this unit.`);
      const cards = documents("canvas-item").filter((item) => !item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === id);
      const home = anchorsByNode.get(id);
      await put([revise({ record: node, changes: { removed: true }, by: me }), ...cards.map((card) => revise({ record: card, changes: { removed: true }, by: me }))]);
      if (home && !missingText.has(home.ref)) await host.removeText({ ref: home.ref });
      return null;
    },
    "node.rename": async ({ id, title: wanted }) => {
      const node = nodeOf(id);
      if (!node || node.removed) throw new Error("That unit is gone.");
      if (node.by.id !== me.id) throw new Error(`Only ${nameOf(node.by)} can rename this unit.`);
      const title = wanted.replace(/\s+/g, " ").trim();
      if (!title) throw new Error("A unit needs a title.");
      if (title === node.title) return summarize(node);
      // The record goes first, so the rename's own event finds nothing left to change.
      // A unit a model read keeps the model's wording beside the person's, from the first rewording on.
      const source = node.source && node.source.asRead === undefined ? { ...node.source, asRead: node.title } : node.source;
      const back = source?.asRead === title;
      const { asRead: _kept, ...plainSource } = source ?? ({} as NonNullable<typeof source>);
      await put([revise({ record: node, changes: { title, ...(source ? { source: back ? plainSource : source } : {}) }, by: me })]);
      const anchor = anchorsByNode.get(id);
      if (anchor && !missingText.has(anchor.ref)) {
        const format = typeOf(node.type)?.titleFormat;
        const renamed = await host.renameText({ ref: anchor.ref, title: formatTitle({ ...(format ? { format } : {}), content: title }) });
        if (!renamed.ok) {
          await put([revise({ record: nodeOf(id)!, changes: { title: node.title }, by: me })]);
          throw new Error(renamed.error.code === "conflict" ? `There's already a note called "${title}".` : renamed.error.message);
        }
      }
      return summarize(nodeOf(id)!);
    },
    "node.insertLink": async ({ id }) => {
      const anchor = anchorsByNode.get(id);
      if (!anchor || missingText.has(anchor.ref)) throw new Error("This unit has no note to link to yet.");
      value(await host.insertLink({ ref: anchor.ref }));
      return null;
    },
    "node.view": async ({ id }) => {
      const node = nodeOf(id);
      if (!node) throw new Error(`No node ${id}`);
      const anchor = anchorsByNode.get(id);
      const text = anchor ? await host.readText({ ref: anchor.ref }) : null;
      const related = new Set<string>([...graph.relations.values()].flatMap(({ record }) => (record.source === id ? [record.target] : record.target === id ? [record.source] : [])));
      return {
        node: summarize(node),
        body: text?.ok ? text.value.body : null,
        context: [...graph.relations.values()]
          .filter(({ record }) => record.source === id || record.target === id)
          .flatMap(({ record, state }) => {
            const other = nodeOf(record.source === id ? record.target : record.source);
            return other
              ? [
                  {
                    relation: record,
                    label:
                      record.source === id
                        ? relationLabel(record.type)
                        : (relationTypeOf(record.type)?.complement ?? relationLabel(record.type)),
                    state,
                    other: summarize(other),
                  },
                ]
              : [];
          }),
        mentionedIn: anchor
          ? value(await host.listBacklinks({ ref: anchor.ref }))
              // A related unit's note links here through its properties, and is already listed as a relation.
              .filter(({ ref }) => !related.has(anchorsByRef.get(ref)?.node ?? ""))
              .map(({ title }) => ({ title }))
          : [],
        attribution: {
          person: nameOf(node.by),
          ...(labOf(node) ? { lab: labOf(node)!.name } : {}),
        },
        provenance: await (async () => {
          const pdf = await reading.pdfOf(node);
          const work = works.viewOf(node);
          const inLibrary = library.linkOf(node);
          return { ...units.provenance(node), ...(pdf ? { pdf } : {}), ...(work ? { work } : {}), ...(inLibrary ? { library: inLibrary } : {}) };
        })(),
        ...(onSharedCanvas(id) ? { social: units.social(id) } : {}),
      };
    },
    "relation.options": async ({ source, target }) => relationOptions(source, target),
    "relation.assert": async ({ type, source, target, draw }) => {
      const allowed = relationOptions(source, target).some(
        (option) => option.type === type && !option.flipped,
      );
      if (!allowed) throw new Error("The grammar doesn't allow this relation.");
      const existing = [...graph.relations.values()].find(
        ({ record, state }) =>
          record.type === type &&
          record.source === source &&
          record.target === target &&
          (state === "active" || state === "pending"),
      );
      const relation = existing?.record ?? assertRelation({ ...stamp, type, source, target });
      // Stated away from a canvas, it's drawn on each of the person's canvases that holds both units.
      const edges: DgRecord[] = [];
      if (draw) {
        for (const canvas of documents("canvas")) {
          if (canvas.removed || canvas.by.id !== me.id) continue;
          // A PDF canvas shows it only when both ends are its own paper's units.
          const reading = readingOf(graph, canvas.id);
          if (reading && ![source, target].every((unit) => { const node = nodeOf(unit); return node && ofPaper(graph, node, reading); })) continue;
          const live = liveCanvasItems({ graph, canvas: canvas.id });
          const cardOf = (unit: DgId) => live.find((item) => (item.item as { dg?: { node?: DgId } }).dg?.node === unit)?.id;
          const [fromNode, toNode] = [cardOf(source), cardOf(target)];
          if (!fromNode || !toNode) continue;
          if (live.some((item) => (item.item as { dg?: { relation?: DgId } }).dg?.relation === relation.id)) continue;
          const z = Math.max(0, ...live.map((item) => item.z)) + 1;
          edges.push(createCanvasItem({ ...stamp, canvas: canvas.id, item: { fromNode, toNode, dg: { relation: relation.id } } as never, z }));
        }
      }
      if (!existing || edges.length) await put([...(existing ? [] : [relation]), ...edges]);
      return existing ? relation : { ...relation, made: true as const };
    },
    "relation.withdraw": async ({ id, reason }) => {
      await put([retract({ ...stamp, target: id, ...(reason ? { reason } : {}) })]);
      return null;
    },
    "relation.decide": async ({ id, decision }) => {
      await put([decide({ ...stamp, target: id, decision })]);
      return null;
    },
    "canvas.list": async () => documents("canvas").filter((canvas) => !canvas.removed),
    "canvas.summaries": async () =>
      documents("canvas")
        .filter((canvas) => !canvas.removed)
        .map(summaryOfCanvas)
        .sort((a, b) => b.editedAt.localeCompare(a.editedAt)),
    "canvas.create": async ({ title }) => makeCanvas(title),
    "canvas.remove": async ({ id }) => {
      const canvas = canvasOf(id);
      if (!canvas || canvas.removed) return null;
      if (canvas.by.id !== me.id) throw new Error(`Only ${nameOf(canvas.by)}, who made this canvas, can remove it.`);
      if (canvas.paper) throw new Error("This is a paper's own canvas. It stays while the paper does.");
      const home = anchorsByNode.get(id);
      await put([revise({ record: canvas, changes: { removed: true }, by: me })]);
      // Its note goes to the base's trash, where it can still be got back. The units on it are untouched.
      if (home && !missingText.has(home.ref)) await host.removeText({ ref: home.ref });
      if (lastCanvas === id) lastCanvas = null;
      return null;
    },
    "canvas.show": async ({ id }) => {
      value(await canvasHome(id));
      value(await host.openSurface({ route: { surface: "canvas", id }, placement: "main" }));
      return null;
    },
    "canvas.reveal": async ({ id, unit }) => {
      pointedAt = { canvas: id, unit, at: Date.now() };
      value(await canvasHome(id));
      value(await host.openSurface({ route: { surface: "canvas", id }, placement: "main" }));
      for (const port of ports) port.send({ event: "reveal-unit", canvas: id, unit });
      return null;
    },
    "canvas.revealed": async ({ id }) => {
      const asked = pointedAt;
      if (!asked || asked.canvas !== id) return null;
      pointedAt = null;
      // Only a request just made: a canvas opened later on its own points at nothing.
      return Date.now() - asked.at < 15000 ? asked.unit : null;
    },
    "canvas.setLayout": async ({ id, layout }) => {
      const canvas = canvasOf(id);
      if (canvas) await put([revise({ record: canvas, changes: { layout, needsLayout: false }, by: me })]);
      return null;
    },
    "canvas.open": async ({ id }) => {
      const view = canvasView(id);
      if (lastCanvas !== id) {
        lastCanvas = id;
        await baseHost.setLocal({ key: LAST_CANVAS_KEY, value: id });
      }
      return view;
    },
    "canvas.last": async () => lastUsedCanvas(),
    "canvas.place": async ({ node }) => {
      for (const port of ports) port.send({ event: "place-node", node });
      return null;
    },
    "canvas.write": async ({ canvas, upserts = [], removes = [], restores = [] }) => {
      const fresh: DgRecord[] = [];
      const ids: DgId[] = [];
      // A PDF canvas holds only what comes from its paper: its units, and relations between them.
      const reading = readingOf(graph, canvas);
      if (reading) {
        const fits = upserts.every(({ id, item }) => {
          const existing = id ? itemOf(id) : undefined;
          return existing ? sameThing(existing.item, item) : mayJoin(graph, reading, item);
        });
        if (!fits) throw refusal(reading);
      }
      for (const { id, item, z } of upserts) {
        const existing = id ? itemOf(id) : undefined;
        if (!existing) {
          const record = createCanvasItem({ ...stamp, canvas, item, z });
          fresh.push(record);
          ids.push(record.id);
          continue;
        }
        ids.push(existing.id);
        const next = { ...item, id: existing.id } as CanvasItemRecord["item"];
        if (
          canonicalJson(next) === canonicalJson(existing.item) &&
          z === existing.z
        ) {
          continue;
        }
        fresh.push(
          revise({ record: existing, changes: { item: next, z }, by: me }),
        );
      }
      for (const id of removes) {
        const existing = itemOf(id);
        if (existing && !existing.removed) {
          fresh.push(
            revise({ record: existing, changes: { removed: true }, by: me }),
          );
        }
      }
      for (const id of restores) {
        const existing = itemOf(id);
        if (existing?.removed) {
          fresh.push(
            revise({ record: existing, changes: { removed: false }, by: me }),
          );
        }
      }
      if (fresh.length > 0) await put(fresh);
      return { ids };
    },
    "canvas.buildOn": async ({ id, title: wanted }) => {
      const from = canvasOf(id);
      if (!from || from.removed) throw new Error("That canvas is gone.");
      const taken = new Set(documents("canvas").filter((canvas) => !canvas.removed).map((canvas) => canvas.title));
      const base = wanted?.trim() || `Building on ${from.title}`;
      let name = base;
      for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
      const made = await makeCanvas(name);
      // The same units, drawn again: cards first, so links can point at the new cards.
      const live = liveCanvasItems({ graph, canvas: id });
      const cardOf = new Map<DgId, DgId>();
      const copies: DgRecord[] = [];
      for (const record of live) {
        if ("fromNode" in record.item) continue;
        const { id: _old, ...item } = record.item as CanvasItem & { id: DgId };
        const copy = createCanvasItem({ ...stamp, canvas: made.id, item: item as never, z: record.z });
        cardOf.set(record.id, copy.id);
        copies.push(copy);
      }
      for (const record of live) {
        if (!("fromNode" in record.item)) continue;
        const { id: _old, ...item } = record.item as CanvasItem & { id: DgId; fromNode: DgId; toNode: DgId };
        const [fromNode, toNode] = [cardOf.get(item.fromNode), cardOf.get(item.toNode)];
        if (fromNode && toNode) copies.push(createCanvasItem({ ...stamp, canvas: made.id, item: { ...item, fromNode, toNode } as never, z: record.z }));
      }
      if (copies.length) await put(copies);
      if (from.layout) await put([revise({ record: canvasOf(made.id)!, changes: { layout: from.layout }, by: me })]);
      return { id: made.id, title: name };
    },
    "canvas.export": async ({ id }) => {
      const doc = buildCanvas({ graph, canvas: id });
      return {
        edges: doc.edges,
        nodes: doc.nodes.map((node) => {
          if (node.type !== "text" || !node.dg) return node;
          return { ...node, text: nodeOf(node.dg.node)?.title ?? node.text };
        }),
      };
    },
    "panel.open": async ({ surface }) => {
      value(await host.openSurface({ route: { surface }, placement: "side" }));
      return null;
    },
    "dialog.open": async ({ surface, id }) => {
      value(await host.openSurface({ route: { surface, ...(id ? { id } : {}) }, placement: "dialog" }));
      return null;
    },
    "dialog.close": async () => {
      value(await host.closeDialog());
      return null;
    },
    "server.list": async () => (services ? services.servers() : []),
    "server.add": async (server) => {
      if (!services) throw new Error("No services are set up here.");
      return services.addServer(server);
    },
    "server.remove": async ({ id }) => {
      await services?.removeServer(id);
      return null;
    },
    "server.check": async ({ url }) => {
      if (!services) throw new Error("No services are set up here.");
      return services.check(url);
    },
    "server.options": async ({ url }) => {
      if (!services) throw new Error("No services are set up here.");
      const [models, schemas] = await Promise.all([services.models(url), services.schemas(url)]);
      return { models, schemas };
    },
    "identity.get": async () => identityView(),
    "lab.create": async ({ name }) => createLabRecord(name),
    "lab.join": async () => joinLab(),
    "identity.setName": async ({ name }) => {
      await setName(name);
      return identityView();
    },
    "focus.get": async () => focused,
    "focus.set": async ({ node }) => {
      moveFocus(node);
      return null;
    },
    "grammar.get": async () => ({
      nodeTypes: oldestByLabel(documents("node-type")),
      relationTypes: oldestByLabel(documents("relation-type")),
      uses: grammar.uses(),
      tables: Boolean(host.openTable),
    }),
    "link.open": async ({ url }) => {
      // A panel is sandboxed, so the base opens links for it. Nothing but a web address gets through.
      // A reference library's own links open its desktop app at an item or a passage.
      if (!/^(https?:\/\/|zotero:\/\/(select|open-pdf)\/)[^\s]+$/i.test(url)) throw new Error("That isn't a web address.");
      value(await host.openLink({ url }));
      return null;
    },
    "base.reveal": async ({ id, placement }) => {
      const anchor = anchorsByNode.get(id);
      if (!anchor) throw new Error("This node has no text in this space.");
      value(await host.reveal({ ref: anchor.ref, placement }));
      return null;
    },
  };

  const answer = async (
    port: SurfacePort,
    message: Extract<SurfaceMessage, { method: string }>,
  ): Promise<void> => {
    const started = Date.now();
    const handler = handlers[message.method] as
      | ((params: unknown) => Promise<unknown>)
      | undefined;
    try {
      if (!handler) throw new Error(`No method ${message.method}`);
      const result = await handler(message.params);
      port.send({ id: message.id, ok: true, result });
      logUsage({
        op: `surface:${message.method}`,
        ok: true,
        ms: Date.now() - started,
        at: new Date(started).toISOString(),
      });
    } catch (error) {
      port.send({
        id: message.id,
        ok: false,
        error: { code: "invalid", message: error instanceof Error ? error.message : String(error) },
      });
      logUsage({
        op: `surface:${message.method}`,
        ok: false,
        code: "invalid",
        ms: Date.now() - started,
        at: new Date(started).toISOString(),
      });
    }
  };

  return {
    info,
    graph: () => graph,
    identity: () => identityView(),
    plc: () => identity.plc,
    createLab: createLabRecord,
    joinLab,
    atRecords: async () => {
      const latest: DgRecord[] = [
        ...[...graph.documents.values()].filter((record) => !("removed" in record && record.removed)),
        ...[...graph.relations.values()].map(({ record }) => record),
      ];
      return Promise.all(
        latest.flatMap((record) => {
          const projected = toAtRecord(record, graph);
          return projected ? [cidOf(projected.value).then((cid) => ({ ...projected, cid }))] : [];
        }),
      );
    },
    importAtRecords: async (records) => {
      await pull();
      const fresh = planAtImport({ records, graph, space: localSpace, by: me });
      if (fresh.length > 0) await put(fresh);
      return fresh.length;
    },
    importExisting: async ({ existing, dryRun = false }) => {
      await pull();
      const plan = planImport({ existing, graph, space: localSpace, by: me });
      if (!dryRun && plan.records.length > 0) await put(plan.records);
      return plan.report;
    },
    flushUsage,
    stop: () => {
      unsubscribe();
      if (flushTimer) clearTimeout(flushTimer);
      void flushUsage();
      ports.clear();
      listeners.clear();
    },
    nodeTypes: () => oldestByLabel(documents("node-type")),
    capture,
    captureSelection,
    convertFocused,
    badgeFor: ({ ref }) => {
      const anchor = badgesShown ? anchorsByRef.get(ref) : undefined;
      const node = anchor ? nodeOf(anchor.node) : undefined;
      if (!node) return null;
      const type = typeOf(node.type);
      return {
        node: node.id,
        count: relationCounts().get(node.id) ?? 0,
        ...(type ? { typeLabel: type.label } : {}),
        ...(type?.base ? { base: type.base } : {}),
        ...(ownColor(type) ? { color: ownColor(type)! } : {}),
      };
    },
    showContext: async ({ ref }) => {
      const anchor = anchorsByRef.get(ref);
      if (!anchor) return fail("not-found", "This text isn't a node.");
      const opened = await host.openSurface({ route: { surface: "context" }, placement: "side" });
      if (!opened.ok) return opened;
      moveFocus(anchor.node);
      return ok(null);
    },
    canvasOfRef: ({ ref }) => {
      const anchored = anchorsByRef.get(ref)?.node;
      return anchored && canvasOf(anchored) ? anchored : null;
    },
    canvasHome: ({ id }) => canvasHome(id),
    canvasTitle: ({ id }) => canvasOf(id)?.title ?? null,
    createCanvas: async ({ title }) => ok((await makeCanvas(title)).id),
    usualCanvas,
    focusedNode: () => focused,
    setName,
    shareable,
    take,
    focusCanvas: (id) => holons.focusCanvas(id),
    unitTitle: (id) => nodeOf(id)?.title.replace(/\[\[([^\]]+)\]\]/g, "$1") ?? null,
    importNotebook: (args) => handlers["notebook.import"](args),
    savedExtraction: (args) => handlers["paper.saved"](args),
    extractPaper: (args) => handlers["paper.extract"](args),
    showCanvas: (id) => handlers["canvas.show"]({ id }),
    importCrate: (args) => handlers["crate.import"](args),
    exportCrate: (args) => handlers["crate.export"](args),
    ai: {
      settings: () => handlers["ai.settings"]({}),
      configure: (changes) => handlers["ai.configure"](changes),
      models: (args) => handlers["ai.models"](args),
      test: () => handlers["ai.test"]({}),
    },
    prefs: () => holons.prefs(),
    setPrefs: (changes) => holons.setPrefs(changes),
    canvasClosed,
    answerBreadcrumb,
    personName: () => me.name,
    removeExamples,
    locate,
    addToCanvas: async ({ canvas, nodes }) => {
      const start = liveCanvasItems({ graph, canvas }).length;
      await put(
        nodes.flatMap((node, index) => {
          const record = nodeOf(node);
          if (!record) return [];
          const spot = { x: (index % 2) * 330, y: Math.floor(index / 2) * 170 };
          const item = { type: "text" as const, text: record.title, ...spot, width: 240, height: 96, dg: { node } };
          return [createCanvasItem({ ...stamp, canvas, item, z: start + index + 1 })];
        }),
      );
    },
    relateOnCanvas: async ({ canvas, source, target, base }) => {
      const options = relationOptions(source, target).filter((option) => !option.flipped);
      const option = base ? options.find(({ type }) => relationTypeOf(type)?.base === base) : options[0];
      if (!option) return fail("not-found", "The grammar has no such relation.");
      const relation = await handlers["relation.assert"]({ type: option.type, source, target });
      const live = liveCanvasItems({ graph, canvas });
      const cardOf = (node: DgId): CanvasItemRecord | undefined =>
        live.find(({ item }) => (item as { dg?: { node?: DgId } }).dg?.node === node);
      const [from, to] = [cardOf(source), cardOf(target)];
      if (from && to) {
        const item = { fromNode: from.id, toNode: to.id, dg: { relation: relation.id } };
        await put([createCanvasItem({ ...stamp, canvas, item, z: live.length + 1 })]);
      }
      return ok(relation.id);
    },
    badgesOn: () => badgesShown,
    usageCount: () => usage.length,
    clearUsage: async () => {
      usage.length = 0;
      await flushUsage();
    },
    toggleBadges: async () => {
      badgesShown = !badgesShown;
      await host.setLocal({ key: BADGES_KEY, value: badgesShown });
      notify();
      return badgesShown;
    },
    onGraphChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connectSurface: ({ port, onReport }) => {
      ports.add(port);
      port.send({ event: "appearance-changed", appearance, skin });
      const stop = port.onMessage((message) => {
        if ("event" in message) {
          if (message.event === "located") {
            const waiting = locating.get(message.requestId);
            if (waiting?.surface === message.surface) waiting.done(message.box);
            return;
          }
          const report = message as unknown as { event: string; data: unknown };
          if (report.event === "panel-report") onReport?.(report.data);
          return;
        }
        if ("method" in message) void answer(port, message);
      });
      return () => {
        ports.delete(port);
        stop();
      };
    },
  };
};

