import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Reaction } from "@dg/contract/records.ts";
import type { ContextEntry, NodeSummary, NodeView, RelationOption } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Icon, plain, Mark } from "../shared/ui.tsx";

type Group = { label: string; entries: ContextEntry[] };

/** Proposals come first, because they're the only thing here waiting on a person. */
const groupsOf = (entries: ContextEntry[]): Group[] => {
  const groups = new Map<string, ContextEntry[]>();
  for (const entry of entries) {
    if (entry.state !== "active" && entry.state !== "pending") continue;
    groups.set(entry.label, [...(groups.get(entry.label) ?? []), entry]);
  }
  const waiting = (group: Group): number => (group.entries.some((entry) => entry.state === "pending") ? 0 : 1);
  return [...groups]
    .map(([label, items]) => ({ label, entries: items }))
    .sort((a, b) => waiting(a) - waiting(b) || a.label.localeCompare(b.label));
};

const Relate = ({ connection, node, onDone }: { connection: Connection; node: string; onDone: () => void }) => {
  const { call } = connection;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NodeSummary[]>([]);
  const [picked, setPicked] = useState<NodeSummary | null>(null);
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    void call("node.query", { text: query, limit: 6 })
      .then((found) => setResults(found.filter((item) => item.id !== node)))
      .catch((error: Error) => setNotice(error.message));
  }, [call, node, query]);

  const pick = async (other: NodeSummary): Promise<void> => {
    setPicked(other);
    const found = await call("relation.options", { source: node, target: other.id });
    setOptions(found);
    if (found.length === 0) setNotice("The grammar has no relation between these two.");
  };

  const assert = async (option: RelationOption): Promise<void> => {
    const [source, target] = option.flipped ? [picked!.id, node] : [node, picked!.id];
    await call("relation.assert", { type: option.type, source, target }).catch((error: Error) => setNotice(error.message));
    onDone();
  };

  return (
    <div className="relate">
      {picked ? (
        <>
          <p className="relate-target"><Chip node={picked} /> {plain(picked.title)}</p>
          <div className="relate-options">
            {options.map((option) => (
              <button key={`${option.type}-${option.flipped}`} type="button" data-dg={`relate-${option.label}`} onClick={() => void assert(option)}>
                {option.label}
              </button>
            ))}
            <button type="button" className="quiet" onClick={onDone}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <input
            autoFocus
            data-dg="relate-search"
            aria-label="Find a node to relate"
            placeholder="Find a node to relate"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onDone();
              if (event.key === "Enter" && results[0]) void pick(results[0]);
            }}
          />
          <ul className="rows">
            {results.map((item) => (
              <li key={item.id}>
                <button type="button" className="row-main" data-dg={`relate-result-${item.title}`} onClick={() => void pick(item)}>
                  <Chip node={item} />
                  <span>{plain(item.title)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {notice ? <p role="alert">{notice}</p> : null}
    </div>
  );
};

const whenText = (at: string): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(at));

type PanelProps = { view: NodeView; call: Connection["call"]; report: (error: Error) => void };

/** Where a unit came from, and every place it lives now. */
const Provenance = ({ view, call, report }: PanelProps) => {
  const { provenance } = view;
  const { paper, pdf, lives, created, edited } = provenance;
  const show = (id: string): void => void call("canvas.show", { id }).catch(report);
  const read = (): void => void (pdf ? call("pdf.show", { ref: pdf.ref, unit: view.node.id }).catch(report) : undefined);
  return (
    <section className="ctx-group" data-dg="ctx-provenance">
      <h2>Where it came from</h2>
      <p className="ctx-line">
        Made by {created.credit.name} on {whenText(created.at)}
        {edited ? `, last changed by ${edited.name} on ${whenText(edited.at)}` : ""}
      </p>
      {paper ? (
        <div className="ctx-source" data-dg="ctx-paper">
          <button type="button" className="ctx-link" data-dg="ctx-paper-open" onClick={() => show(paper.canvas)}>{paper.title}</button>
          {paper.anchor ? <blockquote data-dg="ctx-anchor">{paper.anchor}</blockquote> : null}
          {pdf ? <button type="button" className="ctx-link" data-dg="ctx-pdf-open" onClick={read}>Open the passage in the PDF</button> : null}
          {paper.description ? <p className="ctx-line">{paper.description}</p> : null}
          <p className="ctx-line">
            Extracted by {paper.extractedBy} on {whenText(paper.at)}, with {paper.model} on {paper.server}, into the {paper.schema} schema
            {paper.doi ? `. DOI ${paper.doi}` : ""}
          </p>
        </div>
      ) : null}
      {pdf && !paper ? (
        <div className="ctx-source" data-dg="ctx-pdf">
          <p className="ctx-line">Highlighted in {pdf.name}{pdf.page ? `, page ${pdf.page}` : ""}</p>
          {pdf.exact ? <blockquote data-dg="ctx-anchor">{pdf.exact}</blockquote> : null}
          <button type="button" className="ctx-link" data-dg="ctx-pdf-open" onClick={read}>Open the passage in the PDF</button>
        </div>
      ) : null}
      <h2>Where it lives</h2>
      <ul className="mentions" data-dg="ctx-lives">
        <li>{lives.text ? `Text: ${plain(lives.text.title)}` : "No note or page yet. Export it to make one."}</li>
        {lives.canvases.map(({ id, title, shared }) => (
          <li key={id}>
            <button type="button" className="ctx-link" onClick={() => show(id)}>{title}</button>
            {shared ? " (shared)" : ""}
          </li>
        ))}
        {lives.folders.map(({ id, title }) => <li key={id}>Folder: {title}</li>)}
        {lives.lab ? <li>Lab: {lives.lab}</li> : null}
      </ul>
    </section>
  );
};

const REACTION_LABELS: { value: Reaction; label: string }[] = [
  { value: "interesting", label: "Interesting" },
  { value: "agree", label: "Agree" },
  { value: "disagree", label: "Disagree" },
];

const Social = ({ view, call, report }: PanelProps) => {
  const [text, setText] = useState("");
  const social = view.social!;
  const unit = view.node.id;
  const add = (): void => {
    if (!text.trim()) return;
    void call("unit.note", { unit, text: text.trim() }).catch(report);
    setText("");
  };
  return (
    <section className="ctx-group" data-dg="ctx-social">
      <h2>Reactions</h2>
      <div className="ctx-reactions">
        {REACTION_LABELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            data-dg={`ctx-react-${value}`}
            aria-pressed={social.mine === value}
            title={social.who[value].join(", ") || undefined}
            onClick={() => void call("unit.react", { unit, value: social.mine === value ? null : value }).catch(report)}
          >
            {label}{social.who[value].length > 0 ? ` ${social.who[value].length}` : ""}
          </button>
        ))}
      </div>
      <h2>Notes</h2>
      <ul className="ctx-notes" data-dg="ctx-notes" role="log" aria-live="polite">
        {social.notes.map((note) => (
          <li key={note.id}>
            <Mark credit={note.credit} />
            <span>
              <strong>{note.credit.name}</strong> {note.text}
            </span>
            {note.mine ? <button type="button" className="icon-button" aria-label="Remove note" onClick={() => void call("unit.removeNote", { id: note.id }).catch(report)}><Icon name="close" /></button> : null}
          </li>
        ))}
      </ul>
      <div className="ctx-note-input">
        <input
          data-dg="ctx-note"
          aria-label="Add a note"
          placeholder="Add a note"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
      </div>
    </section>
  );
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, on } = connection;
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<NodeView | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [relating, setRelating] = useState(false);
  const [notice, setNotice] = useState("");
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  const load = useCallback(async () => {
    const id = focusRef.current;
    if (!id) {
      setView(null);
      return;
    }
    try {
      const next = await call("node.view", { id });
      if (focusRef.current === id) setView(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, [call]);

  useEffect(() => {
    void call("focus.get", {}).then(setFocus);
  }, [call]);
  useEffect(() => {
    setRelating(false);
    void load();
  }, [focus, load]);
  useEffect(() => on("graph-changed", () => void load()), [on, load]);
  useEffect(
    () =>
      on("focus-changed", ({ node }) => {
        if (pinnedRef.current || !node || node === focusRef.current) return;
        setTrail([]);
        setFocus(node);
      }),
    [on],
  );

  /** Walking the graph here moves only this panel, so the canvas doesn't jump. */
  const walk = (next: string): void => {
    if (focus) setTrail((old) => [...old, focus]);
    setFocus(next);
  };

  const groups = useMemo(() => groupsOf(view?.context ?? []), [view]);
  const report = (error: Error): void => setNotice(error.message);
  const decide = (id: string, decision: "accepted" | "rejected"): void => {
    void call("relation.decide", { id, decision }).catch(report);
  };

  if (!view) {
    return (
      <main className="ctx-empty">
        <strong>Nothing selected</strong>
        <p>Select a card, or open a node in your notes.</p>
      </main>
    );
  }

  const { node, body, mentionedIn, attribution } = view;
  return (
    <main className="ctx">
      <header className="ctx-head">
        <div className="ctx-bar">
          {trail.length > 0 ? (
            <button
              type="button"
              className="icon-button"
              data-dg="ctx-back"
              aria-label="Back"
              title="Back"
              onClick={() => {
                setFocus(trail[trail.length - 1]!);
                setTrail((old) => old.slice(0, -1));
              }}
            >
              <Icon name="back" />
            </button>
          ) : null}
          <Chip node={node} />
          <span className="ctx-type">{node.typeLabel ?? "No type yet"}</span>
          <button
            type="button"
            className="icon-button pin"
            data-dg="ctx-pin"
            aria-label="Keep this node in view"
            title="Keep this node in view"
            aria-pressed={pinned}
            onClick={() => setPinned((on_) => !on_)}
          >
            <Icon name="pin" />
          </button>
        </div>
        <h1 className="ctx-title" data-dg="ctx-title">{plain(node.title)}</h1>
        <div className="ctx-actions">
          {node.hasText ? (
            <button type="button" data-dg="ctx-open" onClick={() => void call("base.reveal", { id: node.id, placement: "main" }).catch(report)}>
              <Icon name="open" /> Open text
            </button>
          ) : null}
          <button type="button" data-dg="ctx-place" onClick={() => void call("canvas.place", { node: node.id }).catch(report)}>
            <Icon name="canvas" /> Add to canvas
          </button>
          <button type="button" data-dg="ctx-relate" aria-expanded={relating} onClick={() => setRelating((on_) => !on_)}>
            <Icon name="link" /> Relate
          </button>
        </div>
        {notice ? <p role="alert" className="ctx-notice">{notice}</p> : null}
      </header>

      {relating ? <Relate connection={connection} node={node.id} onDone={() => setRelating(false)} /> : null}

      {groups.length === 0 ? <p className="ctx-none">No relations yet.</p> : null}
      {groups.map(({ label, entries }) => (
        <section key={label} className="ctx-group" data-dg={`group-${label}`}>
          <h2>{label} <span>{entries.length}</span></h2>
          <ul className="rows">
            {entries.map(({ relation, state, other }) => (
              <li key={relation.id} data-state={state}>
                <button type="button" className="row-main" data-dg={`row-${other.title}`} onClick={() => walk(other.id)}>
                  <Chip node={other} />
                  <span>{plain(other.title)}</span>
                </button>
                {state === "pending" ? (
                  <div className="decide">
                    <span>Proposed</span>
                    <button type="button" data-dg={`accept-${other.title}`} onClick={() => decide(relation.id, "accepted")}>Accept</button>
                    <button type="button" className="quiet" data-dg={`reject-${other.title}`} onClick={() => decide(relation.id, "rejected")}>Reject</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {body?.trim() ? (
        <section className="ctx-group">
          <h2>Text</h2>
          <p className="ctx-text" data-dg="ctx-text">{body.trim().replace(/^\s*-\s+/gm, "")}</p>
        </section>
      ) : null}

      {mentionedIn.length > 0 ? (
        <section className="ctx-group">
          <h2>Mentioned in <span>{mentionedIn.length}</span></h2>
          <ul className="mentions">
            {mentionedIn.map(({ title }) => <li key={title}>{plain(title)}</li>)}
          </ul>
        </section>
      ) : null}

      <Provenance view={view} call={call} report={report} />
      {view.social ? <Social view={view} call={call} report={report} /> : null}

      <footer className="ctx-id">
        <span className="ctx-credit">
          <Mark credit={node.credit} dg="ctx-credit" />
          {attribution.lab ? `${attribution.person}, ${attribution.lab}` : attribution.person}
        </span>
        <code data-dg="ctx-uri" title={node.uri}>{node.uri}</code>
      </footer>
    </main>
  );
};
