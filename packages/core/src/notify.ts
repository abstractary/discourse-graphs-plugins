import { uuidv7, type NodeRecord } from "@dg/contract/records.ts";
import type { Notification, NotifyPattern, NotifyService } from "@dg/contract/scholarly.ts";
import type { NotifyDraft } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { iriOf } from "./jsonld.ts";
import { baseOf } from "./process.ts";

/**
 * COAR Notify: how a unit tells a paper's repository that it exists. The
 * notification is built here and shown to the person before anything is sent;
 * sending happens only on their click, to the inbox the paper's own landing
 * page advertises.
 */

const CONTEXT = ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"];

const TYPES: Record<NotifyPattern, string[]> = {
  "announce-endorsement": ["Announce", "coar-notify:EndorsementAction"],
  "announce-review": ["Announce", "coar-notify:ReviewAction"],
  "announce-relationship": ["Announce", "coar-notify:RelationshipAction"],
  "request-endorsement": ["Offer", "coar-notify:EndorsementAction"],
  "request-review": ["Offer", "coar-notify:ReviewAction"],
};

/** How a unit relates to the paper it was read from, in a vocabulary a repository can act on. */
export const RELATIONSHIPS = {
  readFrom: "http://www.w3.org/ns/prov#wasDerivedFrom",
  supports: "http://purl.org/spar/cito/supports",
  opposes: "http://purl.org/spar/cito/disputes",
  discusses: "http://purl.org/spar/cito/discusses",
} as const;

export type NotifyInput = {
  pattern: NotifyPattern;
  /** A `urn:uuid:` id. Made fresh when absent. */
  id?: string;
  actor: { id: string; name: string };
  origin: NotifyService;
  target: NotifyService;
  /** The work the notification concerns, such as the paper: its page and the DOI to cite it by. */
  about: { id: string; citeAs?: string };
  /** What is announced or offered: the unit, review or endorsement, at an address that resolves. */
  object: { id: string; citeAs?: string; types?: string[] };
  /** For `announce-relationship`: how the object relates to `about`. */
  relationship?: string;
  /** The notification this one answers. */
  inReplyTo?: string;
};

const DOCUMENT_TYPES: Record<string, string[]> = {
  "announce-endorsement": ["Page", "sorg:WebPage"],
  "announce-review": ["Page", "sorg:Review"],
};

export const buildNotification = (input: NotifyInput): Notification => {
  const { pattern, actor, origin, target, about, object } = input;
  const context = { id: about.id, ...(about.citeAs ? { "ietf:cite-as": about.citeAs } : {}), type: ["Page", "sorg:AboutPage"] };
  const service = ({ id, inbox }: NotifyService) => ({ id, inbox, type: "Service" });
  const announced =
    pattern === "announce-relationship"
      ? {
          id: `urn:uuid:${uuidv7()}`,
          type: "Relationship",
          "as:subject": object.id,
          "as:relationship": input.relationship ?? RELATIONSHIPS.discusses,
          "as:object": about.citeAs ?? about.id,
        }
      : pattern.startsWith("request")
        ? { id: about.id, ...(about.citeAs ? { "ietf:cite-as": about.citeAs } : {}), type: ["Page", "sorg:AboutPage"] }
        : { id: object.id, ...(object.citeAs ? { "ietf:cite-as": object.citeAs } : {}), type: object.types ?? DOCUMENT_TYPES[pattern] ?? ["Page"] };
  return {
    "@context": CONTEXT,
    id: input.id ?? `urn:uuid:${uuidv7()}`,
    type: TYPES[pattern],
    actor: { id: actor.id, type: "Person", name: actor.name },
    origin: service(origin),
    target: service(target),
    object: announced,
    // A request is about the work itself, so the work is the object and needs no separate context.
    ...(pattern.startsWith("request") ? {} : { context }),
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
  };
};

export const notifyFeature = (context: Context) => {
  /** A unit read from a paper announces itself to that paper. What it argues decides how it says it relates. */
  const draft = async (node: NodeRecord): Promise<NotifyDraft> => {
    const graph = context.graph();
    const view = context.summarize(node);
    const paper = context.documents("paper").find((item) => item.id === view.card.source?.paper);
    if (!paper?.doi) return { ready: false, why: "Only a unit read from a paper with a DOI can be announced to that paper's repository." };
    const inbox = paper.standing?.inbox;
    if (!inbox) return { ready: false, why: paper.standing ? "This paper's page doesn't say where it takes announcements." : "Look the paper up first, to find where its page takes announcements." };
    const link = context.services ? await context.services.link() : null;
    if (!link) return { ready: false, why: "Join a lab first. Its server is where replies to an announcement arrive." };
    const server = link.server.replace(/\/+$/, "");
    const base = baseOf(graph, node);
    const doi = `https://doi.org/${paper.doi}`;
    const me = context.me();
    const notification = buildNotification({
      pattern: "announce-relationship",
      actor: { id: me.id, name: me.name },
      origin: { id: server, inbox: `${server}/v1/notify/inbox` },
      target: { id: new URL(inbox).origin, inbox },
      about: { id: paper.url ?? doi, citeAs: doi },
      object: { id: iriOf(graph, node.id) },
      relationship: base === "claim" || base === "evidence" || base === "question" ? RELATIONSHIPS.readFrom : RELATIONSHIPS.discusses,
    });
    return { ready: true, inbox, paper: paper.title, notification };
  };

  const handlers: Pick<Handlers, "notify.draft" | "notify.send" | "notify.about"> = {
    "notify.draft": async ({ unit }) => {
      const node = context.nodeOf(unit);
      if (!node) throw new Error(`No node ${unit}`);
      return draft(node);
    },
    "notify.send": async ({ unit, id }) => {
      const node = context.nodeOf(unit);
      if (!node || !context.services) throw new Error("There is nothing to send, or no network to send it on.");
      const made = await draft(node);
      if (!made.ready) throw new Error(made.why);
      // The person saw one notification; that one is sent, under the id they saw.
      const notification = { ...made.notification, id };
      const sent = await context.services.sendNotification({ inbox: made.inbox, notification });
      return { ...sent, inbox: made.inbox };
    },
    "notify.about": async ({ unit }) => {
      const node = context.nodeOf(unit);
      const link = context.services ? await context.services.link() : null;
      if (!node || !link || !context.services) return [];
      const view = context.summarize(node);
      const paper = context.documents("paper").find((item) => item.id === view.card.source?.paper);
      const asked = [paper?.doi ? `https://doi.org/${paper.doi}` : undefined, iriOf(context.graph(), node.id)].filter((item): item is string => Boolean(item));
      const found = await Promise.all(asked.map((about) => context.services!.notifications({ server: link.server, about }).catch(() => [])));
      const seen = new Set<string>();
      return found.flat().filter(({ id }) => !seen.has(id) && seen.add(id));
    },
  };
  return { handlers };
};
