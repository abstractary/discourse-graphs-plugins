import { createEvaluation, revise, type DgId, type EvaluationRecord, type NodeRecord } from "@dg/contract/records.ts";
import type { CheckState, CheckWay, UnitCheck } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { unitCid } from "./process.ts";

/**
 * Sign-off. A person marks a unit as checked, or as needing work, and says how
 * they checked it. The mark is an evaluation record pinned to a hash of the
 * unit as it stood, so it holds for those words and those links only: once the
 * unit changes, the mark reads as made on an earlier version.
 *
 * The author marking their own unit is signing it. Anyone else is a second
 * pair of eyes, which is what a lab notebook calls a witness.
 */

const TERM = { checked: "endorsed", needsWork: "needsWork" } as const;
const VERDICT: Record<string, UnitCheck["verdict"]> = { endorsed: "checked", needsWork: "needsWork" };

export const checkFeature = (context: Context) => {
  /** Each unit's hash as it stands, worked out once per version. Hashing is slow enough to keep off the drawing path. */
  const hashes = new Map<DgId, { rev: number; cid: string }>();
  const pending = new Set<DgId>();
  const hashOf = (node: NodeRecord): string | undefined => {
    const held = hashes.get(node.id);
    if (held?.rev === node.rev) return held.cid;
    if (!pending.has(node.id)) {
      pending.add(node.id);
      void unitCid(node).then((cid) => {
        pending.delete(node.id);
        hashes.set(node.id, { rev: node.rev, cid });
        // Cards drawn before the hash was known are drawn again with it.
        context.send({ event: "graph-changed" });
      });
    }
    return undefined;
  };

  /** One standing mark per person: their newest that hasn't been taken back. */
  const standing = (unit: DgId): EvaluationRecord[] => {
    const newest = new Map<string, EvaluationRecord>();
    for (const record of context.documents("evaluation")) {
      if (record.target !== unit || record.removed || !record.term || !(record.term in VERDICT)) continue;
      const held = newest.get(record.by.id);
      if (!held || record.at > held.at) newest.set(record.by.id, record);
    }
    return [...newest.values()].sort((a, b) => b.at.localeCompare(a.at));
  };

  const currentOf = (node: NodeRecord, record: EvaluationRecord): boolean => {
    const now = hashOf(node);
    // Until the hash is known, a unit edited after the mark is taken as changed.
    if (!record.targetCid || !now) return node.editedAt <= record.at;
    return record.targetCid === now;
  };

  const checksOf = (unit: DgId): UnitCheck[] => {
    const node = context.nodeOf(unit);
    if (!node) return [];
    const me = context.me().id;
    return standing(unit).map((record) => ({
      id: record.id,
      verdict: VERDICT[record.term!]!,
      way: record.method as CheckWay,
      ...(record.note ? { note: record.note } : {}),
      credit: context.creditFor(record),
      at: record.at,
      mine: record.by.id === me,
      own: record.by.id === node.by.id,
      current: currentOf(node, record),
    }));
  };

  /** How the unit stands, from its marks: one "needs work" on this version outweighs any number of checks. */
  const stateOf = (unit: DgId): CheckState | undefined => {
    const checks = checksOf(unit);
    if (checks.length === 0) return undefined;
    const live = checks.filter((check) => check.current);
    if (live.some((check) => check.verdict === "needsWork")) return "needsWork";
    if (live.some((check) => check.verdict === "checked")) return "checked";
    return "changed";
  };

  const handlers: Pick<Handlers, "unit.check" | "unit.uncheck"> = {
    "unit.check": async ({ unit, verdict, way = "expertJudgment", note }) => {
      const node = context.nodeOf(unit);
      if (!node || node.removed) throw new Error("That unit is gone.");
      const said = note?.replace(/\s+/g, " ").trim();
      if (verdict === "needsWork" && !said) throw new Error("Say what needs work, so its author knows what to change.");
      const me = context.me();
      const cid = await unitCid(node);
      hashes.set(node.id, { rev: node.rev, cid });
      // A new mark replaces this person's last one on the unit.
      const earlier = context.documents("evaluation").filter((record) => record.target === unit && record.by.id === me.id && !record.removed && record.term && record.term in VERDICT);
      await context.put([
        ...earlier.map((record) => revise({ record, changes: { removed: true }, by: me })),
        createEvaluation({ ...context.stamp(), fields: { target: unit, targetCid: cid, method: way, term: TERM[verdict], ...(said ? { note: said } : {}) } }),
      ]);
      return checksOf(unit);
    },
    "unit.uncheck": async ({ id }) => {
      const record = context.documents("evaluation").find((item) => item.id === id);
      if (!record || record.removed) return record ? checksOf(record.target) : [];
      if (record.by.id !== context.me().id) throw new Error("Only the person who made a mark can take it back.");
      await context.put([revise({ record, changes: { removed: true }, by: context.me() })]);
      return checksOf(record.target);
    },
  };
  return { handlers, checksOf, stateOf, standing };
};
