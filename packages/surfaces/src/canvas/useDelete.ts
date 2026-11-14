import { useCallback, useRef, useState, type RefObject } from "react";
import type { Edge } from "@xyflow/react";
import type { CanvasItem, WithoutId } from "@dg/contract/records.ts";
import type { CanvasItemView, CanvasView, LinkDelete, Prefs } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { withoutId, type FlowNode } from "./items.ts";
import type { LinkAsk } from "./LinkAsk.tsx";
import type { CanvasWriter } from "./useCanvasWriter.ts";

/** Taking things off the canvas, and what Delete on a link means for the relation behind it. */
export const useDelete = ({
  connection,
  writer,
  items,
  view: viewRef,
  prefs,
  report,
}: {
  connection: Connection;
  writer: CanvasWriter;
  items: RefObject<Map<string, CanvasItemView>>;
  view: RefObject<CanvasView | null>;
  prefs: Prefs;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const { write, record } = writer;
  const [linkAsk, setLinkAsk] = useState<LinkAsk | null>(null);
  /** Relations Delete should also withdraw, decided before the delete runs. */
  const withdrawing = useRef<string[]>([]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** The delete about to run follows a remembered choice, so the status can offer to ask again. */
  const fromRemembered = useRef(false);

  /**
   * Delete on a link asks whether the relation is only coming off this canvas
   * or being withdrawn, unless the person made one answer their default. Links
   * that go because a card went are only taken off.
   */
  const beforeDelete = useCallback(
    async ({ edges: lost }: { nodes: FlowNode[]; edges: Edge[] }): Promise<boolean> => {
      withdrawing.current = [];
      fromRemembered.current = false;
      const shown_ = viewRef.current;
      const chosen = lost.flatMap((edge) => {
        const relation = (edge.data as { relation?: string } | undefined)?.relation;
        const known = relation ? shown_?.relations[relation] : undefined;
        return edge.selected && relation && known && (known.state === "active" || known.state === "pending") ? [{ id: relation, ...known }] : [];
      });
      if (!chosen.length) return true;
      const mine = [...new Set(chosen.filter((relation) => relation.mine).map((relation) => relation.id))];
      const decide = (choice: LinkDelete) => {
        withdrawing.current = choice === "withdraw" ? mine : [];
      };
      const preference = prefsRef.current.linkDelete;
      if (preference !== "ask") {
        decide(preference);
        fromRemembered.current = true;
        return true;
      }
      return new Promise<boolean>((resolve) => {
        setLinkAsk({
          links: chosen.map((relation) => ({
            label: relation.label,
            from: shown_?.nodes[relation.source]?.title ?? "",
            to: shown_?.nodes[relation.target]?.title ?? "",
          })),
          mine: mine.length,
          others: [...new Set(chosen.filter((relation) => !relation.mine).map((relation) => (relation.credit.kind === "lab" ? `its author in ${relation.credit.name}` : relation.credit.name)))],
          answer: (choice, remember) => {
            setLinkAsk(null);
            if (choice === "cancel") return resolve(false);
            if (remember) void call("prefs.set", { linkDelete: choice }).catch(report);
            decide(choice);
            resolve(true);
          },
        });
      });
    },
    [call, report],
  );

  /** Takes items off the canvas, and withdraws the relations Delete was told to. Undo asserts them again. */
  const removeItems = async (ids: string[], label?: string): Promise<void> => {
    if (!ids.length) return;
    const pulled = withdrawing.current;
    withdrawing.current = [];
    const remembered = fromRemembered.current;
    fromRemembered.current = false;
    const ends = new Map(pulled.flatMap((id) => (viewRef.current?.relations[id] ? [[id, viewRef.current.relations[id]!] as const] : [])));
    const drawn = ids.flatMap((id) => {
      const entry = items.current.get(id);
      const relation = entry && "fromNode" in entry.item ? (entry.item as { dg?: { relation?: string } }).dg?.relation : undefined;
      return entry && relation && ends.has(relation) ? [{ id, z: entry.z, item: withoutId(entry.item), relation }] : [];
    });
    const linksOnly = ids.every((id) => {
      const entry = items.current.get(id);
      return entry && "fromNode" in entry.item;
    });
    // The relation each withdrawn one is now, since undo asserts a fresh one.
    const now = new Map(pulled.map((id) => [id, id]));
    const withdraw = async () => {
      for (const id of now.values()) await call("relation.withdraw", { id });
    };
    try {
      await write({ removes: ids });
      await withdraw();
      const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
      record({
        label:
          label ??
          (pulled.length
            ? `Withdrew ${count(pulled.length, "relation", "relations")}`
            : linksOnly
              ? `Took ${count(ids.length, "link", "links")} off this canvas`
              : `Removed ${count(ids.length, "item", "items")}`),
        ...(remembered ? { remembered: true } : {}),
        undo: async () => {
          await write({ restores: ids });
          for (const [original, end] of ends) {
            const again = await call("relation.assert", { type: end.type, source: end.source, target: end.target });
            now.set(original, again.id);
            const edges = drawn.filter((edge) => edge.relation === original);
            if (edges.length) {
              await write({
                upserts: edges.map((edge) => ({ id: edge.id, z: edge.z, item: { ...edge.item, dg: { relation: again.id } } as WithoutId<CanvasItem> })),
              });
            }
          }
        },
        redo: async () => {
          await write({ removes: ids });
          await withdraw();
        },
      });
    } catch (error) {
      report(error);
    }
  };

  return { linkAsk, beforeDelete, removeItems };
};
