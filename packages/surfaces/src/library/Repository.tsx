import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasDiff, HolonCanvas, HolonEvent, ReleaseSummary, RepositoryCanvas } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";
import { BaseChip, Composition, DiffView, Flag, Preview, counted, when } from "../holon/parts.tsx";

/**
 * The Library's Canvases tab, as the canvas repository: each canvas with its
 * holon, what it holds, its edits and releases, its forks and nesting. Opening
 * a canvas goes to the canvas tab; its versions open in place, so they fit the
 * 300 px sidebar.
 */
export const Repository = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [canvases, setCanvases] = useState<RepositoryCanvas[] | null>(null);
  const [query, setQuery] = useState("");
  const [privacy, setPrivacy] = useState<"all" | "private" | "lab" | "published">("all");
  const [withGaps, setWithGaps] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => void call("repository.canvases", {}).then(setCanvases).catch(report), [call, report]);
  useEffect(refresh, [refresh]);
  useEffect(() => on("graph-changed", () => {
    refresh();
    setVersion((v) => v + 1);
  }), [on, refresh]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (canvases ?? []).filter(
      (c) =>
        (!needle || c.title.toLowerCase().includes(needle) || c.holon?.title.toLowerCase().includes(needle) || c.people.some((p) => p.toLowerCase().includes(needle))) &&
        (privacy === "all" || c.privacy === privacy) &&
        (!withGaps || c.gaps > 0),
    );
  }, [canvases, query, privacy, withGaps]);
  const titleOf = (id: string) => canvases?.find((c) => c.id === id)?.title ?? "a canvas";

  const show = (id: string) => void call("canvas.show", { id }).catch(report);
  const create = async (): Promise<void> => {
    const title = name.trim();
    if (!title) return;
    setNaming(false);
    setName("");
    try {
      show((await call("canvas.create", { title })).id);
    } catch (error) {
      report(error);
    }
  };

  return (
    <>
      <div className="cvs-bar">
        <button type="button" data-dg="canvases-new" onClick={() => setNaming((on_) => !on_)}><Icon name="plus" /> New canvas</button>
      </div>
      {naming ? (
        <div className="cvs-new">
          <input autoFocus data-dg="canvases-name" aria-label="Canvas name" placeholder="Canvas name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setNaming(false); }} />
          <button type="button" data-dg="canvases-create" onClick={() => void create()}>Create</button>
        </div>
      ) : null}
      {(canvases?.length ?? 0) > 3 ? (
        <>
          <input className="cvs-search" data-dg="canvases-search" aria-label="Find a canvas" placeholder="Find by title, holon or person" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="repo-filters">
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)} aria-label="Privacy">
              <option value="all">Any privacy</option>
              <option value="private">Private</option>
              <option value="lab">Shared with the lab</option>
              <option value="published">Published</option>
            </select>
            <label><input type="checkbox" checked={withGaps} onChange={(e) => setWithGaps(e.target.checked)} /> Has gaps</label>
          </div>
        </>
      ) : null}
      {canvases !== null && canvases.length === 0 ? <p className="cvs-none">No canvases yet. A canvas lays out questions, claims and evidence, and how they connect.</p> : null}
      {canvases !== null && canvases.length > 0 && shown.length === 0 ? <p className="cvs-none">No canvas matches.</p> : null}
      <ul className="cvs-list repo-list">
        {shown.map((c) => (
          <li key={c.id} data-open={open === c.id}>
            <div className="repo-row">
              <button type="button" className="repo-main" data-dg={`canvases-open-${c.title}`} onClick={() => show(c.id)}>
                <span className="cvs-title">{c.title}</span>
                <span className="repo-holon">
                  {c.holon ? <><BaseChip base={c.holon.ref.level} /> <span>{plain(c.holon.title)}</span></> : <span className="cvs-meta">Not part of the holarchy</span>}
                </span>
                <Composition units={c.units} />
                <span className="cvs-meta" data-dg={`repo-meta-${c.title}`}>
                  {counted(c.cards, "card")} · {counted(c.edits, "edit")} · {c.releases.length ? `${counted(c.releases.length, "release")}, latest ${c.releases.at(-1)!.name}` : "no releases"}
                  {c.forkOf ? ` · fork of ${c.forkOf.title} ${c.forkOf.release}` : ""}
                  {c.forks ? ` · ${counted(c.forks, "fork")}` : ""}
                  {c.nested.length ? ` · holds ${counted(c.nested.length, "canvas")}` : ""}
                  {c.nestedIn.length ? ` · inside ${c.nestedIn.map(titleOf).join(", ")}` : ""}
                  {` · edited ${when(c.editedAt)}`}
                </span>
                <span className="repo-tags">
                  <span className="hv-privacy-dot" data-level={c.privacy} /> {c.privacy === "lab" ? "Lab" : c.privacy === "published" ? "Published" : "Private"}
                  {c.gaps ? <Flag name={`${c.gaps} with gaps`} /> : null}
                </span>
              </button>
              <button type="button" className="repo-toggle" aria-expanded={open === c.id} aria-label={`Versions of ${c.title}`} title="History, releases and forks" onClick={() => setOpen(open === c.id ? null : c.id)} data-dg={`versions-${c.title}`}>
                <Icon name="chevron" />
              </button>
            </div>
            {open === c.id ? <Versions connection={connection} canvas={c} version={version} report={report} onShow={show} /> : null}
          </li>
        ))}
      </ul>
    </>
  );
};

const Versions = ({
  connection,
  canvas,
  version,
  report,
  onShow,
}: {
  connection: Connection;
  canvas: RepositoryCanvas;
  version: number;
  report: (error: unknown) => void;
  onShow: (id: string) => void;
}) => {
  const { call } = connection;
  const [history, setHistory] = useState<{ events: HolonEvent[]; releases: ReleaseSummary[] } | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<HolonCanvas | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [diff, setDiff] = useState<CanvasDiff | null>(null);
  const [from, setFrom] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void call("canvas.history", { id: canvas.id }).then((h) => {
      setHistory(h);
      setAt(h.events.length - 1);
      setFrom(h.releases.at(-1)?.id ?? "");
    }).catch(report);
  }, [call, canvas.id, version, report]);
  useEffect(() => {
    if (!history || at === null || !history.events[at]) return;
    void call("canvas.at", { id: canvas.id, at: history.events[at]!.at }).then(setSnapshot).catch(report);
  }, [call, canvas.id, history, at, report]);
  if (!history) return <p className="cvs-meta repo-versions">Reading history…</p>;
  const release = async () => {
    if (!name.trim()) return;
    const made = await call("canvas.release", { id: canvas.id, name: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
    setName("");
    setNote("");
    setMessage(`Released ${made.name}, pinning ${counted(made.units, "unit")}.`);
  };
  const fork = async (r: ReleaseSummary) => onShow((await call("canvas.fork", { release: r.id })).id);
  const event = at !== null ? history.events[at] : undefined;
  return (
    <div className="repo-versions" data-dg="repo-versions">
      <h3>History</h3>
      {history.events.length > 1 ? (
        <>
          <input type="range" min={0} max={history.events.length - 1} value={at ?? 0} onChange={(e) => setAt(Number(e.target.value))} aria-label="Move through the canvas's history" />
          <p className="cvs-meta">{event ? `${when(event.at)}: ${event.what} (${event.by})` : ""} · {(at ?? 0) + 1} of {history.events.length}</p>
        </>
      ) : null}
      {snapshot ? <Preview canvas={snapshot} /> : null}

      <h3>Releases</h3>
      {history.releases.length ? (
        <ol className="hv-releases">
          {history.releases.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> <span className="cvs-meta">{when(r.at)}, {r.by}, {counted(r.units, "unit")} pinned{r.published ? ", published" : ""}</span>
              {r.note ? <p>{r.note}</p> : null}
              <button type="button" onClick={() => void fork(r).catch(report)} data-dg={`fork-${r.name}`}>Fork from {r.name}</button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cvs-meta">No releases yet.</p>
      )}
      <div className="hv-form">
        <input placeholder="Release name, such as v1" value={name} onChange={(e) => setName(e.target.value)} aria-label="Release name" data-dg="release-name" onKeyDown={(e) => { if (e.key === "Enter") void release().catch(report); }} />
        <input placeholder="What changed (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Release note" />
        <button type="button" disabled={!name.trim()} onClick={() => void release().catch(report)} data-dg="release-cut">Cut a release</button>
      </div>
      {message ? <p role="status" className="cvs-meta">{message}</p> : null}

      {history.releases.length ? (
        <>
          <h3>Compare with now</h3>
          <div className="hv-form">
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Compare from">
              {history.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button type="button" disabled={!from} onClick={() => void call("canvas.diff", { canvas: canvas.id, from: from || "now", to: "now" }).then(setDiff).catch(report)} data-dg="diff">Compare</button>
          </div>
          {diff ? <DiffView diff={diff} /> : null}
        </>
      ) : null}
    </div>
  );
};
