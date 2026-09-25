// The Codex: every quest, creature, NPC, item, text and place you have
// actually experienced, built from all ingested sessions. Each entry keeps the
// moments (session + time) it happened so the UI can jump to the footage.

// resolve(sessionId, t) returns { rec, offset } when the moment is on video.
export function buildCodex(sessions, resolve = () => null) {
  const quests = new Map();
  const questByTitle = new Map();
  const creatures = new Map();
  const npcs = new Map();
  const items = new Map();
  const books = new Map();
  const zones = new Map();
  const marks = [];
  const characters = new Map();

  const moment = (s, e) => ({ session: s.id, t: e.t, footage: resolve(s.id, e.t) });

  for (const s of sessions) {
    const who = s.char?.name ? `${s.char.name}-${s.char.realm ?? ''}` : 'unknown';
    const c = getOr(characters, who, () => ({
      key: who, name: s.char?.name, realm: s.char?.realm, race: s.char?.race, class: s.char?.class,
      classToken: s.char?.classToken, faction: s.char?.faction, level: 0, sessions: 0, playSeconds: 0,
    }));
    c.sessions++;
    if (s.events.length > 1) c.playSeconds += s.events.at(-1).t - s.events[0].t;

    for (const e of s.events) {
      if (e.lvl) c.level = Math.max(c.level, e.lvl);
      if (e.z) {
        const z = getOr(zones, e.z, () => ({ name: e.z, subzones: new Set(), quests: new Set(), kills: 0, events: 0, first: moment(s, e), last: moment(s, e) }));
        z.events++;
        z.last = moment(s, e);
        if (e.sz) z.subzones.add(e.sz);
      }
      switch (e.e) {
        case 'quest_detail':
        case 'quest_accept':
        case 'quest_progress':
        case 'quest_complete':
        case 'quest_turnin':
        case 'quest_abandon': {
          if (!e.qid && !e.title) break;
          // Abandons only carry a title, so find the quest by name when needed.
          const key = e.qid ? `q${e.qid}` : (questByTitle.get(e.title) ?? `t${e.title}`);
          if (e.title) questByTitle.set(e.title, key);
          const q = getOr(quests, key, () => ({
            key, qid: e.qid ?? null, title: e.title ?? null, zone: e.z ?? null, giver: null, turnInNpc: null,
            text: null, objectives: null, progress: null, reward: null, level: null,
            offered: [], accepted: [], turnedIn: [], abandoned: [], characters: new Set(),
          }));
          q.title ??= e.title;
          q.characters.add(who);
          if (e.e === 'quest_detail') {
            q.offered.push(moment(s, e));
            q.text = e.text ?? q.text;
            q.objectives = e.obj ?? q.objectives;
            q.zone = e.z ?? q.zone;
            if (e.npc) q.giver = { name: e.npc, npcId: e.npcId ?? null, kind: e.npcKind ?? null };
          } else if (e.e === 'quest_accept') {
            q.accepted.push(moment(s, e));
            q.level ??= e.lvl ?? null;
          } else if (e.e === 'quest_progress') {
            q.progress = e.text ?? q.progress;
          } else if (e.e === 'quest_complete') {
            q.reward = e.text ?? q.reward;
            if (e.npc) q.turnInNpc = { name: e.npc, npcId: e.npcId ?? null, kind: e.npcKind ?? null };
          } else if (e.e === 'quest_turnin') {
            q.turnedIn.push({ ...moment(s, e), xp: e.xp ?? null, money: e.money ?? null });
          } else {
            q.abandoned.push(moment(s, e));
          }
          if (e.npc) npcEntry(npcs, e.npc, e.npcId, e.npcKind).quests.add(key);
          if (e.z) zones.get(e.z)?.quests.add(key);
          break;
        }
        case 'kill': {
          const key = e.npcId ? `n${e.npcId}` : `k${e.name}`;
          const k = getOr(creatures, key, () => ({ key, name: e.name, npcId: e.npcId ?? null, kind: e.npcKind ?? null, kills: 0, zones: new Set(), moments: [] }));
          k.kills++;
          if (e.z) k.zones.add(e.z);
          k.moments.push(moment(s, e));
          if (e.z) zones.get(e.z).kills++;
          break;
        }
        case 'gossip': {
          if (!e.npc) break;
          const n = npcEntry(npcs, e.npc, e.npcId, e.npcKind);
          addLine(n, e.text, 'gossip', moment(s, e));
          if (e.z) n.zones.add(e.z);
          break;
        }
        case 'speech': {
          if (!e.speaker) break;
          const n = npcEntry(npcs, e.speaker, e.npcId, e.npcKind);
          addLine(n, e.text, e.kind, moment(s, e));
          if (e.z) n.zones.add(e.z);
          break;
        }
        case 'book': {
          const key = e.title ?? e.pages?.[0]?.slice(0, 40) ?? 'Untitled';
          const b = getOr(books, key, () => ({ title: key, pages: e.pages || [], zone: e.z ?? null, moments: [] }));
          if ((e.pages?.length ?? 0) > b.pages.length) b.pages = e.pages;
          b.moments.push(moment(s, e));
          break;
        }
        case 'loot': {
          const key = e.id ?? e.name;
          if (key == null) break;
          const it = getOr(items, key, () => ({
            id: e.id ?? null, name: e.name ?? null, quality: e.q ?? null, icon: e.icon ?? null, ilvl: e.ilvl ?? null,
            req: e.req ?? null, type: e.type ?? null, subType: e.sub ?? null, slot: e.slot ?? null,
            count: 0, sources: {}, moments: [],
          }));
          it.count += e.n || 1;
          it.sources[e.src || 'loot'] = (it.sources[e.src || 'loot'] || 0) + (e.n || 1);
          for (const [from, to] of [['name', 'name'], ['q', 'quality'], ['icon', 'icon'], ['ilvl', 'ilvl'], ['type', 'type'], ['sub', 'subType'], ['slot', 'slot'], ['req', 'req']]) {
            if (e[from] != null) it[to] = e[from];
          }
          it.moments.push(moment(s, e));
          break;
        }
        case 'mark':
          marks.push({ ...moment(s, e), kind: e.kind, note: e.note ?? null, z: e.z ?? null, sz: e.sz ?? null });
          break;
        default:
      }
    }
  }

  const list = (m) => [...m.values()].map(plain);
  const questList = list(quests).map((q) => ({
    ...q,
    status: q.turnedIn.length ? 'done' : q.abandoned.length && !q.accepted.some((a) => a.t > q.abandoned.at(-1).t) ? 'abandoned' : q.accepted.length ? 'active' : 'seen',
  }));
  return {
    characters: list(characters),
    quests: questList.sort(byFirst((q) => q.offered[0] ?? q.accepted[0] ?? q.turnedIn[0])),
    creatures: list(creatures).sort((a, b) => b.kills - a.kills),
    npcs: list(npcs).sort((a, b) => a.name.localeCompare(b.name)),
    items: list(items).sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0) || String(a.name).localeCompare(String(b.name))),
    books: list(books),
    zones: list(zones).sort(byFirst((z) => z.first)),
    marks,
    totals: {
      quests: questList.filter((q) => q.status === 'done').length,
      kills: [...creatures.values()].reduce((n, k) => n + k.kills, 0),
      items: items.size,
      npcs: npcs.size,
      books: books.size,
      marks: marks.length,
    },
  };
}

function npcEntry(npcs, name, npcId, kind) {
  const key = npcId ? `n${npcId}` : `s${name}`;
  return getOr(npcs, key, () => ({ key, name, npcId: npcId ?? null, kind: kind ?? null, lines: [], quests: new Set(), zones: new Set() }));
}

function addLine(npc, text, kind, m) {
  if (!text) return;
  const existing = npc.lines.find((l) => l.text === text);
  if (existing) existing.moments.push(m);
  else npc.lines.push({ text, kind, moments: [m] });
}

function getOr(map, key, make) {
  let v = map.get(key);
  if (!v) { v = make(); map.set(key, v); }
  return v;
}

// Sets become arrays so the codex can be sent as JSON.
function plain(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v instanceof Set ? [...v] : v;
  return out;
}

function byFirst(pick) {
  return (a, b) => (pick(a)?.t ?? Infinity) - (pick(b)?.t ?? Infinity);
}
