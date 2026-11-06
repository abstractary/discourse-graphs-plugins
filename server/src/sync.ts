import { requireMember } from './auth.ts';
import { ApiError } from './http.ts';
import type { Context, Route } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

type RecordEntry = { seq: number; hash: string; record: unknown };
type RecordLog = { items: RecordEntry[] };

function readLog(store: Store, labId: string): RecordLog {
  return store.read<RecordLog>(`records/${labId}`) ?? { items: [] };
}

function parseCount(value: string | null, name: string, fallback: number): number {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ApiError(400, `bad-${name}`, `Send "${name}" as a whole number. For "after", use the "next" from the last call.`);
  }
  return Number(value);
}

async function pushRecords({ req, params, readJson }: Context, store: Store): Promise<unknown> {
  requireMember(req, store, params.id);
  const { records } = await readJson();
  if (!Array.isArray(records)) {
    throw new ApiError(400, 'bad-records', 'Send "records" as an array.');
  }
  // Read after the await, so two pushes at once cannot overwrite each other.
  const log = readLog(store, params.id);
  const seen = new Set(log.items.map((item) => item.hash));
  let seq = log.items.at(-1)?.seq ?? 0;
  let stored = 0;
  for (const record of records) {
    const hash = hashOf(JSON.stringify(record));
    if (seen.has(hash)) continue;
    seen.add(hash);
    seq += 1;
    stored += 1;
    log.items.push({ seq, hash, record });
  }
  if (stored > 0) store.write(`records/${params.id}`, log);
  return { stored };
}

function pullRecords({ req, params, query }: Context, store: Store): unknown {
  requireMember(req, store, params.id);
  const after = parseCount(query.get('after'), 'after', 0);
  const limit = Math.min(parseCount(query.get('limit'), 'limit', DEFAULT_LIMIT), MAX_LIMIT);
  if (limit === 0) throw new ApiError(400, 'bad-limit', 'Send "limit" as 1 or more.');
  const remaining = readLog(store, params.id).items.filter((item) => item.seq > after);
  const page = remaining.slice(0, limit);
  return {
    records: page.map((item) => item.record),
    next: page.at(-1)?.seq ?? after,
    done: remaining.length <= limit,
  };
}

export function syncRoutes(store: Store): Route[] {
  return [
    { method: 'POST', path: '/v1/labs/:id/records', handler: (context) => pushRecords(context, store) },
    { method: 'GET', path: '/v1/labs/:id/records', handler: (context) => pullRecords(context, store) },
  ];
}
