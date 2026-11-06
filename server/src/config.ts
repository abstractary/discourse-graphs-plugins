import { join } from 'node:path';

const SERVER_ROOT = join(import.meta.dirname, '..');
const KINDS = ['local', 'managed', 'custom'];

export type ServerKind = 'local' | 'managed' | 'custom';

export type Config = {
  port: number;
  host: string;
  kind: ServerKind;
  dataDir: string;
  demoPapersDir: string;
  miraUrl: string;
  anthropicKey?: string;
  anthropicBaseUrl: string;
  openRouterKey?: string;
  openRouterBaseUrl: string;
  aiModel?: string;
  maxBodyBytes: number;
  replayMs: number;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const kind = env.DG_KIND || 'local';
  if (!KINDS.includes(kind)) {
    throw new Error(`DG_KIND is "${kind}". Set it to one of ${KINDS.join(', ')}, or unset it.`);
  }
  return {
    port: Number(env.PORT || 8787),
    host: env.HOST || '127.0.0.1',
    kind: kind as ServerKind,
    dataDir: env.DG_DATA || join(SERVER_ROOT, 'data'),
    demoPapersDir: env.DG_DEMO_PAPERS || join(SERVER_ROOT, '..', 'demo', 'papers'),
    miraUrl: env.MIRA_URL || 'https://mira-extraction.vercel.app/api/extract',
    anthropicKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    openRouterKey: env.OPENROUTER_API_KEY || undefined,
    openRouterBaseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    aiModel: env.AI_MODEL || undefined,
    maxBodyBytes: 40 * 1024 * 1024,
    replayMs: 2000,
  };
}
