/**
 * How searched words are matched and marked, shared by core's ranking and the
 * panels that light the words up: case, accents and ligatures fold away, and
 * "quoted phrases" stay whole. Positions map back to the original text, so a
 * mark lands on exactly what the person reads.
 */

export type TextMarks = [number, number][];

/** Folds case, accents and ligatures, keeping where each folded character came from. */
export const foldWithMap = (text: string): { folded: string; map: number[] } => {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const plain = char.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < plain.length; k += 1) map.push(index);
    folded += plain;
    index += char.length;
  }
  map.push(index);
  return { folded, map };
};

export const fold = (text: string): string => foldWithMap(text).folded;

/** Words, with "quoted phrases" kept whole. */
export const wordsOf = (query: string): string[] => {
  const words: string[] = [];
  for (const match of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const word = fold((match[1] ?? match[2] ?? "").replace(/\s+/g, " ").trim());
    if (word) words.push(word);
  }
  return words;
};

/** Every place each word turns up, in the original text's positions, with overlaps merged. */
export const marksOf = (text: string, words: string[], folded = foldWithMap(text)): TextMarks => {
  const marks: TextMarks = [];
  for (const word of words) {
    let from = 0;
    for (;;) {
      const at = folded.folded.indexOf(word, from);
      if (at < 0) break;
      marks.push([folded.map[at]!, folded.map[at + word.length]!]);
      from = at + word.length;
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: TextMarks = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
    else merged.push([mark[0], mark[1]]);
  }
  return merged;
};
