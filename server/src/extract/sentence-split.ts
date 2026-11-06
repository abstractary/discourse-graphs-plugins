import { extname } from 'node:path';
import type { Graph, GraphEdge, GraphNode } from '../types.ts';
import { readDocumentText } from './document.ts';
import type { UploadedDocument } from './document.ts';
import type { ExtractContext, ExtractModel } from './model.ts';

const MAX_CLAIMS = 12;
const MAX_EVIDENCE = 30;
const MIN_WORDS = 4;
const MAX_COMMAS_PER_WORD = 0.2;

const ABBREVIATION = /\b(?:al|e\.g|i\.e|vs|fig|figs|dr|prof|no|ref|refs|eq|approx|ca)\.$/i;
const INITIAL = /\b[A-Z]\.$/;

const STAND_IN_NOTE = 'Rough stand-in: sentences sorted by simple rules. No AI read this document.';

type Sentence = { id: string; index: number; text: string; type: 'Question' | 'Evidence' | 'Claim' };

function cleanMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '');
}

// Reference lists are full of numbers, so they would all read as Evidence.
function dropReferences(text: string): string {
  return text.split(/^\s*#*\s*(?:references|bibliography)\s*$/im)[0];
}

// A PDF's front page runs author lists and affiliations together with the prose.
// They split like sentences, but they have far more commas than prose does.
function isProse(sentence: string): boolean {
  const wordCount = sentence.split(' ').length;
  const commas = sentence.split(',').length - 1;
  return wordCount >= MIN_WORDS && commas / wordCount < MAX_COMMAS_PER_WORD;
}

export function splitSentences(text: string): string[] {
  const paragraphs = dropReferences(text)
    .replace(/-\n(?=[a-z])/g, '')
    .split(/\n\s*\n/);
  const sentences: string[] = [];
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').filter((line) => !line.trim().startsWith('#'));
    const flat = lines.map(cleanMarkdown).join(' ').replace(/\s+/g, ' ').trim();
    let current = '';
    for (const piece of flat.split(/(?<=[.!?]["')\]]?)\s+(?=["'([]?[A-Z0-9])/)) {
      current = current ? `${current} ${piece}` : piece;
      if (ABBREVIATION.test(current) || INITIAL.test(current)) continue;
      sentences.push(current);
      current = '';
    }
    if (current) sentences.push(current);
  }
  return sentences.filter(isProse);
}

function classify(sentences: string[]): Sentence[] {
  let claims = 0;
  let evidence = 0;
  const kept: Sentence[] = [];
  const keep = (index: number, text: string, type: Sentence['type']): void => {
    kept.push({ id: `g${kept.length + 1}`, index, text, type });
  };
  for (const [index, text] of sentences.entries()) {
    if (text.includes('?')) {
      keep(index, text, 'Question');
    } else if (/\d/.test(text)) {
      if (evidence < MAX_EVIDENCE) keep(index, text, 'Evidence');
      evidence += 1;
    } else {
      if (claims < MAX_CLAIMS) keep(index, text, 'Claim');
      claims += 1;
    }
  }
  return kept;
}

function titleOf(filename: string, text: string): string {
  const heading = /^#\s+(.+)$/m.exec(text);
  return heading ? heading[1].trim() : filename.slice(0, filename.length - extname(filename).length);
}

export function graphFromText(filename: string, text: string): Graph {
  const title = titleOf(filename, text);
  const sentences = classify(splitSentences(text));
  const nodes: GraphNode[] = [
    { id: 'g0', type: 'SourceDocument', text: title, description: STAND_IN_NOTE },
    ...sentences.map(({ id, type, text: sentence }) => ({ id, type, text: sentence, anchor: sentence })),
  ];
  const claims = sentences.filter((sentence) => sentence.type === 'Claim');
  const question = sentences.find((sentence) => sentence.type === 'Question');
  const edges: GraphEdge[] = [];
  for (const sentence of sentences) {
    if (sentence.type !== 'Evidence' || claims.length === 0) continue;
    const distance = (claim: Sentence): number => Math.abs(claim.index - sentence.index);
    const nearest = claims.reduce((best, claim) => (distance(claim) < distance(best) ? claim : best));
    edges.push({ relation: 'supports', subject: sentence.id, object: nearest.id });
  }
  if (question) {
    for (const claim of claims) {
      edges.push({ relation: 'addresses', subject: claim.id, object: question.id });
    }
  }
  return { source: filename, models: ['sentence-split'], paper: { title }, nodes, edges };
}

async function split(document: UploadedDocument, { emit }: ExtractContext): Promise<Graph> {
  emit({ type: 'status', message: 'This is a rough stand-in, not an AI extraction. Sentences are sorted by simple rules.' });
  emit({ type: 'status', message: 'Reading the document' });
  const text = await readDocumentText(document);
  emit({ type: 'status', message: 'Splitting the text into sentences' });
  return graphFromText(document.filename, text);
}

export const sentenceSplit: ExtractModel = {
  id: 'sentence-split',
  label: 'Sentence split (rough stand-in)',
  description: 'A rough stand-in with no AI and no network. Sorts sentences into Questions, Evidence and Claims by simple rules.',
  run: split,
};
