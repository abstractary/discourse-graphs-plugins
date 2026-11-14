// Three real studies, one each from biology, computer science and sociology,
// recorded as the same chain: question, study, protocol, run, code, output,
// evidence, claim. Run from the repository root:
//   node examples/disciplines/build.ts
// Every fact comes from the paper's own abstract, text, figure captions or code
// repository, checked on 13 November 2026. Each example's `notes` say what its
// field made easy and what it left out. Ids and times are fixed, so the output
// is the same on every run.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  assertRelation,
  buildCanvas,
  createCanvas,
  createCanvasItem,
  createLab,
  createNode,
  createSnapshot,
  defaultGrammar,
  foldRecords,
  validateRecord,
  type Author,
  type DgId,
  type DgRecord,
  type JsonObject,
  type NodeRecord,
  type NodeTypeRecord,
  type ProvenanceLinks,
  type RelationTypeRecord,
  type UnitFacts,
} from "@dg/contract/records.ts";
import type { Identifier } from "@dg/contract/scholarly.ts";
import { withProvenance, recordsFor, slugOf } from "@dg/core/crate.ts";
import { toDataCite } from "@dg/core/datacite.ts";
import { toProcessJsonLd } from "@dg/core/jsonld.ts";
import { ensureProcessTypes, protocolCids, unitCid } from "@dg/core/process.ts";
import { cratePreview, crateReadme, toRoCrate, type CrateFile } from "@dg/core/rocrate.ts";
import { toZenodo } from "@dg/core/zenodo.ts";
import { unzip, zip } from "@dg/core/zip.ts";

const OUT = "examples/disciplines";
const LICENSE = "https://creativecommons.org/licenses/by/4.0/";

type Unit = { title: string; facts?: UnitFacts; body?: string };
type Example = {
  slug: string;
  field: string;
  name: string;
  /** What the example shows about its field's way of working. */
  notes: string[];
  source: Unit & { identifiers: Identifier[] };
  question: string;
  claims: string[];
  studies: (Unit & { protocols: number[] })[];
  protocols: (Unit & { code?: number[] })[];
  code: Unit[];
  runs: (Unit & { study: number; protocol: number; code?: number[]; used?: string[] })[];
  outputs: (Unit & { run: number })[];
  evidence: (Unit & { run: number; outputs: number[]; supports: number[] })[];
};

const quote = (exact: string): UnitFacts => ({ anchor: { exact } });

const EXAMPLES: Example[] = [
  {
    slug: "computer-science",
    field: "Computer science",
    name: "Next generation reservoir computing (Gauthier et al. 2021)",
    notes: [
      "The whole chain is on record. The code is public under an MIT license, the version the paper used is tagged v1.0 and archived on Zenodo, and the run's parameters are read from the script itself.",
      "The script is pinned by a hash of its bytes at that tag, so a later change to the repository shows up as drift.",
      "The data is not a file: the paper says it is recreated by running the code. So the evidence rests on a figure and on the run that makes it.",
    ],
    source: {
      title: "Next generation reservoir computing",
      facts: { doi: "10.1038/s41467-021-25801-2", authors: ["Daniel J. Gauthier", "Erik Bollt", "Aaron Griffith", "Wendson A. S. Barbosa"], published: "2021-09-21", venue: "Nature Communications" },
      identifiers: [{ scheme: "pmid", value: "34548491" }, { scheme: "pmcid", value: "PMC8455577" }],
    },
    question: "Can a reservoir computer forecast chaotic dynamics without a random recurrent network?",
    claims: ["Nonlinear vector autoregression excels at reservoir computing benchmark tasks, with shorter training data sets and less training time"],
    studies: [
      {
        title: "Benchmarking a next generation reservoir computer on chaotic systems",
        facts: {
          design: "computational",
          hypothesis: "A nonlinear vector autoregression does what a reservoir computer does, with less training data.",
          conditions: ["Forecasting Lorenz63", "Forecasting a double-scroll electronic circuit", "Inferring an unseen Lorenz63 variable"],
          variables: [{ name: "Normalised root-mean-square error over one Lyapunov time", role: "dependent" }],
        },
        protocols: [0],
      },
    ],
    protocols: [
      {
        title: "NG-RC forecasting by nonlinear vector autoregression",
        facts: {
          steps: [
            "Integrate the system's equations to make training and test data",
            "Build the features: a constant, the last k states, and their quadratic products",
            "Fit the output weights by ridge regression on the training data",
            "Forecast one step at a time, feeding each prediction back in",
            "Score the forecast by normalised root-mean-square error over one Lyapunov time",
          ],
          parameters: [{ name: "k" }, { name: "s" }, { name: "dt" }, { name: "ridge parameter" }, { name: "training time" }],
          materials: ["Python", "NumPy", "SciPy", "matplotlib"],
        },
        code: [0],
      },
    ],
    code: [
      {
        title: "LorenzConstLinQuadraticNVARtimedelayNRMSE-RK23.py: Lorenz63 forecast with its error",
        facts: {
          repo: "https://github.com/quantinfo/ng-rc-paper-code",
          commit: "410de8c3f4a902ab3ca70d023207cdde23f64daf",
          path: "LorenzConstLinQuadraticNVARtimedelayNRMSE-RK23.py",
          // The CID of the file's 9,459 bytes at tag v1.0, computed with `cidOfBytes` on 13 November 2026.
          sourceCid: "bafkreiaetogffwwfurvxkov437wo55xhoc3qd4l5ntucl3c4gtlt6kf4xa",
          language: "python",
          license: "MIT",
          sameAs: ["https://doi.org/10.5281/zenodo.5218954"],
        },
      },
    ],
    runs: [
      {
        title: "Lorenz63 forecast, trained on 400 points",
        facts: {
          status: "completed",
          // As set in the script at v1.0: `ridge_param = 2.5e-6`, `traintime=10.`, `npts=10`. dt, k and s are from the paper's text.
          parameterValues: { k: 2, s: 1, dt: 0.025, "ridge parameter": 2.5e-6, "training time": 10, "training points": 400, "trials averaged": 10 },
          environment: { language: "Python" },
        },
        study: 0,
        protocol: 0,
        code: [0],
      },
    ],
    outputs: [
      {
        title: "Figure 2: forecasting a dynamical system with the NG-RC",
        facts: { outputKind: "figure", uri: "https://www.nature.com/articles/s41467-021-25801-2/figures/2", caption: "True and predicted Lorenz63 strange attractors, with the training and forecasting phases." },
        run: 0,
      },
    ],
    evidence: [
      {
        title: "Forecasting Lorenz63 after training on 400 points, the NG-RC's error over one Lyapunov time was 2.40 ± 0.53 × 10⁻³",
        facts: quote("nonlinear vector autoregression excels at reservoir computing benchmark tasks and requires even shorter training data sets and training time"),
        body: "From the caption of Figure 2: the normalised root-mean-square error over one Lyapunov time is 1.06 ± 0.01 × 10⁻⁴ during training and 2.40 ± 0.53 × 10⁻³ during forecasting, where the uncertainty is the standard error of the mean. The training phase uses 400 data points for each variable.",
        run: 0,
        outputs: [0],
        supports: [0],
      },
    ],
  },
  {
    slug: "biology",
    field: "Biology",
    name: "Actin force production in clathrin-mediated endocytosis (Akamatsu et al. 2020)",
    notes: [
      "Two different methods reach the same number. A simulation says about 200 Arp2/3 complexes are needed, and a count in live cells finds about 200. Each is its own run, under its own protocol, and both support one claim.",
      "The bench protocol names what a rerun needs that no script holds: the genome-edited cell line and the calibration standards. They are recorded as materials.",
      "The code is public, but the paper cites the repository as a whole. So the code is recorded at the repository's last commit, with no file path and no hash of one file.",
      "The images and simulation outputs are not deposited as files. The evidence rests on the paper's figures.",
    ],
    source: {
      title: "Principles of self-organization and load adaptation by the actin cytoskeleton during clathrin-mediated endocytosis",
      facts: { doi: "10.7554/elife.49840", authors: ["Matthew Akamatsu", "Ritvik Vasan", "Daniel Serwas", "Michael A. Ferrin", "Padmini Rangamani", "David G. Drubin"], published: "2020-01-17", venue: "eLife" },
      identifiers: [{ scheme: "pmid", value: "31951196" }, { scheme: "pmcid", value: "PMC7041948" }],
    },
    question: "How does a branched actin network produce enough force to internalize an endocytic pit against membrane tension?",
    claims: ["A minimal branched actin network is sufficient to internalize endocytic pits against membrane tension"],
    studies: [
      {
        title: "Multiscale model of actin force production at an endocytic pit",
        facts: { design: "computational", conditions: ["Number of available Arp2/3 complexes", "Membrane tension"], variables: [{ name: "Pit internalization", role: "dependent", unit: "nm" }] },
        protocols: [0],
      },
      {
        title: "Counting Arp2/3 complexes at endocytic sites in live human cells",
        facts: { design: "experimental", variables: [{ name: "Arp2/3 complexes per endocytic site", role: "dependent", unit: "molecules" }] },
        protocols: [1],
      },
    ],
    protocols: [
      {
        title: "Filament-based simulation of endocytic actin in Cytosim",
        facts: {
          steps: [
            "Find the force needed to pull in the coated pit from a continuum model of the membrane",
            "Simulate branched actin assembly around the pit in Cytosim",
            "Vary the number of Arp2/3 complexes available",
            "Measure how far the pit is internalized over simulated time",
          ],
          materials: ["Cytosim", "MATLAB R2017b", "Python 3.7"],
        },
        code: [0],
      },
      {
        title: "Molecule counting with GFP-tagged nanocage standards",
        facts: {
          steps: [
            "Express GFP-tagged nanocages of known copy number, from 12 to 120, in cells",
            "Image the nanocages by spinning disk confocal microscopy",
            "Fit a calibration curve of fluorescence intensity against copy number",
            "Image ArpC3-tagGFP2 with AP2-tagRFP-T at endocytic sites",
            "Convert each site's intensity to a number of molecules",
          ],
          materials: ["WTC-10 hiPSC AP2-tagRFP-T ArpC3-tagGFP2 (made in the study)", "60mer-tagGFP2 nanocage", "120mer-tagGFP2 nanocage", "AP21967 (Clontech 635056)"],
        },
      },
    ],
    code: [
      {
        title: "Akamatsu_CME_manuscript: simulation and image analysis code",
        facts: {
          repo: "https://github.com/DrubinBarnes/Akamatsu_CME_manuscript",
          // The repository's last commit, of 21 August 2019. The paper cites the repository, not a version.
          commit: "e0d5426515abaa37fdc9cd3151e108480a0337eb",
          license: "GPL-3.0",
          sameAs: ["https://github.com/elifesciences-publications/Akamatsu_CME_manuscript"],
        },
      },
    ],
    runs: [
      { title: "Arp2/3 titration in simulation", facts: { status: "completed", parameterValues: { "simulations per condition": 16 }, environment: { software: "Cytosim" } }, study: 0, protocol: 0, code: [0] },
      { title: "Arp2/3 counting in hiPS cells", facts: { status: "completed", parameterValues: { "calibration standards": "nanocages of 12 to 120 GFP copies" } }, study: 1, protocol: 1 },
    ],
    outputs: [
      { title: "Figure 1G: pit internalization against the number of Arp2/3 complexes", facts: { outputKind: "figure", uri: "https://elifesciences.org/articles/49840#fig1", caption: "Pit internalization over simulated time as a function of the number of available molecules of Arp2/3 complex. Average of 16 simulations per condition." }, run: 0 },
      { title: "Figure 2: molecule counting of GFP-tagged Arp2/3 complex in live hiPS cells", facts: { outputKind: "figure", uri: "https://elifesciences.org/articles/49840#fig2", caption: "A calibration curve from GFP-tagged nanocages, and ArpC3-tagGFP2 at endocytic sites marked by AP2-tagRFP-T." }, run: 1 },
    ],
    evidence: [
      { title: "In simulation, around 200 activated Arp2/3 complexes were required for robust internalization", facts: quote("Around 200 activated Arp2/3 complexes are required for robust internalization."), run: 0, outputs: [0], supports: [0] },
      { title: "About 200 Arp2/3 complexes assembled at sites of clathrin-mediated endocytosis in human cells", facts: quote("A newly developed molecule-counting method determined that ~200 Arp2/3 complexes assemble at sites of clathrin-mediated endocytosis in human cells."), run: 1, outputs: [1], supports: [0] },
    ],
  },
  {
    slug: "sociology",
    field: "Sociology",
    name: "Inequality and unpredictability in an artificial cultural market (Salganik, Dodds and Watts 2006)",
    notes: [
      "The design carries the weight. The study records what a reader of an experiment with people asks first: the conditions, who was assigned to them, and how many took part.",
      "There is no code and no data file on record here, and the paper is not open access. So the evidence rests on a passage in the paper and nothing else, and the crate says so instead of implying more.",
      "This is what a first reading looks like before anyone has traced the data. The gap is visible: a run with no outputs.",
    ],
    source: {
      title: "Experimental study of inequality and unpredictability in an artificial cultural market",
      facts: { doi: "10.1126/science.1121066", authors: ["Matthew J. Salganik", "Peter Sheridan Dodds", "Duncan J. Watts"], published: "2006-02", venue: "Science" },
      identifiers: [{ scheme: "pmid", value: "16469928" }],
    },
    question: "Why is the success of cultural products so unequal, and so hard to predict?",
    claims: ["Social influence makes success in a cultural market more unequal and less predictable", "Success in a cultural market is only partly determined by quality"],
    studies: [
      {
        title: "Artificial music market experiment",
        facts: {
          design: "experimental",
          hypothesis: "Knowing what earlier participants chose increases both the inequality and the unpredictability of success.",
          conditions: ["Without knowledge of previous participants' choices", "With knowledge of previous participants' choices"],
          variables: [
            { name: "Knowledge of previous participants' choices", role: "independent" },
            { name: "Inequality of success", role: "dependent" },
            { name: "Unpredictability of success", role: "dependent" },
          ],
          sampleSize: 14341,
        },
        protocols: [0],
      },
    ],
    protocols: [
      {
        title: "Web-based music market with two information conditions",
        facts: {
          steps: [
            "Offer previously unknown songs to participants on a website",
            "Show each participant the earlier participants' choices, or not, by condition",
            "Record which songs each participant downloads",
            "Compare the inequality and unpredictability of success between the conditions",
          ],
        },
      },
    ],
    code: [],
    runs: [{ title: "The music market experiment, as reported", facts: { status: "completed", parameterValues: { participants: 14341 } }, study: 0, protocol: 0 }],
    outputs: [],
    evidence: [
      { title: "Increasing the strength of social influence increased both the inequality and the unpredictability of success", facts: quote("Increasing the strength of social influence increased both inequality and unpredictability of success."), run: 0, outputs: [], supports: [0] },
      { title: "The best songs rarely did poorly and the worst rarely did well, but any other result was possible", run: 0, outputs: [], supports: [1] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Fixed ids, as in the worked example.

const SORTABLE = "234567abcdefghijklmnopqrstuvwxyz";
let counter = 0;
const nextTid = (): string => {
  let value = (BigInt(Date.UTC(2026, 10, 13) * 1000 + counter++) << 10n) | 11n;
  let out = "";
  for (let i = 0; i < 13; i += 1) {
    out = SORTABLE[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
};
const stable = <T extends DgRecord>(batch: T[]): T[] => {
  let text = JSON.stringify(batch);
  for (const record of batch) text = text.split(record.id).join(`${record.id.slice(0, record.id.lastIndexOf("#"))}#${nextTid()}`);
  return JSON.parse(text) as T[];
};
const one = <T extends DgRecord>(record: T): T => stable([record])[0]!;

const reader: Author = { id: "did:web:examples.records.example", name: "Example reader" };
const LAB = "did:web:lab.examples.records.example";
const encoder = new TextEncoder();
const text = (value: string): Uint8Array => encoder.encode(value);

const build = async (example: Example) => {
  const stamp = { space: `example-${example.slug}`, by: reader, at: "2026-11-13T00:00:00.000Z", lab: LAB };
  const records: DgRecord[] = [];
  const keep = <T extends DgRecord>(record: T): T => (records.push(record), record);
  keep(one(createLab({ ...stamp, name: "Example reading group", did: LAB, custodian: reader.id, custodianKey: "example-key-not-real", plc: [] })));
  const grammar = stable(defaultGrammar(stamp));
  grammar.forEach(keep);
  const nodeTypes = grammar.filter((record): record is NodeTypeRecord => record.kind === "node-type");
  const relationTypes = grammar.filter((record): record is RelationTypeRecord => record.kind === "relation-type");
  const made = stable(ensureProcessTypes({ nodeTypes, stamp }).created);
  made.forEach(keep);
  const type = (base: string): DgId => [...nodeTypes, ...made].find((item) => item.base === base)!.id;
  const relation = (base: string): DgId => relationTypes.find((item) => item.base === base)!.id;
  // Everything here was read from a paper by hand, so each unit says so.
  const how = { provenance: { method: "authored" as const, agent: "Read from the paper, its figure captions and its code repository" } };
  const node = (base: string, unit: Unit, prov?: ProvenanceLinks): NodeRecord => {
    const record = keep(one(createNode({ ...stamp, title: unit.title, type: type(base), facts: { ...how, ...unit.facts }, ...(prov && Object.keys(prov).length ? { prov } : {}) })));
    if (unit.body) keep(one(createSnapshot({ ...stamp, node: record.id, body: unit.body })));
    return record;
  };
  const relate = (base: string, source: DgId, target: DgId): DgId => keep(one(assertRelation({ ...stamp, type: relation(base), source, target }))).id;

  const question = node("question", { title: example.question });
  const code = example.code.map((unit) => node("code", unit));
  const protocols = example.protocols.map((unit) => node("protocol", unit, unit.code?.length ? { implementedBy: unit.code.map((index) => code[index]!.id) } : {}));
  const studies = example.studies.map((unit) => node("study", unit, { question: question.id, protocols: unit.protocols.map((index) => protocols[index]!.id) }));
  const runs: NodeRecord[] = [];
  for (const unit of example.runs) {
    const protocol = protocols[unit.protocol]!;
    runs.push(
      node("run", unit, {
        partOf: studies[unit.study]!.id,
        follows: { uri: protocol.id, cid: await unitCid(protocol) },
        ...(unit.code?.length ? { instrument: unit.code.map((index) => ({ uri: code[index]!.id, ...(code[index]!.facts?.sourceCid ? { cid: code[index]!.facts!.sourceCid! } : {}) })) } : {}),
      }),
    );
  }
  const source = node("source", { title: example.source.title, facts: { ...example.source.facts, identifiers: example.source.identifiers } }, { describesActivity: runs.map(({ id }) => id) });
  const outputs = example.outputs.map((unit) => node("output", unit, { generatedBy: runs[unit.run]!.id }));
  const claims = example.claims.map((title) => node("claim", { title }));
  const evidence = example.evidence.map((unit) =>
    node("evidence", { ...unit, facts: { ...unit.facts, ...(unit.facts?.anchor ? { anchor: { ...unit.facts.anchor, source: source.id } } : {}) } }, {
      ...(unit.outputs.length ? { observationBase: unit.outputs.map((index) => ({ uri: outputs[index]!.id })) } : {}),
      isGroundedIn: runs[unit.run]!.id,
      sourceDocument: source.id,
    }),
  );
  const links: { from: DgId; to: DgId; label: string; relation?: DgId }[] = [];
  for (const claim of claims) links.push({ from: claim.id, to: question.id, label: "Addresses", relation: relate("addresses", claim.id, question.id) });
  example.evidence.forEach((unit, index) => {
    for (const target of unit.supports) links.push({ from: evidence[index]!.id, to: claims[target]!.id, label: "Supports", relation: relate("supports", evidence[index]!.id, claims[target]!.id) });
    for (const output of unit.outputs) links.push({ from: evidence[index]!.id, to: outputs[output]!.id, label: "Observation base" });
    links.push({ from: evidence[index]!.id, to: runs[unit.run]!.id, label: "Grounded in" });
  });
  example.outputs.forEach((unit, index) => links.push({ from: outputs[index]!.id, to: runs[unit.run]!.id, label: "Generated by" }));
  example.runs.forEach((unit, index) => {
    links.push({ from: runs[index]!.id, to: protocols[unit.protocol]!.id, label: "Follows" });
    for (const item of unit.code ?? []) links.push({ from: runs[index]!.id, to: code[item]!.id, label: "Instrument" });
    links.push({ from: runs[index]!.id, to: studies[unit.study]!.id, label: "Part of" });
  });

  // One canvas, read left to right: the argument, then what it rests on, then how that was made.
  const canvas = keep(one(createCanvas({ ...stamp, title: example.name })));
  const columns = [[question], claims, evidence, outputs, runs, [...protocols, ...code], [...studies, source]];
  // Tall enough for a card that also shows its source, date and identifiers, so none covers the next.
  const heightOf = (title: string): number => 130 + Math.ceil(title.length / 34) * 20;
  const cards = new Map<DgId, DgId>();
  let z = 1;
  columns
    .filter((column) => column.length)
    .forEach((column, x) => {
      let y = 0;
      for (const unit of column) {
        cards.set(unit.id, keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { type: "text", text: unit.title, x: x * 340, y, width: 280, height: heightOf(unit.title), dg: { node: unit.id } } }))).id);
        y += heightOf(unit.title) + 40;
      }
    });
  for (const link of links) keep(one(createCanvasItem({ ...stamp, canvas: canvas.id, z: z++, item: { fromNode: cards.get(link.from)!, toNode: cards.get(link.to)!, toEnd: "arrow", label: link.label, ...(link.relation ? { dg: { relation: link.relation } } : {}) } })));

  const problems = records.flatMap((record) => validateRecord(record).map((problem) => `${record.kind} ${record.id}: ${problem}`));
  if (problems.length) throw new Error(problems.join("\n"));

  // The evidence crate, made with the same functions the export dialog uses.
  const graph = foldRecords({ records, localSpace: stamp.space, trustedLab: LAB });
  const nodes = withProvenance(graph, [...claims, ...evidence, question].map(({ id }) => id));
  const versions = await protocolCids(graph);
  const description = `${example.field}: ${example.notes[0]} A worked example for Discourse Graphs, read from the paper by hand. The paper's own text and figures are not included.`;
  const described = {
    title: example.name,
    description,
    creators: [{ name: reader.name }],
    publisher: "Example reading group",
    published: stamp.at,
    license: LICENSE,
    licenseName: "Creative Commons Attribution 4.0 International",
    derivedFrom: [{ scheme: "doi" as const, value: example.source.facts!.doi! }],
    references: [],
    software: code.flatMap((unit): Identifier[] => (unit.facts?.repo ? [{ scheme: "url", value: unit.facts.repo }] : [])),
    subjects: ["Discourse graph", example.field],
  };
  const jsonld = toProcessJsonLd(graph, "https://discoursegraphs.com/ns/process/context.jsonld", versions);
  const files: CrateFile[] = [
    { path: "discourse-graph.jsonld", name: "The discourse graph, as PROV-O JSON-LD", mediaType: "application/ld+json", bytes: text(JSON.stringify(jsonld, null, 2)), conformsTo: "https://www.w3.org/TR/prov-o/" },
    { path: "dg-records.jsonl", name: "Discourse Graphs records", mediaType: "application/jsonl", bytes: text(recordsFor(graph, nodes, canvas.id).map((record) => JSON.stringify(record)).join("\n")) },
    { path: `${slugOf(example.name)}.canvas`, name: `${example.name}, as a JSON Canvas`, mediaType: "application/json", bytes: text(JSON.stringify(buildCanvas({ graph, canvas: canvas.id }), null, 2)), conformsTo: "https://jsoncanvas.org/spec/1.0/" },
    { path: "datacite.json", name: "DataCite metadata", mediaType: "application/json", bytes: text(JSON.stringify(toDataCite(described), null, 2)), conformsTo: "https://schema.datacite.org/meta/kernel-4.6/" },
  ];
  const describe = (list: CrateFile[]) =>
    toRoCrate({ graph, nodes, name: example.name, description, license: LICENSE, author: { id: reader.id, name: reader.name }, publisher: { name: "Example reading group", id: LAB }, published: stamp.at, files: list, versions, nameOf: (author) => author.name });
  files.push({ path: "README.md", name: "Read me first", description: "The crate told as findings.", mediaType: "text/markdown", bytes: text(crateReadme(await describe(files))) });
  const metadata = await describe(files);
  const archive = zip([
    { path: "ro-crate-metadata.json", bytes: text(JSON.stringify(metadata, null, 2)) },
    { path: "ro-crate-preview.html", bytes: text(cratePreview(metadata)) },
    ...files.map(({ path, bytes }) => ({ path, bytes })),
  ]);

  const folder = join(OUT, example.slug);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(join(folder, "crate"), { recursive: true });
  writeFileSync(join(folder, "records.json"), `${JSON.stringify(records, null, 1)}\n`);
  writeFileSync(join(folder, "zenodo.json"), `${JSON.stringify(toZenodo(described), null, 1)}\n`);
  writeFileSync(join(folder, `${example.slug}.crate.zip`), archive);
  for (const entry of await unzip(archive)) {
    mkdirSync(dirname(join(folder, "crate", entry.path)), { recursive: true });
    writeFileSync(join(folder, "crate", entry.path), entry.bytes);
  }
  const count = (base: string): number => nodes.filter((id) => (graph.documents.get(id) as NodeRecord).type === type(base)).length;
  return {
    slug: example.slug,
    field: example.field,
    name: example.name,
    doi: example.source.facts!.doi,
    notes: example.notes,
    units: Object.fromEntries(["question", "claim", "evidence", "output", "run", "protocol", "code", "study", "source"].map((base) => [base, count(base)])),
    evidenceWithFiles: example.evidence.filter((unit) => unit.outputs.length).length,
    evidenceOnPassageOnly: example.evidence.filter((unit) => !unit.outputs.length).length,
    codePinnedByHash: code.filter((unit) => unit.facts?.sourceCid).length,
    records: records.length,
  };
};

const summary = [];
for (const example of EXAMPLES) summary.push(await build(example));
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 1)}\n`);
console.log(JSON.stringify(summary.map(({ slug, units, evidenceWithFiles, evidenceOnPassageOnly, codePinnedByHash }) => ({ slug, units, evidenceWithFiles, evidenceOnPassageOnly, codePinnedByHash })), null, 1));
