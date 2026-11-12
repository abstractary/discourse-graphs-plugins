import type { Skin, SurfaceRoute } from "@dg/contract/host.ts";

const ID = "dg-dialog";
const Z = 99980;

export const closeDialogFrame = (): void => {
  document.getElementById(ID)?.dispatchEvent(new Event("dg-close"));
};

/** The quick finder sits high, like a base's own switcher, and a click outside it closes it. */
const FINDER = { width: 640, height: 460 };

/** A pop-up over the base. The panel inside it is the same sandboxed frame as any other. */
export const openDialogFrame = ({
  html,
  route,
  skin,
  connect,
  width = route.surface === "find" ? FINDER.width : 480,
  height = route.surface === "find" ? FINDER.height : 640,
}: {
  html: string;
  route: SurfaceRoute;
  skin: Skin;
  connect: (frame: HTMLIFrameElement) => void;
  width?: number;
  height?: number;
}): void => {
  const finder = route.surface === "find";
  closeDialogFrame();
  const scrim = document.createElement("div");
  scrim.id = ID;
  scrim.dataset.dg = "dialog";
  scrim.dataset.surface = route.surface;
  scrim.style.cssText = `position:fixed;inset:0;z-index:${Z};display:flex;align-items:${finder ? "flex-start" : "center"};justify-content:center;${finder ? "padding-top:12vh;box-sizing:border-box;" : ""}background:rgba(15,18,22,${finder ? ".22" : ".42"});`;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "Discourse Graphs");
  frame.srcdoc = html;
  frame.style.cssText = `border:1px solid ${skin.line};border-radius:${skin.radius + 4}px;background:${skin.page};width:min(${width}px,calc(100vw - 32px));height:min(${height}px,calc(100vh - 48px));box-shadow:0 12px 40px rgba(0,0,0,.28);`;
  connect(frame);
  // The finder is typed into at once, so its frame takes the keyboard as it loads.
  if (finder) frame.addEventListener("load", () => frame.focus());
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  scrim.addEventListener("dg-close", close);
  if (finder) scrim.addEventListener("pointerdown", (event) => event.target === scrim && close());
  document.addEventListener("keydown", onKey, true);
  scrim.append(frame);
  document.body.append(scrim);
};

/**
 * Offered as a lab paper closes. Leaving one is a choice, so nothing is recorded
 * until a person says so, and they can set how to answer from now on.
 */
export const askBreadcrumb = ({
  skin,
  title,
  onAnswer,
}: {
  skin: Skin;
  title: string;
  onAnswer: (leave: boolean, remember: boolean) => void;
}): void => {
  document.querySelector('[data-dg="breadcrumb"]')?.remove();
  const box = document.createElement("div");
  box.dataset.dg = "breadcrumb";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Leave a breadcrumb");
  box.style.cssText = `position:fixed;z-index:${Z};right:16px;bottom:44px;box-sizing:border-box;width:320px;padding:12px 14px;background:${skin.page};color:${skin.ink};border:1px solid ${skin.line};border-radius:${skin.radius + 4}px;box-shadow:0 10px 32px rgba(0,0,0,.22);font:${skin.size + 1}px/1.45 ${skin.font};`;
  const text = document.createElement("div");
  text.textContent = `Leave a breadcrumb on "${title}"? Your lab would see you read it.`;
  const remember = document.createElement("label");
  remember.style.cssText = `display:flex;align-items:center;gap:6px;margin-top:8px;color:${skin.muted};font-size:${skin.size - 1}px;`;
  const check = document.createElement("input");
  check.type = "checkbox";
  check.dataset.dg = "breadcrumb-remember";
  remember.append(check, "Do this every time");
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:10px;";
  const answer = (label: string, leave: boolean, dg: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.dg = dg;
    button.style.cssText = `height:auto;padding:4px 10px;box-shadow:none;cursor:pointer;border-radius:${skin.radius}px;font:inherit;${leave ? `background:${skin.accent};color:${skin.page};border:1px solid ${skin.accent};` : `background:none;color:${skin.ink};border:1px solid ${skin.line};`}`;
    button.addEventListener("click", () => {
      box.remove();
      onAnswer(leave, check.checked);
    });
    return button;
  };
  row.append(answer("Not this time", false, "breadcrumb-skip"), answer("Leave one", true, "breadcrumb-leave"));
  box.append(text, remember, row);
  document.body.append(box);
};
