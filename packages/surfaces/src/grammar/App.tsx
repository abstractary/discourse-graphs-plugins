import { useCallback, useEffect, useState } from "react";
import { BASE_WORDS, STARTER_TEMPLATES } from "@dg/contract/grammar.ts";
import { BASE_NODE_TYPES, type BaseNodeType, type DgId, type NodeTypeRecord, type RelationRule, type RelationTypeRecord } from "@dg/contract/records.ts";
import type { Connection } from "../shared/rpc.ts";

/**
 * Types and relations: a lab's own words for its units and for what joins
 * them. A type sits on one of nine kinds of unit, which is what other tools
 * understand; its name, abbreviation and template are the lab's. A relation
 * says which types it may join. The whole set travels as one schema file.
 */

type Grammar = { nodeTypes: NodeTypeRecord[]; relationTypes: RelationTypeRecord[]; uses: Record<DgId, number>; tables: boolean };
type TypeDraft = { id?: DgId; label: string; base: BaseNodeType; abbreviation: string; titleFormat: string; template: string };
type RelationDraft = { id?: DgId; label: string; complement: string; rules: RelationRule[] };
type Picked = { kind: "type"; draft: TypeDraft } | { kind: "relation"; draft: RelationDraft } | null;

const draftOfType = (type?: NodeTypeRecord): TypeDraft => ({
  ...(type ? { id: type.id } : {}),
  label: type?.label ?? "",
  base: type?.base ?? "claim",
  abbreviation: type?.abbreviation ?? "",
  titleFormat: type?.titleFormat ?? "",
  template: type?.template ?? "",
});
const draftOfRelation = (type?: RelationTypeRecord): RelationDraft => ({ ...(type ? { id: type.id } : {}), label: type?.label ?? "", complement: type?.complement ?? "", rules: type?.rules ?? [] });

export const App = ({ connection }: { connection: Connection }) => {
  const { call } = connection;
  const [grammar, setGrammar] = useState<Grammar | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  const [files, setFiles] = useState<{ ref: string; name: string; folder?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<Grammar> => {
    const got = await call("grammar.get", {});
    const next = { nodeTypes: got.nodeTypes, relationTypes: got.relationTypes, uses: got.uses ?? {}, tables: Boolean(got.tables) };
    setGrammar(next);
    return next;
  }, [call]);
  useEffect(() => void load(), [load]);

  const act = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true);
    setProblem("");
    setSaid("");
    try {
      const message = await work();
      if (message) setSaid(message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
    setBusy(false);
  };

  const saveType = (draft: TypeDraft) =>
    act(async () => {
      const saved = await call("grammar.saveNodeType", {
        ...(draft.id ? { id: draft.id } : {}),
        label: draft.label,
        base: draft.base,
        ...(draft.abbreviation.trim() ? { abbreviation: draft.abbreviation } : {}),
        ...(draft.titleFormat.trim() ? { titleFormat: draft.titleFormat } : {}),
        ...(draft.template.trim() ? { template: draft.template } : {}),
      });
      await load();
      setPicked({ kind: "type", draft: draftOfType(saved) });
      return `Saved ${saved.label}`;
    });
  const saveRelation = (draft: RelationDraft) =>
    act(async () => {
      const held = grammar?.relationTypes.find((type) => type.id === draft.id);
      const saved = await call("grammar.saveRelationType", { ...(draft.id ? { id: draft.id } : {}), label: draft.label, complement: draft.complement, ...(held?.base ? { base: held.base } : {}), rules: draft.rules, ...(held?.color ? { color: held.color } : {}) });
      await load();
      setPicked({ kind: "relation", draft: draftOfRelation(saved) });
      return `Saved ${saved.label}`;
    });
  const remove = (kind: "type" | "relation", id: DgId, label: string) =>
    act(async () => {
      await call(kind === "type" ? "grammar.removeNodeType" : "grammar.removeRelationType", { id });
      await load();
      setPicked(null);
      return `Removed ${label}`;
    });

  if (!grammar) return <main className="grammar" aria-busy="true" />;
  const labelOf = (id: DgId): string => grammar.nodeTypes.find((type) => type.id === id)?.label ?? "A type no longer in use";
  const uses = (id: DgId | undefined): number => (id ? (grammar.uses[id] ?? 0) : 0);

  return (
    <main className="grammar" data-dg="grammar">
      <header>
        <h1>Types and relations</h1>
        <p className="grammar-quiet">Your lab's own words for its units and for what joins them. Every type sits on one of nine kinds of unit, which is what other tools read.</p>
      </header>
      <div className="grammar-body">
        <nav className="grammar-list" aria-label="Types and relations">
          <h2>Types</h2>
          <ul data-dg="grammar-types">
            {grammar.nodeTypes.map((type) => (
              <li key={type.id}>
                <button type="button" data-dg={`grammar-type-${type.label}`} aria-current={picked?.kind === "type" && picked.draft.id === type.id} onClick={() => (setProblem(""), setSaid(""), setPicked({ kind: "type", draft: draftOfType(type) }))}>
                  <span className="grammar-short">{type.abbreviation ?? ""}</span>
                  <span className="grammar-name">{type.label}</span>
                  <span className="grammar-count">{uses(type.id) || ""}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="grammar-add" data-dg="grammar-add-type" onClick={() => (setProblem(""), setSaid(""), setPicked({ kind: "type", draft: draftOfType() }))}>Add a type</button>
          <h2>Relations</h2>
          <ul data-dg="grammar-relations">
            {grammar.relationTypes.map((type) => (
              <li key={type.id}>
                <button type="button" data-dg={`grammar-relation-${type.label}`} aria-current={picked?.kind === "relation" && picked.draft.id === type.id} onClick={() => (setProblem(""), setSaid(""), setPicked({ kind: "relation", draft: draftOfRelation(type) }))}>
                  <span className="grammar-name">{type.label}</span>
                  <span className="grammar-count">{uses(type.id) || ""}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="grammar-add" data-dg="grammar-add-relation" onClick={() => (setProblem(""), setSaid(""), setPicked({ kind: "relation", draft: draftOfRelation() }))}>Add a relation</button>
        </nav>

        <section className="grammar-edit" aria-live="polite">
          {picked?.kind === "type" ? (
            <TypeForm
              key={picked.draft.id ?? "new"}
              draft={picked.draft}
              used={uses(picked.draft.id)}
              tables={grammar.tables}
              busy={busy}
              onSave={saveType}
              onRemove={(draft) => void remove("type", draft.id!, draft.label)}
              onTable={(id) => void act(async () => `Opened ${(await call("table.open", { type: id })).where}`)}
            />
          ) : picked?.kind === "relation" ? (
            <RelationForm key={picked.draft.id ?? "new"} draft={picked.draft} types={grammar.nodeTypes} labelOf={labelOf} used={uses(picked.draft.id)} busy={busy} onSave={saveRelation} onRemove={(draft) => void remove("relation", draft.id!, draft.label)} />
          ) : (
            <p className="grammar-quiet">Choose a type or a relation to change it, or add one.</p>
          )}
          {problem ? <p className="problem" role="alert" data-dg="grammar-problem">{problem}</p> : null}
          {said ? <p className="grammar-said" role="status" data-dg="grammar-said">{said}</p> : null}
        </section>
      </div>

      <footer className="grammar-foot">
        <button type="button" data-dg="grammar-export" disabled={busy} onClick={() => void act(async () => {
          const made = await call("grammar.export", {});
          return `Saved ${made.name} to ${made.where}: ${made.nodeTypes} types and ${made.relationTypes} relations`;
        })}>Save as a schema file</button>
        <button type="button" data-dg="grammar-import" disabled={busy} onClick={() => void call("grammar.files", {}).then(setFiles)}>Read a schema file…</button>
        {files ? (
          files.length === 0 ? (
            <span className="grammar-quiet">No schema file found. Put its .json file in this base first.</span>
          ) : (
            <select
              aria-label="Which schema file to read"
              data-dg="grammar-import-file"
              value=""
              onChange={(event) => {
                const ref = event.target.value;
                if (!ref) return;
                setFiles(null);
                void act(async () => {
                  const read = await call("grammar.import", { ref });
                  await load();
                  const added = [read.nodeTypes ? `${read.nodeTypes} ${read.nodeTypes === 1 ? "type" : "types"}` : "", read.relationTypes ? `${read.relationTypes} ${read.relationTypes === 1 ? "relation" : "relations"}` : "", read.rules ? `${read.rules} allowed ${read.rules === 1 ? "pair" : "pairs"}` : ""].filter(Boolean);
                  return `${added.length ? `Added ${added.join(", ")}` : "Nothing new in that file"}${read.kept ? `. ${read.kept} already here, left as they were` : ""}${read.from === "official-plugin" ? ". Read from the official plugin's export" : ""}`;
                });
              }}
            >
              <option value="">Choose a file</option>
              {files.map((file) => <option key={file.ref} value={file.ref}>{file.folder ? `${file.folder}/` : ""}{file.name}</option>)}
            </select>
          )
        ) : null}
        <span className="grammar-spacer" />
        <button type="button" onClick={() => void call("dialog.close", {})}>Done</button>
      </footer>
    </main>
  );
};

// A panel is a sandboxed frame, where a form can't be submitted. So each form saves from its button's click.
const TypeForm = ({ draft: start, used, tables, busy, onSave, onRemove, onTable }: { draft: TypeDraft; used: number; tables: boolean; busy: boolean; onSave: (draft: TypeDraft) => void; onRemove: (draft: TypeDraft) => void; onTable: (id: DgId) => void }) => {
  const [draft, setDraft] = useState(start);
  const [asking, setAsking] = useState(false);
  const set = (changes: Partial<TypeDraft>): void => setDraft((old) => ({ ...old, ...changes }));
  const starter = STARTER_TEMPLATES[draft.base];
  const pattern = draft.titleFormat.trim() || (draft.abbreviation.trim() ? `${draft.abbreviation.trim().toUpperCase()} - {content}` : "{content}");
  return (
    <form className="grammar-form" data-dg="grammar-type-form" onSubmit={(event) => event.preventDefault()}>
      <label className="field"><span>Name</span><input data-dg="grammar-type-name" value={draft.label} placeholder="Such as Hypothesis or Experiment" onChange={(event) => set({ label: event.target.value })} autoFocus={!draft.id} /></label>
      <label className="field">
        <span>Kind of unit</span>
        <select data-dg="grammar-type-base" value={draft.base} onChange={(event) => set({ base: event.target.value as BaseNodeType })}>
          {BASE_NODE_TYPES.map((base) => <option key={base} value={base}>{BASE_WORDS[base].name}</option>)}
        </select>
      </label>
      <p className="grammar-quiet grammar-under">{BASE_WORDS[draft.base].says}{draft.id && used > 0 ? ` Changing this changes what ${used} ${used === 1 ? "unit is" : "units are"} to other tools.` : ""}</p>
      <label className="field"><span>Abbreviation</span><input data-dg="grammar-type-short" value={draft.abbreviation} maxLength={6} placeholder="Such as HYP" onChange={(event) => set({ abbreviation: event.target.value })} /></label>
      <label className="field"><span>Note title</span><input data-dg="grammar-type-format" value={draft.titleFormat} placeholder={pattern} onChange={(event) => set({ titleFormat: event.target.value })} /></label>
      <p className="grammar-quiet grammar-under">A new note is named <code>{pattern.split("{content}").join("its title")}</code>. Keep <code>{"{content}"}</code> where the title goes.</p>
      <label className="field field-tall">
        <span>Template</span>
        <textarea data-dg="grammar-type-template" value={draft.template} rows={9} placeholder="What a new note of this type starts with. Leave empty for a blank note." onChange={(event) => set({ template: event.target.value })} />
      </label>
      <p className="grammar-quiet grammar-under">
        <code>{"{title}"}</code>, <code>{"{date}"}</code>, <code>{"{author}"}</code> and <code>{"{type}"}</code> are filled in.{" "}
        {starter && draft.template.trim() !== starter.trim() ? <button type="button" className="ctx-link" data-dg="grammar-type-starter" onClick={() => set({ template: starter })}>{draft.template.trim() ? "Replace with the starter" : "Start from the usual headings"}</button> : null}
      </p>
      <div className="row end">
        {draft.id && tables ? <button type="button" data-dg="grammar-type-table" disabled={busy} onClick={() => onTable(draft.id!)}>Open its table</button> : null}
        {draft.id ? (
          asking ? (
            <>
              <span className="grammar-quiet">Remove {start.label}?</span>
              <button type="button" onClick={() => setAsking(false)}>Keep it</button>
              <button type="button" data-dg="grammar-type-remove-yes" disabled={busy} onClick={() => onRemove(draft)}>Remove</button>
            </>
          ) : (
            <button type="button" data-dg="grammar-type-remove" disabled={busy} onClick={() => setAsking(true)}>Remove…</button>
          )
        ) : null}
        <button type="button" className="primary" data-dg="grammar-type-save" disabled={busy || !draft.label.trim()} onClick={() => onSave(draft)}>{draft.id ? "Save" : "Add type"}</button>
      </div>
    </form>
  );
};

const RelationForm = ({ draft: start, types, labelOf, used, busy, onSave, onRemove }: { draft: RelationDraft; types: NodeTypeRecord[]; labelOf: (id: DgId) => string; used: number; busy: boolean; onSave: (draft: RelationDraft) => void; onRemove: (draft: RelationDraft) => void }) => {
  const [draft, setDraft] = useState(start);
  const [from, setFrom] = useState(types[0]?.id ?? "");
  const [to, setTo] = useState(types[0]?.id ?? "");
  const [asking, setAsking] = useState(false);
  const has = draft.rules.some((rule) => rule.source === from && rule.target === to);
  return (
    <form className="grammar-form" data-dg="grammar-relation-form" onSubmit={(event) => event.preventDefault()}>
      <label className="field"><span>Wording</span><input data-dg="grammar-relation-label" value={draft.label} placeholder="Such as Replicates" onChange={(event) => setDraft({ ...draft, label: event.target.value })} autoFocus={!draft.id} /></label>
      <label className="field"><span>Read back</span><input data-dg="grammar-relation-complement" value={draft.complement} placeholder="Such as Replicated by" onChange={(event) => setDraft({ ...draft, complement: event.target.value })} /></label>
      <p className="grammar-quiet grammar-under">A link reads one way from each end: "A {draft.label.trim() || "…"} B", and "B {draft.complement.trim() || "…"} A".</p>
      <h3>What it may join</h3>
      {draft.rules.length === 0 ? <p className="grammar-quiet">No pairs yet, so it is never offered. Add one below.</p> : null}
      <ul className="grammar-rules" data-dg="grammar-rules">
        {draft.rules.map((rule) => (
          <li key={`${rule.source}>${rule.target}`}>
            <span>{labelOf(rule.source)} <em>{draft.label.trim().toLowerCase() || "…"}</em> {labelOf(rule.target)}</span>
            <button type="button" aria-label={`Stop ${labelOf(rule.source)} to ${labelOf(rule.target)}`} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((other) => other !== rule) })}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="grammar-pair">
        <select aria-label="From" data-dg="grammar-rule-from" value={from} onChange={(event) => setFrom(event.target.value)}>{types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
        <span className="grammar-quiet">to</span>
        <select aria-label="To" data-dg="grammar-rule-to" value={to} onChange={(event) => setTo(event.target.value)}>{types.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
        <button type="button" data-dg="grammar-rule-add" disabled={!from || !to || has} onClick={() => setDraft({ ...draft, rules: [...draft.rules, { source: from, target: to }] })}>Allow</button>
      </div>
      <div className="row end">
        {draft.id ? (
          asking ? (
            <>
              <span className="grammar-quiet">Remove {start.label}?</span>
              <button type="button" onClick={() => setAsking(false)}>Keep it</button>
              <button type="button" data-dg="grammar-relation-remove-yes" disabled={busy} onClick={() => onRemove(draft)}>Remove</button>
            </>
          ) : (
            <button type="button" data-dg="grammar-relation-remove" disabled={busy} onClick={() => setAsking(true)}>Remove…</button>
          )
        ) : null}
        {used > 0 ? <span className="grammar-quiet">{used} {used === 1 ? "link uses" : "links use"} it</span> : null}
        <button type="button" className="primary" data-dg="grammar-relation-save" disabled={busy || !draft.label.trim() || !draft.complement.trim()} onClick={() => onSave(draft)}>{draft.id ? "Save" : "Add relation"}</button>
      </div>
    </form>
  );
};
