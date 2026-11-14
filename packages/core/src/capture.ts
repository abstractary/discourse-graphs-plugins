import { createAnchor, createNode, formatTitle, parseTitle, revise, type DgId, type HostRef } from "@dg/contract/records.ts";
import { fail, ok, type Result } from "@dg/contract/host.ts";
import type { Captured, CaptureRequest } from "@dg/contract/core.ts";
import type { Context } from "./context.ts";
import { fillTemplate } from "./grammar.ts";

/**
 * A unit from the words in a note: a sentence that is selected, the note that is open, or a title
 * typed somewhere. Also the way back: renaming a note renames its unit.
 */
export const captureFeature = (
  context: Context,
  { canvasFormat, moveFocus }: { /** How a canvas's own page or note is named in this base. */ canvasFormat: string; moveFocus: (node: DgId | null) => void },
) => {
  const { host, put } = context;

  const capture = async ({ text, type }: CaptureRequest): Promise<Result<Captured>> => {
    const stamp = context.stamp();
    const nodeType = context.typeOf(type);
    const node = createNode({ ...stamp, title: text, ...(type ? { type } : {}) });
    const created = await host.createText({
      title: formatTitle({
        content: text,
        ...(nodeType?.titleFormat ? { format: nodeType.titleFormat } : {}),
      }),
      // A type's template is what its new note starts with.
      ...(nodeType?.template ? { body: fillTemplate(nodeType.template, { title: text, type: nodeType.label, author: context.me().name, date: node.at.slice(0, 10) }) } : {}),
      unit: node.id,
    });
    if (!created.ok) {
      const { code, ref } = created.error;
      if (code !== "conflict" || !ref) return created;
      // The same title again means the same idea, so link to it rather than fail.
      const known = context.anchoredAt(ref);
      if (known) return ok({ node: known, ref, title: text });
      await put([node, createAnchor({ ...stamp, node: node.id, ref })]);
      return ok({ node: node.id, ref, title: text });
    }
    await put([node, createAnchor({ ...stamp, node: node.id, ref: created.value.ref })]);
    return ok({ node: node.id, ref: created.value.ref, title: text });
  };

  const captureSelection = async ({ type }: { type?: DgId }): Promise<Result<Captured>> => {
    const selection = await host.readSelection();
    if (!selection.ok) return selection;
    const text = selection.value?.text.replace(/\s+/g, " ").trim();
    if (!text) return fail("no-target", "Select some text first.");
    const captured = await capture({ text, ...(type ? { type } : {}) });
    if (!captured.ok) return captured;
    const replaced = await host.replaceSelection({ ref: captured.value.ref });
    if (!replaced.ok) return replaced;
    moveFocus(captured.value.node);
    return captured;
  };

  const convertFocused = async ({ type }: { type?: DgId }): Promise<Result<Captured>> => {
    const focus = await host.getFocus();
    if (!focus.ok) return focus;
    const { ref } = focus.value;
    if (!ref) return fail("no-target", "Open a page first.");
    const known = context.anchoredAt(ref);
    if (known) return ok({ node: known, ref, title: context.nodeOf(known)?.title ?? "" });
    const text = await host.readText({ ref });
    if (!text.ok) return text;
    const content = text.value.title;
    const stamp = context.stamp();
    const node = createNode({ ...stamp, title: content, ...(type ? { type } : {}) });
    const pinned = await host.pinText({ ref, unit: node.id });
    if (!pinned.ok) return pinned;
    await put([node, createAnchor({ ...stamp, node: node.id, ref: pinned.value.ref })]);
    const format = context.typeOf(type)?.titleFormat;
    if (format) {
      const renamed = await host.renameText({ ref: pinned.value.ref, title: formatTitle({ content, format }) });
      if (!renamed.ok) return renamed;
    }
    moveFocus(node.id);
    return ok({ node: node.id, ref: pinned.value.ref, title: content });
  };

  /** A note renamed in the base: its canvas or unit takes the new name. */
  const onRenamed = async (ref: HostRef, title: string): Promise<void> => {
    const me = context.me();
    const anchored = context.anchoredAt(ref);
    const canvas = anchored ? context.canvasOf(anchored) : undefined;
    if (canvas) {
      const name = parseTitle({ format: canvasFormat, title }) ?? title;
      if (name === canvas.title) return;
      // A PDF canvas and its paper go by one name, so renaming the one renames the other.
      const paper = canvas.paper ? context.graph().documents.get(canvas.paper) : undefined;
      await put([
        revise({ record: canvas, changes: { title: name }, by: me }),
        ...(paper?.kind === "paper" && paper.title !== name ? [revise({ record: paper, changes: { title: name }, by: me })] : []),
      ]);
      return;
    }
    const node = anchored ? context.nodeOf(anchored) : undefined;
    if (!node) return;
    const format = context.typeOf(node.type)?.titleFormat;
    const content = (format ? parseTitle({ format, title }) : null) ?? title;
    if (content === node.title) return;
    await put([revise({ record: node, changes: { title: content }, by: me })]);
  };

  return { capture, captureSelection, convertFocused, onRenamed };
};
