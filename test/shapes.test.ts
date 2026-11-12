import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { JsonObject } from "@dg/contract/records.ts";
import { SHAPE_RULES, shapeProblems } from "@dg/core/shapes.ts";

type Expect = { focus: string; rule: string; severity: string };
type Case = { name: string; patch: Record<string, Record<string, unknown>>; add?: JsonObject[]; expect: Expect[] };
const suite = JSON.parse(readFileSync(new URL("../ontology/tests/cases.json", import.meta.url), "utf8")) as { base: JsonObject[]; cases: Case[] };
const shacl = readFileSync(new URL("../ontology/dg_process.shacl.ttl", import.meta.url), "utf8");

const key = ({ focus, rule, severity }: Expect): string => `${focus} ${rule} ${severity}`;

const graphOf = (item: Case): JsonObject[] => {
  const nodes = structuredClone(suite.base) as Record<string, unknown>[];
  for (const [short, changes] of Object.entries(item.patch)) {
    const node = nodes.find((candidate) => candidate.id === `urn:dg:${short}`)!;
    for (const [field, value] of Object.entries(changes)) {
      if (value === null) delete node[field];
      else node[field] = value;
    }
  }
  return [...nodes, ...(item.add ?? [])] as JsonObject[];
};

// The same cases run through pyshacl in `ontology/validate.py --self-test`.
for (const item of suite.cases) {
  test(`shapes: ${item.name}`, () => {
    const got = [...new Set(shapeProblems({ "@graph": graphOf(item) }).map(key))].sort();
    assert.deepEqual(got, [...new Set(item.expect.map(key))].sort());
  });
}

test("shapes: every rule in the SHACL file has a twin here, with the same severity and message", () => {
  const declared = shacl
    .split(/\n(?=dgs:)/)
    .map((block) => [block, /^dgs:([a-z][A-Za-z-]+) a sh:(?:PropertyShape|NodeShape) ;/.exec(block)?.[1], block] as const)
    .filter(([, name]) => name);
  const names = declared.map(([, name]) => name!).sort();
  assert.deepEqual(names, Object.keys(SHAPE_RULES).sort());
  for (const [, name, body] of declared) {
    const rule = SHAPE_RULES[name as keyof typeof SHAPE_RULES];
    const severity = /sh:severity sh:(\w+)/.exec(body!)?.[1] ?? "Violation";
    assert.equal(rule.severity, severity, name);
    const message = /sh:message "((?:[^"\\]|\\.)*)"/.exec(body!)?.[1];
    assert.equal(rule.message, message, name);
  }
});

test("shapes: every rule has a case that breaks it", () => {
  const covered = new Set(suite.cases.flatMap((item) => item.expect.map((expected) => expected.rule)));
  assert.deepEqual(Object.keys(SHAPE_RULES).filter((rule) => !covered.has(rule)), []);
});
