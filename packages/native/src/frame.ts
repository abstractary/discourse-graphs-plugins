import type { SurfaceMessage, SurfacePort } from "@dg/contract/surface.ts";

export const portFrom = (port: MessagePort): SurfacePort => ({
  send: (message) => port.postMessage(message),
  onMessage: (listener) => {
    const handle = (event: MessageEvent<SurfaceMessage>): void =>
      listener(event.data);
    port.addEventListener("message", handle);
    port.start();
    return () => port.removeEventListener("message", handle);
  },
});

/** Hands a frame its private channel to core. The frame gets nothing else. */
export const connectFrame = ({
  frame,
  connect,
  route,
  test = false,
}: {
  frame: HTMLIFrameElement;
  connect: (port: SurfacePort) => void | Promise<void>;
  route: unknown;
  test?: boolean;
}): void => {
  // Listen before anything async: the frame can finish loading before core is ready.
  frame.addEventListener("load", () => {
    const channel = new MessageChannel();
    void Promise.resolve(connect(portFrom(channel.port1))).then(() => {
      frame.contentWindow?.postMessage({ type: "dg-connect", route, test }, "*", [
        channel.port2,
      ]);
    });
  });
};
