import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";
import { ALT, HitBody, MOD, useOpenCanvas, useSearch } from "./parts.tsx";

/**
 * The quick finder: type a few words, then open the unit, link it at the
 * cursor, or put it on the canvas in focus, and the finder closes. Anything
 * longer goes to the search panel, which keeps the same search.
 */

const LIMIT = 12;

export const Find = ({ connection }: { connection: Connection }) => {
  /** Opened to link a unit into a note, so Enter links and Alt+Enter opens. */
  const linking = connection.route.id === "link";
  const { call } = connection;
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  // Browsers send a mouse move when rows move under a still pointer; only a real move picks a row.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hover = (event: React.MouseEvent, index: number) => {
    const at = { x: event.clientX, y: event.clientY };
    const moved = pointer.current !== null && (pointer.current.x !== at.x || pointer.current.y !== at.y);
    pointer.current = at;
    if (moved) setActive(index);
  };
  const report = useCallback((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)), []);
  const query = useMemo(() => ({ text, limit: LIMIT }), [text]);
  const results = useSearch(connection, query, report, 40);
  const canvas = useOpenCanvas(connection);
  const hits = useMemo(() => results?.hits ?? [], [results]);

  useEffect(() => setActive(0), [results]);
  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => void call("dialog.close", {}).catch(report);
  const done = (work: Promise<unknown>) =>
    void work.then(close).catch((error: Error) => setNotice(/cursor/i.test(error.message) ? "Click into a note first, then link." : error.message));

  const open = (hit: SearchHit) =>
    done(
      hit.node.hasText
        ? call("base.reveal", { id: hit.node.id, placement: "main" })
        : call("focus.set", { node: hit.node.id }).then(() => call("panel.open", { surface: "context" })),
    );
  const put = (hit: SearchHit) => {
    if (canvas) done(call("units.put", { canvas: canvas.id, nodes: [hit.node.id] }));
  };
  const link = (hit: SearchHit) => {
    if (hit.node.hasText) done(call("node.insertLink", { id: hit.node.id }));
    else setNotice("This unit has no note to link to yet.");
  };
  const all = () => done(call("search.show", { query: { text } }));

  const onKey = (event: React.KeyboardEvent) => {
    const hit = hits[active];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((old) => Math.min(old + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((old) => Math.max(old - 1, 0));
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey && (event.metaKey || event.ctrlKey)) all();
      else if (!hit) return;
      else if (event.metaKey || event.ctrlKey) put(hit);
      else if (event.altKey !== linking) link(hit);
      else open(hit);
    }
  };

  return (
    <main className="find" data-dg="find">
      <label className="find-box">
        <Icon name="search" />
        <input
          autoFocus
          data-dg="find-input"
          aria-label="Find a unit"
          aria-controls="find-results"
          aria-activedescendant={hits[active] ? `find-${active}` : undefined}
          placeholder={linking ? "Find a unit to link" : "Find a unit by its words"}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
        />
      </label>
      {notice ? <p className="find-notice" role="alert" data-dg="find-notice">{notice}</p> : null}
      <ul id="find-results" className="find-list" ref={list} role="listbox" aria-label="Units found" data-dg="find-results">
        {hits.map((hit, index) => (
          <li key={hit.node.id} id={`find-${index}`} role="option" aria-selected={index === active} data-row={index}>
            <button
              type="button"
              className="find-row"
              data-active={index === active}
              data-dg={`find-hit-${hit.node.title}`}
              tabIndex={-1}
              onMouseMove={(event) => hover(event, index)}
              onClick={(event) => (event.metaKey || event.ctrlKey ? put(hit) : event.altKey !== linking ? link(hit) : open(hit))}
            >
              <HitBody hit={hit} />
            </button>
          </li>
        ))}
        {results && !hits.length ? (
          <li className="find-none" data-dg="find-none">{text.trim() ? `Nothing matches “${text.trim()}”` : "No units yet"}</li>
        ) : null}
      </ul>
      <footer className="find-keys">
        <span><kbd>↵</kbd> {linking ? "insert link" : "open"}</span>
        {canvas ? <span><kbd>{MOD}↵</kbd> put on {canvas.title}</span> : null}
        <span><kbd>{ALT}↵</kbd> {linking ? "open" : "insert link"}</span>
        <button type="button" className="find-all" data-dg="find-all" onClick={all}>
          {results && results.total > hits.length ? `All ${results.total} in the search panel` : "Open the search panel"}
        </button>
      </footer>
    </main>
  );
};
