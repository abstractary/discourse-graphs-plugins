import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasDiff, HolonCanvas, HolonEvent, ReleaseSummary, RepositoryCanvas } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, Mark } from "../shared/ui.tsx";
import { DiffView, Flag, Preview, counted, when } from "../shared/holon-parts.tsx";
import { Thumb } from "../shared/Thumb.tsx";

type Scope = "everyone" | "lab" | "mine";
const SCOPES: { value: Scope; label: string; hint: string }[] = [
  { value: "everyone", label: "All", hint: "Every canvas here, from any workspace" },
  { value: "lab", label: "Lab", hint: "Canvases in your lab's workspace, and your own" },
  { value: "mine", label: "Yours", hint: "Canvases you made" },
];

/**
 * The Library's Canvases tab, grouped by the workspace each canvas lives in.
 * A row is a picture of the canvas's real graph, its title, whether it is a
 * PDF canvas or one people laid out, the papers it draws on and who did most
 * on it. The scope
 * narrows the same list, from everyone's canvases to the lab's to your own.
 * A canvas's history, releases and forks open in place, so they fit a 300 px sidebar.
 */
export const Repository = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [canvases, setCanvases] = useState<RepositoryCanvas[] | null>(null);
  const [query, setQuery] = useState("");
  const [privacy, setPrivacy] = useState<"all" | "private" | "lab" | "published">("all");
  const [withGaps, setWithGaps] = useState(false);
  const [scope, setScope] = useState<Scope>("everyone");
  const [kind, setKind] = useState<"all" | "paper" | "canvas">("all");
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
        (!needle || c.title.toLowerCase().includes(needle) || c.paper?.toLowerCase().includes(needle) || c.people.some((p) => p.toLowerCase().includes(needle))) &&
        // Each scope holds the one inside it: yours are part of the lab's, and the lab's part of everyone's.
        (scope === "everyone" || c.mine || (scope === "lab" && Boolean(c.lab))) &&
        (kind === "all" || c.kind === kind) &&
        (privacy === "all" || c.privacy === privacy) &&
        (!withGaps || c.gaps > 0),
    );
  }, [canvases, query, privacy, withGaps, scope, kind]);
  const inScope = (value: Scope): number => (canvases ?? []).filter((c) => value === "everyone" || c.mine || (value === "lab" && Boolean(c.lab))).length;
  const titleOf = (id: string) => canvases?.find((c) => c.id === id)?.title ?? "a canvas";

  const show = (id: string) => void call("canvas.show", { id }).catch(report);
  /** One group per workspace: yours first, then your lab's, then anyone else's. */
  const groups = useMemo(() => {
    const rank = { own: 0, lab: 1, other: 2 } as const;
    const byWorkspace = new Map<string, { workspace: RepositoryCanvas["workspace"]; canvases: RepositoryCanvas[] }>();
    for (const c of shown) {
      const key = `${c.workspace.kind}:${c.workspace.id}`;
      const group = byWorkspace.get(key) ?? { workspace: c.workspace, canvases: [] };
      group.canvases.push(c);
      byWorkspace.set(key, group);
    }
    return [...byWorkspace.values()].sort((a, b) => rank[a.workspace.kind] - rank[b.workspace.kind] || a.workspace.name.localeCompare(b.workspace.name));
  }, [shown]);
  /** The canvas someone is about to move to the lab's workspace, with who would then see it. */
  const [moving, setMoving] = useState<{ id: string; lab?: { name: string; members: string[] } } | null>(null);
  const askMove = (id: string) => void call("canvas.audience", { id }).then(({ lab }) => setMoving({ id, ...(lab ? { lab } : {}) })).catch(report);
  const move = (id: string) => void call("canvas.share", { id }).then(() => setMoving(null)).catch(report);
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
      {(canvases?.length ?? 0) > 0 ? (
        <div className="repo-scope" role="group" aria-label="Whose canvases" data-dg="canvases-scope">
          {SCOPES.map((item) => (
            <button key={item.value} type="button" aria-pressed={scope === item.value} title={item.hint} data-dg={`scope-${item.value}`} onClick={() => setScope(item.value)}>
              {item.label} <span>{inScope(item.value)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {(canvases?.length ?? 0) > 3 ? (
        <>
          <input className="cvs-search" data-dg="canvases-search" aria-label="Find a canvas" placeholder="Find by title, paper or person" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="repo-filters">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind of canvas" data-dg="canvases-kind">
              <option value="all">Any kind</option>
              <option value="paper">PDF canvases</option>
              <option value="canvas">Canvases</option>
            </select>
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)} aria-label="Privacy">
              <option value="all">Seen by anyone</option>
              <option value="private">Only you</option>
              <option value="lab">Your lab</option>
              <option value="published">Published</option>
            </select>
            <label><input type="checkbox" checked={withGaps} onChange={(e) => setWithGaps(e.target.checked)} /> Has gaps</label>
          </div>
        </>
      ) : null}
      {canvases !== null && canvases.length === 0 ? <p className="cvs-none">No canvases yet. A canvas lays out questions, claims and evidence, and how they connect.</p> : null}
      {canvases !== null && canvases.length > 0 && shown.length === 0 ? <p className="cvs-none">No canvas matches.</p> : null}
      {groups.map(({ workspace, canvases: held }) => (
        <section key={`${workspace.kind}:${workspace.id}`} className="repo-workspace" data-dg={`workspace-${workspace.name}`}>
          <h3 className="repo-workspace-head">
            <span className="repo-workspace-name">{workspace.name}</span>
            <span className="cvs-meta">{workspace.kind === "own" ? "Only you" : workspace.kind === "lab" ? "Your lab's members" : "Not yours"} · {counted(held.length, "canvas")}</span>
          </h3>
      <ul className="cvs-list repo-list">
        {held.map((c) => (
          <li key={c.id} data-open={open === c.id}>
            <div className="repo-row">
              <button type="button" className="repo-main" data-dg={`canvases-open-${c.title}`} data-kind={c.kind} onClick={() => show(c.id)}>
                <Thumb thumb={c.thumb} />
                <span className="repo-text">
                <span className="cvs-title">{c.title}</span>
                <span className="repo-kind" data-kind={c.kind} data-dg={`repo-kind-${c.title}`} title={c.kind === "paper" ? `One reading of ${c.paper ?? "a PDF"}. It stays as it was read.` : "Laid out by people, drawing on any papers."}>
                  <Icon name={c.kind === "paper" ? "pdf" : "canvas"} /> {c.kind === "paper" ? "PDF canvas" : "Canvas"}
                  <span className="cvs-meta"> · {counted(c.cards, "card")}</span>
                </span>
                {c.kind === "canvas" && c.sources.length ? (
                  <span className="cvs-meta repo-sources" data-dg={`repo-sources-${c.title}`} title={c.sources.map((s) => `${s.title} (${counted(s.units, "card")})`).join("\n")}>
                    Draws on {c.sources.map((s) => s.label).join(", ")}{c.sourceCount > c.sources.length ? ` and ${c.sourceCount - c.sources.length} more` : ""}
                  </span>
                ) : null}
                <span className="cvs-meta" data-dg={`repo-meta-${c.title}`}>
                  {c.releases.length ? `${counted(c.releases.length, "release")}, latest ${c.releases.at(-1)!.name}` : "no releases"}
                  {c.forkOf ? ` · fork of ${c.forkOf.title} ${c.forkOf.release}` : ""}
                  {c.forks ? ` · ${counted(c.forks, "fork")}` : ""}
                  {c.nested.length ? ` · holds ${counted(c.nested.length, "canvas")}` : ""}
                  {c.nestedIn.length ? ` · inside ${c.nestedIn.map(titleOf).join(", ")}` : ""}
                  {` · edited ${when(c.editedAt)}`}
                </span>
                {c.privacy === "published" || c.gaps ? (
                  <span className="repo-tags">
                    {c.privacy === "published" ? <><span className="hv-privacy-dot" data-level="published" /> Published</> : null}
                    {c.gaps ? <Flag name={`${c.gaps} with gaps`} /> : null}
                  </span>
                ) : null}
                </span>
              </button>
              <span className="repo-faces" data-dg={`repo-faces-${c.title}`} role="group" aria-label="Who did most on it" title="Who did most on it, most first">
                {c.contributors.map((person) => <Mark key={person.id} credit={person} />)}
                {c.contributorCount > c.contributors.length ? <span className="repo-more">+{c.contributorCount - c.contributors.length}</span> : null}
              </span>
              <button type="button" className="repo-toggle" aria-expanded={open === c.id} aria-label={`More about ${c.title}`} title="Who sees it, history, releases and forks" onClick={() => setOpen(open === c.id ? null : c.id)} data-dg={`versions-${c.title}`}>
                <Icon name="chevron" />
              </button>
            </div>
            {open === c.id && c.workspace.kind === "own" ? (
              <div className="repo-invite" data-dg={`invite-${c.title}`}>
                {moving?.id === c.id ? (
                  moving.lab ? (
                    <>
                      <p>
                        Moving it to {moving.lab.name}'s workspace lets {moving.lab.members.length ? `its ${counted(moving.lab.members.length, "member")} (${moving.lab.members.slice(0, 6).join(", ")}${moving.lab.members.length > 6 ? "…" : ""})` : "everyone in the lab"} see this canvas, its cards and their units, and add to it.
                      </p>
                      <div className="repo-invite-actions">
                        <button type="button" className="primary" data-dg="invite-move" onClick={() => move(c.id)}>Move to {moving.lab.name}</button>
                        <button type="button" onClick={() => setMoving(null)}>Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>Only you can see this canvas. Working on it with others needs a workspace with members, and the one kind there is today is a lab.</p>
                      <div className="repo-invite-actions">
                        <button type="button" data-dg="invite-lab" onClick={() => { setMoving(null); void call("dialog.open", { surface: "welcome" }).catch(report); }}>Join or start a lab</button>
                        <button type="button" onClick={() => setMoving(null)}>Cancel</button>
                      </div>
                    </>
                  )
                ) : (
                  <button type="button" data-dg="invite-open" onClick={() => askMove(c.id)}><Icon name="link" /> Work on it with others…</button>
                )}
              </div>
            ) : null}
            {open === c.id ? <Versions connection={connection} canvas={c} version={version} report={report} onShow={show} /> : null}
          </li>
        ))}
      </ul>
        </section>
      ))}
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
