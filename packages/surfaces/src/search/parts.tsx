import { useEffect, useRef, useState } from "react";
import type { SearchHit, SearchQuery, SearchResults } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Mark, Marked, LibraryMark } from "../shared/ui.tsx";

export { Marked };
import { DRAG_TYPE } from "../shared/drag.ts";
import { ALT, MAC, MOD } from "../shared/keys.ts";

/** What's shared by the search panel, the quick finder and the canvas's Add node box. */

export { DRAG_TYPE };
export { ALT, MAC, MOD };

const FIELD_WORD = { text: "Note", passage: "Passage" } as const;

/** Where a unit lives, said briefly. */
export const placesOf = (hit: SearchHit): string => {
  const [first, ...rest] = hit.canvases;
  if (!first) return hit.node.staged ? "Read from a PDF or paper, on no canvas yet" : "On no canvas";
  return rest.length ? `On ${first.title} and ${rest.length} more` : `On ${first.title}`;
};

/** One result: its type, its title with the words marked, and where else the words turned up. */
export const HitBody = ({ hit, places = false }: { hit: SearchHit; places?: boolean }) => (
  <>
    <span className="hit-head">
      <Chip node={hit.node} />
      <span className="hit-title"><Marked text={hit.node.title} marks={hit.titleMarks} /></span>
      {hit.node.paper ? <><span className="from-paper" title={`Read from ${hit.node.paper.title}`}>{hit.node.paper.label}</span><LibraryMark library={hit.node.paper.library} /></> : <Mark credit={hit.node.credit} />}
    </span>
    {hit.match ? (
      <span className="hit-match">
        <span className="hit-field">{FIELD_WORD[hit.match.field]}</span> <Marked text={hit.match.snippet} marks={hit.match.marks} />
      </span>
    ) : null}
    {places ? <span className="hit-places">{placesOf(hit)}</span> : null}
  </>
);

/** Runs a search as a person types, without letting a slow answer replace a newer one. */
export const useSearch = (connection: Connection, query: SearchQuery, report: (error: unknown) => void, wait = 90) => {
  const { call, on } = connection;
  const [results, setResults] = useState<SearchResults | null>(null);
  const asked = useRef(0);
  const key = JSON.stringify(query);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    const ticket = ++asked.current;
    const timer = window.setTimeout(() => {
      void call("search.query", JSON.parse(key) as SearchQuery)
        .then((next) => {
          if (ticket === asked.current) setResults(next);
        })
        .catch(report);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [call, key, report, wait, again]);
  // Notes read for the first time, or anything edited, can change what's found.
  useEffect(() => on("search-ready", () => setAgain((n) => n + 1)), [on]);
  useEffect(() => {
    let timer: number | undefined;
    const off = on("graph-changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAgain((n) => n + 1), 200);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [on]);
  return results;
};

/** The canvas in focus, which is where "Put on canvas" goes. */
export const useOpenCanvas = (connection: Connection) => {
  const { call, on } = connection;
  const [canvas, setCanvas] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    const titled = async (id: string | null) => {
      if (!id) return setCanvas(null);
      const list = await call("canvas.list", {});
      const found = list.find((entry) => entry.id === id);
      setCanvas(found ? { id: found.id, title: found.title } : null);
    };
    void call("holon.focus.get", {}).then(({ canvas: id }) => titled(id));
    return on("holon-focus-changed", ({ canvas: id }) => {
      // A note opened elsewhere moves the holon in focus, but the canvas tab stays where it was.
      if (id) void titled(id);
    });
  }, [call, on]);
  return canvas;
};
