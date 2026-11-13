import type { DgRecord } from "@dg/contract/records.ts";
import { liveCanvasItems, revise, staysLocal } from "@dg/contract/records.ts";
import type { LabLink } from "@dg/contract/services.ts";
import type { BreadcrumbDefault, IdentityView, LabView } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

const BREADCRUMB_KEY = "breadcrumb-default";

export const labFeature = (
  context: Context,
  {
    identity,
    createLabRecord,
    joinLab,
    askBreadcrumb,
  }: {
    identity: () => IdentityView;
    createLabRecord: (name: string) => Promise<IdentityView>;
    joinLab: (name?: string) => Promise<IdentityView>;
    /** Shown in the base, because the panel that was open has just closed. */
    askBreadcrumb?: (paper: { id: string; title: string }) => void;
  },
): Pick<Handlers, "lab.view" | "lab.find" | "lab.register" | "lab.requestJoin" | "lab.check" | "lab.decide" | "lab.setBreadcrumbs" | "paper.getFile" | "canvas.share" | "canvas.audience"> & {
  shareable: () => DgRecord[];
  take: (records: DgRecord[]) => Promise<void>;
  canvasClosed: (args: { id: string }) => Promise<void>;
  answerBreadcrumb: (args: { paper: string; leave: boolean; remember?: boolean }) => Promise<void>;
} => {
  const services = (): NonNullable<Context["services"]> => {
    if (!context.services) throw new Error("No services are set up here.");
    return context.services;
  };
  const me = () => ({ did: context.me().id, name: context.me().name });

  const breadcrumbs = async (): Promise<BreadcrumbDefault> =>
    ((await context.getLocal(BREADCRUMB_KEY)) as BreadcrumbDefault | null) ?? "ask";

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
    return {
      link,
      identity: identity(),
      members: member ? await safely(() => services().members(link!), []) : [],
      requests: member && link!.role === "admin" ? await safely(() => services().requests(link!), []) : [],
      papers: member ? await safely(() => services().labPapers(link!), []) : [],
      breadcrumbs: await breadcrumbs(),
    };
  };

  /** Everything on the lab's shared canvases, and what it needs to make sense. */
  const shareable = (): DgRecord[] => {
    const lab = context.myLab();
    if (!lab) return [];
    const canvases = context.documents("canvas").filter((canvas) => canvas.shared === lab.did && !canvas.removed);
    if (canvases.length === 0) return [lab, ...context.documents("person"), ...context.documents("membership")];
    const items = canvases.flatMap(({ id }) => liveCanvasItems({ graph: context.graph(), canvas: id }));
    const units = new Set<string>();
    const relations = new Set<string>();
    for (const { item } of items) {
      const dg = (item as { dg?: { node?: string; relation?: string } }).dg;
      if (dg?.node) units.add(dg.node);
      if (dg?.relation) relations.add(dg.relation);
    }
    const records: DgRecord[] = [
      lab,
      ...context.documents("person"),
      ...context.documents("membership"),
      ...context.documents("node-type"),
      ...context.documents("relation-type"),
      ...canvases,
      ...items,
      ...[...units].flatMap((id) => {
        const node = context.nodeOf(id);
        return node ? [node] : [];
      }),
      ...[...context.graph().relations.values()].flatMap(({ record }) => (relations.has(record.id) ? [record] : [])),
      ...context.documents("paper").filter((paper) => canvases.some(({ id }) => id === paper.canvas)),
      ...context.documents("reaction").filter((reaction) => units.has(reaction.unit)),
      ...context.documents("unit-note").filter((note) => units.has(note.unit)),
    ];
    return records.filter((record) => !staysLocal(record));
  };

  // Through the same door as local work, so what arrives shows up at once.
  const take = async (records: DgRecord[]): Promise<void> => {
    await context.put(records);
    if (context.myLab()) return;
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

  return {
    shareable,
    take,
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
        await joinLab(next.name);
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
};
