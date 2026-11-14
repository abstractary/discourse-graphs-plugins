import { useEffect, useState } from "react";
import type { NodeTypeRecord } from "@dg/contract/records.ts";
import type { NodeSummary, SearchHit } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Marked } from "../shared/ui.tsx";
import type { Anchor } from "./items.ts";

/**
 * The box that adds a unit to the canvas: find one that exists, or name a new
 * one and say what type it is. It only chooses; the canvas places the card.
 */
export const AddBox = ({
  connection,
  at,
  next,
  types,
  onPick,
  onCreate,
  onClose,
  report,
}: {
  connection: Connection;
  at: Anchor;
  /** Opened by dropping a connection on empty canvas, so what's added is the next card of the argument. */
  next: boolean;
  types: NodeTypeRecord[];
  onPick: (node: NodeSummary) => void;
  onCreate: (title: string, type?: string) => void;
  onClose: () => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
    void call("search.query", { text: query, limit: 8 }).then(({ hits }) => setResults(hits)).catch(report);
  }, [query, call, report]);

  return (
    <div className="popover add-popover" role="dialog" aria-label="Add a unit" style={at}>
      <input
        autoFocus
        data-dg="node-search"
        aria-label="Find or name a unit"
        placeholder={next ? "Find or name the next unit" : "Find or name a unit"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") setActive((old) => Math.min(old + 1, results.length - 1));
          if (event.key === "ArrowUp") setActive((old) => Math.max(old - 1, 0));
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && results[active]) onPick(results[active]!.node);
        }}
      />
      <ul>
        {results.map((hit, index) => (
          <li key={hit.node.id}>
            <button
              type="button"
              data-dg={`result-${hit.node.title}`}
              data-active={index === active}
              onClick={() => onPick(hit.node)}
            >
              <Chip node={hit.node} />
              <span className="result-text">
                <span className="result-title"><Marked text={hit.node.title} marks={hit.titleMarks} /></span>
                {hit.match ? (
                  <span className="result-match"><Marked text={hit.match.snippet} marks={hit.match.marks} /></span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {query.trim() ? (
        <div className="create-row">
          <span>Create “{query.trim()}” as</span>
          {types.map((type) => (
            <button key={type.id} type="button" data-dg={`create-${type.label}`} onClick={() => onCreate(query.trim(), type.id)}>
              {type.label}
            </button>
          ))}
          <button type="button" data-dg="create-untyped" onClick={() => onCreate(query.trim())}>No type yet</button>
        </div>
      ) : null}
    </div>
  );
};
