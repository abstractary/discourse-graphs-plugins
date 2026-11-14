import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type Store = {
  read: <T>(key: string) => T | undefined;
  write: (key: string, value: unknown) => void;
  list: (folder: string) => string[];
  writeBlob: (key: string, data: Buffer) => void;
  readBlob: (key: string) => Buffer | undefined;
};

export function hashOf(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** JSON with every object's keys in order, so one record always reads the same however a client wrote it. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

// The last guard against a key from a URL escaping the data folder.
function checkKey(key: string): void {
  if (!key.split('/').every((segment) => SAFE_SEGMENT.test(segment))) {
    throw new Error('A store key has an unsafe segment');
  }
}

function writeAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, data, { mode: 0o600, flush: true });
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

// Reads and writes are synchronous on purpose. A handler that reads, changes and
// writes in one tick cannot lose an update to another request.
export function createStore(dataDir: string): Store {
  const jsonPath = (key: string): string => join(dataDir, 'json', `${key}.json`);
  const blobPath = (key: string): string => join(dataDir, 'blobs', key);

  return {
    read<T>(key: string): T | undefined {
      checkKey(key);
      const path = jsonPath(key);
      return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
    },
    write(key, value) {
      checkKey(key);
      writeAtomic(jsonPath(key), JSON.stringify(value));
    },
    list(folder) {
      checkKey(folder);
      const path = join(dataDir, 'json', folder);
      if (!existsSync(path)) return [];
      return readdirSync(path)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length));
    },
    writeBlob(key, data) {
      checkKey(key);
      writeAtomic(blobPath(key), data);
    },
    readBlob(key) {
      checkKey(key);
      const path = blobPath(key);
      return existsSync(path) ? readFileSync(path) : undefined;
    },
  };
}
