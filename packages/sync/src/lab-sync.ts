import type { DgRecord } from "@dg/contract/records.ts";
import type { Services } from "@dg/contract/services.ts";

/** What sync needs from the graph. It never looks inside a record. */
export type SyncTarget = {
  /** Everything this person shares with their lab, given what's on shared canvases. */
  shareable: () => DgRecord[];
  /** Takes in what teammates shared. Records already held are ignored. */
  take: (records: DgRecord[]) => Promise<void>;
};

const EVERY_MS = 4000;

const keyOf = (record: DgRecord): string => `${record.id}:${"rev" in record ? record.rev : 0}`;

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
    const fresh = target.shareable().filter((record) => !sent.has(keyOf(record)));
    if (fresh.length > 0) {
      await services.pushRecords(link, fresh);
      for (const record of fresh) sent.add(keyOf(record));
    }
    for (;;) {
      const page = await services.pullRecords(link, cursor);
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
