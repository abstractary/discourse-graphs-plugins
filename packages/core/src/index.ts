import { isLibraryRef, type LibraryFile, type LibraryStatus } from "@dg/contract/scholarly.ts";
import { cardFacts, inLibraryOf, paperIdentifiers } from "./card.ts";
import type { CardFacts } from "@dg/contract/scholarly.ts";
import type { CrateExported, CrateImported, CanvasCommand } from "@dg/contract/surface.ts";
import {
  canonicalJson,
  createLab,
  createMembership,
  clock,
  createDevice,
  createPerson,
  defaultGrammar,
  foldRecords,
  isDocument,
  retract,
  revise,
  type AnchorRecord,
  type Author,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type HostRef,
  type JsonObject,
  type LabRecord,
  type MembershipRecord,
  type NodeRecord,
  type PaperRecord,
  type NodeTypeRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import { CONTRACT_VERSION, fail, ok, type Asset, type Host, type HostInfo, type Result } from "@dg/contract/host.ts";
import type { CoreForAdapter, Examples } from "@dg/contract/core.ts";
import type { ExtractionGraph, Services } from "@dg/contract/services.ts";
import type {
  Credit,
  IdentityView,
  Prefs,
  NodeSummary,
  RelationOption,
  SurfaceMessage,
  SurfaceMethods,
  NotebookImported,
  SurfacePort } from "@dg/contract/surface.ts";
import { withUsageLog, type UsageEvent } from "@dg/contract/usage.ts";
import { atUriOf, cidOf, toAtRecord, type AtRecord } from "@dg/contract/atproto.ts";
import { DEFAULT_PREFS, holonFeature } from "./holons.ts";
import { paperOfWork } from "./work.ts";
import { readingFeature } from "./reading.ts";
import { searchFeature } from "./search.ts";
import {
  addCustodian,
  createIdentity,
  createLabIdentity,
  didKeyFor,
  makeKeys,
  memoryKeys,
  type Identity,
  type KeyStore } from "./identity.ts";
import { deviceFeature } from "./devices.ts";
import { relationFeature } from "./relations.ts";
import { shellFeature } from "./shell.ts";
import { proposalFeature } from "./proposals.ts";
import { signerOf, signingKeyOf, signRecord } from "./signing.ts";
import { planAtImport, planImport, type ExistingGraph, type ImportReport } from "./migrate.ts";
import type { Context, Handlers, Offers } from "./context.ts";
import { canvasFeature, canvasHomes } from "./canvases.ts";
import { captureFeature } from "./capture.ts";
import { mirrorFeature } from "./mirror.ts";
import { nodeFeature } from "./nodes.ts";
import { codeOf, value } from "./refuse.ts";
import { labFeature } from "./labs.ts";
import { aiFeature } from "./ai.ts";
import { methodFeature } from "./method.ts";
import { similarFeature } from "./similar.ts";
import { worksFeature } from "./works.ts";
import { crateFeature } from "./crate.ts";
import { CHECK_WAYS } from "@dg/contract/surface.ts";
import { checkFeature } from "./checks.ts";
import { gatherFeature } from "./gather.ts";
import { grammarFeature } from "./grammar.ts";
import { notifyFeature } from "./notify.ts";
import { profileFeature } from "./profile.ts";
import { paperMapFeature } from "./papermap.ts";
import { libraryFeature } from "./library.ts";
import type { AiModel, AiSettings, Llm, SecretStore } from "@dg/contract/llm.ts";
import { paperFeature, paperLabel } from "./papers.ts";
import { ownColor, paperSource } from "./process.ts";
import { unitFeature } from "./units.ts";

const USAGE_KEY = "usage";
const BADGES_KEY = "link-badges";
const LOCATE_MS = 400;

type Located = { x: number; y: number; width: number; height: number } | null;
const USAGE_LIMIT = 2000;
const CLOCK_KEY = "clock-offset";
const USAGE_FLUSH_MS = 2000;


/** What a plugin needs beside the core itself. Plugins import only from this file. */
export { browserKeys } from "./identity.ts";
export type { ExistingGraph } from "./migrate.ts";

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
  /** For an agent: the conversation it is in, so its proposals can be answered together. */
  setSession: (name: string) => void;
  /** Signs what this person wrote before signing existed, so it can be shared. */
  prepare: () => Promise<void>;
  serverTime: (now: string) => void;
  /** The base says which canvas is in front, so the boundary panel can follow it. */
  focusCanvas: (id: DgId) => Promise<void>;
  /** Whether the reference library can be reached, for the base's own settings screen. */
  zoteroStatus: () => Promise<LibraryStatus>;
  /** Whether the reference library is the PDF library, and how many PDFs it holds. */
  pdfLibrary: () => Promise<{ on: boolean; wanted: boolean; reachable: boolean; files: number; problem?: string }>;
  /** Passes on something the base's command palette or a hotkey asked of one canvas. */
  command: (canvas: DgId, name: CanvasCommand) => void;
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
  role = "device",
  agentName }: {
  /**
   * `agent` is for a server acting for a person at an agent's request. It has a key of its own, and
   * everything that key signs is read as a proposal by every other reader of the vault.
   */
  role?: "device" | "agent";
  /** What the person will see the agent called, such as the client's name. */
  agentName?: string;
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
      value: usage.slice(-USAGE_LIMIT) as unknown as never });
  };
  const logUsage = (event: UsageEvent): void => {
    usage.push(event);
    flushTimer ??= setTimeout(() => void flushUsage(), USAGE_FLUSH_MS);
  };
  const host = withUsageLog({ host: baseHost, record: logUsage });

  const info = value(await host.describe());
  if (info.contract !== CONTRACT_VERSION) throw new Error(`This base speaks version ${String(info.contract)} of the host contract, and this core speaks ${CONTRACT_VERSION}.`);
  const localSpace = info.space.id;
  const badgeSetting = await baseHost.getLocal({ key: BADGES_KEY });
  let badgesShown = !(badgeSetting.ok && badgeSetting.value === false);
  // Replaced below, once records are read and this person's DID is known.
  let me: Author = info.person;
  let stamp: { space: string; by: Author; lab?: string } = { space: localSpace, by: me };

  const records: DgRecord[] = [];
  const seen = new Set<string>();
  const offers: Offers = {};
  const missingText = new Set<HostRef>();
  let { appearance, skin } = info;
  let focused: DgId | null = null;
  // Set for an agent once its key is known: it reads what it proposed in place.
  let ownKey: string | undefined;
  let graph: FoldedGraph = foldRecords({ records, localSpace });
  let anchorsByRef = new Map<HostRef, AnchorRecord>();
  let anchorsByNode = new Map<DgId, AnchorRecord>();
  let cursor: string | undefined;
  let trustedLab: string | undefined;

  const listeners = new Set<() => void>();
  const ports = new Set<SurfacePort>();
  const afterChange = new Set<() => void>();
  const notify = (): void => {
    for (const run of afterChange) run();
    for (const listener of listeners) listener();
    for (const port of ports) port.send({ event: "graph-changed" });
  };

  const keyOf = (record: DgRecord): string =>
    isDocument(record) ? `${record.id}:${canonicalJson(record)}` : `${record.id}:${record.sig ? 1 : 0}`;

  /**
   * After a person leaves a lab or is taken out of it, what its other members shared is put away on
   * this device: it is no longer read into the graph. Their own work stays. The records stay in the
   * log, because what was sent can't be unsent, and they are read again if the person comes back.
   */
  // What was just put away and still has a note or page here, to be taken out of the base as well.
  let awayNow: DgId[] = [];
  const putAway = (): void => {
    awayNow = [];
    const mine = [...graph.documents.values()].filter((record): record is MembershipRecord => record.kind === "membership" && record.member === me.id);
    const left = new Set(mine.filter((item) => item.removed).map((item) => item.lab));
    for (const item of mine) if (!item.removed) left.delete(item.lab);
    if (left.size === 0) return;
    for (const [id, record] of graph.documents) {
      if (record.kind === "lab" || record.kind === "person" || record.kind === "membership") continue;
      const theirs = record.by.id !== me.id && record.lab !== undefined && left.has(record.lab);
      const shared = record.kind === "canvas" && record.by.id !== me.id && record.shared !== undefined && left.has(record.shared);
      if (theirs || shared) {
        graph.documents.delete(id);
        awayNow.push(id);
      }
    }
    for (const [id, { record }] of graph.relations) if (record.by.id !== me.id && record.lab !== undefined && left.has(record.lab)) graph.relations.delete(id);
  };

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
    graph = foldRecords({ records, localSpace, ...(trustedLab ? { trustedLab } : {}), ...(ownKey ? { ownKey } : {}) });
    const joined = [...graph.documents.values()].find(
      (record) => record.kind === "membership" && record.member === me.id,
    ) as { lab: string } | undefined;
    if (joined && joined.lab !== trustedLab) {
      trustedLab = joined.lab;
      graph = foldRecords({ records, localSpace, trustedLab, ...(ownKey ? { ownKey } : {}) });
    }
    putAway();
    anchorsByRef = new Map();
    anchorsByNode = new Map();
    for (const record of graph.documents.values()) {
      if (record.kind === "anchor" && record.space === localSpace) {
        anchorsByRef.set(record.ref, record);
        anchorsByNode.set(record.node, record);
      }
    }
    // Their notes or pages go to the base's trash, where they can still be got back.
    for (const id of awayNow) {
      const home = anchorsByNode.get(id);
      if (home && !missingText.has(home.ref)) {
        missingText.add(home.ref);
        void host.removeText({ ref: home.ref });
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

  // This device's own correction to its clock, and the latest time it has stamped. Several cores can
  // share a process in a simulation, so each puts its own in place before it stamps anything.
  let clockOffset = 0;
  let clockFloor = 0;
  // This device's signing key, once its person is known. What this person writes is signed on its way in.
  let signer: { did: string; pair: CryptoKeyPair; key?: string } | null = null;
  // The conversation an agent is in, so what it proposes can be answered together.
  let session = "";
  const signed = async (fresh: DgRecord[]): Promise<DgRecord[]> => {
    const by = signer;
    if (!by) return fresh;
    return Promise.all(
      fresh.map((record) => {
        if (record.sig || signerOf(record) !== by.did) return record;
        const marked = role === "agent" && record.kind !== "device" ? { ...record, ext: { ...(record.ext ?? {}), agent: agentName ?? "An agent", ...(session ? { session } : {}) } } : record;
        return signRecord(marked, by.pair, keys, by.key);
      }),
    );
  };
  const put = async (fresh: DgRecord[]): Promise<void> => {
    clock.offsetMs = clockOffset;
    clock.floorMs = Math.max(clock.floorMs, clockFloor);
    const ready = await signed(fresh);
    clockFloor = clock.floorMs;
    value(await host.putRecords({ records: ready }));
    if (absorb(ready)) notify();
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
        plc: fresh.plc }),
    ]);
    return fresh;
  };
  let identity = await loadIdentity();
  // The key this person's DID was made with stays on the device that made it. Any other device of
  // theirs has a key of its own, and signs with that once a trusted device has vouched for it.
  let deviceKey: string | null = null;
  {
    const first = await keys.get(`signing:${identity.did}`);
    let pair = first ?? (await keys.get(`device:${identity.did}`));
    if (!pair) {
      pair = await makeKeys(keys);
      await keys.put(`device:${identity.did}`, pair);
    }
    // An agent never signs with the key the person's DID was made with, even on the device that holds it.
    if (!first || role === "agent") {
      if (first) {
        pair = (await keys.get(`agent:${identity.did}`)) ?? (await makeKeys(keys));
        await keys.put(`agent:${identity.did}`, pair);
      }
      deviceKey = await didKeyFor(pair);
    }
    const person = documents("person").find((item) => item.did === identity.did);
    const key = deviceKey ?? (person ? ((await signingKeyOf(person)) ?? undefined) : undefined);
    signer = { did: identity.did, pair, ...(key ? { key } : {}) };
    if (role === "agent") {
      ownKey = deviceKey ?? undefined;
      graph = foldRecords({ records, localSpace, ...(ownKey ? { ownKey } : {}) });
    }
  }
  me = {
    id: identity.did,
    name: documents("person").find((person) => person.did === identity.did)?.name ?? info.person.name };
  // A device other than the first says so in the log, so a trusted device can vouch for it.
  if (deviceKey && !documents("device").some((device) => device.key === deviceKey)) {
    await put([createDevice({ space: localSpace, by: me, key: deviceKey, name: role === "agent" ? (agentName ?? "An agent") : `${info.host} ${deviceKey.slice(-4)}`, role })]);
  }

  const myLab = (): LabRecord | undefined => {
    const joined = documents("membership").find((item) => item.member === identity.did && !item.removed);
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
      ...(!lab && available ? { availableLab: { name: available.name, custodian: available.custodian } } : {}) };
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
      plc: labIdentity.plc });
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
    // Coming back after being taken out is a new membership. The ended one stays ended.
    await put([createMembership({ space: localSpace, by: me, lab: lab.did, member: identity.did })]);
    refreshStamp();
    await adoptLabGrammar();
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
  // A type that gave way to the lab's is read as the lab's, so a member's earlier units follow the lab's grammar.
  const typeOf = (id: DgId | undefined): NodeTypeRecord | undefined => {
    let record = id ? graph.documents.get(id) : undefined;
    for (let hops = 0; hops < 4 && record?.kind === "node-type" && record.replacedBy; hops += 1) {
      const next = graph.documents.get(record.replacedBy);
      if (next?.kind !== "node-type") break;
      record = next;
    }
    return record?.kind === "node-type" ? record : undefined;
  };
  const relationTypeOf = (id: DgId): RelationTypeRecord | undefined => {
    let record = graph.documents.get(id);
    for (let hops = 0; hops < 4 && record?.kind === "relation-type" && record.replacedBy; hops += 1) {
      const next = graph.documents.get(record.replacedBy);
      if (next?.kind !== "relation-type") break;
      record = next;
    }
    return record?.kind === "relation-type" ? record : undefined;
  };

  /**
   * A lab has one grammar, its PI's. When a member joins, each of their own types that the lab also
   * has gives way to the lab's: it is taken out of use and points at the lab's, and everything that
   * carries it is read as the lab's from then on. A type only the member has stays theirs.
   */
  const adoptLabGrammar = async (): Promise<void> => {
    // The grammar is the person's to settle. An agent only reads it.
    if (role === "agent") return;
    const lab = myLab();
    if (!lab) {
      // Out of the lab again: the person's own types come back into use. Units made with the lab's keep reading by them.
      const back = [...documents("node-type"), ...documents("relation-type")].filter((type) => type.by.id === me.id && type.removed && type.replacedBy);
      if (back.length > 0) {
        await put(back.map((type) => {
          const { replacedBy: _lab, removed: _gone, ...own } = revise({ record: type as NodeTypeRecord, changes: {}, by: me });
          return own as DgRecord;
        }));
      }
      return;
    }
    if (lab.custodian === me.id) return;
    const fresh: DgRecord[] = [];
    for (const kind of ["node-type", "relation-type"] as const) {
      const all = documents(kind) as (NodeTypeRecord | RelationTypeRecord)[];
      const labs = all.filter((type) => type.by.id === lab.custodian && !type.removed);
      for (const mine of all.filter((type) => type.by.id === me.id && !type.removed)) {
        const twin = labs.find((type) => type.label.toLowerCase() === mine.label.toLowerCase());
        if (twin) fresh.push(revise({ record: mine, changes: { removed: true, replacedBy: twin.id }, by: me }));
      }
    }
    if (fresh.length > 0) await put(fresh);
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
    const library = inLibraryOf(paperIdentifiers(paper), paper.by, me.id);
    return { id: paper.id, label: kept.label, title: paper.title, ...(library ? { library } : {}) };
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
      me: me.id,
      localSpace,
      spaceName: info.space.name,
      nameOf,
      labName: (did) => labOf({ lab: did })?.name,
      ...(myLab() ? { lab: { name: myLab()!.name, ...(myLab()!.settings?.zoteroGroup ? { group: myLab()!.settings!.zoteroGroup! } : {}) } } : {}),
      labelOf: (paper) => paperOf({ source: { paper: paper.id } } as NodeRecord)?.label ?? paper.title,
      paperOfSource });

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
      ...(offers.checks?.stateOf(node.id) ? { checked: offers.checks.stateOf(node.id)! } : {}),
      ...(node.facts?.mediaType?.startsWith("image/") && node.facts.locator?.path && node.facts.locator.cellIndex === undefined ? { image: true as const } : {}),
      ...(paper ? { paper } : {}),
      ...(node.type ? { type: node.type } : {}),
      ...(type
        ? {
            typeLabel: type.label,
            ...(type.abbreviation ? { abbreviation: type.abbreviation } : {}),
            ...(type.base ? { base: type.base } : {}),
            ...(ownColor(type) ? { color: ownColor(type)! } : {}) }
        : {}) };
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

  /** A file in the base, or in the reference library when its ref says so. The library's file is read in place. */
  const readFile = async (ref: string): Promise<Result<Asset>> => {
    if (!isLibraryRef(ref)) return host.readAsset({ ref });
    if (!services?.zotero) return fail("unavailable", "This base can't reach Zotero.");
    if (!host.readLocalFile) return fail("unavailable", "Zotero's files can only be opened in the desktop app.");
    let file: LibraryFile;
    try {
      file = await services.zotero.file({ ref });
    } catch (error) {
      return fail("unavailable", error instanceof Error ? error.message : String(error));
    }
    if (!file.path) return fail("not-found", `Zotero lists ${file.filename} but doesn't have the file on this computer. Open it in Zotero once so it downloads.`);
    const read = await host.readLocalFile({ path: file.path });
    return read.ok ? ok({ ...read.value, name: file.filename }) : read;
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

  const homes = canvasHomes({
    host,
    put,
    stamp: () => stamp,
    canvasOf,
    anchorOf: (node) => anchorsByNode.get(node),
    hasLiveText: (ref) => !missingText.has(ref),
    canvasFormat });

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
    labOf,
    nameOf,
    relationLabel,
    anchors: () => anchorsByNode.values(),
    anchorOf: (node) => anchorsByNode.get(node),
    anchoredAt: (ref) => anchorsByRef.get(ref)?.node,
    hasLiveText: (ref) => !missingText.has(ref),
    makeCanvas: homes.make,
    send: (event) => {
      for (const port of ports) port.send(event);
    },
    prefs: async () => (offers.prefs ? offers.prefs() : DEFAULT_PREFS),
    offers,
    afterChange: (run) => {
      afterChange.add(run);
    },
    readFile,
    getLocal: async (key) => {
      const stored = await baseHost.getLocal({ key });
      return stored.ok ? stored.value : null;
    },
    setLocal: async (key, stored) => {
      await baseHost.setLocal({ key, value: stored as never });
    } };
  const capturing = captureFeature(context, { canvasFormat, moveFocus });
  const mirror = mirrorFeature(context);

  const unsubscribe = host.subscribe((event) => {
    switch (event.type) {
      case "records-changed":
        void pull();
        break;
      case "text-renamed": {
        // Restoring a note keeps its title, so nothing else would tell surfaces.
        const returned = missingText.delete(event.ref);
        void capturing.onRenamed(event.ref, event.title).then(() => {
          if (returned) notify();
        });
        break;
      }
      case "text-changed":
        // A hand edit to a note's link properties is put back on the next pass.
        mirror.forget(event.ref);
        offers.textChanged?.(event.ref);
        break;
      case "text-removed":
        missingText.add(event.ref);
        mirror.forget(event.ref);
        offers.textChanged?.(event.ref, true);
        notify();
        break;
      case "focus-changed": {
        const anchored = event.ref ? anchorsByRef.get(event.ref)?.node : undefined;
        // A page without a node keeps the last node in view, rather than blanking it.
        if (anchored && nodeOf(anchored)) {
          moveFocus(anchored);
          void offers.followNote?.(anchored);
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

  const papers = paperFeature(context, { demoGraphs });
  const units = unitFeature(context);
  if (info.textForEveryUnit) {
    let giving: Promise<void> = Promise.resolve();
    let queued = false;
    const giveNotes = (): void => {
      if (queued) return;
      queued = true;
      giving = giving.then(async () => {
        queued = false;
        // A unit that can't get a note now is tried again on the next change.
        await units.giveAll().catch(() => {});
      });
    };
    context.afterChange(giveNotes);
    giveNotes();
  }
  const labs = labFeature(context, {
    identity: identityView,
    createLabRecord,
    joinLab,
    adoptLabGrammar,
    trusted: () => trusted(),
    ...(askBreadcrumb ? { askBreadcrumb } : {}) });
  // A device whose clock is off stamps with the lab server's time. Small differences are left alone.
  // The correction is kept, so it still holds after a restart and before the next exchange.
  {
    const kept = await baseHost.getLocal({ key: CLOCK_KEY });
    if (kept.ok && typeof kept.value === "number") clockOffset = kept.value;
  }
  const serverTime = (now: string): void => {
    const off = new Date(now).getTime() - clock.now();
    const next = Number.isFinite(off) && Math.abs(off) > 2000 ? off : 0;
    if (next !== clockOffset) void baseHost.setLocal({ key: CLOCK_KEY, value: next });
    clockOffset = next;
    clock.offsetMs = clockOffset;
  };

  const devices = deviceFeature(context, { did: () => identity.did, deviceKey, signing: () => signer?.pair ?? null, keys });
  const trusted = devices.trusted;

  const ai = aiFeature(context, { ...(llm ? { llm } : {}), ...(secrets ? { secrets } : {}) });

  const holons = holonFeature(context);
  const reading = readingFeature(context);
  const search = searchFeature(context);
  const similar = similarFeature(context);
  const works = worksFeature(context);
  const crates = crateFeature(context, {
    ...(secrets ? { secrets } : {}),
    // Who checked a unit, as a crate tells it. The marks come from the sign-off feature, which is set up below.
    checksOf: (unit) => {
      const marks = offers.checks?.checksOf(unit) ?? [];
      const held = offers.checks?.standing(unit) ?? [];
      return marks.flatMap((mark) => {
        const record = held.find((item) => item.id === mark.id);
        return record ? [{ by: record.by, at: mark.at, verdict: mark.verdict, own: mark.own, way: CHECK_WAYS.find((entry) => entry.method === mark.way)?.label ?? mark.way, ...(mark.note ? { note: mark.note } : {}), current: mark.current, ...(record.targetCid ? { cid: record.targetCid } : {}) }] : [];
      });
    } });
  const announcing = notifyFeature(context);
  const profiles = profileFeature(context, { shareable: labs.shareable });
  const library = libraryFeature(context);
  const grammar = grammarFeature(context);
  const checks = checkFeature(context);
  const gather = gatherFeature(context, { place: (args) => reading.handlers["canvas.placeUnits"](args) });
  // Someone who left a lab while the app was closed gets their own grammar back.
  await adoptLabGrammar();

  const relations = relationFeature(context, { options: relationOptions });
  const canvases = canvasFeature(context, { homes, paperSummary: papers.summary, social: units.social, options: relationOptions, assert: (args) => relations.handlers["relation.assert"](args) });
  const nodes = nodeFeature(context, { capture: capturing.capture, pdfOf: reading.pdfOf, workOf: works.viewOf, libraryLinkOf: library.linkOf, provenance: units.provenance, social: units.social });

  const handlers: Handlers = {
    ...grammar.handlers,
    ...devices.handlers,
    ...proposalFeature(context, { createUnit: (args) => handlers["node.create"](args) }).handlers,
    ...gather.handlers,
    ...checks.handlers,
    ...holons.handlers,
    ...ai.handlers,
    ...methodFeature(context, { restsOn: similar.restsOn }).handlers,
    ...similar.handlers,
    ...works.handlers,
    ...crates.handlers,
    ...announcing.handlers,
    ...profiles.handlers,
    ...paperMapFeature(context).handlers,
    ...library.handlers,
    ...reading.handlers,
    ...search.handlers,
    ...papers.handlers,
    ...units.handlers,
    ...labs.handlers,
    ...nodes.handlers,
    ...relations.handlers,
    ...canvases.handlers,
    ...shellFeature(context).handlers,
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
    } };

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
      clock.offsetMs = clockOffset;
      clock.floorMs = Math.max(clock.floorMs, clockFloor);
      const result = await handler(message.params);
      clockFloor = clock.floorMs;
      port.send({ id: message.id, ok: true, result });
      logUsage({
        op: `surface:${message.method}`,
        ok: true,
        ms: Date.now() - started,
        at: new Date(started).toISOString() });
    } catch (error) {
      port.send({
        id: message.id,
        ok: false,
        error: { code: codeOf(error), message: error instanceof Error ? error.message : String(error) } });
      logUsage({
        op: `surface:${message.method}`,
        ok: false,
        code: codeOf(error),
        ms: Date.now() - started,
        at: new Date(started).toISOString() });
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
    capture: capturing.capture,
    captureSelection: capturing.captureSelection,
    convertFocused: capturing.convertFocused,
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
        ...(ownColor(type) ? { color: ownColor(type)! } : {}) };
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
    canvasHome: ({ id }) => homes.homeOf(id),
    canvasTitle: ({ id }) => canvasOf(id)?.title ?? null,
    createCanvas: async ({ title }) => ok((await homes.make(title)).id),
    usualCanvas: canvases.usual,
    focusedNode: () => focused,
    setName,
    shareable: labs.shareable,
    take: labs.take,
    prepare: labs.prepare,
    serverTime,
    setSession: (name: string) => {
      session = name;
    },
    focusCanvas: (id) => holons.focusCanvas(id),
    zoteroStatus: async () => (services?.zotero ? services.zotero.status() : { ok: false, app: "zotero", problem: "This base can't reach Zotero." }),
    pdfLibrary: () => handlers["pdf.library"]({}),
    command: (canvas, name) => {
      for (const port of ports) port.send({ event: "command", canvas, name });
    },
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
      test: () => handlers["ai.test"]({}) },
    prefs: () => holons.prefs(),
    setPrefs: (changes) => holons.setPrefs(changes),
    canvasClosed: labs.canvasClosed,
    answerBreadcrumb: labs.answerBreadcrumb,
    personName: () => me.name,
    removeExamples,
    locate,
    addToCanvas: canvases.add,
    relateOnCanvas: canvases.relate,
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
    } };
};

