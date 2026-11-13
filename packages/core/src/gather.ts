import { createAnchor, createNode, formatTitle, type DgId, type NodeRecord } from "@dg/contract/records.ts";
import type { Candidate, RelatedUnit } from "@dg/contract/surface.ts";
import { fillTemplate } from "@dg/contract/grammar.ts";
import type { Context, Handlers } from "./context.ts";
import { baseOf, cidOfBytes, ensureProcessTypes, provenanceOf } from "./process.ts";

/**
 * Three ways an argument grows from what is already at hand:
 * - a picture becomes an output, and what it shows becomes evidence that rests on it;
 * - a card lists what its unit is related to, so the next card is one click away;
 * - a line tagged in the flow of writing becomes a unit when its author is ready.
 */

const IMAGE_LIMIT = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/tiff"]);
/** A card that shows a picture is taller than one that shows a title. */
export const IMAGE_CARD = { width: 280, height: 250 };
const CARD = { width: 260, height: 96 };

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

type Place = (args: { canvas: DgId; places: { node: DgId; x: number; y: number; width: number; height: number }[] }) => Promise<{ ids: DgId[] }>;

export const gatherFeature = (context: Context, { place }: { place: Place }) => {
  const base = (node: NodeRecord | undefined) => baseOf(context.graph(), node);
  const outputType = async () => {
    const stamp = context.stamp();
    const { types, created } = ensureProcessTypes({ nodeTypes: context.nodeTypes(), stamp, ...(context.titleFormat ? { titleFormat: context.titleFormat } : {}) });
    if (created.length) await context.put(created);
    return types.output;
  };
  const put = async (node: NodeRecord, canvas: DgId | undefined, at: { x?: number; y?: number }, size: { width: number; height: number }): Promise<void> => {
    if (canvas) await place({ canvas, places: [{ node: node.id, x: at.x ?? 0, y: at.y ?? 0, ...size }] });
  };

  const handlers: Pick<Handlers, "image.add" | "unit.image" | "output.observe" | "unit.related" | "candidate.list" | "candidate.promote"> = {
    "image.add": async ({ canvas, file, x, y }) => {
      if (!IMAGE_TYPES.has(file.mediaType)) throw new Error(`${file.name} isn't a picture this can keep. Use a PNG, JPEG, GIF, WebP, SVG or TIFF.`);
      const bytes = bytesOf(file.dataBase64);
      if (bytes.length === 0) throw new Error(`${file.name} is empty.`);
      if (bytes.length > IMAGE_LIMIT) throw new Error(`${file.name} is over 20 MB. Keep the full file where it is and add a smaller copy here.`);
      const cid = await cidOfBytes(bytes);
      // The same bytes are the same output, however many times they are dropped in.
      const held = context.documents("node").find((node) => !node.removed && node.facts?.cid === cid && base(node) === "output");
      if (held) {
        await put(held, canvas, { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) }, IMAGE_CARD);
        return { unit: context.summarize(held), fresh: false };
      }
      const kept = await context.host.writeAsset({ asset: { name: file.name, mime: file.mediaType, dataUrl: `data:${file.mediaType};base64,${file.dataBase64}` } });
      if (!kept.ok) throw new Error(kept.error.message);
      const type = await outputType();
      const title = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Picture";
      const node = createNode({
        ...context.stamp(),
        title,
        type: type.id,
        facts: { cid, size: bytes.length, mediaType: file.mediaType, outputKind: "figure", locator: { path: kept.value.ref }, provenance: { method: "authored" } },
      });
      await context.put([node]);
      await put(node, canvas, { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) }, IMAGE_CARD);
      return { unit: context.summarize(context.nodeOf(node.id)!), fresh: true };
    },

    "unit.image": async ({ id }) => {
      const node = context.nodeOf(id);
      const path = node?.facts?.locator?.path;
      if (!node || !path || !node.facts?.mediaType?.startsWith("image/")) return null;
      const asset = await context.host.readAsset({ ref: path });
      if (!asset.ok) return null;
      const data = asset.value.dataUrl.split(",")[1] ?? "";
      // The record says which bytes it means. A file changed since is shown as changed, never as the result.
      const stale = Boolean(node.facts.cid) && (await cidOfBytes(bytesOf(data))) !== node.facts.cid;
      return { dataUrl: `data:${node.facts.mediaType};base64,${data}`, stale };
    },

    "output.observe": async ({ output: id, title, canvas, x, y }) => {
      const output = context.nodeOf(id);
      if (!output || base(output) !== "output") throw new Error("That isn't an output.");
      const said = title.replace(/\s+/g, " ").trim();
      if (!said) throw new Error("Say what it shows, in a sentence.");
      const type = context.nodeTypes().find((item) => item.base === "evidence");
      if (!type) throw new Error("There is no evidence type to make it with.");
      const run = provenanceOf(context.graph(), id).generatedBy;
      const node = createNode({
        ...context.stamp(),
        title: said,
        type: type.id,
        prov: { observationBase: [{ uri: output.id, ...(output.facts?.cid ? { cid: output.facts.cid } : {}) }], ...(run ? { isGroundedIn: run } : {}) },
        facts: { provenance: { method: "authored" } },
      });
      await context.put([node]);
      await put(node, canvas, { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) }, CARD);
      return context.summarize(context.nodeOf(node.id)!);
    },

    "unit.related": async ({ id, canvas }) => {
      const here = new Set<DgId>();
      if (canvas) {
        for (const item of context.documents("canvas-item")) {
          const unit = (item.item as { dg?: { node?: DgId } }).dg?.node;
          if (item.canvas === canvas && !item.removed && unit) here.add(unit);
        }
      }
      const related: RelatedUnit[] = [];
      for (const { record, state } of context.graph().relations.values()) {
        if (state === "withdrawn" || state === "rejected" || (record.source !== id && record.target !== id)) continue;
        const other = context.nodeOf(record.source === id ? record.target : record.source);
        const type = context.relationTypeOf(record.type);
        if (!other || other.removed || !type) continue;
        related.push({ relation: record.id, label: record.source === id ? type.label : type.complement, state, unit: context.summarize(other), here: here.has(other.id) });
      }
      // What isn't on the canvas yet comes first: that is what a person opens this list to find.
      return related.sort((a, b) => Number(a.here) - Number(b.here) || a.label.localeCompare(b.label) || a.unit.title.localeCompare(b.unit.title));
    },

    "candidate.list": async () => {
      const tags = context.nodeTypes().flatMap((type) => (type.tag ? [{ type: type.id, label: type.label, tag: type.tag }] : []));
      if (!context.host.listTagged) return { supported: false, tags, candidates: [] };
      if (tags.length === 0) return { supported: true, tags, candidates: [] };
      const found = await context.host.listTagged({ tags: tags.map(({ tag }) => tag), limit: 500 });
      if (!found.ok) throw new Error(found.error.message);
      const candidates: Candidate[] = found.value.flatMap((line) => {
        const type = tags.find(({ tag }) => tag.toLowerCase() === line.tag.toLowerCase());
        return type && line.text.trim() ? [{ ref: line.ref, note: line.title, line: line.line, text: line.text.trim(), type: type.type, typeLabel: type.label, tag: type.tag }] : [];
      });
      return { supported: true, tags, candidates };
    },

    "candidate.promote": async ({ ref, line, type: typeId, text }) => {
      const type = context.typeOf(typeId);
      if (!type?.tag) throw new Error("That type has no candidate tag.");
      if (!context.host.replaceTagged) throw new Error("This base has no tags.");
      const title = text.replace(/\s+/g, " ").trim();
      if (!title) throw new Error("A unit needs a title.");
      const node = createNode({ ...context.stamp(), title, type: type.id, facts: { provenance: { method: "authored" } } });
      const made = await context.host.createText({
        title: formatTitle({ content: title, ...(type.titleFormat ? { format: type.titleFormat } : {}) }),
        ...(type.template ? { body: fillTemplate(type.template, { title, type: type.label, author: context.me().name, date: node.at.slice(0, 10) }) } : {}),
        unit: node.id,
      });
      // A note of that name already there is the same idea: the line links to it, and no second unit is made.
      const known = !made.ok && made.error.code === "conflict" && made.error.ref ? context.anchoredAt(made.error.ref) : undefined;
      const target = made.ok ? made.value.ref : !made.ok && made.error.code === "conflict" ? made.error.ref : undefined;
      if (!target) throw new Error(made.ok ? "Couldn't make the note." : made.error.message);
      const swapped = await context.host.replaceTagged({ ref, line, tag: type.tag, target });
      if (!swapped.ok) throw new Error(swapped.error.message);
      if (known && context.nodeOf(known)) return context.summarize(context.nodeOf(known)!);
      await context.put([node, createAnchor({ ...context.stamp(), node: node.id, ref: target })]);
      return context.summarize(context.nodeOf(node.id)!);
    },
  };
  return { handlers };
};
