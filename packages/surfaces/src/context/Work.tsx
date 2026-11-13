import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { NodeView, NotifyDraft, WorkLookup } from "@dg/contract/surface.ts";
import type { NotificationSummary, WorkService } from "@dg/contract/scholarly.ts";
import type { Connection } from "../shared/rpc.ts";

const SERVICE_NAMES: Record<WorkService, string> = { crossref: "Crossref", datacite: "DataCite", openalex: "OpenAlex", pubmed: "PubMed", signposting: "Its own page" };

const list = (words: string[]): string => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

const day = (at: string): string => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * The published work behind a unit: what the open registries say about it,
 * asked only when a person asks. Its identifiers sit with the unit's other
 * facts at the head of the panel; here is how the work stands.
 */
/** What each open-access colour means, in the Unpaywall convention. */
const OA_MEANS: Record<string, string> = {
  gold: "Open access: gold. Free to read at the publisher, in an open-access journal",
  green: "Open access: green. A free copy is in a repository",
  hybrid: "Open access: hybrid. Free to read at the publisher, in a subscription journal",
  bronze: "Open access: bronze. Free to read at the publisher, with no open licence",
  diamond: "Open access: diamond. Free to read and to publish",
  closed: "Not open access. No free copy was found",
};

export const Work = ({ view, call, report }: { view: NodeView; call: Connection["call"]; report: (error: Error) => void }) => {
  const { work } = view.provenance;
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<WorkLookup | null>(null);
  const [adding, setAdding] = useState("");
  const mine = Boolean(view.node.mine);
  if (!work && !mine) return null;

  const look = (): void => {
    setBusy(true);
    void call("work.lookup", { unit: view.node.id })
      .then(setLast)
      .catch(report)
      .finally(() => setBusy(false));
  };
  const add = (): void => {
    const text = adding.trim();
    if (!text) return;
    void call("unit.identify", { node: view.node.id, add: [text] })
      .then(() => setAdding(""))
      .catch(report);
  };

  const standing = work?.standing;
  const failed = last?.work.services.filter(({ ok }) => !ok) ?? [];
  // Standing as marks a person reads at a glance. Each keeps its words in a tooltip and for screen readers,
  // and the open-access colour is never the only signal: the words "Open access" stay beside it.
  const oa = standing?.openAccess?.status?.toLowerCase();
  const marks: ReactNode[] = standing
    ? [
        oa ? (
          <span key="oa" className="ctx-mark" data-dg="ctx-open-access" data-oa={oa} title={OA_MEANS[oa] ?? `Open access: ${oa}`}>
            <span className="ctx-dot" aria-hidden="true" />
            {oa === "closed" ? "Not open access" : "Open access"}
            <span className="sr-only">, {oa}</span>
          </span>
        ) : null,
        standing.citedBy !== undefined ? (
          <span key="cited" className="ctx-mark" data-dg="ctx-cited" title={`Cited by ${standing.citedBy.toLocaleString()} ${standing.citedBy === 1 ? "work" : "works"}, as the registries count`}>
            <svg className="ctx-mark-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9.5c0-3 1.4-5 4-6v1.8C5.9 5.9 5.3 6.7 5.2 7.8H7V12H3V9.5Zm6 0c0-3 1.4-5 4-6v1.8c-1.1.6-1.7 1.4-1.8 2.5H13V12H9V9.5Z" fill="currentColor" /></svg>
            <span className="ctx-count">{standing.citedBy.toLocaleString()}</span>
            <span className="sr-only"> citations</span>
          </span>
        ) : null,
        standing.agency && standing.agency !== "other" ? <span key="agency" className="ctx-mark" title={`Its DOI is registered with ${SERVICE_NAMES[standing.agency]}`}>DOI at {SERVICE_NAMES[standing.agency]}</span> : null,
        standing.inbox ? <span key="inbox" className="ctx-mark" title="Its page has an inbox, so a unit can be announced to it">Takes announcements</span> : null,
      ].filter((item) => item !== null)
    : [];

  return (
    <section className="ctx-group" data-dg="ctx-work">
      <h2>{work ? "Published work" : "Identifiers"}</h2>
      {work ? (
        <>
          {work.venue || work.published ? <p className="ctx-line" data-dg="ctx-work-venue">{[work.venue, work.published].filter(Boolean).join(", ")}</p> : null}
          {(standing?.updates ?? []).filter(({ type }) => type !== "retraction").map((update) => (
            <p key={`${update.type}${update.doi ?? ""}`} className="ctx-line">
              {update.type === "correction" ? "Corrected" : update.type === "concern" ? "Has an expression of concern" : update.type === "version" ? "Has another version" : "Updated"}
              {update.date ? ` on ${update.date}` : ""}
              {update.doi ? ": " : ""}
              {update.doi ? (
                <button type="button" className="ctx-link" title={`Open https://doi.org/${update.doi}`} onClick={() => void call("link.open", { url: `https://doi.org/${update.doi}` }).catch(report)}>
                  {update.doi}
                </button>
              ) : null}
            </p>
          ))}
          {marks.length ? <p className="ctx-marks" data-dg="ctx-work-facts">{marks}</p> : null}
          <p className="ctx-line" data-dg="ctx-work-checked">
            {standing
              ? `Checked with ${list(standing.services.map((name) => (name === "signposting" ? "its own page" : SERVICE_NAMES[name])))} on ${day(standing.checkedAt)}. `
              : "Not checked with the registries yet. "}
            <button type="button" className="ctx-link" data-dg="ctx-lookup" disabled={busy} onClick={look}>
              {busy ? "Asking" : standing ? "Check again" : "Look it up"}
            </button>
          </p>
          {!standing && !busy ? <p className="ctx-line">Asks Crossref or DataCite, OpenAlex and PubMed. Only its identifiers and title are sent.</p> : null}
          {last && !last.saved && last.work.services.every(({ ok }) => !ok) ? <p className="ctx-notice" role="alert">No registry answered. Check the connection and try again.</p> : null}
          {last && !last.saved && last.work.services.some(({ ok }) => ok) && last.work.identifiers.length === 0 ? <p className="ctx-line" data-dg="ctx-lookup-none">No registry knows this work by its title. Add its DOI and look again.</p> : null}
          {last && last.target === "unit" && !last.saved && last.work.identifiers.length > 0 ? <p className="ctx-line">Found, but this unit is a teammate's, so nothing was kept.</p> : null}
          {failed.length > 0 && last?.work.services.some(({ ok }) => ok) ? (
            <ul className="mentions" data-dg="ctx-lookup-failed">
              {failed.map(({ name, problem }) => <li key={name}>{SERVICE_NAMES[name]}: {problem ?? "no answer"}</li>)}
            </ul>
          ) : null}
        </>
      ) : null}
      {work?.target === "paper" && standing?.inbox ? <Announce unit={view.node.id} call={call} report={report} /> : null}
      {mine ? (
        <form
          className="ctx-note-input ctx-identify"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input data-dg="ctx-identify" aria-label="Add an identifier" placeholder="Add a DOI, PMID link, arXiv id, RRID or link" value={adding} onChange={(event) => setAdding(event.target.value)} />
        </form>
      ) : null}
    </section>
  );
};

const lineOf = ({ types, actor, from }: NotificationSummary): string => {
  const who = actor ?? from;
  if (types.includes("coar-notify:EndorsementAction")) return types.includes("Offer") ? `${who} asks for an endorsement` : `${who} endorsed this`;
  if (types.includes("coar-notify:ReviewAction")) return types.includes("Offer") ? `${who} asks for a review` : `${who} reviewed this`;
  if (types.includes("coar-notify:RelationshipAction")) return `${who} linked something to this`;
  return `${who} sent a notification`;
};

/** What the lab's server has been told about this unit or its paper. Quiet when there is nothing. */
export const Announcements = ({ unit, call }: { unit: string; call: Connection["call"] }) => {
  const [held, setHeld] = useState<NotificationSummary[]>([]);
  useEffect(() => {
    let live = true;
    void call("notify.about", { unit })
      .then((found) => live && setHeld(found))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [call, unit]);
  if (held.length === 0) return null;
  return (
    <section className="ctx-group" data-dg="ctx-announcements">
      <h2>Announcements <span>{held.length}</span></h2>
      <ul className="mentions">
        {held.map((item) => <li key={item.id} title={item.about.join(", ")}>{lineOf(item)}, {day(item.receivedAt)}</li>)}
      </ul>
    </section>
  );
};

/** Tells the paper's repository that this unit exists. The person reads what will be sent before it goes. */
const Announce = ({ unit, call, report }: { unit: string; call: Connection["call"]; report: (error: Error) => void }) => {
  const [draft, setDraft] = useState<NotifyDraft | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDraft(null);
    setSent(null);
  }, [unit]);
  if (sent) return <p className="ctx-line" data-dg="ctx-announced">Announced to {sent}.</p>;
  if (!draft) {
    return (
      <p className="ctx-line">
        <button type="button" className="ctx-link" data-dg="ctx-announce" onClick={() => void call("notify.draft", { unit }).then(setDraft).catch(report)}>
          Announce this unit to the paper's repository
        </button>
      </p>
    );
  }
  if (!draft.ready) return <p className="ctx-line" data-dg="ctx-announce-why">{draft.why}</p>;
  return (
    <div className="ctx-source" data-dg="ctx-announce-draft">
      <p className="ctx-line">This will be sent to {draft.inbox}, which the page for "{draft.paper}" names as its inbox. It carries your name and this unit's address, and it can't be taken back.</p>
      <pre className="ctx-json">{JSON.stringify(draft.notification, null, 2)}</pre>
      <div className="decide">
        <span />
        <button type="button" className="quiet" onClick={() => setDraft(null)}>Cancel</button>
        <button
          type="button"
          data-dg="ctx-announce-send"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void call("notify.send", { unit, id: draft.notification.id })
              .then(({ inbox }) => setSent(inbox))
              .catch(report)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Sending" : "Send"}
        </button>
      </div>
    </div>
  );
};
