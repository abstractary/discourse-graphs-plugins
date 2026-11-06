"""Counts this repository's code, for docs/COMPARISON.md. Run from the repository root."""
import os
import re

EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"}
SKIP = {"node_modules", "dist", "data"}
SHARED = ["packages/contract", "packages/core", "packages/layout", "packages/sync", "packages/native", "packages/surfaces"]
ADAPTERS = ["plugins/obsidian", "plugins/roam"]


def code_lines(path):
    code, block = 0, False
    for raw in open(path, encoding="utf8", errors="ignore"):
        line = raw.strip()
        if not line:
            continue
        if block:
            block = "*/" not in line
            continue
        if line.startswith("//"):
            continue
        if line.startswith("/*"):
            block = "*/" not in line
            continue
        code += 1
    return code


def files(root):
    for folder, dirs, names in os.walk(root):
        dirs[:] = [name for name in dirs if name not in SKIP]
        for name in names:
            if os.path.splitext(name)[1] in EXT:
                yield os.path.join(folder, name)


def is_test_code(path):
    return "/test/" in path or path.startswith("test/") or path.endswith("testing.ts") or path.endswith("conformance.ts") or path.endswith("memory-host.ts")


product = {}
test = 0
for root in SHARED + ADAPTERS:
    for path in files(os.path.join(root, "src")):
        if is_test_code(path):
            test += code_lines(path)
        else:
            product[path] = code_lines(path)
for root in ["test", "harness"]:
    test += sum(code_lines(path) for path in files(root))

shared = sum(lines for path, lines in product.items() if any(path.startswith(root) for root in SHARED))
total = sum(product.values())
server = {path: code_lines(path) for path in files("server/src")}
server_tests = sum(code_lines(path) for path in files("server/test"))
anys = sum(len(re.findall(r":\s*any\b|\bas any\b|<any>", open(path, encoding="utf8").read())) for path in product if path.endswith((".ts", ".tsx")))
disables = sum(open(path, encoding="utf8").read().count("eslint-disable") for path in product)

print(f"Plugins: {total} lines in {len(product)} files, {shared / total:.0%} shared")
print(f"Over 500 lines: {sum(lines > 500 for lines in product.values())}")
print(sorted(((lines, path) for path, lines in product.items()), reverse=True)[:6])
print(f"Test code: {test}, {test / total:.0%} of product")
print(f"Server: {sum(server.values())} lines in {len(server)} files, {server_tests} lines of tests")
print(f"any per 1,000: {anys / total * 1000:.1f}; eslint-disable per 1,000: {disables / total * 1000:.1f}")
