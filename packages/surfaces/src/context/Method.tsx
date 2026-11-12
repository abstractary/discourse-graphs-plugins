import { useCallback, useEffect, useState } from "react";
import type { MethodChain, MethodStep, MethodView, NodeSummary } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Icon, plain } from "../shared/ui.tsx";

const ROLE: Record<MethodStep["role"], string> = {
  question: "Question",
  study: "Experiment",
  protocol: "Protocol",
  code: "Code",
  run: "Run",
  output: "Output",
  source: "Source",
  evidence: "Evidence",
  claim: "Claim",
};

const DRIFT = { changed: "edited since the run", missing: "not in this graph" };

const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);

/** What the checks say about a claim's support, in a few words each. */
const flagsOf = (flags: NonNullable<MethodView["flags"]>): { text: string; tone: "good" | "warn" | "plain"; title: string }[] => [
  ...(flags.replicated ? [{ text: "replicated", tone: "good" as const, title: "Two or more runs of the same protocol each support it." }] : []),
  ...(flags.singleRun ? [{ text: "single run", tone: "warn" as const, title: "All of its support comes from one run." }] : []),
  ...(flags.singleMethod ? [{ text: "one method", tone: "plain" as const, title: "All of its support follows one protocol." }] : []),
  ...(flags.drift ? [{ text: "method changed", tone: "warn" as const, title: "A protocol or code version was edited after the run that made the evidence." }] : []),
  ...(flags.staleOutput ? [{ text: "output changed", tone: "warn" as const, title: "An output no longer matches the bytes the evidence cited, or is gone." }] : []),
  ...(flags.failedRuns ? [{ text: `${flags.failedRuns} failed ${flags.failedRuns === 1 ? "run" : "runs"}`, tone: "warn" as const, title: "A run behind this evidence ended in an error." }] : []),
  ...(flags.ungrounded ? [{ text: `${flags.ungrounded} ungrounded`, tone: "warn" as const, title: "Evidence with no output, run or source behind it." }] : []),
];

const Chain = ({ chain, here, onWalk, onRun }: { chain: MethodChain; here: string; onWalk: (id: string) => void; onRun: (id: string) => void }) => {
  const [all, setAll] = useState(false);
  const steps = chain.steps.filter((step) => !(chain.stance && step.role === "evidence"));
  // A run a paper reports can name many methods. They fold into one line, so the rest of the panel stays in reach.
  const methods = steps.filter((step) => step.role === "protocol");
  const folded = methods.length > 2 && !all && !methods.some((step) => step.id === here || step.drift);
  const shown = folded ? steps.filter((step) => step.role !== "protocol" || step === methods[0]) : steps;
  return (
    <li className="method-chain" data-dg="method-chain">
      {chain.stance ? (
        <p className="method-for" data-stance={chain.stance}>
          {chain.stance === "supports" ? "Supported by" : "Opposed by"} <button type="button" onClick={() => onWalk(chain.evidence.id)}>{plain(chain.evidence.title)}</button>
        </p>
      ) : null}
      {chain.ungrounded ? <p className="method-gap">Nothing stands behind this evidence yet: no output, run or source.</p> : null}
      <ol className="method-steps">
        {shown.map((step) =>
          folded && step === methods[0] ? (
            <li key="methods" data-role="protocol">
              <span className="method-role">Methods</span>
              <span className="method-what">
                <button type="button" data-dg="method-protocols" aria-expanded={false} onClick={() => setAll(true)} title="Show each one">
                  {methods.length} methods the run followed
                </button>
              </span>
            </li>
          ) : (
            <li key={`${step.role}-${step.id}`} data-role={step.role} data-here={step.id === here} data-drift={step.drift ?? ""}>
              <span className="method-role">{ROLE[step.role]}</span>
              <span className="method-what">
                {step.unit ? (
                  <button type="button" data-dg={`method-${step.role}`} onClick={() => (step.role === "run" ? onRun(step.id) : onWalk(step.id))} title={step.role === "run" ? "Open the run's page" : "Show in this panel"}>
                    {plain(step.unit.title)}
                  </button>
                ) : (
                  <span className="method-absent">{step.id}</span>
                )}
                {step.detail ? <span className="method-detail">{step.detail}</span> : null}
                {step.drift ? <span className="method-drift" data-dg="method-drift">{DRIFT[step.drift]}</span> : null}
              </span>
            </li>
          ),
        )}
      </ol>
    </li>
  );
};

type Picked = { id: string; title: string };

/** The fields a person fills in by hand, each kind of unit its own. Lists are typed one to a line. */
const Fields = ({ connection, unit, onSaved }: { connection: Connection; unit: NodeSummary; onSaved: () => void }) => {
  const { call } = connection;
  const [page, setPage] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, Picked[]>>({});
  const [problem, setProblem] = useState("");
  const base = unit.base as "protocol" | "study" | "run";

  const unitsOf = useCallback(
    async (wanted: string): Promise<Picked[]> => {
      const grammar = await call("grammar.get", {});
      const type = grammar.nodeTypes.find((item) => item.base === wanted);
      if (!type) return [];
      const found = await call("search.query", { types: [type.id], limit: 200 });
      return found.hits.map((hit) => ({ id: hit.node.id, title: plain(hit.node.title) }));
    },
    [call],
  );

  useEffect(() => {
    void (async () => {
      if (base === "study") setChoices({ question: await unitsOf("question") });
      if (base === "run") {
        const [studies, protocols] = await Promise.all([unitsOf("study"), unitsOf("protocol")]);
        setChoices({ partOf: studies, follows: protocols });
        const run = await call("process.run", { id: unit.id, previews: false });
        setPage({ condition: run.condition ?? "", deviations: run.deviations.join("\n"), partOf: run.study?.unit.id ?? "", follows: run.protocol?.id ?? "", conditions: (run.study?.conditions ?? []).join("\n") });
      }
    })();
  }, [base, call, unit.id, unitsOf]);

  const set = (key: string) => (event: { target: { value: string } }) => setPage((old) => ({ ...old, [key]: event.target.value }));
  const has = (key: string): boolean => page[key] !== undefined;

  const save = async (): Promise<void> => {
    setProblem("");
    try {
      if (base === "protocol") {
        await call("process.setFacts", { id: unit.id, facts: { ...(has("steps") ? { steps: lines(page.steps!) } : {}), ...(has("materials") ? { materials: lines(page.materials!) } : {}), ...(has("version") ? { version: page.version!.trim() } : {}) } });
      } else if (base === "study") {
        const size = page.sampleSize?.trim();
        await call("process.setFacts", {
          id: unit.id,
          facts: {
            ...(has("hypothesis") ? { hypothesis: page.hypothesis!.trim() } : {}),
            ...(has("design") ? { design: (page.design || undefined) as never } : {}),
            ...(has("conditions") ? { conditions: lines(page.conditions!) } : {}),
            ...(size !== undefined ? { sampleSize: (size ? Number(size) : undefined) as never } : {}),
          },
          ...(has("question") ? { links: { question: page.question || null } } : {}),
        });
      } else {
        await call("process.setFacts", {
          id: unit.id,
          facts: { condition: page.condition?.trim() ?? "", deviations: lines(page.deviations ?? "") },
          links: { partOf: page.partOf || null, follows: page.follows || null },
        });
      }
      onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  const pick = (key: string, label: string, none: string) => (
    <label className="method-field">
      <span>{label}</span>
      <select data-dg={`method-${key}`} value={page[key] ?? ""} onChange={set(key)}>
        <option value="">{none}</option>
        {(choices[key] ?? []).map((item) => (
          <option key={item.id} value={item.id}>{item.title}</option>
        ))}
      </select>
    </label>
  );
  const area = (key: string, label: string, hint: string) => (
    <label className="method-field">
      <span>{label}</span>
      <textarea data-dg={`method-${key}`} rows={3} placeholder={hint} value={page[key] ?? ""} onChange={set(key)} />
    </label>
  );
  const text = (key: string, label: string, hint: string) => (
    <label className="method-field">
      <span>{label}</span>
      <input data-dg={`method-${key}`} placeholder={hint} value={page[key] ?? ""} onChange={set(key)} />
    </label>
  );

  return (
    <form
      className="method-form"
      data-dg="method-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {base === "protocol" ? (
        <>
          {area("steps", "Steps", "One short step to a line, in order")}
          {area("materials", "Materials", "One to a line. Use an RRID where there is one, such as RRID:AB_2314866")}
          {text("version", "Version", "As your lab writes it, such as 2 or 2026-11")}
        </>
      ) : null}
      {base === "study" ? (
        <>
          {pick("question", "Question", "No question yet")}
          {text("hypothesis", "Hypothesis", "What the design expects to see, in a sentence")}
          <label className="method-field">
            <span>Design</span>
            <select data-dg="method-design" value={page.design ?? ""} onChange={set("design")}>
              <option value="">Not said</option>
              {["experimental", "observational", "computational", "replication", "review"].map((design) => (
                <option key={design} value={design}>{design[0]!.toUpperCase() + design.slice(1)}</option>
              ))}
            </select>
          </label>
          {area("conditions", "Conditions", "The arms it compares, one to a line")}
          {text("sampleSize", "Planned sample size", "A whole number")}
        </>
      ) : null}
      {base === "run" ? (
        <>
          {pick("partOf", "Experiment", "Not part of an experiment")}
          {pick("follows", "Protocol followed", "No protocol")}
          {lines(page.conditions ?? "").length ? (
            <label className="method-field">
              <span>Condition</span>
              <select data-dg="method-condition" value={page.condition ?? ""} onChange={set("condition")}>
                <option value="">Not said</option>
                {lines(page.conditions!).map((condition) => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>
            </label>
          ) : (
            text("condition", "Condition", "Which arm of the experiment this run carried out")
          )}
          {area("deviations", "Deviations", "Where this run departed from the protocol, one to a line")}
        </>
      ) : null}
      {problem ? <p className="method-gap" role="alert">{problem}</p> : null}
      <div className="method-actions">
        <button type="submit" className="primary" data-dg="method-save">Save</button>
      </div>
    </form>
  );
};

const many = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;

/** What a claim stands on once its support runs through other claims: how much, and from how many papers. */
const Rests = ({ rests }: { rests: NonNullable<MethodView["rests"]> }) => (
  <div className="method-rests" data-dg="method-rests">
    <p>
      Rests on {many(rests.claims, "claim", "claims")}
      {rests.evidence ? `, which ${rests.claims === 1 ? "rests" : "rest"} on ${many(rests.evidence, "piece of evidence", "pieces of evidence")}${rests.runs ? ` from ${many(rests.runs, "run", "runs")}` : ""}` : ", with no evidence beneath them yet"}
      {rests.opposing ? `. ${many(rests.opposing, "unit opposes", "units oppose")} it` : ""}.
    </p>
    {rests.papers.length ? (
      <p className="method-papers">
        {rests.papers.map((paper) => (
          <span key={paper.id} className="from-paper" title={`${many(paper.units, "unit", "units")} read from ${paper.title}`}>{paper.label} · {paper.units}</span>
        ))}
        {rests.own ? <span className="from-paper" title="Units written here, not read from a paper">Written here · {rests.own}</span> : null}
      </p>
    ) : null}
    {rests.papers.length === 1 && !rests.own ? <p className="method-gap">All of it comes from one paper.</p> : null}
  </div>
);

/**
 * How a unit was produced. For evidence, the chain behind it in the order the
 * work happened: question, experiment, protocol, code, run, output. For a
 * claim, that chain for each piece of evidence, and what the replication and
 * drift checks make of them. Gaps come from the same rules as the SHACL shapes.
 */
export const Method = ({ connection, node, onWalk }: { connection: Connection; node: NodeSummary; onWalk: (id: string) => void }) => {
  const { call, on } = connection;
  const [view, setView] = useState<MethodView | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(() => {
    void call("process.method", { id: node.id })
      .then(setView)
      .catch(() => setView(null));
  }, [call, node.id]);
  useEffect(() => {
    setView(null);
    setEditing(false);
    setNotice("");
    load();
  }, [load]);
  useEffect(() => on("graph-changed", load), [on, load]);

  if (!view || view.unit.id !== node.id) return null;
  const process = ["protocol", "study", "run", "code", "output"].includes(node.base ?? "");
  const editable = Boolean(node.mine) && ["protocol", "study", "run"].includes(node.base ?? "");
  if (!process && view.chains.length === 0 && view.problems.length === 0 && !view.rests) return null;
  const openRun = (id: string) => void call("run.show", { id }).catch((error: Error) => setNotice(error.message));
  const flags = view.flags ? flagsOf(view.flags) : [];
  const steps = view.chains.length;

  return (
    <section className="ctx-group method" data-dg="method">
      <h2>
        Method {steps > 1 ? <span>{steps}</span> : null}
      </h2>
      {flags.length ? (
        <p className="method-flags" data-dg="method-flags">
          {flags.map((flag) => (
            <span key={flag.text} data-tone={flag.tone} title={flag.title}>{flag.text}</span>
          ))}
        </p>
      ) : null}
      {view.rests ? <Rests rests={view.rests} /> : null}
      {view.chains.length ? (
        <ul className="method-chains">
          {view.chains.map((chain) => (
            <Chain key={`${chain.stance ?? ""}-${chain.evidence.id}`} chain={chain} here={node.id} onWalk={onWalk} onRun={openRun} />
          ))}
        </ul>
      ) : process ? (
        <p className="method-none">No evidence rests on this yet.</p>
      ) : null}
      {view.problems.length ? (
        <ul className="method-problems" data-dg="method-problems">
          {view.problems.map((problem) => (
            <li key={problem.rule} data-severity={problem.severity} title={`Rule: ${problem.rule}`}>{problem.message}</li>
          ))}
        </ul>
      ) : null}
      <div className="method-actions">
        {node.base === "run" ? (
          <button type="button" data-dg="method-open-run" onClick={() => openRun(node.id)}><Icon name="open" /> Open run page</button>
        ) : view.run ? (
          <button type="button" data-dg="method-open-run" onClick={() => openRun(view.run!)}><Icon name="open" /> Open the run</button>
        ) : null}
        {node.base === "output" ? (
          <button
            type="button"
            data-dg="method-evidence"
            title="Makes evidence that rests on this output, pinned to its bytes, and offers it to the open canvas"
            onClick={() => void call("evidence.fromOutput", { output: node.id }).then((made) => onWalk(made.id)).catch((error: Error) => setNotice(error.message))}
          >
            <Icon name="plus" /> Make evidence from this
          </button>
        ) : null}
        {editable ? (
          <button type="button" data-dg="method-edit" aria-expanded={editing} onClick={() => setEditing((open) => !open)}><Icon name="pen" /> {editing ? "Close fields" : "Edit fields"}</button>
        ) : null}
      </div>
      {notice ? <p className="method-gap" role="alert">{notice}</p> : null}
      {editing ? <Fields connection={connection} unit={node} onSaved={() => { setEditing(false); load(); }} /> : null}
    </section>
  );
};
