// The world as you have seen it: a bestiary of every NPC and creature, the
// item catalog with where each item comes from, and vendors with their stock.
//
// moment(s, e) returns { session, t, footage } for linking to video.

export function npcKey(npcId, name) {
  return npcId ? `n${npcId}` : `s${name}`;
}

export function buildWorld(sessions, catalogRows = [], moment = (s, e) => ({ session: s.id, t: e.t, footage: null })) {
  const npcs = new Map();
  const items = new Map();

  // forcedKey: objects are keyed by their object id (o<id>), so one named
  // later (or in another session) merges with the same one seen unnamed.
  const npc = (npcId, name, forcedKey) => {
    if (!npcId && !name && !forcedKey) return null;
    const key = forcedKey ?? npcKey(npcId, name);
    let n = npcs.get(key);
    if (!n) {
      n = {
        key, npcId: npcId ?? null, name: name ?? null, titles: new Set(), levels: [], ranks: new Set(), ctype: null, family: null,
        react: null, faction: null, hp: null, zones: new Set(), sightings: 0, sources: {}, first: null, last: null,
        kills: 0, firstKill: null, loots: 0, drops: new Map(), moneyDrops: 0, vendor: null, trainer: null, taxi: null,
        lines: [], quests: new Set(), killedYou: 0, fights: 0, tip: null, rare: false, spots: [],
      };
      npcs.set(key, n);
    }
    if (name && !n.name) n.name = name;
    return n;
  };

  const item = (id, name) => {
    if (!id) return null;
    let it = items.get(id);
    if (!it) {
      it = {
        id, name: name ?? null, info: null, looted: 0, moments: [], droppedBy: new Map(), soldBy: [], rewardFrom: new Map(),
        equippedBy: [], created: 0, received: 0, costOf: new Map(),
      };
      items.set(id, it);
    }
    if (name && !it.name) it.name = name;
    return it;
  };

  for (const row of catalogRows) {
    const it = item(row.item_id, row.data?.name);
    it.info = row.data;
  }

  // Where something was seen: map coordinates in percent, with footage.
  const MAX_SPOTS = 400;
  const spot = (n, s, e, kind) => {
    if (!n || e.x == null || !e.m || n.spots.length >= MAX_SPOTS) return;
    n.spots.push({ m: e.m, z: e.z ?? null, sz: e.sz ?? null, x: e.x, y: e.y, kind, ...moment(s, e) });
  };

  for (const s of sessions) {
    const who = s.char?.name ? `${s.char.name}-${s.char.realm ?? ''}` : 'unknown';
    for (const e of s.events) {
      switch (e.e) {
        case 'npc': {
          const n = npc(e.npcId, e.name);
          if (!n) break;
          n.sightings++;
          spot(n, s, e, e.src);
          n.sources[e.src] = (n.sources[e.src] || 0) + 1;
          const m = moment(s, e);
          n.first ??= m;
          n.last = m;
          if (e.z) n.zones.add(e.z);
          if (e.level != null && e.level !== -1) n.levels.push(e.level);
          if (e.level === -1) n.ranks.add('skull');
          if (e.rank) n.ranks.add(e.rank);
          if (e.title) n.titles.add(e.title);
          for (const k of ['ctype', 'family', 'faction', 'hp']) if (e[k] != null) n[k] = e[k];
          if (e.react != null) n.react = e.react;
          if (e.tip) n.tip = e.tip;
          if (e.rare) n.rare = true;
          break;
        }
        case 'kill': {
          const n = npc(e.npcId, e.name);
          if (!n) break;
          n.kills++;
          n.firstKill ??= moment(s, e);
          if (e.z) n.zones.add(e.z);
          spot(n, s, e, 'kill');
          break;
        }
        case 'object': { // the addon learned an object's name for sure (cactus, chest, herb)
          if (e.objId && e.name) {
            const n = npc(null, e.name, `o${e.objId}`);
            n.object = true; n.objectId = e.objId; n.votes ??= new Map(); n.votes.set(e.name, (n.votes.get(e.name) || 0) + 1000);
          }
          break;
        }
        case 'loot_window': {
          for (const src of e.sources || []) {
            const n = src.kind === 'GameObject'
              ? npc(null, src.name ?? `Object ${src.id}`, src.id ? `o${src.id}` : undefined)
              : npc(src.id && src.kind === 'Creature' ? src.id : null, src.name ?? null);
            // Object names are votes: older addons named a chest after whatever
            // tooltip was last on screen, so the names are settled at the end.
            if (src.kind === 'GameObject') { n.objectId = src.id ?? null; n.votes ??= new Map(); if (src.name && !looksLikePlayer(src.name)) n.votes.set(src.name, (n.votes.get(src.name) || 0) + 1); }
            if (!n) continue;
            if (src.kind === 'GameObject') n.object = true;
            n.loots++;
            spot(n, s, e, 'loot');
            if (e.z) n.zones.add(e.z);
            if (e.money) n.moneyDrops++;
            for (const i of e.items || []) {
              const d = n.drops.get(i.id) || { id: i.id, name: i.name, times: 0, qty: 0 };
              d.times++;
              d.qty += i.n || 1;
              n.drops.set(i.id, d);
              const it = item(i.id, i.name);
              const by = it.droppedBy.get(n.key) || { key: n.key, name: n.name, times: 0 };
              by.times++;
              it.droppedBy.set(n.key, by);
            }
          }
          break;
        }
        case 'loot': {
          const it = item(e.id, e.name);
          if (!it) break;
          if (e.src === 'created') it.created += e.n || 1;
          else if (e.src === 'received') it.received += e.n || 1;
          else it.looted += e.n || 1;
          it.moments.push(moment(s, e));
          break;
        }
        case 'vendor': {
          const n = npc(e.npcId, e.npc);
          if (!n) break;
          n.vendor = { items: e.items || [], repair: Boolean(e.repair), at: moment(s, e), zone: e.z ?? null };
          if (e.z) n.zones.add(e.z);
          spot(n, s, e, 'vendor');
          for (const v of e.items || []) {
            const it = item(v.id, v.name);
            if (!it) continue;
            it.soldBy = it.soldBy.filter((x) => x.key !== n.key);
            it.soldBy.push({ key: n.key, name: n.name, price: v.price, per: v.per, stock: v.stock ?? null, costs: v.costs || [], zone: e.z ?? null });
            for (const c of v.costs || []) {
              const ci = item(c.id, c.name);
              if (ci) ci.costOf.set(v.id, { id: v.id, name: v.name, value: c.value, vendor: n.name });
            }
          }
          break;
        }
        case 'trainer': {
          const n = npc(e.npcId, e.npc);
          if (n) { n.trainer = { services: e.services || [], greeting: e.greeting ?? null, at: moment(s, e) }; spot(n, s, e, 'trainer'); if (e.z) n.zones.add(e.z); }
          break;
        }
        case 'taxi_map': {
          const n = npc(e.npcId, e.npc);
          if (n) { n.taxi = { nodes: e.nodes || [], at: moment(s, e) }; spot(n, s, e, 'taxi'); if (e.z) n.zones.add(e.z); }
          break;
        }
        case 'gossip':
        case 'speech': {
          const n = npc(e.npcId, e.e === 'gossip' ? e.npc : e.speaker);
          if (!n || !e.text) break;
          const line = n.lines.find((l) => l.text === e.text);
          if (line) line.moments.push(moment(s, e));
          else n.lines.push({ text: e.text, kind: e.e === 'gossip' ? 'gossip' : e.kind, moments: [moment(s, e)] });
          break;
        }
        case 'quest_detail':
        case 'quest_complete': {
          if (e.npc) {
            const n = npc(e.npcId, e.npc);
            n?.quests.add(e.qid ? `q${e.qid}` : `t${e.title}`);
            spot(n, s, e, 'quest');
            if (n && e.z) n.zones.add(e.z);
          }
          for (const r of [...(e.rewards || []), ...(e.choices || [])]) {
            const it = item(r.id, r.name);
            if (it) it.rewardFrom.set(e.qid ?? e.title, { qid: e.qid ?? null, title: e.title ?? null, choice: (e.choices || []).includes(r) });
          }
          break;
        }
        case 'death': {
          if (e.killer) {
            const n = npc(e.killerId, e.killer);
            if (n) n.killedYou++;
          }
          break;
        }
        case 'fight': {
          for (const en of e.enemies || []) {
            const n = npc(en.npcId, en.name);
            if (!n) continue;
            n.fights++;
            if (en.rank) n.ranks.add(en.rank);
          }
          break;
        }
        case 'equip': {
          const it = item(e.id, e.name);
          if (it) it.equippedBy.push({ char: who, slot: e.slot, moment: moment(s, e) });
          break;
        }
        default:
      }
    }
  }

  // Settle object names: the most voted name that is not a creature's.
  const creatureNames = new Set([...npcs.values()].filter((n) => !n.object && n.name).map((n) => n.name));
  for (const n of npcs.values()) {
    if (!n.object) continue;
    const best = [...(n.votes || new Map()).entries()].filter(([name]) => !creatureNames.has(name)).sort((a, b) => b[1] - a[1])[0];
    n.name = best ? best[0] : (n.objectId ? `Object ${n.objectId}` : n.name);
    n.unnamed = !best;
    delete n.votes;
  }
  const npcList = [...npcs.values()].map((n) => ({
    ...n,
    ...classify(n),
    titles: [...n.titles], ranks: [...n.ranks], zones: [...n.zones],
    minLevel: n.levels.length ? Math.min(...n.levels) : null,
    maxLevel: n.levels.length ? Math.max(...n.levels) : null,
    drops: [...n.drops.values()].map((d) => ({ ...d, rate: n.loots ? d.times / n.loots : null })).sort((a, b) => b.times - a.times),
    levels: undefined,
  }));
  const itemList = [...items.values()].map((it) => {
    const info = it.info || {};
    return {
      ...it,
      name: info.name ?? it.name,
      quality: info.q ?? null,
      icon: info.icon ?? null,
      droppedBy: [...it.droppedBy.values()].map((d) => {
        const n = npcs.get(d.key);
        return { ...d, loots: n?.loots ?? 0, rate: n?.loots ? d.times / n.loots : null };
      }).sort((a, b) => b.times - a.times),
      rewardFrom: [...it.rewardFrom.values()],
      costOf: [...it.costOf.values()],
    };
  });
  return {
    npcs: npcList,
    creatures: npcList.filter((n) => n.attackable),
    people: npcList.filter((n) => !n.attackable && !n.object),
    objects: npcList.filter((n) => n.object),
    items: itemList,
    vendors: npcList.filter((n) => n.vendor),
    byNpc: new Map(npcList.map((n) => [n.key, n])),
    byItem: new Map(itemList.map((i) => [i.id, i])),
  };
}

export const ROLE_NAMES = { quest: 'Quest giver', vendor: 'Vendor', trainer: 'Trainer', taxi: 'Flight master', innkeeper: 'Innkeeper', banker: 'Banker', talker: 'Speaks', other: 'Other' };

// Is this something you can fight (bestiary) or someone you deal with (people)?
// "Emogan-Mankrik": a player's tooltip, never an object's name.
function looksLikePlayer(name) {
  return /^[^\s-]+-[A-Z][^-]*$/.test(String(name));
}

function classify(n) {
  const roles = [];
  if (n.quests.size) roles.push('quest');
  if (n.vendor) roles.push('vendor');
  if (n.trainer) roles.push('trainer');
  if (n.taxi) roles.push('taxi');
  const titles = [...n.titles].join(' ').toLowerCase();
  if (/innkeeper/.test(titles)) roles.push('innkeeper');
  if (/banker/.test(titles)) roles.push('banker');
  if (!roles.length && n.lines.length) roles.push('talker');
  if (!roles.length) roles.push('other');
  const friendlyRole = roles.some((r) => r !== 'talker' && r !== 'other');
  const hostile = n.kills > 0 || n.fights > 0 || n.killedYou > 0 || (n.react != null && n.react <= 4);
  const attackable = !n.object && (hostile || (!friendlyRole && n.react == null && (n.ranks.size > 0 || n.ctype === 'Beast')));
  return { roles, attackable: attackable && !friendlyRole };
}
