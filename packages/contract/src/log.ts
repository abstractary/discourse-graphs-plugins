import type { DgRecord } from "./records.ts";

/**
 * Reading a device's log off disk. A log is one record per line, appended by one device. Between
 * devices the file is carried by whatever syncs the vault, and those tools do things to files:
 * leave the last line half written, join two copies, repeat a stretch, add a conflict copy beside
 * the original, change the line endings, or put a marker where two versions met.
 *
 * None of that may stop the graph from loading. A line that isn't a whole record is skipped and
 * counted. Nothing is repaired or rewritten: the log is only ever appended to by its own device.
 */

/** The whole lines of a log. A last line with no newline after it may still be mid-write, so it waits. */
export const logLines = (text: string): string[] => {
  const lines = text.replace(/^﻿/, "").split("\n");
  lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
};

/** One line as a record, or null when it isn't one: blank, cut short, joined with another, or a merge marker. */
export const parseLogLine = (line: string): DgRecord | null => {
  const text = line.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const value = JSON.parse(text) as Partial<DgRecord> | null;
    return value && typeof value === "object" && typeof value.id === "string" && typeof value.kind === "string" ? (value as DgRecord) : null;
  } catch {
    return null;
  }
};

export const readLog = (text: string): { records: DgRecord[]; skipped: number } => {
  const records: DgRecord[] = [];
  let skipped = 0;
  for (const line of logLines(text)) {
    if (!line.trim()) continue;
    const record = parseLogLine(line);
    if (record) records.push(record);
    else skipped += 1;
  }
  return { records, skipped };
};

/** A small fingerprint of a line, to tell whether a file is still the one that was being read. */
const markOf = (line: string): string => {
  let hash = 2166136261;
  for (let at = 0; at < line.length; at += 1) hash = Math.imul(hash ^ line.charCodeAt(at), 16777619);
  return `${line.length}:${(hash >>> 0).toString(36)}`;
};

export type LogCursor = { line: number; mark?: string };

/**
 * Where to go on reading a log from. A device's own log only grows, so reading resumes after the
 * last line read. A file that was replaced, shortened or joined with another no longer has that
 * line in that place, and is read again from the top. Reading a record twice costs nothing.
 */
export const resumeAt = (lines: string[], cursor: LogCursor | number | undefined): number => {
  const from = typeof cursor === "number" ? { line: cursor } : cursor;
  if (!from || from.line <= 0) return 0;
  if (from.line > lines.length) return 0;
  if (from.mark !== undefined && markOf(lines[from.line - 1]!) !== from.mark) return 0;
  return from.line;
};

export const cursorAfter = (lines: string[], line: number): LogCursor => (line > 0 ? { line, mark: markOf(lines[line - 1]!) } : { line: 0 });
