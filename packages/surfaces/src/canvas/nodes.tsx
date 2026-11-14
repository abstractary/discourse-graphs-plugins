import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Reaction } from "@dg/contract/records.ts";
import type { Credit, NodeSummary, UnitSocial } from "@dg/contract/surface.ts";
import { whenOf } from "../shared/people.tsx";
import type { CardField, Identifier } from "@dg/contract/scholarly.ts";
import { Facts } from "../shared/facts.tsx";
import { Icon, Mark, plain, typeStyle } from "../shared/ui.tsx";

export type Box = { x: number; y: number; width: number; height: number };

export type Actions = {
  reveal: (node: string) => void;
  /** Goes into a canvas held inside this one. */
  openCanvas?: (id: string) => void;
  canvasTitle?: (id: string) => string | null;
  /** Which facts every card shows under its title. */
  fields?: readonly CardField[];
  /** Opens an identifier where it resolves. */
  openIdentifier?: (id: Identifier) => void;
  /** Opens the passage a unit was read from, in the reader. */
  readPassage?: (node: string) => void;
  /** Opens a unit or its source in the reader's reference library. */
  openLibrary?: (url: string) => void;
  chooseType: (node: string, anchor: DOMRect) => void;
  saveBox: (item: string, box: Box) => void;
  saveText: (item: string, text: string) => void;
  react: (node: string, value: Reaction | null) => void;
  /** Opens the title editor on a card. Only for the person's own units. */
  editTitle?: (item: string) => void;
  stopEditing?: () => void;
  rename?: (node: string, title: string) => void;
  /** An output's picture, read from the base. */
  image?: (node: string) => Promise<{ dataUrl: string; stale: boolean } | null>;
  /** Makes evidence that says what an output shows, beside its card. */
  observe?: (output: string, item: string, title: string) => void;
  /** Lists what a unit is related to, so the units not here yet can be brought in. */
  related?: (node: string, item: string, anchor: DOMRect) => void;
};

/** One read per picture for as long as the canvas is open, however often its card is drawn. */
const pictures = new Map<string, Promise<{ dataUrl: string; stale: boolean } | null>>();

const Picture = ({ id, title, load }: { id: string; title: string; load: NonNullable<Actions["image"]> }) => {
  const [shown, setShown] = useState<{ dataUrl: string; stale: boolean } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!pictures.has(id)) pictures.set(id, load(id));
    void pictures.get(id)!.then((value) => live && setShown(value));
    return () => {
      live = false;
    };
  }, [id, load]);
  if (shown === undefined) return null;
  if (shown === null) return <div className="card-note">Its picture isn't in this base</div>;
  return (
    <figure className="card-picture" data-dg={`picture-${title}`} data-stale={shown.stale}>
      <img src={shown.dataUrl} alt={plain(title)} draggable={false} />
      {shown.stale ? <figcaption>This file has changed since it was recorded</figcaption> : null}
    </figure>
  );
};

/** What an output shows, said in a sentence. It becomes evidence that rests on the output. */
const Observe = ({ title, onSay }: { title: string; onSay: (text: string) => void }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // Picking up a card gives the card the keyboard a moment after the click. The field takes it back.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => field.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);
  if (!open) {
    return (
      <button type="button" className="card-say nodrag" data-dg={`say-${title}`} onClick={() => setOpen(true)} onDoubleClick={(event) => event.stopPropagation()}>
        Say what it shows
      </button>
    );
  }
  return (
    <input
      ref={field}
      className="card-say-input nodrag nowheel"
      data-dg="say-input"
      autoFocus
      value={text}
      placeholder="What this shows, in a sentence"
      aria-label="What this shows"
      onChange={(event) => setText(event.target.value)}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && text.trim()) {
          onSay(text);
          setText("");
          setOpen(false);
        }
      }}
    />
  );
};

export const ActionsContext = createContext<Actions | null>(null);

const useActions = (): Actions => useContext(ActionsContext)!;

const Handles = () => (
  <>
    <Handle id="t" type="source" position={Position.Top} />
    <Handle id="r" type="source" position={Position.Right} />
    <Handle id="b" type="source" position={Position.Bottom} />
    <Handle id="l" type="source" position={Position.Left} />
  </>
);

export type CardData = {
  node?: NodeSummary;
  text: string;
  minHeight: number;
  /** A centrality score, when the canvas is arranged by one. */
  score?: string;
  /** Reactions and notes. Only cards on a shared canvas have this. */
  social?: UnitSocial;
  grounded?: boolean;
  /** The title is being edited on the card. */
  editing?: boolean;
};

/** A unit's title, edited where it's read. Enter keeps it, Escape leaves it as it was. */
const TitleEditor = ({ initial, onDone, onCancel }: { initial: string; onDone: (title: string) => void; onCancel: () => void }) => {
  const [draft, setDraft] = useState(initial);
  const input = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (keep: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (keep && draft.trim() && draft.trim() !== initial) onDone(draft);
    else onCancel();
  };
  return (
    <textarea
      ref={input}
      className="card-title-edit nodrag nowheel"
      aria-label="Unit title"
      data-dg="card-title-edit"
      rows={Math.max(1, Math.ceil(draft.length / 30))}
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
};

const REACTIONS: { value: Reaction; label: string; icon: "star" | "check" | "close" }[] = [
  { value: "interesting", label: "Interesting", icon: "star" },
  { value: "agree", label: "Agree", icon: "check" },
  { value: "disagree", label: "Disagree", icon: "close" },
];

/** A person's own view of a unit. Nobody is told, and it carries no weight. */
const Reactions = ({ node, title, social }: { node: string; title: string; social: UnitSocial }) => {
  const actions = useActions();
  return (
    <div className="reactions nodrag">
      {REACTIONS.map(({ value, label, icon }) => {
        const who = social.who[value];
        const mine = social.mine === value;
        return (
          <button
            key={value}
            type="button"
            className="reaction"
            data-dg={`react-${value}-${title}`}
            data-used={who.length > 0}
            aria-pressed={mine}
            aria-label={label}
            title={who.length > 0 ? `${label}: ${who.join(", ")}` : label}
            onClick={() => actions.react(node, mine ? null : value)}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <Icon name={icon} />
            {who.length > 0 ? <span>{who.length}</span> : null}
          </button>
        );
      })}
      {social.notes.length > 0 ? (
        <span className="reaction" data-used="true" title={`${social.notes.length} ${social.notes.length === 1 ? "note" : "notes"}`} data-dg={`notes-${title}`}>
          <Icon name="comment" />
          <span>{social.notes.length}</span>
        </span>
      ) : null}
    </div>
  );
};

/** Height grows with the title: a claim is never cut off on its card. */
export const CardNode = memo(({ id, data, selected }: NodeProps<Node<CardData>>) => {
  const actions = useActions();
  const { node, text, minHeight, score, social, grounded, editing } = data;
  const title = node?.title ?? text;
  const renamable = Boolean(node?.mine && actions.rename);
  return (
    <div
      className={grounded ? "card grounded" : "card"}
      data-base={node?.base ?? "none"}
      data-dg={`card-${title}`}
      style={{ ...typeStyle(node), minHeight }}
      // A unit is a leaf: a double click opens its text and context, never a graph of its own.
      onDoubleClick={() => {
        if (node) actions.reveal(node.id);
      }}
    >
      <NodeResizer isVisible={selected} minWidth={160} minHeight={48} onResizeEnd={(_, box) => actions.saveBox(id, box)} />
      <Handles />
      <div className="card-head">
        <button
          type="button"
          className="chip nodrag"
          data-base={node?.base ?? "none"}
          data-dg={`chip-${title}`}
          style={typeStyle(node)}
          title={node?.typeLabel ?? "Choose a type"}
          onClick={(event) => {
            if (node) actions.chooseType(node.id, event.currentTarget.getBoundingClientRect());
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {node?.abbreviation ?? "Type"}
        </button>
        {score ? <span className="score" data-dg={`score-${title}`}>{score}</span> : null}
        <span className="card-end">
          {node && selected && actions.related ? (
            <button
              type="button"
              className="open nodrag"
              data-dg={`related-${title}`}
              aria-label="What this is related to"
              title="What this is related to"
              onClick={(event) => actions.related!(node.id, id, event.currentTarget.getBoundingClientRect())}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Icon name="link" />
            </button>
          ) : null}
          {node?.hasText ? (
            <button
              type="button"
              className="open nodrag"
              data-dg={`open-${title}`}
              aria-label="Open text"
              title="Open text"
              onClick={() => actions.reveal(node.id)}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <Icon name="open" />
            </button>
          ) : null}
          {node?.checked ? (
            <span
              className="card-check"
              data-state={node.checked}
              data-dg={`check-${title}`}
              title={node.checked === "checked" ? "Checked" : node.checked === "needsWork" ? "Sent back: needs work" : "Changed since it was checked"}
              aria-label={node.checked === "checked" ? "Checked" : node.checked === "needsWork" ? "Needs work" : "Changed since it was checked"}
            >
              <Icon name={node.checked === "needsWork" ? "pen" : "check"} />
            </span>
          ) : null}
          {node ? <Mark credit={node.credit} dg={`credit-${title}`} /> : null}
        </span>
      </div>
      {editing && node && renamable ? (
        <TitleEditor initial={node.title} onDone={(next) => actions.rename!(node.id, next)} onCancel={() => actions.stopEditing?.()} />
      ) : (
        <div
          className="card-title"
          data-dg={`title-${title}`}
          onDoubleClick={(event) => {
            // A person's own title edits in place. A teammate's opens, as the rest of the card does.
            if (!renamable) return;
            event.stopPropagation();
            actions.editTitle?.(id);
          }}
        >
          {plain(title)}
        </div>
      )}
      {node?.image && actions.image ? <Picture id={node.id} title={title} load={actions.image} /> : null}
      {node?.base === "output" && actions.observe ? <Observe title={title} onSay={(said) => actions.observe!(node.id, id, said)} /> : null}
      {node && !node.hasText && !node.staged && !node.image ? <div className="card-note">No text in this base</div> : null}
      {node && actions.fields?.length ? (
        <Facts
          facts={node.card}
          fields={actions.fields}
          density="card"
          dg={title}
          // A click on a card picks it up. Its links only act once it is selected, so reaching for a card never opens something.
          {...(selected && actions.readPassage ? { onSource: () => actions.readPassage!(node.id) } : {})}
          {...(selected && actions.openIdentifier ? { onIdentifier: actions.openIdentifier } : {})}
          {...(selected && actions.openLibrary ? { onLibrary: actions.openLibrary } : {})}
        />
      ) : null}
      {node && social ? <Reactions node={node.id} title={title} social={social} /> : null}
    </div>
  );
});

export type NestedData = { canvas: string; file: string; minHeight: number };

/** A canvas inside this canvas. Obsidian draws the same file node as the embedded canvas. */
export const NestedNode = memo(({ data }: NodeProps<Node<NestedData>>) => {
  const actions = useActions();
  const title = actions.canvasTitle?.(data.canvas) ?? data.file.split("/").pop()?.replace(/\.canvas$/, "") ?? "Canvas";
  return (
    <div className="card nested" data-base="canvas" data-dg={`nested-${title}`} style={{ minHeight: data.minHeight }} onDoubleClick={() => actions.openCanvas?.(data.canvas)}>
      <Handles />
      <div className="card-head">
        <span className="chip" data-base="canvas">Canvas</span>
        <span className="card-end">
          <button type="button" className="open inside nodrag" aria-label={`Open ${title}`} title="Open this canvas here" onClick={() => actions.openCanvas?.(data.canvas)} onDoubleClick={(event) => event.stopPropagation()}>
            <Icon name="inside" />
          </button>
        </span>
      </div>
      <div className="card-title">{title}</div>
      <div className="card-note">A canvas inside this one</div>
    </div>
  );
});

export type NoteData = { text: string; editOnMount?: boolean; credit?: Credit; at?: string };

export const NoteNode = memo(({ id, data, selected }: NodeProps<Node<NoteData>>) => {
  const actions = useActions();
  const [editing, setEditing] = useState(Boolean(data.editOnMount));
  const [draft, setDraft] = useState(data.text);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  useEffect(() => {
    if (!editing) setDraft(data.text);
  }, [data.text, editing]);
  return (
    <div className="note" data-dg={`note-${data.text}`} onDoubleClick={() => setEditing(true)}>
      <NodeResizer isVisible={selected} minWidth={100} minHeight={40} onResizeEnd={(_, box) => actions.saveBox(id, box)} />
      <Handles />
      {editing ? (
        <textarea
          ref={input}
          className="nodrag nowheel"
          aria-label="Note text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.currentTarget.blur();
            event.stopPropagation();
          }}
          onBlur={() => {
            setEditing(false);
            if (draft !== data.text) actions.saveText(id, draft);
          }}
        />
      ) : (
        <div className="note-text">{data.text}</div>
      )}
      {data.credit ? (
        <div className="note-by" data-dg="note-by">
          <Mark credit={data.credit} />
          <span title={data.at ? new Date(data.at).toLocaleString() : undefined}>{data.credit.name}{data.at ? `, ${whenOf(data.at)}` : ""}</span>
        </div>
      ) : null}
    </div>
  );
});

export type ZoneData = { label: string; guide?: boolean };

export const ZoneNode = memo(({ id, data, selected }: NodeProps<Node<ZoneData>>) => {
  const actions = useActions();
  return (
    <div className="zone" data-guide={data.guide ?? false} data-dg={data.guide ? `guide-${data.label}` : undefined}>
      {data.guide ? null : <NodeResizer isVisible={selected} minWidth={120} minHeight={80} onResizeEnd={(_, box) => actions.saveBox(id, box)} />}
      {data.label}
    </div>
  );
});

export type InkData = { path: string; credit?: Credit; at?: string };

/** A freehand line. Selected, it shows its frame and who drew it, as a card or a sticky does. */
export const InkNode = memo(({ data, selected }: NodeProps<Node<InkData>>) => (
  <div className="ink-box" data-dg="ink" data-selected={selected ? "" : undefined} title={data.credit ? `Drawn by ${data.credit.name}${data.at ? `, ${new Date(data.at).toLocaleString()}` : ""}` : undefined}>
    <svg className="ink" width="100%" height="100%" aria-label="Freehand line">
      <path d={data.path} />
    </svg>
    {selected && data.credit ? (
      <span className="ink-by" data-dg="ink-credit">
        <Mark credit={data.credit} />
        <span>{data.credit.name}{data.at ? `, ${whenOf(data.at)}` : ""}</span>
      </span>
    ) : null}
  </div>
));

export const nodeTypes = { card: CardNode, note: NoteNode, zone: ZoneNode, ink: InkNode, nested: NestedNode };
