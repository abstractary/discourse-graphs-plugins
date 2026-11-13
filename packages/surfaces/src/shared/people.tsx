import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Credit, ProfileCard } from "@dg/contract/surface.ts";

/**
 * A person, wherever their initials show: hover for a small card about them,
 * click for their profile. A circle is a person and a square is a lab, so the
 * mark reads without color, and nothing depends on an image being set.
 */

export type People = { card: (id: string) => Promise<ProfileCard>; open: (id: string) => void };
export const PeopleContext = createContext<People | null>(null);

export const initialsOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words;
  return letters.map((word) => word[0]!.toUpperCase()).join("").slice(0, 2) || "?";
};

/** Date and time, as short as the reader's own locale writes them. */
export const whenOf = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
};
export const dayOf = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const count = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const HoverCard = ({ card, at }: { card: ProfileCard | null; at: DOMRect }) => {
  // Kept on screen: below the initials where there is room, otherwise above.
  const below = at.bottom + 150 < window.innerHeight;
  const left = Math.max(8, Math.min(at.left, window.innerWidth - 248));
  const style = below ? { left, top: at.bottom + 6 } : { left, bottom: window.innerHeight - at.top + 6 };
  return createPortal(
    <div className="person-card" role="tooltip" data-dg="person-card" style={style}>
      {card ? (
        <>
          <div className="person-card-head">
            <span className="mark" data-kind="person" aria-hidden="true">{initialsOf(card.name)}</span>
            <span className="person-card-name">
              <strong>{card.name}{card.me ? " (you)" : ""}</strong>
              {card.lab ? <span>{card.lab}</span> : null}
            </span>
          </div>
          <p>
            {count(card.written, "unit", "units")} written{card.read ? `, ${card.read.toLocaleString()} read from ${count(card.papers, "paper", "papers")}` : ""}. {count(card.relations, "relation", "relations")}.
          </p>
          {card.lastActive ? <p className="person-card-when">Last active {dayOf(card.lastActive)}{card.since ? `, here since ${dayOf(card.since)}` : ""}</p> : <p className="person-card-when">Nothing of theirs is here yet</p>}
          <p className="person-card-hint">{card.me ? "Click for your profile" : "Click for their profile"}</p>
        </>
      ) : (
        <p className="person-card-when">Looking them up</p>
      )}
    </div>,
    document.body,
  );
};

export const Mark = ({ credit, dg }: { credit: Credit; dg?: string }) => {
  const people = useContext(PeopleContext);
  const [at, setAt] = useState<DOMRect | null>(null);
  const [card, setCard] = useState<ProfileCard | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const label = credit.kind === "lab" ? `From ${credit.name}` : `By ${credit.name}`;
  if (!people || credit.kind !== "person") {
    return (
      <span className="mark" data-kind={credit.kind} data-dg={dg} role="img" aria-label={label} title={label}>
        {initialsOf(credit.name)}
      </span>
    );
  }
  const show = (): void => {
    window.clearTimeout(timer.current);
    // A pause first, so a pointer crossing a card doesn't flash a card of its own.
    timer.current = window.setTimeout(() => {
      if (!el.current) return;
      setAt(el.current.getBoundingClientRect());
      void people.card(credit.id).then(setCard).catch(() => setAt(null));
    }, 350);
  };
  const hide = (): void => {
    window.clearTimeout(timer.current);
    setAt(null);
  };
  return (
    <>
      <button
        ref={el}
        type="button"
        className="mark nodrag"
        data-kind="person"
        data-dg={dg}
        aria-label={`${label}. Open their profile.`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(event) => {
          event.stopPropagation();
          hide();
          people.open(credit.id);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {initialsOf(credit.name)}
      </button>
      {at ? <HoverCard card={card} at={at} /> : null}
    </>
  );
};
