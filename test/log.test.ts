import assert from "node:assert/strict";
import test from "node:test";
import { cursorAfter, logLines, readLog, resumeAt } from "@dg/contract/log.ts";

// A device's log, after a file-sync tool has had it. Nothing here may stop a vault from loading.

const line = (id: string): string => JSON.stringify({ v: 2, id, kind: "node", title: `Unit ${id}` });
const ids = (text: string): string[] => readLog(text).records.map((record) => record.id);

test("a log reads whole records and skips what a sync tool broke", () => {
  const clean = `${["a", "b", "c"].map(line).join("\n")}\n`;
  assert.deepEqual(ids(clean), ["a", "b", "c"]);
  // The last line is still being written: it waits, and is not counted as broken.
  assert.deepEqual(readLog(`${clean}${line("d").slice(0, 20)}`), { records: readLog(clean).records, skipped: 0 });
  // Windows line endings and a byte-order mark.
  assert.deepEqual(ids(`﻿${["a", "b"].map(line).join("\r\n")}\r\n`), ["a", "b"]);
  // Two copies joined with markers, a line cut short in the middle, two records run together, and a blank line.
  const joined = [line("a"), "<<<<<<< HEAD", line("b").slice(0, 15), "=======", line("b"), ">>>>>>> other", "", line("c") + line("d"), "null", "[1,2]", '{"id":7,"kind":"node"}', line("e")].join("\n") + "\n";
  const read = readLog(joined);
  assert.deepEqual(read.records.map((record) => record.id), ["a", "b", "e"]);
  assert.equal(read.skipped, 8, "every broken line is counted, so it can be said");
  // A stretch carried twice is read twice. Whoever reads it drops the repeats.
  assert.deepEqual(ids(`${clean}${clean}`), ["a", "b", "c", "a", "b", "c"]);
  assert.deepEqual(readLog(""), { records: [], skipped: 0 });
});

test("reading resumes where it stopped, unless the file is no longer the one that was being read", () => {
  const first = logLines(`${["a", "b", "c"].map(line).join("\n")}\n`);
  const cursor = cursorAfter(first, 3);
  // The device appended: go on from the fourth line.
  assert.equal(resumeAt(logLines(`${["a", "b", "c", "d"].map(line).join("\n")}\n`), cursor), 3);
  // A sync tool put lines in ahead of where reading stopped: read it again from the top.
  assert.equal(resumeAt(logLines(`${["x", "a", "b", "c", "d"].map(line).join("\n")}\n`), cursor), 0);
  // The file was replaced by a shorter one.
  assert.equal(resumeAt(logLines(`${line("a")}\n`), cursor), 0);
  // A cursor saved by an earlier version of the app was a bare line number, and is still read.
  assert.equal(resumeAt(first, 2), 2);
  assert.equal(resumeAt(first, undefined), 0);
});
