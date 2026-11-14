import type { DgRecord, LabSettings, NodeRecord } from "@dg/contract/records.ts";
import { clock, revise, staysLocal } from "@dg/contract/records.ts";
import type { LabLink } from "@dg/contract/services.ts";
import type { BreadcrumbDefault, IdentityView, LabView } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { checkSignatures, signerOf } from "./signing.ts";

const BREADCRUMB_KEY = "breadcrumb-default";

export const labFeature = (
  context: Context,
  {
    identity,
    createLabRecord,
    joinLab,
    adoptLabGrammar,
    trusted,
    askBreadcrumb,
  }: {
    /** Whether labmates will take what this device signs. */
    trusted: () => Promise<boolean>;
    /** Gives way to the lab's types, once they are here. */
    adoptLabGrammar: () => Promise<void>;
    identity: () => IdentityView;
    createLabRecord: (name: string) => Promise<IdentityView>;
    joinLab: (name?: string) => Promise<IdentityView>;
    /** Shown in the base, because the panel that was open has just closed. */
    askBreadcrumb?: (paper: { id: string; title: string }) => void;
  },
) => {
  const services = (): NonNullable<Context["services"]> => {
    if (!context.services) throw new Error("No services are set up here.");
    return context.services;
  };
  const me = () => ({ did: context.me().id, name: context.me().name });

  const breadcrumbs = async (): Promise<BreadcrumbDefault> =>
    ((await context.getLocal(BREADCRUMB_KEY)) as BreadcrumbDefault | null) ?? "ask";

  let refused = 0;
  const refusedBy = new Map<string, number>();
  // Records from a labmate whose own record hasn't arrived. Checked again with each batch.
  let held: DgRecord[] = [];
  // Set before each exchange. A device nobody has vouched for sends nothing, so nothing of its is refused and lost.
  let sharing = true;

  /** This person's own membership ends, on their device. Their work stays. */
  const leave = async (): Promise<void> => {
    const mine = context.documents("membership").find((item) => item.member === context.me().id && !item.removed);
    if (mine) await context.put([revise({ record: mine, changes: { removed: true }, by: context.me() })]);
    await adoptLabGrammar();
  };

  /** An invitation is one line: the server, the lab and the code. */
  const INVITE = /^(https?:\/\/[^\s#]+)\/join\/([^\s#/]+)#(\S+)$/;

  const view = async (): Promise<LabView> => {
    const link = context.services ? await context.services.link() : null;
    const member = Boolean(link?.token);
    const safely = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await work();
      } catch {
        return fallback;
      }
    };
    const members = member ? await safely(() => services().members(link!), []) : [];
    // Asking for the members is also how a removed person's device finds out. Read the link again after it.
    const now = context.services ? await context.services.link() : null;
    const still = Boolean(now?.token);
    const lab = context.myLab();
    const admin = still && now!.role === "admin";
    const removedFrom = context.services ? await safely(() => services().removedFrom(), null) : null;
    if (removedFrom && lab) await leave();
    return {
      link: now,
      identity: identity(),
      members: still ? members : [],
      requests: admin ? await safely(() => services().requests(now!), []) : [],
      papers: still ? await safely(() => services().labPapers(now!), []) : [],
      breadcrumbs: await breadcrumbs(),
      settings: context.myLab()?.settings ?? {},
      custodian: Boolean(lab && lab.custodian === context.me().id),
      invites: admin ? await safely(() => services().invites(now!), []) : [],
      refused,
      refusedFrom: [...refusedBy].map(([did, count]) => ({ name: context.documents("person").find((person) => person.did === did)?.name ?? "Someone", count })),
      deviceTrusted: await trusted(),
      ...(Math.abs(clock.offsetMs) > 2000 ? { clockOffMs: clock.offsetMs } : {}),
      ...(removedFrom ? { removedFrom } : {}),
    };
  };

  /**
   * Everything on the lab's shared canvases, and what it needs to make sense.
   *
   * What was taken away travels too: a card taken off, a unit its author removed, a canvas its
   * owner removed, a relation withdrawn. Without those, a labmate keeps seeing what is gone.
   *
   * A unit goes while it has a card on a shared canvas. Once its card is taken off, its later
   * versions stay on this device, with one exception: if its author removes the unit, that
   * removal goes, so nobody is left holding a unit that no longer exists.
   */
  const shareable = (): DgRecord[] => {
    const lab = context.myLab();
    if (!lab || !sharing) return [];
    // Who is in, and which devices sign for them, with every version: a removal has to be seen to follow what it ended.
    const mine = (): DgRecord[] => [lab, ...context.documents("person"), ...context.records().filter((record) => record.kind === "membership" || (record.kind === "device" && Boolean(record.vouch || record.removed)))];
    const canvases = context.documents("canvas").filter((canvas) => canvas.shared === lab.did);
    if (canvases.length === 0) return mine();
    const open = new Set(canvases.filter((canvas) => !canvas.removed).map(({ id }) => id));
    const held = new Set(canvases.map(({ id }) => id));
    const items = context.documents("canvas-item").filter((item) => held.has(item.canvas));
    const units = new Set<string>();
    const gone = new Set<string>();
    const relations = new Set<string>();
    for (const record of items) {
      const dg = (record.item as { dg?: { node?: string; relation?: string } }).dg;
      const live = !record.removed && open.has(record.canvas);
      if (dg?.node) (live ? units : gone).add(dg.node);
      if (dg?.relation) relations.add(dg.relation);
    }
    // Read from the graph itself, because the usual lookup leaves out what was removed.
    const unitOf = (id: string): NodeRecord | undefined => {
      const record = context.graph().documents.get(id);
      return record?.kind === "node" ? record : undefined;
    };
    for (const id of gone) if (!units.has(id) && unitOf(id)?.removed) units.add(id);
    // What a shared unit was read from says what it is evidence of, so its source goes with it.
    for (const id of [...units]) {
      const node = unitOf(id);
      for (const source of [node?.prov?.sourceDocument, node?.facts?.anchor?.source]) {
        if (source && unitOf(source)) units.add(source);
      }
    }
    const shared = new Set<string>([...units, ...relations]);
    const records: DgRecord[] = [
      ...mine(),
      ...context.documents("node-type"),
      ...context.documents("relation-type"),
      ...canvases,
      // Every version of each card, not only the one that stands, so each device can tell a change
      // made after a removal from one made apart from it.
      ...context.records().filter((record) => record.kind === "canvas-item" && held.has(record.canvas)),
      ...[...units].flatMap((id) => {
        const node = unitOf(id);
        return node ? [node] : [];
      }),
      ...[...context.graph().relations.values()].flatMap(({ record }) => (relations.has(record.id) ? [record] : [])),
      ...context.records().filter((record) => record.kind === "retraction" && shared.has(record.target)),
      ...context.documents("paper").filter((paper) => open.has(paper.canvas)),
      ...context.documents("reaction").filter((reaction) => units.has(reaction.unit)),
      ...context.documents("unit-note").filter((note) => units.has(note.unit)),
      // A check is made to be seen: it says who stands behind a unit the lab shares.
      ...context.documents("evaluation").filter((check) => units.has(check.target)),
    ];
    // Nothing an agent signed is sent. What a person accepted from one is a record of their own.
    const agents = new Set(context.documents("device").filter((device) => device.role === "agent").map((device) => device.key));
    return records.filter((record) => !staysLocal(record) && !(record.sigBy !== undefined && agents.has(record.sigBy) && record.kind !== "device"));
  };

  /**
   * What this person wrote before records were signed is signed now, so labmates will take it.
   * The signed copy stands in place of the unsigned one.
   */
  const prepare = async (): Promise<void> => {
    sharing = await trusted();
    if (!sharing) return;
    const me = context.me().id;
    const bare = shareable().filter((record) => !record.sig && signerOf(record) === me);
    if (bare.length > 0) await context.put(bare);
  };

  // Through the same door as local work, so what arrives shows up at once.
  const take = async (records: DgRecord[]): Promise<void> => {
    // A record that says a labmate wrote it has to carry that labmate's signature.
    const lab = context.myLab();
    const members = new Set(context.documents("membership").filter((item) => !lab || item.lab === lab.did).map((item) => item.member));
    for (const record of records) if (record.kind === "membership") members.add(record.member);
    const waiting = held;
    held = [];
    const checked = await checkSignatures([...waiting, ...records], { persons: context.documents("person"), devices: context.documents("device"), members });
    held = checked.held.slice(-5000);
    refused += checked.refused.length;
    for (const record of checked.refused) refusedBy.set(signerOf(record), (refusedBy.get(signerOf(record)) ?? 0) + 1);
    await context.put(checked.kept);
    if (context.myLab()) {
      await adoptLabGrammar();
      return;
    }
    // A person can be accepted before the lab's own record has reached them.
    const link = await services().link();
    if (link?.token) await joinLab(link.name).catch(() => {});
  };

  const pullOnce = async (link: LabLink): Promise<void> => {
    let after: string | undefined;
    for (;;) {
      const page = await services().pullRecords(link, after);
      if (page.records.length > 0) await take(page.records);
      after = page.next ?? after;
      if (page.done) break;
    }
  };

  const all: Pick<Handlers, "lab.view" | "lab.find" | "lab.register" | "lab.requestJoin" | "lab.check" | "lab.decide" | "lab.setBreadcrumbs" | "lab.acknowledge" | "lab.invite" | "lab.revokeInvite" | "lab.acceptInvite" | "lab.remove" | "lab.configure" | "paper.getFile" | "canvas.share" | "canvas.audience"> & {
  shareable: () => DgRecord[];
  take: (records: DgRecord[]) => Promise<void>;
  prepare: () => Promise<void>;
  canvasClosed: (args: { id: string }) => Promise<void>;
  answerBreadcrumb: (args: { paper: string; leave: boolean; remember?: boolean }) => Promise<void>;
} = {
    shareable,
    take,
    prepare,
    "lab.view": view,
    "lab.find": ({ server, id }) => services().findLab({ server, id }),
    "lab.register": async ({ server, name }) => {
      await createLabRecord(name);
      const lab = context.myLab();
      if (!lab) throw new Error("The lab wasn't made.");
      await services().saveLink(await services().createLab({ server, name, person: me(), labDid: lab.did }));
      return view();
    },
    "lab.requestJoin": async ({ server, id }) => {
      await services().saveLink(await services().requestToJoin({ server, id, person: me() }));
      return view();
    },
    "lab.check": async () => {
      const link = await services().link();
      if (!link?.pending) return view();
      const { link: next, state } = await services().checkRequest(link);
      await services().saveLink(next);
      if (state === "accepted" && next) {
        await pullOnce(next);
        // The PI may have accepted before their own device sent the lab's record. It is joined when that arrives.
        await joinLab(next.name).catch(() => {});
      }
      return view();
    },
    "lab.decide": async ({ requestId, decision, tokenKind }) => {
      const link = await services().link();
      if (!link) throw new Error("You're not in a lab.");
      await services().decide(link, { requestId, decision, ...(tokenKind ? { tokenKind } : {}) });
      return view();
    },
    "lab.setBreadcrumbs": async ({ value }) => {
      await context.setLocal(BREADCRUMB_KEY, value);
      return view();
    },
    "lab.acknowledge": async () => {
      // Seen first, so the shared work is put away before the notice goes.
      const seen = await view();
      await services().forgetRemoved();
      const { removedFrom: _gone, ...rest } = seen;
      return rest;
    },
    "lab.invite": async ({ uses, days }) => {
      const link = await services().link();
      if (!link?.token) throw new Error("Start or join a lab first.");
      if (link.role !== "admin") throw new Error("Only the lab's PI can invite people.");
      const made = await services().invite(link, { ...(uses ? { uses } : {}), ...(days ? { days } : {}) });
      return { invite: `${link.server}/join/${link.id}#${made.code}`, expiresAt: made.expiresAt, usesLeft: made.usesLeft };
    },
    "lab.revokeInvite": async ({ id }) => {
      const link = await services().link();
      if (link?.token) await services().revokeInvite(link, id);
      return view();
    },
    "lab.acceptInvite": async ({ invite }) => {
      const parts = INVITE.exec(invite.trim());
      if (!parts) throw new Error("That doesn't look like an invitation. Paste the whole line the PI sent.");
      const [, server, id, code] = parts as unknown as [string, string, string, string];
      const link = await services().acceptInvite({ server, id, code, person: me() });
      await services().saveLink(link);
      await pullOnce(link);
      // The lab's own record may not have been sent yet. It is joined when that arrives.
      await joinLab(link.name).catch(() => {});
      return view();
    },
    "lab.remove": async ({ did }) => {
      const link = await services().link();
      const lab = context.myLab();
      if (!link?.token || !lab) throw new Error("You're not in a lab.");
      if (lab.custodian !== context.me().id) throw new Error("Only the lab's PI can remove a member.");
      await services().removeMember(link, did);
      // Said in the lab's own records too, so every member's copy agrees on who is in.
      const membership = context.documents("membership").find((item) => item.member === did && item.lab === lab.did && !item.removed);
      if (membership) await context.put([revise({ record: membership, changes: { removed: true }, by: context.me() })]);
      return view();
    },
    "lab.configure": async (changes) => {
      const lab = context.myLab();
      if (!lab) throw new Error("You're not in a lab.");
      if (lab.custodian !== context.me().id) throw new Error("Only the lab's PI can change what the lab sets for everyone.");
      const next: Record<string, unknown> = { ...(lab.settings ?? {}) };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
      }
      await context.put([revise({ record: lab, changes: { settings: next as LabSettings }, by: context.me() })]);
      return view();
    },
    "paper.getFile": async ({ id }) => {
      const link = await services().link();
      if (!link?.token) throw new Error("Join a lab first.");
      const saved = await context.host.saveFile(await services().paperFile(link, id));
      if (!saved.ok) throw new Error(saved.error.message);
      return saved.value;
    },
    "canvas.audience": async ({ id }) => {
      const canvas = context.canvasOf(id);
      if (!canvas) throw new Error("That canvas is gone.");
      const lab = context.myLab();
      const link = context.services ? await context.services.link().catch(() => null) : null;
      const members = lab && link?.token ? await services().members(link).then((list) => list.map((member) => member.name)).catch(() => []) : [];
      const me = context.me();
      return {
        workspace: canvas.shared && lab?.did === canvas.shared ? { kind: "lab" as const, id: lab.did, name: lab.name } : { kind: "own" as const, id: me.id, name: "Your workspace" },
        ...(lab ? { lab: { name: lab.name, members } } : {}),
      };
    },
    "canvas.share": async ({ id }) => {
      const lab = context.myLab();
      const canvas = context.canvasOf(id);
      if (!lab) throw new Error("Join a lab first.");
      if (canvas) await context.put([revise({ record: canvas, changes: { shared: lab.did }, by: context.me() })]);
      return null;
    },
    canvasClosed: async ({ id }) => {
      const canvas = context.canvasOf(id);
      const paper = canvas?.paper ? context.documents("paper").find((item) => item.id === canvas.paper) : undefined;
      if (!paper?.labPaper) return;
      // The repository already says who uploaded it.
      if (paper.uploadedBy?.id === context.me().id) return;
      const choice = await breadcrumbs();
      if (choice === "never") return;
      if (choice === "ask") {
        askBreadcrumb?.({ id: paper.labPaper, title: paper.title });
        return;
      }
      const link = await services().link();
      if (link?.token) await services().leaveBreadcrumb(link, { paper: paper.labPaper, person: me() });
    },
    answerBreadcrumb: async ({ paper, leave, remember }) => {
      const link = await services().link();
      if (leave && link?.token) await services().leaveBreadcrumb(link, { paper, person: me() });
      if (remember) await context.setLocal(BREADCRUMB_KEY, leave ? "always" : "never");
    },
  };
  const { shareable: _shareable, take: _take, prepare: _prepare, canvasClosed, answerBreadcrumb, ...handlers } = all;
  return { handlers, shareable, take, prepare, canvasClosed, answerBreadcrumb };
};
