import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { startServer } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';

export const DEMO_PAPERS = join(import.meta.dirname, '..', '..', 'demo', 'papers');

export type TestServer = {
  url: string;
  dataDir: string;
  post: (path: string, body: unknown, token?: string) => Promise<Response>;
  get: (path: string, token?: string) => Promise<Response>;
};

export type Line = Record<string, any>;

function bearer(token?: string): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

// MIRA_URL points at a closed port so no test can reach the real service by accident.
export async function startTestServer(t: TestContext, overrides: Partial<Config> = {}): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'dg-server-test-'));
  const running = await startServer({
    ...loadConfig({}),
    port: 0,
    dataDir,
    demoPapersDir: DEMO_PAPERS,
    miraUrl: 'http://127.0.0.1:9/closed',
    replayMs: 20,
    ...overrides,
  });
  t.after(async () => {
    await running.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${running.port}`;
  return {
    url,
    dataDir,
    post: (path, body, token) =>
      fetch(url + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...bearer(token) },
        body: JSON.stringify(body),
      }),
    get: (path, token) => fetch(url + path, { headers: bearer(token) }),
  };
}

export async function readNdjson(response: Response): Promise<Line[]> {
  const text = await response.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Line);
}

export function lastLine(lines: Line[]): Line {
  const line = lines.at(-1);
  if (!line) throw new Error('The stream was empty');
  return line;
}

export async function startFakeServer(t: TestContext, listener: RequestListener): Promise<string> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function readRequest(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export type LabFixture = { id: string; adminToken: string };

export async function createLab(server: TestServer, name = 'Tension Lab'): Promise<LabFixture> {
  const response = await server.post('/v1/labs', { name, person: { did: 'did:plc:admin', name: 'Ada' } });
  const body = (await response.json()) as { lab: { id: string }; token: string };
  return { id: body.lab.id, adminToken: body.token };
}

export async function joinLab(
  server: TestServer,
  lab: LabFixture,
  did = 'did:plc:member',
  tokenKind = 'personal',
): Promise<string> {
  const join = await server.post(`/v1/labs/${lab.id}/join`, { person: { did, name: 'Member' } });
  const { requestId, secret } = (await join.json()) as { requestId: string; secret: string };
  await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'accept', tokenKind }, lab.adminToken);
  const poll = await server.get(`/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`);
  return ((await poll.json()) as { token: string }).token;
}

export function readAllData(folder: string): string {
  let all = '';
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    all += statSync(path).isDirectory() ? readAllData(path) : readFileSync(path).toString('latin1');
  }
  return all;
}

// Builds a real .docx zip. Compressed, with other entries first, as Word writes them.
export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('');
  const entries: [string, string][] = [
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['word/document.xml', `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`],
    ['word/styles.xml', '<?xml version="1.0"?><w:styles/>'],
  ];
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const raw = Buffer.from(content, 'utf8');
    const packed = deflateRawSync(raw);
    const fileName = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, fileName, packed);
    central.push(entry, fileName);
    offset += local.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
