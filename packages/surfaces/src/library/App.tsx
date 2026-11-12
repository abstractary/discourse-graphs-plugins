import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasSummary, LabView, PaperSummary } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, Mark } from "../shared/ui.tsx";
import { LabJoin } from "../shared/LabJoin.tsx";
import { Repository } from "./Repository.tsx";

const DAY = 86_400_000;
const CHECK_MS = 4000;

const whenEdited = (at: string): string => {
  const days = Math.floor((Date.now() - Date.parse(at)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(at));
};

const counted = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

type Tab = "canvases" | "papers" | "folders" | "lab";

const Papers = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [papers, setPapers] = useState<PaperSummary[] | null>(null);
  const [inLab, setInLab] = useState(false);
  const refresh = useCallback(() => {
    void call("paper.list", {}).then(setPapers).catch(report);
    void call("lab.view", {}).then((lab) => setInLab(Boolean(lab.link?.token))).catch(report);
  }, [call, report]);
  useEffect(refresh, [refresh]);
  useEffect(() => on("graph-changed", refresh), [on, refresh]);

  return (
    <>
      <div className="cvs-bar">
        <button type="button" data-dg="library-upload" onClick={() => void call("dialog.open", { surface: "upload" }).catch(report)}><Icon name="plus" /> Upload a paper</button>
        <button type="button" data-dg="library-demo" onClick={() => void call("paper.loadDemo", {}).catch(report)}>Load demo papers</button>
      </div>
      {papers !== null && papers.length === 0 ? <p className="cvs-none">No papers yet. Upload one, and its claims and evidence get a canvas of their own.</p> : null}
      <ul className="cvs-list">
        {(papers ?? []).map((paper) => (
          <li key={paper.id}>
            <button type="button" data-dg={`paper-open-${paper.title}`} onClick={() => void call("canvas.show", { id: paper.canvas }).catch(report)}>
              <span className="cvs-title">{paper.title}</span>
              <span className="cvs-meta">{counted(paper.units, "unit")}, {paper.model}, read {whenEdited(paper.at)}{paper.labPaper ? ", in the lab" : ""}</span>
            </button>
            {inLab && !paper.labPaper ? <button type="button" data-dg={`paper-share-${paper.title}`} onClick={() => void call("paper.share", { id: paper.id, includeFile: false }).then(refresh).catch(report)}>Share</button> : null}
            <Mark credit={paper.credit} />
          </li>
        ))}
      </ul>
    </>
  );
};

const Folders = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [folders, setFolders] = useState<{ id: string; title: string; units: number }[] | null>(null);
  const [name, setName] = useState("");
  const refresh = useCallback(() => {
    void call("folder.list", {}).then(setFolders).catch(report);
  }, [call, report]);
  useEffect(refresh, [refresh]);
  useEffect(() => on("graph-changed", refresh), [on, refresh]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    await call("folder.create", { title: name.trim() }).catch(report);
    setName("");
    refresh();
  };

  return (
    <>
      <div className="cvs-new">
        <input data-dg="folder-name" aria-label="Folder name" placeholder="New folder" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} />
        <button type="button" data-dg="folder-create" onClick={() => void create()}>Create</button>
      </div>
      {folders !== null && folders.length === 0 ? <p className="cvs-none">Folders keep units together. Export units from a paper to fill one.</p> : null}
      <ul className="cvs-list">
        {(folders ?? []).map((folder) => (
          <li key={folder.id} data-dg={`folder-${folder.title}`}>
            <span className="cvs-static">
              <span className="cvs-title">{folder.title}</span>
              <span className="cvs-meta">{counted(folder.units, "unit")}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
};

const Lab = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [lab, setLab] = useState<LabView | null>(null);
  const [saved, setSaved] = useState("");
  const refresh = useCallback(() => {
    void call("lab.view", {}).then(setLab).catch(report);
  }, [call, report]);
  useEffect(refresh, [refresh]);
  useEffect(() => on("graph-changed", refresh), [on, refresh]);

  const link = lab?.link;
  useEffect(() => {
    if (!link) return undefined;
    const timer = window.setInterval(() => void call(link.pending ? "lab.check" : "lab.view", {}).then(setLab).catch(() => {}), CHECK_MS);
    return () => window.clearInterval(timer);
  }, [call, link]);

  if (!lab) return null;
  if (!link) return <LabJoin connection={connection} onChange={setLab} />;
  if (link.pending) return <p className="cvs-none" data-dg="lab-pending">Your request to join {link.name} is with its PI.</p>;

  const decide = (requestId: string, decision: "accept" | "decline", tokenKind?: "personal" | "team"): void =>
    void call("lab.decide", { requestId, decision, ...(tokenKind ? { tokenKind } : {}) }).then(setLab).catch(report);

  return (
    <div className="stack">
      <section>
        <h2>{link.name}</h2>
        <p className="note">Others join with this identifier:</p>
        <code className="lab-id" data-dg="lab-id">{link.id}</code>
      </section>

      {lab.requests.length > 0 ? (
        <section data-dg="lab-requests">
          <h3>Asking to join</h3>
          <ul className="cvs-list">
            {lab.requests.map((request) => (
              <li key={request.id}>
                <span className="cvs-static"><span className="cvs-title">{request.person.name}</span></span>
                <button type="button" data-dg={`accept-${request.person.name}`} onClick={() => decide(request.id, "accept", "personal")}>Accept</button>
                <button type="button" data-dg={`decline-${request.person.name}`} onClick={() => decide(request.id, "decline")}>Decline</button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3>Members</h3>
        <ul className="cvs-list" data-dg="lab-members">
          {lab.members.map((member) => (
            <li key={member.did}>
              <Mark credit={{ kind: "person", id: member.did, name: member.name }} />
              <span className="cvs-static"><span className="cvs-title">{member.name}</span>{member.role === "admin" ? <span className="cvs-meta">PI</span> : null}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Paper repository</h3>
        {lab.papers.length === 0 ? <p className="cvs-none">No papers shared yet.</p> : null}
        {saved ? <p className="note" role="status" data-dg="lab-file-saved">{saved}</p> : null}
        <ul className="cvs-list" data-dg="lab-papers">
          {lab.papers.map((paper) => (
            <li key={paper.id}>
              <button type="button" data-dg={`lab-paper-${paper.title}`} onClick={() => void call("canvas.show", { id: paper.canvas }).catch(report)}>
                <span className="cvs-title">{paper.title}</span>
                <span className="cvs-meta">Uploaded by {paper.uploadedBy.name}, extracted by {paper.extractedBy.name}{paper.hasFile ? ", file included" : ""}</span>
                {paper.breadcrumbs.length > 0 ? <span className="cvs-meta" data-dg="lab-breadcrumbs">Read by {paper.breadcrumbs.map(({ name }) => name).join(", ")}</span> : null}
              </button>
              {paper.hasFile ? <button type="button" data-dg={`lab-file-${paper.title}`} onClick={() => void call("paper.getFile", { id: paper.id }).then(({ where }) => setSaved(`Saved to ${where}`)).catch(report)}>Get the file</button> : null}
            </li>
          ))}
        </ul>
      </section>

      <label className="field">
        <span>When I close a lab paper</span>
        <select data-dg="breadcrumb-default" value={lab.breadcrumbs} onChange={(event) => void call("lab.setBreadcrumbs", { value: event.target.value as LabView["breadcrumbs"] }).then(setLab).catch(report)}>
          <option value="ask">Ask whether to leave a breadcrumb</option>
          <option value="always">Always leave one</option>
          <option value="never">Never leave one</option>
        </select>
      </label>
    </div>
  );
};

const TABS: { id: Tab; label: string }[] = [
  { id: "canvases", label: "Canvases" },
  { id: "papers", label: "Papers" },
  { id: "folders", label: "Folders" },
  { id: "lab", label: "Lab" },
];

/** Everything a person keeps, in one place, the same in each base. */
export const App = ({ connection }: { connection: Connection }) => {
  const [tab, setTab] = useState<Tab>("canvases");
  const [notice, setNotice] = useState("");
  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);
  const props = { connection, report };
  return (
    <main className="cvs">
      <nav className="segments" role="tablist" aria-label="Library">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-dg={`library-${id}`} onClick={() => { setTab(id); setNotice(""); }}>{label}</button>
        ))}
      </nav>
      {notice ? <p className="problem" role="alert">{notice}</p> : null}
      {tab === "canvases" ? <Repository {...props} /> : null}
      {tab === "papers" ? <Papers {...props} /> : null}
      {tab === "folders" ? <Folders {...props} /> : null}
      {tab === "lab" ? <Lab {...props} /> : null}
    </main>
  );
};
