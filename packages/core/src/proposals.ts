import { createEvaluation, assertRelation, decide, revise, type DgId, type NodeRecord, type ProposalRecord } from "@dg/contract/records.ts";
import type { ProposalGroup, ProposalItem } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

/**
 * What an agent proposed, and what a person does with it. A proposal is a
 * record an agent's key signed. The fold sets it apart, so nothing reads it as
 * part of the argument. Accepting one makes a record of the person's own that
 * says which proposal it began as. The proposal stays in the log as what the
 * agent said. Turning one down records that, and nothing else.
 */
export const proposalFeature = (
  context: Context,
  { createUnit }: { /** Makes a unit as the person would, with its note or page. */ createUnit: (args: { title: string; type?: DgId }) => Promise<{ id: DgId }> },
): { handlers: Pick<Handlers, "proposal.list" | "proposal.decide"> } => {
  const sessionOf = (record: ProposalRecord): { session: string; agent: string } => {
    const ext = (record.ext ?? {}) as { session?: unknown; agent?: unknown };
    return { session: typeof ext.session === "string" ? ext.session : "Earlier", agent: typeof ext.agent === "string" ? ext.agent : "An agent" };
  };
  /** The person's own unit that a proposed unit became, once accepted. */
  const acceptedAs = (proposal: DgId): NodeRecord | undefined => context.documents("node").find((node) => node.acceptedFrom === proposal && !node.removed);
  /** A unit a proposal points at: a real one, or the real one a proposed one became. */
  const realOf = (id: DgId): DgId | undefined => (context.graph().proposals.has(id) ? acceptedAs(id)?.id : context.nodeOf(id)?.id);
  const titleOf = (id: DgId): string => {
    const proposed = context.graph().proposals.get(id)?.record;
    return proposed?.kind === "node" ? proposed.title : (context.nodeOf(id)?.title ?? "a unit that is gone");
  };
  /** Agents taken out of use. What they proposed and nobody answered is no longer offered. */
  const removedKeys = (): Set<string> => new Set(context.documents("device").filter((device) => device.role === "agent" && device.removed).map((device) => device.key));

  const itemOf = (record: ProposalRecord, decision: "accepted" | "rejected" | undefined): ProposalItem => {
    const state = decision ?? "waiting";
    if (record.kind === "node") {
      const type = context.typeOf(record.type);
      const passage = record.facts?.anchor?.exact;
      return { id: record.id, kind: "unit", text: record.title, ...(type ? { typeLabel: type.label } : {}), ...(passage ? { restsOn: `“${passage}”` } : {}), state, at: record.at };
    }
    if (record.kind === "relation") {
      const label = context.relationTypeOf(record.type)?.label ?? "relates to";
      return { id: record.id, kind: "relation", text: `${titleOf(record.source)} ${label.toLowerCase()} ${titleOf(record.target)}`, state, at: record.at };
    }
    const verdict = record.term === "needsWork" ? "Needs work" : "Holds up";
    return { id: record.id, kind: "check", text: `${verdict}: ${titleOf(record.target)}`, ...(record.note ? { restsOn: record.note } : {}), state, at: record.at };
  };

  const list = async (): Promise<ProposalGroup[]> => {
    const gone = removedKeys();
    const groups = new Map<string, ProposalGroup>();
    const order = { unit: 0, relation: 1, check: 2 } as const;
    for (const { record, decision } of context.graph().proposals.values()) {
      if (!decision && record.sigBy !== undefined && gone.has(record.sigBy)) continue;
      const { session, agent } = sessionOf(record);
      const key = `${agent}\n${session}`;
      const group = groups.get(key) ?? { session, agent, at: record.at, items: [] };
      group.items.push(itemOf(record, decision));
      if (record.at < group.at) group.at = record.at;
      groups.set(key, group);
    }
    for (const group of groups.values()) group.items.sort((a, b) => order[a.kind] - order[b.kind] || (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  };

  const accept = async (record: ProposalRecord): Promise<void> => {
    const stamp = context.stamp();
    if (record.kind === "node") {
      const made = await createUnit({ title: record.title, ...(record.type && context.typeOf(record.type) ? { type: context.typeOf(record.type)!.id } : {}) });
      const node = context.nodeOf(made.id);
      if (!node) throw new Error("The unit couldn't be made.");
      // It is the person's unit now. It keeps what it was read from, and says where it began.
      await context.put([{ ...revise({ record: node, changes: { ...(record.source ? { source: record.source } : {}), ...(record.prov ? { prov: record.prov } : {}), ...(record.facts ? { facts: record.facts } : {}) }, by: context.me() }), acceptedFrom: record.id }]);
    } else if (record.kind === "relation") {
      const [source, target] = [realOf(record.source), realOf(record.target)];
      if (!source || !target) throw new Error(`Accept the units this joins first: ${[source ? "" : titleOf(record.source), target ? "" : titleOf(record.target)].filter(Boolean).join(" and ")}.`);
      await context.put([{ ...assertRelation({ ...stamp, type: record.type, source, target }), acceptedFrom: record.id }]);
    } else {
      const target = realOf(record.target);
      if (!target) throw new Error(`Accept the unit this is about first: ${titleOf(record.target)}.`);
      await context.put([{ ...createEvaluation({ ...stamp, fields: { target, method: record.method, ...(record.targetCid && target === record.target ? { targetCid: record.targetCid } : {}), ...(record.term ? { term: record.term } : {}), ...(record.note ? { note: record.note } : {}) } }), acceptedFrom: record.id }]);
    }
    await context.put([decide({ ...stamp, target: record.id, decision: "accepted" })]);
  };

  return {
    handlers: {
      "proposal.list": list,
      "proposal.decide": async ({ ids, decision }) => {
        // Units first, so a relation or a check accepted with them finds what it is about.
        const order = { node: 0, relation: 1, evaluation: 2 } as const;
        const chosen = ids.flatMap((id) => {
          const held = context.graph().proposals.get(id);
          return held && !held.decision ? [held.record] : [];
        }).sort((a, b) => order[a.kind] - order[b.kind]);
        const problems: string[] = [];
        for (const record of chosen) {
          if (decision === "reject") await context.put([decide({ ...context.stamp(), target: record.id, decision: "rejected" })]);
          else await accept(record).catch((error: Error) => void problems.push(error.message));
        }
        if (problems.length > 0) throw new Error(problems[0]!);
        return list();
      },
    },
  };
};
