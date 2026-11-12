import type { CanvasItem } from "@dg/contract/records.ts";

/**
 * What a canvas copies: its items as they are, so a paste on any canvas, in
 * any tab, can put the same units back with their layout. The same copy pastes
 * into a note as the titles. Bases rewrite HTML on paste but keep its
 * attributes, so the items ride in the HTML too, for a base that drops custom
 * types between frames.
 */

export const CLIP_TYPE = "application/x-dg-canvas";

export type Clip = { v: 1; canvas: string; items: { id: string; z: number; item: CanvasItem }[] };

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const writeClip = (data: DataTransfer, clip: Clip, text: string): void => {
  const json = JSON.stringify(clip);
  data.setData(CLIP_TYPE, json);
  data.setData("text/plain", text);
  data.setData("text/html", `<div data-dg-clip="${encodeURIComponent(json)}">${escape(text).replace(/\n/g, "<br>")}</div>`);
};

export const clipFromTransfer = (data: DataTransfer | null): Clip | null => {
  if (!data) return null;
  const html = data.getData("text/html").match(/data-dg-clip="([^"]+)"/)?.[1];
  const raw = data.getData(CLIP_TYPE) || (html ? decodeURIComponent(html) : "");
  if (!raw) return null;
  try {
    const clip = JSON.parse(raw) as Clip;
    return clip?.v === 1 && Array.isArray(clip.items) && typeof clip.canvas === "string" ? clip : null;
  } catch {
    return null;
  }
};
