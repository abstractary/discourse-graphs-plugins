"""Classifies every host call in the Roam and Obsidian plugins against the contract.

A text search of call sites, so counts are approximate. Anything not matched by a
rule is printed as UNCLASSIFIED, which is what keeps the coverage claim honest.
"""
import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "../discourse-graph")

READ = "read: listText, readText, searchText, listBacklinks, listRecords"
WRITE = "write: createText, renameText, pinText, putRecords"
WATCH = "watch: subscribe"
NAV = "navigate: getFocus, reveal, insertLink, openSurface"
WHO = "identify: describe"
ASSET = "assets: readAsset, writeAsset"
LOCAL = "local: getLocal, setLocal"
PRIVATE = "adapter private"
NATIVE = "native UI, stays in adapter"
SURFACE = "replaced by a surface"
DROPPED = "not carried over"

ROAM_RULES = [
    (r"^(q|pull|data(\.fast)?(\.q)?|data\.backend\.q|data\.async(\.fast)?\.(q|pull)|data\.fast)$", READ),
    (r"^queries/(getCurrentUser|getPageViewType)", WHO),
    (r"^queries/", READ),
    (r"^writes/openBlockInSidebar", NAV),
    (r"^writes/", WRITE),
    (r"^(createBlock|updateBlock|deleteBlock|moveBlock|updatePage|deletePage)$", WRITE),
    (r"^data\.(block|page)(\.(create|update|delete))?$", WRITE),
    (r"^data\.(addPullWatch|removePullWatch)$", WATCH),
    (r"^ui\.(mainWindow|rightSidebar)(\.|$)", NAV),
    (r"^ui\.(getFocusedBlock|setBlockFocusAndSelection)$", NAV),
    (r"^(user\.uid|graph\.(name|type|isEncrypted)|platform)$", WHO),
    (r"^(file\.(upload|get)|util\.uploadFile)$", ASSET),
    (r"^util\.(generateUID|dateToPageTitle|pageTitleToDate|dateToPageUid)$", PRIVATE),
    (r"^ui\.(blockContextMenu|graphView|components|react|slashCommand|commandPalette)(\.|$)", NATIVE),
    (r"^ui$|^data$", PRIVATE),
    (r"^data\.(semanticSearchEnabled|async\.semanticSearch)$", DROPPED),
]

OBSIDIAN_RULES = [
    (r"^metadataCache\.(getFileCache)$", READ),
    (r"^vault\.(getAbstractFileByPath|getFileByPath|getFolderByPath|getFiles|getMarkdownFiles|getAllFolders|read|cachedRead)$", READ),
    (r"^(metadataCache\.(getFirstLinkpathDest|fileToLinktext)|fileManager\.generateMarkdownLink)$", PRIVATE),
    (r"^vault\.adapter$|^vault$|^metadataCache$|^workspace$", PRIVATE),
    (r"^(vault|metadataCache|workspace)\.(on|off|offref)$", WATCH),
    (r"^plugin\.registerEvent$", WATCH),
    (r"^fileManager\.(processFrontMatter|renameFile)$", WRITE),
    (r"^vault\.(create|createFolder|append|modify|process|delete)$", WRITE),
    (r"^vault\.(getResourcePath|readBinary|createBinary|modifyBinary)$", ASSET),
    (r"^vault\.getName$", WHO),
    (r"^workspace\.(getActiveViewOfType|getActiveFile|setActiveLeaf|openLinkText|getLeaf|getRightLeaf|revealLeaf|getLeavesOfType|iterateAllLeaves|rightSplit)$", NAV),
    (r"^plugin\.registerView$", NAV),
    (r"^workspace\.(onLayoutReady|updateOptions)$", NATIVE),
    (r"^(setting\.|keymap)", NATIVE),
    (r"^plugin\.(addCommand|addRibbonIcon|addStatusBarItem|addSettingTab|addAction|registerEditorExtension|registerMarkdownPostProcessor|registerDomEvent|registerDismissListeners|register)$", NATIVE),
    (r"^plugin\.(loadData|saveData)$", LOCAL),
]


def sources(app):
    for path in (ROOT / "apps" / app / "src").rglob("*"):
        if path.suffix in {".ts", ".tsx"} and "__tests__" not in path.parts:
            if ".example." not in path.name:
                yield path.read_text(encoding="utf-8")


def roam_calls():
    for text in sources("roam"):
        yield from re.findall(r"roamAlphaAPI\.((?:[a-zA-Z]+\.?)+)", text)
        yield from re.findall(r"roamjs-components/((?:queries|writes)/[a-zA-Z]+)", text)


def obsidian_calls():
    for text in sources("obsidian"):
        for match in re.findall(r"\bapp\.(vault|metadataCache|workspace|fileManager|setting|keymap)(?:\.([a-zA-Z]+))?", text):
            yield ".".join(part for part in match if part)
        for name in re.findall(r"\b(?:plugin|this)\.(register[A-Za-z]*|add[A-Z][A-Za-z]*|loadData|saveData)\b", text):
            yield f"plugin.{name}"


def report(name, calls, rules):
    totals = collections.Counter()
    unclassified = collections.Counter()
    for call in calls:
        call = call.rstrip(".")
        for pattern, category in rules:
            if re.search(pattern, call):
                totals[category] += 1
                break
        else:
            unclassified[call] += 1
    count = sum(totals.values()) + sum(unclassified.values())
    print(f"\n{name}: {count} call sites")
    for category, total in totals.most_common():
        print(f"  {total:5d}  {category}")
    print(f"  {sum(unclassified.values()):5d}  UNCLASSIFIED {dict(unclassified)}")


report("Roam", roam_calls(), ROAM_RULES)
report("Obsidian", obsidian_calls(), OBSIDIAN_RULES)
