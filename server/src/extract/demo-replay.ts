import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { ApiError } from '../http.ts';
import { hashOf } from '../store.ts';
import type { Graph } from '../types.ts';
import type { UploadedDocument } from './document.ts';
import type { ExtractContext, ExtractModel } from './model.ts';

export type DemoPaper = { sha256: string; names: string[]; graph: Graph };

// `source` in a saved graph is the name the paper had when it was extracted, which
// is the name a person is most likely to upload it under.
export function loadDemoPapers(folder: string): DemoPaper[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith('.pdf'))
    .flatMap((name) => {
      const graphPath = join(folder, name.replace(/\.pdf$/, '.graph.json'));
      if (!existsSync(graphPath)) return [];
      const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as Graph;
      return [{ sha256: hashOf(readFileSync(join(folder, name))), names: [name, graph.source], graph }];
    });
}

function findDemoPaper(papers: DemoPaper[], document: UploadedDocument): DemoPaper | undefined {
  const hash = document.data && hashOf(document.data);
  const name = basename(document.filename);
  return papers.find((paper) => paper.sha256 === hash) ?? papers.find((paper) => paper.names.includes(name));
}

async function replay(document: UploadedDocument, context: ExtractContext): Promise<Graph> {
  const paper = findDemoPaper(context.demoPapers, document);
  if (!paper) {
    throw new ApiError(404, 'not-a-demo-paper', 'demo-replay only knows the two demo papers. Pick another model for this file.');
  }
  const { graph } = paper;
  const steps = [
    `This is a replay of saved output for "${graph.paper.title}". No extraction is running.`,
    'Opening the saved graph',
    `Loading ${graph.nodes.length} saved nodes and ${graph.edges.length} saved edges`,
    'Returning the saved output',
  ];
  for (const message of steps) {
    context.emit({ type: 'status', message });
    await wait(context.config.replayMs / steps.length, undefined, { signal: context.signal });
  }
  return graph;
}

export const demoReplay: ExtractModel = {
  id: 'demo-replay',
  label: 'Demo replay (saved output)',
  description: 'Replays the saved graph for the two demo papers. No extraction runs. Any other file is refused.',
  default: true,
  run: replay,
};
