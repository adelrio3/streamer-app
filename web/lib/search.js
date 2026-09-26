// One search across everything: quests, NPCs, items, vendors, zones, texts,
// characters and marks. Every word of the query must appear somewhere in an
// entry's text; title matches rank first.

import { tooltipLine } from './sessions.js';

export function buildIndex({ codex, world, characters }) {
  const entries = [];
  const add = (type, title, href, sub, ...text) => {
    if (!title) return;
    entries.push({ type, title: String(title), href, sub: sub ?? '', text: [title, sub, ...text].filter(Boolean).join(' \n ').toLowerCase() });
  };
  for (const q of codex.quests) add('Quest', q.title ?? `Quest ${q.qid}`, `#/quest/${encodeURIComponent(q.key)}`, [q.zone, q.giver?.name].filter(Boolean).join(' · '), q.text, q.objectives, q.progress, q.reward);
  for (const n of world.npcs) {
    add(n.vendor ? 'Vendor' : n.object ? 'Object' : 'NPC', n.name, `#/npc/${encodeURIComponent(n.key)}`,
      [n.titles[0] && `<${n.titles[0]}>`, n.zones.join(', ')].filter(Boolean).join(' '),
      n.ctype, n.family, n.ranks.join(' '), ...n.lines.map((l) => l.text), ...(n.tip || []),
      ...(n.vendor?.items || []).map((i) => i.name), ...(n.trainer?.services || []).map((x) => x.name), ...(n.taxi?.nodes || []).map((x) => x.name));
  }
  for (const i of world.items) {
    const tip = (i.info?.tip || []).map((l) => { const t = tooltipLine(l); return [t.left, t.right].filter(Boolean).join(' '); });
    add('Item', i.name ?? `Item ${i.id}`, `#/item/${i.id}`, [i.info?.type, i.info?.sub].filter(Boolean).join(' · '), ...tip, i.info?.spell);
  }
  for (const z of codex.zones) add('Zone', z.name, `#/zone/${encodeURIComponent(z.name)}`, z.subzones.join(', '), ...z.subzones);
  for (const b of codex.books) add('Text', b.title, '#/texts', b.zone, ...b.pages);
  for (const c of characters) add('Character', c.name, `#/character/${encodeURIComponent(c.key)}`, [c.info.race, c.info.class, c.realm].filter(Boolean).join(' '), c.info.guild);
  for (const m of codex.marks) add('Mark', m.note || m.kind, m.footage ? `#/recording/${m.footage.rec}?t=${m.footage.offset.toFixed(2)}` : '#/marks', [m.kind, m.z].filter(Boolean).join(' · '), m.sz);
  return entries;
}

export function search(index, query, limit = 200) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const entry of index) {
    if (!words.every((w) => entry.text.includes(w))) continue;
    const title = entry.title.toLowerCase();
    const score = (title === words.join(' ') ? 3 : 0) + (words.every((w) => title.includes(w)) ? 2 : 0) + (title.startsWith(words[0]) ? 1 : 0);
    hits.push({ ...entry, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
