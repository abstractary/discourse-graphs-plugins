import assert from "node:assert/strict";
import test from "node:test";
import { createServices } from "@dg/sync/client.ts";
import { startLabSync } from "@dg/sync/lab-sync.ts";
import type { LabLink, Services } from "@dg/contract/services.ts";
import type { DgRecord } from "@dg/contract/records.ts";

const memory = () => {
  const held = new Map<string, unknown>();
  return { get: async (key: string) => held.get(key) ?? null, set: async (key: string, value: unknown) => void held.set(key, value) };
};

const answer = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const stream = (lines: unknown[]): Response =>
  new Response(lines.map((line) => JSON.stringify(line)).join("\n"), { headers: { "content-type": "application/x-ndjson" } });

test("a person can add and remove their own compute servers", async () => {
  const services = createServices({ fetch: (async () => answer({})) as typeof fetch, store: memory() });
  assert.deepEqual((await services.servers()).map(({ kind }) => kind), ["local", "managed"]);
  const added = await services.addServer({ name: "Lab box", url: "http://10.0.0.2:8787/", kind: "custom" });
  assert.equal(added.url, "http://10.0.0.2:8787");
  assert.equal((await services.servers()).length, 3);
  await services.removeServer(added.id);
  assert.equal((await services.servers()).length, 2);
});

test("extraction streams status lines and returns the graph", async () => {
  const graph = { nodes: [], edges: [] };
  const services = createServices({
    fetch: (async () => stream([{ type: "status", message: "Reading" }, { type: "ping" }, { type: "result", data: graph }])) as typeof fetch,
    store: memory(),
  });
  const seen: string[] = [];
  const result = await services.extract({ url: "http://x", filename: "a.md", mediaType: "text/markdown", text: "Hi", model: "m", schema: "s", onStatus: (message) => seen.push(message) });
  assert.deepEqual(result, graph);
  assert.deepEqual(seen, ["Reading"]);
});

test("a failed extraction says why", async () => {
  const services = createServices({ fetch: (async () => stream([{ type: "error", message: "Too long" }])) as typeof fetch, store: memory() });
  await assert.rejects(services.extract({ url: "http://x", filename: "a", mediaType: "t", model: "m", schema: "s", onStatus: () => {} }), /Too long/);
});

test("an unreachable server gets a plain message", async () => {
  const services = createServices({ fetch: (async () => { throw new Error("nope"); }) as unknown as typeof fetch, store: memory() });
  await assert.rejects(services.check("http://gone"), /Couldn't reach http:\/\/gone/);
});

test("a server's own error message comes through", async () => {
  const services = createServices({ fetch: (async () => answer({ error: { message: "Wrong lab" } }, 403)) as typeof fetch, store: memory() });
  await assert.rejects(services.findLab({ server: "http://x", id: "y" }), /Wrong lab/);
});

test("the token is sent only with lab calls, and only to the lab's server", async () => {
  const seen: { url: string; auth: string | undefined }[] = [];
  const services = createServices({
    fetch: (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).authorization });
      return answer({ members: [], models: [] });
    }) as unknown as typeof fetch,
    store: memory(),
  });
  const link: LabLink = { server: "http://lab", id: "l", name: "L", token: "secret" };
  await services.members(link);
  await services.models("http://other");
  assert.deepEqual(seen, [
    { url: "http://lab/v1/labs/l/members", auth: "Bearer secret" },
    { url: "http://other/v1/models", auth: undefined },
  ]);
});

test("acceptance turns a pending link into a member's, and a decline clears it", async () => {
  const link: LabLink = { server: "http://lab", id: "l", name: "L", pending: { requestId: "r", secret: "s" } };
  const accepted = createServices({ fetch: (async () => answer({ state: "accepted", token: "t", tokenKind: "team" })) as typeof fetch, store: memory() });
  const done = await accepted.checkRequest(link);
  assert.equal(done.link?.token, "t");
  assert.equal(done.link?.pending, undefined);
  const declined = createServices({ fetch: (async () => answer({ state: "declined" })) as typeof fetch, store: memory() });
  assert.deepEqual(await declined.checkRequest(link), { link: null, state: "declined" });
});

test("a shared file comes back whole, with its name", async () => {
  const bytes = new Uint8Array(100_000).map((_, at) => at % 251);
  const services = createServices({
    fetch: (async () => new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename*=UTF-8''a%20paper.pdf" } })) as unknown as typeof fetch,
    store: memory(),
  });
  const file = await services.paperFile({ server: "http://lab", id: "l", name: "L", token: "t" }, "p");
  assert.equal(file.name, "a paper.pdf");
  assert.equal(file.mediaType, "application/pdf");
  assert.deepEqual(Uint8Array.from(atob(file.dataBase64), (char) => char.charCodeAt(0)), bytes);
});

const record = (id: string, rev = 1): DgRecord => ({ id, rev, kind: "node" }) as unknown as DgRecord;

test("sync sends what's new once, and hands over what arrived", async () => {
  const link: LabLink = { server: "http://lab", id: "l", name: "L", token: "t" };
  const pushed: string[] = [];
  const taken: string[] = [];
  let pulls = 0;
  const services = {
    link: async () => link,
    pushRecords: async (_: LabLink, records: DgRecord[]) => {
      pushed.push(...records.map(({ id }) => id));
    },
    pullRecords: async () => {
      pulls += 1;
      return pulls === 1 ? { records: [record("b")], next: "1", done: true } : { records: [], done: true };
    },
  } as unknown as Services;
  const shareable = [record("a")];
  const sync = startLabSync({ services, target: { shareable: () => shareable, take: async (records) => void taken.push(...records.map(({ id }) => id)) } });
  await sync.now();
  await sync.now();
  shareable.push(record("a", 2));
  await sync.now();
  sync.stop();
  assert.deepEqual(pushed, ["a", "a"], "a new revision goes out, and the same one doesn't");
  assert.deepEqual(taken, ["b"]);
});

test("sync does nothing without a lab token", async () => {
  let touched = false;
  const services = { link: async () => null, pushRecords: async () => { touched = true; } } as unknown as Services;
  const sync = startLabSync({ services, target: { shareable: () => [record("a")], take: async () => {} } });
  await sync.now();
  sync.stop();
  assert.equal(touched, false);
});

test("a failed round doesn't stop the next one", async () => {
  const link: LabLink = { server: "http://lab", id: "l", name: "L", token: "t" };
  let tries = 0;
  const errors: unknown[] = [];
  const services = {
    link: async () => link,
    pushRecords: async () => {},
    pullRecords: async () => {
      tries += 1;
      if (tries === 1) throw new Error("offline");
      return { records: [], done: true };
    },
  } as unknown as Services;
  const sync = startLabSync({ services, target: { shareable: () => [], take: async () => {} }, onError: (error) => errors.push(error) });
  await sync.now();
  await sync.now();
  sync.stop();
  assert.equal(tries, 2);
  assert.equal(errors.length, 1);
});
