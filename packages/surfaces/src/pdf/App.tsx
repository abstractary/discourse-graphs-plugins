import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getDocument, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type PageViewport } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.mjs";
import type { NodeTypeRecord } from "@dg/contract/records.ts";
import type { CanvasSummary, PdfDocument, PdfMark } from "@dg/contract/surface.ts";
import { captureChoices } from "@dg/contract/keys.ts";
import type { Connection } from "../shared/rpc.ts";
import { Highlighted, Icon, plain, LibraryMark } from "../shared/ui.tsx";

type LibraryState = { on: boolean; wanted: boolean; reachable: boolean; files: number; problem?: string };
import { useFit } from "../shared/fit.ts";
import { boxesFor, findQuote, foldText, type Box, type DocText, type TextPiece } from "./quote.ts";
import { sizeOf, messageOf } from "../shared/words.ts";

/**
 * A PDF reader beside the canvas. Highlighting words offers to make them a
 * unit: pick its type, by letter as in a note, and the canvas it goes on. The
 * passages units were read from stay lit, in their type's hue, and clicking
 * one moves the context panel to its unit.
 *
 * pdf.js runs in this frame's own thread, because a panel's content policy
 * allows no workers. That's fine for papers, which are tens of pages.
 */
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorker;

const GUTTER = 16;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const STEP = 1.2;
const NOTICE_MS = 9000;
const MAIN_TYPES = ["question", "claim", "evidence", "source"];

type Loaded = {
  ref: string;
  pdf: PDFDocumentProxy;
  close: () => void;
  views: PageViewport[];
  pieces: TextPiece[][];
  folded: DocText;
  title: string | undefined;
};
type Placed = { mark: PdfMark; boxes: Map<number, Box[]> };
type Cut = { exact: string; page: number; left: number; top: number; boxes: Box[] };
type CanvasChoice = string | "new" | "none";

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const readFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
/** A PDF rectangle in the page's own top-left space. */
const toView = (view: PageViewport, [x1, y1, x2, y2]: [number, number, number, number]): [number, number, number, number] => {
  const [a, b] = view.convertToViewportPoint(x1, y1) as [number, number];
  const [c, d] = view.convertToViewportPoint(x2, y2) as [number, number];
  return [a, b, c, d];
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, on, route } = connection;
  const [docs, setDocs] = useState<PdfDocument[] | null>(null);
  const [ref, setRef] = useState<string | null>(route.id ?? null);
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [marks, setMarks] = useState<PdfMark[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState("");
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set([0]));
  const [pageNow, setPageNow] = useState(1);
  const [cut, setCut] = useState<Cut | null>(null);
  const [picker, setPicker] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<{ mark: PdfMark; x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<unknown> } | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLElement>(null);
  // Labels show while they fit, as on the canvas bar.
  const barFit = useFit(bar, [loaded, ref, marks.length]);
  const pageEls = useRef(new Map<number, HTMLDivElement>());

  const report = useCallback((error: unknown) => setProblem(messageOf(error)), []);
  const say = useCallback((text: string, undo?: () => Promise<unknown>) => setNotice({ text, ...(undo ? { undo } : {}) }), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Whether the reference library is the PDF library, and whether it is answering. */
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const refreshDocs = useCallback(() => {
    void call("pdf.list", {}).then(setDocs).catch(report);
    void call("pdf.library", {}).then(setLibrary).catch(() => setLibrary(null));
  }, [call, report]);
  useEffect(refreshDocs, [refreshDocs]);

  // Opening a file: its bytes once, its marks again whenever the graph changes.
  useEffect(() => {
    if (!ref) return;
    let gone = false;
    setLoaded(null);
    setProblem("");
    setCut(null);
    setActive(null);
    void (async () => {
      try {
        const opened = await call("pdf.open", { ref });
        if (gone) return;
        setDoc(opened.document);
        setMarks(opened.marks);
        if (opened.reveal) setReveal(opened.reveal);
        const task = getDocument({ data: fromBase64(opened.dataBase64), useWasm: false } as never);
        const pdf = await task.promise;
        const views: PageViewport[] = [];
        const pieces: TextPiece[][] = [];
        for (let number = 1; number <= pdf.numPages; number += 1) {
          const page = await pdf.getPage(number);
          views.push(page.getViewport({ scale: 1 }));
          pieces.push((await page.getTextContent()).items.filter((item): item is TextItem => "str" in item));
        }
        const meta = (await pdf.getMetadata().catch(() => null)) as { info?: { Title?: string } } | null;
        if (gone) return void task.destroy();
        setLoaded({ ref, pdf, close: () => void task.destroy(), views, pieces, folded: foldText(pieces), title: meta?.info?.Title?.trim() || undefined });
        setVisible(new Set([0, 1]));
        scroller.current?.scrollTo({ top: 0 });
      } catch (error) {
        if (!gone) report(error);
      }
    })();
    return () => {
      gone = true;
    };
  }, [ref, call, report]);
  useEffect(() => () => loaded?.close(), [loaded]);

  /** Reads the whole paper into a graph: from the saved extraction beside it, or else by asking where to read it. */
  const [extracting, setExtracting] = useState(false);
  const extractGraph = useCallback(async () => {
    if (!ref || !doc || extracting) return;
    setExtracting(true);
    try {
      const saved = await call("paper.saved", { name: doc.name, ref });
      if (!saved) {
        await call("dialog.open", { surface: "upload", id: ref });
        return;
      }
      const paper = await call("paper.extract", { ref, saved: true });
      say(`Read ${paper.units} units and ${paper.relations} links from ${saved.name}.`);
      await call("canvas.show", { id: paper.canvas });
    } catch (error) {
      report(error);
    } finally {
      setExtracting(false);
    }
  }, [call, doc, extracting, ref, report, say]);

  const rereadMarks = useCallback(() => {
    if (!ref) return;
    void call("pdf.open", { ref, data: false }).then((opened) => {
      setDoc(opened.document);
      setMarks(opened.marks);
    }).catch(report);
  }, [call, ref, report]);
  useEffect(() => on("graph-changed", () => {
    rereadMarks();
    refreshDocs();
  }), [on, rereadMarks, refreshDocs]);
  useEffect(() => on("pdf-reveal", (message) => {
    if (message.ref === ref) setReveal(message.unit);
    else setRef(message.ref);
  }), [on, ref]);
  // A card was picked on a canvas: if its passage is in this paper, go to it.
  const placedRef = useRef<{ shown: Placed[] }>({ shown: [] });
  useEffect(() => on("pdf-follow", ({ unit }) => {
    if (placedRef.current.shown.some((entry) => entry.mark.unit.id === unit)) setReveal(unit);
  }), [on]);
  // A passage that was gone to is marked for a moment, then let go.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // Fit the page width to the frame, unless the person zoomed.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [loaded]);
  const widest = loaded ? Math.max(...loaded.views.map((view) => view.width)) : 0;
  useEffect(() => {
    if (fit && widest && width) setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, (width - GUTTER * 2) / widest)));
  }, [fit, widest, width]);
  const zoom = (factor: number) => {
    setFit(false);
    setScale((old) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor)));
  };

  // Only pages near the view are drawn.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !loaded) return;
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((old) => {
          const next = new Set(old);
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
          }
          return next;
        }),
      { root, rootMargin: "800px 0px" },
    );
    for (const el of pageEls.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [loaded, scale]);

  const placed = useMemo((): { shown: Placed[]; missing: PdfMark[] } => {
    if (!loaded) return { shown: [], missing: [] };
    const shown: Placed[] = [];
    const missing: PdfMark[] = [];
    for (const mark of marks) {
      const found = findQuote(loaded.folded, mark.exact, mark.page);
      const boxes = found ? boxesFor(loaded.folded, found, loaded.pieces, (page, rect) => toView(loaded.views[page]!, rect)) : null;
      if (boxes && boxes.size) shown.push({ mark, boxes });
      else missing.push(mark);
    }
    return { shown, missing };
  }, [loaded, marks]);
  placedRef.current = placed;

  // Scroll to a unit's passage, asked for from the context panel or the list.
  useEffect(() => {
    if (!reveal || !loaded) return;
    const hit = placed.shown.find((entry) => entry.mark.unit.id === reveal);
    if (!hit) return;
    const [page, boxes] = [...hit.boxes.entries()][0]!;
    const el = pageEls.current.get(page);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop + (boxes[0]?.y ?? 0) * scale - 80, behavior: "smooth" });
    setFlash(reveal);
    justRevealed.current = { unit: reveal, at: Date.now() };
    setReveal(null);
  }, [reveal, loaded, placed, scale]);

  // The pane often changes width just after a passage is asked for, as a canvas opens beside it. The pages
  // rescale, and the spot scrolled to is no longer the passage. So for a few seconds it is found again.
  const justRevealed = useRef<{ unit: string; at: number } | null>(null);
  useEffect(() => {
    const asked = justRevealed.current;
    if (!asked || !loaded || Date.now() - asked.at > 5000) return;
    const hit = placed.shown.find((entry) => entry.mark.unit.id === asked.unit);
    if (!hit) return;
    const frame = requestAnimationFrame(() => {
      const [page, boxes] = [...hit.boxes.entries()][0]!;
      const el = pageEls.current.get(page);
      if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop + (boxes[0]?.y ?? 0) * scale - 80 });
    });
    return () => cancelAnimationFrame(frame);
  }, [scale, placed, loaded]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const line = el.scrollTop + el.clientHeight / 3;
    let now = 1;
    for (const [index, page] of pageEls.current) if (page.offsetTop <= line) now = Math.max(now, index + 1);
    setPageNow(now);
    setHover(null);
  };
  const goTo = (number: number) => {
    const el = pageEls.current.get(number - 1);
    if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 8 });
  };

  // A highlight offers to become a unit.
  const readSelection = useCallback(() => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const text = selection.toString();
    if (!text.trim()) return;
    const range = selection.getRangeAt(0);
    const start = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>("[data-index]");
    if (!start || !scroller.current?.contains(start)) return;
    const index = Number(start.dataset.index);
    const frame = start.getBoundingClientRect();
    const boxes = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.top >= frame.top - 2 && r.bottom <= frame.bottom + 2)
      .map((r) => ({ x: (r.left - frame.left) / scale, y: (r.top - frame.top) / scale, width: r.width / scale, height: r.height / scale }));
    const end = range.getBoundingClientRect();
    setCut({ exact: text, page: index + 1, left: end.left, top: end.bottom + 6, boxes });
    setHover(null);
  }, [scale]);

  const markAt = (event: { clientX: number; clientY: number; target: EventTarget }): Placed | null => {
    const page = (event.target as HTMLElement).closest?.<HTMLElement>("[data-index]");
    if (!page) return null;
    const index = Number(page.dataset.index);
    const frame = page.getBoundingClientRect();
    const x = (event.clientX - frame.left) / scale;
    const y = (event.clientY - frame.top) / scale;
    return placed.shown.find((entry) => (entry.boxes.get(index) ?? []).some((b) => x >= b.x - 1 && x <= b.x + b.width + 1 && y >= b.y - 1 && y <= b.y + b.height + 1)) ?? null;
  };
  const pick = (mark: PdfMark) => {
    setActive(mark.unit.id);
    void call("focus.set", { node: mark.unit.id }).catch(report);
    void call("canvas.highlight", { units: [mark.unit.id], brief: true }).catch(report);
  };

  const open = (next: string) => {
    setPicker(false);
    if (next !== ref) setRef(next);
  };
  const add = async (file: File | undefined) => {
    setDropping(false);
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return report(new Error("Only PDFs open here."));
    try {
      const made = await call("pdf.add", { name: file.name, dataBase64: await readFile(file) });
      refreshDocs();
      // With Zotero as the library, a PDF added here is only in this vault until it is added to Zotero too.
      say(`Kept ${made.name}${made.folder ? ` in ${made.folder}` : ""}${library?.on ? ". It is in this vault only. Add it to Zotero to keep it in your library" : ""}`);
      open(made.ref);
    } catch (error) {
      report(error);
    }
  };

  const title = doc?.title ?? loaded?.title ?? "PDF";
  const pageCount = loaded?.views.length ?? 0;

  return (
    <div
      className="pdf-shell"
      data-dg="pdf-shell"
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        void add(event.dataTransfer.files[0]);
      }}
    >
      <header className="pdf-bar" ref={bar} data-fit={barFit}>
        <button type="button" className="pdf-title" data-fit-min="96" aria-haspopup="dialog" aria-expanded={picker} onClick={() => setPicker((on_) => !on_)} data-dg="pdf-picker" title={title}>
          <span>{ref ? title : "Choose a PDF"}</span>
          <Icon name="chevron" />
        </button>
        {loaded ? (
          <div className="pdf-tools" role="toolbar" aria-label="Reading">
            <span className="pdf-page-at" data-dg="pdf-page">
              <input
                aria-label="Page"
                key={pageNow}
                defaultValue={pageNow}
                inputMode="numeric"
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") goTo(Number((event.target as HTMLInputElement).value) || pageNow);
                  if (event.key === "Escape") (event.target as HTMLInputElement).value = String(pageNow);
                }}
                onBlur={(event) => {
                  const wanted = Number(event.target.value);
                  if (wanted && wanted !== pageNow) goTo(wanted);
                  else event.target.value = String(pageNow);
                }}
              />
              <span>of {pageCount}</span>
            </span>
            <button type="button" className="tool" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / STEP)}><Icon name="minus" /></button>
            <button type="button" className="tool pdf-zoom" aria-pressed={fit} title="Fit the page width" onClick={() => setFit(true)} data-dg="pdf-fit">{Math.round(scale * 100)}%</button>
            <button type="button" className="tool" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(STEP)}><Icon name="plus" /></button>
            <button type="button" className="tool keep" aria-haspopup="menu" aria-expanded={listOpen} onClick={() => setListOpen((on_) => !on_)} data-dg="pdf-units" title="Units read from this PDF" aria-label={`${marks.length} units read from this PDF`}>
              <Icon name="marker" /><span className="tool-label">Units</span><span className="pdf-count">{marks.length}</span>
            </button>
          </div>
        ) : null}
        <span className="pdf-gap" data-fit-min="0" />
        {ref && doc && doc.ref === ref ? (
          doc.paper ? (
            <button type="button" className="tool" onClick={() => void call("canvas.show", { id: doc.paper!.canvas }).catch(report)} data-dg="pdf-canvas" title="Open this paper's canvas">
              <Icon name="canvas" /><span className="tool-label">Canvas</span>
            </button>
          ) : (
            <button type="button" className="tool" disabled={extracting} onClick={() => void extractGraph()} data-dg="pdf-extract" title="Read the whole paper into a graph of questions, claims and evidence">
              <Icon name="ai" /><span className="tool-label">{extracting ? "Reading…" : "Extract graph"}</span>
            </button>
          )
        ) : null}
        {ref && doc && doc.ref === ref && doc.library ? (
          <>
            {doc.libraryMarks ? (
              <button type="button" className="tool" onClick={() => void call("zotero.show", { item: doc.library!.item }).catch(report)} data-dg="pdf-zotero-marks" title="Highlights you made on this PDF in Zotero that aren't units here yet">
                <Icon name="marker" /><span className="tool-label">{doc.libraryMarks} in Zotero</span>
              </button>
            ) : null}
            <button type="button" className="tool" onClick={() => void call("link.open", { url: doc.library!.open }).catch(report)} data-dg="pdf-zotero" title={`${doc.library.label} is in your Zotero library. Show it there.`}>
              <Icon name="zotero" /><span className="tool-label">Zotero</span>
            </button>
          </>
        ) : null}
        <button type="button" className="tool" onClick={() => filePicker.current?.click()} data-dg="pdf-add" title="Add a PDF to the vault">
          <Icon name="plus" /><span className="tool-label">Add PDF</span>
        </button>
        <input ref={filePicker} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { void add(event.target.files?.[0]); event.target.value = ""; }} />
      </header>

      {picker || !ref ? (
        <Chooser docs={docs} library={library} current={ref} onOpen={open} onAdd={() => filePicker.current?.click()} floating={Boolean(ref)} onClose={() => setPicker(false)} />
      ) : null}

      {listOpen && loaded ? (
        <div className="popover pdf-list" role="menu" aria-label="Units read from this PDF">
          {placed.shown.length + placed.missing.length === 0 ? <p>Nothing read from this PDF yet. Highlight words to make a unit.</p> : null}
          {placed.shown.map((entry) => (
            <button key={entry.mark.unit.id} type="button" role="menuitem" onClick={() => { setListOpen(false); setReveal(entry.mark.unit.id); pick(entry.mark); }} data-dg={`pdf-unit-${entry.mark.unit.title}`}>
              <span className="chip" data-base={entry.mark.unit.base ?? "none"}>{entry.mark.unit.abbreviation ?? "Unit"}</span>
              <span className="pdf-list-title">{plain(entry.mark.unit.title)}</span>
              <span className="pdf-list-page">p. {[...entry.boxes.keys()][0]! + 1}</span>
            </button>
          ))}
          {placed.missing.length ? <p className="pdf-list-missing">{placed.missing.length} more {placed.missing.length === 1 ? "unit's passage isn't" : "units' passages aren't"} in this file's text, so {placed.missing.length === 1 ? "it isn't" : "they aren't"} lit.</p> : null}
        </div>
      ) : null}

      <div
        className="pdf-scroll"
        ref={scroller}
        onScroll={onScroll}
        onPointerUp={(event) => {
          if (event.button !== 0) return;
          window.setTimeout(() => {
            const selection = document.getSelection();
            if (selection && !selection.isCollapsed) return readSelection();
            const hit = markAt(event);
            if (hit) pick(hit.mark);
            else setActive(null);
          }, 0);
        }}
        onKeyUp={(event) => {
          if (event.shiftKey) readSelection();
        }}
        onPointerMove={(event) => {
          if (event.buttons) return;
          const hit = markAt(event);
          setHover(hit ? { mark: hit.mark, x: event.clientX, y: event.clientY } : null);
        }}
        onPointerLeave={() => setHover(null)}
        data-hovering={hover ? "" : undefined}
      >
        {ref && !loaded && !problem ? <p className="pdf-wait">Opening…</p> : null}
        {loaded
          ? loaded.views.map((view, index) => (
              <Page
                key={`${loaded.ref}-${index}`}
                pdf={loaded.pdf}
                index={index}
                view={view}
                scale={scale}
                drawn={visible.has(index)}
                marks={placed.shown.flatMap((entry) => (entry.boxes.get(index) ? [{ id: entry.mark.unit.id, base: entry.mark.unit.base, color: entry.mark.unit.color, boxes: entry.boxes.get(index)! }] : []))}
                active={active}
                flash={flash}
                pending={cut && cut.page === index + 1 ? cut.boxes : null}
                register={(el) => (el ? pageEls.current.set(index, el) : pageEls.current.delete(index))}
              />
            ))
          : null}
      </div>

      {hover ? (
        <div className="pdf-tip" style={{ left: Math.min(hover.x + 12, window.innerWidth - 260), top: hover.y + 14 }} role="tooltip">
          <span className="chip" data-base={hover.mark.unit.base ?? "none"}>{hover.mark.unit.typeLabel ?? "Unit"}</span> {plain(hover.mark.unit.title)}
        </div>
      ) : null}

      {cut && ref ? (
        <CutPopup
          connection={connection}
          cut={cut}
          own={doc?.paper?.canvas}
          onCancel={() => {
            setCut(null);
            document.getSelection()?.removeAllRanges();
          }}
          onSave={async (choice) => {
            const made = await call("pdf.cut", {
              ref,
              exact: cut.exact,
              page: cut.page,
              ...choice,
              ...(loaded?.title ? { documentTitle: loaded.title } : {}),
            });
            setCut(null);
            document.getSelection()?.removeAllRanges();
            setActive(made.node.id);
            say(`Saved as ${made.node.typeLabel ?? "a unit"}${choice.label ? ` on ${choice.label}` : " in the graph"}`, () => call("pdf.uncut", { node: made.node.id }));
          }}
          report={report}
        />
      ) : null}

      <div className="pdf-notice" role="status" data-dg="pdf-notice" hidden={!problem && !notice}>
        {problem ? (
          <>
            <span className="pdf-problem">{problem}</span>
            <button type="button" onClick={() => setProblem("")} aria-label="Dismiss">Dismiss</button>
          </>
        ) : notice ? (
          <>
            <span>{notice.text}</span>
            {notice.undo ? <button type="button" onClick={() => { const undo = notice.undo!; setNotice(null); void undo().catch(report); }} data-dg="pdf-undo">Undo</button> : null}
          </>
        ) : null}
      </div>

      {dropping ? <div className="pdf-drop" aria-hidden="true"><span>Drop the PDF to keep it in the vault and open it</span></div> : null}
    </div>
  );
};

/** One page: the picture, the text to select, and the marks over it. */
const Page = ({
  pdf,
  index,
  view,
  scale,
  drawn,
  marks,
  active,
  flash,
  pending,
  register,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  view: PageViewport;
  scale: number;
  drawn: boolean;
  marks: { id: string; base: string | undefined; color: string | undefined; boxes: Box[] }[];
  active: string | null;
  flash: string | null;
  pending: Box[] | null;
  register: (el: HTMLDivElement | null) => void;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawn) return;
    let stop = false;
    let task: { cancel: () => void } | null = null;
    let layer: TextLayer | null = null;
    void (async () => {
      const page: PDFPageProxy = await pdf.getPage(index + 1);
      if (stop || !canvas.current || !text.current) return;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      canvas.current.width = Math.floor(viewport.width * ratio);
      canvas.current.height = Math.floor(viewport.height * ratio);
      const render = page.render({ canvas: canvas.current, viewport, ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}) });
      task = render;
      text.current.replaceChildren();
      layer = new TextLayer({ textContentSource: await page.getTextContent(), container: text.current, viewport });
      await Promise.all([render.promise, layer.render()]).catch(() => undefined);
    })();
    return () => {
      stop = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [pdf, index, scale, drawn]);
  const style = {
    width: view.width * scale,
    height: view.height * scale,
    "--total-scale-factor": scale,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;
  const box = (b: Box): CSSProperties => ({ left: b.x * scale, top: b.y * scale, width: b.width * scale, height: b.height * scale });
  return (
    <div className="pdf-page" data-index={index} data-dg={`pdf-page-${index + 1}`} style={style} ref={register}>
      <canvas ref={canvas} aria-hidden="true" />
      <div className="pdf-marks" aria-hidden="true">
        {marks.flatMap((mark) =>
          mark.boxes.map((b, i) => (
            <span key={`${mark.id}-${i}`} className="pdf-mark" data-base={mark.base ?? "none"} data-active={mark.id === active ? "" : undefined} data-flash={mark.id === flash ? "" : undefined} data-unit={mark.id} style={{ ...box(b), ...(mark.color ? ({ "--type": mark.color } as CSSProperties) : {}) }} />
          )),
        )}
        {pending?.map((b, i) => <span key={`pending-${i}`} className="pdf-mark pending" style={box(b)} />)}
      </div>
      <div className="textLayer" ref={text} />
    </div>
  );
};

/** Which PDF to read: papers first, then the rest of the vault, newest first. */
const Chooser = ({
  docs,
  library,
  current,
  onOpen,
  onAdd,
  floating,
  onClose,
}: {
  docs: PdfDocument[] | null;
  library: LibraryState | null;
  current: string | null;
  onOpen: (ref: string) => void;
  onAdd: () => void;
  floating: boolean;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = (docs ?? []).filter((d) => !needle || d.title.toLowerCase().includes(needle) || d.name.toLowerCase().includes(needle) || d.folder?.toLowerCase().includes(needle));
  // With Zotero as the library, its PDFs are the list. What is only in this vault follows, under its own heading.
  // In a lab, what is on the lab's shelf is what everyone can open, so it is listed first and apart.
  const labs = shown.filter((d) => d.library && d.shelf?.kind === "lab");
  const theirs = shown.filter((d) => d.library && d.shelf?.kind !== "lab");
  const papers = shown.filter((d) => d.paper && !d.library);
  const rest = shown.filter((d) => !d.paper && !d.library);
  const row = (d: PdfDocument) => (
    <li key={d.ref}>
      <button type="button" aria-current={d.ref === current ? "true" : undefined} onClick={() => onOpen(d.ref)} data-dg={`pdf-open-${d.name}`}>
        <span className="pdf-doc-title"><Highlighted text={d.title} query={query} /><LibraryMark library={d.library} /></span>
        <span className="pdf-doc-meta">
          {[d.library ? d.library.label : d.title !== d.name.replace(/\.pdf$/i, "") ? d.name : null, d.library ? null : d.folder, sizeOf(d.size), d.paper && d.library ? "Read into a canvas" : null, d.units ? `${d.units} ${d.units === 1 ? "unit" : "units"} read` : null].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  );
  return (
    <div className={floating ? "pdf-chooser popover" : "pdf-chooser"} role={floating ? "dialog" : undefined} aria-label="Choose a PDF" data-dg="pdf-chooser" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      {!floating ? (
        <div className="pdf-intro">
          <h1>Read a PDF into the graph</h1>
          <p>Highlight words, then pick a type and a canvas. The unit keeps the words, the page and the file, and the passage stays lit here.</p>
        </div>
      ) : null}
      <div className="pdf-chooser-bar">
        {(docs?.length ?? 0) > 5 ? <input autoFocus={floating} aria-label="Find a PDF" placeholder="Find by title, file or folder" value={query} onChange={(event) => setQuery(event.target.value)} data-dg="pdf-search" /> : null}
        <button type="button" onClick={onAdd} data-dg="pdf-choose-file"><Icon name="plus" /> Add a PDF</button>
      </div>
      {library?.wanted && library.problem ? <p className="pdf-none" role="status" data-dg="pdf-library-problem">Zotero is your PDF library, but it can't be read right now. {library.problem}</p> : null}
      {docs === null ? <p className="pdf-none">Looking for PDFs…</p> : null}
      {docs !== null && docs.length === 0 ? <p className="pdf-none">No PDFs here yet. Drop one on this panel, or add one, and it's kept with your papers.</p> : null}
      {labs.length ? <h2 data-dg="pdf-lab-shelf">Lab shelf · {labs[0]!.shelf!.name}</h2> : null}
      {labs.length ? <ul>{labs.map(row)}</ul> : null}
      {theirs.length ? <h2 data-dg="pdf-in-zotero">{labs.length ? "Your own Zotero library" : "In Zotero"}</h2> : null}
      {theirs.length ? <ul>{theirs.map(row)}</ul> : null}
      {library?.on && !theirs.length && !labs.length && docs !== null && !needle && !library.problem ? <p className="pdf-none">Zotero has no PDFs yet. Add a paper to Zotero and it is listed here.</p> : null}
      {papers.length ? <h2>{library?.on ? "Papers only in this vault" : "Papers"}</h2> : null}
      {papers.length ? <ul>{papers.map(row)}</ul> : null}
      {rest.length ? <h2>{library?.on ? "Other PDFs in this vault" : papers.length ? "Other PDFs" : "PDFs"}</h2> : null}
      {rest.length ? <ul>{rest.map(row)}</ul> : null}
      {docs !== null && docs.length > 0 && !shown.length ? <p className="pdf-none">No PDF matches.</p> : null}
      {!floating ? <p className="pdf-hint">Or drop a PDF anywhere on this panel.</p> : null}
    </div>
  );
};

/** The choice a highlight offers: its title, its type and where it goes. */
const CutPopup = ({
  connection,
  cut,
  own,
  onCancel,
  onSave,
  report,
}: {
  connection: Connection;
  cut: Cut;
  /** This file's own PDF canvas, which takes highlights from it. Any other PDF canvas does not. */
  own?: string | undefined;
  onCancel: () => void;
  onSave: (choice: { title: string; type?: string; canvas: string | null; newCanvas?: string; label?: string }) => Promise<void>;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const [types, setTypes] = useState<NodeTypeRecord[]>([]);
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [title, setTitle] = useState(() => cut.exact.replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim());
  const [type, setType] = useState<string | null>(remembered.type);
  const [target, setTarget] = useState<CanvasChoice>(remembered.canvas ?? "none");
  const [beside, setBeside] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: cut.left, top: cut.top });

  useEffect(() => {
    void call("grammar.get", {}).then(({ nodeTypes }) => {
      const ordered = [...nodeTypes].sort((a, b) => rank(a) - rank(b));
      setTypes(ordered);
      if (remembered.type === null && !remembered.chosen) setType(ordered.find((t) => t.base === "evidence")?.id ?? null);
    }).catch(report);
    void Promise.all([call("canvas.summaries", {}), call("holon.focus.get", {}), call("canvas.last", {})]).then(([list, focus, last]) => {
      setCanvases(list);
      const front = focus.canvas ?? last;
      setBeside(front);
      if (!remembered.canvas || !list.some((c) => c.id === remembered.canvas)) setTarget(front && list.some((c) => c.id === front) ? front : "none");
    }).catch(report);
  }, [call, report]);
  useEffect(() => box.current?.focus(), []);
  // Keep the whole popup in the frame, above the highlight when there's no room below.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(cut.left, window.innerWidth - width - 8));
    const below = cut.top + height + 8 <= window.innerHeight;
    const top = below ? cut.top : Math.max(8, cut.top - height - 40);
    setPlace({ left, top });
  }, [cut, types.length, canvases.length, target]);

  const choices = useMemo(() => captureChoices(types.map((t) => ({ id: t.id, label: t.label, ...(t.abbreviation ? { abbreviation: t.abbreviation } : {}) }))), [types]);
  const ordered = useMemo(() => {
    const front = canvases.find((c) => c.id === beside);
    return front ? [front, ...canvases.filter((c) => c.id !== beside)] : canvases;
  }, [canvases, beside]);
  const typeOf = (id: string | null) => types.find((t) => t.id === id);
  /** A PDF canvas of some other paper: a highlight from this file can't go on it. */
  const foreign = (c: CanvasSummary): boolean => c.kind === "paper" && c.id !== own;

  const save = async () => {
    if (saving || (target === "new" && !newName.trim())) return;
    setSaving(true);
    remembered.type = type;
    remembered.chosen = true;
    let label = target === "new" ? newName.trim() : target === "none" ? undefined : canvases.find((c) => c.id === target)?.title;
    try {
      // A PDF canvas stays as it was read: the highlight goes on a canvas of the person's own with the same cards.
      let onto = target === "new" || target === "none" ? null : target;
      const fixed = onto ? canvases.find((c) => c.id === onto && foreign(c)) : undefined;
      if (fixed) {
        const built = await call("canvas.buildOn", { id: fixed.id });
        onto = built.id;
        label = built.title;
        await call("canvas.show", { id: built.id });
      }
      await onSave({
        title,
        ...(type ? { type } : {}),
        canvas: onto,
        ...(target === "new" ? { newCanvas: newName.trim() } : {}),
        ...(label ? { label } : {}),
      });
      remembered.canvas = target === "new" ? null : fixed ? onto : target;
    } catch (error) {
      report(error);
      setSaving(false);
    }
  };

  return (
    <div
      className="popover pdf-cut"
      role="dialog"
      aria-label="Make a unit from this highlight"
      ref={box}
      tabIndex={-1}
      style={place}
      data-dg="pdf-cut"
      onKeyDown={(event) => {
        const typing = (event.target as HTMLElement).matches("textarea, input, select");
        if (event.key === "Escape") return onCancel();
        if (event.key === "Enter" && !event.shiftKey && !(event.target as HTMLElement).matches("button")) {
          event.preventDefault();
          return void save();
        }
        if (!typing && !event.metaKey && !event.ctrlKey && event.key.length === 1) {
          const choice = choices.find((c) => c.key === event.key.toLowerCase());
          if (choice) {
            event.preventDefault();
            setType(choice.id);
          }
        }
      }}
    >
      <label className="cut-field">
        <span>Unit</span>
        <textarea data-dg="cut-title" value={title} rows={Math.min(5, Math.max(2, Math.ceil(title.length / 46)))} onChange={(event) => setTitle(event.target.value)} aria-label="The unit's title" />
      </label>
      <div className="cut-types" role="radiogroup" aria-label="Type">
        {choices.map((choice) => {
          const t = typeOf(choice.id);
          return (
            <button key={choice.id ?? "none"} type="button" role="radio" aria-checked={type === choice.id} className="cut-type" onClick={() => setType(choice.id)} data-dg={`cut-type-${choice.label}`} title={`${choice.label} (${choice.key.toUpperCase()})`}>
              <span className="chip" data-base={t?.base ?? "none"} style={t?.color ? ({ "--type": t.color } as CSSProperties) : undefined}>{t?.abbreviation ?? "—"}</span>
              <span className="cut-type-label">{choice.label}</span>
              {choice.key ? <kbd>{choice.key.toUpperCase()}</kbd> : null}
            </button>
          );
        })}
      </div>
      <label className="cut-field">
        <span>Save to</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)} data-dg="cut-canvas">
          {ordered.map((c) => (
            <option key={c.id} value={c.id}>{foreign(c) ? `Build on “${c.title}”${c.id === beside ? " (open now)" : ""}` : c.id === own ? `${c.title} (this paper's PDF canvas)` : c.id === beside ? `${c.title} (open now)` : c.title}</option>
          ))}
          <option value="new">New canvas…</option>
          <option value="none">No canvas, the graph only</option>
        </select>
      </label>
      {canvases.some((c) => c.id === target && foreign(c)) ? (
        <p className="cut-fixed" data-dg="cut-fixed">That is another paper's PDF canvas, which holds only what comes from that paper. This makes a canvas of your own with the same cards and puts the highlight there.</p>
      ) : null}
      {target === "new" ? <input autoFocus placeholder="Canvas name" aria-label="New canvas name" value={newName} onChange={(event) => setNewName(event.target.value)} data-dg="cut-new-canvas" /> : null}
      <div className="cut-actions">
        <span className="cut-hint">Page {cut.page} · keeps the words as its quote</span>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={saving || !title.trim() || (target === "new" && !newName.trim())} onClick={() => void save()} data-dg="cut-save">Save</button>
      </div>
    </div>
  );
};

/** The last type and canvas chosen, so a run of highlights needs one choice. */
const remembered: { type: string | null; canvas: CanvasChoice | null; chosen: boolean } = { type: null, canvas: null, chosen: false };
const rank = (type: NodeTypeRecord): number => {
  const at = MAIN_TYPES.indexOf(type.base ?? "");
  return at >= 0 ? at : MAIN_TYPES.length;
};
