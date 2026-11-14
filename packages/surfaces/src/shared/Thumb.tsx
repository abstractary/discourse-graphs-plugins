import type { RepositoryCanvas } from "@dg/contract/surface.ts";

/**
 * A canvas as a picture of itself: every card where it really sits, coloured
 * by its unit's type, with the links between them. Two canvases with the same
 * name look different, and a paper's canvas looks unlike a hand-built one.
 */
export const Thumb = ({ thumb }: { thumb: RepositoryCanvas["thumb"] }) => {
  if (thumb.cards.length === 0) return <span className="thumb thumb-empty" aria-hidden="true" />;
  const pad = Math.max(thumb.width, thumb.height) * 0.04;
  const centre = (card: RepositoryCanvas["thumb"]["cards"][number]) => [card.x + card.w / 2, card.y + card.h / 2] as const;
  return (
    <svg className="thumb" viewBox={`${-pad} ${-pad} ${thumb.width + pad * 2} ${thumb.height + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {thumb.links.map(([from, to], position) => {
        const [x1, y1] = centre(thumb.cards[from]!);
        const [x2, y2] = centre(thumb.cards[to]!);
        return <line key={position} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />;
      })}
      {thumb.cards.map((card, position) => (
        <rect key={position} data-base={card.base} x={card.x} y={card.y} width={card.w} height={card.h} rx={Math.min(card.w, card.h) * 0.12} />
      ))}
    </svg>
  );
};
