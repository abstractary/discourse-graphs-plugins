import type { Host, HostErrorCode, Result } from "./host.ts";

/** Operation names and outcomes only. Arguments can hold research content. */
export type UsageEvent = {
  op: string;
  ok: boolean;
  code?: HostErrorCode;
  ms: number;
  at: string;
};

type HostCall = (args?: unknown) => Promise<Result<unknown>>;

/** Every action crosses this seam, so one wrapper measures both bases alike. */
export const withUsageLog = ({
  host,
  record,
}: {
  host: Host;
  record: (event: UsageEvent) => void;
}): Host => {
  const wrapped: Record<string, unknown> = { subscribe: host.subscribe };
  for (const [op, call] of Object.entries(host)) {
    if (op === "subscribe") continue;
    wrapped[op] = async (args?: unknown): Promise<Result<unknown>> => {
      const started = Date.now();
      const result = await (call as HostCall)(args);
      record({
        op,
        ok: result.ok,
        ...(result.ok ? {} : { code: result.error.code }),
        ms: Date.now() - started,
        at: new Date(started).toISOString(),
      });
      return result;
    };
  }
  return wrapped as Host;
};
