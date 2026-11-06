import type { Edge } from "@xyflow/react";
import { relationColor } from "../shared/relations.ts";

/** The relations on this canvas, in the same colors in every mode. */
export const Legend = ({ edges, labels }: { edges: Edge[]; labels: Record<string, { label: string; kind?: string }> }) => {
  const shown = new Map<string, string>();
  for (const { label, kind } of Object.values(labels)) shown.set(kind ?? label, label);
  const used = new Set(edges.map((edge) => (edge.data as { kind?: string } | undefined)?.kind ?? String(edge.label ?? "")));
  const rows = [...shown].filter(([key]) => used.has(key));
  if (rows.length === 0) return null;
  return (
    <div className="legend" data-dg="legend" aria-label="Relations on this canvas">
      {rows.map(([key, label]) => (
        <span key={key}>
          <i style={{ background: relationColor(key) }} />
          {label}
        </span>
      ))}
    </div>
  );
};
