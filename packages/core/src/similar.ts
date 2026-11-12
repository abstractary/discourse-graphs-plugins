import type { DgId, NodeRecord, RelationTypeRecord } from "@dg/contract/records.ts";
import type { MethodView, SimilarUnit } from "@dg/contract/surface.ts";
import { fold } from "@dg/contract/words.ts";
import type { Context, Handlers } from "./context.ts";
import { baseOf, evidenceChain, protocolCids } from "./process.ts";

/**
 * Reading across papers: units elsewhere that say something close to this one,
 * and what a claim rests on once its support runs through other claims.
 *
 * Closeness is by words alone, weighted so that a word few units use counts
 * for more than one most units use. It finds candidates for a person to judge.
 * It never states a relation.
 */

const STOP = new Set(
  "a an and are as at be been being but by can could did do does for from had has have if in into is it its may might more most must no nor not of on or our should so some such than that the their them then there these they this those to was we were what when where which while who will with would also between both each near new one only other over same two under use used using based due via per".split(" "),
);
const ARGUABLE = new Set(["claim", "evidence", "question"]);

/** Words worth comparing: folded, without the small ones, and with plurals and tenses cut back roughly. */
export const termsOf = (text: string): string[] =>
  (fold(text).replace(/['’]s\b/g, "").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .filter((word) => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word))
    .map((word) => (word.length > 5 ? word.replace(/(ies|ing|ed|es|s)$/, "") : word));

export const similarFeature = (context: Context): Pick<Handlers, "node.similar"> & { restsOn: (claim: DgId) => Promise<MethodView["rests"]> } => {
  const live = (): NodeRecord[] => context.documents("node").filter((node) => !node.removed);
  const base = (node: NodeRecord | undefined) => baseOf(context.graph(), node);
  // A unit's own sentence, and what the extraction said about it. The quoted passage is left out: its wording is the paper's, and adds more noise than signal.
  const textOf = (node: NodeRecord): string => [node.title, node.title, node.source?.description ?? ""].join(" ");

  return {
    "node.similar": async ({ id, limit = 6 }) => {
      const node = context.nodeOf(id);
      if (!node) throw new Error("That unit isn't in this graph.");
      const pool = live().filter((other) => ARGUABLE.has(base(other) ?? ""));
      const frequency = new Map<string, number>();
      const vectors = new Map<DgId, Map<string, number>>();
      for (const other of [...pool, node]) {
        if (vectors.has(other.id)) continue;
        const counts = new Map<string, number>();
        for (const term of termsOf(textOf(other))) counts.set(term, (counts.get(term) ?? 0) + 1);
        vectors.set(other.id, counts);
        for (const term of counts.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
      }
      const total = vectors.size;
      const weight = (term: string, count: number): number => (1 + Math.log(count)) * Math.log(1 + total / (frequency.get(term) ?? 1));
      const norm = (counts: Map<string, number>): number => Math.sqrt([...counts].reduce((sum, [term, count]) => sum + weight(term, count) ** 2, 0)) || 1;
      const mine = vectors.get(node.id)!;
      const mineNorm = norm(mine);

      const related = new Set<DgId>([node.id]);
      for (const { record, state } of context.graph().relations.values()) {
        if (state === "withdrawn" || state === "rejected") continue;
        if (record.source === node.id) related.add(record.target);
        if (record.target === node.id) related.add(record.source);
      }

      const found: SimilarUnit[] = [];
      for (const other of pool) {
        // The same paper already put its own units side by side. What's worth finding is elsewhere.
        if (related.has(other.id) || (node.source?.paper && other.source?.paper === node.source.paper)) continue;
        const theirs = vectors.get(other.id)!;
        const shared: [string, number][] = [];
        let dot = 0;
        for (const [term, count] of mine) {
          const also = theirs.get(term);
          if (!also) continue;
          const part = weight(term, count) * weight(term, also);
          dot += part;
          shared.push([term, part]);
        }
        if (shared.length < 2) continue;
        const score = dot / (mineNorm * norm(theirs));
        // Papers rarely share wording, so the bar is low: these are leads to read, ranked, not matches.
        if (score < 0.08) continue;
        found.push({ node: context.summarize(other), score: Math.round(score * 100) / 100, shared: shared.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([term]) => term) });
      }
      // Several copies of one sentence, as test data and repeated imports leave, count once.
      const seen = new Set<string>();
      return found
        .sort((a, b) => b.score - a.score)
        .filter((item) => {
          const key = `${fold(item.node.title)}|${item.node.paper?.id ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limit);
    },

    /** Everything beneath a claim, through the claims that support it, down to evidence and the papers it was read from. */
    restsOn: async (claim) => {
      const graph = context.graph();
      const stance = (type: DgId) => (graph.documents.get(type) as RelationTypeRecord | undefined)?.base;
      const into = new Map<DgId, { from: DgId; stance: "supports" | "opposes" }[]>();
      for (const { record, state } of graph.relations.values()) {
        if (state !== "active") continue;
        const kind = stance(record.type);
        if (kind !== "supports" && kind !== "opposes") continue;
        into.set(record.target, [...(into.get(record.target) ?? []), { from: record.source, stance: kind }]);
      }
      const claims = new Set<DgId>();
      const evidence = new Set<DgId>();
      let opposing = 0;
      let reach: DgId[] = [claim];
      for (let depth = 0; depth < 6 && reach.length; depth += 1) {
        const next: DgId[] = [];
        for (const id of reach) {
          for (const { from, stance: kind } of into.get(id) ?? []) {
            if (kind === "opposes") {
              if (id === claim) opposing += 1;
              continue;
            }
            const node = context.nodeOf(from);
            if (!node || node.removed || from === claim) continue;
            const kindOf = base(node);
            if (kindOf === "evidence") evidence.add(from);
            else if (kindOf === "claim" && !claims.has(from)) {
              claims.add(from);
              next.push(from);
            }
          }
        }
        reach = next;
      }
      if (!claims.size) return undefined;
      const cids = await protocolCids(graph);
      const runs = new Set<DgId>();
      for (const id of evidence) {
        const run = evidenceChain(graph, id, cids).run;
        if (run) runs.add(run);
      }
      const papers = new Map<DgId, { id: DgId; label: string; title: string; units: number }>();
      let own = 0;
      for (const id of [...claims, ...evidence]) {
        const paper = context.summarize(context.nodeOf(id)!).paper;
        if (!paper) own += 1;
        else papers.set(paper.id, { ...paper, units: (papers.get(paper.id)?.units ?? 0) + 1 });
      }
      return { claims: claims.size, evidence: evidence.size, runs: runs.size, opposing, own, papers: [...papers.values()].sort((a, b) => b.units - a.units) };
    },
  };
};
