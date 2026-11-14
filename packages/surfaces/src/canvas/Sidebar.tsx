import type { ComponentType } from "react";
import type { UnitsAvailable } from "@dg/contract/surface.ts";
import type { Place } from "../shared/place.ts";
import type { Connection } from "../shared/rpc.ts";
import { Drawer } from "./Drawer.tsx";

/**
 * The sidebar of a canvas: where things live, and what can be brought in.
 *
 * Three fixed tabs, always in this order. Library is the Library panel itself,
 * the same one the base shows in its own sidebar, with the canvas on screen marked. Search finds
 * a unit anywhere. Units lists what isn't on this canvas yet. The selected
 * unit's own facts stay in the Context panel on the other side.
 *
 * It floats over the canvas and goes when the canvas is clicked. Pinned, the
 * canvas makes room for it and it stays.
 */

export type SideTab = "places" | "search" | "units";

const TABS: { id: SideTab; label: string; hint: string }[] = [
  { id: "places", label: "Library", hint: "Every workspace, and the canvases and papers in each" },
  { id: "search", label: "Search units", hint: "Find a unit anywhere" },
  { id: "units", label: "Units", hint: "Units that aren't on this canvas yet" },
];

export const Sidebar = ({
  connection,
  current,
  tab,
  pinned,
  units,
  onTab,
  onPin,
  onClose,
  onGo,
  onPlace,
  Library,
  Search,
}: {
  connection: Connection;
  current: string | undefined;
  tab: SideTab;
  pinned: boolean;
  units: UnitsAvailable | null;
  onTab: (tab: SideTab) => void;
  onPin: (pinned: boolean) => void;
  onClose: () => void;
  onGo: (id: string) => void;
  onPlace: (units: string[]) => void;
  /** The Library panel, the same one the base shows in its own sidebar. */
  Library: ComponentType<{ connection: Connection; place?: Place }>;
  /** The search panel, shown whole in its tab. Handed in, since one panel does not import another. */
  Search: ComponentType<{ connection: Connection }>;
}) => (
  <aside className="side" data-dg="side" data-pinned={pinned ? "" : undefined} aria-label="Library, search units and units to place">
    <header className="side-head">
      <div className="side-tabs" role="tablist" aria-label="Sidebar">
        {TABS.map(({ id, label, hint }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} title={hint} data-dg={`side-tab-${id}`} onClick={() => onTab(id)}>
            {label}
            {id === "units" && units ? <span className="side-count">{Object.keys(units.units).length}</span> : null}
          </button>
        ))}
      </div>
      <button type="button" className="side-pin" aria-pressed={pinned} data-dg="side-pin" title={pinned ? "Let it float over the canvas again" : "Keep it open beside the canvas"} onClick={() => onPin(!pinned)}>
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button type="button" className="side-close" aria-label="Close the sidebar" data-dg="side-close" onClick={onClose}>×</button>
    </header>
    <div className="side-body" role="tabpanel" data-tab={tab}>
      {tab === "places" ? (
        <div className="side-places" data-dg="side-places">
          <Library connection={connection} place={{ ...(current ? { current } : {}), go: onGo }} />
        </div>
      ) : null}
      {tab === "search" ? <Search connection={connection} /> : null}
      {tab === "units" ? <Drawer side data={units} open onToggle={onClose} onPlace={onPlace} height={0} onResize={() => undefined} /> : null}
    </div>
  </aside>
);
