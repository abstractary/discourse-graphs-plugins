import { assertRelation, createCanvasItem, decide, liveCanvasItems, retract, type DgId, type DgRecord } from "@dg/contract/records.ts";
import type { SurfaceMethods } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { ofPaper, readingOf } from "./locks.ts";

/**
 * Relations between units: which the grammar allows between two of them,
 * stating one, taking one back, and answering one someone else proposed.
 */
export const relationFeature = (
  context: Context,
  { options }: { /** The relations the grammar allows from one unit to another, in either direction. */ options: (source: DgId, target: DgId) => SurfaceMethods["relation.options"]["result"] },
) => {
  const handlers: Pick<Handlers, "relation.options" | "relation.assert" | "relation.withdraw" | "relation.decide"> = {
    "relation.options": async ({ source, target }) => options(source, target),
    "relation.assert": async ({ type, source, target, draw }) => {
      const allowed = options(source, target).some(
        (option) => option.type === type && !option.flipped,
      );
      if (!allowed) throw new Error("The grammar doesn't allow this relation.");
      const existing = [...context.graph().relations.values()].find(
        ({ record, state }) =>
          record.type === type &&
          record.source === source &&
          record.target === target &&
          (state === "active" || state === "pending"),
      );
      const relation = existing?.record ?? assertRelation({ ...context.stamp(), type, source, target });
      // Stated away from a canvas, it's drawn on each canvas the person works on that holds both units.
      const edges: DgRecord[] = [];
      if (draw) {
        for (const canvas of context.documents("canvas")) {
          // The person's own canvases, and the ones their lab shares, which they also work on.
          const lab = context.myLab()?.did;
          if (canvas.removed || (canvas.by.id !== context.me().id && !(lab && canvas.shared === lab))) continue;
          // A PDF canvas shows it only when both ends are its own paper's units.
          const reading = readingOf(context.graph(), canvas.id);
          if (reading && ![source, target].every((unit) => { const node = context.nodeOf(unit); return node && ofPaper(context.graph(), node, reading); })) continue;
          const live = liveCanvasItems({ graph: context.graph(), canvas: canvas.id });
          const cardOf = (unit: DgId) => live.find((item) => (item.item as { dg?: { node?: DgId } }).dg?.node === unit)?.id;
          const [fromNode, toNode] = [cardOf(source), cardOf(target)];
          if (!fromNode || !toNode) continue;
          if (live.some((item) => (item.item as { dg?: { relation?: DgId } }).dg?.relation === relation.id)) continue;
          const z = Math.max(0, ...live.map((item) => item.z)) + 1;
          edges.push(createCanvasItem({ ...context.stamp(), canvas: canvas.id, item: { fromNode, toNode, dg: { relation: relation.id } } as never, z }));
        }
      }
      if (!existing || edges.length) await context.put([...(existing ? [] : [relation]), ...edges]);
      return existing ? relation : { ...relation, made: true as const };
    },
    "relation.withdraw": async ({ id, reason }) => {
      await context.put([retract({ ...context.stamp(), target: id, ...(reason ? { reason } : {}) })]);
      return null;
    },
    "relation.decide": async ({ id, decision }) => {
      await context.put([decide({ ...context.stamp(), target: id, decision })]);
      return null;
    },
  };
  return { handlers };
};
