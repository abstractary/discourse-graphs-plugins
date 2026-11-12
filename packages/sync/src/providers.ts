import { AiError, providerOf, type AiCall, type AiModel, type Llm } from "@dg/contract/llm.ts";

/**
 * Calls a model provider with a person's own key, from the device. Three
 * wire formats: Anthropic's Messages API, the OpenAI chat-completions shape
 * that OpenAI, OpenRouter, Ollama and LM Studio all speak, and Gemini's.
 *
 * The key goes only to the provider's own address, in a header, never in a
 * URL. Errors are rewritten into a sentence and never carry the key.
 */

type Send = (url: string, init: RequestInit) => Promise<Response>;

const ANTHROPIC_VERSION = "2026-10-21";
const MAX_TOKENS = 16000;
/** Models with server-side refusal fallback. On others the field is an error. */
const ANTHROPIC_FALLBACK = /^claude-(fable-5-[12]|opus-5(-5)?|sonnet-5-5)$/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const trimmed = (url: string): string => url.replace(/\/+$/, "");
const baseOf = (call: Omit<AiCall, "model">): string => trimmed(call.baseUrl?.trim() || providerOf(call.provider).baseUrl);
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Each `data:` line of a server-sent event stream, parsed. Comment lines and `[DONE]` are skipped. */
async function* sse<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) throw new AiError("failed", "The model service sent nothing back.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = function* (flush: boolean): Generator<T> {
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        yield JSON.parse(payload) as T;
      } catch {
        // A partial or non-JSON line carries no words.
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* take(false);
    }
    buffer += decoder.decode();
    yield* take(true);
  } finally {
    reader.releaseLock();
  }
}

const said = async (response: Response): Promise<string> => {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const message = typeof body?.error === "string" ? body.error : body?.error?.message;
  return message ? ` It said: ${message.slice(0, 300)}` : "";
};

const checked = async (response: Response, where: string, model?: string): Promise<Response> => {
  if (response.ok) return response;
  if (response.status === 401 || response.status === 403) {
    throw new AiError("bad-key", `${where} refused the key. Check that it is right and still active.${await said(response)}`);
  }
  if (response.status === 404) {
    throw new AiError("no-model", `${where} has no ${model ? `model called ${model}` : "such address"}. Pick another model.`);
  }
  if (response.status === 429) throw new AiError("rate-limited", `${where} is rate limiting this key. Wait a minute, then try again.`);
  if (response.status === 402) throw new AiError("failed", `${where} says this key has no credit left.`);
  throw new AiError("failed", `${where} answered with HTTP ${response.status}.${await said(response)}`);
};

export const createLlm = ({
  fetch: send = (url, init) => fetch(url, init),
  browser = typeof window !== "undefined",
}: {
  fetch?: Send;
  /** A browser or an Electron window, where Anthropic asks for an extra header before it allows the call. */
  browser?: boolean;
} = {}): Llm => {
  const call = async (url: string, init: RequestInit, model?: string): Promise<Response> => {
    const where = hostOf(url);
    let response: Response;
    try {
      response = await send(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw new AiError("stopped", "Stopped.");
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(where);
      throw new AiError(
        "unreachable",
        local
          ? `Couldn't reach ${where}. Check that the model server is running on this computer.`
          : `Couldn't reach ${where}. Check the network${error instanceof TypeError ? ", and that the address is right" : ""}.`,
      );
    }
    return checked(response, where, model);
  };

  const anthropicHeaders = (key: string | undefined): Record<string, string> => ({
    "content-type": "application/json",
    "x-api-key": key ?? "",
    "anthropic-version": ANTHROPIC_VERSION,
    ...(browser ? { "anthropic-dangerous-direct-browser-access": "true" } : {}),
  });

  async function* anthropic({ system, prompt, signal, ...target }: Parameters<Llm["stream"]>[0]): AsyncGenerator<string> {
    const fallback = ANTHROPIC_FALLBACK.test(target.model);
    const response = await call(
      `${baseOf(target)}/v1/messages`,
      {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: { ...anthropicHeaders(target.key), ...(fallback ? { "anthropic-beta": FALLBACK_BETA } : {}) },
        body: JSON.stringify({
          model: target.model,
          max_tokens: MAX_TOKENS,
          stream: true,
          system,
          messages: [{ role: "user", content: prompt }],
          // If this model declines, Anthropic reruns the question on another of its models in the same call.
          ...(fallback ? { fallbacks: "default" } : {}),
        }),
      },
      target.model,
    );
    type Event = { type?: string; delta?: { type?: string; text?: string; stop_reason?: string }; error?: { message?: string } };
    for await (const event of sse<Event>(response)) {
      if (event.type === "error") throw new AiError("failed", `Claude stopped with an error. Try again in a minute.${event.error?.message ? ` It said: ${event.error.message.slice(0, 300)}` : ""}`);
      if (event.type === "message_delta" && event.delta?.stop_reason === "refusal") throw new AiError("refused", "The model declined to answer this. Try rewording the question.");
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) yield event.delta.text;
    }
  }

  async function* openai({ system, prompt, signal, ...target }: Parameters<Llm["stream"]>[0]): AsyncGenerator<string> {
    const response = await call(
      `${baseOf(target)}/chat/completions`,
      {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: { "content-type": "application/json", ...(target.key ? { authorization: `Bearer ${target.key}` } : {}) },
        body: JSON.stringify({
          model: target.model,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        }),
      },
      target.model,
    );
    type Chunk = { error?: { message?: string }; choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string }[] };
    let refused = "";
    for await (const chunk of sse<Chunk>(response)) {
      // Some services report a failure inside a stream that began with HTTP 200.
      if (chunk.error) throw new AiError("failed", `The model service stopped with an error.${chunk.error.message ? ` It said: ${chunk.error.message.slice(0, 300)}` : ""}`);
      const choice = chunk.choices?.[0];
      if (choice?.delta?.refusal) refused += choice.delta.refusal;
      if (choice?.finish_reason === "content_filter") throw new AiError("refused", "The model service blocked this answer. Try rewording the question.");
      if (choice?.delta?.content) yield choice.delta.content;
    }
    if (refused) throw new AiError("refused", "The model declined to answer this. Try rewording the question.");
  }

  async function* gemini({ system, prompt, signal, ...target }: Parameters<Llm["stream"]>[0]): AsyncGenerator<string> {
    const response = await call(
      `${baseOf(target)}/models/${encodeURIComponent(target.model.replace(/^models\//, ""))}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: { "content-type": "application/json", "x-goog-api-key": target.key ?? "" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      },
      target.model,
    );
    type Chunk = {
      error?: { message?: string };
      promptFeedback?: { blockReason?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    };
    const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);
    for await (const chunk of sse<Chunk>(response)) {
      if (chunk.error) throw new AiError("failed", `Gemini stopped with an error.${chunk.error.message ? ` It said: ${chunk.error.message.slice(0, 300)}` : ""}`);
      if (chunk.promptFeedback?.blockReason) throw new AiError("refused", "Gemini blocked this question. Try rewording it.");
      const candidate = chunk.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) if (part.text) yield part.text;
      if (candidate?.finishReason && BLOCKED.has(candidate.finishReason)) throw new AiError("refused", "Gemini blocked this answer. Try rewording the question.");
    }
  }

  const models: Llm["models"] = async ({ signal, ...target }) => {
    const base = baseOf(target);
    const init = (headers: Record<string, string>): RequestInit => ({ method: "GET", headers, ...(signal ? { signal } : {}) });
    if (target.provider === "anthropic") {
      const { "content-type": _unused, ...headers } = anthropicHeaders(target.key);
      const body = (await (await call(`${base}/v1/models?limit=100`, init(headers))).json()) as { data?: { id: string; display_name?: string }[] };
      return (body.data ?? []).map((model): AiModel => ({ id: model.id, ...(model.display_name ? { label: model.display_name } : {}) }));
    }
    if (target.provider === "gemini") {
      const body = (await (await call(`${base}/models?pageSize=200`, init({ "x-goog-api-key": target.key ?? "" }))).json()) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      };
      return (body.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
        .map((model): AiModel => ({ id: model.name.replace(/^models\//, ""), ...(model.displayName ? { label: model.displayName } : {}) }));
    }
    const body = (await (await call(`${base}/models`, init(target.key ? { authorization: `Bearer ${target.key}` } : {}))).json()) as {
      data?: { id: string; name?: string }[];
    };
    return (body.data ?? []).map((model): AiModel => ({ id: model.id, ...(model.name && model.name !== model.id ? { label: model.name } : {}) }));
  };

  return {
    stream: (args) => (args.provider === "anthropic" ? anthropic(args) : args.provider === "gemini" ? gemini(args) : openai(args)),
    models,
  };
};
