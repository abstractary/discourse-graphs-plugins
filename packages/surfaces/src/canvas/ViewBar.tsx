import { useReactFlow, useViewport } from "@xyflow/react";
import { Icon } from "../shared/ui.tsx";

export const ViewBar = () => {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="view-bar">
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => void flow.zoomOut({ duration: 120 })}>
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className="level"
        data-dg="fit"
        aria-label="Fit to view"
        title="Fit to view"
        onClick={() => void flow.fitView({ maxZoom: 1, padding: 0.12, duration: 180 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => void flow.zoomIn({ duration: 120 })}>
        <Icon name="plus" />
      </button>
    </div>
  );
};
