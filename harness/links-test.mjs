// Relations mirrored into Obsidian's own links, in real Obsidian.
//   npm run build:test, then: node harness/links-test.mjs
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const t = await session({ out: resolve("reports/links") });
const { s, call, check, until } = t;
await s("s.test(true)");
await s("s.closeAll()");
const stamp = String(Date.now()).slice(-6);
const grammar = await call("grammar.get", {});
const typeOf = (base) => grammar.nodeTypes.find((type) => type.base === base).id;
const claim = await call("node.create", { title: `Mirror claim ${stamp}`, type: typeOf("claim") });
const evidence = await call("node.create", { title: `Mirror evidence ${stamp}`, type: typeOf("evidence") });
const pathOf = async (fragment) => (await s(`s.searchBase(${q(fragment)})`))[0];
const links = async (fragment) => s(`s.noteLinks(${q(await pathOf(fragment))})`);
const [option] = await call("relation.options", { source: evidence.id, target: claim.id });
const type = grammar.relationTypes.find((item) => item.id === option.type);
const made = await call("relation.assert", { type: type.id, source: evidence.id, target: claim.id });
const listed = (note, key) => note?.frontmatter?.[key] ?? [];

check("links.source-note-carries-the-relation", await until(async () => listed(await links(`Mirror evidence ${stamp}`), type.label).length === 1, 6000), JSON.stringify((await links(`Mirror evidence ${stamp}`))?.frontmatter));
const target = await links(`Mirror claim ${stamp}`);
check("links.target-note-carries-the-other-wording", listed(target, type.complement).length === 1, JSON.stringify(target?.frontmatter));
const claimPath = await pathOf(`Mirror claim ${stamp}`);
const evidencePath = await pathOf(`Mirror evidence ${stamp}`);
check("links.obsidian-resolves-both-ways", await until(async () => (await links(`Mirror evidence ${stamp}`)).out.includes(claimPath) && (await links(`Mirror claim ${stamp}`)).out.includes(evidencePath), 6000), JSON.stringify(await links(`Mirror evidence ${stamp}`)));
check("links.id-stays", Boolean((await links(`Mirror claim ${stamp}`)).frontmatter["dg-id"]));

// Renaming a unit renames its note, and the link on the other note follows.
await call("node.rename", { id: claim.id, title: `Mirror claim renamed ${stamp}` });
const renamedPath = () => pathOf(`Mirror claim renamed ${stamp}`);
check("links.follow-a-rename", await until(async () => { const note = await links(`Mirror evidence ${stamp}`); const path = await renamedPath(); return Boolean(path) && note.out.includes(path) && String(listed(note, type.label)[0]).includes("renamed"); }, 8000), JSON.stringify(await links(`Mirror evidence ${stamp}`)));

// A hand edit is put back on the next change.
await s(`s.setProperty(${q(evidencePath)}, ${q(type.label)}, null)`);
await sleep(1200);
const third = await call("node.create", { title: `Mirror other ${stamp}`, type: typeOf("claim") });
check("links.hand-edit-is-put-back", await until(async () => listed(await links(`Mirror evidence ${stamp}`), type.label).length === 1, 6000), JSON.stringify((await links(`Mirror evidence ${stamp}`))?.frontmatter));
// A property of the same name that holds something else is the person's.
const otherPath = await pathOf(`Mirror other ${stamp}`);
await s(`s.setProperty(${q(otherPath)}, ${q(type.label)}, "my own words")`);
await call("relation.assert", { type: type.id, source: evidence.id, target: third.id });
await until(async () => listed(await links(`Mirror evidence ${stamp}`), type.label).length === 2, 6000);
check("links.two-targets-listed", listed(await links(`Mirror evidence ${stamp}`), type.label).length === 2);
check("links.own-property-is-left", (await links(`Mirror other ${stamp}`)).frontmatter[type.label] === "my own words", JSON.stringify((await links(`Mirror other ${stamp}`)).frontmatter));

// Withdrawing the relation clears both notes.
await call("relation.withdraw", { id: made.id });
check("links.withdrawn-relation-goes", await until(async () => listed(await links(`Mirror evidence ${stamp}`), type.label).length === 1 && listed(await links(`Mirror claim renamed ${stamp}`), type.complement).length === 0, 6000), JSON.stringify((await links(`Mirror claim renamed ${stamp}`))?.frontmatter));
const context = await call("node.view", { id: claim.id });
check("links.not-doubled-as-mentions", !context.mentionedIn.some(({ title }) => title.includes("Mirror evidence")), JSON.stringify(context.mentionedIn));
process.exit(await t.finish("links"));
