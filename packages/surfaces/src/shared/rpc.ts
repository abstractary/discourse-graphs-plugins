import type { Appearance, Skin } from "@dg/contract/host.ts";
import type { SurfaceEvent, SurfaceMethod, SurfaceMethods } from "@dg/contract/surface.ts";

export type Call = <M extends SurfaceMethod>(
  method: M,
  params: SurfaceMethods[M]["params"],
) => Promise<SurfaceMethods[M]["result"]>;

type EventName = SurfaceEvent["event"];
type EventOf<E extends EventName> = Extract<SurfaceEvent, { event: E }>;

type Incoming = {
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: { message: string };
  event?: EventName;
};

export type Connection = {
  call: Call;
  on: <E extends EventName>(event: E, listener: (message: EventOf<E>) => void) => () => void;
  route: { surface: string; id?: string; pinned?: boolean };
};

/** Tokens the stylesheet reads. Nothing below this line knows which base it's in. */
const applyLook = (appearance: Appearance, skin: Skin): void => {
  const root = document.documentElement;
  root.dataset.theme = appearance;
  const set = (name: string, value: string): void => root.style.setProperty(name, value);
  set("--dg-font", skin.font);
  set("--dg-text-font", skin.textFont);
  set("--dg-size", `${skin.size}px`);
  set("--dg-ink", skin.ink);
  set("--dg-muted", skin.muted);
  set("--dg-page", skin.page);
  set("--dg-panel", skin.panel);
  set("--dg-line", skin.line);
  set("--dg-accent", skin.accent);
  set("--dg-radius", `${skin.radius}px`);
};

/** The frame's only way out is the port it's handed here. */
export const connect = (): Promise<Connection> =>
  new Promise((resolve) => {
    const onConnect = (event: MessageEvent): void => {
      const data = event.data as {
        type?: string;
        route?: Connection["route"];
        test?: boolean;
      } | null;
      if (data?.type !== "dg-connect" || !event.ports[0]) return;
      window.removeEventListener("message", onConnect);
      const port = event.ports[0];
      const waiting = new Map<
        string,
        { resolve: (value: never) => void; reject: (error: Error) => void }
      >();
      const listeners = new Map<EventName, Set<(message: never) => void>>();
      let next = 0;
      port.onmessage = ({ data: message }: MessageEvent<Incoming>) => {
        if (message.event) {
          const surfaceEvent = message as SurfaceEvent;
          if (surfaceEvent.event === "appearance-changed") {
            applyLook(surfaceEvent.appearance, surfaceEvent.skin);
          }
          if (surfaceEvent.event === "locate") {
            const found = document.querySelector(surfaceEvent.selector)?.getBoundingClientRect();
            port.postMessage({
              event: "located",
              requestId: surfaceEvent.requestId,
              surface: data.route?.surface ?? "canvas",
              box: found ? { x: found.x, y: found.y, width: found.width, height: found.height } : null,
            });
          }
          for (const listener of listeners.get(message.event) ?? []) listener(message as never);
        }
        if (message.id && waiting.has(message.id)) {
          const entry = waiting.get(message.id)!;
          waiting.delete(message.id);
          if (message.ok) entry.resolve(message.result as never);
          else entry.reject(new Error(message.error?.message ?? "Failed"));
        }
      };
      if (data.test) installProbe();
      resolve({
        route: data.route ?? { surface: "canvas" },
        call: (method, params) =>
          new Promise((done, reject) => {
            next += 1;
            const id = `r${next}`;
            waiting.set(id, { resolve: done as (value: never) => void, reject });
            port.postMessage({ id, method, params });
          }),
        on: (name, listener) => {
          const set = listeners.get(name) ?? new Set();
          listeners.set(name, set);
          set.add(listener as (message: never) => void);
          return () => {
            set.delete(listener as (message: never) => void);
          };
        },
      });
    };
    window.addEventListener("message", onConnect);
  });

/** Only present when a test harness asks for it at connect time. */
const installProbe = (): void => {
  let doubleClicks = 0;
  window.addEventListener("dblclick", () => {
    doubleClicks += 1;
  }, true);
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as {
      dg?: string;
      what?: string;
      selector?: string;
      prop?: string;
      requestId?: number;
    } | null;
    if (data?.dg !== "probe" || !data.selector) return;
    const element = document.querySelector(data.selector);
    let value: unknown = null;
    if (element && data.what === "text") value = element.textContent;
    if (element && data.what === "value") value = (element as HTMLInputElement).value;
    if (element && data.what === "style" && data.prop) {
      value = getComputedStyle(element).getPropertyValue(data.prop).trim();
    }
    if (element && data.what === "pick" && data.prop) {
      // A file, as if picked. The tests use the real chooser where the host lets them.
      const { name, type, base64 } = JSON.parse(data.prop) as { name: string; type: string; base64: string };
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, { type }));
      (element as HTMLInputElement).files = transfer.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      value = true;
    }
    if (element && data.what === "choose" && data.prop !== undefined) {
      // A native menu is drawn outside the page, where a test's mouse can't reach it.
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(element, data.prop);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      value = (element as HTMLSelectElement).value;
    }
    if (element && data.what === "dragTo" && data.prop) {
      // HTML drag and drop, which a test's mouse can't start: from this element to a point in the frame.
      const { x, y } = JSON.parse(data.prop) as { x: number; y: number };
      const transfer = new DataTransfer();
      element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const target = document.elementFromPoint(x, y) ?? document.body;
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      element.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
      value = [...transfer.types];
    }
    if (element && data.what === "dropFile" && data.prop) {
      // A file dropped from the desktop onto this element.
      const { name, type, base64 } = JSON.parse(data.prop) as { name: string; type: string; base64: string };
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, { type }));
      element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      value = true;
    }
    if (element && data.what === "reveal") {
      element.scrollIntoView({ block: "center" });
      value = true;
    }
    if (data.what === "focus") value = document.activeElement?.getAttribute("data-dg") ?? document.activeElement?.tagName ?? null;
    if (data.what === "doubleClicks") value = doubleClicks;
    if (data.what === "selection") value = document.getSelection()?.toString() ?? "";
    if (data.what === "count") value = document.querySelectorAll(data.selector).length;
    if (data.what === "drawn") {
      // Every link as the browser drew it, for judging a layout on what's on screen.
      value = {
        links: Array.from(document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")).map((path) => {
          const matrix = path.getScreenCTM()!;
          const total = path.getTotalLength();
          const points = Array.from({ length: 49 }, (_, step) => {
            const point = path.getPointAtLength((total * step) / 48).matrixTransform(matrix);
            return [point.x, point.y];
          });
          return { id: path.closest(".react-flow__edge")?.getAttribute("data-id"), stroke: getComputedStyle(path).stroke, points };
        }),
        cards: Array.from(document.querySelectorAll(".react-flow__node")).map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { id: node.getAttribute("data-id"), x, y, width, height };
        }),
        zoom: Number(/scale\(([\d.]+)\)/.exec(document.querySelector<HTMLElement>(".react-flow__viewport")?.style.transform ?? "")?.[1] ?? 1),
        frame: { width: window.innerWidth, height: window.innerHeight },
      };
    }
    if (data.what === "theme") value = document.documentElement.dataset.theme ?? null;
    if (data.what === "scroll") {
      const { scrollWidth, clientWidth } = document.documentElement;
      const outside = Array.from(document.querySelectorAll("body *"))
        .filter((item) => item.getBoundingClientRect().right > clientWidth + 1 && !item.closest(".react-flow__viewport"))
        .slice(0, 4)
        .map((item) => `${item.tagName}.${item.getAttribute("class") ?? ""}`);
      value = { scrollWidth, clientWidth, outside };
    }
    if (element && data.what === "box") {
      const { left, top, width, height } = element.getBoundingClientRect();
      value = { x: left, y: top, width, height };
    }
    window.parent.postMessage({ dg: "probe-reply", requestId: data.requestId, value }, "*");
  });
};
