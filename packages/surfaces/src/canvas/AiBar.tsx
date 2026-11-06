import { useEffect, useRef, useState } from "react";
import type { AiStatus, CanvasView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";

type Answer = { text: string; citations: string[]; mode?: "model" | "search-only"; model?: string };

/** Answers cite units by id. A person reads a number, matched to the list under the answer. */
const numbered = ({ text, citations }: Answer): { text: string; order: string[] } => {
  const order = [...citations];
  const shown = text.replace(/\[(did:[^\]\s]+)\]/g, (_, id: string) => {
    if (!order.includes(id)) order.push(id);
    return `[${order.indexOf(id) + 1}]`;
  });
  return { text: shown, order };
};

/** Type to ask about the canvas. Clicking cards narrows the answer to those units. */
export const AiBar = ({
  connection,
  view,
  grounded,
  onClear,
  onCite,
}: {
  connection: Connection;
  view: CanvasView;
  grounded: string[];
  onClear: () => void;
  onCite: (node: string) => void;
}) => {
  const { call, on } = connection;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const asking = useRef("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void call("ai.status", {}).then(setStatus);
    input.current?.focus();
  }, [call]);

  useEffect(
    () =>
      on("ai-delta", ({ requestId, text }) => {
        if (requestId !== asking.current) return;
        setAnswer((old) => ({ citations: [], ...old, text: `${old?.text ?? ""}${text}` }));
      }),
    [on],
  );

  const ask = async (): Promise<void> => {
    const text = question.trim();
    if (!text || busy) return;
    const requestId = `ask-${Date.now()}`;
    asking.current = requestId;
    setBusy(true);
    setProblem("");
    setAnswer({ text: "", citations: [] });
    try {
      const result = await call("ai.ask", { canvas: view.canvas.id, question: text, grounded, requestId });
      setAnswer({ text: result.answer, citations: result.citations, mode: result.mode, ...(result.model ? { model: result.model } : {}) });
    } catch (error) {
      setAnswer(null);
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.ready) {
    return (
      <div className="ai-bar" data-dg="ai-bar">
        <p className="note" data-dg="ai-why">{status.why}</p>
        <div className="row end">
          <button type="button" data-dg="ai-library" onClick={() => void call("panel.open", { surface: "canvases" })}>Open the Library</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-bar" data-dg="ai-bar">
      {answer ? (
        <>
          <div className="ai-answer" data-dg="ai-answer" role="status" aria-live="polite">{numbered(answer).text}</div>
          {answer.citations.length > 0 ? (
            <div className="ai-cites" data-dg="ai-citations">
              {numbered(answer).order.map((id, index) => (
                <button key={id} type="button" title={plain(view.nodes[id]?.title ?? "")} onClick={() => onCite(id)}>{index + 1}. {plain(view.nodes[id]?.title ?? "A unit no longer here")}</button>
              ))}
            </div>
          ) : null}
          {answer.mode === "search-only" ? <span className="ai-mode" data-dg="ai-mode">No model is connected, so this quotes the closest units word for word.</span> : null}
          {answer.mode === "model" && answer.model ? <span className="ai-mode" data-dg="ai-mode">Answered by {answer.model}, from this canvas only.</span> : null}
        </>
      ) : null}
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="ai-ground" data-dg="ai-ground">
        {grounded.length > 0 ? (
          <>
            <span>Grounded in {grounded.length} {grounded.length === 1 ? "unit" : "units"}</span>
            <button type="button" data-dg="ai-clear" onClick={onClear}>Clear</button>
          </>
        ) : (
          <span>Asking the whole canvas. Click cards to ground the answer in them.</span>
        )}
      </div>
      <div className="ai-input">
        <input
          ref={input}
          data-dg="ai-input"
          aria-label="Ask about this canvas"
          placeholder="Ask about this canvas"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void ask();
          }}
        />
        <button type="button" className="primary" data-dg="ai-send" disabled={busy || !question.trim()} onClick={() => void ask()}>
          <Icon name="ai" />
        </button>
      </div>
    </div>
  );
};
