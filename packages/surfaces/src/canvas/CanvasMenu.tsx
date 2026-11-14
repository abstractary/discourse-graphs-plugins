import { useCallback, useEffect, useState } from "react";
import type { CanvasRecord } from "@dg/contract/records.ts";
import type { RepositoryCanvas } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Thumb } from "../shared/Thumb.tsx";
import { Icon } from "../shared/ui.tsx";

/**
 * The canvas menu's own state: whether it is open, the name being typed for a new canvas,
 * and whether it is asking to remove this one. `go` takes the person to a canvas.
 */
export const useCanvasMenu = ({ connection, go, report }: { connection: Connection; go: (id: string) => void; report: (error: unknown) => void }) => {
  const { call } = connection;
  const [open, setOpen] = useState(false);
  /** Set while the menu asks whether to remove this canvas. */
  const [removeAsk, setRemoveAsk] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  /** Each canvas as a picture of itself, read when the canvas menu opens. */
  const [pictures, setPictures] = useState<Record<string, RepositoryCanvas>>({});
  useEffect(() => {
    if (!open) return;
    void call("library.canvases", {})
      .then((list) => setPictures(Object.fromEntries(list.map((item) => [item.id, item]))))
      .catch(() => {}); // Dropped: the menu lists every canvas by name without its picture.
  }, [open, call]);

  const toggle = useCallback(() => {
    setOpen((on_) => !on_);
    setNaming(false);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  /** Closed along with every other menu. */
  const close = useCallback(() => {
    setOpen(false);
    setNaming(false);
  }, []);
  const pick = (id: string): void => {
    setOpen(false);
    go(id);
  };
  const start = async (): Promise<void> => {
    const title = name.trim();
    if (!title) return;
    setNaming(false);
    setName("");
    try {
      pick((await call("canvas.create", { title })).id);
    } catch (error) {
      report(error);
    }
  };
  return { open, removeAsk, setRemoveAsk, naming, setNaming, name, setName, pictures, toggle, hide, close, pick, start };
};

export type CanvasMenuState = ReturnType<typeof useCanvasMenu>;

// Not a <form>: sandboxed frames block form submission without any error.
export const NameForm = ({ value, onChange, onCreate, onCancel }: { value: string; onChange: (value: string) => void; onCreate: () => void; onCancel: () => void }) => (
  <div className="name-form">
    <input
      data-dg="canvas-name"
      aria-label="Canvas name"
      placeholder="Canvas name"
      autoFocus
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCreate();
        if (event.key === "Escape") onCancel();
      }}
    />
    <button type="button" data-dg="canvas-create" onClick={onCreate}>Create</button>
  </div>
);

/** Every canvas, and what can be done with this one: a new one, a paper, the Library, export, types, removal. */
export const CanvasMenu = ({
  connection,
  menu,
  canvases,
  current,
  removable,
  onExport,
  report,
}: {
  connection: Connection;
  menu: CanvasMenuState;
  canvases: CanvasRecord[];
  current: string | undefined;
  /** A PDF canvas, or one not read yet, can't be removed from here. */
  removable: boolean;
  onExport: () => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  const { pictures, naming, removeAsk, setRemoveAsk, setNaming, hide } = menu;
  return (
    <div className="popover canvas-menu">
      <ul role="menu" aria-label="Canvases">
        {canvases.map((canvas) => (
          <li key={canvas.id}>
            <button
              type="button"
              role="menuitem"
              data-dg={`canvas-${canvas.title}`}
              aria-current={canvas.id === current}
              onClick={() => menu.pick(canvas.id)}
            >
              {pictures[canvas.id] ? <Thumb thumb={pictures[canvas.id]!.thumb} /> : <span className="thumb thumb-empty" aria-hidden="true" />}
              <span className="canvas-pick">
                <span className="canvas-pick-title">{canvas.title}</span>
                {pictures[canvas.id] ? (
                  <span className="repo-kind" data-kind={pictures[canvas.id]!.kind}>
                    <Icon name={pictures[canvas.id]!.kind === "paper" ? "pdf" : "canvas"} /> {pictures[canvas.id]!.kind === "paper" ? "PDF canvas" : "Canvas"}
                    <span className="cvs-meta"> · {pictures[canvas.id]!.cards} {pictures[canvas.id]!.cards === 1 ? "card" : "cards"}</span>
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {naming ? (
        <NameForm value={menu.name} onChange={menu.setName} onCreate={() => void menu.start()} onCancel={() => setNaming(false)} />
      ) : (
        <>
          <button type="button" className="new" data-dg="new-canvas" onClick={() => setNaming(true)}>
            <Icon name="plus" /> New canvas
          </button>
          <button type="button" className="new" data-dg="upload-paper" onClick={() => { hide(); void call("dialog.open", { surface: "upload" }).catch(report); }}>
            <Icon name="export" /> Upload a paper
          </button>
          <button type="button" className="new" data-dg="from-zotero" onClick={() => { hide(); void call("dialog.open", { surface: "zotero", ...(current ? { id: current } : {}) }).catch(report); }}>
            <Icon name="zotero" /> From Zotero…
          </button>
          {current ? (
            <button type="button" className="new" data-dg="publish" onClick={() => { hide(); void call("dialog.open", { surface: "publish", id: current }).catch(report); }}>
              <Icon name="open" /> Publish…
            </button>
          ) : null}
          <button type="button" className="new" data-dg="open-library" onClick={() => { hide(); void call("panel.open", { surface: "canvases" }).catch(report); }}>
            <Icon name="library" /> Open the Library
          </button>
          <button type="button" className="new" data-dg="export" onClick={() => { hide(); onExport(); }}>
            <Icon name="export" /> Export…
          </button>
          <button type="button" className="new" data-dg="open-grammar" onClick={() => { hide(); void call("dialog.open", { surface: "grammar" }).catch(report); }}>
            <Icon name="card" /> Types and relations…
          </button>
          {current && removable ? (
            removeAsk ? (
              <div className="remove-ask" data-dg="remove-canvas-ask">
                <span>Remove this canvas? Its units and their links stay.</span>
                <button type="button" onClick={() => setRemoveAsk(false)}>Keep it</button>
                <button
                  type="button"
                  data-dg="remove-canvas-yes"
                  onClick={() => {
                    setRemoveAsk(false);
                    hide();
                    void call("canvas.remove", { id: current })
                      .then(() => call("panel.open", { surface: "canvases" }))
                      .catch(report);
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button type="button" className="new" data-dg="remove-canvas" onClick={() => setRemoveAsk(true)}>
                <Icon name="close" /> Remove this canvas…
              </button>
            )
          ) : null}
        </>
      )}
    </div>
  );
};
