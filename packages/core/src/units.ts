import {
  createCanvasItem,
  createFolder,
  createFolderItem,
  createAnchor,
  createReaction,
  createUnitNote,
  formatTitle,
  liveCanvasItems,
  revise,
  REACTIONS,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type FolderRecord,
  type NodeRecord,
  type Reaction,
} from "@dg/contract/records.ts";
import type { ExportTarget, Provenance, UnitSocial } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

const WORKSPACE = "My workspace";
const LAB_CANVAS = "Lab canvas";

const heightOf = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));

const noteBody = (node: NodeRecord, paperTitle: string | undefined): string =>
  [
    node.source?.description,
    node.source?.anchor ? `> ${node.source.anchor}` : node.facts?.anchor?.exact ? `> ${node.facts.anchor.exact}` : undefined,
    paperTitle ? `From: ${paperTitle}` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

export const unitFeature = (
  context: Context,
): Pick<Handlers, "units.export" | "folder.list" | "folder.create" | "unit.react" | "unit.note" | "unit.removeNote"> & {
  provenance: (node: NodeRecord) => Provenance;
  social: (unit: DgId) => UnitSocial;
} => {
  const folders = (): FolderRecord[] => context.documents("folder").filter((folder) => !folder.removed);
  const filed = (folder: DgId) => context.documents("folder-item").filter((item) => item.folder === folder && !item.removed);

  const paperOf = (node: NodeRecord) =>
    node.source ? context.documents("paper").find((paper) => paper.id === node.source!.paper) : undefined;

  /** An exported unit becomes a real note or page, and keeps the same id. */
  const giveText = async (node: NodeRecord): Promise<boolean> => {
    if (context.anchorOf(node.id)) return false;
    const format = context.typeOf(node.type)?.titleFormat;
    const made = await context.host.createText({
      title: formatTitle({ content: node.title, ...(format ? { format } : {}) }),
      body: noteBody(node, paperOf(node)?.title),
      unit: node.id,
    });
    const ref = made.ok ? made.value.ref : made.error.code === "conflict" ? made.error.ref : undefined;
    if (!ref) throw new Error(made.ok ? "Couldn't make the note." : made.error.message);
    await context.put([createAnchor({ ...context.stamp(), node: node.id, ref })]);
    return true;
  };

  const canvasNamed = async (title: string, fields: Parameters<Context["makeCanvas"]>[1], match: (canvas: CanvasRecord) => boolean): Promise<CanvasRecord> =>
    context.documents("canvas").find((canvas) => !canvas.removed && match(canvas)) ?? context.makeCanvas(title, fields);

  const targetCanvas = async (target: ExportTarget): Promise<CanvasRecord | null> => {
    if (target.kind === "workspace") return canvasNamed(WORKSPACE, { personal: true }, (canvas) => canvas.personal === true);
    if (target.kind === "lab") {
      const lab = context.myLab();
      if (!lab) throw new Error("Join a lab first.");
      return canvasNamed(LAB_CANVAS, { shared: lab.did }, (canvas) => canvas.shared === lab.did && !canvas.paper);
    }
    if (target.kind === "canvas") {
      const canvas = context.canvasOf(target.id);
      if (!canvas) throw new Error("That canvas is gone.");
      return canvas;
    }
    return null;
  };

  const placeOnCanvas = async (canvas: CanvasRecord, nodes: NodeRecord[]): Promise<void> => {
    const live = liveCanvasItems({ graph: context.graph(), canvas: canvas.id });
    const cards = new Map<DgId, DgId>();
    for (const { id, item } of live) {
      const node = (item as { dg?: { node?: DgId } }).dg?.node;
      if (node) cards.set(node, id);
    }
    const stamp = context.stamp();
    const fresh: DgRecord[] = [];
    let z = live.length;
    nodes.forEach((node, index) => {
      if (cards.has(node.id)) return;
      z += 1;
      const item = { type: "text" as const, text: node.title, x: (index % 4) * 300, y: 2000 + Math.floor(index / 4) * 200, width: 240, height: heightOf(node.title), dg: { node: node.id } };
      const card = createCanvasItem({ ...stamp, canvas: canvas.id, item, z });
      cards.set(node.id, card.id);
      fresh.push(card);
    });
    const drawn = new Set(live.flatMap(({ item }) => {
      const relation = (item as { dg?: { relation?: DgId } }).dg?.relation;
      return relation && "fromNode" in item ? [relation] : [];
    }));
    for (const { record, state } of context.graph().relations.values()) {
      if (state === "withdrawn" || state === "rejected" || drawn.has(record.id)) continue;
      const [from, to] = [cards.get(record.source), cards.get(record.target)];
      if (!from || !to) continue;
      z += 1;
      fresh.push(createCanvasItem({ ...stamp, canvas: canvas.id, item: { fromNode: from, toNode: to, dg: { relation: record.id } }, z }));
    }
    await context.put([...fresh, revise({ record: canvas, changes: { needsLayout: true }, by: context.me() })]);
  };

  const fileAway = async (folder: FolderRecord, nodes: NodeRecord[]): Promise<void> => {
    const held = new Set(filed(folder.id).map(({ node }) => node));
    const stamp = context.stamp();
    await context.put(nodes.filter(({ id }) => !held.has(id)).map((node) => createFolderItem({ ...stamp, folder: folder.id, node: node.id })));
    for (const node of nodes) {
      const anchor = context.anchorOf(node.id);
      if (anchor) await context.host.fileInFolder({ ref: anchor.ref, folder: folder.title });
    }
  };

  const reactionOf = (unit: DgId) =>
    context.documents("reaction").find((reaction) => reaction.unit === unit && reaction.by.id === context.me().id);

  const social = (unit: DgId): UnitSocial => {
    const who = { interesting: [], agree: [], disagree: [] } as UnitSocial["who"];
    for (const reaction of context.documents("reaction")) {
      if (reaction.unit === unit && reaction.value) who[reaction.value].push(context.creditFor({ by: reaction.by }).name);
    }
    return {
      who,
      mine: reactionOf(unit)?.value ?? null,
      notes: context
        .documents("unit-note")
        .filter((note) => note.unit === unit && !note.removed)
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((note) => ({ id: note.id, text: note.text, credit: context.creditFor(note), at: note.at, mine: note.by.id === context.me().id })),
    };
  };

  const provenance = (node: NodeRecord): Provenance => {
    const paper = paperOf(node);
    const anchor = context.anchorOf(node.id);
    const onCanvas = new Set<DgId>();
    for (const item of context.documents("canvas-item")) {
      if (!item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === node.id) onCanvas.add(item.canvas);
    }
    const lab = context.documents("lab").find(({ did }) => did === node.lab);
    return {
      created: { credit: context.creditFor(node), at: node.at },
      ...(node.rev > 1 ? { edited: { name: node.editedBy.name, at: node.editedAt } } : {}),
      ...(paper
        ? {
            paper: {
              id: paper.id,
              title: paper.title,
              canvas: paper.canvas,
              model: paper.model,
              server: paper.server,
              schema: paper.schema,
              extractedBy: paper.by.name,
              at: paper.at,
              authors: paper.authors,
              ...(paper.license ? { license: paper.license } : {}),
              ...(paper.doi ? { doi: paper.doi } : {}),
              ...(node.source?.anchor ? { anchor: node.source.anchor } : {}),
              ...(node.source?.description ? { description: node.source.description } : {}),
            },
          }
        : {}),
      lives: {
        text: anchor && context.hasLiveText(anchor.ref) ? { title: formatTitle({ content: node.title, ...(context.typeOf(node.type)?.titleFormat ? { format: context.typeOf(node.type)!.titleFormat! } : {}) }) } : null,
        canvases: [...onCanvas].flatMap((id) => {
          const canvas = context.canvasOf(id);
          return canvas ? [{ id, title: canvas.title, shared: canvas.shared !== undefined }] : [];
        }),
        folders: folders().filter((folder) => filed(folder.id).some((item) => item.node === node.id)).map(({ id, title }) => ({ id, title })),
        ...(lab ? { lab: lab.name } : {}),
      },
    };
  };

  return {
    provenance,
    social,
    "units.export": async ({ nodes: ids, target }) => {
      const nodes = ids.flatMap((id) => {
        const node = context.nodeOf(id);
        return node ? [node] : [];
      });
      let made = 0;
      for (const node of nodes) if (await giveText(node)) made += 1;
      if (target.kind === "folder" || target.kind === "new-folder") {
        const folder = target.kind === "folder" ? folders().find(({ id }) => id === target.id) : createFolder({ ...context.stamp(), title: target.title });
        if (!folder) throw new Error("That folder is gone.");
        if (target.kind === "new-folder") await context.put([folder]);
        await fileAway(folder, nodes);
        return { folder: folder.id, made };
      }
      const canvas = (await targetCanvas(target))!;
      await placeOnCanvas(canvas, nodes);
      return { canvas: canvas.id, made };
    },
    "folder.list": async () => folders().map(({ id, title }) => ({ id, title, units: filed(id).length })),
    "folder.create": async ({ title }) => {
      const folder = createFolder({ ...context.stamp(), title });
      await context.put([folder]);
      return { id: folder.id, title, units: 0 };
    },
    "unit.react": async ({ unit, value }) => {
      if (value !== null && !REACTIONS.includes(value as Reaction)) throw new Error("Unknown reaction.");
      const mine = reactionOf(unit);
      await context.put([mine ? revise({ record: mine, changes: { value }, by: context.me() }) : createReaction({ ...context.stamp(), unit, value })]);
      return null;
    },
    "unit.note": async ({ unit, text }) => {
      await context.put([createUnitNote({ ...context.stamp(), unit, text })]);
      return null;
    },
    "unit.removeNote": async ({ id }) => {
      const note = context.documents("unit-note").find((item) => item.id === id && item.by.id === context.me().id);
      if (note) await context.put([revise({ record: note, changes: { removed: true }, by: context.me() })]);
      return null;
    },
  };
};
