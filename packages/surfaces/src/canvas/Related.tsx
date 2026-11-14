import { useCallback, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import type { NodeSummary, RelatedUnit } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { plain } from "../shared/ui.tsx";
import { CARD_WIDTH, cardHeight } from "./items.ts";
import type { CanvasWriter } from "./useCanvasWriter.ts";

/** A card's relations, open beside it. `list` is null while it is being read. */
type RelatedAsk = { node: string; item: string; x: number; y: number; list: RelatedUnit[] | null };

export const useRelated = ({
  connection,
  writer,
  current,
  inFrame,
  report,
}: {
  connection: Connection;
  writer: CanvasWriter;
  current: string | undefined;
  inFrame: (x: number, y: number, width: number, height: number) => { x: number; y: number };
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const { write, record, freeSpot } = writer;
  const flow = useReactFlow();
  const [menu, setMenu] = useState<RelatedAsk | null>(null);

  const open = useCallback(
    (node: string, item: string, anchor: DOMRect) => {
      const { x, y } = inFrame(anchor.left, anchor.bottom + 4, 320, 320);
      setMenu({ node, item, x, y, list: null });
      void call("unit.related", { id: node, ...(current ? { canvas: current } : {}) })
        .then((list) => setMenu((shown) => (shown && shown.node === node ? { ...shown, list } : shown)))
        .catch(report);
    },
    [call, current, inFrame, report],
  );

  /** Brings units a card is related to onto the canvas, beside it. Their links are drawn with them. */
  const place = async (units: NodeSummary[]): Promise<void> => {
    if (!current || !menu || units.length === 0) return;
    const card = flow.getNode(menu.item);
    let y = card?.position.y ?? 0;
    const x = (card?.position.x ?? 0) + (card?.measured?.width ?? CARD_WIDTH) + 100;
    const places = units.map((unit) => {
      const size = { width: CARD_WIDTH, height: cardHeight(unit.title) };
      const spot = freeSpot({ x, y }, size);
      y = spot.y + size.height + 30;
      return { node: unit.id, ...spot, ...size };
    });
    setMenu(null);
    try {
      const { ids } = await call("canvas.placeUnits", { canvas: current, places });
      record({ label: units.length === 1 ? "Placed 1 related unit" : `Placed ${units.length} related units`, undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
    } catch (error) {
      report(error);
    }
  };

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, place, close };
};

export const RelatedMenu = ({ menu, onPlace }: { menu: RelatedAsk; onPlace: (units: NodeSummary[]) => void }) => (
  <div className="popover related-menu" role="dialog" aria-label="What this is related to" data-dg="related-menu" style={{ left: menu.x, top: menu.y }}>
    {menu.list === null ? (
      <p className="note">Looking…</p>
    ) : menu.list.length === 0 ? (
      <p className="note">Nothing is related to this yet. Drag from its edge to another card to say how they relate.</p>
    ) : (
      <>
        <ul>
          {menu.list.map((related) => (
            <li key={related.relation} data-here={related.here}>
              <span className="related-how">{related.label}{related.state === "pending" ? ", proposed" : ""}</span>
              <span className="related-what">{plain(related.unit.title)}</span>
              {related.here ? (
                <span className="related-here">On this canvas</span>
              ) : (
                <button type="button" data-dg={`related-add-${related.unit.title}`} onClick={() => onPlace([related.unit])}>Add</button>
              )}
            </li>
          ))}
        </ul>
        {menu.list.filter((related) => !related.here).length > 1 ? (
          <button type="button" className="related-all" data-dg="related-add-all" onClick={() => onPlace(menu.list!.filter((related) => !related.here).map((related) => related.unit))}>
            Add all {menu.list.filter((related) => !related.here).length} that aren't here
          </button>
        ) : null}
      </>
    )}
  </div>
);
