// Where the plugin's parts are joined: the device's own store, the services, the keys, the model client, the core and lab sync.
import { requestUrl, type App } from "obsidian";
import type { CoreForAdapter } from "@dg/contract/core.ts";
import type { Host } from "@dg/contract/host.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { ExtractionGraph } from "@dg/contract/services.ts";
import { browserKeys } from "@dg/core/index.ts";
import { createCore } from "@dg/core/index.ts";
import { askBreadcrumb } from "@dg/native/dialog.ts";
import { createServices } from "@dg/sync/client.ts";
import { startLabSync } from "@dg/sync/lab-sync.ts";
import { createLlm } from "@dg/sync/providers.ts";

declare const __DEMO_GRAPHS__: { filename: string; graph: ExtractionGraph }[];

/**
 * All of what `createCore` gives back. The plugin's own UI uses the part the contract names,
 * `CoreForAdapter`. Lab sync, the walkthrough and the test hooks are handed the rest.
 */
type WholeCore = Awaited<ReturnType<typeof createCore>>;

export type Wiring = ReturnType<typeof createWiring>;

export const createWiring = ({
  app,
  host,
  onCore,
}: {
  /** Both asked for late: this is made with the plugin, and the adapter as the plugin loads. */
  app: () => App;
  host: () => Host;
  /** Called once, when the core is first made. */
  onCore: (core: CoreForAdapter) => void;
}) => {
  let core: WholeCore | undefined;
  let coreReady: Promise<WholeCore> | undefined;
  let sync: ReturnType<typeof startLabSync> | undefined;

  const local = {
    get: async (key: string): Promise<unknown> => {
      const stored = await host().getLocal({ key });
      return stored.ok ? stored.value : null;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      await host().setLocal({ key, value: value as never });
    },
  };

  const services = createServices({
    fetch: (input, init) => window.fetch(input, init),
    // Registries and publishers' pages don't all allow a page to read them, and none lets it read
    // their Link headers. Obsidian's own request has no such limit.
    outside: async (input, init = {}) => {
      const asked = requestUrl({
        url: String(input),
        method: init.method ?? "GET",
        ...(init.headers ? { headers: init.headers as Record<string, string> } : {}),
        ...(typeof init.body === "string" ? { body: init.body } : {}),
        throw: false,
      });
      const stopped = new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError"))));
      const reply = await Promise.race([asked, stopped]);
      const empty = init.method === "HEAD" || reply.status === 204 || reply.status === 304;
      return new Response(empty ? null : reply.arrayBuffer, { status: reply.status, headers: reply.headers });
    },
    store: { get: (key) => local.get(key), set: (key, value) => local.set(key, value) },
  });

  /**
   * A model key goes in Obsidian's keychain (Settings → Keychain), which the
   * operating system encrypts and which stays out of the vault and out of
   * `data.json`. Before Obsidian 1.11.4 there is no keychain, so the key is
   * kept with the plugin's other device-only values and the panel says so.
   */
  const secrets = (): SecretStore => {
    const keychain = (app() as App & { secretStorage?: { getSecret: (id: string) => string | null; setSecret: (id: string, secret: string) => void } }).secretStorage;
    if (keychain) {
      return {
        kind: "keychain",
        get: async (id) => keychain.getSecret(id) || null,
        // The keychain has no delete, so an emptied secret stands for none.
        set: async (id, value) => keychain.setSecret(id, value ?? ""),
      };
    }
    return {
      kind: "plain",
      get: async (id) => ((await local.get(`secret:${id}`)) as string | null) || null,
      set: async (id, value) => local.set(`secret:${id}`, value),
    };
  };

  /**
   * The window's own fetch streams an answer as it arrives. A model server
   * that doesn't allow calls from an app window fails there, so the call is
   * made again through Obsidian's own request, which waits for the whole answer.
   */
  const llm = createLlm({
    browser: true,
    fetch: async (url, init) => {
      try {
        return await window.fetch(url, init);
      } catch (error) {
        if (init.signal?.aborted) throw error;
        const reply = await requestUrl({
          url,
          method: init.method ?? "GET",
          headers: init.headers as Record<string, string>,
          ...(typeof init.body === "string" ? { body: init.body } : {}),
          throw: false,
        });
        return new Response(reply.text, { status: reply.status });
      }
    },
  });

  const wholeCore = async (): Promise<WholeCore> => {
    coreReady ??= createCore({
      host: host(),
      keys: browserKeys(),
      services,
      llm,
      secrets: secrets(),
      demoGraphs: __DEMO_GRAPHS__,
      askBreadcrumb: (paper) =>
        askBreadcrumb({
          skin: core!.info.skin,
          title: paper.title,
          onAnswer: (leave, remember) => void core!.answerBreadcrumb({ paper: paper.id, leave, remember }),
        }),
    }).then((made) => {
      core = made;
      onCore(made);
      sync = startLabSync({ services, target: made });
      return made;
    });
    return coreReady;
  };

  return {
    local,
    labLink: () => services.link(),
    /** The core once it is made. Synchronous, for what draws before anyone has waited for it. */
    core: (): CoreForAdapter | undefined => core,
    ensureCore: (): Promise<CoreForAdapter> => wholeCore(),
    wholeCore,
    sync: () => sync,
  };
};
