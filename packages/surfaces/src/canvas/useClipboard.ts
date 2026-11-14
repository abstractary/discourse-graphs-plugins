import { useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import { clipFromTransfer, writeClip, type Clip } from "./clipboard.ts";

type Point = { x: number; y: number };

/**
 * Copy, cut and paste go through the clipboard, so they work between canvases
 * and tabs. This listens and sorts out what was pasted; what each one does to
 * the canvas is the caller's.
 */
export const useClipboard = (handlers: {
  /** The selection as a clip and as text, or null when nothing is picked. */
  copy: () => { clip: Clip; text: string } | null;
  cut: (ids: string[], label: string) => void;
  paste: (clip: Clip, at: Point | null) => void;
  pictures: (files: File[], at: Point | null) => void;
  text: (text: string, at: Point | null) => void;
  notify: (message: string) => void;
}) => {
  const flow = useReactFlow();
  /** Where the pointer last was over the canvas, so a paste lands there. */
  const pointer = useRef<Point | null>(null);
  // Read through a ref, so the listeners are set once and still act on the canvas as it is now.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const typing = (event: Event): boolean => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return true;
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    };
    const copy = (event: ClipboardEvent, cut: boolean): void => {
      if (typing(event) || !event.clipboardData) return;
      const copied = latest.current.copy();
      if (!copied) return;
      const { clip } = copied;
      event.preventDefault();
      writeClip(event.clipboardData, clip, copied.text);
      const count = clip.items.filter((entry) => !("fromNode" in entry.item)).length;
      if (cut) latest.current.cut(clip.items.map((entry) => entry.id), `Cut ${count === 1 ? "1 item" : `${count} items`}`);
      else latest.current.notify(count === 1 ? "Copied 1 item" : `Copied ${count} items`);
    };
    const onCopy = (event: ClipboardEvent) => copy(event, false);
    const onCut = (event: ClipboardEvent) => copy(event, true);
    const onPaste = (event: ClipboardEvent): void => {
      if (typing(event)) return;
      const at = pointer.current ? flow.screenToFlowPosition(pointer.current) : null;
      const clip = clipFromTransfer(event.clipboardData);
      if (clip) {
        event.preventDefault();
        latest.current.paste(clip, at);
        return;
      }
      const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (pasted.length) {
        event.preventDefault();
        latest.current.pictures(pasted, at);
        return;
      }
      const text = event.clipboardData?.getData("text/plain").trim();
      if (text) {
        event.preventDefault();
        latest.current.text(text, at);
      }
    };
    // A keyboard copy with nothing selected as text still copies the cards.
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!mod || event.altKey || event.shiftKey || (key !== "c" && key !== "x")) return;
      if (typing(event) || !latest.current.copy()) return;
      event.preventDefault();
      document.execCommand(key === "c" ? "copy" : "cut");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [flow]);

  return {
    onPointerMove: (event: { clientX: number; clientY: number }) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    },
    onPointerLeave: () => {
      pointer.current = null;
    },
  };
};
