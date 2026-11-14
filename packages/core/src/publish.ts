import { cidOf } from "@dg/contract/atproto.ts";
import { WRITES_PER_COMMIT, SANDBOX, planPublication, type PublishWrite } from "@dg/contract/publish.ts";
import { liveCanvasItems, type DgId } from "@dg/contract/records.ts";
import type { RepoSession, RepoWrite } from "@dg/contract/services.ts";
import type { PublishAccount, Published, PublishPreview, PublishRow, PublishSent } from "@dg/contract/surface.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { Context, Handlers } from "./context.ts";
import { refuse } from "./refuse.ts";

/**
 * Publishing to a person's own repository on the AT Protocol network.
 *
 * Nothing leaves without `publish.send`, which a panel calls only on a person's click after showing
 * them `publish.preview`. A person publishes what they wrote and nothing else. What was sent is
 * remembered on this device as receipts: the unit's id, where it is now, and the CID the repository
 * gave it. The password is used once to open a session; the session's refresh token is what is kept,
 * in the base's secret store.
 */

const ACCOUNT_KEY = "publish-account";
const RECEIPTS_KEY = "publish-receipts";
const SESSION_SECRET = "at-session";

type Account = { handle: string; did: string; host: string };
/** `sent` is the CID of the value as it was sent, to tell a changed unit from one that is the same. */
type Receipt = { uri: string; cid: string; at: string; collection: string; rkey: string; sent: string };

export const publishFeature = (context: Context, { secrets }: { secrets?: SecretStore } = {}) => {
  const account = async (): Promise<Account | undefined> => ((await context.getLocal(ACCOUNT_KEY)) as Account | null) ?? undefined;
  const receipts = async (): Promise<Record<DgId, Receipt>> => ((await context.getLocal(RECEIPTS_KEY)) as Record<DgId, Receipt> | null) ?? {};
  const view = async (): Promise<PublishAccount> => {
    const connected = await account();
    return { ...(connected ? { connected } : {}), canConnect: Boolean(secrets && context.services), names: SANDBOX };
  };
  const titleOf = (id: DgId): string => {
    const node = context.nodeOf(id);
    if (node) return node.title;
    const relation = context.graph().relations.get(id)?.record;
    return relation ? `${context.nodeOf(relation.source)?.title ?? "A unit"} → ${context.nodeOf(relation.target)?.title ?? "a unit"}` : "Something removed";
  };

  /** A session that works now: the kept one renewed, since access tokens last minutes. */
  const session = async (): Promise<{ account: Account; live: RepoSession }> => {
    const connected = await account();
    const refresh = await secrets?.get(SESSION_SECRET);
    if (!connected || !refresh || !context.services) throw refuse("no-target", "Connect an account to publish to first.");
    const live = await context.services.repo.renew({ host: connected.host, refresh });
    await secrets!.set(SESSION_SECRET, live.refresh);
    return { account: connected, live };
  };

  /** A canvas's units, and the relations among them that this person drew. */
  const idsOn = (canvas: DgId): DgId[] => {
    const graph = context.graph();
    const held = graph.documents.get(canvas);
    if (!held || held.kind !== "canvas" || held.removed) throw refuse("not-found", "That canvas isn't here.");
    const units = new Set<DgId>();
    for (const { item } of liveCanvasItems({ graph, canvas })) if ("dg" in item && item.dg && "node" in item.dg && item.dg.node) units.add(item.dg.node);
    const relations = [...graph.relations.values()].filter(({ record, state }) => state === "active" && units.has(record.source) && units.has(record.target)).map(({ record }) => record.id);
    return [...units, ...relations];
  };

  const plan = async (canvas: DgId, repo: string) => {
    const kept = await receipts();
    const made = planPublication({ graph: context.graph(), ids: idsOn(canvas), me: context.me().id, repo, published: new Map(Object.entries(kept).map(([id, receipt]) => [id as DgId, receipt.uri])) });
    const rows: (PublishRow & { write: PublishWrite; sent: string })[] = await Promise.all(
      made.writes.map(async (write) => {
        const sent = await cidOf(write.value);
        const before = kept[write.id];
        return { id: write.id, title: titleOf(write.id), kind: context.nodeOf(write.id) ? ("unit" as const) : ("relation" as const), collection: write.collection, state: !before ? ("new" as const) : before.sent === sent ? ("same" as const) : ("changed" as const), write, sent };
      }),
    );
    return { made, rows, kept };
  };

  const listed = async (): Promise<Published[]> =>
    Object.entries(await receipts())
      .map(([id, receipt]) => ({ id: id as DgId, title: titleOf(id as DgId), uri: receipt.uri, cid: receipt.cid, at: receipt.at }))
      .sort((a, b) => (a.at < b.at ? 1 : -1));

  const handlers: Pick<Handlers, "publish.account" | "publish.connect" | "publish.disconnect" | "publish.preview" | "publish.send" | "publish.list" | "publish.withdraw"> = {
    "publish.account": view,
    "publish.connect": async ({ handle, password, host }) => {
      if (!secrets) throw refuse("unavailable", "This base has nowhere to keep a sign-in.");
      if (!context.services) throw refuse("unavailable", "Publishing needs the network, and this base has none set up.");
      const name = handle.trim().replace(/^@/, "");
      if (!name || !password) throw new Error("Give the account's handle and an app password.");
      const where = host?.trim() || (await context.services.repo.find({ handle: name })).host;
      const live = await context.services.repo.open({ host: where, identifier: name, password });
      await secrets.set(SESSION_SECRET, live.refresh);
      const before = await account();
      // Receipts are for one repository. Another account starts with none.
      if (before && before.did !== live.did) await context.setLocal(RECEIPTS_KEY, {});
      await context.setLocal(ACCOUNT_KEY, { handle: live.handle || name, did: live.did, host: where } satisfies Account);
      return view();
    },
    "publish.disconnect": async () => {
      await secrets?.set(SESSION_SECRET, null);
      await context.setLocal(ACCOUNT_KEY, null);
      return view();
    },
    "publish.preview": async ({ canvas }): Promise<PublishPreview> => {
      const connected = await account();
      // With no account yet the preview still shows what would go, addressed to this person's own DID.
      const { made, rows } = await plan(canvas, connected?.did ?? context.me().id);
      return {
        ...(connected ? { account: { handle: connected.handle, did: connected.did } } : {}),
        rows: rows.map(({ write: _write, sent: _sent, ...row }) => row),
        leftOut: made.leftOut.map((entry) => ({ ...entry, title: titleOf(entry.id) })),
        fractions: made.fractions,
      };
    },
    "publish.send": async ({ canvas }): Promise<PublishSent> => {
      const { account: connected, live } = await session();
      const { rows, kept } = await plan(canvas, connected.did);
      const going = rows.filter((row) => row.state !== "same");
      const at = new Date().toISOString();
      let commits = 0;
      for (let start = 0; start < going.length; start += WRITES_PER_COMMIT) {
        const batch = going.slice(start, start + WRITES_PER_COMMIT);
        const writes: RepoWrite[] = batch.map(({ write, state }) => ({ action: state === "new" ? "create" : "update", collection: write.collection, rkey: write.rkey, value: write.value }));
        const results = await context.services!.repo.write({ host: connected.host, access: live.access, repo: connected.did, writes });
        commits += 1;
        // Receipts are kept commit by commit, so a later commit that fails leaves a true account of what went.
        batch.forEach(({ write, sent }, index) => {
          kept[write.id] = { uri: results[index]?.uri || `at://${connected.did}/${write.collection}/${write.rkey}`, cid: results[index]?.cid ?? "", at, collection: write.collection, rkey: write.rkey, sent };
        });
        await context.setLocal(RECEIPTS_KEY, kept);
      }
      return { sent: going.length, unchanged: rows.length - going.length, commits, published: await listed() };
    },
    "publish.list": listed,
    "publish.withdraw": async ({ ids }) => {
      const kept = await receipts();
      const going = ids.filter((id) => kept[id]);
      if (going.length === 0) return listed();
      const { account: connected, live } = await session();
      for (let start = 0; start < going.length; start += WRITES_PER_COMMIT) {
        const batch = going.slice(start, start + WRITES_PER_COMMIT);
        await context.services!.repo.write({ host: connected.host, access: live.access, repo: connected.did, writes: batch.map((id) => ({ action: "delete" as const, collection: kept[id]!.collection, rkey: kept[id]!.rkey })) });
        for (const id of batch) delete kept[id];
        await context.setLocal(RECEIPTS_KEY, kept);
      }
      return listed();
    },
  };
  return { handlers };
};
