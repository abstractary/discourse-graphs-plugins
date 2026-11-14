"""Checks a JSON-LD export against the process ontology and its shapes.

    python3 -I ontology/validate.py examples/worked-example/graph.jsonld
    python3 -I ontology/validate.py --self-test

Needs rdflib and pyshacl (`pip install rdflib pyshacl`). Exits 1 on any
violation. Warnings and infos are gaps for a person to look at, so they are
counted and listed but don't fail the check.

`--self-test` runs ontology/tests/cases.json: one wrong graph per rule. It
fails if a rule doesn't fire, fires on the wrong unit, or fires when it
shouldn't. test/shapes.test.ts runs the same cases through the plugins' own
check, so the two can't drift apart.
"""

import collections
import copy
import json
import sys
from pathlib import Path

import pyshacl
from rdflib import RDF, BNode, Graph, Namespace

HERE = Path(__file__).parent
SH = Namespace("http://www.w3.org/ns/shacl#")
SHAPES = "https://discoursegraphs.com/schema/dg_process/shapes#"
KEYWORDS = {"id", "type", "@id", "@type", "@context", "@graph"}


def load():
    ontology = Graph().parse(HERE / "dg_process.ttl", format="turtle")
    shapes = Graph().parse(HERE / "dg_process.shacl.ttl", format="turtle")
    return ontology, shapes


def results(data, ontology, shapes):
    """Every result as (focus, rule, severity, message). A pin's focus is `_:`."""
    _, report, _ = pyshacl.validate(data, shacl_graph=shapes, ont_graph=ontology, inference="none", allow_warnings=True, allow_infos=True)
    out = []
    for result in report.subjects(RDF.type, SH.ValidationResult):
        focus = report.value(result, SH.focusNode)
        rule = str(report.value(result, SH.sourceShape))
        out.append((
            "_:" if isinstance(focus, BNode) else str(focus),
            rule[len(SHAPES):] if rule.startswith(SHAPES) else rule,
            str(report.value(result, SH.resultSeverity)).rsplit("#", 1)[-1],
            str(report.value(result, SH.resultMessage)),
        ))
    return out


def unmapped(document):
    """Keys the context doesn't define. JSON-LD drops them without a word."""
    context = document.get("@context")
    if not isinstance(context, dict):
        context = json.loads((HERE / "dg_process.context.jsonld").read_text())["@context"]
    known = set(context) | KEYWORDS
    missing = collections.Counter()
    for node in document.get("@graph", []):
        missing.update(key for key in node if key not in known)
    return missing


def check(path: str) -> int:
    document = json.loads(Path(path).read_text())
    data = Graph().parse(data=json.dumps(document), format="json-ld")
    ontology, shapes = load()
    found = results(data, ontology, shapes)
    types = collections.Counter(str(o).rsplit("#", 1)[-1] for o in data.objects(None, RDF.type))
    print(f"{len(data)} triples; " + ", ".join(f"{n} {t}" for t, n in sorted(types.items())))
    violations = 0
    for severity in ("Violation", "Warning", "Info"):
        counted = collections.Counter((rule, message) for _, rule, level, message in found if level == severity)
        for (rule, message), n in counted.most_common():
            print(f"{severity}: {n} x {rule}: {message}")
        if severity == "Violation":
            violations = sum(counted.values())
    dropped = unmapped(document)
    for key, n in dropped.most_common():
        print(f"Violation: {n} x unmapped-key: \"{key}\" isn't in the context, so it never reaches the graph")
    violations += sum(dropped.values())
    print("conforms" if violations == 0 else f"{violations} violations")
    return 0 if violations == 0 else 1


def self_test() -> int:
    suite = json.loads((HERE / "tests" / "cases.json").read_text())
    context = json.loads((HERE / "dg_process.context.jsonld").read_text())["@context"]
    ontology, shapes = load()
    declared = {str(s)[len(SHAPES):] for s in shapes.subjects() if str(s).startswith(SHAPES)}
    covered, failed = set(), 0
    for case in suite["cases"]:
        nodes = {node["id"]: node for node in copy.deepcopy(suite["base"])}
        for short, changes in case["patch"].items():
            node = nodes[f"urn:dg:{short}"]
            for key, value in changes.items():
                if value is None:
                    node.pop(key, None)
                else:
                    node[key] = value
        graph = list(nodes.values()) + case.get("add", [])
        data = Graph().parse(data=json.dumps({"@context": context, "@graph": graph}), format="json-ld")
        got = sorted({(focus, rule, severity) for focus, rule, severity, _ in results(data, ontology, shapes)})
        want = sorted({(item["focus"], item["rule"], item["severity"]) for item in case["expect"]})
        covered.update(rule for _, rule, _ in want)
        if got != want:
            failed += 1
            print(f"FAIL {case['name']}\n  expected {want}\n  got      {got}")
    rules = {rule for rule in declared if rule[:1].islower()}
    untested = sorted(rules - covered)
    if untested:
        failed += 1
        print(f"FAIL rules with no case: {', '.join(untested)}")
    print(f"{len(suite['cases'])} cases, {len(rules)} rules, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(self_test())
    sys.exit(check(sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "examples/worked-example/graph.jsonld")))
