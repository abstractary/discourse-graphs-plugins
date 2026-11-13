import type { DgRecord } from "@dg/contract/records.ts";
import type { Services } from "@dg/contract/services.ts";

/** What sync needs from the graph. It never looks inside a record. */
export type SyncTarget = {
  /** Everything this person shares with their lab, given what's on shared canvases. */
  shareable: () => DgRecord[];
  /** Takes in what teammates shared. Records already held are ignored. */
  take: (records: DgRecord[]) => Promise<void>;
  /** Run before each exchange, for what has to be ready first, such as signing what will be sent. */
  prepare?: () => Promise<void>;
  /** Told the server's time with each exchange, so a device can correct a clock that is off. */
  serverTime?: (now: string) => void;
};

const EVERY_MS = 4000;

/** One version of a record. Two people can each make a version with the same count of edits. */
const keyOf = (record: DgRecord): string => {
  const version = "rev" in record ? `${record.rev}:${record.editedAt ?? ""}:${record.editedBy?.id ?? ""}` : "0";
  return `${record.id}:${version}:${record.sig ? 1 : 0}`;
};

/**
 * Every member keeps a full copy, and the server only passes records along, so
 * losing the connection costs nothing but freshness. A failed round is retried.
 */
export const startLabSync = ({
  services,
  target,
  onError = () => {},
}: {
  services: Services;
  target: SyncTarget;
  onError?: (error: unknown) => void;
}): { stop: () => void; now: () => Promise<void> } => {
  const sent = new Set<string>();
  let cursor: string | undefined;
  let running: Promise<void> | null = null;

  const round = async (): Promise<void> => {
    const link = await services.link();
    if (!link?.token) return;
    await target.prepare?.();
    const fresh = target.shareable().filter((record) => !sent.has(keyOf(record)));
    if (fresh.length > 0) {
      await services.pushRecords(link, fresh);
      for (const record of fresh) sent.add(keyOf(record));
    }
    for (;;) {
      const page = await services.pullRecords(link, cursor);
      if (page.now) target.serverTime?.(page.now);
      if (page.records.length > 0) await target.take(page.records);
      for (const record of page.records) sent.add(keyOf(record));
      cursor = page.next ?? cursor;
      if (page.done) break;
    }
  };

  const now = (): Promise<void> => {
    running ??= round()
      .catch(onError)
      .finally(() => {
        running = null;
      });
    return running;
  };

  const timer = setInterval(() => void now(), EVERY_MS);
  void now();
  return { stop: () => clearInterval(timer), now };
};
