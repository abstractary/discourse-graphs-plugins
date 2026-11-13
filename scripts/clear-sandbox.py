"""Clears test leftovers from the sandbox vault. Dry run unless --apply is given.
Keeps a unit when it sits on a kept canvas, belongs to a kept paper, or is something a kept unit rests on or argues with."""
import json, re, sys, os, shutil, collections
VAULT = sys.argv[1]
APPLY = "--apply" in sys.argv
LOG = os.path.join(VAULT, "discourse-graph/records/01a1b256-bfc8-7d92-991b-05e275d6bd0e.jsonl")
recs = [json.loads(l) for l in open(LOG) if l.strip()]
latest = {}
for r in recs: latest[r["id"]] = r
DROP_CANVAS = [r"^Tension map \d+", r"^Crate: Lorenz reservoir sweep", r"^Tangled", r"^dg-check", r"^Renamed \d+", r"^Search test$", r"^Paste target$", r"^Walkthrough canvas$", r"^People test$",
               r"^Among 50 experiments that produced formal results, the median time from issue claiming to first result was 12 days( \d+)?$"]
canvases = {i: r for i, r in latest.items() if r["kind"] == "canvas"}
kept_canvas = {i for i, r in canvases.items() if not r.get("removed") and not any(re.search(p, r["title"]) for p in DROP_CANVAS)}
nodes = {i: r for i, r in latest.items() if r["kind"] == "node"}
live = {i for i, r in nodes.items() if not r.get("removed")}
papers = {i: r for i, r in latest.items() if r["kind"] == "paper"}
kept_paper = {i for i, r in papers.items() if not r.get("removed") and r.get("canvas") in kept_canvas}
TEST_NODE = [r"^Finding \d+ of a long argument", r"^Actin rose 2x \d+", r"^Maybe load matters", r"^Actin (tracks|scales with) tension \d+", r"^Follow-up evidence \d+", r"^Mirror ", r"^dg-check", r"^Credited to the lab \d+", r"^A loose thought \d+", r"^ST (evidence|claim) ",
             r"^Among 50 experiments that produced formal results, the median time from issue claiming to first result was 12 days \d+$"]
on = collections.defaultdict(set)
for r in latest.values():
    if r["kind"] == "canvas-item" and not r.get("removed"):
        n = (r["item"].get("dg") or {}).get("node")
        if n: on[n].add(r["canvas"])
def test_unit(i):
    r = nodes[i]
    if r.get("removed"): return True
    if any(re.search(p, r["title"]) for p in TEST_NODE): return True
    # Only ever on canvases that are themselves test leftovers, and part of no kept paper.
    if on[i] and not (on[i] & kept_canvas) and (r.get("source") or {}).get("paper") not in kept_paper: return True
    return False
drop_nodes = {i for i in nodes if test_unit(i)}
keep = set(nodes) - drop_nodes
labs = {r.get("did") for r in latest.values() if r["kind"] == "lab" and re.match(r"^Test Lab", r.get("name", ""))}
def gone(r, dropped_items):
    k = r["kind"]
    if k == "canvas": return r["id"] not in kept_canvas
    if k == "node": return r["id"] in drop_nodes
    if k == "canvas-item":
        it = r["item"]
        return r["canvas"] not in kept_canvas or (it.get("dg") or {}).get("node") in drop_nodes or it.get("fromNode") in dropped_items or it.get("toNode") in dropped_items
    if k == "relation": return r["source"] in drop_nodes or r["target"] in drop_nodes
    if k in ("anchor", "folder-item", "snapshot"): return r.get("node") in drop_nodes
    if k == "paper": return r["id"] not in kept_paper
    if k == "lab": return r.get("did") in labs
    if k == "membership": return r.get("lab") in labs
    return False
dropped = set(); dropped_items = set()
for _ in range(3):
    for r in recs:
        if gone(r, dropped_items):
            dropped.add(r["id"])
            if r["kind"] == "canvas-item": dropped_items.add(r["id"]); dropped_items.add(r["item"].get("id"))
for r in recs:
    if r["kind"] in ("retraction", "decision") and (r.get("target") in dropped or (r["kind"] == "retraction" and r.get("target") not in latest)): dropped.add(r["id"])
out = [r for r in recs if r["id"] not in dropped]
print("records", len(recs), "->", len(out))
print("canvases kept", len(kept_canvas), "of", len(canvases)); [print("   keep:", canvases[i]["title"][:100]) for i in sorted(kept_canvas, key=lambda i: canvases[i]["at"])]
print("nodes kept", len(keep), "dropped", len(drop_nodes), "(of which already removed:", len(set(nodes) - live), ")")
shape = lambda t: re.sub(r"\b\d{4,}\b", "<N>", re.sub(r"Finding \d+", "Finding <n>", t))[:80]
c = collections.Counter(shape(nodes[i]["title"]) for i in drop_nodes if i in live)
print("dropped live node shapes:", len(c)); [print("   drop:", n, "|", t) for t, n in c.most_common(200)]

# Files
def dg_id(path):
    try:
        head = open(path, encoding="utf8", errors="ignore").read(600)
    except Exception: return None
    m = re.search(r"^dg-id:\s*(\S+)", head, re.M)
    return m.group(1) if m else None
remove = []
KEEP_FILES = [r"^\.obsidian/", r"^Paper files/reservoir-computing/", r"^Paper files/preclinical-sle-mediators\.pdf$", r"^Notebooks/", r"^discourse-graph/space\.json$", r"^relations\.json$", r"^discourse-graph/records/(01a1b256[^/]*|worked-example)\.jsonl$"]
for root, dirs, files in os.walk(VAULT):
    for f in files:
        full = os.path.join(root, f); rel = os.path.relpath(full, VAULT)
        if any(re.search(p, rel) for p in KEEP_FILES): continue
        if f.endswith(".md"):
            i = dg_id(full)
            if i and i in keep: continue
            if not i and rel.startswith("Discourse Nodes 45349/"): continue
            # A note for a unit in another log (the worked example) stays.
            if i and i not in nodes: continue
        remove.append(rel)
print("root notes with no unit id to remove:", [r for r in remove if "/" not in r and r.endswith(".md") and not dg_id(os.path.join(VAULT, r))][:20])
print("non-note files to remove:", [r for r in remove if not r.endswith(".md")])
print("files to remove", len(remove)); c = collections.Counter(os.path.dirname(r) or "." for r in remove); print("  ", dict(c))
kept_files = sum(len(fs) for _, _, fs in os.walk(VAULT)) - len(remove); print("files kept", kept_files)
if APPLY:
    open(LOG, "w").write("".join(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n" for r in out))
    for rel in remove: os.remove(os.path.join(VAULT, rel))
    for root, dirs, files in os.walk(VAULT, topdown=False):
        if not os.listdir(root) and ".obsidian" not in root: os.rmdir(root)
    print("applied")
