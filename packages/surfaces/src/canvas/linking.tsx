import { useCallback, useState, type RefObject } from "react";
import { useReactFlow, type Connection as FlowConnection, type FinalConnectionState } from "@xyflow/react";
import type { CanvasItemView, RelationOption } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { CARD_WIDTH, nodeOfItem, type Anchor, type End } from "./items.ts";
import type { CanvasWriter } from "./useCanvasWriter.ts";

type RelationAsk = { source: End; target: End; options: RelationOption[]; x: number; y: number };
/** A connection dropped on empty canvas, waiting for the node it should reach. */
export type Linking = { from: End | null; item: string; at: { x: number; y: number } };

/**
 * Drawing a link between two items. Between two units it asks which relation
 * is meant, and asserts it; otherwise it is a plain arrow. A link dropped on
 * empty canvas is handed back, to start the next card there.
 */
export const useLinking = ({
  connection,
  writer,
  items,
  inFrame,
  onLoose,
  report,
}: {
  connection: Connection;
  writer: CanvasWriter;
  items: RefObject<Map<string, CanvasItemView>>;
  inFrame: (x: number, y: number, width: number, height: number) => { x: number; y: number };
  onLoose: (linking: Linking, at: Anchor) => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const { write, record, nextZ } = writer;
  const flow = useReactFlow();
  const [menu, setMenu] = useState<RelationAsk | null>(null);

  const askRelation = useCallback(
    async (source: End, target: End, screen: { x: number; y: number }) => {
      const options = await call("relation.options", { source: source.node, target: target.node });
      const { x, y } = inFrame(screen.x - 85, screen.y - 60, 170, 180);
      setMenu({ source, target, options, x: x + 85, y: y + 60 });
    },
    [call, inFrame],
  );

  const onConnect = useCallback(
    async (link: FlowConnection) => {
      const from = items.current.get(link.source);
      const to = items.current.get(link.target);
      if (!from || !to || link.source === link.target) return;
      const fromNode = nodeOfItem(from);
      const toNode_ = nodeOfItem(to);
      if (!fromNode || !toNode_) {
        const { ids } = await write({ upserts: [{ item: { fromNode: from.id, toNode: to.id }, z: nextZ() }] });
        record({ label: "Drew an arrow", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
        return;
      }
      const a = flow.getNode(link.source);
      const b = flow.getNode(link.target);
      const middle = flow.flowToScreenPosition({
        x: ((a?.position.x ?? 0) + (b?.position.x ?? 0)) / 2 + CARD_WIDTH / 2,
        y: ((a?.position.y ?? 0) + (b?.position.y ?? 0)) / 2 + 40,
      });
      await askRelation({ item: from.id, node: fromNode }, { item: to.id, node: toNode_ }, middle);
    },
    [askRelation, flow, nextZ, write, record, items],
  );

  /** Dropping a connection on empty canvas starts the next card of the argument. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || state.toNode || !state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0]! : event;
      const entry = items.current.get(state.fromNode.id);
      const node = nodeOfItem(entry);
      const linking = {
        from: node ? { item: state.fromNode.id, node } : null,
        item: state.fromNode.id,
        at: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      };
      const { x, y } = inFrame(point.clientX, point.clientY, 380, 300);
      onLoose(linking, { left: x, top: y });
    },
    [flow, inFrame, items, onLoose],
  );

  const choose = async (option: RelationOption): Promise<void> => {
    if (!menu) return;
    const { source, target } = menu;
    const [from, to] = option.flipped ? [target, source] : [source, target];
    setMenu(null);
    try {
      const ends = { type: option.type, source: from.node, target: to.node };
      const relation = await call("relation.assert", ends);
      const z = nextZ();
      const edge = (id: string) => ({ fromNode: from.item, toNode: to.item, dg: { relation: id } });
      const { ids } = await write({ upserts: [{ item: edge(relation.id), z }] });
      const item = ids[0]!;
      // Undo takes back a relation this made. One that was already there stays.
      let asserted: string | null = relation.made ? relation.id : null;
      record({
        label: `Linked: ${option.label}`,
        undo: async () => {
          await write({ removes: [item] });
          if (asserted) await call("relation.withdraw", { id: asserted });
        },
        redo: async () => {
          await write({ restores: [item] });
          if (!relation.made) return;
          asserted = (await call("relation.assert", ends)).id;
          await write({ upserts: [{ id: item, item: edge(asserted), z }] });
        },
      });
    } catch (error) {
      report(error);
    }
  };

  const close = useCallback(() => setMenu(null), []);

  return { menu, askRelation, onConnect, onConnectEnd, choose, close };
};

export const RelationMenu = ({ menu, onPick, onClose }: { menu: RelationAsk; onPick: (option: RelationOption) => void; onClose: () => void }) => (
  <div className="popover menu relation-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
    {menu.options.length === 0 ? (
      <p>The grammar has no relation for these two units. Check that both have a type.</p>
    ) : (
      menu.options.map((option) => (
        <button key={`${option.type}-${option.flipped}`} type="button" role="menuitem" data-dg={`relation-${option.label}`} onClick={() => onPick(option)}>
          {option.label}
        </button>
      ))
    )}
    <button type="button" role="menuitem" className="quiet" onClick={onClose}>Cancel</button>
  </div>
);
