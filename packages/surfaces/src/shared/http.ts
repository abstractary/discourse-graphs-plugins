import type { SurfaceEvent } from "@dg/contract/surface.ts";
import type { Call, Connection } from "./rpc.ts";

type EventName = SurfaceEvent["event"];

/**
 * The same Connection a frame gets inside a base, over HTTP instead of a
 * MessagePort. The local app's server holds the core, and this page gets one
 * port there, with one event stream that every panel listens to. A browser
 * keeps only six connections open to a host, so a stream per panel would leave
 * none for the calls themselves.
 */
type Hub = { tab: string; stream: EventSource; panels: Set<(message: SurfaceEvent) => void>; next: number };
let hub: Hub | null = null;

const joinHub = (): Hub => {
  if (hub) return hub;
  const tab = crypto.randomUUID();
  const stream = new EventSource(`/events?tab=${tab}`);
  const panels = new Set<(message: SurfaceEvent) => void>();
  stream.onmessage = ({ data }) => {
    const message = JSON.parse(data as string) as SurfaceEvent;
    for (const panel of panels) panel(message);
  };
  hub = { tab, stream, panels, next: 0 };
  return hub;
};

export const connectOverHttp = (route: Connection["route"]): Connection & { close: () => void } => {
  const shared = joinHub();
  const listeners = new Map<EventName, Set<(message: never) => void>>();
  const deliver = (message: SurfaceEvent) => {
    for (const listener of listeners.get(message.event) ?? []) listener(message as never);
  };
  shared.panels.add(deliver);
  const call: Call = async (method, params) => {
    // Ids are the page's, since every panel's calls come back on the one port.
    shared.next += 1;
    const response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tab: shared.tab, id: `h${shared.next}`, method, params }),
    });
    const answer = (await response.json()) as { ok: boolean; result?: unknown; error?: { message: string } };
    if (!answer.ok) throw new Error(answer.error?.message ?? "Failed");
    return answer.result as never;
  };
  return {
    route,
    close: () => {
      shared.panels.delete(deliver);
      if (shared.panels.size === 0 && hub === shared) {
        shared.stream.close();
        hub = null;
      }
    },
    call,
    on: (name, listener) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener as (message: never) => void);
      return () => {
        set.delete(listener as (message: never) => void);
      };
    },
  };
};

/** Follows the system's light or dark setting, since there's no base to take a look from. */
export const followSystemTheme = (): void => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => (document.documentElement.dataset.theme = query.matches ? "dark" : "light");
  apply();
  query.addEventListener("change", apply);
};
