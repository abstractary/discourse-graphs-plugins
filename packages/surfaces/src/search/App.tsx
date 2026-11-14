import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProposalGroup, ProposalItem, Candidate, NodeView, SearchCarry, SearchField, SearchHit, SearchSort } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Highlighted, Icon, plain } from "../shared/ui.tsx";
import { DRAG_TYPE, HitBody, MOD, useOpenCanvas, useSearch } from "./parts.tsx";
import { messageOf } from "../shared/words.ts";

/**
 * Unit search, in a side panel that stays while a person works. Results show
 * why they matched, can be filtered by type and by who they're credited to, and
 * open, link or go on the canvas in focus. Several can be picked and dragged
 * onto a canvas together.
 */

const ALL_FIELDS: SearchField[] = ["title", "passage", "text"];
const FIELD_LABEL: Record<SearchField, string> = { title: "Titles", text: "Notes", passage: "Passages" };
const SORTS: { value: SearchSort | ""; label: string }[] = [
  { value: "", label: "Best match" },
  { value: "edited", label: "Last edited" },
  { value: "created", label: "Newest" },
  { value: "title", label: "Title A–Z" },
];
const PAGE = 50;

/** The first lines of a note, as text. */
const excerpt = (body: string | null): string => {
  if (!body) return "";
  const text = body
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 320 ? `${text.slice(0, 320).replace(/\s+\S*$/, "")}…` : text;
};

const KIND_WORD: Record<ProposalItem["kind"], string> = { unit: "Unit", relation: "Relation", check: "Check" };

/**
 * What agents have proposed and nobody has answered. None of it is part of the argument. Each can be
 * taken or turned down by itself, or a whole conversation at once. Shown only when something waits.
 */
const Proposals = ({ call, on, say }: { call: Connection["call"]; on: Connection["on"]; say: (message: string) => void }) => {
  const [groups, setGroups] = useState<ProposalGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void call("proposal.list", {}).then(setGroups).catch(() => setGroups([])), [call]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);
  const waiting = groups.map((group) => ({ ...group, items: group.items.filter((item) => item.state === "waiting") })).filter((group) => group.items.length > 0);
  const count = waiting.reduce((sum, group) => sum + group.items.length, 0);
  if (count === 0) return null;
  const decide = (ids: string[], decision: "accept" | "reject"): void => {
    setBusy(true);
    void call("proposal.decide", { ids, decision })
      .then((next) => (setGroups(next), say(decision === "accept" ? `Accepted ${ids.length}. ${ids.length === 1 ? "It is" : "They are"} yours now.` : `Turned down ${ids.length}.`)))
      .catch((error: Error) => (say(error.message), load()))
      .finally(() => setBusy(false));
  };
  return (
    <section className="srch-candidates srch-proposals" data-dg="proposals">
      <button type="button" className="srch-candidates-head" aria-expanded={open} data-dg="proposals-toggle" onClick={() => (setOpen(!open), load())}>
        {count} {count === 1 ? "proposal" : "proposals"} from {waiting.length === 1 ? waiting[0]!.agent : "your agents"} {count === 1 ? "waits" : "wait"} for you
        <Icon name="chevron" />
      </button>
      {open ? waiting.map((group) => (
        <div key={`${group.agent}:${group.session}`} data-dg={`proposal-group-${group.session}`}>
          <div className="srch-proposal-head">
            <span><strong>{group.session}</strong> · {group.agent}</span>
            <span>
              <button type="button" disabled={busy} data-dg="proposal-accept-all" onClick={() => decide(group.items.map((item) => item.id), "accept")}>Accept all {group.items.length}</button>
              <button type="button" disabled={busy} data-dg="proposal-reject-all" onClick={() => decide(group.items.map((item) => item.id), "reject")}>Turn all down</button>
            </span>
          </div>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <span className="srch-candidate-text"><span className="srch-proposal-kind">{item.typeLabel ?? KIND_WORD[item.kind]}</span> {item.text}</span>
                <span className="srch-candidate-from">{item.restsOn ?? (item.kind === "unit" ? "Rests on nothing quoted" : "")}</span>
                <span className="srch-proposal-acts">
                  <button type="button" disabled={busy} data-dg={`proposal-accept-${item.text}`} onClick={() => decide([item.id], "accept")}>Accept</button>
                  <button type="button" disabled={busy} data-dg={`proposal-reject-${item.text}`} onClick={() => decide([item.id], "reject")}>Turn down</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )) : null}
    </section>
  );
};

/**
 * Lines a person tagged while writing, such as `#clm-candidate`. Each can become a unit of its type,
 * and the line is then swapped for a link to it. Shown only when there are some.
 */
const Candidates = ({ call, on, say }: { call: Connection["call"]; on: Connection["on"]; say: (message: string) => void }) => {
  const [list, setList] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => void call("candidate.list", {}).then((found) => setList(found.candidates)).catch(() => setList([])), [call]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);
  if (list.length === 0) return null;
  return (
    <section className="srch-candidates" data-dg="candidates">
      <button type="button" className="srch-candidates-head" aria-expanded={open} data-dg="candidates-toggle" onClick={() => (setOpen(!open), load())}>
        {list.length} {list.length === 1 ? "line is" : "lines are"} tagged as {list.length === 1 ? "a candidate" : "candidates"}
        <Icon name="chevron" />
      </button>
      {open ? (
        <ul>
          {list.map((item) => {
            const key = `${item.ref}:${item.line}`;
            return (
              <li key={key}>
                <span className="srch-candidate-text">{item.text}</span>
                <span className="srch-candidate-from">In {item.note}</span>
                <button
                  type="button"
                  data-dg={`candidate-make-${item.text}`}
                  disabled={busy === key}
                  onClick={() => {
                    setBusy(key);
                    void call("candidate.promote", { ref: item.ref, line: item.line, type: item.type, text: item.text })
                      .then((unit) => say(`Made ${item.typeLabel}: ${unit.title}`))
                      .catch((error: Error) => say(error.message))
                      .finally(() => (setBusy(""), load()));
                  }}
                >
                  Make it a {item.typeLabel}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, on } = connection;
  const [text, setText] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [credits, setCredits] = useState<string[]>([]);
  const [fields, setFields] = useState<SearchField[]>(ALL_FIELDS);
  const [sort, setSort] = useState<SearchSort | "">("");
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [preview, setPreview] = useState<NodeView | null>(null);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const report = useCallback((error: unknown) => setNotice(messageOf(error)), []);

  const carry = useCallback((query: SearchCarry) => {
    setText(query.text ?? "");
    setTypes(query.types ?? []);
    setCredits(query.credits ?? []);
    setFields(query.fields?.length ? query.fields : ALL_FIELDS);
    setSort(query.sort ?? "");
    setPicked([]);
    setShown(null);
    input.current?.focus();
  }, []);
  useEffect(() => {
    void call("search.take", {}).then((query) => query && carry(query)).catch(report);
    return on("search-set", ({ query }) => carry(query));
  }, [call, on, carry, report]);

  const query = useMemo(
    () => ({ text, types, credits, fields, ...(sort ? { sort } : {}), limit }),
    [text, types, credits, fields, sort, limit],
  );
  const results = useSearch(connection, query, report);
  const canvas = useOpenCanvas(connection);
  const hits = useMemo(() => results?.hits ?? [], [results]);
  const byId = useMemo(() => new Map(hits.map((hit) => [hit.node.id, hit])), [hits]);

  useEffect(() => setLimit(PAGE), [text, types, credits, fields, sort]);
  // A unit that stopped matching leaves the selection.
  useEffect(
    () =>
      setPicked((old) => {
        const kept = old.filter((id) => byId.has(id));
        return kept.length === old.length ? old : kept;
      }),
    [byId],
  );

  useEffect(() => {
    if (!shown) return setPreview(null);
    let live = true;
    void call("node.view", { id: shown }).then((view) => live && setPreview(view)).catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [call, shown, results]);

  const open = (hit: SearchHit) => {
    if (hit.node.hasText) void call("base.reveal", { id: hit.node.id, placement: "main" }).catch(report);
    else void call("focus.set", { node: hit.node.id }).then(() => call("panel.open", { surface: "context" })).catch(report);
  };
  const context = (id: string) => void call("focus.set", { node: id }).then(() => call("panel.open", { surface: "context" })).catch(report);
  const link = (id: string) =>
    void call("node.insertLink", { id })
      .then(() => setNotice("Linked at your cursor"))
      .catch((error: Error) => setNotice(/cursor/i.test(error.message) ? "Click into a note first, then link." : error.message));
  const put = (ids: string[]) => {
    if (!canvas) return;
    void call("units.put", { canvas: canvas.id, nodes: ids })
      .then(({ placed, already }) => {
        const where = canvas.title;
        if (placed.length && already.length) setNotice(`Put ${placed.length} on ${where}. ${already.length} already there.`);
        else if (placed.length) setNotice(placed.length === 1 ? `Put on ${where}` : `Put ${placed.length} on ${where}`);
        else setNotice(already.length === 1 ? `Already on ${where}` : `All ${already.length} already on ${where}`);
      })
      .catch(report);
  };

  const choose = (hit: SearchHit, event: React.MouseEvent) => {
    const id = hit.node.id;
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setPicked((old) => (old.includes(id) ? old.filter((other) => other !== id) : [...old, id]));
      return;
    }
    setPicked([id]);
    setShown((old) => (old === id ? null : id));
  };

  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [results]);
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, Math.min(hits.length - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      const hit = hits[next];
      if (hit) {
        setPicked([hit.node.id]);
        setShown(hit.node.id);
        document.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (event.key === "Enter" && hits[Math.max(active, 0)]) {
      open(hits[Math.max(active, 0)]!);
    } else if (event.key === "Escape") {
      setText("");
    }
  };

  const toggleField = (field: SearchField) =>
    setFields((old) => (old.includes(field) ? (old.length > 1 ? old.filter((f) => f !== field) : old) : ALL_FIELDS.filter((f) => f === field || old.includes(f))));

  const filtered = types.length > 0 || credits.length > 0 || fields.length < ALL_FIELDS.length;
  const ready = results?.textReady ?? false;

  return (
    <main className="srch" data-dg="search-panel">
      <header className="srch-head">
        <label className="srch-box">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            data-dg="search-input"
            aria-label="Search units"
            placeholder="Search titles, notes and passages"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKey}
          />
          {text ? (
            <button type="button" className="srch-clear" aria-label="Clear the search" data-dg="search-clear" onClick={() => setText("")}>
              <Icon name="close" />
            </button>
          ) : null}
        </label>
        <div className="srch-filters">
          <select aria-label="Type" data-dg="search-type" value={types[0] ?? ""} onChange={(event) => setTypes(event.target.value ? [event.target.value] : [])}>
            <option value="">Any type</option>
            {(results?.types ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>{`${facet.label} (${facet.count})`}</option>
            ))}
          </select>
          <select aria-label="Credited to" data-dg="search-credit" value={credits[0] ?? ""} onChange={(event) => setCredits(event.target.value ? [event.target.value] : [])}>
            <option value="">Anyone</option>
            {(results?.credits ?? []).map((facet) => (
              <option key={facet.id} value={facet.id}>{`${facet.mine ? "Me" : facet.kind === "lab" ? `${facet.label} (lab)` : facet.label} · ${facet.count}`}</option>
            ))}
          </select>
          <select aria-label="Sort" data-dg="search-sort" value={sort} onChange={(event) => setSort(event.target.value as SearchSort | "")}>
            {SORTS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </div>
        <div className="srch-fields" role="group" aria-label="Search in">
          {ALL_FIELDS.map((field) => (
            <button key={field} type="button" aria-pressed={fields.includes(field)} data-dg={`search-field-${field}`} onClick={() => toggleField(field)}>
              {FIELD_LABEL[field]}
            </button>
          ))}
          <span className="srch-count" data-dg="search-count" role="status">
            {results ? `${results.total} ${results.total === 1 ? "unit" : "units"}` : ""}
            {results && !ready && fields.includes("text") ? " · reading notes…" : ""}
          </span>
        </div>
      </header>

      {notice ? (
        <p className="srch-notice" role="status" data-dg="search-notice">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice("")}><Icon name="close" /></button>
        </p>
      ) : null}

      <Proposals call={call} on={on} say={setNotice} />
      <Candidates call={call} on={on} say={setNotice} />

      {picked.length > 1 ? (
        <div className="srch-bulk" data-dg="search-bulk">
          <span>{picked.length} picked</span>
          {canvas ? (
            <button type="button" className="primary" data-dg="search-put-picked" onClick={() => put(picked)}>
              Put on {canvas.title}
            </button>
          ) : (
            <span className="srch-hint">Open a canvas to put them on it, or drag them there</span>
          )}
          <button type="button" data-dg="search-unpick" onClick={() => setPicked([])}>Clear</button>
        </div>
      ) : null}

      <ul className="srch-list" data-dg="search-results" role="listbox" aria-label="Units found" aria-multiselectable="true">
        {hits.map((hit, index) => {
          const id = hit.node.id;
          const isOpen = shown === id;
          return (
            <li key={id} data-row={index}>
              <button
                type="button"
                role="option"
                className="srch-row"
                aria-selected={picked.includes(id)}
                aria-expanded={isOpen}
                data-active={index === active}
                data-dg={`search-hit-${plain(hit.node.title)}`}
                draggable
                onDragStart={(event) => {
                  const ids = picked.includes(id) ? picked : [id];
                  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
                  event.dataTransfer.setData("text/plain", ids.map((unit) => plain(byId.get(unit)?.node.title ?? "")).join("\n"));
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={(event) => choose(hit, event)}
                onDoubleClick={() => open(hit)}
              >
                <HitBody hit={hit} places />
              </button>
              {isOpen ? (
                <div className="srch-preview" data-dg="search-preview">
                  {preview?.node.id === id && excerpt(preview.body) ? <p className="srch-excerpt"><Highlighted text={excerpt(preview.body)} query={text} /></p> : null}
                  {preview?.node.id === id && preview.context.length ? (
                    <ul className="srch-links" aria-label="Relations">
                      {preview.context.slice(0, 4).map((entry) => (
                        <li key={entry.relation.id} data-state={entry.state}>
                          <span>{entry.label}</span> <Highlighted text={entry.other.title} query={text} />
                        </li>
                      ))}
                      {preview.context.length > 4 ? <li className="srch-more">and {preview.context.length - 4} more</li> : null}
                    </ul>
                  ) : null}
                  {hit.canvases.length > 1 ? <p className="srch-where">{hit.canvases.map((entry) => entry.title).join(", ")}</p> : null}
                  <div className="srch-actions">
                    <button type="button" data-dg="search-open" onClick={() => open(hit)}>
                      <Icon name="open" /> {hit.node.hasText ? "Open" : "Context"}
                    </button>
                    {hit.node.hasText ? (
                      <button type="button" data-dg="search-link" title="Put a link to it at your cursor" onClick={() => link(id)}>
                        <Icon name="link" /> Insert link
                      </button>
                    ) : null}
                    {canvas ? (
                      <button type="button" data-dg="search-put" title={`Put it on ${canvas.title}`} onClick={() => put([id])}>
                        <Icon name="canvas" /> Put on {canvas.title}
                      </button>
                    ) : null}
                    {hit.node.hasText ? (
                      <button type="button" data-dg="search-context" onClick={() => context(id)}>
                        <Icon name="context" /> Context
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {results && results.total > hits.length ? (
        <button type="button" className="srch-more-button" data-dg="search-more" onClick={() => setLimit((old) => old + PAGE)}>
          Show more ({results.total - hits.length} left)
        </button>
      ) : null}

      {results && !hits.length ? (
        <div className="srch-empty" data-dg="search-empty">
          {text.trim() ? (
            <>
              <strong>Nothing matches “{text.trim()}”</strong>
              <p>{filtered ? "Try another type or person, or search titles, notes and passages." : "Try fewer words, or part of a word."}</p>
            </>
          ) : (
            <>
              <strong>No units yet</strong>
              <p>Units you capture, highlight or extract show up here.</p>
            </>
          )}
        </div>
      ) : null}

      {hits.length ? (
        <p className="srch-tip">
          Drag results onto a canvas. {MOD}-click picks several. Double-click opens.
        </p>
      ) : null}
    </main>
  );
};
