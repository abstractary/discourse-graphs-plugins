import assert from "node:assert/strict";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { AiError, citedIds, quoteAnswer, type AiCall, type Llm, type SecretStore } from "@dg/contract/llm.ts";
import type { LabLink, Services } from "@dg/contract/services.ts";
import type { SurfaceEvent, SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { createLlm } from "@dg/sync/providers.ts";

const KEY = "sk-ant-test-0123456789-WXYZ";
const LINK: LabLink = { server: "http://lab", id: "lab-1", name: "Lab", token: "t", role: "member" };

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const memorySecrets = (): SecretStore & { held: Map<string, string> } => {
  const held = new Map<string, string>();
  return {
    kind: "keychain",
    held,
    get: async (id) => held.get(id) ?? null,
    set: async (id, value) => void (value ? held.set(id, value) : held.delete(id)),
  };
};

const setup = async ({ llm, link = null }: { llm?: Llm; link?: LabLink | null } = {}) => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const secrets = memorySecrets();
  const asked: { provider?: AiCall; units: number; grounded?: string[] }[] = [];
  const services = {
    link: async () => link,
    check: async () => ({ name: "Lab", kind: "local" as const, version: "0", ai: { mode: "model" as const, model: "lab-model" } }),
    ask: async ({ units, grounded, provider, onDelta }: Parameters<Services["ask"]>[0]) => {
      asked.push({ units: units.length, ...(grounded ? { grounded } : {}), ...(provider ? { provider } : {}) });
      onDelta("From the lab.");
      return { answer: "From the lab.", citations: [], mode: "model" as const, model: provider?.model ?? "lab-model" };
    },
  } as unknown as Services;
  const core = await createCore({ host, services, secrets, ...(llm ? { llm } : {}) });
  const pending = new Map<string, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  const events: SurfaceEvent[] = [];
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("event" in message) events.push(message as SurfaceEvent);
      if ("id" in message) {
        const waiting = pending.get(message.id);
        const reply = message as { ok?: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok === false) waiting?.reject(new Error(reply.error?.message));
        else waiting?.resolve(reply.result as never);
      }
    },
    onMessage: (handler) => {
      listener = handler;
      return () => {};
    },
  };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      next += 1;
      pending.set(`m${next}`, { resolve: resolve as never, reject });
      listener({ id: `m${next}`, method, params } as SurfaceMessage);
    });
  const canvas = await call("canvas.create", { title: "Markers" });
  const claim = await call("node.create", { title: "Anti-dsDNA antibodies predict nephritis" });
  const other = await call("node.create", { title: "Vitamin D has no known effect" });
  await call("canvas.placeUnits", {
    canvas: canvas.id,
    places: [
      { node: claim.id, x: 0, y: 0, width: 240, height: 80 },
      { node: other.id, x: 0, y: 200, width: 240, height: 80 },
    ],
  });
  return { call, events, secrets, store, asked, canvas: canvas.id, claim: claim.id, other: other.id };
};

const fakeLlm = (words: string[], seen: (AiCall & { prompt: string })[] = []): Llm => ({
  async *stream({ signal, system: _system, ...call }) {
    seen.push(call);
    for (const word of words) {
      if (signal?.aborted) throw new AiError("stopped", "Stopped.");
      yield word;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  },
  models: async () => [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }],
});

test("with no key and no lab, asking quotes the closest units and writes nothing of its own", async () => {
  const { call, canvas, claim } = await setup({ llm: fakeLlm([]) });
  const status = await call("ai.status", {});
  assert.deepEqual([status.mode, status.source, status.canSetUp], ["search-only", "none", true]);
  const answer = await call("ai.ask", { canvas, question: "What predicts nephritis?", requestId: "q" });
  assert.equal(answer.mode, "search-only");
  assert.deepEqual(answer.citations, [claim]);
  assert.match(answer.answer, /No model is connected/);
});

test("a saved key answers from this device, and the key never reaches a panel or the vault's store", async () => {
  const seen: (AiCall & { prompt: string })[] = [];
  const { call, events, secrets, store, canvas, claim, other } = await setup({ llm: fakeLlm(["Yes ", "[CLAIM]."], seen) });
  const saved = await call("ai.configure", { provider: "anthropic", model: "claude-opus-5-5", key: `  ${KEY} ` });
  assert.deepEqual([saved.source, saved.hasKey, saved.keyHint, saved.keptIn, saved.route], ["own", true, "WXYZ", "keychain", "device"]);
  assert.equal(secrets.held.get("discourse-graphs-ai-anthropic"), KEY);
  assert.ok(!JSON.stringify(saved).includes(KEY));
  assert.ok(!JSON.stringify([...store.local.entries()]).includes(KEY), "the key is not in the base's own settings store");
  assert.ok(!JSON.stringify(events).includes(KEY));
  assert.ok(events.some((event) => event.event === "ai-changed"));

  const status = await call("ai.status", {});
  assert.deepEqual([status.mode, status.model, status.source, status.provider, status.route], ["model", "claude-opus-5-5", "own", "anthropic", "device"]);

  const answer = await call("ai.ask", { canvas, question: "Does it?", grounded: [claim], requestId: "q1" });
  assert.equal(answer.source, "own");
  assert.equal(answer.model, "claude-opus-5-5");
  assert.equal(seen[0]!.key, KEY);
  assert.ok(seen[0]!.prompt.includes("Anti-dsDNA"));
  assert.ok(!seen[0]!.prompt.includes("Vitamin D"), "grounding narrows what the model is sent");
  assert.ok(!seen[0]!.prompt.includes(other));
  assert.equal(events.filter((event) => event.event === "ai-delta" && event.requestId === "q1").length, 2);

  const removed = await call("ai.configure", { key: null });
  assert.deepEqual([removed.hasKey, removed.keyHint], [false, undefined]);
  assert.equal(secrets.held.size, 0);
  assert.equal((await call("ai.status", {})).source, "none");
});

test("an answer that is still arriving can be stopped, and what arrived is kept", async () => {
  const { call, canvas } = await setup({ llm: fakeLlm(Array.from({ length: 200 }, (_, index) => `w${index} `)) });
  await call("ai.configure", { key: KEY });
  const asking = call("ai.ask", { canvas, question: "Go on", requestId: "long" });
  await new Promise((resolve) => setTimeout(resolve, 15));
  await call("ai.cancel", { requestId: "long" });
  const answer = await asking;
  assert.equal(answer.stopped, true);
  assert.ok(answer.answer.length > 0 && answer.answer.split(" ").length < 200);
});

test("in a lab, a person chooses the lab's model, their key from this device, or their key through the lab's server", async () => {
  const seen: (AiCall & { prompt: string })[] = [];
  const { call, asked, canvas } = await setup({ llm: fakeLlm(["Mine."], seen), link: LINK });
  assert.equal((await call("ai.status", {})).source, "lab");
  assert.equal((await call("ai.ask", { canvas, question: "?", requestId: "a" })).source, "lab");
  assert.equal(asked[0]!.provider, undefined);

  await call("ai.configure", { key: KEY, model: "claude-haiku-5-5" });
  assert.equal((await call("ai.ask", { canvas, question: "?", requestId: "b" })).answer, "Mine.");
  assert.equal(asked.length, 1, "the device route doesn't touch the lab's server");

  const routed = await call("ai.configure", { route: "lab" });
  assert.equal(routed.route, "lab");
  const through = await call("ai.ask", { canvas, question: "?", requestId: "c" });
  assert.equal(through.source, "own");
  assert.deepEqual(asked[1]!.provider, { provider: "anthropic", model: "claude-haiku-5-5", key: KEY });

  await call("ai.configure", { source: "lab" });
  assert.equal((await call("ai.status", {})).source, "lab");
  assert.equal((await call("ai.settings", {})).hasKey, true, "choosing the lab's model keeps the key for later");
});

test("a model server on this computer needs no key, and a hosted address does", async () => {
  const { call } = await setup({ llm: fakeLlm(["ok"]) });
  await call("ai.configure", { source: "own", provider: "openai", baseUrl: "http://localhost:11434/v1/", model: "qwen3:8b" });
  const local = await call("ai.status", {});
  assert.deepEqual([local.source, local.model], ["own", "qwen3:8b"]);
  assert.equal((await call("ai.settings", {})).baseUrl, "http://localhost:11434/v1");
  await call("ai.configure", { baseUrl: "https://api.openai.com/v1", model: "some-model" });
  assert.equal((await call("ai.status", {})).source, "none");
  await assert.rejects(call("ai.configure", { baseUrl: "ftp://example" }), /http/);
});

// ---------------------------------------------------------------------------
// The wire formats

const sse = (events: unknown[]): string => events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> | null };
const fakeFetch = (reply: (seen: Seen) => Response, seen: Seen[] = []) => ({
  seen,
  fetch: async (url: string, init: RequestInit): Promise<Response> => {
    const record = { url, headers: init.headers as Record<string, string>, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null };
    seen.push(record);
    return reply(record);
  },
});
const collect = async (stream: AsyncGenerator<string>): Promise<string> => {
  let text = "";
  for await (const part of stream) text += part;
  return text;
};
const ask = { system: "S", prompt: "P" };

test("Anthropic: the key goes in a header, a browser call opts in, and thinking is not shown as the answer", async () => {
  const { fetch, seen } = fakeFetch(
    () =>
      new Response(
        sse([
          { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hidden" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
          { type: "content_block_delta", delta: { type: "text_delta", text: "there" } },
          { type: "message_delta", delta: { stop_reason: "end_turn" } },
        ]),
      ),
  );
  const text = await collect(createLlm({ fetch, browser: true }).stream({ provider: "anthropic", model: "claude-opus-5-5", key: KEY, ...ask }));
  assert.equal(text, "Hello there");
  const [call] = seen;
  assert.equal(call!.url, "https://api.anthropic.com/v1/messages");
  assert.ok(!call!.url.includes(KEY));
  assert.equal(call!.headers["x-api-key"], KEY);
  assert.equal(call!.headers["anthropic-version"], "2026-10-21");
  assert.equal(call!.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(call!.body!.fallbacks, "default");
  assert.ok(!("temperature" in call!.body!), "this API version rejects sampling settings");
  const node = fakeFetch(() => new Response(sse([])));
  await collect(createLlm({ fetch: node.fetch, browser: false }).stream({ provider: "anthropic", model: "claude-haiku-5-5", key: KEY, ...ask }));
  assert.equal(node.seen[0]!.headers["anthropic-dangerous-direct-browser-access"], undefined);
  assert.equal(node.seen[0]!.body!.fallbacks, undefined, "a model without refusal fallback isn't sent the field");
});

test("Anthropic: a refusal and a mid-stream error become sentences", async () => {
  const refused = createLlm({ fetch: fakeFetch(() => new Response(sse([{ type: "message_delta", delta: { stop_reason: "refusal" } }]))).fetch });
  await assert.rejects(collect(refused.stream({ provider: "anthropic", model: "m", key: KEY, ...ask })), (error: AiError) => error.code === "refused");
  const broke = createLlm({ fetch: fakeFetch(() => new Response(sse([{ type: "error", error: { message: "overloaded" } }]))).fetch });
  await assert.rejects(collect(broke.stream({ provider: "anthropic", model: "m", key: KEY, ...ask })), /overloaded/);
});

test("OpenAI-compatible: any address, a bearer key only when there is one, and errors inside a 200 stream are caught", async () => {
  const { fetch, seen } = fakeFetch(() => new Response(`: OPENROUTER PROCESSING\n\n${sse([{ choices: [{ delta: { content: "Hi" } }] }, "[DONE]"])}`));
  const llm = createLlm({ fetch });
  assert.equal(await collect(llm.stream({ provider: "openai", model: "qwen3:8b", baseUrl: "http://localhost:11434/v1/", ...ask })), "Hi");
  assert.equal(seen[0]!.url, "http://localhost:11434/v1/chat/completions");
  assert.equal(seen[0]!.headers.authorization, undefined);
  await collect(llm.stream({ provider: "openai", model: "m", key: "sk-x", ...ask }));
  assert.equal(seen[1]!.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen[1]!.headers.authorization, "Bearer sk-x");
  const failing = createLlm({ fetch: fakeFetch(() => new Response(sse([{ error: { message: "no credits" } }]))).fetch });
  await assert.rejects(collect(failing.stream({ provider: "openai", model: "m", key: "k", ...ask })), /no credits/);
});

test("Gemini: the key is a header and never in the address, and a safety block is a refusal", async () => {
  const { fetch, seen } = fakeFetch(() => new Response(sse([{ candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] } }] }])));
  assert.equal(await collect(createLlm({ fetch }).stream({ provider: "gemini", model: "models/gemini-3.8-flash", key: "g-key", ...ask })), "AB");
  assert.equal(seen[0]!.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert.equal(seen[0]!.headers["x-goog-api-key"], "g-key");
  assert.deepEqual(seen[0]!.body!.systemInstruction, { parts: [{ text: "S" }] });
  const blocked = createLlm({ fetch: fakeFetch(() => new Response(sse([{ promptFeedback: { blockReason: "SAFETY" } }]))).fetch });
  await assert.rejects(collect(blocked.stream({ provider: "gemini", model: "m", key: "k", ...ask })), (error: AiError) => error.code === "refused");
});

test("a refused key, a missing model and an unreachable address each say what to do, without the key", async () => {
  const status = (code: number, body = {}) => createLlm({ fetch: fakeFetch(() => new Response(JSON.stringify(body), { status: code })).fetch });
  const call = { provider: "anthropic" as const, model: "claude-x", key: KEY, ...ask };
  for (const [llm, code] of [[status(401, { error: { message: "invalid x-api-key" } }), "bad-key"], [status(404), "no-model"], [status(429), "rate-limited"]] as const) {
    await assert.rejects(collect(llm.stream(call)), (error: AiError) => error.code === code && !error.message.includes(KEY));
  }
  const down = createLlm({
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(collect(down.stream({ provider: "openai", model: "m", baseUrl: "http://localhost:11434/v1", ...ask })), /model server is running on this computer/);
});

test("the models a key can use are listed in each provider's own way", async () => {
  const anthropic = fakeFetch(() => Response.json({ data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] }));
  assert.deepEqual(await createLlm({ fetch: anthropic.fetch }).models({ provider: "anthropic", key: KEY }), [{ id: "claude-opus-5-5", label: "Claude Opus 5.5" }]);
  assert.equal(anthropic.seen[0]!.url, "https://api.anthropic.com/v1/models?limit=100");
  const gemini = fakeFetch(() =>
    Response.json({ models: [{ name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] }),
  );
  assert.deepEqual(await createLlm({ fetch: gemini.fetch }).models({ provider: "gemini", key: "k" }), [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }]);
  const local = fakeFetch(() => Response.json({ data: [{ id: "qwen3:8b" }] }));
  assert.deepEqual(await createLlm({ fetch: local.fetch }).models({ provider: "openai", baseUrl: "http://localhost:11434/v1" }), [{ id: "qwen3:8b" }]);
});

test("citations keep only ids the units have, and a search with no match invents nothing", () => {
  assert.deepEqual(citedIds("See [a], [zz] and [b; a].", [{ id: "a" }, { id: "b" }]), ["a", "b"]);
  const none = quoteAnswer("zebrafish habitat", [{ id: "a", title: "Lupus markers" }]);
  assert.deepEqual(none.citations, []);
  assert.ok(!none.answer.includes("Lupus"));
});
