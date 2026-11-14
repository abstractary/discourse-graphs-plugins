import { useCallback, useEffect, useState } from "react";
import type { Profile, ProfileAudience, ProfileEvent, ProfileStats } from "@dg/contract/surface.ts";
import { dayOf, initialsOf, Mark } from "../shared/people.tsx";
import type { Connection } from "../shared/rpc.ts";
import { plain } from "../shared/ui.tsx";
import { count } from "../shared/words.ts";

/**
 * A person's profile: who they are, what they have made, and a history of
 * their work. Three audiences see three things, and the page always says
 * which one is on screen, so nobody wonders who else can read it.
 */

type Tab = ProfileAudience | "public";

const timeOf = (at: string): string => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const Stats = ({ stats }: { stats: ProfileStats }) => {
  const most = Math.max(1, ...stats.weeks);
  const widest = Math.max(1, ...stats.byType.map(({ count: n }) => n));
  return (
    <section className="profile-stats" data-dg="profile-stats">
      <dl className="profile-counts">
        <div><dt>Units written</dt><dd data-dg="profile-written">{stats.written.toLocaleString()}</dd></div>
        <div><dt>Read from papers</dt><dd data-dg="profile-read">{stats.read.toLocaleString()}</dd></div>
        <div><dt>Relations</dt><dd>{stats.relations.toLocaleString()}</dd></div>
        <div><dt>Papers</dt><dd>{stats.papers.toLocaleString()}</dd></div>
        <div><dt>Canvases</dt><dd>{stats.canvases.toLocaleString()}</dd></div>
        <div><dt>Days active</dt><dd>{stats.activeDays.toLocaleString()}</dd></div>
      </dl>
      {stats.units + stats.relations > 0 ? (
        <>
          <div className="profile-weeks" role="img" aria-label={`Work in each of the last 26 weeks. The busiest week had ${most} ${most === 1 ? "piece" : "pieces"}.`}>
            {stats.weeks.map((n, index) => <span key={index} style={{ height: `${Math.max(n ? 12 : 3, Math.round((n / most) * 100))}%` }} data-none={n === 0} title={`${count(n, "piece", "pieces")} of work, ${26 - index === 1 ? "this week" : `${25 - index} ${25 - index === 1 ? "week" : "weeks"} ago`}`} />)}
          </div>
          <p className="profile-caption">The last 26 weeks</p>
          <ul className="profile-types">
            {stats.byType.map(({ label, base, count: n }) => (
              <li key={label} data-base={base ?? "none"}>
                <span>{label}</span>
                <span className="profile-bar"><i style={{ width: `${Math.round((n / widest) * 100)}%` }} /></span>
                <span>{n.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
};

const Unit = ({ unit, onOpen }: { unit: NonNullable<ProfileEvent["unit"]>; onOpen: (id: string) => void }) => (
  <button type="button" className="profile-unit" onClick={() => onOpen(unit.id)}>
    <span className="chip" data-base={unit.base ?? "none"} style={unit.color ? ({ "--type": unit.color } as React.CSSProperties) : undefined}>{unit.abbreviation ?? "Unit"}</span>
    <span>{plain(unit.title)}</span>
  </button>
);

const History = ({ events, more, onUnit, onCanvas }: { events: ProfileEvent[]; more: number; onUnit: (id: string) => void; onCanvas: (id: string) => void }) => {
  if (events.length === 0) return <p className="profile-none" data-dg="profile-empty">Nothing here yet.</p>;
  const days = new Map<string, ProfileEvent[]>();
  for (const event of events) {
    const day = new Date(event.at).toDateString();
    days.set(day, [...(days.get(day) ?? []), event]);
  }
  return (
    <section className="profile-history" data-dg="profile-history">
      {[...days.entries()].map(([day, list]) => (
        <div key={day} className="profile-day">
          <h3>{dayOf(list[0]!.at)} <span>{list.length}</span></h3>
          <ol>
            {list.map((event) => (
              <li key={event.id} data-action={event.action}>
                <time dateTime={event.at}>{timeOf(event.at)}</time>
                <div>
                  <span className="profile-did">{event.text}</span>
                  {event.unit ? <Unit unit={event.unit} onOpen={onUnit} /> : null}
                  {event.other ? <Unit unit={event.other} onOpen={onUnit} /> : null}
                  {event.canvas ? <button type="button" className="profile-canvas" onClick={() => onCanvas(event.canvas!.id)}>{event.canvas.title}</button> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {more > 0 ? <p className="profile-none">And {count(more, "earlier thing", "earlier things")}.</p> : null}
    </section>
  );
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, on, route } = connection;
  const [id, setId] = useState<string | undefined>(route.id);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(() => {
    void call("profile.view", id ? { id } : {})
      .then((next) => {
        setProfile(next);
        // Open on the widest view this viewer has that still shows a history.
        setTab((old) => (old && next.audiences.includes(old) ? old : next.audiences.includes("private") ? "private" : next.audiences[0]!));
      })
      .catch((error: Error) => setProblem(error.message));
  }, [call, id]);
  useEffect(load, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  if (problem) return <main className="profile"><p className="profile-none" role="alert">{problem}</p></main>;
  if (!profile || !tab) return <main className="profile" aria-busy="true" />;
  const { person } = profile;
  const lab = person.lab ?? "the lab";
  const TABS: Record<Tab, { label: string; who: string }> = {
    private: { label: "Only you", who: "Only you can see this: your work that isn't on a shared canvas." },
    lab: person.me
      ? { label: person.lab ?? "Your lab", who: person.lab ? `Everyone in ${lab} can see this: what you did on what the lab shares.` : "You aren't in a lab yet, so nothing is shared. Once you join one, what you do on its shared canvases shows here, and your labmates can see it." }
      : { label: person.lab ?? "Lab", who: `What ${person.name} did on what ${lab} shares with you.` },
    public: {
      label: "Everyone",
      who: person.me
        ? "What anyone could be shown about your work: counts alone, with no titles and no text. Nothing is published yet, so today this stays on your device."
        : `Counts alone, from what this device holds of ${person.name}'s work.`,
    },
  };
  const part = tab === "public" ? null : profile[tab];
  const stats = tab === "public" ? profile.public : part!.stats;
  const openUnit = (unit: string): void => {
    void call("focus.set", { node: unit });
    void call("panel.open", { surface: "context" }).catch(() => undefined);
  };

  return (
    <main className="profile" data-dg="profile">
      <header className="profile-head">
        <span className="profile-face" aria-hidden="true">{initialsOf(person.name)}</span>
        <div className="profile-who">
          <h1 data-dg="profile-name">{person.name}{person.me ? <span> (you)</span> : null}</h1>
          <p>
            {[person.lab, profile.public.since ? `Here since ${dayOf(profile.public.since)}` : null, profile.public.lastActive ? `last active ${dayOf(profile.public.lastActive)}` : null].filter(Boolean).join(" · ") || "Nothing of theirs is here yet"}
          </p>
          {person.orcid ? (
            <button type="button" className="profile-orcid" onClick={() => void call("link.open", { url: `https://orcid.org/${person.orcid}` })} title={`Open https://orcid.org/${person.orcid}`}>
              ORCID {person.orcid}
            </button>
          ) : null}
        </div>
        {profile.people.length > 1 ? (
          <nav className="profile-people" aria-label="People in your lab">
            {profile.people.filter((other) => other.id !== person.id).map((other) => <Mark key={other.id} credit={{ kind: "person", id: other.id, name: other.name }} />)}
          </nav>
        ) : null}
      </header>

      <div className="profile-tabs" role="tablist" aria-label="Who can see this">
        {profile.audiences.map((audience) => (
          <button key={audience} type="button" role="tab" aria-selected={tab === audience} data-dg={`profile-tab-${audience}`} onClick={() => setTab(audience)}>
            {TABS[audience].label}
          </button>
        ))}
      </div>
      <p className="profile-audience" data-dg="profile-audience">{TABS[tab].who}</p>

      <Stats stats={stats} />
      {part ? <History events={part.history} more={part.more} onUnit={openUnit} onCanvas={(canvas) => void call("canvas.show", { id: canvas })} /> : null}
      {/* A profile reached from someone's initials can be left for another person's without a new tab. */}
      {id && !person.me ? <button type="button" className="profile-mine" onClick={() => setId(undefined)}>Your own profile</button> : null}
    </main>
  );
};
