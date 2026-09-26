// Each character's journey: levels, quests, gear, talents, stats, reputation,
// gold, deaths, zones, and which recordings they appear in.

import { SLOT_NAMES } from './describe.js';

export function charKey(char = {}) {
  return char.name ? `${char.name}-${char.realm ?? ''}` : 'unknown';
}

// timelines: Map<recordingId, events[]> with `session` on each event.
export function buildCharacters(sessions, moment, timelines = new Map(), recordings = []) {
  const chars = new Map();
  const sessionChar = new Map();

  for (const s of sessions) {
    const key = charKey(s.char);
    sessionChar.set(s.id, key);
    let c = chars.get(key);
    if (!c) {
      c = {
        key, name: s.char?.name ?? 'Unknown', realm: s.char?.realm ?? null, info: {}, sessions: [], playSeconds: 0,
        level: 0, levels: [], quests: [], gear: new Map(), gearHistory: [], talents: null, talentHistory: [],
        stats: new Map(), reputation: [], repChanges: [], skills: [], money: [], deaths: [], kills: 0,
        zones: new Map(), items: 0, first: null, last: null, recordings: new Map(),
      };
      chars.set(key, c);
    }
    c.info = { ...c.info, ...s.char };
    c.info.sex = s.char?.sex === 2 ? 'male' : s.char?.sex === 3 ? 'female' : c.info.sex ?? null;
    c.sessions.push(s.id);
    if (s.events.length > 1) c.playSeconds += s.events.at(-1).t - s.events[0].t;
    for (const e of s.events) {
      const m = () => moment(s, e);
      if (e.lvl) c.level = Math.max(c.level, e.lvl);
      if (!c.first || e.t < c.first.t) c.first = m();
      if (!c.last || e.t > c.last.t) c.last = m();
      if (e.z && !c.zones.has(e.z)) c.zones.set(e.z, m());
      switch (e.e) {
        case 'level': c.levels.push({ level: e.level, ...m() }); break;
        case 'quest_turnin': c.quests.push({ qid: e.qid ?? null, title: e.title ?? null, zone: e.z ?? null, level: e.lvl ?? null, ...m() }); break;
        case 'gear':
          for (const g of e.slots || []) {
            if (!c.gear.has(g.slot)) c.gearHistory.push({ slot: g.slot, id: g.id, name: g.name, was: null, first: true, ...m() });
            c.gear.set(g.slot, { slot: g.slot, id: g.id, name: g.name, since: m() });
          }
          break;
        case 'equip':
          c.gearHistory.push({ slot: e.slot, id: e.id ?? null, name: e.name ?? null, was: e.was ?? null, ...m() });
          if (e.id) c.gear.set(e.slot, { slot: e.slot, id: e.id, name: e.name, since: m() });
          else c.gear.delete(e.slot);
          break;
        case 'talents':
          c.talents = e;
          c.talentHistory.push({ tabs: e.tabs || [], level: e.lvl, ...m() });
          break;
        case 'stats': c.stats.set(e.lvl, { level: e.lvl, ...e.stats, ...m() }); break;
        case 'reputation': c.reputation = e.factions || []; break;
        case 'rep': c.repChanges.push({ faction: e.faction ?? null, amount: e.amount ?? null, text: e.text, ...m() }); break;
        case 'skills': c.skills = e.skills || []; break;
        case 'money': c.money.push({ total: e.total, delta: e.delta, ctx: e.ctx ?? null, ...m() }); break;
        case 'death': c.deaths.push({ killer: e.killer ?? null, zone: e.z ?? null, ...m() }); break;
        case 'kill': c.kills++; break;
        case 'bind': if (e.where) c.info.bind = e.where; break;
        case 'loot': c.items += e.n || 1; break;
        default:
      }
    }
  }

  // Footage per character: which recordings carry their sessions' events.
  for (const [recId, events] of timelines) {
    const rec = recordings.find((r) => r.id === recId);
    const per = new Map();
    for (const e of events) {
      const key = sessionChar.get(e.session);
      if (!key) continue;
      const span = per.get(key) || { min: Infinity, max: -Infinity, events: 0 };
      span.min = Math.min(span.min, e.offset);
      span.max = Math.max(span.max, e.offset);
      span.events++;
      per.set(key, span);
    }
    for (const [key, span] of per) {
      chars.get(key)?.recordings.set(recId, { id: recId, name: rec?.name ?? recId, start: rec?.start ?? null, duration: rec?.duration ?? null, events: span.events, from: span.min, to: span.max });
    }
  }

  return [...chars.values()].map((c) => ({
    ...c,
    gear: [...c.gear.values()].sort((a, b) => a.slot - b.slot).map((g) => ({ ...g, slotName: SLOT_NAMES[g.slot] ?? `Slot ${g.slot}` })),
    gearHistory: c.gearHistory.sort((a, b) => a.t - b.t).map((g) => ({ ...g, slotName: SLOT_NAMES[g.slot] ?? `Slot ${g.slot}` })),
    stats: [...c.stats.values()].sort((a, b) => a.level - b.level),
    zones: [...c.zones.entries()].map(([name, m]) => ({ name, ...m })).sort((a, b) => a.t - b.t),
    recordings: [...c.recordings.values()].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)),
    questsDone: new Set(c.quests.map((q) => q.qid ?? q.title)).size,
  })).sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0));
}

// Which character each recording shows (the one with the most events in it).
export function recordingCharacters(sessions, timelines) {
  const sessionChar = new Map(sessions.map((s) => [s.id, s.char?.name ?? 'Unknown']));
  const out = new Map();
  for (const [recId, events] of timelines) {
    const counts = new Map();
    for (const e of events) {
      const name = sessionChar.get(e.session);
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    out.set(recId, names);
  }
  return out;
}
