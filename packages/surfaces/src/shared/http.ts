import type { SurfaceEvent } from "@dg/contract/surface.ts";
import type { Call, Connection } from "./rpc.ts";

type EventName = SurfaceEvent["event"];

/**
 * The same Connection a frame gets inside a base, over HTTP instead of a
 * MessagePort. The local app's server holds the core; this tab gets a port of
 * its own there, so events reach only this tab.
 */
export const connectOverHttp = (route: Connection["route"]): Connection & { close: () => void } => {
  const tab = crypto.randomUUID();
  const listeners = new Map<EventName, Set<(message: never) => void>>();
  const stream = new EventSource(`/events?tab=${tab}`);
  stream.onmessage = ({ data }) => {
    const message = JSON.parse(data as string) as SurfaceEvent;
    for (const listener of listeners.get(message.event) ?? []) listener(message as never);
  };
  let next = 0;
  const call: Call = async (method, params) => {
    next += 1;
    const response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tab, id: `h${next}`, method, params }),
    });
    const answer = (await response.json()) as { ok: boolean; result?: unknown; error?: { message: string } };
    if (!answer.ok) throw new Error(answer.error?.message ?? "Failed");
    return answer.result as never;
  };
  return {
    route,
    close: () => stream.close(),
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
