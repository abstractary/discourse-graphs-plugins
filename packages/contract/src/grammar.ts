import type { BaseNodeType } from "./records.ts";

/**
 * What every base and panel shares about a lab's grammar: the nine kinds of
 * unit in plain words, the starter text for a type's template, and how a
 * template's blanks are filled.
 */

/** Each base, as a person choosing one would read it. */
export const BASE_WORDS: Record<BaseNodeType, { name: string; says: string }> = {
  question: { name: "Question", says: "Something the work is trying to answer." },
  claim: { name: "Claim", says: "An answer someone argues for." },
  evidence: { name: "Evidence", says: "One observation, for or against a claim." },
  source: { name: "Source", says: "A paper or document something was read from." },
  study: { name: "Study", says: "A planned investigation: its design, conditions and protocols." },
  protocol: { name: "Protocol", says: "A method, written so it can be followed again." },
  run: { name: "Run", says: "One time a protocol was carried out." },
  code: { name: "Code", says: "A script or program a run used." },
  output: { name: "Output", says: "A file or figure a run produced." },
};

/** What a type starts with when a lab hasn't written its own. One per process base, in the words a lab notebook uses. */
export const STARTER_TEMPLATES: Partial<Record<BaseNodeType, string>> = {
  study: ["## Aim", "", "## Hypothesis", "", "## Design", "", "- Conditions:", "- What is measured:", "- Sample size:", "", "## Protocols", ""].join("\n"),
  protocol: ["## Purpose", "", "## Materials", "", "- ", "", "## Steps", "", "1. ", "", "## Notes", ""].join("\n"),
  run: ["**Date:** {date}", "**By:** {author}", "", "## What was done", "", "## Departures from the protocol", "", "## Observations", "", "## Files and images", ""].join("\n"),
  evidence: ["## What was observed", "", "## Where", "", "## Caveats", ""].join("\n"),
  claim: ["## The claim", "", "## What it rests on", "", "## What would change my mind", ""].join("\n"),
  question: ["## Why it matters", "", "## What would answer it", ""].join("\n"),
};

/** A template with its blanks filled in for one unit. */
export const fillTemplate = (template: string, values: { title: string; type: string; author: string; date: string }): string =>
  template.replace(/\{(title|type|author|date)\}/g, (_, key: keyof typeof values) => values[key]);

