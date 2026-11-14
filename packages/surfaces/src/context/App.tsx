import { CARD_FIELD_IDS, identifierUrl } from "@dg/contract/scholarly.ts";
import { Facts } from "../shared/facts.tsx";
import { whenOf } from "../shared/people.tsx";
import { Announcements, Work } from "./Work.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Reaction } from "@dg/contract/records.ts";
import { CHECK_WAYS, type CheckWay, type UnitCheck } from "@dg/contract/surface.ts";
import type { ContextEntry, NodeSummary, NodeView, RelationOption, SimilarUnit } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Icon, LibraryMark, plain, Mark } from "../shared/ui.tsx";
import { Method } from "./Method.tsx";
import { messageOf } from "../shared/words.ts";

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

const Relate = ({ connection, node, onDone, initial }: { connection: Connection; node: string; onDone: () => void; initial?: NodeSummary | undefined }) => {
  const { call } = connection;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NodeSummary[]>([]);
  const [picked, setPicked] = useState<NodeSummary | null>(null);
  const [options, setOptions] = useState<RelationOption[]>([]);
  const [notice, setNotice] = useState("");

  // Opened on a unit already chosen, such as one found in another paper: straight to how they relate.
  useEffect(() => {
    if (!initial) return;
    setPicked(initial);
    setNotice("");
    void call("relation.options", { source: node, target: initial.id }).then((found) => {
      setOptions(found);
      if (found.length === 0) setNotice("The grammar has no relation between these two.");
    });
  }, [call, node, initial]);

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
    await call("relation.assert", { type: option.type, source, target, draw: true }).catch((error: Error) => setNotice(error.message));
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
            aria-label="Find a unit to relate"
            placeholder="Find a unit to relate"
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
                  {item.paper ? <><span className="from-paper" title={`Read from ${item.paper.title}`}>{item.paper.label}</span><LibraryMark library={item.paper.library} /></> : null}
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

/**
 * Units in other papers and canvases that read close to this one. It looks only
 * when asked, and only offers: relating two of them is the person's call.
 */
const Elsewhere = ({ connection, node, onWalk, onRelate }: { connection: Connection; node: NodeSummary; onWalk: (id: string) => void; onRelate: (other: NodeSummary) => void }) => {
  const { call, on } = connection;
  const [found, setFound] = useState<SimilarUnit[] | null>(null);
  const [looking, setLooking] = useState(false);
  const look = useCallback(() => {
    setLooking(true);
    void call("node.similar", { id: node.id, limit: 6 })
      .then(setFound)
      .catch(() => setFound([]))
      .finally(() => setLooking(false));
  }, [call, node.id]);
  // Once open, it keeps up: a unit just related drops off the list.
  useEffect(() => (found ? on("graph-changed", look) : undefined), [found, look, on]);
  return (
    <section className="ctx-group ctx-similar" data-dg="ctx-similar">
      <h2>Elsewhere {found ? <span>{found.length}</span> : null}</h2>
      {found === null ? (
        <button type="button" className="ctx-link ctx-similar-find" data-dg="ctx-similar-find" disabled={looking} onClick={look}>
          {looking ? "Looking…" : node.paper ? "Find units like this in other papers" : "Find units like this in your papers"}
        </button>
      ) : found.length === 0 ? (
        <p className="ctx-none">Nothing elsewhere reads close to this.</p>
      ) : (
        <ul className="rows">
          {found.map(({ node: other, shared }) => (
            <li key={other.id}>
              <button type="button" className="row-main" data-dg={`similar-${other.title}`} onClick={() => onWalk(other.id)} title="Show it here">
                <Chip node={other} />
                <span>{plain(other.title)}</span>
                {other.paper ? <><span className="from-paper" title={`Read from ${other.paper.title}`}>{other.paper.label}</span><LibraryMark library={other.paper.library} /></> : null}
                <span className="row-words">Shares: {shared.join(", ")}</span>
              </button>
              <button type="button" className="icon-button" data-dg={`similar-relate-${other.title}`} aria-label="Relate these two" title="Relate these two" onClick={() => onRelate(other)}>
                <Icon name="link" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const whenText = (at: string): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(at));

type PanelProps = { view: NodeView; call: Connection["call"]; report: (error: Error) => void };

const squash = (text: string): string => text.replace(/^[>\s-]+/, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A unit's text with what the panel already says taken out: its title, the
 * passage it quotes and the line naming its paper each have one place here.
 */
export const ownText = (view: NodeView): string => {
  const { paper, pdf, library } = view.provenance;
  const said = [view.node.title, paper?.anchor, pdf?.exact, library?.exact, paper ? `From: ${paper.title}` : undefined, paper?.title]
    .flatMap((text) => (text ? [squash(text)] : []));
  const covered = (line: string): boolean => {
    const plainLine = squash(line);
    // A quote cut short in the note still counts as the quote.
    return said.some((text) => text === plainLine || (plainLine.length > 40 && text.startsWith(plainLine)));
  };
  return (view.body ?? "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block && !covered(block))
    .join("\n\n")
    .replace(/^\s*-\s+/gm, "");
};

/** Where a unit came from, and every place it lives now. */
const Provenance = ({ view, call, report }: PanelProps) => {
  const { provenance } = view;
  const { paper, pdf, lives, edited, library } = provenance;
  // Going to a canvas from here points at this unit there, so the eye lands on it.
  const show = (id: string): void => void call("canvas.reveal", { id, unit: view.node.id }).catch(report);
  const read = (): void => void (pdf ? call("pdf.show", { ref: pdf.ref, unit: view.node.id }).catch(report) : undefined);
  return (
    <>
    <section className="ctx-group" data-dg="ctx-provenance">
      <h2>Where it came from</h2>
      {edited ? <p className="ctx-line" data-dg="ctx-edited">Last changed by {edited.name} on {whenText(edited.at)}</p> : null}
      {paper ? (
        <div className="ctx-source" data-dg="ctx-paper">
          {lives.canvases.some(({ id, title }) => id === paper.canvas || title === paper.title) ? null : (
            <button type="button" className="ctx-link" data-dg="ctx-paper-open" onClick={() => show(paper.canvas)}>{paper.title}</button>
          )}
          {paper.anchor ? <blockquote data-dg="ctx-anchor">{paper.anchor}</blockquote> : null}
          {pdf ? <button type="button" className="ctx-link" data-dg="ctx-pdf-open" onClick={read}>Open the passage in the PDF</button> : null}
          {paper.description && !squash(view.body ?? "").includes(squash(paper.description)) ? <p className="ctx-line">{paper.description}</p> : null}
          <p className="ctx-line" data-dg="ctx-read-by">
            {/^Saved extraction \(/.test(paper.server)
              ? `Read by ${paper.model}, from a saved extraction (${paper.server.replace(/^Saved extraction \((.*)\)$/, "$1")}) that ${paper.extractedBy} added`
              : `Read by ${paper.model} on ${paper.server}, run by ${paper.extractedBy}`}
            , into the {paper.schema} schema
            {paper.license ? `. ${paper.license}` : ""}
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
      {library ? (
        <div className="ctx-source" data-dg="ctx-library">
          {library.exact && !pdf && !paper ? <blockquote data-dg="ctx-anchor">{library.exact}</blockquote> : null}
          {library.comment ? <p className="ctx-line" data-dg="ctx-anchor-comment">The note beside it: {library.comment}</p> : null}
          <button type="button" className="ctx-link" data-dg="ctx-library-open" onClick={() => void call("link.open", { url: library.open }).catch(report)}>
            <LibraryMark library={library} />{" "}
            {library.what === "passage" ? "Open the passage in Zotero" : "Show it in Zotero"}
          </button>
        </div>
      ) : null}
    </section>
    <section className="ctx-group" data-dg="ctx-where">
      <h2>Where it is</h2>
      <ul className="mentions" data-dg="ctx-lives">
        {lives.text ? null : <li>No note or page yet. Export it to make one.</li>}
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
    </>
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
              <strong>{note.credit.name}</strong> <time dateTime={note.at} className="ctx-note-when">{whenOf(note.at)}</time> {note.text}
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

/**
 * Sign-off: who has checked this unit, how, and whether it has changed since. The author marking their
 * own unit signs it; anyone else is a second pair of eyes. A mark holds only for the version it was made on.
 */
const Checks = ({ unit, mine, checks, call, report }: { unit: string; mine: boolean; checks: UnitCheck[]; call: Connection["call"]; report: (error: Error) => void }) => {
  const [open, setOpen] = useState<"checked" | "needsWork" | null>(null);
  const [way, setWay] = useState<CheckWay>("expertJudgment");
  const [note, setNote] = useState("");
  const own = checks.find((check) => check.mine);
  const send = (verdict: "checked" | "needsWork"): void => {
    void call("unit.check", { unit, verdict, way, ...(note.trim() ? { note } : {}) })
      .then(() => (setOpen(null), setNote("")))
      .catch(report);
  };
  return (
    <section className="ctx-group" data-dg="ctx-checks">
      <h2>Checked {checks.length ? <span>{checks.length}</span> : null}</h2>
      {checks.length === 0 ? <p className="ctx-line">No one has checked this yet.</p> : null}
      <ul className="ctx-checks">
        {checks.map((check) => (
          <li key={check.id} data-verdict={check.verdict} data-current={check.current} data-dg={`ctx-check-${check.verdict}`}>
            <span className="ctx-check-mark"><Icon name={check.verdict === "checked" ? "check" : "pen"} /></span>
            <span>
              <strong>{check.verdict === "needsWork" ? "Needs work" : check.own ? "Signed by its author" : "Checked"}</strong>, {check.credit.name}, <time dateTime={check.at}>{whenOf(check.at)}</time>
              <span className="ctx-check-how"> · {CHECK_WAYS.find((entry) => entry.method === check.way)?.label ?? check.way}</span>
              {check.note ? <span className="ctx-check-note">{check.note}</span> : null}
              {!check.current ? <span className="ctx-check-stale" data-dg="ctx-check-stale">This unit has changed since. The mark was made on an earlier version.</span> : null}
            </span>
            {check.mine ? <button type="button" className="icon-button" aria-label="Take back this mark" data-dg="ctx-uncheck" onClick={() => void call("unit.uncheck", { id: check.id }).catch(report)}><Icon name="close" /></button> : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="ctx-check-form" data-dg="ctx-check-form">
          {open === "checked" ? (
            <label className="ctx-line">
              How you checked it{" "}
              <select data-dg="ctx-check-way" value={way} onChange={(event) => setWay(event.target.value as CheckWay)}>
                {CHECK_WAYS.map((entry) => <option key={entry.method} value={entry.method}>{entry.label}</option>)}
              </select>
            </label>
          ) : null}
          <input data-dg="ctx-check-note" aria-label={open === "needsWork" ? "What needs work" : "A note, if you like"} placeholder={open === "needsWork" ? "What needs work" : "A note, if you like"} value={note} onChange={(event) => setNote(event.target.value)} />
          <span className="ctx-check-actions">
            <button type="button" className="ctx-link" onClick={() => setOpen(null)}>Cancel</button>
            <button type="button" className="ctx-link" data-dg="ctx-check-send" disabled={open === "needsWork" && !note.trim()} onClick={() => send(open)}>{open === "needsWork" ? "Send it back" : mine ? "Sign it" : "Mark as checked"}</button>
          </span>
        </div>
      ) : (
        <p className="ctx-line">
          <button type="button" className="ctx-link" data-dg="ctx-check" onClick={() => setOpen("checked")}>{own?.current && own.verdict === "checked" ? "Check it again" : mine ? "Sign this unit" : "Mark as checked"}</button>
          {mine ? null : <>{" · "}<button type="button" className="ctx-link" data-dg="ctx-needs-work" onClick={() => setOpen("needsWork")}>Needs work…</button></>}
        </p>
      )}
    </section>
  );
};

/** Taking back a unit you made. Asked for twice, since it leaves every canvas. */
const RemoveUnit = ({ unit, call, report }: { unit: string; call: Connection["call"]; report: (error: Error) => void }) => {
  const [asking, setAsking] = useState(false);
  return (
    <section className="ctx-group" data-dg="ctx-remove">
      {asking ? (
        <p className="ctx-line">
          Remove this unit? It leaves every canvas and its note goes to the trash.{" "}
          <button type="button" className="ctx-link" onClick={() => setAsking(false)}>Keep it</button>{" "}
          <button type="button" className="ctx-link" data-dg="ctx-remove-yes" onClick={() => void call("node.remove", { id: unit }).catch(report)}>Remove</button>
        </p>
      ) : (
        <button type="button" className="ctx-link" data-dg="ctx-remove-unit" onClick={() => setAsking(true)}>Remove this unit…</button>
      )}
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
  const [relateTo, setRelateTo] = useState<NodeSummary | undefined>(undefined);
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
      setNotice(messageOf(error));
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
        <p>Select a card, or open a unit in your notes.</p>
      </main>
    );
  }

  const { node, mentionedIn, attribution } = view;
  const text = ownText(view);
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
            aria-label="Keep this unit in view"
            title="Keep this unit in view"
            aria-pressed={pinned}
            onClick={() => setPinned((on_) => !on_)}
          >
            <Icon name="pin" />
          </button>
        </div>
        {node.card.retracted ? (
          <p className="ctx-flag" role="alert" data-dg="ctx-retracted">Retracted. A registry lists the work this was read from as retracted, so weigh it accordingly.</p>
        ) : null}
        <h1 className="ctx-title" data-dg="ctx-title">{plain(node.title)}</h1>
        <Facts
          facts={node.card}
          fields={CARD_FIELD_IDS}
          density="panel"
          maker={<><Mark credit={node.credit} dg="ctx-credit" /> {attribution.lab ? `${attribution.person}, ${attribution.lab}` : attribution.person}</>}
          uri={node.id}
          // The passage opens in this app's reader when the file is here, and in the reference library's own app when it is there.
          {...(view.provenance.pdf
            ? { onSource: () => void call("pdf.show", { ref: view.provenance.pdf!.ref, unit: node.id }).catch(report) }
            : view.provenance.library
              ? { onSource: () => void call("link.open", { url: view.provenance.library!.open }).catch(report) }
              : {})}
          onLibrary={(url) => void call("link.open", { url }).catch(report)}
          onIdentifier={(id) => {
            const url = identifierUrl(id);
            if (url) void call("link.open", { url }).catch(report);
          }}
        />
        {view.provenance.paper?.asRead ? (
          <p className="ctx-line ctx-asread" data-dg="ctx-as-read">
            Reworded by a person. The model read it as: <q>{plain(view.provenance.paper.asRead)}</q>
            <button type="button" className="ctx-link" data-dg="ctx-restore" onClick={() => void call("node.rename", { id: node.id, title: view.provenance.paper!.asRead! }).catch(report)}>Put the model's words back</button>
          </p>
        ) : null}
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

      {text ? (
        <section className="ctx-group">
          <h2>Text</h2>
          <p className="ctx-text" data-dg="ctx-text">{text}</p>
        </section>
      ) : null}

      {relating ? <Relate connection={connection} node={node.id} initial={relateTo} onDone={() => { setRelating(false); setRelateTo(undefined); }} /> : null}

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
                  {other.paper && other.paper.id !== node.paper?.id ? <><span className="from-paper" title={`Read from ${other.paper.title}`}>{other.paper.label}</span><LibraryMark library={other.paper.library} /></> : null}
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

      <Method connection={connection} node={node} onWalk={walk} />

      {["claim", "evidence", "question"].includes(node.base ?? "") ? (
        <Elsewhere
          key={node.id}
          connection={connection}
          node={node}
          onWalk={walk}
          onRelate={(other) => {
            setRelateTo(other);
            setRelating(true);
          }}
        />
      ) : null}

      {mentionedIn.length > 0 ? (
        <section className="ctx-group">
          <h2>Mentioned in <span>{mentionedIn.length}</span></h2>
          <ul className="mentions">
            {mentionedIn.map(({ title }) => <li key={title}>{plain(title)}</li>)}
          </ul>
        </section>
      ) : null}

      <Work view={view} call={call} report={report} />
      <Announcements key={`n${node.id}`} unit={node.id} call={call} />
      <Provenance view={view} call={call} report={report} />
      {view.social ? <Social view={view} call={call} report={report} /> : null}
      <Checks key={`c${node.id}`} unit={node.id} mine={Boolean(node.mine)} checks={view.checks ?? []} call={call} report={report} />
      {node.mine ? <RemoveUnit key={`r${node.id}`} unit={node.id} call={call} report={report} /> : null}

    </main>
  );
};
