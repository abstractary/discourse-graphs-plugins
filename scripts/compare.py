"""Scores reports/comparison/capabilities.csv. Run from the dg-contract folder."""
import collections
import csv

rows = list(csv.DictReader(open("reports/comparison/capabilities.csv", encoding="utf8")))
today = [row for row in rows if row["area"] != "New in ours"]
mine = [row for row in rows if row["area"] == "New in ours"]
areas = list(dict.fromkeys(row["area"] for row in today))


def score(items):
    full = sum(row["ours"] == "full" for row in items)
    part = sum(row["ours"] == "part" for row in items)
    return full, part, (full + part / 2) / len(items) * 100 if items else 0


print("| Area | Capabilities | Roam on | Obsidian on | Ours full | Ours part | Coverage |")
print("|---|---:|---:|---:|---:|---:|---:|")
for area in areas:
    items = [row for row in today if row["area"] == area]
    full, part, cover = score(items)
    print(f"| {area} | {len(items)} | {sum(r['roam'] == 'on' for r in items)} | {sum(r['obsidian'] == 'on' for r in items)} | {full} | {part} | {cover:.0f}% |")
full, part, cover = score(today)
print(f"| **All** | **{len(today)}** | **{sum(r['roam'] == 'on' for r in today)}** | **{sum(r['obsidian'] == 'on' for r in today)}** | **{full}** | **{part}** | **{cover:.0f}%** |")

default_on = [r for r in today if "on" in (r["roam"], r["obsidian"])]
both = [r for r in today if r["roam"] == "on" and r["obsidian"] == "on"]
print()
for label, items in [
    ("On by default in either plugin", default_on),
    ("On by default in both plugins", both),
    ("Only in Roam", [r for r in today if r["roam"] != "none" and r["obsidian"] == "none"]),
    ("Only in Obsidian", [r for r in today if r["obsidian"] != "none" and r["roam"] == "none"]),
    ("Behind a flag in every plugin that has it", [r for r in today if "on" not in (r["roam"], r["obsidian"])]),
]:
    full, part, cover = score(items)
    print(f"{label}: {len(items)} capabilities, {full} full, {part} part, {cover:.0f}%")
print("New in ours:", len(mine), collections.Counter(r["ours"] for r in mine))
