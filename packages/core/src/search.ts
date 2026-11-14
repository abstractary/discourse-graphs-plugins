import type { DgId, HostRef, NodeRecord } from "@dg/contract/records.ts";
import type {
  SearchCarry,
  SearchField,
  SearchHit,
  SearchQuery,
  SearchResults,
} from "@dg/contract/surface.ts";
import type { TextMarks } from "@dg/contract/words.ts";
import type { Context, Handlers } from "./context.ts";
import { fold, foldWithMap, marksOf, wordsOf } from "@dg/contract/words.ts";

export { fold, foldWithMap, wordsOf };

/**
 * Finding units by their words. A title counts most, then the PDF passage a
 * unit was read from, then the text of its note. Every word has to turn up
 * somewhere, and a word that starts a word in the text beats one found inside
 * another. Notes are read once, in the background, and again when one changes.
 */

const WEIGHT: Record<SearchField, number> = { title: 3, passage: 1.5, text: 1 };
const FIELDS: SearchField[] = ["title", "passage", "text"];
const READ_AT_ONCE = 6;
/** A first search waits this long for notes to be read, then answers from titles and passages. */
const FIRST_WAIT_MS = 800;
const SNIPPET = 160;
const LEAD = 48;

/** Markdown as a person reads it: no front matter, link brackets or heading marks. */
export const readable = (body: string): string =>
  body
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/!?\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]{1,3}/g, "")
    .replace(/^\s*[-+>]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

type Indexed = { text: string; folded: string; map: number[] };
const index = (text: string): Indexed => ({ text, ...foldWithMap(text) });

type Found = { quality: number; at: number; length: number };

/** The best place a word turns up: at the start of a word if it can be. */
const find = (field: Indexed, word: string): Found | null => {
  let best: Found | null = null;
  let from = 0;
  for (;;) {
    const at = field.folded.indexOf(word, from);
    if (at < 0) break;
    const quality = isWordChar(field.folded[at - 1]) ? 0.6 : 1;
    if (!best || quality > best.quality) best = { quality, at, length: word.length };
    if (quality === 1) break;
    from = at + 1;
  }
  return best;
};

const marksIn = (field: Indexed, words: string[]): TextMarks => marksOf(field.text, words, field);

/** A window of text around the first word found, cut at word edges. */
const snippetOf = (field: Indexed, words: string[]): { snippet: string; marks: TextMarks } => {
  const all = marksIn(field, words);
  const first = all[0]?.[0] ?? 0;
  let start = Math.max(0, first - LEAD);
  if (start > 0) {
    const space = field.text.indexOf(" ", start);
    start = space >= 0 && space < first ? space + 1 : start;
  }
  let end = Math.min(field.text.length, start + SNIPPET);
  if (end < field.text.length) {
    const space = field.text.lastIndexOf(" ", end);
    end = space > first ? space : end;
  }
  const lead = start > 0 ? "…" : "";
  const tail = end < field.text.length ? "…" : "";
  const marks = all
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]): [number, number] => [a - start + lead.length, b - start + lead.length]);
  return { snippet: `${lead}${field.text.slice(start, end)}${tail}`, marks };
};

export const searchFeature = (context: Context) => {
  /** Note text by its ref, as a person reads it. */
  const bodies = new Map<HostRef, Indexed>();
  const stale = new Set<HostRef>();
  let reading: Promise<void> | null = null;
  let ready = false;
  let carried: SearchCarry | null = null;

  const refsToRead = (): HostRef[] =>
    context
      .documents("node")
      .flatMap((node) => {
        const anchor = !node.removed ? context.anchorOf(node.id) : undefined;
        return anchor && context.hasLiveText(anchor.ref) && (!bodies.has(anchor.ref) || stale.has(anchor.ref)) ? [anchor.ref] : [];
      });

  const readNotes = (): Promise<void> => {
    if (reading) return reading;
    reading = (async () => {
      const queue = refsToRead();
      const work = async () => {
        for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
          stale.delete(ref);
          const text = await context.host.readText({ ref });
          if (text.ok) bodies.set(ref, index(readable(text.value.body)));
          else bodies.delete(ref);
        }
      };
      await Promise.all(Array.from({ length: READ_AT_ONCE }, work));
    })().finally(() => {
      reading = null;
      if (!ready) {
        ready = true;
        context.send({ event: "search-ready" });
      }
    });
    return reading;
  };

  /** A note changed or went away: it's read again next time. */
  const invalidate = (ref: HostRef, removed = false): void => {
    if (removed) bodies.delete(ref);
    else if (bodies.has(ref)) stale.add(ref);
  };

  let placed: { graph: ReturnType<Context["graph"]>; by: Map<DgId, { id: DgId; title: string }[]> } | undefined;
  const canvasesOf = (node: DgId): { id: DgId; title: string }[] => {
    const graph = context.graph();
    if (placed?.graph !== graph) {
      const by = new Map<DgId, { id: DgId; title: string }[]>();
      for (const item of context.documents("canvas-item")) {
        const unit = (item.item as { dg?: { node?: DgId } }).dg?.node;
        const canvas = !item.removed && unit ? context.canvasOf(item.canvas) : undefined;
        if (!unit || !canvas || canvas.removed) continue;
        const list = by.get(unit) ?? [];
        if (!list.some((entry) => entry.id === canvas.id)) list.push({ id: canvas.id, title: canvas.title });
        by.set(unit, list);
      }
      placed = { graph, by };
    }
    return placed.by.get(node) ?? [];
  };

  const fieldsOf = (node: NodeRecord): Partial<Record<SearchField, Indexed>> => {
    const anchor = context.anchorOf(node.id);
    const body = anchor && context.hasLiveText(anchor.ref) ? bodies.get(anchor.ref) : undefined;
    const exact = node.facts?.anchor?.exact ?? node.source?.anchor;
    return {
      title: index(node.title),
      ...(exact ? { passage: index(exact.replace(/\s+/g, " ").trim()) } : {}),
      ...(body?.text ? { text: body } : {}),
    };
  };

  const run = async ({ text = "", types, credits, fields = FIELDS, sort, limit }: SearchQuery): Promise<SearchResults> => {
    const words = wordsOf(text);
    if (words.length && fields.includes("text") && !ready) {
      await Promise.race([readNotes(), new Promise((resolve) => setTimeout(resolve, FIRST_WAIT_MS))]);
    } else if (fields.includes("text") && stale.size) {
      await readNotes();
    }
    if (!ready && !reading) void readNotes();
    const whole = fold(text.replace(/"/g, "").replace(/\s+/g, " ").trim());
    const matched: { node: NodeRecord; score: number; hit: Omit<SearchHit, "canvases" | "node"> }[] = [];
    for (const node of context.documents("node")) {
      if (node.removed) continue;
      const parts = fieldsOf(node);
      let score = 0;
      let every = true;
      for (const word of words) {
        let best = 0;
        for (const field of fields) {
          const part = parts[field];
          const found = part ? find(part, word) : null;
          if (found) best = Math.max(best, WEIGHT[field] * found.quality);
        }
        if (!best) {
          every = false;
          break;
        }
        score += best;
      }
      if (!every) continue;
      const title = parts.title!;
      if (whole && fields.includes("title")) {
        if (title.folded === whole) score += 6;
        else if (title.folded.startsWith(whole)) score += 3;
        else if (title.folded.includes(whole)) score += 1.5;
      }
      const titleMarks = words.length && fields.includes("title") ? marksIn(title, words) : [];
      // The second line says where the rest of the words were, if the title doesn't hold them all.
      const missing = words.filter((word) => !fields.includes("title") || !find(title, word));
      const second = (["passage", "text"] as const)
        .filter((field) => fields.includes(field) && parts[field])
        .map((field) => ({ field, count: missing.filter((word) => find(parts[field]!, word)).length }))
        .filter(({ count }) => count > 0)
        .sort((a, b) => b.count - a.count)[0];
      matched.push({
        node,
        score,
        hit: {
          titleMarks,
          ...(second ? { match: { field: second.field, ...snippetOf(parts[second.field]!, words) } } : {}),
          editedAt: node.editedAt ?? node.at,
        },
      });
    }

    const typeCounts = new Map<string, number>();
    const creditCounts = new Map<string, { count: number; label: string; kind: "person" | "lab"; mine?: true }>();
    const me = context.me().id;
    for (const { node } of matched) {
      const type = node.type && context.typeOf(node.type) ? node.type : "none";
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      const credit = context.creditFor(node);
      const known = creditCounts.get(credit.id);
      creditCounts.set(credit.id, {
        count: (known?.count ?? 0) + 1,
        label: credit.name,
        kind: credit.kind,
        ...(credit.kind === "person" && credit.id === me ? { mine: true as const } : {}),
      });
    }

    const kept = matched.filter(({ node }) => {
      const type = node.type && context.typeOf(node.type) ? node.type : "none";
      if (types?.length && !types.includes(type)) return false;
      if (credits?.length && !credits.includes(context.creditFor(node).id)) return false;
      return true;
    });
    const order = sort ?? (words.length ? "relevance" : "edited");
    const edited = (entry: (typeof kept)[number]) => entry.hit.editedAt;
    kept.sort((a, b) => {
      if (order === "title") return a.node.title.localeCompare(b.node.title);
      if (order === "created") return b.node.at.localeCompare(a.node.at);
      if (order === "relevance" && b.score !== a.score) return b.score - a.score;
      return edited(b).localeCompare(edited(a));
    });

    const typeLabel = (id: string): string => (id === "none" ? "No type yet" : context.typeOf(id)?.label ?? id);
    return {
      hits: kept.slice(0, limit).map(({ node, hit }) => ({ node: context.summarize(node), ...hit, canvases: canvasesOf(node.id) })),
      total: kept.length,
      types: [...typeCounts]
        .map(([id, count]) => ({ id, label: typeLabel(id), count }))
        .sort((a, b) => (a.id === "none" ? 1 : b.id === "none" ? -1 : b.count - a.count || a.label.localeCompare(b.label))),
      credits: [...creditCounts]
        .map(([id, entry]) => ({ id, ...entry }))
        .sort((a, b) => (a.mine ? -1 : b.mine ? 1 : b.count - a.count || a.label.localeCompare(b.label))),
      textReady: ready,
    };
  };

  const handlers: Pick<Handlers, "search.query" | "search.show" | "search.take"> = {
    "search.query": run,
    "search.show": async ({ query }) => {
      carried = query ?? null;
      if (query) context.send({ event: "search-set", query });
      const opened = await context.host.openSurface({ route: { surface: "search" }, placement: "side" });
      if (!opened.ok) throw new Error(opened.error.message);
      return null;
    },
    "search.take": async () => {
      const query = carried;
      carried = null;
      return query;
    },
  };

  context.offers.textChanged = invalidate;
  return { handlers, invalidate, readNotes };
};
