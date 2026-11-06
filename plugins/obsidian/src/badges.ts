import { syntaxTree } from "@codemirror/language";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  MarkdownView,
  editorInfoField,
  editorLivePreviewField,
  getLinkpath,
  type Plugin,
  type TFile,
} from "obsidian";
import type { CoreForAdapter, LinkBadge } from "@dg/contract/core.ts";
import type { HostRef } from "@dg/contract/records.ts";
import {
  BADGE_CLASS,
  createBadge,
  installBadgeStyle,
  paintBadge,
  refOfBadge,
} from "@dg/native/link-badge.ts";

// Not an embed, which shows the note itself rather than pointing at it.
const WIKILINK = /(?<!!)\[\[([^\]\n]+?)\]\]/g;
const LITERAL_TEXT = /code|math|comment/i;
const REFRESH_MS = 120;

type Open = (ref: HostRef) => void;

class BadgeWidget extends WidgetType {
  constructor(
    private readonly ref: HostRef,
    private readonly badge: LinkBadge,
    private readonly open: Open,
  ) {
    super();
  }
  /** Keyed on what it shows, so keystrokes elsewhere leave it alone. */
  override eq(other: BadgeWidget): boolean {
    return (
      other.ref === this.ref &&
      other.badge.count === this.badge.count &&
      other.badge.typeLabel === this.badge.typeLabel &&
      other.badge.color === this.badge.color &&
      other.badge.base === this.badge.base
    );
  }
  toDOM(): HTMLElement {
    return createBadge({ ref: this.ref, badge: this.badge, onOpen: this.open });
  }
  override updateDOM(dom: HTMLElement): boolean {
    if (refOfBadge(dom) !== this.ref) return false;
    paintBadge(dom, this.badge);
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Draws a badge after each link to a node, in Live Preview and in Reading view.
 * Source mode shows raw markdown, where a badge would only get in the way.
 */
export const startBadges = ({
  plugin,
  core,
  refOfFile,
}: {
  plugin: Plugin;
  core: () => CoreForAdapter | undefined;
  /** Synchronous because editors draw synchronously. */
  refOfFile: (file: TFile) => HostRef;
}): { refresh: () => void } => {
  const { workspace, metadataCache } = plugin.app;
  let version = 0;
  const open: Open = (ref) => void core()?.showContext({ ref });

  const lookup = (linktext: string, sourcePath: string): { ref: HostRef; badge: LinkBadge } | null => {
    const file = metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
    if (!file) return null;
    const ref = refOfFile(file);
    const badge = core()?.badgeFor({ ref });
    return badge ? { ref, badge } : null;
  };

  const decorate = (view: EditorView): DecorationSet => {
    const { state } = view;
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const sourcePath = state.field(editorInfoField, false)?.file?.path;
    if (!sourcePath) return Decoration.none;
    const tree = syntaxTree(state);
    const widgets = [];
    for (const { from, to } of view.visibleRanges) {
      for (const match of state.doc.sliceString(from, to).matchAll(WIKILINK)) {
        const start = from + match.index;
        if (LITERAL_TEXT.test(tree.resolveInner(start, 1).name)) continue;
        const found = lookup(match[1]!.split("|")[0]!, sourcePath);
        if (!found) continue;
        widgets.push(
          Decoration.widget({
            widget: new BadgeWidget(found.ref, found.badge, open),
            side: 1,
          }).range(start + match[0].length),
        );
      }
    }
    return Decoration.set(widgets, true);
  };

  plugin.registerEditorExtension(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        drawn = version;
        constructor(view: EditorView) {
          this.decorations = decorate(view);
        }
        update(update: ViewUpdate): void {
          if (!update.docChanged && !update.viewportChanged && this.drawn === version) return;
          this.drawn = version;
          this.decorations = decorate(update.view);
        }
      },
      { decorations: (value) => value.decorations },
    ),
  );

  /** Safe to run again, because Obsidian reuses sections and reruns processors. */
  const applyToReading = (root: HTMLElement, sourcePath: string): void => {
    for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
      const next = link.nextElementSibling;
      const existing = next?.classList.contains(BADGE_CLASS) ? (next as HTMLElement) : null;
      const linktext = link.getAttribute("data-href") ?? link.getAttribute("href");
      const found = linktext ? lookup(linktext, sourcePath) : null;
      if (!found) existing?.remove();
      else if (existing && refOfBadge(existing) === found.ref) paintBadge(existing, found.badge);
      else {
        existing?.remove();
        link.after(createBadge({ ...found, onOpen: open }));
      }
    }
  };

  plugin.registerMarkdownPostProcessor((element, context) => {
    applyToReading(element, context.sourcePath);
  });

  const refreshNow = (): void => {
    version += 1;
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf.view as MarkdownView;
      // An empty transaction changes nothing, and asks the editor to look again.
      (view.editor as unknown as { cm?: EditorView }).cm?.dispatch({});
      const reading = view.containerEl.querySelector<HTMLElement>(".markdown-reading-view");
      if (reading && view.file) applyToReading(reading, view.file.path);
    }
  };

  let timer: number | undefined;
  const refresh = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refreshNow, REFRESH_MS);
  };

  plugin.register(installBadgeStyle());
  plugin.register(() => window.clearTimeout(timer));
  // A new note's link can be drawn before its id is indexed.
  plugin.registerEvent(metadataCache.on("changed", refresh));
  return { refresh };
};
