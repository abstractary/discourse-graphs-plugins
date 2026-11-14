import { isThisComputer } from "@dg/contract/urls.ts";
import { liveCanvasItems } from "@dg/contract/records.ts";
import {
  AI_SYSTEM_PROMPT,
  AiError,
  aiPrompt,
  citedIds,
  providerOf,
  quoteAnswer,
  type AiCall,
  type AiModel,
  type AiProviderKind,
  type AiRoute,
  type AiSettings,
  type AiSource,
  type AiUnitText,
  type Llm,
  type SecretStore,
} from "@dg/contract/llm.ts";
import type { AiStatus } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

/**
 * Asking about a canvas. Three ways to an answer, tried in this order:
 * a person's own key, the lab's model, and with neither, the closest units
 * quoted word for word.
 *
 * The key is kept in the base's secret store and read only when a call is
 * made. Settings hold the provider, the model and the key's last four
 * characters, which is all a panel is ever sent.
 */

const SETTINGS_KEY = "ai-settings";
const secretId = (provider: AiProviderKind): string => `discourse-graphs-ai-${provider}`;

type Stored = { source?: AiSource; provider: AiProviderKind; model: string; baseUrl?: string; route: AiRoute; keyHints?: Partial<Record<AiProviderKind, string>> };
const DEFAULTS: Stored = { provider: "anthropic", model: providerOf("anthropic").defaultModel, route: "device" };

type AiHandlers = Pick<Handlers, "ai.status" | "ai.ask" | "ai.cancel" | "ai.settings" | "ai.configure" | "ai.models" | "ai.test">;

export const aiFeature = (
  context: Context,
  { llm, secrets }: { llm?: Llm; secrets?: SecretStore },
) => {
  const running = new Map<string, AbortController>();

  const stored = async (): Promise<Stored> => {
    const value = await context.getLocal(SETTINGS_KEY);
    return { ...DEFAULTS, ...(value && typeof value === "object" ? (value as Partial<Stored>) : {}) };
  };
  const keyOf = async (provider: AiProviderKind): Promise<string | null> => (await secrets?.get(secretId(provider))) || null;
  const labLink = async () => {
    const link = context.services ? await context.services.link() : null;
    return link?.token ? link : null;
  };

  const settings = async (): Promise<AiSettings> => {
    const kept = await stored();
    const key = await keyOf(kept.provider);
    const inLab = Boolean(await labLink());
    const hint = kept.keyHints?.[kept.provider];
    return {
      // Someone who has saved a key meant to use it; otherwise the lab's model, where there is one.
      source: kept.source ?? (key ? "own" : "lab"),
      provider: kept.provider,
      model: kept.model,
      ...(kept.baseUrl ? { baseUrl: kept.baseUrl } : {}),
      route: inLab ? kept.route : "device",
      hasKey: Boolean(key),
      ...(key && hint ? { keyHint: hint } : {}),
      keptIn: secrets?.kind ?? "nowhere",
      inLab,
      canCall: Boolean(llm && secrets),
    };
  };

  /** A person's own model, when everything it needs is in place. */
  const own = async (): Promise<(AiCall & { route: AiRoute }) | null> => {
    const view = await settings();
    if (view.source !== "own" || !view.model) return null;
    const provider = providerOf(view.provider);
    const key = await keyOf(view.provider);
    // A model server on this computer takes no key; every hosted one does.
    const keyless = provider.customUrl && Boolean(view.baseUrl) && view.baseUrl !== provider.baseUrl;
    if (!key && (provider.needsKey || !keyless)) return null;
    if (view.route === "device" && !llm) return null;
    return { provider: view.provider, model: view.model, ...(view.baseUrl ? { baseUrl: view.baseUrl } : {}), ...(key ? { key } : {}), route: view.route };
  };

  const unitsOnCanvas = (canvas: string): AiUnitText[] =>
    liveCanvasItems({ graph: context.graph(), canvas }).flatMap(({ item }) => {
      const id = (item as { dg?: { node?: string } }).dg?.node;
      const node = id ? context.nodeOf(id) : undefined;
      if (!node) return [];
      return [{
        id: node.id,
        type: context.typeOf(node.type)?.label ?? "Unit",
        title: node.title,
        ...(node.source?.description ? { description: node.source.description } : {}),
        ...(node.source?.anchor ? { anchor: node.source.anchor } : {}),
      }];
    });

  const status = async (): Promise<AiStatus> => {
    const mine = await own();
    const canSetUp = Boolean(llm && secrets);
    if (mine) {
      const local = isThisComputer(mine.baseUrl ?? "");
      return { ready: true, mode: "model", model: mine.model, source: "own", provider: mine.provider, route: mine.route, ...(local ? { local } : {}), canSetUp };
    }
    const link = await labLink();
    if (link) {
      try {
        const info = await context.services!.check(link.server);
        return { ready: true, ...(info.ai ?? { mode: "search-only" as const }), source: "lab", canSetUp };
      } catch {
        return { ready: true, mode: "search-only", source: "none", canSetUp, why: "Couldn't reach your lab's server, so this quotes the closest units." };
      }
    }
    return {
      ready: true,
      mode: "search-only",
      source: "none",
      canSetUp,
      why: canSetUp ? "No model is connected yet. Add your own key, or join a lab that has one." : "No model is connected. Join a lab that has one.",
    };
  };

  const all: AiHandlers & { settings: () => Promise<AiSettings> } = {
    settings,
    "ai.status": status,
    "ai.settings": settings,
    "ai.configure": async ({ key, ...changes }) => {
      const kept = await stored();
      const next: Stored = { ...kept, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) } as Stored;
      const provider = providerOf(next.provider);
      if (!provider.customUrl || !next.baseUrl?.trim() || next.baseUrl.trim() === provider.baseUrl) delete next.baseUrl;
      else next.baseUrl = next.baseUrl.trim().replace(/\/+$/, "");
      if (next.baseUrl && !/^https?:\/\//.test(next.baseUrl)) throw new Error("The address needs to start with http:// or https://.");
      // A key for one address must not follow the settings to another.
      if (changes.provider && changes.provider !== kept.provider && !changes.model) next.model = provider.defaultModel;
      if (key !== undefined) {
        if (!secrets) throw new Error("This base has nowhere to keep a key.");
        const clean = key?.trim() || null;
        await secrets.set(secretId(next.provider), clean);
        next.keyHints = { ...next.keyHints };
        if (clean) next.keyHints[next.provider] = clean.slice(-4);
        else delete next.keyHints[next.provider];
        if (clean && changes.source === undefined) next.source = "own";
      }
      await context.setLocal(SETTINGS_KEY, next);
      context.send({ event: "ai-changed" });
      return settings();
    },
    "ai.models": async ({ provider, baseUrl, key }): Promise<AiModel[]> => {
      if (!llm) throw new Error("This base can't reach a model service from here.");
      const kept = await stored();
      const kind = provider ?? kept.provider;
      const secret = key?.trim() || (await keyOf(kind)) || undefined;
      const address = baseUrl ?? (kind === kept.provider ? kept.baseUrl : undefined);
      return llm.models({ provider: kind, ...(address ? { baseUrl: address } : {}), ...(secret ? { key: secret } : {}) });
    },
    "ai.test": async () => {
      const mine = await own();
      if (!mine) return { ok: false, message: "Choose a model and add a key first." };
      if (mine.route === "lab") return { ok: true, message: "Saved. Questions will go through your lab's server.", model: mine.model };
      const { route: _route, ...call } = mine;
      try {
        let heard = "";
        for await (const text of llm!.stream({ ...call, system: "Reply with the single word: ready", prompt: "Say ready." })) {
          heard += text;
          if (heard.length > 200) break;
        }
        return { ok: true, message: `${mine.model} answered.`, model: mine.model };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    "ai.cancel": async ({ requestId }) => {
      running.get(requestId)?.abort();
      return null;
    },
    "ai.ask": async ({ canvas, question, grounded, requestId }) => {
      const all = unitsOnCanvas(canvas);
      const units = grounded && grounded.length > 0 ? all.filter((unit) => grounded.includes(unit.id)) : all;
      if (units.length === 0) throw new Error("There are no units here to answer from. Add some cards, then ask.");
      const onDelta = (text: string): void => context.send({ event: "ai-delta", requestId, text });
      const mine = await own();
      const link = await labLink();

      // A lab's reach covers questions too: the units sent with one are its unpublished work.
      const reach = context.myLab()?.settings?.reach ?? (context.myLab() ? "lab" : "anywhere");
      const local = isThisComputer(mine?.baseUrl ?? "");
      if (mine?.route === "device" && reach !== "anywhere" && !local) {
        throw new Error(`${context.myLab()!.name} keeps its work ${reach === "device" ? "on your own computer" : "inside the lab"}. Ask with a model on this computer${reach === "lab" ? ", or with the lab's" : ""}.`);
      }
      if (reach === "device" && mine?.route !== "device") throw new Error(`${context.myLab()!.name} keeps its work on your own computer. Ask with a model on this computer.`);
      if (mine?.route === "device") {
        const { route: _route, ...call } = mine;
        const controller = new AbortController();
        running.set(requestId, controller);
        let answer = "";
        try {
          for await (const text of llm!.stream({ ...call, system: AI_SYSTEM_PROMPT, prompt: aiPrompt(question, units), signal: controller.signal })) {
            answer += text;
            onDelta(text);
          }
        } catch (error) {
          if (controller.signal.aborted || (error instanceof AiError && error.code === "stopped")) {
            return { answer, citations: citedIds(answer, units), mode: "model", model: mine.model, source: "own", stopped: true };
          }
          throw error;
        } finally {
          running.delete(requestId);
        }
        return { answer, citations: citedIds(answer, units), mode: "model", model: mine.model, source: "own" };
      }

      if (link && (mine?.route === "lab" || !mine)) {
        const { route: _route, ...provider } = mine ?? ({} as AiCall & { route: AiRoute });
        const result = await context.services!.ask({
          link,
          question,
          units: all.map((unit) => ({ ...unit, type: unit.type ?? "Unit" })),
          ...(grounded && grounded.length > 0 ? { grounded } : {}),
          ...(mine ? { provider } : {}),
          onDelta,
        });
        return { ...result, source: mine ? "own" : "lab" };
      }

      const quoted = quoteAnswer(question, units);
      onDelta(quoted.answer);
      return { ...quoted, mode: "search-only", source: "none" };
    },
  };
  const { settings: _settings, ...handlers } = all;
  return { handlers, settings };
};
