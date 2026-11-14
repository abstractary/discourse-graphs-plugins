import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "../shared/tokens.css";
import "../canvas/canvas.css";
import "../context/context.css";
import "../library/library.css";
import "./holon.css";
import "../pdf/pdf.css";
import "../run/run.css";
import "../search/search.css";
import type { SurfaceRoute } from "@dg/contract/host.ts";
import { connectOverHttp, followSystemTheme } from "../shared/http.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";
import { App as Canvas } from "../canvas/App.tsx";
import { App as Context } from "../context/App.tsx";
import { App as Library } from "../library/App.tsx";
import { App as Boundary } from "../boundary/App.tsx";
import { App as Explorer } from "./App.tsx";
import { App as Reader } from "../pdf/App.tsx";
import { App as Run } from "../run/App.tsx";
import { App as Search } from "../search/App.tsx";
import { Find } from "../search/Find.tsx";

/**
 * The local app, laid out the way the panels sit in Obsidian: the Library on
 * the left, a canvas or the holon explorer in the middle, and the holon's
 * boundary and the context panel on the right. Each panel is the same surface
 * a base would frame, on its own connection; this shell does what a base does
 * when a panel asks to show a canvas or open a panel. A PDF opens beside the
 * canvas, as it does in Obsidian.
 */

type Main = { kind: "canvas"; id?: string } | { kind: "holon"; id?: string } | { kind: "run"; id?: string };
type Side = "boundary" | "context" | "search";

const readMain = (): Main => {
  const [kind, ...rest] = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).split("/");
  const id = rest.join("/") || undefined;
  if (kind === "run") return { kind: "run", ...(id ? { id } : {}) };
  return kind === "canvas" ? { kind: "canvas", ...(id ? { id } : {}) } : { kind: "holon", ...(id ? { id } : {}) };
};
const writeMain = (main: Main) => {
  window.location.hash = `#/${main.kind}${main.id ? `/${encodeURIComponent(main.id)}` : ""}`;
};

type Acts = {
  show: (id: string) => void;
  panel: (surface: string) => void;
  reveal: (id: string) => void;
  read: (ref?: string) => void;
  find: (open: boolean) => void;
  run: (id?: string) => void;
};

const useConnection = (route: SurfaceRoute, act: Acts): Connection => {
  const connection = useMemo(() => connectOverHttp(route), [route.surface, route.id]);
  useEffect(() => () => connection.close(), [connection]);
  return useMemo(
    () => ({
      ...connection,
      // What a base would do when a panel asks: here, the shell does it.
      call: ((method: string, params: Record<string, string>) => {
        if (method === "canvas.show") return Promise.resolve(act.show(params.id!)).then(() => null);
        if (method === "panel.open") return Promise.resolve(act.panel(params.surface!)).then(() => null);
        if (method === "base.reveal") return Promise.resolve(act.reveal(params.id!)).then(() => null);
        // Core still hears it, so the reader opens at the passage.
        if (method === "pdf.show") return connection.call("pdf.show", params as never).then(() => act.read(params.ref)).then(() => null);
        if (method === "dialog.open" && params.surface === "find") return Promise.resolve(act.find(true)).then(() => null);
        if (method === "run.show") return Promise.resolve(act.run(params.id)).then(() => null);
        if (method === "dialog.close") return Promise.resolve(act.find(false)).then(() => null);
        if (method === "search.show") return connection.call("search.show", params as never).then(() => act.panel("search")).then(() => null);
        return connection.call(method as never, params as never);
      }) as Connection["call"],
    }),
    [connection],
  );
};

const Shell = () => {
  const [main, setMain] = useState<Main>(readMain);
  const [side, setSide] = useState<Side>("boundary");
  const [library, setLibrary] = useState(() => window.innerWidth >= 1100);
  const [reading, setReading] = useState<{ ref?: string; n: number } | null>(null);
  const [finding, setFinding] = useState(0);
  useEffect(() => {
    const onHash = () => setMain(readMain());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const act = {
    show: (id: string) => writeMain({ kind: "canvas", id }),
    panel: (surface: string) =>
      surface === "canvases" ? setLibrary(true) : setSide(surface === "context" ? "context" : surface === "search" ? "search" : "boundary"),
    // No notes here, so a unit opens as its context instead.
    reveal: (id: string) => {
      void contextCall({ id });
      setSide("context");
    },
    read: (ref?: string) => setReading((old) => (old && old.ref === ref ? old : { ...(ref ? { ref } : {}), n: (old?.n ?? 0) + 1 })),
    run: (id?: string) => writeMain({ kind: "run", ...(id ? { id } : {}) }),
    // A fresh finder each time, so it opens empty.
    find: (open: boolean) => setFinding((old) => (open ? Math.abs(old) + 1 : -Math.abs(old))),
  };
  // Ctrl or Command K, as in most apps, opens the finder anywhere here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        act.find(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const libraryConnection = useConnection({ surface: "canvases" }, act);
  const boundaryConnection = useConnection({ surface: "boundary" }, act);
  const contextConnection = useConnection({ surface: "context" }, act);
  const searchConnection = useConnection({ surface: "search" }, act);
  const findConnection = useConnection({ surface: "find", ...(finding > 0 ? { id: String(finding) } : {}) }, act);
  const mainConnection = useConnection(
    main.kind === "canvas" ? { surface: "canvas", ...(main.id ? { id: main.id } : {}) } : main.kind === "run" ? { surface: "run", ...(main.id ? { id: main.id } : {}) } : { surface: "holon", ...(main.id ? { id: main.id } : {}) },
    act,
  );
  const contextCall = ({ id }: { id: string }) => contextConnection.call("focus.set", { node: id });
  const readerConnection = useConnection({ surface: "pdf", ...(reading?.ref ? { id: reading.ref } : {}) }, act);

  return (
    <div className="ws">
      <header className="ws-top">
        <button type="button" className="ws-toggle" aria-pressed={library} onClick={() => setLibrary((on) => !on)} title="Library" aria-label="Library" data-dg="ws-library">
          <Icon name="context" />
        </button>
        <span className="hv-brand">Discourse Graphs</span>
        <nav className="hv-nav" aria-label="Main">
          <button type="button" aria-pressed={main.kind === "holon"} onClick={() => writeMain({ kind: "holon" })} data-dg="ws-holons">Overview</button>
          <button type="button" aria-pressed={main.kind === "canvas"} onClick={() => writeMain({ kind: "canvas", ...(main.kind === "canvas" && main.id ? { id: main.id } : {}) })} data-dg="ws-canvas">Canvas</button>
          <button type="button" aria-pressed={main.kind === "run"} onClick={() => writeMain({ kind: "run" })} data-dg="ws-runs">Runs</button>
        </nav>
        <nav className="hv-nav ws-side-tabs" aria-label="Side panel">
          <button type="button" aria-pressed={side === "boundary"} onClick={() => setSide("boundary")} data-dg="ws-boundary">Boundary</button>
          <button type="button" aria-pressed={side === "context"} onClick={() => setSide("context")} data-dg="ws-context">Context</button>
          <button type="button" aria-pressed={side === "search"} onClick={() => setSide("search")} data-dg="ws-search">Search</button>
        </nav>
        <button type="button" className="ws-toggle" onClick={() => act.find(true)} title="Find a unit (Ctrl or ⌘ K)" aria-label="Find a unit" data-dg="ws-find">
          <Icon name="search" />
        </button>
        <button type="button" className="ws-toggle ws-read" aria-pressed={Boolean(reading)} onClick={() => setReading((old) => (old ? null : { n: 0 }))} title="Read a PDF beside the canvas" data-dg="ws-pdf">PDF</button>
      </header>
      <div className="ws-body" data-library={library}>
        {library ? (
          <aside className="ws-left" aria-label="Library">
            <Library connection={libraryConnection} />
          </aside>
        ) : null}
        <main className="ws-main" data-reading={Boolean(reading)}>
          {main.kind === "canvas" ? (
            <ReactFlowProvider key={main.id ?? "last"}>
              <Canvas connection={mainConnection} />
            </ReactFlowProvider>
          ) : main.kind === "run" ? (
            <div className="ws-scroll"><Run key={main.id ?? "all"} connection={mainConnection} /></div>
          ) : (
            <Explorer key={main.id ?? "top"} connection={mainConnection} onShowCanvas={act.show} />
          )}
          {reading ? (
            <section className="ws-reader" aria-label="PDF reader">
              <Reader key={`${reading.ref ?? "choose"}-${reading.n}`} connection={readerConnection} />
            </section>
          ) : null}
        </main>
        <aside className="ws-right" aria-label={side === "boundary" ? "Boundary" : side === "search" ? "Unit search" : "Context"}>
          <div hidden={side !== "boundary"} className="ws-pane"><Boundary connection={boundaryConnection} onShowCanvas={act.show} /></div>
          <div hidden={side !== "context"} className="ws-pane"><Context connection={contextConnection} /></div>
          <div hidden={side !== "search"} className="ws-pane"><Search connection={searchConnection} /></div>
        </aside>
      </div>
      {finding > 0 ? (
        <div className="ws-find" onPointerDown={(event) => event.target === event.currentTarget && act.find(false)}>
          <section className="ws-find-box" role="dialog" aria-label="Find a unit">
            <Find key={finding} connection={findConnection} />
          </section>
        </div>
      ) : null}
    </div>
  );
};

followSystemTheme();
createRoot(document.getElementById("root")!).render(<Shell />);
