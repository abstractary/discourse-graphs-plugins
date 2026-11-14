import { canonicalJson, type DgId, type HostRef } from "@dg/contract/records.ts";
import type { Context } from "./context.ts";
import { CHECK_WORDS, FACT_KEYS } from "./grammar.ts";

/**
 * Relations live in the records, and a base's own tools only follow links in
 * its texts. So each note carries its relations as link properties, written
 * from the records and never read back.
 */
export const mirrorFeature = (context: Context) => {
  const { host } = context;
  const mirrored = new Map<HostRef, string>();
  const live = (ref: HostRef): boolean => context.hasLiveText(ref);

  /** What a base's own table can sort a unit by: its type, the day it was made, who by, a run's status and its paper. */
  const factsWanted = (): Map<HostRef, Record<string, string>> => {
    const byRef = new Map<HostRef, Record<string, string>>();
    for (const anchor of context.anchors()) {
      const node = context.nodeOf(anchor.node);
      if (!node || !live(anchor.ref)) continue;
      const type = context.typeOf(node.type);
      const paper = node.source ? context.graph().documents.get(node.source.paper) : undefined;
      const checked = context.offers.checks?.stateOf(node.id);
      byRef.set(anchor.ref, {
        ...(type ? { [FACT_KEYS.type]: type.label } : {}),
        [FACT_KEYS.made]: node.at.slice(0, 10),
        [FACT_KEYS.by]: context.nameOf(node.by),
        ...(node.facts?.status ? { [FACT_KEYS.status]: node.facts.status } : {}),
        ...(checked ? { [FACT_KEYS.checked]: CHECK_WORDS[checked] } : {}),
        ...(paper?.kind === "paper" ? { [FACT_KEYS.source]: paper.title } : {}),
      });
    }
    return byRef;
  };

  const linksWanted = (): { managed: string[]; byRef: Map<HostRef, Record<string, HostRef[]>> } => {
    const managed = new Set<string>();
    for (const type of context.documents("relation-type")) {
      managed.add(type.label);
      managed.add(type.complement);
    }
    const byRef = new Map<HostRef, Record<string, HostRef[]>>();
    const liveRef = (id: DgId): HostRef | undefined => {
      const anchor = context.nodeOf(id) ? context.anchorOf(id) : undefined;
      return anchor && live(anchor.ref) ? anchor.ref : undefined;
    };
    for (const anchor of context.anchors()) {
      if (context.nodeOf(anchor.node) && live(anchor.ref)) byRef.set(anchor.ref, {});
    }
    for (const { record, state } of context.graph().relations.values()) {
      if (state !== "active" || record.proposed) continue;
      const type = context.relationTypeOf(record.type);
      const from = liveRef(record.source);
      const to = liveRef(record.target);
      if (!type || !from || !to || from === to) continue;
      for (const [ref, key, other] of [[from, type.label, to], [to, type.complement, from]] as const) {
        const held = byRef.get(ref)!;
        if (!(held[key] ??= []).includes(other)) held[key]!.push(other);
      }
    }
    return { managed: [...managed].filter(Boolean).sort(), byRef };
  };

  let mirroring: Promise<void> = Promise.resolve();
  let queued = false;
  const run = (): void => {
    if (queued) return;
    queued = true;
    mirroring = mirroring.then(async () => {
      queued = false;
      const { managed, byRef } = linksWanted();
      const factsByRef = factsWanted();
      const managedFacts = Object.values(FACT_KEYS);
      for (const [ref, links] of byRef) {
        const facts = factsByRef.get(ref) ?? {};
        const wanted = canonicalJson({ managed, links, facts } as never);
        if (mirrored.get(ref) === wanted) continue;
        const done = await host.setLinks({ ref, links, managed, facts, managedFacts });
        // A note that can't be written now is tried again on the next change.
        if (done.ok) mirrored.set(ref, wanted);
      }
    });
  };
  context.afterChange(run);
  run();

  return {
    /** A hand edit to a note's link properties is put back on the next pass. */
    forget: (ref: HostRef): void => {
      mirrored.delete(ref);
    },
  };
};
