import type { DgId, TidyMode } from "@dg/contract/records.ts";
import type { Box } from "./edges.ts";
import { scoresFor, type Measure } from "./centrality.ts";
import { columnsOf } from "./layers.ts";
import { boundsOf, type Frame, type Link } from "./measure.ts";
import { layOutRegions, type Guide, type Laid, type Region } from "./regions.ts";
import { tidy, type TidyBox } from "./tidy.ts";

/** What a mode needs to know about a card, beyond its size. */
export type Card = TidyBox & {
  at?: string;
  kind?: { key: string; label: string };
  credit?: { key: string; label: string };
};

export type RelationLink = Link & { kind?: string };

export type Arrangement = { places: Map<string, { x: number; y: number }>; guides: Guide[] };

export const MODES: { mode: TidyMode; label: string; hint: string; group: "Arrange by" | "Centrality" }[] = [
  { mode: "logic", label: "Logic", hint: "What each card rests on sits to its left", group: "Arrange by" },
  { mode: "debate", label: "For and against", hint: "Support on the left, opposition on the right", group: "Arrange by" },
  { mode: "timeline", label: "Timeline", hint: "Oldest on the left, in periods", group: "Arrange by" },
  { mode: "kinds", label: "Kinds", hint: "A column for each node type", group: "Arrange by" },
  { mode: "people", label: "People", hint: "A column for each contributor or lab", group: "Arrange by" },
  { mode: "focus", label: "Focus", hint: "The selected card and what touches it", group: "Arrange by" },
  { mode: "connected", label: "Most connected", hint: "Ranks cards by how many they touch", group: "Centrality" },
  { mode: "bridges", label: "Bridges", hint: "Ranks cards that join parts of the argument", group: "Centrality" },
  { mode: "load", label: "Load-bearing", hint: "Ranks what the most depends on", group: "Centrality" },
];

export const measureOf = (mode: TidyMode | undefined): Measure | null =>
  mode === "connected" || mode === "bridges" || mode === "load" ? mode : null;

/** Relations whose arrow points at what the source rests on, not at what it leads to. */
const RESTS_ON_TARGET = new Set(["derivedFrom", "follows", "requestTarget"]);

/**
 * Turns each link to run from what's relied on to what relies on it. An arrow
 * says who asserted what, not which way reasoning leans: a result "derived from"
 * an experiment points at the experiment, which it rests on.
 */
export const leaningOf = (links: RelationLink[], opposesRight: boolean): RelationLink[] =>
  links.map((link) => {
    const turned = RESTS_ON_TARGET.has(link.kind ?? "") || (opposesRight && link.kind === "opposes");
    return turned ? { ...link, from: link.to, to: link.from } : link;
  });

const shifted = (laid: Laid, start: Box): Arrangement => {
  const end = boundsOf([...laid.boxes.values(), ...laid.guides]);
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  return {
    places: new Map([...laid.boxes].map(([id, box]) => [id, { x: Math.round(box.x + dx), y: Math.round(box.y + dy) }])),
    guides: laid.guides.map((guide) => ({
      ...guide,
      x: Math.round(guide.x + dx),
      y: Math.round(guide.y + dy),
      width: Math.round(guide.width),
      height: Math.round(guide.height),
    })),
  };
};

const leftOver = (boxes: Card[], used: Set<string>, label: string): Region[] => {
  const ids = boxes.filter((box) => !used.has(box.id)).map((box) => box.id);
  return ids.length > 0 ? [{ key: `rest-${label}`, label, ids }] : [];
};

const byPosition = (boxes: Card[]): Card[] => [...boxes].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));

type Unit = "year" | "quarter" | "month" | "week" | "day";
const UNITS: Unit[] = ["day", "week", "month", "quarter", "year"];
const DAY = 86_400_000;

const startOf = (time: number, unit: Unit): number => {
  const date = new Date(time);
  const [year, month] = [date.getUTCFullYear(), date.getUTCMonth()];
  if (unit === "year") return Date.UTC(year, 0, 1);
  if (unit === "quarter") return Date.UTC(year, month - (month % 3), 1);
  if (unit === "month") return Date.UTC(year, month, 1);
  const day = Date.UTC(year, month, date.getUTCDate());
  return unit === "day" ? day : day - ((date.getUTCDay() + 6) % 7) * DAY;
};

/** In the unit a person would say it in. */
const elapsed = (from: number, to: number): string => {
  const days = Math.round((to - from) / DAY);
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  if (days < 730) return plural(Math.round(days / 30.44), "month");
  return plural(Math.round(days / 365.25), "year");
};

const nextPeriod = (time: number, unit: Unit): number => {
  const date = new Date(time);
  const [year, month] = [date.getUTCFullYear(), date.getUTCMonth()];
  if (unit === "year") return Date.UTC(year + 1, 0, 1);
  if (unit === "quarter") return Date.UTC(year, month + 3, 1);
  if (unit === "month") return Date.UTC(year, month + 1, 1);
  return time + (unit === "week" ? 7 : 1) * DAY;
};

const format = (time: number, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...options }).format(time);

const periodLabel = (time: number, unit: Unit): string => {
  if (unit === "year") return format(time, { year: "numeric" });
  if (unit === "quarter") return `Q${Math.floor(new Date(time).getUTCMonth() / 3) + 1} ${format(time, { year: "numeric" })}`;
  if (unit === "month") return format(time, { month: "short", year: "numeric" });
  const day = format(time, { day: "numeric", month: "short", year: "numeric" });
  return unit === "week" ? `Week of ${day}` : day;
};

/**
 * Periods with nothing in them are left out, and the next heading says how long
 * the silence was, so a quiet year doesn't push everything off the frame. That
 * is the "sequential with interim duration" scale from the timeline literature.
 */
const timelineRegions = (boxes: Card[]): Region[] => {
  const dated = boxes.flatMap((box) => {
    const time = box.at ? Date.parse(box.at) : Number.NaN;
    return Number.isNaN(time) ? [] : [{ id: box.id, time }];
  });
  if (dated.length === 0) return leftOver(boxes, new Set(), "No date");
  // The finest periods that stay few enough to scan.
  const most = Math.max(4, Math.min(8, Math.ceil(dated.length / 3)));
  const countIn = (unit: Unit): number => new Set(dated.map(({ time }) => startOf(time, unit))).size;
  const unit = UNITS.find((candidate) => countIn(candidate) <= most) ?? "year";
  const periods = new Map<number, { id: string; time: number }[]>();
  for (const item of dated) {
    const period = startOf(item.time, unit);
    periods.set(period, [...(periods.get(period) ?? []), item]);
  }
  const ordered = [...periods].sort(([a], [b]) => a - b);
  const regions = ordered.map(([period, items], index) => {
    const previous = ordered[index - 1]?.[0];
    const quiet = previous !== undefined && nextPeriod(previous, unit) < period;
    const label = periodLabel(period, unit);
    return {
      key: String(period),
      label: quiet ? `${label} (${elapsed(previous, period)} later)` : label,
      ids: [...items].sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1)).map(({ id }) => id),
    };
  });
  return [...regions, ...leftOver(boxes, new Set(dated.map(({ id }) => id)), "No date")];
};

const groupedRegions = (boxes: Card[], groupOf: (box: Card) => { key: string; label: string } | undefined): Region[] => {
  const groups = new Map<string, Region>();
  for (const box of byPosition(boxes)) {
    const group = groupOf(box);
    if (!group) continue;
    const region = groups.get(group.key) ?? { key: group.key, label: group.label, ids: [] };
    region.ids.push(box.id);
    groups.set(group.key, region);
  }
  return [...groups.values()];
};

/** Types sit in the order the argument flows, so Kinds reads the same way as Logic. */
const kindRegions = (boxes: Card[], links: RelationLink[]): Region[] => {
  const indexOf = new Map(boxes.map((box, index) => [box.id, index]));
  const arrows = leaningOf(links, false).flatMap(({ from, to }) => {
    const [a, b] = [indexOf.get(from), indexOf.get(to)];
    return a === undefined || b === undefined || a === b ? [] : [{ from: a, to: b }];
  });
  const { columns } = columnsOf(boxes.map(({ id, width, height, y }) => ({ id, width, height, y })), arrows);
  const depth = (region: Region): number =>
    region.ids.reduce((sum, id) => sum + columns[indexOf.get(id)!]!, 0) / region.ids.length;
  const regions = groupedRegions(boxes, (box) => box.kind ?? (box.note ? undefined : { key: "untyped", label: "No type yet" }));
  const ordered = [...regions].sort((a, b) => depth(a) - depth(b) || a.label.localeCompare(b.label));
  return [...ordered, ...leftOver(boxes, new Set(regions.flatMap(({ ids }) => ids)), "Notes")];
};

const peopleRegions = (boxes: Card[]): Region[] => {
  const regions = groupedRegions(boxes, (box) => box.credit);
  const ordered = [...regions].sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  return [...ordered, ...leftOver(boxes, new Set(regions.flatMap(({ ids }) => ids)), "Notes")];
};

const HOPS = 2;

/**
 * The chosen card in the middle, what it rests on to its left, and what rests on
 * it or pushes against it to its right. Everything else waits at the far right.
 */
const focusRegions = (boxes: Card[], links: RelationLink[], focus: DgId): Region[] => {
  const leaning = leaningOf(links, true);
  const places = new Map<string, number>([[focus, 0]]);
  // Each side only reaches further out, so a card sharing a ground with this one
  // isn't mistaken for it.
  for (const direction of [-1, 1]) {
    let reached = [focus];
    for (let hop = 1; hop <= HOPS; hop += 1) {
      const next: string[] = [];
      for (const id of reached) {
        for (const { from, to } of leaning) {
          const other = direction > 0 ? (from === id ? to : null) : to === id ? from : null;
          if (other === null || places.has(other)) continue;
          places.set(other, hop * direction);
          next.push(other);
        }
      }
      reached = next;
    }
  }
  const inPlace = (test: (place: number) => boolean): string[] =>
    byPosition(boxes).flatMap((box) => (places.has(box.id) && test(places.get(box.id)!) ? [box.id] : []));
  const regions: Region[] = [
    { key: "far-left", label: "Further back", ids: inPlace((place) => place < -1) },
    { key: "left", label: "Rests on", ids: inPlace((place) => place === -1) },
    { key: "focus", label: "This card", ids: inPlace((place) => place === 0) },
    { key: "right", label: "Rests on it, or opposes it", ids: inPlace((place) => place === 1) },
    { key: "far-right", label: "Further on", ids: inPlace((place) => place > 1) },
  ];
  return [...regions, ...leftOver(boxes, new Set(places.keys()), "Not linked to this card")];
};

const BAND_NAMES: Record<Measure, [string, string, string]> = {
  connected: ["Most connected", "Connected", "Few links"],
  bridges: ["Main bridges", "Some bridging", "No bridging"],
  load: ["Load-bearing", "Supporting", "Resting on others"],
};

/** Highest on the left and at the top, in three bands, and ties never split. */
const bandRegions = (boxes: Card[], links: RelationLink[], measure: Measure): Region[] => {
  const linked = new Set(links.flatMap(({ from, to }) => [from, to]));
  const ids = boxes.filter((box) => linked.has(box.id)).map((box) => box.id);
  const scores = scoresFor(measure, ids, leaningOf(links, false));
  const ranked = [...ids].sort((a, b) => scores.get(b)! - scores.get(a)! || (a < b ? -1 : 1));
  const cutoff = (share: number): number => {
    const at = Math.min(ranked.length - 1, Math.max(0, Math.ceil(ranked.length * share) - 1));
    return ranked.length > 0 ? scores.get(ranked[at]!)! : 0;
  };
  const [top, middle] = [cutoff(0.2), cutoff(0.5)];
  const [first, second, third] = BAND_NAMES[measure];
  const regions: Region[] = [
    { key: "top", label: first, ids: ranked.filter((id) => scores.get(id)! >= top) },
    { key: "middle", label: second, ids: ranked.filter((id) => scores.get(id)! < top && scores.get(id)! >= middle) },
    { key: "rest", label: third, ids: ranked.filter((id) => scores.get(id)! < middle) },
  ];
  return [...regions, ...leftOver(boxes, new Set(ids), "No links")];
};

export const arrange = ({
  mode,
  boxes,
  links,
  frame,
  focus,
  previous,
}: {
  mode: TidyMode;
  boxes: Card[];
  links: RelationLink[];
  frame: Frame;
  focus?: DgId;
  /** The mode the canvas is in now. */
  previous?: TidyMode;
}): Arrangement => {
  if (boxes.length === 0) return { places: new Map(), guides: [] };
  if (mode === "logic" || mode === "debate") {
    return { places: tidy(boxes, leaningOf(links, mode === "debate"), { frame, fresh: previous !== mode }), guides: [] };
  }
  const start = boundsOf(boxes);
  const measure = measureOf(mode);
  const regions =
    measure !== null
      ? bandRegions(boxes, links, measure)
      : mode === "timeline"
        ? timelineRegions(boxes)
        : mode === "kinds"
          ? kindRegions(boxes, links)
          : mode === "people"
            ? peopleRegions(boxes)
            : focusRegions(boxes, links, focus ?? boxes[0]!.id);
  return shifted(layOutRegions({ regions, boxes, links, frame, ranked: measure !== null }), start);
};
