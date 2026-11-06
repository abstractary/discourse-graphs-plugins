import type { Config } from '../config.ts';
import type { Graph } from '../types.ts';
import type { DemoPaper } from './demo-replay.ts';
import type { UploadedDocument } from './document.ts';

export type ExtractContext = {
  config: Config;
  demoPapers: DemoPaper[];
  emit: (line: Record<string, unknown>) => void;
  signal: AbortSignal;
};

export type ExtractModel = {
  id: string;
  label: string;
  description: string;
  default?: boolean;
  run: (document: UploadedDocument, context: ExtractContext) => Promise<Graph>;
};
