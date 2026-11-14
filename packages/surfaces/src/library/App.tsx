import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasSummary, DeviceView, LabView, PaperSummary } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, LibraryMark, Mark, Problem } from "../shared/ui.tsx";
import { LabJoin } from "../shared/LabJoin.tsx";
import { Repository } from "./Repository.tsx";
import { counted, messageOf } from "../shared/words.ts";

const DAY = 86_400_000;
const CHECK_MS = 4000;

const whenEdited = (at: string): string => {
  const days = Math.floor((Date.now() - Date.parse(at)) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(at));
};


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
        {papers && papers.length > 1 ? <button type="button" data-dg="library-paper-map" title="Papers placed by how tied they are" onClick={() => void call("papers.show", {}).catch(report)}>Paper map</button> : null}
      </div>
      {papers !== null && papers.length === 0 ? <p className="cvs-none">No papers yet. Upload one, and its claims and evidence get a canvas of their own.</p> : null}
      <ul className="cvs-list">
        {(papers ?? []).map((paper) => (
          <li key={paper.id}>
            <button type="button" data-dg={`paper-open-${paper.title}`} onClick={() => void call("canvas.show", { id: paper.canvas }).catch(report)}>
              <span className="cvs-title">{paper.title}<LibraryMark library={paper.library} /></span>
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

/** This person's own devices. A new one waits here until a trusted one lets it in. */
const Devices = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const refresh = useCallback(() => void call("device.list", {}).then(setDevices).catch(() => setDevices([])), [call]);
  useEffect(refresh, [refresh]);
  useEffect(() => on("graph-changed", refresh), [on, refresh]);
  const others = devices.filter((device) => device.id !== "first" || devices.length > 1);
  if (others.length <= 1) return null;
  const here = devices.find((device) => device.here);
  return (
    <section data-dg="lab-devices">
      <h3>Your devices</h3>
      <p className="note">Each device signs your work with a key of its own. A new one is let in from a device you already use, so nobody else can sign as you.</p>
      <ul className="cvs-list">
        {devices.filter((device) => device.state !== "removed").map((device) => (
          <li key={device.id}>
            <span className="cvs-static">
              <span className="cvs-title">{device.name}{device.here ? " (this one)" : ""}</span>
              <span className="cvs-meta" data-dg={`device-state-${device.fingerprint}`}>{device.state === "trusted" ? "Signs as you" : "Waiting to be let in"} · key ends {device.fingerprint}</span>
            </span>
            {device.state === "waiting" && !device.here && here?.state === "trusted" ? <button type="button" data-dg={`device-approve-${device.fingerprint}`} onClick={() => void call("device.approve", { id: device.id }).then(setDevices).catch(report)}>Let it in</button> : null}
            {device.id !== "first" && !device.here && here?.state === "trusted" ? <button type="button" data-dg={`device-remove-${device.fingerprint}`} onClick={() => void call("device.remove", { id: device.id }).then(setDevices).catch(report)}>Remove</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

type Reach = NonNullable<LabView["settings"]["reach"]>;
type LabChanges = { [K in keyof LabView["settings"]]?: LabView["settings"][K] | null };
const REACH: { value: Reach; label: string }[] = [
  { value: "device", label: "Each member's own computer only" },
  { value: "lab", label: "The lab's servers, and each member's own computer" },
  { value: "anywhere", label: "Anywhere a member chooses" },
];

/** What the PI sets once and every member inherits. Members read it. */
const LabSettings = ({ connection, lab, onChange, report }: { connection: Connection; lab: LabView; onChange: (view: LabView) => void; report: (error: unknown) => void }) => {
  const { call } = connection;
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const { settings, custodian } = lab;
  useEffect(() => {
    if (custodian) void call("zotero.groups", {}).then(setGroups).catch(() => setGroups([]));
  }, [call, custodian]);
  const set = (changes: LabChanges): void => void call("lab.configure", changes).then(onChange).catch(report);
  const servers = settings.servers ?? [];
  const reach = settings.reach ?? "lab";
  const shelf = settings.zoteroGroup;
  // The lab's group stays in the list when this computer's Zotero is closed or isn't in it.
  const choices = shelf && !groups.some((group) => group.id === shelf.id) ? [shelf, ...groups] : groups;

  if (!custodian) {
    return (
      <section data-dg="lab-settings">
        <h3>Set by the lab</h3>
        <ul className="cvs-list">
          <li><span className="cvs-static"><span className="cvs-title">Papers</span><span className="cvs-meta" data-dg="lab-shelf">{shelf ? `The Zotero group ${shelf.name}` : "Papers shared with the lab, below"}</span></span></li>
          <li><span className="cvs-static"><span className="cvs-title">Where papers may be read by a model</span><span className="cvs-meta" data-dg="lab-reach">{REACH.find((item) => item.value === reach)!.label}</span></span></li>
          {servers.map((server) => (
            <li key={server.url}><span className="cvs-static"><span className="cvs-title">{server.name}</span><span className="cvs-meta">{server.url}{settings.compute === server.url ? " · the lab's first choice" : ""}</span></span></li>
          ))}
        </ul>
        <p className="note">You also use the lab's grammar. Types you add yourself sit beside it.</p>
      </section>
    );
  }
  return (
    <section data-dg="lab-settings">
      <h3>What the lab sets for everyone</h3>
      <p className="note">Members get these, and the lab's grammar, when they join and whenever you change them.</p>
      <label className="field">
        <span>The lab's shelf of papers</span>
        <select data-dg="lab-shelf" value={shelf?.id ?? ""} onChange={(event) => set({ zoteroGroup: choices.find((group) => group.id === event.target.value) ?? null })}>
          <option value="">Papers shared with the lab here, with no Zotero</option>
          {choices.map((group) => <option key={group.id} value={group.id}>Zotero group: {group.name}</option>)}
        </select>
      </label>
      {groups.length === 0 && !shelf ? <p className="note">To use a Zotero group, open Zotero on this computer and join or make the group there.</p> : null}
      <label className="field">
        <span>Where papers may be read by a model</span>
        <select data-dg="lab-reach" value={reach} onChange={(event) => set({ reach: event.target.value as Reach })}>
          {REACH.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <h3>Model servers the lab offers</h3>
      <ul className="cvs-list" data-dg="lab-servers">
        {servers.map((server) => (
          <li key={server.url}>
            <span className="cvs-static"><span className="cvs-title">{server.name}</span><span className="cvs-meta">{server.url}{settings.compute === server.url ? " · first choice" : ""}</span></span>
            {settings.compute === server.url ? null : <button type="button" onClick={() => set({ compute: server.url })}>Make first choice</button>}
            <button type="button" data-dg={`lab-server-remove-${server.name}`} onClick={() => set({ servers: servers.filter((item) => item.url !== server.url), ...(settings.compute === server.url ? { compute: null } : {}) })}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="field-row">
        <input aria-label="Server name" placeholder="Name, like Mira's workstation" value={name} data-dg="lab-server-name" onChange={(event) => setName(event.target.value)} />
        <input aria-label="Server address" placeholder="http://10.0.0.5:8787" value={url} data-dg="lab-server-url" onChange={(event) => setUrl(event.target.value)} />
        <button type="button" data-dg="lab-server-add" disabled={!name.trim() || !/^https?:\/\/\S+$/.test(url.trim())} onClick={() => { set({ servers: [...servers.filter((item) => item.url !== url.trim()), { name: name.trim(), url: url.trim().replace(/\/+$/, "") }] }); setName(""); setUrl(""); }}>Add</button>
      </div>
    </section>
  );
};

const Lab = ({ connection, report }: { connection: Connection; report: (error: unknown) => void }) => {
  const { call, on } = connection;
  const [lab, setLab] = useState<LabView | null>(null);
  const [saved, setSaved] = useState("");
  const [invite, setInvite] = useState("");
  const [removing, setRemoving] = useState("");
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
  if (!link) {
    return (
      <div className="stack">
        {lab.removedFrom ? <p className="note" role="status" data-dg="lab-removed">You were removed from {lab.removedFrom}. Your own work is still here. What the others shared has been put away, and comes back if you rejoin. Ask its PI for a new invitation if that was a mistake. <button type="button" data-dg="lab-removed-ok" onClick={() => void call("lab.acknowledge", {}).then(setLab).catch(report)}>OK</button></p> : null}
        <LabJoin connection={connection} onChange={setLab} />
      </div>
    );
  }
  if (link.pending) return <p className="cvs-none" data-dg="lab-pending">Your request to join {link.name} is with its PI.</p>;

  const decide = (requestId: string, decision: "accept" | "decline", tokenKind?: "personal" | "team"): void =>
    void call("lab.decide", { requestId, decision, ...(tokenKind ? { tokenKind } : {}) }).then(setLab).catch(report);

  return (
    <div className="stack">
      <section>
        <h2>{link.name}</h2>
        {lab.custodian ? (
          <>
            <p className="note">Invite someone with one line they paste into Join a lab. It works once, for a week.</p>
            <button type="button" data-dg="lab-invite" onClick={() => void call("lab.invite", {}).then((made) => { setInvite(made.invite); refresh(); }).catch(report)}>Make an invitation</button>
            {invite ? <code className="lab-id" data-dg="lab-invite-line">{invite}</code> : null}
            {invite ? <p className="note">Send this line to one person. It is shown only now.</p> : null}
            {lab.invites.length > 0 ? (
              <ul className="cvs-list" data-dg="lab-invites">
                {lab.invites.map((open) => (
                  <li key={open.id}>
                    <span className="cvs-static"><span className="cvs-title">An open invitation</span><span className="cvs-meta">Until {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(Date.parse(open.expiresAt))}</span></span>
                    <button type="button" data-dg="lab-invite-revoke" onClick={() => void call("lab.revokeInvite", { id: open.id }).then(setLab).catch(report)}>Take back</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        <p className="note">{lab.custodian ? "Or people can ask to join with this identifier:" : "The lab's identifier:"}</p>
        <code className="lab-id" data-dg="lab-id">{link.id}</code>
        {!lab.deviceTrusted ? <p className="note" role="status" data-dg="lab-device-waiting">This device isn't signing as you yet, so nothing from it is shared. Open the app on a device you already use and let this one in, under Your devices.</p> : null}
        {lab.refusedFrom.map((entry) => (
          <p className="note" role="status" data-dg="lab-refused" key={entry.name}>{entry.count} {entry.count === 1 ? "record" : "records"} from {entry.name} arrived without a signature that holds, and {entry.count === 1 ? "was" : "were"} not taken in. Their app may need updating, or one of their devices was removed.</p>
        ))}
        {lab.clockOffMs ? <p className="note" role="status" data-dg="lab-clock">This computer's clock is about {Math.abs(lab.clockOffMs) < 3_600_000 ? `${Math.round(Math.abs(lab.clockOffMs) / 60_000)} minutes` : `${Math.round(Math.abs(lab.clockOffMs) / 3_600_000)} hours`} {lab.clockOffMs > 0 ? "slow" : "fast"}. What you write is stamped with the lab's time.</p> : null}
      </section>

      <Devices connection={connection} report={report} />

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
              {lab.custodian && member.role !== "admin" ? (
                removing === member.did
                  ? <button type="button" data-dg={`remove-confirm-${member.name}`} onClick={() => { setRemoving(""); void call("lab.remove", { did: member.did }).then(setLab).catch(report); }}>Remove {member.name}? They keep their own work.</button>
                  : <button type="button" data-dg={`remove-${member.name}`} onClick={() => setRemoving(member.did)}>Remove</button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <LabSettings connection={connection} lab={lab} onChange={setLab} report={report} />

      <section>
        <h3>The lab's shelf</h3>
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
    setNotice(messageOf(error));
  }, []);
  const props = { connection, report };
  return (
    <main className="cvs">
      <nav className="segments" role="tablist" aria-label="Library">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-dg={`library-${id}`} onClick={() => { setTab(id); setNotice(""); }}>{label}</button>
        ))}
      </nav>
      <Problem text={notice} />
      {tab === "canvases" ? <Repository {...props} /> : null}
      {tab === "papers" ? <Papers {...props} /> : null}
      {tab === "folders" ? <Folders {...props} /> : null}
      {tab === "lab" ? <Lab {...props} /> : null}
    </main>
  );
};
