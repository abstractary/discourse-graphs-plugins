import type { Examples } from "@dg/contract/core.ts";
import type { HostRef, RelationRecord } from "@dg/contract/records.ts";
import type { Skin } from "@dg/contract/host.ts";
import type { Core } from "@dg/core/index.ts";
import { captureChoices, closeCaptureMenu } from "./capture-menu.ts";

/**
 * A walkthrough of the real interface, in the person's real graph. A stencil
 * dims everything except what matters now, and each step waits for the real
 * gesture, so people learn by doing. "Do it for me" means nobody gets stuck.
 * The steps are the same in every base. Only the words and the places differ.
 */
export type WalkthroughBase = {
  core: Core;
  /** What this base calls things. */
  place: string;
  note: string;
  /** The button that lists canvases, in the base's own UI. */
  canvasesButton: string;
  /** What to say about it, when it takes more than one click, such as a menu. */
  canvasesHint?: string;
  /** The base's own menus, which a step's target can open: they rise above the shade so they can be used. */
  menus?: string;
  /** Brings that button into view, if the base can hide it. */
  showNavigation?: () => Promise<void>;
  /** Where a canvas's own note or page shows up. */
  browsing: { selector?: string; text: string };
  writeNote: (title: string, lines: string[]) => Promise<HostRef>;
  readNote: (ref: HostRef) => Promise<string>;
  openNote: (ref: HostRef) => Promise<void>;
  /** Selects this text in the note, with the editor focused. */
  select: (ref: HostRef, text: string) => Promise<void>;
  selectionBox: () => DOMRect | null;
  leaveEditing: () => Promise<void>;
  frame: (surface: string) => HTMLIFrameElement | null;
  openCanvases: () => Promise<void>;
  showCanvas: (id: string) => Promise<void>;
  /** Closes anything showing these examples, before they're removed. */
  closeExamples: (examples: Examples) => Promise<void>;
  getLocal: (key: string) => Promise<unknown>;
  setLocal: (key: string, value: unknown) => Promise<void>;
};

type Target =
  | { host: string }
  | { surface: string; selector?: string }
  | { selection: true }
  | null;

type Step = {
  id: string;
  title: string;
  body: string;
  target?: () => Target;
  enter?: () => Promise<void>;
  /** The step finishes itself when this turns true. */
  done?: () => Promise<boolean> | boolean;
  doIt?: () => Promise<void>;
};

const OFFER_KEY = "walkthrough-offered";
const EXAMPLES_KEY = "walkthrough-examples";
const TICK_MS = 300;
const PAUSE_MS = 500;
const Z = 99990;

const SENTENCES = {
  claim: "Cells under tension build more actin.",
  evidence: "Actin doubled within an hour of stretching the cells.",
  against: "Actin stayed flat when myosin was blocked.",
  question: "Does tension control where actin assembles?",
};

const none = (): Examples => ({ texts: [], nodes: [], relations: [], canvases: [] });

const card = (skin: Skin): string =>
  [
    "position:fixed",
    `z-index:${Z + 2}`,
    "box-sizing:border-box",
    "width:320px",
    "max-width:calc(100vw - 24px)",
    "padding:12px 14px",
    `background:${skin.page}`,
    `color:${skin.ink}`,
    `border:1px solid ${skin.line}`,
    `border-radius:${skin.radius + 4}px`,
    "box-shadow:0 10px 32px rgba(0,0,0,.22)",
    `font:${skin.size + 1}px/1.45 ${skin.font}`,
  ].join(";");

const button = (skin: Skin, primary: boolean): string =>
  [
    "height:auto",
    "padding:4px 10px",
    "box-shadow:none",
    "cursor:pointer",
    `border-radius:${skin.radius}px`,
    `font:inherit`,
    primary ? `background:${skin.accent};color:${skin.page};border:1px solid ${skin.accent}` : `background:none;color:${skin.ink};border:1px solid ${skin.line}`,
  ].join(";");

type Parts = { root: HTMLElement; shades: HTMLElement[]; ring: HTMLElement; tip: HTMLElement };

const buildStencil = (skin: Skin): Parts => {
  const root = document.createElement("div");
  root.dataset.dg = "walkthrough";
  const shades = Array.from({ length: 4 }, () => {
    const shade = document.createElement("div");
    shade.style.cssText = `position:fixed;z-index:${Z};background:rgba(15,18,22,.42);`;
    root.append(shade);
    return shade;
  });
  const ring = document.createElement("div");
  ring.dataset.dg = "walkthrough-hole";
  ring.style.cssText = `position:fixed;z-index:${Z + 1};pointer-events:none;box-sizing:border-box;border:2px solid ${skin.accent};border-radius:${skin.radius + 2}px;`;
  const tip = document.createElement("div");
  tip.dataset.dg = "walkthrough-card";
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-label", "Walkthrough");
  tip.style.cssText = card(skin);
  // Keeps the editor's selection alive while a person uses the card.
  tip.addEventListener("mousedown", (event) => {
    if (!(event.target as HTMLElement).matches("input")) event.preventDefault();
  });
  root.append(ring, tip);
  document.body.append(root);
  return { root, shades, ring, tip };
};

/** Everything outside the hole stays dimmed and out of reach, as a stencil does. */
const paint = ({ shades, ring, tip }: Parts, hole: DOMRect | null): void => {
  const [top, right, bottom, left] = shades as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  const pad = 6;
  const set = (shade: HTMLElement, x: number, y: number, width: number, height: number): void => {
    shade.style.left = `${x}px`;
    shade.style.top = `${y}px`;
    shade.style.width = `${Math.max(0, width)}px`;
    shade.style.height = `${Math.max(0, height)}px`;
  };
  const { innerWidth: width, innerHeight: height } = window;
  const tipBox = tip.getBoundingClientRect();
  if (!hole) {
    set(top, 0, 0, width, height);
    set(right, 0, 0, 0, 0);
    set(bottom, 0, 0, 0, 0);
    set(left, 0, 0, 0, 0);
    ring.style.display = "none";
    tip.style.left = `${(width - tipBox.width) / 2}px`;
    tip.style.top = `${Math.max(16, (height - tipBox.height) / 2.4)}px`;
    return;
  }
  const x = Math.max(0, hole.left - pad);
  const y = Math.max(0, hole.top - pad);
  const w = Math.min(width - x, hole.width + pad * 2);
  const h = Math.min(height - y, hole.height + pad * 2);
  set(top, 0, 0, width, y);
  set(bottom, 0, y + h, width, height - y - h);
  set(left, 0, y, x, h);
  set(right, x + w, y, width - x - w, h);
  ring.style.display = "block";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.width = `${w}px`;
  ring.style.height = `${h}px`;
  const gap = 12;
  const spots = [
    { left: x, top: y + h + gap },
    { left: x, top: y - tipBox.height - gap },
    { left: x + w + gap, top: y },
    { left: x - tipBox.width - gap, top: y },
  ];
  const fits = ({ left: l, top: t }: { left: number; top: number }): boolean =>
    t >= 8 && t + tipBox.height <= height - 8 && l + tipBox.width >= 0 && l <= width;
  const spot = spots.find(fits) ?? { left: width - tipBox.width - 16, top: height - tipBox.height - 16 };
  tip.style.left = `${Math.max(8, Math.min(spot.left, width - tipBox.width - 8))}px`;
  tip.style.top = `${Math.max(8, spot.top)}px`;
};

let running: (() => void) | null = null;

export const walkthroughRunning = (): boolean => running !== null;

export const startWalkthrough = async (base: WalkthroughBase): Promise<void> => {
  if (running) return;
  const { core } = base;
  const skin = core.info.skin;
  const parts = buildStencil(skin);
  if (base.menus) {
    const lift = document.createElement("style");
    lift.textContent = `${base.menus} { z-index: ${Z + 3} !important; }`;
    parts.root.append(lift);
  }
  const examples = none();
  const remembered = (await base.getLocal(EXAMPLES_KEY)) as Examples | null;
  if (remembered) Object.assign(examples, remembered);
  const keep = (): Promise<void> => base.setLocal(EXAMPLES_KEY, examples);

  const types = core.nodeTypes();
  const typeOf = (kind: string) => types.find((type) => type.base === kind) ?? types[0];
  const keys = new Map(captureChoices(types).map(({ id, key }) => [id, key.toUpperCase()]));
  const keyFor = (kind: string): string => keys.get(typeOf(kind)?.id ?? null) ?? "";

  let note: HostRef = "";
  let canvas = "";
  // The newest wins, in case an earlier walkthrough left one behind with its text gone.
  const nodeTitled = (title: string): string | undefined =>
    [...core.graph().documents.values()]
      .filter((item) => item.kind === "node" && !item.removed && item.title === title)
      .sort((a, b) => b.at.localeCompare(a.at))[0]?.id;
  const refOfNode = (id: string | undefined): HostRef | undefined =>
    id
      ? ([...core.graph().documents.values()].find((item) => item.kind === "anchor" && item.node === id) as { ref: HostRef } | undefined)?.ref
      : undefined;
  // Judged from the note, because a node from an earlier walkthrough may already exist.
  const captured = async (sentence: string): Promise<boolean> =>
    (await base.readNote(note)).split("\n").some((line) => line.includes(sentence) && line.includes("[["));
  const track = async (sentence: string): Promise<void> => {
    const id = nodeTitled(sentence);
    if (id && !examples.nodes.includes(id)) examples.nodes.push(id);
    await keep();
  };
  const isShowing = async (surface: string, selector: string): Promise<boolean> =>
    base.frame(surface) !== null && (await core.locate({ surface, selector })) !== null;
  const relationBetween = (source: string | undefined, target: string | undefined): RelationRecord | undefined =>
    [...core.graph().relations.values()].find(({ record, state }) => state === "active" && record.source === source && record.target === target)?.record;

  const captureAs = (sentence: string, kind: string) => async (): Promise<void> => {
    closeCaptureMenu();
    await base.select(note, sentence);
    const type = typeOf(kind)?.id;
    await core.captureSelection(type ? { type } : {});
  };

  const steps: Step[] = [
    {
      id: "welcome",
      title: "Welcome to Discourse Graphs",
      body: `You'll turn ideas in your notes into a graph of questions, claims and evidence. It takes about 3 minutes and uses your real ${base.place}: we'll make a ${base.note}, four nodes and a canvas. At the end, you choose whether to keep them.`,
    },
    {
      id: "claim",
      title: "Turn a sentence into a node",
      body: `We've written a ${base.note} and selected a sentence. Press \\ then ${keyFor("claim")} to make it a claim. A link takes its place.`,
      target: () => ({ selection: true }),
      enter: async () => {
        await base.openNote(note);
        await base.select(note, SENTENCES.claim);
      },
      done: () => captured(SENTENCES.claim),
      doIt: captureAs(SENTENCES.claim, "claim"),
    },
    {
      id: "evidence",
      title: "Now the evidence",
      body: `This sentence backs the claim up. Press \\ then ${keyFor("evidence")}.`,
      target: () => ({ selection: true }),
      enter: async () => {
        await track(SENTENCES.claim);
        await base.select(note, SENTENCES.evidence);
      },
      done: () => captured(SENTENCES.evidence),
      doIt: captureAs(SENTENCES.evidence, "evidence"),
    },
    {
      id: "badge",
      title: "Links show what they connect",
      body: "Every link to a node gets a badge: a dot for its type, then how many relations it has. Click this one.",
      target: () => ({ host: `[data-dg="link-badge"][data-dg-ref=${JSON.stringify(refOfNode(nodeTitled(SENTENCES.claim)) ?? "")}]` }),
      enter: async () => {
        await track(SENTENCES.evidence);
        await base.leaveEditing();
      },
      // The panel may already be open, so what counts is that it moved to this node.
      done: async () => core.focusedNode() === nodeTitled(SENTENCES.claim) && (await isShowing("context", '[data-dg="ctx-title"]')),
      doIt: async () => {
        const ref = refOfNode(nodeTitled(SENTENCES.claim));
        if (ref) await core.showContext({ ref });
      },
    },
    {
      id: "context",
      title: "The context panel",
      body: "This shows one node: what it's related to, its text and who made it. It follows you from note to note.",
      target: () => ({ surface: "context" }),
    },
    {
      id: "canvases",
      title: "Find your canvases",
      body: `A canvas lays nodes out so you can see the whole argument. We've made one, with two more nodes. ${base.canvasesHint ?? "Click here to see your canvases."}`,
      target: () => ({ host: base.canvasesButton }),
      enter: async () => {
        await base.showNavigation?.();
        if (canvas) return;
        const made = await core.createCanvas({ title: "Walkthrough canvas" });
        if (!made.ok) return;
        canvas = made.value;
        examples.canvases.push(canvas);
        const against = typeOf("evidence")?.id;
        const question = typeOf("question")?.id;
        await core.capture({ text: SENTENCES.against, ...(against ? { type: against } : {}) });
        await core.capture({ text: SENTENCES.question, ...(question ? { type: question } : {}) });
        await track(SENTENCES.against);
        await track(SENTENCES.question);
        const [claim, evidence, opposing, asked] = [SENTENCES.claim, SENTENCES.evidence, SENTENCES.against, SENTENCES.question].map(nodeTitled);
        await core.addToCanvas({ canvas, nodes: [evidence, claim, opposing, asked].flatMap((id) => (id ? [id] : [])) });
        for (const [source, target, kind] of [[opposing, claim, "opposes"], [claim, asked, "addresses"]] as const) {
          if (!source || !target) continue;
          const related = await core.relateOnCanvas({ canvas, source, target, base: kind });
          if (related.ok) examples.relations.push(related.value);
        }
        await keep();
      },
      done: () => isShowing("canvases", ".cvs"),
      doIt: () => base.openCanvases(),
    },
    {
      id: "open-canvas",
      title: "Open the canvas",
      body: "Every canvas is listed here, the same in Obsidian and Roam. Click Walkthrough canvas.",
      target: () => ({ surface: "canvases", selector: '[data-dg="canvases-open-Walkthrough canvas"]' }),
      done: () => isShowing("canvas", ".card"),
      doIt: () => base.showCanvas(canvas),
    },
    {
      id: "card",
      title: "Cards",
      body: "Each card is a node. The chip shows its type, and the round mark shows who made it. Work shared from another lab shows that lab's square mark instead.",
      target: () => ({ surface: "canvas", selector: `[data-dg=${JSON.stringify(`card-${SENTENCES.claim}`)}]` }),
    },
    {
      id: "relate",
      title: "Connect two cards",
      body: "Hover over the evidence card, drag from its edge onto the claim, then choose a relation.",
      target: () => ({ surface: "canvas", selector: ".react-flow__renderer" }),
      done: () => relationBetween(nodeTitled(SENTENCES.evidence), nodeTitled(SENTENCES.claim)) !== undefined,
      doIt: async () => {
        const [source, target] = [nodeTitled(SENTENCES.evidence), nodeTitled(SENTENCES.claim)];
        if (source && target) await core.relateOnCanvas({ canvas, source, target, base: "supports" });
      },
    },
    {
      id: "tidy",
      title: "Tidy the canvas",
      body: "Tidy arranges everything at once. Open this menu and try For and against, then Timeline. Undo appears at the top right.",
      target: () => ({ surface: "canvas", selector: ".split" }),
      enter: async () => {
        const made = relationBetween(nodeTitled(SENTENCES.evidence), nodeTitled(SENTENCES.claim));
        if (made && !examples.relations.includes(made.id)) examples.relations.push(made.id);
        await keep();
      },
    },
    {
      id: "find",
      title: `Each canvas has its own ${base.note}`,
      body: base.browsing.text,
      target: () => (base.browsing.selector ? { host: base.browsing.selector } : null),
    },
    {
      id: "lab",
      title: "Papers and labs",
      body: "Run \"Upload a paper\" to give a paper's claims and evidence a canvas of their own. Run \"Join or start a lab\" to share them. Inside a lab you see who made each thing. Anyone outside it sees your lab's square mark, and the lab's PI keeps custody of its work.",
    },
    {
      id: "finish",
      title: "That's the tour",
      body: "Keep the examples to explore them, or remove them. You can run this again any time with \"Start walkthrough\".",
    },
  ];

  let index = 0;
  let hole: DOMRect | null = null;
  let moving = false;
  let timer: number | undefined;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("keydown", onKey, true);
    parts.root.remove();
    running = null;
  };

  const onKey = (event: KeyboardEvent): void => {
    // Only a person's own key counts. An adapter may send Escape to leave editing.
    if (event.key !== "Escape" || !event.isTrusted || document.querySelector('[data-dg="capture-menu"]')) return;
    event.preventDefault();
    event.stopPropagation();
    leave();
  };

  /** Leaving early still offers the choice, if there's anything to choose about. */
  const leave = (): void => {
    const made = examples.texts.length + examples.nodes.length + examples.canvases.length;
    if (made === 0) stop();
    else void goTo(steps.length - 1);
  };

  const actions = (step: Step): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:10px;";
    const add = (label: string, dg: string, primary: boolean, onClick: () => void): void => {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = label;
      item.dataset.dg = dg;
      item.style.cssText = button(skin, primary);
      item.addEventListener("click", onClick);
      row.append(item);
    };
    if (step.id === "welcome") {
      add("Not now", "walkthrough-later", false, stop);
      add("Start", "walkthrough-start", true, () => void begin());
    } else if (step.id === "finish") {
      add("Remove them", "walkthrough-remove", false, () => void removeAll());
      add("Keep them", "walkthrough-keep", true, stop);
    } else if (step.doIt) {
      add("Do it for me", "walkthrough-do", false, () => void step.doIt!());
    } else {
      add("Next", "walkthrough-next", true, () => void goTo(index + 1));
    }
    return row;
  };

  const render = (step: Step): void => {
    const { tip } = parts;
    tip.replaceChildren();
    tip.dataset.step = step.id;
    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:8px;";
    const title = document.createElement("strong");
    title.textContent = step.title;
    title.style.fontWeight = "600";
    const count = document.createElement("span");
    count.textContent = `${index + 1} of ${steps.length}`;
    count.style.cssText = `flex:none;margin-left:auto;color:${skin.muted};font-size:${skin.size - 1}px;`;
    head.append(title, count);
    if (step.id !== "welcome" && step.id !== "finish") {
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.dataset.dg = "walkthrough-close";
      close.setAttribute("aria-label", "Leave the walkthrough");
      close.title = "Leave the walkthrough";
      close.style.cssText = `flex:none;height:auto;padding:0 4px;border:0;background:none;box-shadow:none;color:${skin.muted};font:inherit;cursor:pointer;`;
      close.addEventListener("click", leave);
      head.append(close);
    }
    const body = document.createElement("p");
    body.textContent = step.body;
    body.style.cssText = "margin:6px 0 0;";
    body.setAttribute("aria-live", "polite");
    tip.append(head, body);
    if (step.id === "welcome") {
      const label = document.createElement("label");
      label.textContent = "Your work will be credited to";
      label.style.cssText = `display:block;margin-top:10px;color:${skin.muted};font-size:${skin.size - 1}px;`;
      const input = document.createElement("input");
      input.dataset.dg = "walkthrough-name";
      input.value = core.personName();
      input.style.cssText = `display:block;width:100%;box-sizing:border-box;margin-top:3px;padding:5px 8px;border:1px solid ${skin.line};border-radius:${skin.radius}px;background:${skin.page};color:${skin.ink};font:inherit;`;
      input.addEventListener("keydown", (event) => event.stopPropagation());
      label.append(input);
      tip.append(label);
    }
    tip.append(actions(step));
  };

  const rectOf = async (target: Target): Promise<DOMRect | null> => {
    if (!target) return null;
    if ("selection" in target) return base.selectionBox();
    if ("host" in target) {
      const box = document.querySelector(target.host)?.getBoundingClientRect();
      return box && box.width > 0 ? box : null;
    }
    const frame = base.frame(target.surface);
    if (!frame) return null;
    const outer = frame.getBoundingClientRect();
    if (!target.selector) return outer;
    const inner = await core.locate({ surface: target.surface, selector: target.selector });
    if (!inner) return null;
    // Stays inside the frame, so a card scrolled off the edge doesn't pull the hole with it.
    const left = Math.max(outer.left, outer.left + inner.x);
    const top = Math.max(outer.top, outer.top + inner.y);
    const right = Math.min(outer.right, outer.left + inner.x + inner.width);
    const bottom = Math.min(outer.bottom, outer.top + inner.y + inner.height);
    return right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : outer;
  };

  const tick = async (): Promise<void> => {
    if (stopped || moving) return;
    const step = steps[index]!;
    hole = await rectOf(step.target?.() ?? null);
    if (stopped) return;
    paint(parts, hole);
    if (step.done && (await step.done())) {
      moving = true;
      window.setTimeout(() => {
        moving = false;
        void goTo(index + 1);
      }, PAUSE_MS);
    }
  };

  const goTo = async (next: number): Promise<void> => {
    if (stopped) return;
    index = Math.min(next, steps.length - 1);
    const step = steps[index]!;
    moving = true;
    render(step);
    paint(parts, null);
    try {
      await step.enter?.();
    } finally {
      moving = false;
    }
    await tick();
  };

  const begin = async (): Promise<void> => {
    const name = parts.tip.querySelector<HTMLInputElement>("input")?.value.trim();
    if (name && name !== core.personName()) await core.setName(name);
    await base.setLocal(OFFER_KEY, true);
    let title = "Walkthrough notes";
    for (let attempt = 2; attempt < 20 && !note; attempt += 1) {
      try {
        note = await base.writeNote(title, [SENTENCES.claim, SENTENCES.evidence]);
      } catch {
        title = `Walkthrough notes ${attempt}`;
      }
    }
    examples.texts.push(note);
    await keep();
    await goTo(1);
  };

  const removeAll = async (): Promise<void> => {
    await base.closeExamples(examples);
    await core.removeExamples(examples);
    await base.setLocal(EXAMPLES_KEY, null);
    stop();
  };

  running = stop;
  document.addEventListener("keydown", onKey, true);
  timer = window.setInterval(() => void tick(), TICK_MS);
  await goTo(0);
};

/** For someone who kept the examples, then changes their mind. */
export const removeWalkthroughExamples = async (base: WalkthroughBase): Promise<boolean> => {
  const examples = (await base.getLocal(EXAMPLES_KEY)) as Examples | null;
  if (!examples) return false;
  await base.closeExamples(examples);
  await base.core.removeExamples(examples);
  await base.setLocal(EXAMPLES_KEY, null);
  return true;
};

/** A small offer, once per device. It never starts by itself. */
export const offerWalkthrough = async ({
  skin,
  getLocal,
  setLocal,
  onStart,
}: {
  skin: Skin;
  getLocal: (key: string) => Promise<unknown>;
  setLocal: (key: string, value: unknown) => Promise<void>;
  onStart: () => void;
}): Promise<void> => {
  if (await getLocal(OFFER_KEY)) return;
  const offer = document.createElement("div");
  offer.dataset.dg = "walkthrough-offer";
  offer.style.cssText = `${card(skin)};right:16px;bottom:44px;`;
  const text = document.createElement("div");
  text.textContent = "New to Discourse Graphs? Take a 3-minute walkthrough. It makes a small example you can remove at the end.";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:10px;";
  const close = (): void => {
    offer.remove();
    void setLocal(OFFER_KEY, true);
  };
  const later = document.createElement("button");
  later.type = "button";
  later.textContent = "Not now";
  later.dataset.dg = "walkthrough-offer-later";
  later.style.cssText = button(skin, false);
  later.addEventListener("click", close);
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Start";
  start.dataset.dg = "walkthrough-offer-start";
  start.style.cssText = button(skin, true);
  start.addEventListener("click", () => {
    close();
    onStart();
  });
  row.append(later, start);
  offer.append(text, row);
  document.body.append(offer);
};

export const closeWalkthroughOffer = (): void => {
  document.querySelector('[data-dg="walkthrough-offer"]')?.remove();
};
