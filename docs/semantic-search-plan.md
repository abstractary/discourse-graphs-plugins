# Semantic search: plan

A plan only. Nothing here is built yet. Unit search (`search.query`) already matches words in titles, note text and PDF passages. This adds matching by meaning, from an embedding model running on the person's own machine, so "cytokines rise before diagnosis" finds a claim that says "IFN-γ elevation precedes autoantibodies".

Written 12 Nov 2026. The model and runtime facts come from a sourced research brief. The links are below, and the newest items should be checked again before choosing.

## What a person gets

- **Meaning in search.** The search panel and quick finder add a fourth "Meaning" chip beside Titles, Notes and Passages. A unit found only by meaning shows "Related in meaning" on its second line instead of a marked snippet.
- **Similar units.** Cards and the context panel get a "Similar units" action. It lists the nearest units, from this person and their lab, with the ones already linked set apart.
- **Candidate relations, later.** A pair that sits close in meaning but has no relation is offered as a possible link. It stays pending until a person decides, like any proposed relation.
- **Their own time.** The model embeds the graph when the person asks ("Embed now"), in small batches while the app is idle, or in a nightly window while the app is left open. The panel says how far along it is and which model it used.

## Model

| Role | Model | Why |
|---|---|---|
| Default | **Qwen3-Embedding-0.6B**, cut to 512 dimensions | Of the models under 1B parameters it scores best on the two science sets in MTEB English v2: TREC-COVID 90.5, SCIDOCS 24.4. Licence Apache-2.0, 32K context, output can be cut anywhere from 32 to 1024 dimensions. The same weights exist as ONNX int8 (614 MB), for Ollama (639 MB) and as GGUF. |
| Small and fast | **EmbeddingGemma 2**, text-only (270M) | Released October 2026. Licence Apache-2.0, 8K context, 768 dimensions that can be cut to 512, 256 or 128. Downloads are 174–314 MB as ONNX. |
| Bigger, overnight | **Qwen3-Embedding-4B**, through Ollama or llama.cpp | 2.5 GB at q4. SciFact 78.3, SCIDOCS 31.4, TREC-COVID 92.9. Its vectors can't be mixed with the 0.6B model's, so it builds its own index. |

Ruled out:

- **SPECTER2 and SciNCL** compare one paper's title and abstract with another's. They don't find a claim from a question.
- **Jina v3, v4 and v5** have non-commercial or research-only licences.
- **nomic v2** has only 512 tokens of context.
- **bge-m3** and **all-MiniLM** score well below the default on the science sets.

Each model wants its own query prefix. Qwen3 takes an `Instruct: … Query:` line before the query; EmbeddingGemma takes `task: search result | query:` before the query and `title: … | text:` around a document. Leaving the prefix out costs 1–5% on Qwen3. The prefix is part of how a vector is made, so it's stored with the index (see Risks).

## Where it runs

The panels can't run a model. Their content policy allows no workers, no eval and no network. It runs in the core's process, behind one interface:

```ts
type Embedder = {
  /** Model, revision, dimensions and prefix template. Vectors with different ids never mix. */
  id: string;
  embed: (texts: string[], as: "query" | "document") => Promise<Float32Array[]>;
};
```

There are two ways to provide it, both chosen per device:

- **In process, with transformers.js 4.x** (ONNX through WebGPU, falling back to WASM):
  - **Obsidian desktop:** in the plugin, inside a Web Worker made from a Blob URL so inference never stalls the window. The ONNX Runtime WASM files ship inside `main.js`, because Obsidian installs only `main.js`, `manifest.json` and `styles.css` from a release. Weights download once into the plugin's folder.
  - **Roam:** in the page, with weights in the Cache API and vectors in IndexedDB.
  - **Local app:** in Node, or with onnxruntime-node, which can use CoreML or DirectML.
- **Over HTTP**, to a model server the person already runs: Ollama's `/api/embed`, llama.cpp's `/v1/embeddings` (with `--pooling last` for Qwen3), or a lab's own compute server. This reuses the compute-server setting PDF extraction already has.
  - Roam can reach a server on the same machine only if Ollama is started with `OLLAMA_ORIGINS` set, and Chrome 142 and later ask the person before a website can reach their own machine.
  - Text leaves the device only if the person points this at a server that isn't on it, and the setting says so.

## The index

- **What's embedded:** one chunk per unit, made of its type, its title and the start of its note. A long note adds chunks of about 200 tokens with no overlap. A PDF passage gets its own chunk. A unit scores as its best chunk. Teammates' units have no note here, so they get their title and passage.
- **Only what changed:** each chunk is keyed by a hash of its text plus the embedder id, so only new or edited text is embedded again. A rename or a note edit re-embeds that unit alone. A new model rebuilds everything.
- **Stored per device, never synced:** vectors are derived data and differ by model. This needs one host addition: `readCache` / `writeCache({ key, bytes })` for per-device binary files, with a conformance check. Obsidian keeps them in the plugin's folder, Roam in IndexedDB, the local app in a file beside its settings.
- **Size:** int8 at 512 dimensions is about 26 MB for 50,000 chunks, against 102 MB as float32. int8 keeps about 97% of retrieval quality, and about 99% once the top results are rescored with full vectors.
- **Search:** brute-force cosine over the int8 vectors, rescoring the top 100 in float. At 50,000 × 512 that's about 26M multiply-adds per query, which should take tens of milliseconds; an approximate index such as usearch or hnswlib-wasm can wait until a graph is much bigger.

## Ranking

- **Merging two lists:** start with reciprocal rank fusion (k = 60) over the top 100 from the existing word ranking and the top 100 from meaning. It needs no tuning, and an exact title match still comes first.
- **Tuning later:** once there's a judged set (below), compare it with a weighted blend of normalised scores, which needs few examples to tune and often wins.
- **Filters apply to both lists.** Type, person and lab filters, and the Titles, Notes and Passages chips, apply before fusion. Turning "Meaning" off gives exactly today's search.

## Scheduling

Obsidian plugins can't reach Electron's idle and power monitor, so:

- **Idle** means no input in the app for two minutes, and work runs in batches of about 32 chunks, yielding between them.
- **Battery:** where `navigator.getBattery` answers, work pauses on battery unless the person chose "Embed now".
- **Overnight** means a window the person sets, such as 1:00 to 6:00, while the app is left open. It can't wake a closed app.
- **Progress** shows in the search panel's footer: "Meaning: 1,240 of 1,300 units · Qwen3-Embedding-0.6B · 2:14". It can be paused.

## Steps

1. **Measure first.** Build a judged set: 40–60 real questions a lab member would type, each with the units that answer it. Draw them from the worked example and one real lab graph. Compare word search, each model, and the fused ranking on recall@10 and nDCG@10, and time embedding on an M1 laptop and a typical Windows laptop. No throughput numbers are published for these models on that hardware, and benchmarks scored on papers may not hold for 70-character claims.
2. **Over HTTP first.** Add the `Embedder` interface, the index, the cache host methods and their conformance check, and RRF in `search.query`. Ollama is the first provider, because it needs nothing bundled and works in all three apps.
3. **In process in Obsidian.** Add transformers.js in a worker, the model download with progress, and the idle, battery and window scheduling.
4. **Similar units.** Add the card and context-panel action, then candidate relations as pending proposals.
5. **Roam in the page** with WebGPU, and tune fusion with the judged set.

## Risks

- **Mixed vectors.** Teammates' devices may use different models. Every vector carries its embedder id, and search reads only vectors that match the active embedder.
- **Prefix mistakes** quietly cost quality, so the template is part of the id.
- **First download** is 300–700 MB and may fail behind a lab's firewall. The HTTP provider is the way around it.
- **Window stalls.** Earlier attempts to move transformers.js into a worker have failed, so step 3 starts with a spike to prove the worker path.
- **Fast-moving pieces.** EmbeddingGemma 2 is about a month old and transformers.js 4.x changes quickly, so versions are pinned and the model is chosen by the step 1 measurements.

## Questions for the product lead

- Is a 600 MB download acceptable for the default, or should the small model be the default and the larger one an opt-in?
- Is "run Ollama" acceptable for the first release, or must meaning work with nothing else installed?
- Should a lab ever share vectors, to save each member embedding the same units? The default here is no: vectors stay on each device.
- Which questions should the judged set hold? Real queries from a lab beat invented ones.

## Sources

- **Qwen3-Embedding-0.6B:**
  - [Model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
  - [MTEB results](https://github.com/embeddings-benchmark/results/tree/main/results/Qwen__Qwen3-Embedding-0.6B)
  - [ONNX files](https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/tree/main/onnx)
  - [GGUF card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF)
  - [Ollama tags](https://ollama.com/library/qwen3-embedding/tags)
- **Qwen3-Embedding-4B:** [MTEB results](https://github.com/embeddings-benchmark/results/tree/main/results/Qwen__Qwen3-Embedding-4B)
- **EmbeddingGemma 2:**
  - [Model card](https://huggingface.co/google/embeddinggemma-2)
  - [ONNX files](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/tree/main/onnx)
  - [Ollama tags](https://ollama.com/library/embeddinggemma-2/tags)
- **Runtimes:**
  - [transformers.js releases](https://github.com/huggingface/transformers.js/releases)
  - [transformers.js environment settings](https://huggingface.co/docs/transformers.js/api/env)
  - [Ollama embed API](https://docs.ollama.com/api/embed)
  - [Ollama FAQ on origins](https://docs.ollama.com/faq)
  - [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- **Platform limits:**
  - [Obsidian release files](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
  - [Electron power monitor](https://www.electronjs.org/docs/latest/api/power-monitor)
  - [Battery API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getBattery)
- **Quantization, fusion and chunking:**
  - [Embedding quantization](https://huggingface.co/blog/embedding-quantization)
  - [Reciprocal rank fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
  - [Fusion functions compared](https://arxiv.org/abs/2210.11934)
  - [Chunking study](https://www.trychroma.com/research/evaluating-chunking)
