import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Reaction } from "@dg/contract/records.ts";
import type { NodeSummary, UnitSocial } from "@dg/contract/surface.ts";
import { Icon, Mark, plain, typeStyle } from "../shared/ui.tsx";

export type Box = { x: number; y: number; width: number; height: number };

export type Actions = {
  reveal: (node: string) => void;
  chooseType: (node: string, anchor: DOMRect) => void;
  saveBox: (item: string, box: Box) => void;
  saveText: (item: string, text: string) => void;
  react: (node: string, value: Reaction | null) => void;
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
  const { node, text, minHeight, score, social, grounded } = data;
  const title = node?.title ?? text;
  return (
    <div
      className={grounded ? "card grounded" : "card"}
      data-base={node?.base ?? "none"}
      data-dg={`card-${title}`}
      style={{ ...typeStyle(node), minHeight }}
      onDoubleClick={() => node && actions.reveal(node.id)}
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
          {node ? <Mark credit={node.credit} dg={`credit-${title}`} /> : null}
        </span>
      </div>
      <div className="card-title">{plain(title)}</div>
      {node && !node.hasText && !node.staged ? <div className="card-note">No text in this base</div> : null}
      {node && social ? <Reactions node={node.id} title={title} social={social} /> : null}
    </div>
  );
});

export type NoteData = { text: string; editOnMount?: boolean };

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
        data.text
      )}
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

export type InkData = { path: string };

export const InkNode = memo(({ data }: NodeProps<Node<InkData>>) => (
  <svg className="ink" width="100%" height="100%" aria-label="Freehand mark">
    <path d={data.path} />
  </svg>
));

export const nodeTypes = { card: CardNode, note: NoteNode, zone: ZoneNode, ink: InkNode };
