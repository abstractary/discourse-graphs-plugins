import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryStatus } from "@dg/contract/scholarly.ts";
import { identifierLabel } from "@dg/contract/scholarly.ts";
import type { LibraryHit, LibraryItemView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";

/**
 * From Zotero: find a reference, see the highlights made on it, and bring in
 * the ones that matter. The reference becomes a Source. Each highlight chosen
 * becomes a unit that quotes its passage and knows its page. Zotero is only
 * read. Nothing is changed in it, and nothing arrives that wasn't picked.
 */

const authorsLine = (item: LibraryHit["item"]): string => {
  const names = item.authors.map(({ family, name }) => family ?? name);
  return names.length <= 3 ? names.join(", ") : `${names[0]} and ${names.length - 1} others`;
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, route } = connection;
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [text, setText] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [view, setView] = useState<LibraryItemView | null>(null);
  const [picked, setPicked] = useState<Map<string, string | undefined>>(new Map());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const asked = useRef(0);

  const check = useCallback(() => {
    setStatus(null);
    void call("zotero.status", {})
      .then(setStatus)
      .catch((error: Error) => setStatus({ ok: false, app: "zotero", problem: error.message }));
  }, [call]);
  useEffect(check, [check]);
  useEffect(() => {
    if (status?.ok) input.current?.focus();
  }, [status?.ok]);
  // Opened from a source or from the reader: it starts at that reference, with what has been highlighted since.
  const startedAt = useRef(false);
  useEffect(() => {
    if (!status?.ok || startedAt.current) return;
    startedAt.current = true;
    void call("zotero.pending", {}).then(({ item }) => (item ? openRef.current(item) : undefined)).catch(() => undefined);
  }, [status?.ok, call]);

  // Search as the person types, and only ever show the answer to what they typed last.
  useEffect(() => {
    const wanted = text.trim();
    if (!status?.ok || wanted.length < 2) {
      setHits(null);
      return;
    }
    const turn = (asked.current += 1);
    const timer = window.setTimeout(() => {
      void call("zotero.search", { text: wanted, limit: 20 })
        .then((found) => turn === asked.current && (setHits(found), setProblem("")))
        .catch((error: Error) => turn === asked.current && setProblem(error.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [call, status?.ok, text]);

  const openRef = useRef<(ref: string) => void>(() => {});
  const open = (ref: string): void => {
    setBusy(true);
    setProblem("");
    void call("zotero.item", { ref })
      .then((next) => {
        setView(next);
        // Start with every highlight that isn't here yet. The person takes away what they don't want.
        setPicked(new Map(next.annotations.filter((mark) => mark.usable && !mark.held).map((mark) => [mark.key, mark.suggested])));
      })
      .catch((error: Error) => setProblem(error.message))
      .finally(() => setBusy(false));
  };  openRef.current = open;


  const bring = (): void => {
    if (!view) return;
    setBusy(true);
    setProblem("");
    void call("zotero.import", { ref: view.item.ref, annotations: [...picked].map(([key, type]) => ({ key, ...(type ? { type } : {}) })), ...(route.id ? { canvas: route.id } : {}) })
      .then(async (made) => {
        if (made.canvas) await call("canvas.show", { id: made.canvas }).catch(() => null);
        else {
          await call("focus.set", { node: made.source.id }).catch(() => null);
          await call("panel.open", { surface: "context" }).catch(() => null);
        }
        await call("dialog.close", {});
      })
      .catch((error: Error) => {
        setProblem(error.message);
        setBusy(false);
      });
  };

  const close = (): void => void call("dialog.close", {});

  return (
    <main className="sheet zotero" data-dg="zotero">
      <div className="sheet-head">
        <h1>{view ? "Bring in from Zotero" : "From Zotero"}</h1>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}><Icon name="close" /></button>
      </div>

      {status === null ? <p className="zotero-quiet">Looking for Zotero</p> : null}
      {status && !status.ok ? (
        <div className="zotero-off" data-dg="zotero-off" role="alert">
          <p>{status.problem}</p>
          <p className="zotero-quiet">Discourse Graphs reads your library from the Zotero app on this computer. It never changes it, and it only reads when you ask here.</p>
          <button type="button" className="primary" data-dg="zotero-retry" onClick={check}>Try again</button>
        </div>
      ) : null}

      {status?.ok && !view ? (
        <>
          <input ref={input} data-dg="zotero-search" aria-label="Search your Zotero library" placeholder="Search your library by title, author or year" value={text} onChange={(event) => setText(event.target.value)} />
          {hits === null ? <p className="zotero-quiet">A reference becomes a Source. You then choose which of its highlights to bring with it.</p> : null}
          {hits?.length === 0 ? <p className="zotero-quiet" data-dg="zotero-none">Nothing in your library matches.</p> : null}
          <ul className="zotero-hits" data-dg="zotero-hits">
            {(hits ?? []).map(({ item, label, held }) => (
              <li key={item.ref}>
                <button type="button" data-dg={`zotero-hit-${item.key}`} disabled={busy} onClick={() => open(item.ref)}>
                  <strong>{item.title}</strong>
                  <span>{[authorsLine(item), item.published, item.venue].filter(Boolean).join(" · ")}</span>
                  <span className="zotero-tags">
                    <span className="from-paper">{label}</span>
                    {item.library.kind === "group" ? <span className="from-paper">{item.library.name ?? "Group library"}</span> : null}
                    {held ? <span className="from-paper" data-here="true">Here already</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {view ? (
        <>
          <button type="button" className="zotero-back" onClick={() => setView(null)}><Icon name="back" /> Search again</button>
          <div className="zotero-item" data-dg="zotero-item">
            <strong>{view.item.title}</strong>
            <span>{[authorsLine(view.item), view.item.published, view.item.venue].filter(Boolean).join(" · ")}</span>
            <span className="zotero-ids">
              {view.item.identifiers.filter(({ scheme }) => scheme !== "zotero" && scheme !== "url").map((id) => <span key={`${id.scheme}${id.value}`} className="fact-id"><abbr>{identifierLabel(id.scheme)}</abbr> {id.value}</span>)}
            </span>
            <span>
              {view.held ? "This source is in your graph already. Bringing it in again adds only what is new. " : "It will be added as a Source. "}
              <button type="button" className="ctx-link" onClick={() => void call("link.open", { url: view.item.open })}>Show it in Zotero</button>
            </span>
          </div>
          {view.annotations.length === 0 ? (
            <p className="zotero-quiet" data-dg="zotero-no-marks">No highlights on this item in Zotero yet. Highlight as you read there, then come back for them.</p>
          ) : (
            <>
              <div className="zotero-count">
                <span>{picked.size} of {view.annotations.filter((mark) => mark.usable && !mark.held).length} highlights chosen</span>
                <button type="button" className="ctx-link" onClick={() => setPicked(picked.size ? new Map() : new Map(view.annotations.filter((mark) => mark.usable && !mark.held).map((mark) => [mark.key, mark.suggested])))}>{picked.size ? "Choose none" : "Choose all"}</button>
              </div>
              <ul className="zotero-marks" data-dg="zotero-marks">
                {view.annotations.map((mark) => {
                  const on = picked.has(mark.key);
                  const fixed = !mark.usable || Boolean(mark.held);
                  return (
                    <li key={mark.key} data-on={on} data-fixed={fixed}>
                      <input
                        type="checkbox"
                        aria-label={`Bring in: ${(mark.text ?? mark.comment ?? "a picture").slice(0, 80)}`}
                        data-dg={`zotero-mark-${mark.key}`}
                        checked={on}
                        disabled={fixed}
                        onChange={() => setPicked((old) => {
                          const next = new Map(old);
                          if (next.has(mark.key)) next.delete(mark.key);
                          else next.set(mark.key, mark.suggested);
                          return next;
                        })}
                      />
                      <div className="zotero-mark">
                        {mark.text ? <blockquote style={mark.color ? { borderLeftColor: mark.color } : undefined}>{mark.text}</blockquote> : null}
                        {mark.comment ? <p>{mark.comment}</p> : null}
                        {!mark.usable ? <p className="zotero-quiet">A {mark.type === "image" ? "picture" : "drawing"}. These aren't brought in yet.</p> : null}
                        <span className="zotero-quiet">
                          {[mark.pageLabel ? `Page ${mark.pageLabel}` : mark.pageIndex !== undefined ? `Page ${mark.pageIndex + 1}` : null, mark.held ? "Here already" : null, ...mark.tags].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      {on ? (
                        <select
                          aria-label="What kind of unit it becomes"
                          data-dg={`zotero-type-${mark.key}`}
                          value={picked.get(mark.key) ?? ""}
                          onChange={(event) => setPicked((old) => new Map(old).set(mark.key, event.target.value || undefined))}
                        >
                          {view.types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                          <option value="">No type yet</option>
                        </select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      ) : null}

      {problem ? <p className="problem" role="alert" data-dg="zotero-problem">{problem}</p> : null}
      {view ? (
        <div className="row end">
          <button type="button" onClick={close}>Cancel</button>
          <button type="button" className="primary" data-dg="zotero-bring" disabled={busy} onClick={bring}>
            {busy ? "Bringing in" : picked.size ? `Bring in the source and ${picked.size} ${picked.size === 1 ? "highlight" : "highlights"}` : view.held ? "Nothing new to bring in" : "Bring in the source"}
          </button>
        </div>
      ) : null}
    </main>
  );
};
