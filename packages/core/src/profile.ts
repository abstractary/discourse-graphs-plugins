import { ownColor } from "./process.ts";
import type { CanvasRecord, DgId, DgRecord, FoldedGraph, NodeRecord, RelationTypeRecord } from "@dg/contract/records.ts";
import type { Profile, ProfileAudience, ProfileCard, ProfileEvent, ProfileStats } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

/**
 * A person's work, told three ways. The person sees all of it. Their lab sees
 * what they did on what the lab shares. Everyone else gets counts: how much,
 * of what kind, since when, and never a title or a word of text.
 *
 * It is all read from the record log, so nothing is tracked to make it.
 */

const DAY = 86_400_000;
const HISTORY = 150;

export type ProfileInput = {
  /** Every version of every record this device holds. */
  records: DgRecord[];
  graph: FoldedGraph;
  person: string;
  /** Ids of the records the lab can see: what is on its shared canvases, and what arrived from it. */
  shared: Set<string>;
  localSpace: string;
  now?: number;
};

const typeOf = (graph: FoldedGraph, node: NodeRecord | undefined) => {
  const type = node?.type ? graph.documents.get(node.type) : undefined;
  return type?.kind === "node-type" ? type : undefined;
};

const unitOf = (graph: FoldedGraph, id: DgId): ProfileEvent["unit"] | undefined => {
  const node = graph.documents.get(id);
  if (node?.kind !== "node") return undefined;
  const type = typeOf(graph, node);
  return { id, title: node.title, ...(type?.abbreviation ? { abbreviation: type.abbreviation } : {}), ...(type?.base ? { base: type.base } : {}), ...(ownColor(type) ? { color: ownColor(type)! } : {}) };
};

/** What one person did, newest first, each marked with who can see it. */
export const historyOf = ({ records, graph, person, shared, localSpace }: ProfileInput): ProfileEvent[] => {
  const events: ProfileEvent[] = [];
  const audienceOf = (record: DgRecord): ProfileAudience => (shared.has(record.id) || record.space !== localSpace ? "lab" : "private");
  const push = (record: DgRecord, at: string, action: ProfileEvent["action"], text: string, extra: Partial<ProfileEvent> = {}): void => {
    events.push({ id: `${record.id}:${"rev" in record ? record.rev : 0}:${action}`, at, action, text, audience: audienceOf(record), ...extra });
  };
  // Earlier versions, to say what an edit changed.
  const versions = new Map<string, DgRecord[]>();
  for (const record of records) versions.set(record.id, [...(versions.get(record.id) ?? []), record]);
  const before = (record: DgRecord & { rev: number }): DgRecord | undefined =>
    (versions.get(record.id) ?? []).filter((other) => "rev" in other && other.rev < record.rev).sort((a, b) => ("rev" in b ? b.rev : 0) - ("rev" in a ? a.rev : 0))[0];
  const paperUnits = new Map<string, number>();
  for (const record of graph.documents.values()) if (record.kind === "node" && record.source && !record.removed) paperUnits.set(record.source.paper, (paperUnits.get(record.source.paper) ?? 0) + 1);
  const seen = new Set<string>();

  for (const record of records) {
    const key = `${record.id}:${"rev" in record ? record.rev : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = !("rev" in record) || record.rev === 1;
    const edit = !first && "editedBy" in record ? { by: record.editedBy.id, at: record.editedAt } : null;
    if ((edit?.by ?? record.by.id) !== person) continue;
    const at = edit?.at ?? record.at;

    if (record.kind === "node") {
      const unit = unitOf(graph, record.id);
      const label = typeOf(graph, record)?.label.toLowerCase() ?? "unit";
      if (first) {
        // A paper's units arrive together, and are told as one reading of the paper.
        if (record.source) continue;
        push(record, at, "made", record.facts?.provenance?.method === "imported" ? `Imported a ${label}` : record.facts?.anchor?.exact ? `Highlighted ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}` : `Wrote ${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`, unit ? { unit } : {});
        continue;
      }
      const old = before(record) as NodeRecord | undefined;
      if (record.removed && !old?.removed) push(record, at, "withdrew", `Took back a ${label}`, unit ? { unit } : {});
      else if (old && old.title !== record.title) push(record, at, "changed", `Renamed a ${label}`, unit ? { unit } : {});
      else if (old && old.type !== record.type) push(record, at, "changed", `Changed a unit's type to ${label}`, unit ? { unit } : {});
      else push(record, at, "changed", `Edited the details of a ${label}`, unit ? { unit } : {});
    } else if (record.kind === "relation") {
      const type = graph.documents.get(record.type) as RelationTypeRecord | undefined;
      const from = unitOf(graph, record.source);
      const to = unitOf(graph, record.target);
      if (!from || !to) continue;
      push(record, at, "related", `Said this ${(type?.label ?? "relates to").toLowerCase()}`, { unit: from, other: to });
    } else if (record.kind === "retraction") {
      push(record, at, "withdrew", "Withdrew a relation");
    } else if (record.kind === "paper" && first) {
      const count = paperUnits.get(record.id) ?? 0;
      push(record, at, "read", `Read a paper into ${count} ${count === 1 ? "unit" : "units"}, with ${record.model}`, { canvas: { id: record.canvas, title: record.title } });
    } else if (record.kind === "canvas") {
      const old = first ? undefined : (before(record) as CanvasRecord | undefined);
      if (first && !record.paper) push(record, at, "canvas", "Made a canvas", { canvas: { id: record.id, title: record.title } });
      else if (old && old.shared === undefined && record.shared !== undefined) push(record, at, "canvas", "Shared a canvas with the lab", { canvas: { id: record.id, title: record.title } });
    } else if (record.kind === "unit-note" && first) {
      const unit = unitOf(graph, record.unit);
      push(record, at, "noted", "Left a note", unit ? { unit } : {});
    } else if (record.kind === "reaction" && record.value) {
      const unit = unitOf(graph, record.unit);
      push(record, at, "reacted", record.value === "interesting" ? "Marked as interesting" : record.value === "agree" ? "Agreed with" : "Disagreed with", unit ? { unit } : {});
    } else if (record.kind === "evaluation" && !record.removed) {
      const unit = unitOf(graph, record.target);
      push(record, at, "reviewed", `Reviewed${record.term ? `: ${record.term}` : ""}`, unit ? { unit } : {});
    } else if (record.kind === "decision") {
      push(record, at, "decided", record.decision === "accepted" ? "Accepted a proposed relation" : "Rejected a proposed relation");
    }
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
};

/** Counts over a person's work. Nothing here names a unit, a paper or a canvas. */
export const statsOf = ({ graph, person, shared, localSpace, now = Date.now() }: ProfileInput, audience: ProfileAudience | "all"): ProfileStats => {
  const visible = (record: DgRecord): boolean => {
    if (audience === "all") return true;
    const lab = shared.has(record.id) || record.space !== localSpace;
    return audience === "lab" ? lab : !lab;
  };
  const byType = new Map<string, { label: string; base?: string; count: number }>();
  const days = new Set<string>();
  const weeks = Array.from({ length: 26 }, () => 0);
  let written = 0;
  let read = 0;
  let relations = 0;
  let papers = 0;
  let canvases = 0;
  let first: string | undefined;
  let last: string | undefined;
  const touch = (at: string): void => {
    days.add(at.slice(0, 10));
    if (!first || at < first) first = at;
    if (!last || at > last) last = at;
    const week = Math.floor((now - new Date(at).getTime()) / (7 * DAY));
    if (week >= 0 && week < weeks.length) weeks[weeks.length - 1 - week]! += 1;
  };
  for (const record of graph.documents.values()) {
    if (record.by.id !== person || !visible(record)) continue;
    if (record.kind === "node" && !record.removed && !graph.withdrawn.has(record.id)) {
      const type = typeOf(graph, record);
      const label = type?.label ?? "Untyped";
      const held = byType.get(label) ?? { label, ...(type?.base ? { base: type.base } : {}), count: 0 };
      byType.set(label, { ...held, count: held.count + 1 });
      if (record.source) read += 1;
      else written += 1;
      touch(record.at);
    } else if (record.kind === "paper") {
      papers += 1;
      touch(record.at);
    } else if (record.kind === "canvas" && !record.removed && !record.paper) {
      canvases += 1;
      touch(record.at);
    }
  }
  for (const { record, state } of graph.relations.values()) {
    if (record.by.id !== person || state === "withdrawn" || !visible(record)) continue;
    relations += 1;
    touch(record.at);
  }
  return {
    units: written + read,
    written,
    read,
    byType: [...byType.values()].sort((a, b) => b.count - a.count),
    relations,
    papers,
    canvases,
    activeDays: days.size,
    weeks,
    ...(first ? { since: first } : {}),
    ...(last ? { lastActive: last } : {}),
  };
};

export const profileFeature = (context: Context, { shareable }: { /** What this person shares with their lab, to tell lab-visible work from private. */ shareable: () => DgRecord[] }) => {
  const input = (person: string): ProfileInput => ({
    records: context.records(),
    graph: context.graph(),
    person,
    shared: new Set(shareable().map(({ id }) => id)),
    localSpace: context.localSpace,
  });
  const people = () => context.documents("person");
  const who = (id: string): Profile["person"] => {
    const me = context.me();
    const record = people().find((person) => person.did === id || person.by.id === id);
    const membership = context.documents("membership").find((item) => item.member === id);
    const lab = membership ? context.documents("lab").find((item) => item.did === membership.lab) : undefined;
    // Someone known only from the work they signed still has the name they signed it with.
    const signed = record?.name ?? (id === me.id ? me.name : [...context.graph().documents.values()].find((item) => item.by.id === id)?.by.name);
    return { id, name: signed ?? "Someone", me: id === me.id, ...(record?.orcid ? { orcid: record.orcid } : {}), ...(lab ? { lab: lab.name } : {}) };
  };
  const sameLab = (id: string): boolean => {
    const mine = context.myLab();
    return Boolean(mine && context.documents("membership").some((item) => item.member === id && item.lab === mine.did));
  };

  const handlers: Pick<Handlers, "profile.view" | "profile.card" | "profile.show"> = {
    "profile.view": async ({ id }): Promise<Profile> => {
      const person = who(id ?? context.me().id);
      const given = input(person.id);
      const history = historyOf(given);
      const part = (audience: ProfileAudience) => {
        const events = history.filter((event) => event.audience === audience);
        return { stats: statsOf(given, audience), history: events.slice(0, HISTORY), more: Math.max(0, events.length - HISTORY) };
      };
      // What this viewer may see: all of their own, a labmate's lab work, and anyone's counts.
      const audiences: Profile["audiences"] = person.me ? ["private", "lab", "public"] : sameLab(person.id) || given.records.some((record) => record.by.id === person.id && record.space !== context.localSpace) ? ["lab", "public"] : ["public"];
      const mates = context.myLab()
        ? context
            .documents("membership")
            .filter((item) => item.lab === context.myLab()!.did)
            .map((item) => who(item.member))
        : [];
      return {
        person,
        audiences,
        // A person's own counts cover all their work. Anyone else's cover what this device holds of it.
        public: statsOf(given, "all"),
        ...(audiences.includes("lab") ? { lab: part("lab") } : {}),
        ...(audiences.includes("private") ? { private: part("private") } : {}),
        people: [who(context.me().id), ...mates.filter((mate) => !mate.me)],
      };
    },
    "profile.card": async ({ id }): Promise<ProfileCard> => {
      const person = who(id);
      const stats = statsOf(input(id), "all");
      return { ...person, units: stats.units, written: stats.written, read: stats.read, relations: stats.relations, papers: stats.papers, ...(stats.since ? { since: stats.since } : {}), ...(stats.lastActive ? { lastActive: stats.lastActive } : {}) };
    },
    "profile.show": async ({ id }) => {
      const opened = await context.host.openSurface({ route: { surface: "profile", ...(id ? { id } : {}) }, placement: "main" });
      if (!opened.ok) throw new Error(opened.error.message);
      return null;
    },
  };
  return { handlers };
};
