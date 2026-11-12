import { createNode, revise, type DgId, type DgRecord, type NodeRecord, type Pin, type RelationTypeRecord, type UnitFacts } from "@dg/contract/records.ts";
import type { MethodChain, MethodProblem, MethodStep, MethodView, NotebookFile, NotebookImported, RunCell, RunOutput, RunPage } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { iriOf, toProcessJsonLd } from "./jsonld.ts";
import {
  baseOf,
  cidOfBytes,
  paperSource,
  protocolsFollowed,
  claimSupport,
  ensureProcessTypes,
  evidenceChain,
  notebookSourceCid,
  planNotebookImport,
  protocolCids,
  provenanceOf,
  unitCid,
  type EvidenceChain,
  type Notebook,
  type Pinned,
} from "./process.ts";
import { shapeProblems, type ShapeProblem } from "./shapes.ts";

/**
 * How a result was made, for the panels: the chain behind a unit, one run as
 * a page, and reading a saved Jupyter notebook into Code, a Run and Outputs.
 * Everything here is read from the graph except the notebook file itself,
 * which is read from the base only to show cells and to check that an output's
 * bytes are still the ones recorded.
 */

type Value<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
const value = <T>(result: Value<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const textOf = (dataUrl: string): string => new TextDecoder().decode(fromBase64(dataUrl.split(",")[1] ?? ""));
const joined = (text: string | string[] | undefined): string => (Array.isArray(text) ? text.join("") : (text ?? ""));
const short = (cid: string | undefined): string | undefined => (cid ? `${cid.slice(0, 6)}…${cid.slice(-6)}` : undefined);
const day = (stamp: string | undefined): string | undefined => stamp?.slice(0, 10);
const shown = (item: unknown): string => (typeof item === "string" ? item : JSON.stringify(item));

export const methodFeature = (
  context: Context,
  restsOn?: (claim: DgId) => Promise<MethodView["rests"]>,
): Pick<Handlers, "process.method" | "process.run" | "run.show" | "run.list" | "process.setFacts" | "notebook.list" | "notebook.import" | "evidence.fromOutput"> => {
  const summary = (id: DgId | undefined) => {
    const node = id ? context.nodeOf(id) : undefined;
    return node && !node.removed ? context.summarize(node) : undefined;
  };
  const base = (node: NodeRecord | undefined) => baseOf(context.graph(), node);

  /** The shapes' verdict on the whole graph, by unit. Pins report under `_:`, and the unit-level drift rules cover them. */
  const problemsBy = async (): Promise<(id: DgId) => MethodProblem[]> => {
    const graph = context.graph();
    const all = shapeProblems(toProcessJsonLd(graph, {}, await protocolCids(graph)));
    const byFocus = new Map<string, ShapeProblem[]>();
    for (const problem of all) byFocus.set(problem.focus, [...(byFocus.get(problem.focus) ?? []), problem]);
    const rank = { Violation: 0, Warning: 1, Info: 2 };
    // A run a paper reports was never this lab's to file under a study, so that gap isn't one.
    const literature = new Set(["run-no-study"]);
    return (id) =>
      (byFocus.get(iriOf(graph, id)) ?? [])
        .filter((problem) => !(literature.has(problem.rule) && context.nodeOf(id)?.source?.paper))
        .sort((a, b) => rank[a.severity] - rank[b.severity])
        .map(({ rule, severity, message }) => ({ rule, severity, message }));
  };

  const driftOf = (pinned: Pinned | undefined): "changed" | "missing" | undefined => (pinned?.missing ? "missing" : pinned?.changed ? "changed" : undefined);

  const step = (role: MethodStep["role"], id: DgId, extra: { detail?: string | undefined; drift?: "changed" | "missing" | undefined } = {}): MethodStep => {
    const unit = summary(id);
    return { role, id, ...(unit ? { unit } : {}), ...(extra.detail ? { detail: extra.detail } : {}), ...(extra.drift ? { drift: extra.drift } : {}) };
  };

  /** Question, study, protocol, code, run, outputs, source, evidence: the order the work happened in. */
  const chainOf = (chain: EvidenceChain, stance?: "supports" | "opposes"): MethodChain | null => {
    const evidence = summary(chain.evidence);
    if (!evidence) return null;
    const run = chain.run ? context.nodeOf(chain.run) : undefined;
    const study = chain.study ? context.nodeOf(chain.study) : undefined;
    const steps: MethodStep[] = [];
    if (chain.question) steps.push(step("question", chain.question));
    if (study) steps.push(step("study", study.id, { detail: [study.facts?.design, study.facts?.conditions?.length ? `${study.facts.conditions.length} ${study.facts.conditions.length === 1 ? "condition" : "conditions"}` : ""].filter(Boolean).join(", ") }));
    for (const followed of chain.protocols) {
      const protocol = context.nodeOf(followed.id);
      steps.push(step("protocol", followed.id, { detail: protocol?.facts?.version ? `version ${protocol.facts.version}` : undefined, drift: driftOf(followed) }));
    }
    for (const code of chain.code) {
      const record = context.nodeOf(code.id);
      steps.push(step("code", code.id, { detail: [record?.facts?.path, record?.facts?.commit?.slice(0, 7)].filter(Boolean).join(" at "), drift: driftOf(code) }));
    }
    if (run) {
      steps.push(
        step("run", run.id, {
          // A run read from a paper has no date of its own: the day it was imported isn't when it happened.
          detail: [run.facts?.status, day(run.facts?.startedAt ?? (run.source?.paper ? undefined : run.at)), run.facts?.condition, run.facts?.deviations?.length ? `${run.facts.deviations.length} ${run.facts.deviations.length === 1 ? "deviation" : "deviations"}` : ""].filter(Boolean).join(", "),
        }),
      );
    }
    for (const output of chain.outputs) {
      const record = context.nodeOf(output.id);
      steps.push(step("output", output.id, { detail: [record?.facts?.outputKind, record?.facts?.locator?.label].filter(Boolean).join(", "), drift: driftOf(output) }));
    }
    if (chain.source) steps.push(step("source", chain.source));
    steps.push(step("evidence", chain.evidence));
    return { evidence, ...(stance ? { stance } : {}), steps, ungrounded: chain.ungrounded };
  };

  /** Evidence that rests on a run, directly or through one of its outputs. */
  const evidenceOn = (run: DgId): NodeRecord[] => {
    const graph = context.graph();
    return context.documents("node").filter((node) => {
      if (node.removed || base(node) !== "evidence") return false;
      const prov = provenanceOf(graph, node.id);
      if (prov.isGroundedIn === run) return true;
      return (prov.observationBase ?? []).some((pin) => context.nodeOf(pin.uri)?.prov?.generatedBy === run);
    });
  };

  const argued = (evidence: DgId): { claim: DgId; stance: "supports" | "opposes" }[] =>
    [...context.graph().relations.values()].flatMap(({ record, state }) => {
      if (state !== "active" || record.source !== evidence) return [];
      const stance = (context.graph().documents.get(record.type) as RelationTypeRecord | undefined)?.base;
      return stance === "supports" || stance === "opposes" ? [{ claim: record.target, stance }] : [];
    });

  const method = async (id: DgId): Promise<MethodView> => {
    const node = context.nodeOf(id);
    if (!node) throw new Error("That unit isn't in this graph.");
    const graph = context.graph();
    const cids = await protocolCids(graph);
    const kind = base(node);
    const problems = (await problemsBy())(id);
    const unit = context.summarize(node);
    const chains: MethodChain[] = [];
    let flags: MethodView["flags"];
    let run: DgId | undefined;

    if (kind === "claim") {
      const support = claimSupport(graph, id, cids);
      for (const chain of support.supporting) chains.push(...[chainOf(chain, "supports")].filter((item): item is MethodChain => Boolean(item)));
      for (const chain of support.opposing) chains.push(...[chainOf(chain, "opposes")].filter((item): item is MethodChain => Boolean(item)));
      const f = support.flags;
      flags = { ...f, failedRuns: f.failedRuns.length, ungrounded: f.ungrounded.length, runs: support.runs.length, protocols: support.protocols.length };
      if (support.runs.length === 1) run = support.runs[0];
    } else if (kind === "evidence") {
      const chain = evidenceChain(graph, id, cids);
      const made = chainOf(chain);
      if (made) chains.push(made);
      run = chain.run;
    } else {
      // A run, or anything a run points at: the evidence that rests on the runs involved.
      const runs = context.documents("node").filter((candidate) => {
        if (candidate.removed || base(candidate) !== "run") return false;
        if (candidate.id === id) return true;
        const prov = provenanceOf(graph, candidate.id);
        return prov.partOf === id || prov.follows?.uri === id || (prov.instrument ?? []).some((pin) => pin.uri === id) || (kind === "output" && node.prov?.generatedBy === candidate.id);
      });
      for (const candidate of runs) {
        for (const evidence of evidenceOn(candidate.id)) {
          const made = chainOf(evidenceChain(graph, evidence.id, cids));
          if (made && (kind !== "output" || made.steps.some((item) => item.id === id))) chains.push(made);
        }
      }
      if (runs.length === 1) run = runs[0]!.id;
    }
    const rests = kind === "claim" ? await restsOn?.(id) : undefined;
    return { unit, chains, ...(flags ? { flags } : {}), problems, ...(run ? { run } : {}), ...(rests ? { rests } : {}) };
  };

  /** The notebook behind a run's code, when the base has the file: at its recorded path, or a copy of the same name. */
  const notebookOf = async (code: NodeRecord | undefined): Promise<{ ref: string; notebook: Notebook } | null> => {
    const path = code?.facts?.path;
    if (!path) return null;
    const name = path.split("/").pop()!;
    const listed = await context.host.listFiles({ extensions: ["ipynb"], limit: 500 });
    const copies = listed.ok ? listed.value.filter((file) => file.name === name).map((file) => file.ref) : [];
    for (const ref of [...new Set([...(code.facts?.repo ? [] : [path]), ...copies])]) {
      const read = await context.host.readAsset({ ref });
      if (!read.ok || !/\.ipynb$/i.test(read.value.name)) continue;
      try {
        const notebook = JSON.parse(textOf(read.value.dataUrl)) as Notebook;
        if (Array.isArray(notebook.cells)) return { ref, notebook };
      } catch {
        // Not a notebook after all.
      }
    }
    return null;
  };

  /** The saved bytes of one cell output, as a data URL, with their CID. Images only: a page shows figures, not datasets. */
  const savedBytes = async (notebook: Notebook, cellIndex: number, outputIndex: number): Promise<{ cid: string; dataUrl: string } | null> => {
    const data = notebook.cells[cellIndex]?.outputs?.[outputIndex]?.data ?? {};
    for (const mime of ["image/png", "image/jpeg"]) {
      const raw = data[mime];
      if (raw === undefined) continue;
      const clean = joined(raw as string | string[]).replace(/\s+/g, "");
      return { cid: await cidOfBytes(fromBase64(clean)), dataUrl: `data:${mime};base64,${clean}` };
    }
    return null;
  };

  const runPage = async (id: DgId, previews: boolean): Promise<RunPage> => {
    const run = context.nodeOf(id);
    if (!run || base(run) !== "run") throw new Error("That isn't a run.");
    const graph = context.graph();
    const cids = await protocolCids(graph);
    const prov = provenanceOf(graph, id);
    const facts = run.facts ?? {};
    const study = prov.partOf ? context.nodeOf(prov.partOf) : undefined;
    const [, ...others] = protocolsFollowed(graph, id);
    const protocol = prov.follows ? context.nodeOf(prov.follows.uri) : undefined;
    const reporting = context.documents("node").find((node) => !node.removed && base(node) === "source" && (provenanceOf(graph, node.id).describesActivity ?? []).includes(id));
    const paperId = run.source?.paper ?? reporting?.source?.paper;
    const paperSourceUnit = reporting ?? (paperId ? context.nodeOf(paperSource(graph, paperId) ?? "") : undefined);
    const paperUnit = context.summarize(run).paper ?? (reporting ? context.summarize(reporting).paper : undefined);
    const paperCanvas = paperId ? context.documents("paper").find((paper) => paper.id === paperId)?.canvas : undefined;
    const pinnedTo = (pin: Pin, current: string | undefined, exists: boolean): "changed" | "missing" | undefined =>
      !exists ? "missing" : pin.cid && current && pin.cid !== current ? "changed" : undefined;

    const declared = protocol?.facts?.parameters ?? [];
    const values = facts.parameterValues ?? {};
    const parameters: RunPage["parameters"] = [
      ...declared.map((spec) => ({
        name: spec.name,
        ...(values[spec.name] !== undefined ? { value: shown(values[spec.name]) } : {}),
        ...(spec.unit ? { unit: spec.unit } : {}),
        ...(spec.default !== undefined ? { default: shown(spec.default) } : {}),
        declared: true,
      })),
      ...Object.entries(values)
        .filter(([name]) => !declared.some((spec) => spec.name === name))
        .map(([name, item]) => ({ name, value: shown(item), declared: false })),
    ];

    const codeUnits = (prov.instrument ?? []).map((pin) => ({ pin, record: context.nodeOf(pin.uri) }));
    const file = await notebookOf(codeUnits.find(({ record }) => /\.ipynb$/i.test(record?.facts?.path ?? "") || (record?.facts?.path && !record.facts.repo))?.record);
    const outputRecords = context.documents("node").filter((node) => !node.removed && base(node) === "output" && node.prov?.generatedBy === id);
    const resting = evidenceOn(id);

    const outputs: RunOutput[] = [];
    for (const record of outputRecords) {
      const locator = record.facts?.locator;
      const saved = previews && file && locator?.cellIndex !== undefined && locator.outputIndex !== undefined ? await savedBytes(file.notebook, locator.cellIndex, locator.outputIndex) : null;
      const same = saved ? saved.cid === record.facts?.cid : undefined;
      outputs.push({
        unit: context.summarize(record),
        ...(record.facts?.outputKind ? { kind: record.facts.outputKind } : {}),
        ...(record.facts?.mediaType ? { mediaType: record.facts.mediaType } : {}),
        ...(record.facts?.size !== undefined ? { size: record.facts.size } : {}),
        ...(record.facts?.cid ? { cid: record.facts.cid } : {}),
        ...(record.facts?.caption ? { caption: record.facts.caption } : {}),
        ...(locator?.cellIndex !== undefined ? { cell: locator.cellIndex + 1 } : {}),
        ...(locator?.label ? { label: locator.label } : {}),
        evidence: resting.flatMap((evidence) => {
          const pin = provenanceOf(graph, evidence.id).observationBase?.find((item) => item.uri === record.id);
          return pin ? [{ unit: context.summarize(evidence), pinned: Boolean(pin.cid), changed: Boolean(pin.cid && pin.cid !== record.facts?.cid) }] : [];
        }),
        // Only bytes that still hash to the recorded CID are shown as this output.
        ...(saved && same ? { preview: saved.dataUrl } : {}),
        ...(saved && same === false ? { stale: true } : {}),
      });
    }
    outputs.sort((a, b) => (a.cell ?? 1e9) - (b.cell ?? 1e9));

    let notebook: RunPage["notebook"];
    if (file) {
      const cells: RunCell[] = file.notebook.cells.flatMap((cell, index): RunCell[] => {
        if (cell.cell_type !== "code" && cell.cell_type !== "markdown") return [];
        const source = joined(cell.source);
        if (!source.trim()) return [];
        const label = /^#\|?\s*label:\s*(\S+)/m.exec(source)?.[1];
        return [{
          index: index + 1,
          ...(cell.id ? { id: cell.id } : {}),
          kind: cell.cell_type,
          source,
          ...(label ? { label } : {}),
          outputs: outputRecords.filter((record) => record.facts?.locator?.cellIndex === index).map((record) => record.id),
        }];
      });
      const pinned = codeUnits.find(({ record }) => record?.facts?.path?.split("/").pop() === file.ref.split("/").pop() || record?.facts?.path === file.ref)?.pin.cid;
      notebook = { ref: file.ref, current: !pinned || pinned === (await notebookSourceCid(file.notebook)), cells };
    }

    const question = study?.prov?.question ? summary(study.prov.question) : undefined;
    const unitOf = (target: DgId) => summary(target);
    return {
      run: context.summarize(run),
      ...(facts.status ? { status: facts.status } : {}),
      ...(facts.startedAt ? { startedAt: facts.startedAt } : {}),
      ...(facts.endedAt ? { endedAt: facts.endedAt } : {}),
      agents: facts.agents ?? [],
      ...(facts.condition ? { condition: facts.condition } : {}),
      deviations: facts.deviations ?? [],
      parameters,
      environment: Object.entries(facts.environment ?? {}).map(([name, item]) => ({ name, value: shown(item) })),
      seeAlso: facts.seeAlso ?? [],
      ...(study
        ? {
            study: {
              unit: context.summarize(study),
              ...(question ? { question } : {}),
              ...(study.facts?.design ? { design: study.facts.design } : {}),
              ...(study.facts?.hypothesis ? { hypothesis: study.facts.hypothesis } : {}),
              conditions: study.facts?.conditions ?? [],
              variables: study.facts?.variables ?? [],
            },
          }
        : {}),
      ...(prov.follows
        ? {
            protocol: {
              id: prov.follows.uri,
              ...(protocol ? { unit: context.summarize(protocol) } : {}),
              ...(protocol?.facts?.version ? { version: protocol.facts.version } : {}),
              ...(pinnedTo(prov.follows, cids.get(prov.follows.uri), Boolean(protocol)) ? { drift: pinnedTo(prov.follows, cids.get(prov.follows.uri), Boolean(protocol))! } : {}),
              ...(short(prov.follows.cid) ? { pinned: short(prov.follows.cid)! } : {}),
              steps: protocol?.facts?.steps ?? [],
              materials: protocol?.facts?.materials ?? [],
            },
          }
        : {}),
      alsoFollowed: others.flatMap((pin) => summary(pin.uri) ?? []),
      ...(paperSourceUnit || paperUnit
        ? {
            reportedIn: {
              ...(paperSourceUnit && !paperSourceUnit.removed ? { source: context.summarize(paperSourceUnit) } : {}),
              ...(paperUnit && paperCanvas ? { paper: { ...paperUnit, canvas: paperCanvas } } : {}),
            },
          }
        : {}),
      code: codeUnits.map(({ pin, record }) => ({
        id: pin.uri,
        ...(record ? { unit: context.summarize(record) } : {}),
        ...(pinnedTo(pin, record?.facts?.sourceCid, Boolean(record)) ? { drift: pinnedTo(pin, record?.facts?.sourceCid, Boolean(record))! } : {}),
        ...(short(pin.cid) ? { pinned: short(pin.cid)! } : {}),
        ...(record?.facts?.repo ? { repo: record.facts.repo } : {}),
        ...(record?.facts?.commit ? { commit: record.facts.commit } : {}),
        ...(record?.facts?.path ? { path: record.facts.path } : {}),
        ...(record?.facts?.language ? { language: record.facts.language } : {}),
      })),
      inputs: (prov.used ?? []).map((pin) => ({ id: pin.uri, ...(unitOf(pin.uri) ? { unit: unitOf(pin.uri)! } : {}), ...(short(pin.cid) ? { pinned: short(pin.cid)! } : {}) })),
      outputs,
      // One line for each claim and stance, however many pieces of evidence carry it there.
      claims: [
        ...new Map(
          resting.flatMap((evidence) =>
            argued(evidence.id).flatMap(({ claim, stance }) => {
              const unit = summary(claim);
              return unit ? [[`${claim}|${stance}`, { unit, stance, through: evidence.id }] as const] : [];
            }),
          ).reverse(),
        ).values(),
      ].reverse(),
      ...(notebook ? { notebook } : {}),
      problems: (await problemsBy())(id),
    };
  };

  const mine = (node: NodeRecord): void => {
    if (node.by.id !== context.me().id) throw new Error(`Only ${node.by.name} can change this unit.`);
  };

  return {
    "process.method": ({ id }) => method(id),
    "process.run": ({ id, previews = true }) => runPage(id, previews),
    "run.show": async ({ id }) => {
      value(await context.host.openSurface({ route: { surface: "run", ...(id ? { id } : {}) }, placement: "main" }));
      return null;
    },
    "run.list": async () =>
      context
        .documents("node")
        .filter((node) => !node.removed && base(node) === "run")
        .map((node) => ({
          run: context.summarize(node),
          ...(node.facts?.status ? { status: node.facts.status } : {}),
          at: node.facts?.startedAt ?? node.at,
          ...(node.source?.paper && !node.facts?.startedAt ? { reported: true as const } : {}),
          outputs: context.documents("node").filter((other) => !other.removed && base(other) === "output" && other.prov?.generatedBy === node.id).length,
          evidence: evidenceOn(node.id).length,
        }))
        .sort((a, b) => b.at.localeCompare(a.at)),

    "process.setFacts": async ({ id, facts, links }) => {
      const node = context.nodeOf(id);
      if (!node) throw new Error("That unit isn't in this graph.");
      mine(node);
      const kind = base(node);
      const allowed: Record<string, (keyof UnitFacts)[]> = {
        protocol: ["steps", "materials", "version"],
        study: ["hypothesis", "design", "conditions", "sampleSize", "preregistration"],
        run: ["condition", "deviations"],
      };
      const keys = allowed[kind ?? ""];
      if (!keys) throw new Error("Only a protocol, an experiment or a run has these fields.");
      const next: Record<string, unknown> = { ...(node.facts ?? {}) };
      for (const [key, item] of Object.entries(facts)) {
        if (!keys.includes(key as keyof UnitFacts)) throw new Error(`A ${kind} has no ${key}.`);
        const empty = item === undefined || item === null || item === "" || (Array.isArray(item) && item.length === 0);
        if (empty) delete next[key];
        else next[key] = item;
      }
      const prov = { ...(node.prov ?? {}) };
      const setLink = async (key: "question" | "partOf", wanted: string, target: DgId | null | undefined): Promise<void> => {
        if (target === undefined) return;
        if (target === null) delete prov[key];
        else if (base(context.nodeOf(target)) !== wanted) throw new Error(`That isn't a ${wanted}.`);
        else prov[key] = target;
      };
      if (kind === "study") {
        await setLink("question", "question", links?.question);
        if (links?.protocols) {
          if (links.protocols.some((target) => base(context.nodeOf(target)) !== "protocol")) throw new Error("A study's protocols are protocols.");
          if (links.protocols.length) prov.protocols = links.protocols;
          else delete prov.protocols;
        }
      }
      if (kind === "run") {
        await setLink("partOf", "study", links?.partOf);
        if (links?.follows === null) delete prov.follows;
        else if (links?.follows) {
          const protocol = context.nodeOf(links.follows);
          if (!protocol || base(protocol) !== "protocol") throw new Error("A run follows a protocol.");
          // Pinned to the protocol as it stands now, so a later edit shows as drift.
          prov.follows = { uri: protocol.id, cid: await unitCid(protocol) };
        }
      }
      await context.put([revise({ record: node, changes: { facts: next as UnitFacts, prov }, by: context.me() })]);
      return method(id);
    },

    "notebook.list": async (): Promise<NotebookFile[]> => {
      const files = value(await context.host.listFiles({ extensions: ["ipynb"], limit: 500 }));
      const nodes = context.documents("node").filter((node) => !node.removed);
      return files.map((file) => {
        // Read from this base, or the same file read from its repository.
        const code = nodes.find((node) => base(node) === "code" && (node.facts?.path === file.ref || node.facts?.path?.split("/").pop() === file.name));
        const runs = code ? nodes.filter((node) => base(node) === "run" && (node.prov?.instrument ?? []).some((pin) => pin.uri === code.id)).length : 0;
        return {
          ref: file.ref,
          name: file.name,
          ...(file.folder ? { folder: file.folder } : {}),
          ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}),
          ...(code ? { code: code.id } : {}),
          runs,
        };
      });
    },

    "notebook.import": async ({ ref, text = false, study, protocol }): Promise<NotebookImported> => {
      const asset = value(await context.host.readAsset({ ref }));
      let notebook: Notebook;
      try {
        notebook = JSON.parse(textOf(asset.dataUrl)) as Notebook;
      } catch {
        throw new Error(`${asset.name} isn't a Jupyter notebook: it doesn't read as JSON.`);
      }
      if (!Array.isArray(notebook.cells) || typeof notebook.nbformat !== "number") throw new Error(`${asset.name} isn't a Jupyter notebook.`);
      if (notebook.nbformat < 4) throw new Error(`${asset.name} is in notebook format ${notebook.nbformat}. Open and save it in Jupyter to bring it to format 4, then import it.`);
      notebook.metadata ??= {};
      const stamp = context.stamp();
      const { types, created } = ensureProcessTypes({ nodeTypes: context.nodeTypes(), stamp, ...(context.titleFormat ? { titleFormat: context.titleFormat } : {}) });
      if (study && base(context.nodeOf(study)) !== "study") throw new Error("That isn't an experiment.");
      const followed = protocol ? context.nodeOf(protocol) : undefined;
      if (protocol && base(followed) !== "protocol") throw new Error("That isn't a protocol.");
      const before = context.documents("node").find((node) => node.type === types.code.id && node.facts?.path === ref && !node.facts?.repo);
      const plan = await planNotebookImport({
        notebook,
        path: ref,
        graph: context.graph(),
        types,
        stamp,
        agents: [context.me().id],
        text,
        ...(study ? { partOf: study } : {}),
        ...(followed ? { follows: { uri: followed.id, cid: await unitCid(followed) } } : {}),
      });
      const fresh: DgRecord[] = [...created, ...plan.records];
      if (fresh.length) await context.put(fresh);
      return {
        code: context.summarize(context.nodeOf(plan.code.id) ?? plan.code),
        run: context.summarize(context.nodeOf(plan.run.id) ?? plan.run),
        outputs: plan.outputs.map((output) => context.summarize(context.nodeOf(output.id) ?? output)),
        known: plan.known,
        revised: Boolean(before && before.facts?.sourceCid !== plan.code.facts?.sourceCid),
        status: plan.run.facts?.status ?? "completed",
      };
    },

    "evidence.fromOutput": async ({ output, title }) => {
      const record = context.nodeOf(output);
      if (!record || base(record) !== "output") throw new Error("That isn't an output.");
      const type = context.nodeTypes().find((item) => item.base === "evidence");
      if (!type) throw new Error("This graph has no evidence type yet.");
      const run = record.prov?.generatedBy;
      const evidence = createNode({
        ...context.stamp(),
        title: title?.trim() || `What ${record.title} shows`,
        type: type.id,
        // Pinned to the bytes as they are now. If the output is regenerated, this evidence shows as resting on older bytes.
        prov: { observationBase: [{ uri: record.id, ...(record.facts?.cid ? { cid: record.facts.cid } : {}) }], ...(run ? { isGroundedIn: run } : {}) },
        facts: { provenance: { method: "authored" } },
      });
      await context.put([evidence]);
      const made = context.summarize(context.nodeOf(evidence.id) ?? evidence);
      context.send({ event: "place-node", node: evidence.id });
      return made;
    },
  };
};
