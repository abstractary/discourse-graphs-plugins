import { useCallback, useEffect, useRef, useState } from "react";
import { providerOf } from "@dg/contract/llm.ts";
import type { AiStatus, CanvasView } from "@dg/contract/surface.ts";
import { AiSetup } from "../shared/AiSetup.tsx";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";

type Answer = { text: string; citations: string[]; mode?: "model" | "search-only"; model?: string; source?: "own" | "lab" | "none"; stopped?: boolean };

/** Answers cite units by id. A person reads a number, matched to the list under the answer. */
const numbered = ({ text, citations }: Answer): { text: string; order: string[] } => {
  const order = [...citations];
  const shown = text.replace(/\[(did:[^\]\s]+)\]/g, (_, id: string) => {
    if (!order.includes(id)) order.push(id);
    return `[${order.indexOf(id) + 1}]`;
  });
  return { text: shown, order };
};

/** Whose model is answering, in a few words. */
const modelLine = (status: AiStatus | null): string => {
  if (!status) return "";
  if (status.source === "own" && status.local) return `${status.model} · on this computer`;
  if (status.source === "own") return `${status.model} · your key${status.route === "lab" ? ", through your lab" : status.provider ? `, ${providerOf(status.provider).label}` : ""}`;
  if (status.source === "lab" && status.mode === "model") return `${status.model ?? "A model"} · your lab's`;
  return "No model · quoting units";
};

/**
 * Type to ask about the canvas. The cards selected when the question is sent
 * narrow the answer to those units. The model is the lab's, or one reached
 * with a person's own key, set up from this bar.
 */
export const AiBar = ({
  connection,
  view,
  grounded,
  onClear,
  onCite,
  onClose,
}: {
  connection: Connection;
  view: CanvasView;
  grounded: string[];
  onClear: () => void;
  onCite: (node: string) => void;
  onClose: () => void;
}) => {
  const { call, on } = connection;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [setup, setSetup] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const asking = useRef("");
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => void call("ai.status", {}).then(setStatus), [call]);
  useEffect(() => {
    refresh();
    input.current?.focus();
  }, [refresh]);
  useEffect(() => on("ai-changed", refresh), [on, refresh]);

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
      setAnswer({
        text: result.answer,
        citations: result.citations,
        mode: result.mode,
        ...(result.model ? { model: result.model } : {}),
        ...(result.source ? { source: result.source } : {}),
        ...(result.stopped ? { stopped: true } : {}),
      });
    } catch (error) {
      setAnswer(null);
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const none = status?.source === "none";

  return (
    <div
      className="ai-bar"
      data-dg="ai-bar"
      role="region"
      aria-label="Ask AI"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (setup) setSetup(false);
        else onClose();
      }}
    >
      <div className="ai-head">
        <span className="ai-model" data-dg="ai-model-line" data-source={status?.source ?? ""}>{modelLine(status)}</span>
        {status?.canSetUp || status?.source === "lab" ? (
          <button type="button" data-dg="ai-setup-open" aria-expanded={setup} onClick={() => setSetup((open) => !open)}>
            {none ? "Use my own key" : "Change model"}
          </button>
        ) : null}
        <button type="button" className="icon-only" data-dg="ai-close" aria-label="Close Ask AI" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {setup ? (
        <AiSetup
          connection={connection}
          onCancel={() => setSetup(false)}
          onDone={() => {
            setSetup(false);
            refresh();
            input.current?.focus();
          }}
        />
      ) : (
        <>
          {none && !answer && status?.why ? <p className="ai-note" data-dg="ai-why">{status.why} Until then, a question finds the closest units and quotes them.</p> : null}
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
              {answer.mode === "model" && answer.model ? (
                <span className="ai-mode" data-dg="ai-mode">
                  {answer.stopped ? "Stopped early. " : ""}Answered by {answer.model}{answer.source === "own" ? (status?.local ? ", on this computer" : ", with your key") : ""}, from {grounded.length > 0 ? "the units you picked" : "this canvas"} only.
                </span>
              ) : null}
            </>
          ) : null}
          {problem ? <p className="ai-problem" role="alert" data-dg="ai-problem">{problem}</p> : null}
          <div className="ai-ground" data-dg="ai-ground">
            {grounded.length > 0 ? (
              <>
                <span>Answering from {grounded.length} picked {grounded.length === 1 ? "unit" : "units"}</span>
                <button type="button" data-dg="ai-clear" onClick={onClear}>Use the whole canvas</button>
              </>
            ) : (
              <span>Answering from the whole canvas. Click cards to narrow it to them.</span>
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
            {busy ? (
              <button type="button" data-dg="ai-stop" onClick={() => void call("ai.cancel", { requestId: asking.current })}>Stop</button>
            ) : (
              <button type="button" className="primary" data-dg="ai-send" aria-label="Ask" disabled={!question.trim()} onClick={() => void ask()}>
                <Icon name="ai" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
