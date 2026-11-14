/**
 * Finding a quote in a PDF's text, the way a W3C TextQuoteSelector is found:
 * by its words, wherever they sit now. Nothing here touches the DOM, so the
 * same matching runs in tests.
 */

/** What pdf.js gives for each run of text on a page. */
export type TextPiece = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };

type Spot = { page: number; item: number; from: number; to: number };

/** A document's text, folded so a selection and an extracted passage compare equal. */
export type DocText = { text: string; spots: Spot[]; starts: number[] };

/** A box in page space at scale 1, origin top left. */
export type Box = { x: number; y: number; width: number; height: number };

const space = /\s/;

export const foldText = (pages: TextPiece[][]): DocText => {
  let text = "";
  const spots: Spot[] = [];
  const starts: number[] = [];
  const push = (char: string, spot: Spot) => {
    text += char;
    spots.push(spot);
  };
  pages.forEach((items, page) => {
    if (text && !text.endsWith(" ")) push(" ", { page, item: -1, from: 0, to: 0 });
    starts.push(text.length);
    items.forEach((piece, item) => {
      const folded = piece.str.normalize("NFKC").toLowerCase();
      for (let i = 0; i < folded.length; i += 1) {
        const char = folded[i]!;
        const spot = { page, item, from: i / folded.length, to: (i + 1) / folded.length };
        if (space.test(char)) {
          if (text && !text.endsWith(" ")) push(" ", spot);
        } else push(char, spot);
      }
      if (piece.hasEOL) {
        // A word broken across lines joins up again, as the quote's own folding does.
        if (text.endsWith("-")) {
          text = text.slice(0, -1);
          spots.pop();
        } else if (text && !text.endsWith(" ")) push(" ", { page, item, from: 1, to: 1 });
      }
    });
  });
  return { text, spots, starts };
};

export const foldQuote = (quote: string): string =>
  quote.normalize("NFKC").replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Where a quote starts and how long it runs, searching its own page first. Null when it isn't there. */
export const findQuote = (doc: DocText, quote: string, page?: number): { at: number; length: number } | null => {
  const wanted = foldQuote(quote);
  if (!wanted) return null;
  const from = page !== undefined && page >= 1 ? (doc.starts[page - 1] ?? 0) : 0;
  const look = (needle: string): number => {
    const near = doc.text.indexOf(needle, from);
    return near >= 0 ? near : doc.text.indexOf(needle);
  };
  const whole = look(wanted);
  if (whole >= 0) return { at: whole, length: wanted.length };
  // An extracted passage may differ in a word or two: anchor on its opening, or its close.
  const SPAN = 60;
  if (wanted.length <= SPAN + 20) return null;
  const head = look(wanted.slice(0, SPAN));
  if (head >= 0) return { at: head, length: Math.min(wanted.length, doc.text.length - head) };
  const tail = look(wanted.slice(-SPAN));
  if (tail >= 0) {
    const at = Math.max(0, tail - (wanted.length - SPAN));
    return { at, length: tail + SPAN - at };
  }
  return null;
};

/**
 * The boxes a stretch of text covers, per page, in page space at scale 1.
 * `toView` turns a PDF rectangle into the page's own top-left coordinates.
 */
export const boxesFor = (
  doc: DocText,
  found: { at: number; length: number },
  pieces: TextPiece[][],
  toView: (page: number, rect: [number, number, number, number]) => [number, number, number, number],
): Map<number, Box[]> => {
  const runs = new Map<string, { page: number; item: number; from: number; to: number }>();
  for (const spot of doc.spots.slice(found.at, found.at + found.length)) {
    if (spot.item < 0) continue;
    const key = `${spot.page}:${spot.item}`;
    const run = runs.get(key);
    if (run) {
      run.from = Math.min(run.from, spot.from);
      run.to = Math.max(run.to, spot.to);
    } else runs.set(key, { ...spot });
  }
  const out = new Map<number, Box[]>();
  for (const run of runs.values()) {
    const piece = pieces[run.page]?.[run.item];
    if (!piece || run.to <= run.from) continue;
    const [, , c, d, x, y] = piece.transform as [number, number, number, number, number, number];
    const height = piece.height || Math.hypot(c, d);
    const [x1, y1, x2, y2] = toView(run.page, [x + piece.width * run.from, y - height * 0.22, x + piece.width * run.to, y + height * 0.86]);
    const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    const list = out.get(run.page) ?? [];
    // Runs on the same line become one box, so a mark reads as a stroke, not a row of tiles.
    const line = list.find((b) => Math.abs(b.y - box.y) < box.height * 0.4 && box.x <= b.x + b.width + 4 && box.x + box.width >= b.x - 4);
    if (line) {
      const right = Math.max(line.x + line.width, box.x + box.width);
      line.x = Math.min(line.x, box.x);
      line.width = right - line.x;
      line.height = Math.max(line.height, box.height);
    } else list.push(box);
    out.set(run.page, list);
  }
  return out;
};
