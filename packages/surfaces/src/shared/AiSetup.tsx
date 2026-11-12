import { useCallback, useEffect, useRef, useState } from "react";
import { AI_PROVIDERS, OPENAI_COMPATIBLE, providerOf, type AiModel, type AiProviderKind, type AiRoute, type AiSettings, type AiSource } from "@dg/contract/llm.ts";
import type { Connection } from "./rpc.ts";

const KEPT: Record<AiSettings["keptIn"], string> = {
  keychain: "The key is kept in this device's keychain. It is never written to your notes, and it doesn't sync.",
  file: "The key is kept on this computer in a file only your user account can read, outside your notes.",
  plain: "There is no keychain here, so the key is kept unencrypted in this app's own storage on this device. It is never written to your notes.",
  nowhere: "This app has nowhere to keep a key.",
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Choosing whose model answers: the lab's, or one reached with a person's own
 * key. The key is typed here once and sent to the core, which stores it; it is
 * never sent back, so a saved key shows only its last four characters.
 */
export const AiSetup = ({ connection, onDone, onCancel }: { connection: Connection; onDone: () => void; onCancel?: () => void }) => {
  const { call } = connection;
  const [saved, setSaved] = useState<AiSettings | null>(null);
  const [source, setSource] = useState<AiSource>("own");
  const [provider, setProvider] = useState<AiProviderKind>("anthropic");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [route, setRoute] = useState<AiRoute>("device");
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [listProblem, setListProblem] = useState("");
  const loads = useRef(0);

  const spec = providerOf(provider);
  const address = spec.customUrl ? baseUrl.trim() || spec.baseUrl : spec.baseUrl;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(address);
  const keyOnFile = Boolean(saved?.hasKey && saved.provider === provider);
  const needsKey = spec.needsKey || !local;

  useEffect(() => {
    void call("ai.settings", {}).then((view) => {
      setSaved(view);
      setSource(view.inLab ? view.source : "own");
      setProvider(view.provider);
      setBaseUrl(view.baseUrl ?? "");
      setModel(view.model);
      setRoute(view.route);
    });
  }, [call]);

  const loadModels = useCallback(
    async (typed: string): Promise<void> => {
      if (needsKey && !typed.trim() && !keyOnFile) {
        setModels(null);
        return;
      }
      const mine = (loads.current += 1);
      setLoading(true);
      setListProblem("");
      try {
        const list = await call("ai.models", { provider, ...(spec.customUrl && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}), ...(typed.trim() ? { key: typed.trim() } : {}) });
        if (mine !== loads.current) return;
        setModels(list);
        setModel((current) => (list.some((item) => item.id === current) ? current : (list.find((item) => item.id === spec.defaultModel)?.id ?? list[0]?.id ?? current)));
      } catch (error) {
        if (mine !== loads.current) return;
        setModels(null);
        setListProblem(error instanceof Error ? error.message : String(error));
      } finally {
        if (mine === loads.current) setLoading(false);
      }
    },
    [baseUrl, call, keyOnFile, needsKey, provider, spec.customUrl, spec.defaultModel],
  );

  // The list follows the provider and address; a typed key loads it when the field is left.
  useEffect(() => {
    if (saved && source === "own") void loadModels("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, source, provider, address]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      if (source === "lab") {
        await call("ai.configure", { source: "lab" });
        onDone();
        return;
      }
      if (needsKey && !key.trim() && !keyOnFile) throw new Error("Paste a key first.");
      if (!model.trim()) throw new Error("Choose a model first.");
      await call("ai.configure", { source: "own", provider, model: model.trim(), baseUrl: spec.customUrl ? baseUrl.trim() : "", route, ...(key.trim() ? { key: key.trim() } : {}) });
      setKey("");
      const tried = await call("ai.test", {});
      setSaved(await call("ai.settings", {}));
      if (!tried.ok) throw new Error(`Saved, but the test call failed. ${tried.message}`);
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (): Promise<void> => {
    setSaved(await call("ai.configure", { provider, key: null }));
    setModels(null);
  };

  if (!saved) return <div className="ai-setup" data-dg="ai-setup" aria-busy="true" />;
  if (!saved.canCall && !saved.inLab) {
    return (
      <div className="ai-setup" data-dg="ai-setup">
        <p className="ai-note">This app can't keep a key or reach a model service from here. Join a lab that has a model to get answers.</p>
      </div>
    );
  }

  return (
    <form
      className="ai-setup"
      data-dg="ai-setup"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && onCancel) {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      {saved.inLab ? (
        <fieldset className="ai-source">
          <legend>Whose model answers</legend>
          <label>
            <input type="radio" name="ai-source" data-dg="ai-source-lab" checked={source === "lab"} onChange={() => setSource("lab")} /> My lab's model
          </label>
          <label>
            <input type="radio" name="ai-source" data-dg="ai-source-own" checked={source === "own"} onChange={() => setSource("own")} disabled={!saved.canCall} /> My own key
          </label>
        </fieldset>
      ) : null}
      {source === "own" ? (
        <>
          <label className="field">
            <span>Provider</span>
            <select
              data-dg="ai-provider"
              value={provider}
              onChange={(event) => {
                const next = event.target.value as AiProviderKind;
                setProvider(next);
                setKey("");
                setModels(null);
                setModel(saved.provider === next ? saved.model : providerOf(next).defaultModel);
              }}
            >
              {AI_PROVIDERS.map((item) => (
                <option key={item.kind} value={item.kind}>{item.label}</option>
              ))}
            </select>
          </label>
          {spec.customUrl ? (
            <label className="field">
              <span>Address</span>
              <input data-dg="ai-base-url" list="ai-addresses" placeholder={spec.baseUrl} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
              <datalist id="ai-addresses">
                {OPENAI_COMPATIBLE.map((item) => (
                  <option key={item.baseUrl} value={item.baseUrl}>{item.label}</option>
                ))}
              </datalist>
            </label>
          ) : null}
          <label className="field">
            <span>API key{needsKey ? "" : " (not needed here)"}</span>
            <input
              data-dg="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={keyOnFile ? `Saved, ending ${saved.keyHint ?? "…"}. Paste a new one to replace it.` : needsKey ? "Paste your key" : "Leave empty"}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onBlur={() => {
                if (key.trim()) void loadModels(key);
              }}
            />
          </label>
          <p className="ai-note">
            {spec.keyHelp}{needsKey || keyOnFile ? ` ${KEPT[saved.keptIn]}` : ""}
            {keyOnFile ? (
              <>
                {" "}
                <button type="button" className="inline" data-dg="ai-key-remove" onClick={() => void removeKey()}>Remove the saved key</button>
              </>
            ) : null}
          </p>
          <label className="field">
            <span>Model</span>
            {models && models.length > 0 ? (
              <select data-dg="ai-model" value={model} onChange={(event) => setModel(event.target.value)}>
                {models.map((item) => (
                  <option key={item.id} value={item.id}>{item.label ? `${item.label} (${item.id})` : item.id}</option>
                ))}
              </select>
            ) : (
              <input data-dg="ai-model" placeholder={loading ? "Reading the list…" : "A model id"} value={model} onChange={(event) => setModel(event.target.value)} spellCheck={false} />
            )}
          </label>
          {listProblem ? <p className="ai-note" data-dg="ai-list-problem">Couldn't read the list of models, so type a model id. {listProblem}</p> : null}
          {saved.inLab ? (
            <label className="field">
              <span>Send questions</span>
              <select data-dg="ai-route" value={route} onChange={(event) => setRoute(event.target.value as AiRoute)}>
                <option value="device">Straight from this device</option>
                <option value="lab">Through my lab's server</option>
              </select>
            </label>
          ) : null}
          <p className="ai-note" data-dg="ai-where">
            {route === "lab" && saved.inLab
              ? `Your question and the units on the canvas go to your lab's server, which calls ${spec.label} with your key for that one question and doesn't keep the key.`
              : local
                ? `Your question and the units on the canvas go to the model server on this computer (${hostOf(address)}). Nothing leaves the device.`
                : `Your question and the units on the canvas go straight from this device to ${hostOf(address)}. Nothing passes through Discourse Graphs.`}
          </p>
        </>
      ) : (
        <p className="ai-note">Questions and the units on the canvas go to your lab's server, which answers with the model the lab set up.</p>
      )}
      {problem ? <p className="ai-problem" role="alert" data-dg="ai-setup-problem">{problem}</p> : null}
      <div className="ai-actions">
        {onCancel ? <button type="button" data-dg="ai-setup-cancel" onClick={onCancel}>Cancel</button> : null}
        <button type="submit" className="primary" data-dg="ai-setup-save" disabled={busy}>{busy ? "Checking…" : source === "own" ? "Test and save" : "Save"}</button>
      </div>
    </form>
  );
};
