import {
  assertRelation,
  buildCanvas,
  canonicalJson,
  createAnchor,
  createCanvas,
  createCanvasItem,
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
  IdentityView,
  NodeSummary,
  RelationOption,
  SurfaceMessage,
  SurfaceMethod,
  SurfaceMethods,
  SurfacePort,
} from "@dg/contract/surface.ts";
import { withUsageLog, type UsageEvent } from "@dg/contract/usage.ts";
import { atUriOf, cidOf, toAtRecord, type AtRecord } from "@dg/contract/atproto.ts";
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
import { paperFeature } from "./papers.ts";
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
};

export const createCore = async ({
  host: baseHost,
  titleFormat,
  canvasFormat = "Canvas - {content}",
  keys = memoryKeys(),
  services,
  demoGraphs = [],
  askBreadcrumb,
}: {
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
  const notify = (): void => {
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

  const summarize = (node: NodeRecord): NodeSummary => {
    const type = typeOf(node.type);
    const anchor = anchorsByNode.get(node.id);
    return {
      id: node.id,
      title: node.title,
      credit: creditFor(node),
      at: node.at,
      hasText: Boolean(anchor && !missingText.has(anchor.ref)),
      ...(node.source && !anchor ? { staged: true } : {}),
      ...(atUriOf(node.id, graph) ? { uri: atUriOf(node.id, graph)! } : {}),
      ...(node.type ? { type: node.type } : {}),
      ...(type
        ? {
            typeLabel: type.label,
            ...(type.abbreviation ? { abbreviation: type.abbreviation } : {}),
            ...(type.base ? { base: type.base } : {}),
            ...(type.color ? { color: type.color } : {}),
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
    for (const type of [...types].sort((a, b) => foreign(a) - foreign(b) || a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
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
      if (name !== canvas.title) await put([revise({ record: canvas, changes: { title: name }, by: me })]);
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
      case "text-removed":
        missingText.add(event.ref);
        notify();
        break;
      case "focus-changed": {
        const anchored = event.ref ? anchorsByRef.get(event.ref)?.node : undefined;
        // A page without a node keeps the last node in view, rather than blanking it.
        if (anchored && nodeOf(anchored)) moveFocus(anchored);
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
          };
        }
      }
    }
    const paper = canvas.paper ? documents("paper").find(({ id: paperId }) => paperId === canvas.paper) : undefined;
    return {
      canvas,
      items: live.map(({ id: itemId, z, item }) => ({ id: itemId, z, item })),
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

  const handlers: Handlers = {
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
      await put([revise({ record: node, changes: { type }, by: me })]);
      const format = typeOf(type)?.titleFormat;
      const anchor = anchorsByNode.get(id);
      if (anchor && format) {
        const renamed = await host.renameText({
          ref: anchor.ref,
          title: formatTitle({ format, content: node.title }),
        });
        if (!renamed.ok && renamed.error.code !== "conflict") {
          throw new Error(renamed.error.message);
        }
      }
      return summarize(nodeOf(id)!);
    },
    "node.view": async ({ id }) => {
      const node = nodeOf(id);
      if (!node) throw new Error(`No node ${id}`);
      const anchor = anchorsByNode.get(id);
      const text = anchor ? await host.readText({ ref: anchor.ref }) : null;
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
          ? value(await host.listBacklinks({ ref: anchor.ref })).map(({ title }) => ({
              title,
            }))
          : [],
        attribution: {
          person: nameOf(node.by),
          ...(labOf(node) ? { lab: labOf(node)!.name } : {}),
        },
        provenance: units.provenance(node),
        ...(onSharedCanvas(id) ? { social: units.social(id) } : {}),
      };
    },
    "relation.options": async ({ source, target }) => relationOptions(source, target),
    "relation.assert": async ({ type, source, target }) => {
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
      if (existing) return existing.record;
      const relation = assertRelation({ ...stamp, type, source, target });
      await put([relation]);
      return relation;
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
    "canvas.show": async ({ id }) => {
      value(await canvasHome(id));
      value(await host.openSurface({ route: { surface: "canvas", id }, placement: "main" }));
      return null;
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
    "dialog.open": async ({ surface }) => {
      value(await host.openSurface({ route: { surface }, placement: "dialog" }));
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
    }),
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
        ...(type?.color ? { color: type.color } : {}),
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

