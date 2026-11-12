"""Checks a JSON-LD export against the process ontology and its shapes.

    python3 -I ontology/validate.py examples/worked-example/graph.jsonld

Needs rdflib and pyshacl (`pip install rdflib pyshacl`). Exits 1 on any
violation. Warnings are gaps for a person to look at, so they are counted and
listed but don't fail the check.
"""

import collections
import sys
from pathlib import Path

import pyshacl
from rdflib import RDF, Graph, Namespace, URIRef

HERE = Path(__file__).parent
SH = Namespace("http://www.w3.org/ns/shacl#")
DGP = Namespace("https://discoursegraphs.com/schema/dg_process#")
PLANS = [DGP.Protocol, DGP.Study, DGP.Code]


def main(path: str) -> int:
    data = Graph().parse(path, format="json-ld")
    ontology = Graph().parse(HERE / "dg_process.ttl", format="turtle")
    shapes = Graph().parse(HERE / "dg_process.shacl.ttl", format="turtle")
    conforms, report, _ = pyshacl.validate(
        data, shacl_graph=shapes, ont_graph=ontology, inference="none", allow_warnings=True
    )
    by_severity = collections.defaultdict(collections.Counter)
    for result in report.subjects(RDF.type, SH.ValidationResult):
        severity = str(report.value(result, SH.resultSeverity)).rsplit("#", 1)[-1]
        message = str(report.value(result, SH.resultMessage))
        by_severity[severity][message] += 1

    # PROV-O: a run is an Activity and plans are Entities, which are disjoint.
    both = [s for s in data.subjects(RDF.type, DGP.Run) if any((s, RDF.type, p) in data for p in PLANS)]

    types = collections.Counter(str(o).rsplit("#", 1)[-1] for o in data.objects(None, RDF.type))
    print(f"{len(data)} triples; " + ", ".join(f"{n} {t}" for t, n in sorted(types.items())))
    for severity in ("Violation", "Warning", "Info"):
        for message, n in by_severity[severity].most_common():
            print(f"{severity}: {n} x {message}")
    if both:
        print(f"Violation: {len(both)} nodes typed as both a Run and a plan")
    violations = sum(by_severity["Violation"].values()) + len(both)
    print("conforms" if violations == 0 else f"{violations} violations")
    return 0 if violations == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / "examples/worked-example/graph.jsonld")))
