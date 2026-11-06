import type { Skin } from "@dg/contract/host.ts";
import type { CoreForAdapter } from "@dg/contract/core.ts";

/**
 * Sits in the base's own window, at the caret, because a panel can't reach the
 * editor. It never takes focus, so the selection stays alive while it's open.
 * Both adapters use this one menu, so the gesture is the same in each base.
 */
export type CaptureChoice = { id: string | null; label: string; key: string };

const ID = "dg-capture-menu";

const surface = (skin: Skin): string =>
  [
    "position:fixed",
    "z-index:99999",
    "box-sizing:border-box",
    `background:${skin.page}`,
    `color:${skin.ink}`,
    `border:1px solid ${skin.line}`,
    `border-radius:${skin.radius + 2}px`,
    "box-shadow:0 8px 24px rgba(0,0,0,.18)",
    `font:${skin.size}px/1.4 ${skin.font}`,
  ].join(";");

export const closeCaptureMenu = (): void => {
  document.getElementById(ID)?.dispatchEvent(new Event("dg-close"));
};

export const openCaptureMenu = ({
  at,
  choices,
  skin,
  onPick,
}: {
  at: { x: number; y: number };
  choices: CaptureChoice[];
  skin: Skin;
  onPick: (choice: CaptureChoice) => void;
}): void => {
  closeCaptureMenu();
  const menu = document.createElement("div");
  menu.id = ID;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Create a node");
  menu.dataset.dg = "capture-menu";
  menu.style.cssText = `${surface(skin)};padding:4px;min-width:170px;`;
  let active = 0;

  const rows = choices.map((choice, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.setAttribute("role", "menuitem");
    row.dataset.dg = `capture-${choice.label}`;
    row.style.cssText = `display:flex;gap:8px;align-items:center;justify-content:flex-start;width:100%;padding:3px 6px;border:0;border-radius:${skin.radius}px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;box-shadow:none;height:auto;`;
    const key = document.createElement("span");
    key.textContent = choice.key.toUpperCase();
    key.style.cssText = `min-width:14px;color:${skin.muted};font-size:${skin.size - 2}px;`;
    const label = document.createElement("span");
    label.textContent = choice.label;
    row.append(key, label);
    row.addEventListener("mouseenter", () => paint(index));
    row.addEventListener("click", () => pick(choice));
    menu.append(row);
    return row;
  });

  const paint = (index: number): void => {
    active = index;
    rows.forEach((row, place) => {
      row.style.background = place === index ? `color-mix(in srgb, ${skin.ink} 8%, transparent)` : "none";
    });
  };

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onOutside, true);
    menu.remove();
  };

  const pick = (choice: CaptureChoice): void => {
    close();
    onPick(choice);
  };

  const onKey = (event: KeyboardEvent): void => {
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "Escape") {
      handled();
      close();
    } else if (event.key === "ArrowDown") {
      handled();
      paint((active + 1) % choices.length);
    } else if (event.key === "ArrowUp") {
      handled();
      paint((active - 1 + choices.length) % choices.length);
    } else if (event.key === "Enter") {
      handled();
      pick(choices[active]!);
    } else if (!event.metaKey && !event.ctrlKey && event.key.length === 1) {
      handled();
      const match = choices.find((choice) => choice.key === event.key.toLowerCase());
      if (match) pick(match);
      else close();
    }
  };

  const onOutside = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };

  menu.addEventListener("dg-close", close);
  menu.addEventListener("mousedown", (event) => event.preventDefault());
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onOutside, true);
  document.body.append(menu);
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - height - 8))}px`;
  paint(0);
};

/** One letter per type. A clash falls to the next free letter of the label. */
export const captureChoices = (
  types: { id: string; label: string; abbreviation?: string }[],
): CaptureChoice[] => {
  const taken = new Set<string>();
  const keyFor = (text: string): string => {
    for (const letter of text.toLowerCase()) {
      if (/[a-z]/.test(letter) && !taken.has(letter)) {
        taken.add(letter);
        return letter;
      }
    }
    return "";
  };
  return [
    ...types.map(({ id, label, abbreviation }) => ({ id, label, key: keyFor(`${abbreviation ?? ""}${label}`) })),
    { id: null, label: "No type yet", key: keyFor("no type") },
  ];
};

/** The whole gesture, from menu to node, shared by the hotkey and the commands. */
export const startCapture = ({
  core,
  skin,
  at,
  mode,
}: {
  core: CoreForAdapter;
  skin: Skin;
  at: { x: number; y: number };
  mode: "selection" | "page";
}): void => {
  openCaptureMenu({
    at,
    skin,
    choices: captureChoices(core.nodeTypes()),
    onPick: ({ id }) => {
      const args = id ? { type: id } : {};
      void (mode === "page" ? core.convertFocused(args) : core.captureSelection(args)).then((result) => {
        if (!result.ok) showCaptureNotice(result.error.message, skin);
      });
    },
  });
};

export const showCaptureNotice = (text: string, skin: Skin): void => {
  const notice = document.createElement("div");
  notice.dataset.dg = "capture-notice";
  notice.textContent = text;
  notice.style.cssText = `${surface(skin)};right:16px;bottom:48px;padding:6px 10px;`;
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 3500);
};

/** A tiny prompt for the one thing that needs typing: a lab's name. */
export const askForName = ({
  label,
  skin,
  onDone,
}: {
  label: string;
  skin: Skin;
  onDone: (name: string) => void;
}): void => {
  const box = document.createElement("div");
  box.dataset.dg = "name-prompt";
  box.style.cssText = `${surface(skin)};left:50%;top:18vh;transform:translateX(-50%);width:300px;padding:10px;`;
  const input = document.createElement("input");
  input.placeholder = label;
  input.setAttribute("aria-label", label);
  input.style.cssText = `width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid ${skin.line};border-radius:${skin.radius}px;background:${skin.page};color:inherit;font:inherit;`;
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") box.remove();
    if (event.key === "Enter" && input.value.trim()) {
      box.remove();
      onDone(input.value.trim());
    }
  });
  box.append(input);
  document.body.append(box);
  input.focus();
};
