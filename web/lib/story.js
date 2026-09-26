// Storylines: quest chains from the database, as chapters in order. A chain
// is every quest linked by "next quest in chain" or "requires this quest
// first" (the importer keeps them as next / pre / preAll). The Defias thread
// runs Elwynn → Westfall → the Deadmines; this puts it in one list, with
// what you have done and what comes next.

import { questState } from './questdb.js';

const COUNTED = new Set(['done', 'ready', 'active', 'later']);

// db: from indexDB. ctx: the character context questState takes ({} for everyone).
export function storylines(db, ctx = {}) {
  if (db._storylines?.ctx === ctx) return db._storylines.list;
  const quests = (db.quests instanceof Map ? [...db.quests.values()] : Object.values(db.quests)).filter((q) => q && !q.hidden);
  const byId = new Map(quests.map((q) => [q.id, q]));
  // Union-find over chain links.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const q of quests) parent.set(q.id, q.id);
  const parents = new Map(); // quest id -> ids that must come before it
  // join: whether the link makes the two quests one story. An ordering-only
  // link still puts the prerequisite first when both end up in one chain.
  const link = (before, after, join = true) => {
    if (!byId.has(before) || !byId.has(after) || before === after) return;
    if (join) union(before, after);
    if (!parents.has(after)) parents.set(after, new Set());
    parents.get(after).add(before);
  };
  // "pre" with several entries means any one of them unlocks the quest
  // (the racial starting quests all lead to one "report to" quest); that is
  // an ordering, not one story, so it is not a link.
  for (const q of quests) {
    if (q.next) link(q.id, q.next);
    for (const p of q.pre || []) link(p, q.id, q.pre.length === 1);
    for (const p of q.preAll || []) link(p, q.id);
  }
  const groups = new Map();
  for (const q of quests) {
    const root = find(q.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(q);
  }
  const list = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = topo(members, parents);
    const rows = ordered.map((q) => ({ q, state: questState(q, ctx) }));
    const counted = rows.filter((r) => !r.q.rep && COUNTED.has(r.state));
    if (!counted.length && Object.keys(ctx).length) continue; // nothing this character can do
    const ends = ordered.filter((q) => !ordered.some((o) => (parents.get(o.id) || new Set()).has(q.id)));
    // Named after the last chapter: the one the chain leads to.
    const finale = [...ordered].reverse().find((q) => ends.includes(q)) || ordered.at(-1);
    const zoneIds = [];
    for (const q of ordered) { const z = q.zone ?? q.z; if (z && !zoneIds.includes(z)) zoneIds.push(z); }
    const levels = ordered.map((q) => q.l || 0).filter(Boolean);
    const startZone = zoneIds[0] ?? null;
    list.push({
      id: Math.min(...ordered.map((q) => q.id)),
      name: cleanTitle(finale.n),
      quests: rows,
      zoneIds,
      zones: zoneIds.map((z) => db.zoneName(z)),
      startZone: startZone ? db.zoneName(startZone) : null,
      continent: startZone ? db.zones[startZone]?.c ?? db.zones[db.zones[startZone]?.p]?.c ?? null : null,
      minLevel: levels.length ? Math.min(...levels) : null,
      maxLevel: levels.length ? Math.max(...levels) : null,
      total: counted.length,
      done: counted.filter((r) => r.state === 'done').length,
      next: rows.find((r) => r.state === 'ready' || r.state === 'active')?.q ?? null,
    });
  }
  list.sort((a, b) => (a.minLevel ?? 99) - (b.minLevel ?? 99) || a.name.localeCompare(b.name));
  db._storylines = { ctx, list };
  return list;
}

// Chapters in order: what has no prerequisite first, then what those
// unlock, level and id breaking ties. A cycle (bad data) falls back to
// level order for what is left.
function topo(members, parents) {
  const ids = new Set(members.map((q) => q.id));
  const indeg = new Map(members.map((q) => [q.id, [...(parents.get(q.id) || [])].filter((p) => ids.has(p)).length]));
  const byId = new Map(members.map((q) => [q.id, q]));
  const children = new Map();
  for (const q of members) for (const p of parents.get(q.id) || []) { if (!ids.has(p)) continue; if (!children.has(p)) children.set(p, []); children.get(p).push(q.id); }
  const order = (a, b) => (byId.get(a).l || 0) - (byId.get(b).l || 0) || a - b;
  let ready = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort(order);
  const out = [];
  while (ready.length) {
    const id = ready.shift();
    out.push(byId.get(id));
    for (const c of children.get(id) || []) {
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) { ready.push(c); ready.sort(order); }
    }
  }
  if (out.length < members.length) {
    const seen = new Set(out.map((q) => q.id));
    out.push(...members.filter((q) => !seen.has(q.id)).sort((a, b) => order(a.id, b.id)));
  }
  return out;
}

function cleanTitle(n) {
  return String(n || '').replace(/\s+/g, ' ').trim();
}

export function storylinesByContinent(list) {
  const groups = new Map();
  for (const s of list) {
    const key = s.continent || 'Elsewhere';
    if (!groups.has(key)) groups.set(key, { name: key, storylines: [], done: 0, total: 0 });
    const g = groups.get(key);
    g.storylines.push(s);
    g.done += s.done;
    g.total += s.total;
  }
  return [...groups.values()];
}

// An outline for writing: the chapters, with the text the addon captured
// when you read the quest (codexQuests: the Codex's quests, keyed q<id>).
export function storylineOutline(story, codexQuests = new Map(), voice = []) {
  const lines = [`# ${story.name}`, ''];
  lines.push(`${story.zones.join(' → ') || 'Unknown zone'}${story.minLevel ? ` · level ${story.minLevel}${story.maxLevel !== story.minLevel ? `–${story.maxLevel}` : ''}` : ''} · ${story.done} of ${story.total} done`, '');
  story.quests.forEach((r, i) => {
    const c = codexQuests.get(`q${r.q.id}`);
    lines.push(`## ${i + 1}. ${r.q.n}${r.q.l ? ` (level ${r.q.l})` : ''} — ${r.state}`);
    if (r.q.o) lines.push('', `Objective: ${r.q.o}`);
    if (c?.text) lines.push('', c.text);
    if (c?.progress) lines.push('', `Progress text: ${c.progress}`);
    if (c?.reward) lines.push('', `Turn-in text: ${c.reward}`);
    const notes = voice.filter((v) => v.qid === r.q.id);
    for (const v of notes) lines.push('', `> ${v.text}`);
    lines.push('');
  });
  return lines.join('\n');
}
