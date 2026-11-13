// Four people, four vaults, one lab server: what holds and what breaks when they work together.
//   node harness/four-vaults.ts            the scripted story, then a random walk
//   node harness/four-vaults.ts --seed 7   the same, with another walk
//   node harness/four-vaults.ts --steps 400
// Nothing leaves this process. The report goes to reports/four-vaults.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { canonicalJson, foldRecords, versionKey, type DgRecord } from "@dg/contract/records.ts";
import { signRecord } from "@dg/core/signing.ts";
import type { DgId } from "@dg/contract/records.ts";
import { chance, GROUP_FILE, LAB_GROUP, openWorld, ZOTERO_FILE, zoteroWith, type Vault, type World } from "./vaults/world.ts";

const { values: flags } = parseArgs({ options: { seed: { type: "string", default: "1" }, steps: { type: "string", default: "200" } } });
const SEED = Number(flags.seed);
const STEPS = Number(flags.steps);

type Area = "convergence" | "privacy" | "intent" | "liveness" | "membership" | "integrity";
type Probe = { stage: string; area: Area; claim: string; pass: boolean; detail: string };
const probes: Probe[] = [];
let stageName = "";
const expect = (area: Area, claim: string, pass: unknown, detail: unknown = ""): void => {
  const probe = { stage: stageName, area, claim, pass: Boolean(pass), detail: String(detail).slice(0, 400) };
  probes.push(probe);
  console.log(`${probe.pass ? "PASS" : "FAIL"} [${area}] ${claim}${probe.detail ? ` - ${probe.detail}` : ""}`);
};
const stage = async (name: string, work: () => Promise<void>): Promise<void> => {
  stageName = name;
  console.log(`\n== ${name}`);
  try {
    await work();
  } catch (error) {
    expect("integrity", "this part of the story could be played to its end", false, error instanceof Error ? error.message : error);
  }
};

/** Time passes in the world. Nothing waits on the real clock. */
const pause = async (ms = 6): Promise<void> => void (world.time.ms += ms);

const typeOf = async (vault: Vault, base: string): Promise<DgId> => {
  const grammar = await vault.call("grammar.get", {});
  const found = grammar.nodeTypes.find((type) => type.base === base && !type.removed);
  if (!found) throw new Error(`${vault.name} has no ${base} type.`);
  return found.id;
};
const relationOf = async (vault: Vault, label: string): Promise<DgId> => {
  const grammar = await vault.call("grammar.get", {});
  const found = grammar.relationTypes.find((type) => type.label.toLowerCase() === label && !type.removed);
  if (!found) throw new Error(`${vault.name} has no "${label}" relation.`);
  return found.id;
};
const unit = async (vault: Vault, title: string, base: string) => vault.call("node.create", { title, type: await typeOf(vault, base) });
const card = async (vault: Vault, canvas: DgId, node: { id: DgId; title: string }, x: number, y = 0): Promise<DgId> => {
  const { ids } = await vault.call("canvas.write", { canvas, upserts: [{ z: Math.round(x / 10) + 1, item: { type: "text", text: node.title, x, y, width: 240, height: 90, dg: { node: node.id } } as never }] });
  return ids[0]!;
};
const move = async (vault: Vault, canvas: DgId, item: DgId, x: number, y: number): Promise<void> => {
  const view = await vault.call("canvas.open", { id: canvas });
  const held = view.items.find((entry) => entry.id === item);
  if (!held) throw new Error(`${vault.name} doesn't hold that card.`);
  const { id: _id, ...rest } = held.item as { id?: string };
  await vault.call("canvas.write", { canvas, upserts: [{ id: item, z: held.z, item: { ...rest, x, y } as never }] });
};
const placeOf = async (vault: Vault, canvas: DgId, item: DgId): Promise<string> => {
  const view = await vault.call("canvas.open", { id: canvas });
  const held = view.items.find((entry) => entry.id === item);
  return held ? `${(held.item as { x?: number }).x},${(held.item as { y?: number }).y}` : "gone";
};

type Digest = { units: string[]; relations: string[]; cards: string[] };
/** What a person sees on a canvas, in words, so two people's views can be compared. */
const digest = async (vault: Vault, canvas: DgId): Promise<Digest | null> => {
  try {
    const view = await vault.call("canvas.open", { id: canvas });
    const title = (id: DgId): string => view.nodes[id]?.title ?? `(missing ${id.slice(-6)})`;
    return {
      units: Object.values(view.nodes).map((node) => `${node.title} | ${node.base ?? "no type"} | ${node.credit.name}`).sort(),
      relations: Object.values(view.relations).map((relation) => `${title(relation.source)} -[${relation.label}, ${relation.state}]-> ${title(relation.target)}`).sort(),
      cards: view.items.flatMap((entry) => {
        const held = entry.item as { dg?: { node?: DgId }; x?: number; y?: number };
        return held.dg?.node ? [`${title(held.dg.node)} @ ${held.x},${held.y}`] : [];
      }).sort(),
    };
  } catch {
    return null;
  }
};
const differ = (a: Digest | null, b: Digest | null): string => {
  if (!a || !b) return !a && !b ? "" : "one of them can't open it";
  const parts = (["units", "relations", "cards"] as const).filter((key) => canonicalJson(a[key]) !== canonicalJson(b[key]));
  if (parts.length === 0) return "";
  const key = parts[0]!;
  const only = (mine: string[], theirs: string[]): string[] => mine.filter((line) => !theirs.includes(line));
  return `${parts.join(", ")} differ. Only the first has: ${JSON.stringify(only(a[key], b[key]).slice(0, 3))}. Only the second has: ${JSON.stringify(only(b[key], a[key]).slice(0, 3))}`;
};
const sameView = async (world: World, names: string[], canvas: DgId, claim: string): Promise<void> => {
  const views = await Promise.all(names.map((name) => digest(world.vault(name), canvas)));
  const faults = views.slice(1).map((view, index) => differ(views[0]!, view)).map((fault, index) => (fault ? `${names[0]} and ${names[index + 1]}: ${fault}` : "")).filter(Boolean);
  expect("convergence", claim, faults.length === 0 && views[0] !== null, faults[0] ?? (views[0] ? `${views[0].units.length} units, ${views[0].relations.length} relations, ${views[0].cards.length} cards` : "nobody can open it"));
};

const sentText = (vault: Vault): string => JSON.stringify(vault.sent.flatMap((entry) => entry.records));
const holds = (vault: Vault, words: string): boolean => JSON.stringify(vault.records()).includes(words);
const sentCount = (vault: Vault): number => vault.sent.reduce((sum, entry) => sum + entry.records.length, 0);

/** Three people doing whatever comes up, on one shared canvas, exchanging with the lab now and then. */
const randomWalk = async (within: World, members: string[], canvas: DgId, steps: number, random: () => number, log: string[]): Promise<number> => {
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];
  let made = 0;
  let refusedHere = 0;
  for (let step = 0; step < steps; step += 1) {
    const vault = within.vault(pick(members)!);
    const roll = random();
    const view = await vault.call("canvas.open", { id: canvas });
    const cards = view.items.filter((entry) => (entry.item as { dg?: { node?: DgId } }).dg?.node);
    const act = async (name: string, work: () => Promise<unknown>): Promise<void> => {
      log.push(`${step + 1}. ${vault.name} ${name}`);
      await work().catch(() => void (refusedHere += 1));
    };
    if (roll < 0.25 || cards.length < 2) {
      made += 1;
      const title = `Walk unit ${made} by ${vault.name}`;
      await act(`adds "${title}"`, async () => card(vault, canvas, await unit(vault, title, pick(["claim", "evidence", "question"])!), Math.floor(random() * 2000), Math.floor(random() * 1000)));
    } else if (roll < 0.5) {
      const held = pick(cards)!;
      await act(`moves a card`, () => move(vault, canvas, held.id, Math.floor(random() * 2000), Math.floor(random() * 1000)));
    } else if (roll < 0.6) {
      const own = pick(Object.values(view.nodes).filter((node) => node.mine));
      if (own) await act(`rewords "${own.title}"`, () => vault.call("node.rename", { id: own.id, title: `${own.title.replace(/ \(v\d+\)$/, "")} (v${step})` }));
    } else if (roll < 0.68) {
      const held = pick(cards)!;
      await act(`takes a card off`, () => vault.call("canvas.write", { canvas, removes: [held.id] }));
    } else if (roll < 0.8) {
      const [a, b] = [pick(Object.values(view.nodes)), pick(Object.values(view.nodes))];
      if (a && b && a.id !== b.id) await act(`links "${a.title}" to "${b.title}"`, async () => vault.call("relation.assert", { type: await relationOf(vault, pick(["supports", "opposes"])!), source: a.id, target: b.id, draw: true }));
    } else if (roll < 0.84) {
      const own = pick(Object.values(view.nodes).filter((node) => node.mine));
      if (own) await act(`removes "${own.title}"`, () => vault.call("node.remove", { id: own.id }));
    } else {
      await act("exchanges with the lab", () => vault.sync());
    }
  }
  return refusedHere;
};

// Mira has Zotero with the lab's group. Tomas has that and a library of his own. Ines and Kofi have no Zotero.
const world = await openWorld([
  { name: "Mira", zotero: zoteroWith({ personal: false, group: LAB_GROUP }) },
  { name: "Tomas", zotero: zoteroWith({ group: LAB_GROUP }) },
  { name: "Ines" },
  { name: "Kofi" },
], { seed: SEED });
const [mira, tomas, ines, kofi] = world.vaults as [Vault, Vault, Vault, Vault];
const LAB = ["Mira", "Tomas", "Ines"];
let labId = "";
let shared = "" as DgId;
const ids: Record<string, DgId> = {};

const online = async <T>(vault: Vault, work: () => Promise<T>): Promise<T> => {
  vault.online = true;
  try {
    return await work();
  } finally {
    vault.online = false;
  }
};
/** The PI hands over one line, and the person who pastes it is in. */
const invite = async (): Promise<string> => (await online(mira, () => mira.call("lab.invite", {}))).invite;
const joinByInvite = async (member: Vault): Promise<void> => {
  const line = await invite();
  await online(member, () => member.call("lab.acceptInvite", { invite: line }));
  await mira.sync();
  await member.sync();
};
/** The older way: ask with the lab's identifier, and wait for the PI to accept. */
const joinByAsking = async (member: Vault): Promise<void> => {
  await online(member, () => member.call("lab.requestJoin", { server: world.server, id: labId }));
  await online(mira, async () => {
    const view = await mira.call("lab.view", {});
    const request = view.requests.find((item) => item.person.name === member.name);
    if (!request) throw new Error(`Mira never saw ${member.name}'s request.`);
    await mira.call("lab.decide", { requestId: request.id, decision: "accept" });
  });
  await mira.sync();
  await online(member, () => member.call("lab.check", {}));
  await member.sync();
};

await stage("1. A lab forms: Mira is the PI, and Tomas joins with her invitation", async () => {
  const made = await online(mira, () => mira.call("lab.register", { server: world.server, name: "Tension Lab" }));
  labId = made.link!.id;
  expect("membership", "the person who starts a lab is its PI", made.custodian && made.link?.role === "admin");
  const line = await invite();
  const wrong = await online(kofi, () => kofi.call("lab.acceptInvite", { invite: `${line.slice(0, -4)}oops` })).then(() => "", (error: Error) => error.message);
  expect("membership", "a wrong invitation is refused, in plain words", wrong.includes("invite") && !/undefined|40\d/.test(wrong), wrong || "it was accepted");
  await online(tomas, () => tomas.call("lab.acceptInvite", { invite: line }));
  const again = await online(kofi, () => kofi.call("lab.acceptInvite", { invite: line })).then(() => "", (error: Error) => error.message);
  expect("membership", "an invitation for one person can't be used by a second", again.includes("invite"), again || "Kofi got in on Tomas's invitation");
  const mine = await online(tomas, () => tomas.call("lab.invite", {})).then(() => "", (error: Error) => error.message);
  expect("membership", "a member can't hand out invitations", mine.includes("PI"), mine || "Tomas made an invitation");
  await mira.sync();
  await tomas.sync();
  const atMira = await online(mira, () => mira.call("lab.view", {}));
  const atTomas = await online(tomas, () => tomas.call("lab.view", {}));
  const names = (view: typeof atMira): string => view.members.map((member) => member.name).sort().join(", ");
  expect("membership", "both members see the same member list", names(atMira) === "Mira, Tomas" && names(atTomas) === names(atMira), `${names(atMira)} / ${names(atTomas)}`);
  expect("membership", "the member's own vault says which lab it is in", atTomas.identity.lab?.name === "Tension Lab", atTomas.identity.lab?.name);
  const refused = await fetch(`${world.server}/v1/labs/${labId}/records`);
  expect("privacy", "the lab's records are refused to someone with no token", refused.status === 401 || refused.status === 403, refused.status);
  const peek = await fetch(`${world.server}/v1/labs/${labId}`).then((response) => response.json() as Promise<{ name?: string }>);
  expect("privacy", "a stranger who has a lab's id learns its name and nothing else", Object.keys(peek).sort().join(",") === "id,name", Object.keys(peek).join(", "));
});

await stage("2. Private work stays on its own device", async () => {
  for (const vault of [mira, tomas, ines, kofi]) {
    const own = await unit(vault, `CANARY-${vault.name} a private thought`, "claim");
    const canvas = await vault.call("canvas.create", { title: `CANARY-${vault.name} private canvas` });
    await card(vault, canvas.id, own, 0);
  }
  await world.settle();
  for (const vault of [mira, tomas, ines, kofi]) {
    expect("privacy", `${vault.name}'s private unit and canvas were never sent`, !sentText(vault).includes(`CANARY-${vault.name}`));
    const others = world.vaults.filter((other) => other !== vault && holds(other, `CANARY-${vault.name}`)).map((other) => other.name);
    expect("privacy", `nobody else holds ${vault.name}'s private work`, others.length === 0, others.join(", "));
  }
});

await stage("3. Mira shares a canvas, and Tomas gets it whole", async () => {
  const canvas = await mira.call("canvas.create", { title: "Does actin follow tension?" });
  shared = canvas.id;
  const question = await unit(mira, "Does actin assembly follow membrane tension?", "question");
  const claim = await unit(mira, "Actin assembly rises with membrane tension", "claim");
  const evidence = await unit(mira, "Actin intensity doubled under high tension", "evidence");
  const hidden = await unit(mira, "CANARY-Mira unpublished pilot that cuts the other way", "evidence");
  Object.assign(ids, { question: question.id, claim: claim.id, evidence: evidence.id, hidden: hidden.id });
  ids.questionCard = await card(mira, shared, question, 0);
  ids.claimCard = await card(mira, shared, claim, 320);
  ids.evidenceCard = await card(mira, shared, evidence, 640);
  await mira.call("relation.assert", { type: await relationOf(mira, "supports"), source: evidence.id, target: claim.id, draw: true });
  await mira.call("relation.assert", { type: await relationOf(mira, "addresses"), source: claim.id, target: question.id, draw: true });
  // Her own doubt about the claim, kept off the canvas.
  await mira.call("relation.assert", { type: await relationOf(mira, "opposes"), source: hidden.id, target: claim.id });
  await mira.call("canvas.share", { id: shared });
  await world.settle(["Mira", "Tomas"]);

  await sameView(world, ["Mira", "Tomas"], shared, "Tomas sees the shared canvas as Mira does");
  const view = await tomas.call("canvas.open", { id: shared });
  const states = Object.values(view.relations).map((relation) => relation.state);
  expect("intent", "a labmate's relations arrive as settled, not as proposals to approve", states.length === 2 && states.every((state) => state === "active"), states.join(", "));
  expect("intent", "the claim arrives credited to Mira", view.nodes[claim.id]?.credit.name === "Mira", JSON.stringify(view.nodes[claim.id]?.credit));
  expect("privacy", "evidence Mira kept off the canvas, and its link to the shared claim, were not sent", !sentText(mira).includes("CANARY-Mira"));
  const grammar = await tomas.call("grammar.get", {});
  const labels = grammar.nodeTypes.filter((type) => !type.removed).map((type) => type.label);
  const twice = labels.filter((label, index) => labels.indexOf(label) !== index);
  expect("integrity", "after syncing, Tomas has each kind of unit once", twice.length === 0, `twice: ${[...new Set(twice)].join(", ")}`);
  const all = [...tomas.core.graph().documents.values()].filter((record) => record.kind === "node-type" && !(record as { removed?: boolean }).removed).map((record) => (record as { label: string }).label);
  const doubled = all.filter((label, index) => all.indexOf(label) !== index);
  expect("integrity", "Tomas's vault has one type in use for each kind of unit: the lab's", doubled.length === 0, `${all.length} type records in use; twice: ${[...new Set(doubled)].join(", ")}`);
  const labClaim = await typeOf(mira, "claim");
  expect("integrity", "the lab's Claim is the one Tomas now makes claims with", (await typeOf(tomas, "claim")) === labClaim);
  const earlier = (await tomas.call("node.query", { text: "CANARY-Tomas", limit: 1 }))[0];
  expect("integrity", "a claim Tomas made before joining now reads as the lab's Claim", earlier?.typeLabel === "Claim" && earlier.base === "claim", `${earlier?.typeLabel} / ${earlier?.base}`);
});

await stage("4. Tomas adds to Mira's canvas", async () => {
  const counter = await unit(tomas, "Actin assembly is flat above a tension threshold", "claim");
  ids.counter = counter.id;
  ids.counterCard = await card(tomas, shared, counter, 320, 200);
  const made = await tomas.call("relation.assert", { type: await relationOf(tomas, "opposes"), source: counter.id, target: ids.claim!, draw: true });
  ids.opposes = made.id;
  await world.settle(["Tomas", "Mira"]);
  await sameView(world, ["Mira", "Tomas"], shared, "Mira sees what Tomas added to her canvas");
  const view = await mira.call("canvas.open", { id: shared });
  expect("intent", "Tomas's claim arrives credited to Tomas", view.nodes[counter.id]?.credit.name === "Tomas", JSON.stringify(view.nodes[counter.id]?.credit));
  const relation = Object.values(view.relations).find((item) => item.source === counter.id);
  expect("intent", "Tomas's \"opposes\" reaches Mira, drawn on the canvas", Boolean(relation), relation ? relation.state : "Mira has no such relation on the canvas");
  const second = await tomas.call("relation.assert", { type: await relationOf(tomas, "supports"), source: counter.id, target: ids.question!, draw: true }).catch(() => null);
  if (second) {
    await world.settle(["Tomas", "Mira"]);
    await tomas.call("relation.withdraw", { id: second.id });
    await world.settle(["Tomas", "Mira"]);
    const state = mira.core.graph().relations.get(second.id)?.state;
    expect("intent", "a relation Tomas takes back is taken back for Mira too", state === "withdrawn", `Mira has it as ${state}`);
  }
  const refused = await tomas.call("node.rename", { id: ids.claim!, title: "Tomas rewrote this" }).then(() => "", (error: Error) => error.message);
  expect("intent", "Tomas can't reword Mira's claim", refused.includes("Only Mira"), refused || "it was allowed");
});

await stage("5. Two people change the same thing while apart", async () => {
  // Same card, moved once each. Tomas moves it last.
  await move(mira, shared, ids.questionCard!, 0, 400);
  await pause();
  await move(tomas, shared, ids.questionCard!, 0, 800);
  await world.settle(["Mira", "Tomas"]);
  const [atMira, atTomas] = [await placeOf(mira, shared, ids.questionCard!), await placeOf(tomas, shared, ids.questionCard!)];
  expect("convergence", "after two moves of one card, both see it in the same place", atMira === atTomas, `${atMira} / ${atTomas}`);
  expect("intent", "the later move is the one that stands", atMira === "0,800", atMira);

  // Mira nudges a card twice, then Tomas moves it once, later.
  await move(mira, shared, ids.evidenceCard!, 650, 0);
  await move(mira, shared, ids.evidenceCard!, 660, 0);
  await pause();
  await move(tomas, shared, ids.evidenceCard!, 640, 600);
  await world.settle(["Mira", "Tomas"]);
  const [twiceMira, twiceTomas] = [await placeOf(mira, shared, ids.evidenceCard!), await placeOf(tomas, shared, ids.evidenceCard!)];
  expect("convergence", "after two nudges against one later move, both see the card in the same place", twiceMira === twiceTomas, `${twiceMira} / ${twiceTomas}`);
  expect("intent", "the later move stands, however many earlier nudges the other person made", twiceMira === "640,600", `it sits at ${twiceMira}; Mira's two earlier nudges outvoted Tomas's later move`);

  // Tomas's computer is a day behind. It has exchanged with the lab since, and he moves the card after Mira does.
  tomas.skewMs = -86_400_000;
  await tomas.sync();
  await move(mira, shared, ids.claimCard!, 320, 50);
  await pause();
  await move(tomas, shared, ids.claimCard!, 320, 700);
  await world.settle(["Mira", "Tomas"]);
  const [skewMira, skewTomas] = [await placeOf(mira, shared, ids.claimCard!), await placeOf(tomas, shared, ids.claimCard!)];
  if (process.env.DG_DEBUG) console.log(tomas.records().filter((record) => record.id === ids.claimCard).map((record) => { const r = record as unknown as { rev: number; editedAt: string; editedBy: { name: string }; prev?: string }; return `${r.rev} ${r.editedAt} ${r.editedBy.name} prev=${r.prev}`; }));
  expect("convergence", "with one clock a day slow, both still see the card in the same place", skewMira === skewTomas, `${skewMira} / ${skewTomas}`);
  expect("intent", "a slow clock doesn't make a person's later move lose", skewMira === "320,700", `it sits at ${skewMira}; the move made on the slow computer was dropped`);
  tomas.skewMs = 0;
  await tomas.sync();

  // Mira takes Tomas's card off the canvas while he is moving it.
  await mira.call("canvas.write", { canvas: shared, removes: [ids.counterCard!] });
  await pause();
  await move(tomas, shared, ids.counterCard!, 330, 260);
  await world.settle(["Mira", "Tomas"]);
  const [goneMira, goneTomas] = [await placeOf(mira, shared, ids.counterCard!), await placeOf(tomas, shared, ids.counterCard!)];
  expect("convergence", "a card removed by one and moved by the other ends the same for both", goneMira === goneTomas, `${goneMira} / ${goneTomas}`);
  console.log(`     (it ended as: ${goneMira})`);
  await world.settle(["Mira", "Tomas"]);
  expect("convergence", "and it stays that way on the next exchange", (await placeOf(mira, shared, ids.counterCard!)) === goneMira && (await placeOf(tomas, shared, ids.counterCard!)) === goneMira);

  // Mira removes her evidence while Tomas builds on it.
  const follow = await unit(tomas, "The doubling holds in a second cell line", "evidence");
  ids.follow = follow.id;
  await card(tomas, shared, follow, 960, 0);
  await mira.call("node.remove", { id: ids.evidence! });
  await tomas.call("relation.assert", { type: await relationOf(tomas, "supports"), source: follow.id, target: ids.evidence!, draw: true }).catch(() => null);
  await world.settle(["Mira", "Tomas"]);
  await sameView(world, ["Mira", "Tomas"], shared, "a unit removed by its author while a labmate links to it ends the same for both");
  const view = await tomas.call("canvas.open", { id: shared });
  const dangling = Object.values(view.relations).filter((relation) => !view.nodes[relation.source] || !view.nodes[relation.target]);
  expect("integrity", "no relation on the canvas points at a unit that is gone", dangling.length === 0, `${dangling.length} dangling`);
  const kept = [...tomas.core.graph().relations.values()].filter(({ record, state }) => state === "active" && record.target === ids.evidence);
  expect("intent", "Tomas is told that the evidence he built on was removed", kept.length === 0, `${kept.length} of his relations still stand on a removed unit, with nothing said`);
});

await stage("6. Ines joins late", async () => {
  await joinByAsking(ines);
  await world.settle(LAB);
  await sameView(world, LAB, shared, "Ines, joining after the work was done, sees what the others see");
  const view = await online(ines, () => ines.call("lab.view", {}));
  expect("membership", "Ines sees all three members", view.members.length === 3, view.members.map((member) => member.name).join(", "));
  const leaked = ["Mira", "Tomas", "Kofi"].filter((name) => holds(ines, `CANARY-${name}`));
  expect("privacy", "Ines received none of the others' private work", leaked.length === 0, leaked.join(", "));
});

await stage("6b. What the PI sets, every member inherits", async () => {
  const offered = await mira.call("zotero.groups", {});
  expect("intent", "Mira is offered her Zotero groups to choose the lab's shelf from", offered.some((group) => group.id === String(LAB_GROUP.id) && group.name === LAB_GROUP.name), JSON.stringify(offered));
  expect("intent", "Ines, with no Zotero, is offered none, and nothing breaks", (await ines.call("zotero.groups", {})).length === 0);
  const settings = {
    zoteroGroup: { id: String(LAB_GROUP.id), name: LAB_GROUP.name },
    servers: [{ name: "Mira's workstation", url: "http://10.0.0.5:8787" }],
    compute: "http://10.0.0.5:8787",
    reach: "lab" as const,
  };
  await mira.call("lab.configure", settings);
  const hypothesis = await mira.call("grammar.saveNodeType", { label: "Hypothesis", base: "claim", abbreviation: "HYP" });
  await world.settle(LAB);
  for (const member of [tomas, ines]) {
    const view = await online(member, () => member.call("lab.view", {}));
    expect("membership", `${member.name} has the lab's settings as Mira set them`, canonicalJson(view.settings) === canonicalJson(settings), JSON.stringify(view.settings));
    const servers = await member.call("server.list", {});
    expect("intent", `${member.name}'s list of model servers now offers the lab's`, servers.some((server) => server.kind === "lab" && server.name === "Mira's workstation"), servers.map((server) => `${server.name} (${server.kind})`).join(", "));
    const grammar = await member.call("grammar.get", {});
    expect("intent", `${member.name} can use the type Mira added to the lab's grammar`, grammar.nodeTypes.some((type) => type.id === hypothesis.id));
  }
  const cant = await tomas.call("lab.configure", { reach: "anywhere" }).then(() => "", (error: Error) => error.message);
  expect("membership", "a member can't change what the lab sets for everyone", cant.includes("PI"), cant || "Tomas changed it");
  const claimType = await typeOf(mira, "claim");
  const meddle = await tomas.call("grammar.saveNodeType", { id: claimType, label: "Assertion", base: "claim" }).then(() => "", (error: Error) => error.message);
  expect("membership", "a member can't change the lab's own types", meddle.includes("Only Mira"), meddle || "Tomas renamed the lab's Claim");
  const own = await tomas.call("grammar.saveNodeType", { label: "Hunch", base: "claim", abbreviation: "HUN" });
  await world.settle(LAB);
  expect("intent", "a member can still add a type of their own beside the lab's", (await tomas.call("grammar.get", {})).nodeTypes.some((type) => type.id === own.id));
  await mira.call("lab.configure", { reach: "device", compute: null });
  await world.settle(LAB);
  const later = (await online(ines, () => ines.call("lab.view", {}))).settings;
  expect("membership", "when Mira changes a setting later, members get the change", later.reach === "device" && later.compute === undefined, JSON.stringify(later));
});

await stage("6c. Mira opens her vault on a second computer", async () => {
  const laptop = await world.openDevice("Mira", "Mira's laptop");
  expect("membership", "the second computer knows it is Mira's", laptop.did() === mira.did(), `${laptop.did()} / ${mira.did()}`);
  const asking = (await laptop.call("device.list", {})).find((device) => device.here);
  expect("integrity", "it has a key of its own, and waits to be let in", asking?.state === "waiting", JSON.stringify(asking));
  await online(laptop, async () => laptop.call("lab.acceptInvite", { invite: await invite() }));
  const early = await unit(laptop, "A claim Mira made on her laptop", "claim");
  const earlyCard = await card(laptop, shared, early, 0, 900);
  await laptop.sync();
  await world.settle(["Mira", "Tomas"]);
  expect("integrity", "until it is let in, it sends nothing, so nothing of it is refused and lost", sentCount(laptop) === 0 && !holds(tomas, "made on her laptop"), `sent ${sentCount(laptop)}`);
  expect("membership", "and its own lab panel says it is waiting", (await online(laptop, () => laptop.call("lab.view", {}))).deviceTrusted === false);

  // The vault's files reach her first computer, with the last line still half written.
  await world.fileSync(laptop, mira, "torn");
  await world.fileSync(laptop, mira);
  const request = (await mira.call("device.list", {})).find((device) => device.state === "waiting");
  expect("membership", "her first computer shows the laptop asking", Boolean(request) && request!.fingerprint === asking?.fingerprint, JSON.stringify(request));
  const selfServe = await laptop.call("device.approve", { id: request!.id }).then(() => "", (error: Error) => error.message);
  expect("integrity", "the laptop can't let itself in", selfServe.includes("already trusted"), selfServe || "it approved itself");
  const forgedAsk = await tomas.call("device.list", {});
  expect("integrity", "a labmate is never offered Mira's device to approve", !forgedAsk.some((device) => device.fingerprint === asking?.fingerprint));
  await mira.call("device.approve", { id: request!.id });

  // Back to the laptop through a sync tool that repeats part of the file, then one that joins two copies with markers.
  await world.fileSync(mira, laptop, "doubled");
  const joined = await world.fileSync(mira, laptop, "joined");
  await world.fileSync(mira, laptop, "crlf");
  expect("integrity", "a log a sync tool repeated, joined and marked still loads, and the bad lines are skipped", joined.skipped > 0 && (await laptop.call("device.list", {})).find((device) => device.here)?.state === "trusted", `skipped ${joined.skipped}`);
  await laptop.sync();
  await world.settle(LAB);
  const seen = await tomas.call("canvas.open", { id: shared });
  expect("intent", "once let in, what Mira made on her laptop reaches Tomas, as Mira's", seen.nodes[early.id]?.credit.name === "Mira", JSON.stringify(seen.nodes[early.id]?.credit ?? null));

  // Mira moves the same card on both computers before they have synced. Then everything catches up.
  await move(mira, shared, earlyCard, 50, 900).catch(() => undefined);
  await pause();
  await move(laptop, shared, earlyCard, 90, 950);
  await world.fileSync(mira, laptop);
  await world.settle([...LAB, "Mira's laptop"]);
  await world.fileSync(mira, laptop);
  const places = await Promise.all([mira, laptop, tomas].map((vault) => placeOf(vault, shared, earlyCard)));
  expect("convergence", "one person on two computers, then the lab: all end the same, with the later move", places.every((place) => place === "90,950"), places.join(" / "));
  await sameView(world, [...LAB, "Mira's laptop"], shared, "her two computers and her labmates see the same canvas");

  // She loses the laptop and takes it out. It doesn't hear of that, and goes on writing.
  await mira.call("device.remove", { id: request!.id });
  await world.settle(LAB);
  const after = await unit(laptop, "Written on the laptop after it was taken out", "claim");
  await card(laptop, shared, after, 0, 1000);
  await laptop.sync().catch(() => undefined);
  await world.settle(LAB);
  expect("integrity", "what a removed device signs is refused by her labmates", !holds(tomas, "after it was taken out") && !holds(ines, "after it was taken out"));
  expect("intent", "what it wrote while it was trusted still stands", (await tomas.call("canvas.open", { id: shared })).nodes[early.id]?.title === "A claim Mira made on her laptop");
});

await stage("7. Ines checks Mira's claim", async () => {
  await ines.call("unit.check", { unit: ids.claim!, verdict: "checked", way: "dataReanalyzed", note: "Reran the fits" });
  await world.settle(LAB);
  const atMira = await mira.call("node.view", { id: ids.claim! });
  expect("intent", "Mira sees that Ines checked her claim", atMira.checks?.some((check) => check.credit.name === "Ines" && !check.mine), `Mira sees ${atMira.checks?.length ?? 0} checks`);
  await mira.call("node.rename", { id: ids.claim!, title: "Actin assembly rises with membrane tension up to a threshold" });
  await world.settle(LAB);
  const atInes = await ines.call("node.view", { id: ids.claim! });
  expect("intent", "after Mira rewords it, Ines sees her check is on the old wording", atInes.node.checked === "changed", `Ines sees: ${atInes.node.checked}, title "${atInes.node.title}"`);
  const atTomas = await tomas.call("node.view", { id: ids.claim! });
  expect("intent", "Tomas, a third person, sees the claim was checked and then changed", atTomas.node.checked === "changed", `Tomas sees: ${atTomas.node.checked}`);
});

await stage("8. Tomas brings evidence from a paper in his Zotero", async () => {
  await tomas.call("prefs.set", { zoteroLibrary: true });
  const cut = await tomas.call("pdf.cut", { ref: ZOTERO_FILE, exact: "the smallest testing error", page: 3, title: "The smallest testing error is at the edge of chaos", type: await typeOf(tomas, "evidence"), canvas: shared });
  ids.cut = cut.node.id;
  await world.settle(LAB);
  await sameView(world, LAB, shared, "the evidence Tomas highlighted reaches everyone's canvas");
  const mine = await tomas.call("node.view", { id: cut.node.id });
  const theirs = await mira.call("node.view", { id: cut.node.id }).catch(() => null);
  expect("intent", "Tomas sees which paper it came from", Boolean(mine.node.paper?.label ?? mine.node.card.source), JSON.stringify(mine.node.paper?.label ?? mine.node.card.source ?? null));
  expect("intent", "Mira sees which paper Tomas's evidence came from", Boolean(theirs?.node.paper?.label ?? theirs?.node.card.source), theirs ? `her card's source: ${JSON.stringify(theirs.node.card.source ?? null)}` : "she can't open the unit");
  const sourceId = (tomas.core.graph().documents.get(cut.node.id) as { prov?: { sourceDocument?: DgId } }).prov?.sourceDocument;
  expect("integrity", "the source unit the evidence rests on travelled with it", Boolean(sourceId && mira.core.graph().documents.get(sourceId)), sourceId ? "Mira holds the evidence but not its source" : "the evidence names no source");
  expect("intent", "Mira is not shown a Zotero mark for a paper that is in Tomas's library, not hers", !theirs?.node.card.library && !theirs?.node.paper?.library);
  expect("privacy", "the place of the file on Tomas's computer was not sent", !sentText(tomas).includes("/Users/reader"));
  const opened = await mira.call("pdf.open", { ref: ZOTERO_FILE }).then(() => "opened", (error: Error) => error.message);
  expect("intent", "when Mira asks for the passage, she is told plainly that the PDF is not on her computer", opened !== "opened" && !/undefined|fetch failed/i.test(opened), opened);
});

await stage("8b. The lab's shelf and a person's own", async () => {
  const listed = await tomas.call("pdf.list", {});
  const shelves = listed.filter((doc) => doc.library).map((doc) => `${doc.name}: ${doc.shelf?.kind}`);
  expect("intent", "Tomas's PDFs are listed with the lab's shelf first, then his own library", canonicalJson(shelves) === canonicalJson(["Gauthier 2021.pdf: lab", "Carroll 2020.pdf: yours"]), shelves.join(" | "));
  const cut = await tomas.call("pdf.cut", { ref: GROUP_FILE, exact: "a fraction of the training data", page: 2, title: "NG-RC needs a fraction of the training data", type: await typeOf(tomas, "evidence"), canvas: shared });
  await world.settle(LAB);
  const [atTomas, atMira, atInes] = await Promise.all([tomas, mira, ines].map((vault) => vault.call("node.view", { id: cut.node.id })));
  expect("intent", "evidence read from the lab's shelf says so, for everyone", [atTomas, atMira, atInes].every((view) => view!.node.card.shelf?.kind === "lab" && view!.node.card.shelf.name === LAB_GROUP.name), [atTomas, atMira, atInes].map((view) => JSON.stringify(view!.node.card.shelf ?? null)).join(" "));
  expect("intent", "Mira, who is in the group, gets the Zotero mark and the way to the item", atMira!.node.card.library?.open === `zotero://select/groups/${LAB_GROUP.id}/items/GRPA0001`, JSON.stringify(atMira!.node.card.library ?? null));
  const opened = await mira.call("pdf.open", { ref: GROUP_FILE }).then((file) => atob(file.dataBase64).slice(0, 17), (error: Error) => error.message);
  expect("intent", "Mira opens the PDF from her own Zotero, at the same address", opened === "%PDF-1.7 gauthier", opened);
  expect("privacy", "the PDF itself never went through the lab server", !sentText(tomas).includes(btoa("%PDF-1.7 gauthier")));
  const none = await ines.call("pdf.open", { ref: GROUP_FILE }).then(() => "opened", (error: Error) => error.message);
  expect("intent", "Ines, with no Zotero, sees the reference and is told how to get the PDF", none !== "opened" && /Zotero/.test(none), none);

  const own = await tomas.call("node.view", { id: ids.cut! });
  const labmate = await mira.call("node.view", { id: ids.cut! });
  expect("intent", "Tomas is told his other paper is not on the lab's shelf", own.node.card.shelf?.kind === "yours", JSON.stringify(own.node.card.shelf ?? null));
  expect("intent", "Mira is told that paper is Tomas's own copy", labmate.node.card.shelf?.kind === "person" && labmate.node.card.shelf.name === "Tomas", JSON.stringify(labmate.node.card.shelf ?? null));
  expect("intent", "and is still given its DOI, to find it herself", labmate.node.card.identifiers?.some((id) => id.scheme === "doi") ?? false, JSON.stringify(labmate.node.card.identifiers ?? []));
});

await stage("9. Offline for a while, and the server restarts", async () => {
  for (let index = 0; index < 30; index += 1) {
    const made = await unit(tomas, `Offline note ${index + 1} from the bench`, "evidence");
    await card(tomas, shared, made, 1300 + (index % 6) * 260, Math.floor(index / 6) * 120);
  }
  await world.restartServer();
  await world.settle(LAB);
  await sameView(world, LAB, shared, "thirty units made offline, and a server restart, still end the same for everyone");
  const before = LAB.map((name) => sentCount(world.vault(name)));
  await world.settle(LAB);
  await world.settle(LAB);
  const after = LAB.map((name) => sentCount(world.vault(name)));
  expect("liveness", "once everyone has everything, further exchanges send nothing", canonicalJson(before) === canonicalJson(after), `records sent before ${before.join(", ")} and after ${after.join(", ")}`);
});

await stage("9b. An older app and a newer one in the same lab", async () => {
  // Ines hasn't updated. What her app sends has no signatures and doesn't say what each version replaces.
  ines.old = true;
  const stale = await unit(ines, "Made on an app from before signing", "evidence");
  const staleCard = await card(ines, shared, stale, 0, 1300);
  await world.settle(LAB);
  expect("integrity", "what an older app sends unsigned is not taken in", !holds(mira, "from before signing"));
  const told = (await online(mira, () => mira.call("lab.view", {}))).refusedFrom;
  expect("intent", "Mira is told whose records were refused, so someone can tell Ines to update", told.some((entry) => entry.name === "Ines" && entry.count > 0), JSON.stringify(told));
  await sameView(world, ["Mira", "Tomas"], shared, "and the others carry on, seeing the same canvas");
  const got = await unit(mira, "Made while Ines was behind", "claim");
  await card(mira, shared, got, 300, 1300);
  await world.settle(LAB);
  expect("intent", "the older app still receives what the others make", holds(ines, "Made while Ines was behind"));
  // She updates. What she does next is signed, and carries her earlier work with it.
  ines.old = false;
  await ines.call("node.rename", { id: stale.id, title: "Made on an app from before signing, since updated" });
  await move(ines, shared, staleCard, 20, 1300);
  await world.settle(LAB);
  await sameView(world, LAB, shared, "once she updates, her work arrives and all three agree again");

  // Tomas's app is ahead of everyone's. It writes a kind of record the others have never heard of,
  // and a field they don't know on a kind they do.
  const pair = (await tomas.keys.get(`signing:${tomas.did()}`))!;
  const by = { id: tomas.did(), name: "Tomas" };
  const stamp = new Date(world.time.ms).toISOString();
  const unknown = await signRecord({ v: 2, id: `${tomas.did()}#3zzzzzzzzzzzz`, kind: "forecast", space: "s", at: stamp, by, rev: 1, editedAt: stamp, editedBy: by, horizon: "next quarter" } as unknown as DgRecord, pair, tomas.keys);
  const counter = tomas.core.graph().documents.get(ids.counter!) as DgRecord & { rev: number; editedAt: string; editedBy: typeof by };
  const { sig: _sig, ...bare } = counter;
  const widened = await signRecord({ ...bare, rev: counter.rev + 1, prev: versionKey(counter), editedAt: new Date(world.time.ms + 1).toISOString(), confidence: { value: 0.8, by: "the newer app" } } as unknown as DgRecord, pair, tomas.keys);
  const token = (await online(tomas, () => tomas.call("lab.view", {}))).link!.token!;
  await fetch(`${world.server}/v1/labs/${labId}/records`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ records: [unknown, widened] }) });
  await world.settle(LAB);
  expect("integrity", "a kind of record from a newer app is kept in the log, untouched", mira.records().some((record) => canonicalJson(record) === canonicalJson(unknown)));
  expect("integrity", "and is not mistaken for anything this app knows", !mira.core.graph().documents.has(unknown.id));
  const kept = mira.core.graph().documents.get(ids.counter!) as unknown as { confidence?: { value: number } };
  expect("integrity", "a field this app doesn't know stays on the record, through signing and reading", kept.confidence?.value === 0.8, JSON.stringify(kept.confidence ?? null));
  await sameView(world, LAB, shared, "and the canvas reads the same for everyone, newer app or not");
});

await stage("10. A stranger, and a member who misbehaves", async () => {
  await online(kofi, () => kofi.call("lab.register", { server: world.server, name: "Other Lab" }));
  const own = await unit(kofi, "Kofi's shared claim in another lab", "claim");
  const canvas = await kofi.call("canvas.create", { title: "Other lab's canvas" });
  await card(kofi, canvas.id, own, 0);
  await kofi.call("canvas.share", { id: canvas.id });
  await world.settle();
  expect("privacy", "Kofi, in another lab on the same server, holds nothing of Tension Lab's", !holds(kofi, "Actin assembly") && !holds(kofi, "Tension Lab"));
  expect("privacy", "Tension Lab holds nothing of Kofi's", LAB.every((name) => !holds(world.vault(name), "Kofi's shared claim")));
  const kofiToken = (await online(kofi, () => kofi.call("lab.view", {}))).link!.token!;
  const crossed = await fetch(`${world.server}/v1/labs/${labId}/records`, { headers: { authorization: `Bearer ${kofiToken}` } });
  expect("privacy", "Kofi's token for his own lab does not open Tension Lab", crossed.status === 401 || crossed.status === 403, crossed.status);

  // Tomas, a real member, sends a record that says Mira reworded her own claim.
  const tomasToken = (await online(tomas, () => tomas.call("lab.view", {}))).link!.token!;
  const claim = mira.core.graph().documents.get(ids.claim!) as DgRecord & { rev: number; title: string };
  const forged = { ...claim, rev: claim.rev + 5, title: "Actin assembly has nothing to do with tension", editedAt: new Date().toISOString() };
  await fetch(`${world.server}/v1/labs/${labId}/records`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tomasToken}` }, body: JSON.stringify({ records: [forged] }) });
  await world.settle(LAB);
  const title = (await mira.call("node.view", { id: ids.claim! })).node.title;
  expect("integrity", "a member can't put words in another member's mouth", title !== forged.title, `Mira's own vault now shows her claim as "${title}"`);
  const told = (await online(ines, () => ines.call("lab.view", {}))).refused;
  expect("integrity", "the vaults that refused the forged record say that they did", told > 0, `Ines's lab panel counts ${told} refused`);
});

await stage("11. Mira takes the canvas back", async () => {
  await mira.call("canvas.remove", { id: shared });
  await world.settle(LAB);
  const still = await tomas.call("canvas.list", {}).then((list) => list.some((canvas) => canvas.id === shared && !canvas.removed));
  expect("intent", "a shared canvas its owner removed is gone for the others too", !still, still ? "Tomas still lists it" : "");
});

const walk = { canvas: "" as DgId, actions: [] as string[], refused: 0, notes: [] as string[] };
await stage(`12. A random walk: ${STEPS} steps by three people, seed ${SEED}`, async () => {
  const canvas = await mira.call("canvas.create", { title: "Walk" });
  walk.canvas = canvas.id;
  await mira.call("canvas.share", { id: canvas.id });
  await world.settle(LAB);
  walk.refused = await randomWalk(world, LAB, canvas.id, STEPS, chance(SEED), walk.actions);
  await world.settle(LAB);
  await sameView(world, LAB, canvas.id, "after the walk and a final exchange, all three see the same canvas");
  const ghosts = (await digest(mira, canvas.id))?.cards.filter((line) => line.startsWith("(missing")) ?? [];
  expect("integrity", "no card is left showing a unit that is gone", ghosts.length === 0, `${ghosts.length} such cards`);
  // Where the views differ, what each vault holds for the units in question.
  const views = await Promise.all(LAB.map((name) => digest(world.vault(name), canvas.id)));
  const odd = new Set(views.flatMap((view, index) => (view?.units ?? []).filter((line) => views.some((other, at) => at !== index && !other?.units.includes(line)))).map((line) => line.split(" | ")[0]!.replace(/ \(v\d+\)$/, "")));
  for (const title of [...odd].slice(0, 3)) {
    for (const name of LAB) {
      const graph = world.vault(name).core.graph();
      const node = [...graph.documents.values()].find((record) => record.kind === "node" && (record as { title: string }).title.startsWith(title)) as { id: DgId; rev: number; removed?: boolean; title: string; editedAt?: string } | undefined;
      const cards = [...graph.documents.values()].filter((record) => record.kind === "canvas-item" && (record as { item: { dg?: { node?: DgId } } }).item.dg?.node === node?.id) as unknown as { rev: number; removed?: boolean; canvas: DgId; editedBy?: { name: string } }[];
      walk.notes.push(`${title} at ${name}: unit ${node ? `rev ${node.rev}${node.removed ? " removed" : ""} "${node.title}"` : "not held"}; cards ${cards.map((item) => `rev ${item.rev}${item.removed ? " removed" : ""} by ${item.editedBy?.name}`).join(" | ") || "none"}`);
    }
  }
  for (const note of walk.notes) console.log(`     ${note}`);
  const before = LAB.map((name) => sentCount(world.vault(name)));
  await world.settle(LAB);
  expect("liveness", "and nothing more is sent", canonicalJson(before) === canonicalJson(LAB.map((name) => sentCount(world.vault(name)))));
  console.log(`     (${walk.actions.length} actions, ${walk.refused} refused)`);
});

await stage("12b. Mira removes Tomas from the lab", async () => {
  const cant = await online(ines, () => ines.call("lab.remove", { did: tomas.did() })).then(() => "", (error: Error) => error.message);
  expect("membership", "a member can't remove another member", cant.includes("PI"), cant || "Ines removed Tomas");
  await online(mira, () => mira.call("lab.remove", { did: tomas.did() }));
  await world.settle(["Mira", "Ines"]);
  for (const member of [mira, ines]) {
    const names = (await online(member, () => member.call("lab.view", {}))).members.map((item) => item.name).sort().join(", ");
    expect("membership", `${member.name} no longer lists Tomas`, names === "Ines, Mira", names);
  }
  const before = sentCount(tomas);
  const late = await unit(tomas, "Tomas, after being removed", "claim");
  await card(tomas, walk.canvas, late, 0, 0);
  await tomas.sync().catch(() => undefined);
  await tomas.sync().catch(() => undefined);
  await world.settle(["Mira", "Ines"]);
  expect("privacy", "nothing Tomas does after being removed reaches the lab", !holds(mira, "after being removed") && !holds(ines, "after being removed"));
  const view = await online(tomas, () => tomas.call("lab.view", {}));
  expect("membership", "Tomas is told he was removed, and from which lab", view.removedFrom === "Tension Lab" && !view.link, JSON.stringify({ removedFrom: view.removedFrom, link: Boolean(view.link) }));
  expect("membership", "Tomas's own vault no longer says he is in the lab", !view.identity.lab, view.identity.lab?.name);
  expect("intent", "Tomas keeps his own work", holds(tomas, "CANARY-Tomas") && (await tomas.call("node.query", { text: "CANARY-Tomas", limit: 1 })).length === 1);
  const ownClaim = (await tomas.call("grammar.get", {})).nodeTypes.find((type) => type.base === "claim" && !type.removed);
  expect("intent", "and has his own grammar back, to change as he likes", ownClaim?.by.id === tomas.did(), ownClaim?.by.name);
  expect("privacy", "what the others shared is put away on his device", (await digest(tomas, walk.canvas)) === null && (await tomas.call("node.query", { text: "Actin assembly rises", limit: 1 })).length === 0);
  await mira.call("node.create", { title: "Made after Tomas left" });
  const fresh = await unit(mira, "A claim made after Tomas left", "claim");
  await card(mira, walk.canvas, fresh, 100, 100);
  await world.settle(["Mira", "Ines"]);
  await tomas.sync().catch(() => undefined);
  expect("privacy", "and gets nothing the lab does afterwards", !holds(tomas, "A claim made after Tomas left"), `records Tomas sent since: ${sentCount(tomas) - before}`);

  // Mira changes her mind and invites him back.
  await joinByInvite(tomas);
  await world.settle(LAB);
  const back = await online(tomas, () => tomas.call("lab.view", {}));
  expect("membership", "with a new invitation Tomas is back in, and caught up", back.identity.lab?.name === "Tension Lab" && holds(tomas, "A claim made after Tomas left"), back.identity.lab?.name);
  await sameView(world, LAB, walk.canvas, "and all three see the same canvas again, with what Tomas made while he was out");
});

await stage("13. The same records, in any order", async () => {
  const random = chance(SEED + 1);
  const records = mira.records();
  const shape = (list: DgRecord[]): string => {
    const graph = foldRecords({ records: list, localSpace: "sim" });
    return canonicalJson({
      documents: [...graph.documents.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      relations: [...graph.relations.values()].map(({ record, state }) => [record.id, state]).sort(),
      withdrawn: [...graph.withdrawn].sort(),
    });
  };
  const first = shape(records);
  let same = true;
  for (let round = 0; round < 40 && same; round += 1) {
    const mixed = [...records, ...records.filter(() => random() < 0.3)];
    for (let at = mixed.length - 1; at > 0; at -= 1) {
      const other = Math.floor(random() * (at + 1));
      [mixed[at], mixed[other]] = [mixed[other]!, mixed[at]!];
    }
    same = shape(mixed) === first;
  }
  expect("convergence", `Mira's ${records.length} records read the same in 40 shuffled orders, with repeats`, same);
});

await world.close();

/** A small lab and a walk, start to finish, and a fingerprint of every record each vault ends up holding. */
const fingerprint = async (seed: number): Promise<string> => {
  const small = await openWorld([{ name: "Mira" }, { name: "Tomas" }, { name: "Ines" }], { seed });
  const [pi, ...members] = small.vaults as [Vault, Vault, Vault];
  const names = small.vaults.map((vault) => vault.name);
  pi.online = true;
  await pi.call("lab.register", { server: small.server, name: "Replay Lab" });
  for (const member of members) {
    member.online = true;
    await member.call("lab.acceptInvite", { invite: (await pi.call("lab.invite", {})).invite });
    member.online = false;
  }
  pi.online = false;
  const canvas = await pi.call("canvas.create", { title: "Replay" });
  await pi.call("canvas.share", { id: canvas.id });
  await small.settle();
  await randomWalk(small, names, canvas.id, 150, chance(seed), []);
  await small.settle();
  const all = small.vaults.map((vault) => vault.records().map((record) => canonicalJson(record)).sort().join("\n")).join("\n--\n");
  await small.close();
  return createHash("sha256").update(all).digest("hex");
};

await stage("14. The same seed, played again", async () => {
  const [first, second, other] = [await fingerprint(SEED), await fingerprint(SEED), await fingerprint(SEED + 1)];
  expect("integrity", "a seed played twice leaves every vault with the same records, byte for byte, signatures included", first === second, `${first.slice(0, 12)} / ${second.slice(0, 12)}`);
  expect("integrity", "and another seed leaves different ones", first !== other);
});

const failed = probes.filter((probe) => !probe.pass);
const areas = [...new Set(probes.map((probe) => probe.area))];
const lines = [
  "# Four vaults",
  "",
  `Seed ${SEED}, ${STEPS} walk steps. ${probes.length - failed.length} of ${probes.length} expectations held.`,
  "",
  "| Area | Held | Broke |",
  "|---|---|---|",
  ...areas.map((area) => `| ${area} | ${probes.filter((probe) => probe.area === area && probe.pass).length} | ${probes.filter((probe) => probe.area === area && !probe.pass).length} |`),
  "",
  "## What broke",
  "",
  ...failed.map((probe) => `- **${probe.claim}** (${probe.area}; ${probe.stage})${probe.detail ? `\n  ${probe.detail}` : ""}`),
  "",
  "## Everything, in order",
  "",
  ...[...new Set(probes.map((probe) => probe.stage))].flatMap((name) => [`### ${name}`, "", ...probes.filter((probe) => probe.stage === name).map((probe) => `- ${probe.pass ? "held" : "BROKE"}: ${probe.claim}${probe.detail ? ` (${probe.detail})` : ""}`), ""]),
  "## The walk",
  "",
  `Replay with \`node harness/four-vaults.ts --seed ${SEED} --steps ${STEPS}\`.`,
  "",
  ...walk.actions.slice(0, 400),
];
mkdirSync("reports/four-vaults", { recursive: true });
writeFileSync("reports/four-vaults/report.md", `${lines.join("\n")}\n`);
writeFileSync("reports/four-vaults/report.json", JSON.stringify({ seed: SEED, steps: STEPS, held: probes.length - failed.length, total: probes.length, probes }, null, 1));
console.log(`\n=== four vaults: ${probes.length - failed.length} of ${probes.length} held. Report: reports/four-vaults/report.md`);
process.exit(0);
