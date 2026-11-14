import { useEffect, type RefObject } from "react";
import { CARD_FIELDS, CARD_FIELD_IDS } from "@dg/contract/scholarly.ts";
import type { NodeTypeRecord } from "@dg/contract/records.ts";
import type { Prefs } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon } from "../shared/ui.tsx";
import type { Anchor } from "./items.ts";

/** What every card shows. The list stays open while its switches are used, and closes on a click anywhere else. */
export const FieldsMenu = ({
  connection,
  at,
  fields,
  button,
  onClose,
  report,
}: {
  connection: Connection;
  at: Anchor;
  fields: Prefs["cardFields"];
  /** The button that opened it, which takes the keyboard back on Escape. */
  button: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  report: (error: unknown) => void;
}) => {
  const { call } = connection;
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-dg="card-fields-menu"], [data-dg="card-fields"]')) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
      button.current?.focus();
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape);
    };
  }, [at, button, onClose]);
  return (
    <div className="popover menu fields-menu" role="menu" aria-label="What every card shows" data-dg="card-fields-menu" style={at}>
      <h3>Show on every card</h3>
      {CARD_FIELDS.map(({ id, label, hint }) => {
        const shown = fields.includes(id);
        return (
          <button
            key={id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={shown}
            data-dg={`card-field-${id}`}
            title={hint}
            onClick={() => {
              const next = shown ? fields.filter((field) => field !== id) : [...fields, id];
              void call("prefs.set", { cardFields: CARD_FIELD_IDS.filter((field) => next.includes(field)) }).catch(report);
            }}
          >
            <span className="tick" aria-hidden="true">{shown ? <Icon name="check" /> : null}</span>
            <span className="fields-text">
              <strong>{label}</strong>
              <span>{hint}</span>
            </span>
          </button>
        );
      })}
      <p>The context panel always shows them all.</p>
    </div>
  );
};

export const TypeMenu = ({ at, types, onPick, onClose }: { at: { x: number; y: number }; types: NodeTypeRecord[]; onPick: (type: NodeTypeRecord) => void; onClose: () => void }) => (
  <div className="popover menu" role="menu" style={{ left: at.x, top: at.y }}>
    {types.map((type) => (
      <button key={type.id} type="button" role="menuitem" data-dg={`type-${type.label}`} onClick={() => onPick(type)}>
        {type.label}
      </button>
    ))}
    <button type="button" role="menuitem" className="quiet" onClick={onClose}>Cancel</button>
  </div>
);
