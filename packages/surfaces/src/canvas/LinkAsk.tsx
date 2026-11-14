import { useEffect, useRef, useState } from "react";
import type { LinkDelete } from "@dg/contract/surface.ts";
import { plain } from "../shared/ui.tsx";

/**
 * Asked when Delete takes a link between two cards: is it only coming off this
 * canvas, or is the relation itself being withdrawn? Only its author can
 * withdraw a relation. A person can make their answer the default.
 */

export type LinkAsk = {
  links: { label: string; from: string; to: string }[];
  /** How many of them this person asserted, and so can withdraw. */
  mine: number;
  /** Who asserted the others. */
  others: string[];
  answer: (choice: LinkDelete | "cancel", remember: boolean) => void;
};

const names = (list: string[]): string =>
  list.length <= 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;

export const LinkAskDialog = ({ ask }: { ask: LinkAsk }) => {
  const [remember, setRemember] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  const total = ask.links.length;
  const [only] = ask.links;
  useEffect(() => first.current?.focus(), []);
  const answer = (choice: LinkDelete | "cancel") => ask.answer(choice, choice !== "cancel" && remember);

  return (
    <div className="link-ask-scrim" onPointerDown={(event) => event.target === event.currentTarget && answer("cancel")}>
      <div
        className="popover link-ask"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="link-ask-title"
        aria-describedby="link-ask-what"
        data-dg="link-delete"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") answer("cancel");
        }}
      >
        <h2 id="link-ask-title">{total === 1 ? "Delete this link?" : `Delete ${total} links?`}</h2>
        <p id="link-ask-what" className="link-ask-what">
          {total === 1 && only ? (
            <>
              “{plain(only.from)}” <strong>{only.label.toLowerCase()}</strong> “{plain(only.to)}”
            </>
          ) : (
            [...new Set(ask.links.map((link) => link.label))].join(", ")
          )}
        </p>
        <div className="link-ask-choices">
          <button ref={first} type="button" data-dg="link-delete-canvas" onClick={() => answer("canvas")}>
            <strong>Only from this canvas</strong>
            <span>{total === 1 ? "The relation stays" : "The relations stay"} in the graph and on other canvases.</span>
          </button>
          <button type="button" className="danger" data-dg="link-delete-withdraw" disabled={ask.mine === 0} onClick={() => answer("withdraw")}>
            <strong>{ask.mine === total ? (total === 1 ? "Withdraw the relation" : "Withdraw the relations") : `Withdraw yours (${ask.mine})`}</strong>
            <span>
              {ask.mine === 0
                ? `Only ${names(ask.others)} can withdraw ${total === 1 ? "it" : "them"}.`
                : `Taken back everywhere.${ask.others.length ? " The rest stay in the graph." : ""} Undo asserts ${ask.mine === 1 ? "it" : "them"} again.`}
            </span>
          </button>
        </div>
        <div className="link-ask-foot">
          <label>
            <input type="checkbox" data-dg="link-delete-remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            Remember my choice
          </label>
          <button type="button" className="quiet" data-dg="link-delete-cancel" onClick={() => answer("cancel")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
