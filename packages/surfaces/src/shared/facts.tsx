import type { ReactNode } from "react";
import { whenOf } from "./people.tsx";
import { CARD_FIELDS, READ_HOW_LABEL, authorLine, identifierLabel, identifierUrl, type CardFacts, type CardField, type Identifier } from "@dg/contract/scholarly.ts";

/**
 * A unit's facts, drawn the same way on its card and at the head of the
 * context panel: a quiet label, then the value. Only the size differs, so a
 * person who learns to read one has learned the other.
 */

const HOW_HINT = { auto: "A model read this from the source", manual: "A person read this from the source", imported: "It arrived in an imported file" } as const;

const LABELS: Record<CardField, (facts: CardFacts) => string> = {
  source: () => "Source",
  authors: (facts) => (facts.authors.role === "paper" ? (facts.authors.names.length === 1 ? "Author" : "Authors") : "Made by"),
  origin: (facts) => (facts.origin.kind === "lab" ? "Lab" : "Workspace"),
  created: () => "Made",
  identifiers: () => "IDs",
};

export type FactsProps = {
  facts: CardFacts;
  /** Which rows to draw, in the order cards always use. */
  fields: readonly CardField[];
  /** `card` is the small form on a canvas. `panel` has room for every name and identifier. */
  density: "card" | "panel";
  /** A name for test hooks, such as the unit's title. */
  dg?: string;
  /** Opens the passage the unit was read from. Without it the source is plain text. */
  onSource?: () => void;
  /** Opens an identifier where it resolves. Without it identifiers are plain text. */
  onIdentifier?: (id: Identifier) => void;
};

type Row = { id: CardField; label: string; value: ReactNode };

export const Facts = ({ facts, fields, density, dg, onSource, onIdentifier }: FactsProps) => {
  const card = density === "card";
  const rows = CARD_FIELDS.filter(({ id }) => fields.includes(id)).flatMap(({ id }): Row[] => {
    const label = LABELS[id](facts);
    if (id === "source") {
      const { source } = facts;
      // A card has no room to say what isn't there. The panel says it, so the row never goes missing.
      if (!source) return card ? [] : [{ id, label, value: <span className="fact-none">Not read from a source</span> }];
      const name = onSource ? (
        <button type="button" className="fact-link nodrag" data-dg={dg ? `fact-source-${dg}` : "fact-source"} title={`${source.title}. Open the passage.`} onClick={onSource} onDoubleClick={(event) => event.stopPropagation()}>
          {source.name}
        </button>
      ) : (
        <span data-dg={dg ? `fact-source-${dg}` : "fact-source"} title={source.title}>{source.name}</span>
      );
      return [
        {
          id,
          label,
          value: (
            <>
              {name}
              <span className="fact-how" data-how={source.how} data-dg={dg ? `fact-how-${dg}` : "fact-how"} title={source.by ? `${HOW_HINT[source.how]}: ${source.by}` : HOW_HINT[source.how]}>
                {READ_HOW_LABEL[source.how]}
              </span>
              {facts.retracted ? <span className="fact-how" data-how="retracted" title="A registry lists this work as retracted">Retracted</span> : null}
            </>
          ),
        },
      ];
    }
    if (id === "authors") return [{ id, label, value: <span title={facts.authors.names.join(", ")}>{authorLine(facts.authors.names, card ? 2 : 6)}</span> }];
    if (id === "origin") return [{ id, label, value: <span>{facts.origin.name}</span> }];
    if (id === "created") return [{ id, label, value: <time dateTime={facts.created} title={new Date(facts.created).toLocaleString()}>{whenOf(facts.created)}</time> }];
    const shown = card ? facts.identifiers.slice(0, 2) : facts.identifiers;
    if (shown.length === 0) return card ? [] : [{ id, label, value: <span className="fact-none">None yet</span> }];
    return [
      {
        id,
        label,
        value: (
          <>
            {shown.map((item) => {
              const text = (
                <>
                  <abbr>{identifierLabel(item.scheme)}</abbr> {item.scheme === "url" ? item.value.replace(/^https?:\/\//, "") : item.value}
                </>
              );
              const key = `${item.scheme}:${item.value}`;
              return onIdentifier && identifierUrl(item) ? (
                <button key={key} type="button" className="fact-id nodrag" data-scheme={item.scheme} title={`Open ${identifierUrl(item)}`} onClick={() => onIdentifier(item)} onDoubleClick={(event) => event.stopPropagation()}>
                  {text}
                </button>
              ) : (
                <span key={key} className="fact-id" data-scheme={item.scheme} title={item.value}>
                  {text}
                </span>
              );
            })}
            {facts.identifiers.length > shown.length ? <span className="fact-more" title={`${facts.identifiers.length - shown.length} more in the context panel`}>+{facts.identifiers.length - shown.length}</span> : null}
          </>
        ),
      },
    ];
  });
  if (rows.length === 0) return null;
  return (
    <dl className="facts" data-density={density} data-dg={dg ? `facts-${dg}` : "facts"}>
      {rows.map(({ id, label, value }) => (
        <div key={id} className="fact" data-field={id}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};
