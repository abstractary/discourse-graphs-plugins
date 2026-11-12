import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AvailableUnit, UnitsAvailable, UnitsSegment } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, Mark, plain } from "../shared/ui.tsx";

/**
 * The units waiting to go on this canvas, in a drawer that rises from under
 * it. They're grouped by the other canvases and folders that hold them, so a
 * person brings over an argument they already made. Click selects; drag puts
 * one, or the selection, where it's dropped; Place puts the selection, or a
 * whole group, in a clear spot, laid out together with its links.
 */

export const DRAG_TYPE = "application/x-dg-units";
const MIN_HEIGHT = 150;
const KIND_WORD: Record<UnitsSegment["kind"], string> = { canvas: "Canvas", folder: "Folder", loose: "Loose" };

export const useUnitsDrawer = ({ connection, current, report }: { connection: Connection; current: string | undefined; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [data, setData] = useState<UnitsAvailable | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(() => {
    if (!current) return setData(null);
    void call("units.available", { canvas: current }).then(setData).catch(report);
  }, [call, current, report]);
  useEffect(load, [load]);
  // A burst of writes, such as a placed group, reads once.
  useEffect(() => on("graph-changed", () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(load, 120);
  }), [on, load]);
  return data;
};

export const Drawer = ({
  data,
  open,
  onToggle,
  onPlace,
  height,
  onResize,
}: {
  data: UnitsAvailable | null;
  open: boolean;
  onToggle: () => void;
  onPlace: (units: string[]) => void;
  height: number;
  onResize: (height: number) => void;
}) => {
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const units = data?.units ?? {};
  const total = Object.keys(units).length;

  // A unit that went onto the canvas leaves the selection.
  useEffect(() => setSelected((old) => old.filter((id) => units[id])), [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = useMemo(() => {
    const seen = new Map<string, string>();
    for (const unit of Object.values(units)) if (unit.type && unit.typeLabel) seen.set(unit.type, unit.typeLabel);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [units]);
  const needle = query.trim().toLowerCase();
  const shows = (unit: AvailableUnit | undefined): unit is AvailableUnit =>
    Boolean(unit) && (!needle || unit!.title.toLowerCase().includes(needle)) && (!type || unit!.type === type);
  const segments = (data?.segments ?? []).map((segment) => ({ ...segment, shown: segment.units.map((id) => units[id]).filter(shows) })).filter((segment) => segment.shown.length);

  const toggle = (id: string) => setSelected((old) => (old.includes(id) ? old.filter((other) => other !== id) : [...old, id]));
  const place = (ids: string[]) => {
    if (!ids.length) return;
    onPlace(ids);
    setSelected([]);
  };

  const resizing = useRef<{ y: number; height: number } | null>(null);

  return (
    <section className="drawer" data-open={open} style={open ? { height } : undefined} aria-label="Units to place" data-dg="drawer">
      {open ? (
        <div
          className="drawer-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the drawer"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizing.current = { y: event.clientY, height };
          }}
          onPointerMove={(event) => {
            if (!resizing.current) return;
            const shell = event.currentTarget.closest(".shell") as HTMLElement | null;
            const most = (shell?.clientHeight ?? 800) * 0.75;
            onResize(Math.round(Math.max(MIN_HEIGHT, Math.min(most, resizing.current.height + resizing.current.y - event.clientY))));
          }}
          onPointerUp={() => (resizing.current = null)}
        />
      ) : null}
      <div className="drawer-bar">
        <button type="button" className="drawer-toggle" aria-expanded={open} onClick={onToggle} title={open ? "Close the drawer (U)" : "Units not on this canvas yet (U)"} data-dg="drawer-toggle">
          <span className="drawer-caret" aria-hidden="true"><Icon name="chevron" /></span>
          Units to place <span className="drawer-count" data-dg="drawer-count">{data ? total : "…"}</span>
        </button>
        {open ? (
          <>
            <input className="drawer-search" aria-label="Find a unit" placeholder="Find a unit" value={query} onChange={(event) => setQuery(event.target.value)} data-dg="drawer-search" />
            <select className="drawer-type" aria-label="Type" value={type} onChange={(event) => setType(event.target.value)} data-dg="drawer-type">
              <option value="">Every type</option>
              {types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <span className="drawer-views" role="group" aria-label="Show as">
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} data-dg="drawer-list">List</button>
              <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} data-dg="drawer-grid">Grid</button>
            </span>
            <span className="drawer-act">
              {selected.length ? (
                <>
                  <button type="button" className="primary" onClick={() => place(selected)} data-dg="drawer-place">Place {selected.length} together</button>
                  <button type="button" onClick={() => setSelected([])} data-dg="drawer-clear">Clear</button>
                </>
              ) : (
                <span className="drawer-hint">Click to select · drag onto the canvas</span>
              )}
            </span>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="drawer-body" data-view={view} data-dg="drawer-body">
          {data && total === 0 ? <p className="drawer-none">Every unit is on this canvas already.</p> : null}
          {data && total > 0 && segments.length === 0 ? <p className="drawer-none">No unit matches.</p> : null}
          {segments.map((segment) => {
            const shut = folded.has(segment.id);
            return (
              <section key={`${segment.kind}-${segment.id}`} className="drawer-seg" data-kind={segment.kind} data-dg={`drawer-seg-${segment.title}`}>
                <header>
                  <button
                    type="button"
                    className="drawer-seg-toggle"
                    aria-expanded={!shut}
                    onClick={() => setFolded((old) => {
                      const next = new Set(old);
                      if (next.has(segment.id)) next.delete(segment.id);
                      else next.add(segment.id);
                      return next;
                    })}
                  >
                    <span className="drawer-caret" aria-hidden="true"><Icon name="chevron" /></span>
                    <span className="chip" data-base={segment.kind === "canvas" ? (segment.holon ?? "canvas") : "none"}>{segment.kind === "canvas" && segment.holon ? `${KIND_WORD.canvas} · ${segment.holon}` : KIND_WORD[segment.kind]}</span>
                    <span className="drawer-seg-title">{segment.title}</span>
                    <span className="drawer-seg-count">{segment.shown.length}</span>
                  </button>
                  <button type="button" className="drawer-place-all" onClick={() => place(segment.shown.map((unit) => unit.id))} title={`Place all ${segment.shown.length} on this canvas, laid out together`} data-dg={`drawer-place-all-${segment.title}`}>
                    Place all
                  </button>
                </header>
                {shut ? null : (
                  <ul className="drawer-units">
                    {segment.shown.map((unit) => (
                      <li key={unit.id}>
                        <button
                          type="button"
                          className="drawer-unit"
                          data-base={unit.base ?? "none"}
                          aria-pressed={selected.includes(unit.id)}
                          draggable
                          onClick={() => toggle(unit.id)}
                          onDragStart={(event) => {
                            const ids = selected.includes(unit.id) ? selected : [unit.id];
                            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                          style={unit.color ? ({ "--type": unit.color } as CSSProperties) : undefined}
                          data-dg={`drawer-unit-${unit.title}`}
                        >
                          <span className="drawer-check" aria-hidden="true">{selected.includes(unit.id) ? <Icon name="check" /> : null}</span>
                          <span className="chip" data-base={unit.base ?? "none"}>{unit.abbreviation ?? "—"}</span>
                          <span className="drawer-unit-title">{plain(unit.title)}</span>
                          <span className="drawer-unit-meta">
                            {unit.links ? <span className="drawer-links" title={`${unit.links} ${unit.links === 1 ? "link" : "links"} to cards on this canvas`}>↔ {unit.links}</span> : null}
                            <Mark credit={unit.credit} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};
