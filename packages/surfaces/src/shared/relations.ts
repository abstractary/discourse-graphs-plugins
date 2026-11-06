/**
 * One color per relation, wherever a link is drawn. The hues come from MIRA's
 * palette, and each theme sets its own lightness in tokens.css.
 */
const KNOWN = ["supports", "opposes", "addresses", "informs", "derivedFrom", "grounds", "follows", "describesActivity", "requestTarget"];

export const relationColor = (kind: string | undefined): string =>
  kind && KNOWN.includes(kind) ? `var(--rel-${kind})` : "var(--dg-muted)";
