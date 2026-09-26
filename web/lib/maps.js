// Everything with a map position, grouped per in-game map (UiMap ID), for the
// Locations pages. Coordinates are percentages of the zone map, as the game
// reports them.

import { parsePoint } from './footage.js';

export const LAYERS = {
  quest: { name: 'Quests', color: '#f2cc6b' },
  creature: { name: 'Creatures', color: '#e06a5f' },
  person: { name: 'People', color: '#6aa8e8' },
  vendor: { name: 'Vendors & trainers', color: '#e0b95a' },
  object: { name: 'Herbs, ore & chests', color: '#5cc8a8' },
  loot: { name: 'Loot', color: '#9fd68a' },
  death: { name: 'Deaths & close calls', color: '#ff4d4d' },
  lore: { name: 'Lore (books, dialogue)', color: '#c9b6f5' },
  mark: { name: 'Marks, screenshots, level-ups', color: '#b48cf0' },
  route: { name: 'Your route', color: '#f2cc6b' },
  density: { name: 'Creature density', color: '#e06a5f', heat: true },
  time: { name: 'Where you spent time', color: '#f2cc6b', heat: true },
};

// world: from buildWorld; codex: from buildCodex; moment(s, e).
export function buildMaps(sessions, world, codex, moment) {
  const maps = new Map();
  const map = (id, zone) => {
    let m = maps.get(id);
    if (!m) {
      m = { id, zone: zone ?? null, subzones: new Set(), markers: [], counts: {}, events: 0, first: null, last: null };
      maps.set(id, m);
    }
    if (zone && !m.zone) m.zone = zone;
    return m;
  };
  const add = (id, marker) => {
    const m = map(id, marker.zone);
    m.markers.push(marker);
    m.counts[marker.layer] = (m.counts[marker.layer] || 0) + 1;
  };

  for (const s of sessions) {
    for (const e of s.events) {
      if (!e.m) continue;
      const m = map(e.m, e.z);
      m.events++;
      if (e.sz) m.subzones.add(e.sz);
      if (!m.first || e.t < m.first.t) m.first = moment(s, e);
      if (!m.last || e.t > m.last.t) m.last = moment(s, e);
      if (e.x == null) continue;
      const base = { x: e.x, y: e.y, zone: e.z ?? null, sub: e.sz ?? null, ...moment(s, e) };
      switch (e.e) {
        case 'quest_detail': add(e.m, { ...base, layer: 'quest', label: `Quest: ${e.title ?? ''}`, sub2: 'offered', href: `#/quest/${encodeURIComponent(e.qid ? `q${e.qid}` : `t${e.title}`)}`, key: `q${e.qid ?? e.title}` }); break;
        case 'quest_turnin': add(e.m, { ...base, layer: 'quest', label: `Turned in: ${e.title ?? ''}`, href: `#/quest/${encodeURIComponent(e.qid ? `q${e.qid}` : `t${e.title}`)}`, key: `q${e.qid ?? e.title}` }); break;
        case 'death': add(e.m, { ...base, layer: 'death', label: e.killer ? `Died to ${e.killer}` : 'Died', href: '#/highlights?kind=death' }); break;
        case 'fight': if (e.close) add(e.m, { ...base, layer: 'death', label: `Close call: ${(e.enemies || []).map((x) => x.name).filter(Boolean).slice(0, 3).join(', ')} (${e.minHp}% health)`, href: '#/highlights?kind=close' }); break;
        case 'level': add(e.m, { ...base, layer: 'mark', label: `Reached level ${e.level}`, href: '#/characters' }); break;
        case 'book': add(e.m, { ...base, layer: 'lore', label: `Read: ${e.title ?? 'text'}`, href: '#/lore?show=text', key: `b${e.title}` }); break;
        case 'speech': if (e.text) add(e.m, { ...base, layer: 'lore', label: `${e.speaker ?? 'NPC'}: ${e.text.slice(0, 80)}`, href: e.npcId ? `#/npc/n${e.npcId}` : '#/lore?show=speech', key: `sp${e.npcId ?? e.speaker}|${e.text.slice(0, 40)}` }); break;
        case 'gossip': if (e.text) add(e.m, { ...base, layer: 'lore', label: `${e.npc ?? 'NPC'}: ${e.text.slice(0, 80)}`, href: e.npcId ? `#/npc/n${e.npcId}` : '#/lore?show=gossip', key: `g${e.npcId ?? e.npc}` }); break;
        case 'mark': add(e.m, { ...base, layer: 'mark', label: `${e.kind ?? 'Mark'}${e.note ? `: ${e.note}` : ''}`, href: '#/marks' }); break;
        case 'screenshot': add(e.m, { ...base, layer: 'mark', label: `Screenshot (${e.reason ?? 'manual'})`, href: '#/screenshots' }); break;
        case 'loot_window': {
          const what = (e.items || []).map((i) => i.name).filter(Boolean).slice(0, 4).join(', ');
          if (what) add(e.m, { ...base, layer: 'loot', label: `Loot: ${what}`, href: '#/items' });
          break;
        }
        default:
      }
    }
  }

  for (const n of world.npcs) {
    const layer = n.object ? 'object' : n.attackable ? 'creature' : (n.vendor || n.trainer || n.taxi) ? 'vendor' : 'person';
    // Many sightings of the same creature cluster: keep every spot but one
    // marker key so the map can group them.
    for (const sp of n.spots) {
      add(sp.m, { x: sp.x, y: sp.y, zone: sp.z, sub: sp.sz, session: sp.session, t: sp.t, footage: sp.footage, layer, label: n.name ?? '?', sub2: sp.kind, href: `#/npc/${encodeURIComponent(n.key)}`, key: n.key });
    }
  }

  return [...maps.values()].map((m) => ({ ...m, subzones: [...m.subzones], layers: Object.keys(m.counts) })).sort((a, b) => b.events - a.events);
}

// Route polylines per map from the 2-second track: [{ session, points: [[x, y, t], ...] }]
export function routesFor(mapId, sessions, tracks) {
  const out = [];
  for (const s of sessions) {
    const raw = tracks?.get(s.id) || s.track || [];
    let run = null;
    for (const str of raw) {
      const p = parsePoint(str);
      if (p.map !== Number(mapId) || !(p.x > 0 || p.y > 0)) { if (run) { out.push(run); run = null; } continue; }
      if (run && p.t - run.last > 60) { out.push(run); run = null; }
      if (!run) run = { session: s.id, char: s.char?.name ?? null, points: [], last: p.t };
      run.points.push([p.x, p.y, p.t, p.flags]);
      run.last = p.t;
    }
    if (run) out.push(run);
  }
  return out.filter((r) => r.points.length > 1);
}

// Markers of one NPC on one map, grouped so a creature seen 40 times shows as
// a few clusters instead of 40 pins. Cell size in percent.
export function cluster(markers, cell = 2.5) {
  const cells = new Map();
  for (const mk of markers) {
    const key = `${mk.key ?? mk.label}|${Math.round(mk.x / cell)}|${Math.round(mk.y / cell)}`;
    let c = cells.get(key);
    if (!c) { c = { ...mk, n: 0, sx: 0, sy: 0, moments: [] }; cells.set(key, c); }
    c.n++;
    c.sx += mk.x;
    c.sy += mk.y;
    if (c.moments.length < 12) c.moments.push({ t: mk.t, footage: mk.footage, session: mk.session });
  }
  const pins = [...cells.values()].map((c) => ({ ...c, x: c.sx / c.n, y: c.sy / c.n }));
  return spread(pins);
}

// Different things at the same spot (a vendor and a trainer in one shop, a
// quest giver and the creature next to him) are fanned out in a small ring
// so every pin can be seen and clicked.
export function spread(pins, radius = 1.4) {
  const groups = new Map();
  for (const p of pins) {
    const key = `${Math.round(p.x / radius)}|${Math.round(p.y / radius)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const cx = group.reduce((n, p) => n + p.x, 0) / group.length;
    const cy = group.reduce((n, p) => n + p.y, 0) / group.length;
    group.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 2;
      const r = radius * (group.length > 6 ? 1.6 : 1);
      p.x = Math.min(100, Math.max(0, cx + Math.cos(angle) * r));
      p.y = Math.min(100, Math.max(0, cy + Math.sin(angle) * r * 1.5));
    });
  }
  return pins;
}

// Classic zone maps: the game's UiMap ID -> the older zone (area) ID that
// some map image hosts still use.
export const CLASSIC_ZONE_IDS = {
  1411: 14, 1412: 215, 1413: 17, 1414: 1637, 1415: 1638, 1416: 36, 1417: 45, 1418: 3, 1419: 4, 1420: 85, 1421: 130, 1422: 28,
  1423: 139, 1424: 267, 1425: 47, 1426: 1, 1427: 51, 1428: 46, 1429: 12, 1430: 41, 1431: 10, 1432: 38, 1433: 44, 1434: 33,
  1435: 8, 1436: 40, 1437: 11, 1438: 141, 1439: 148, 1440: 331, 1441: 400, 1442: 406, 1443: 405, 1444: 357, 1445: 15,
  1446: 440, 1447: 16, 1448: 361, 1449: 490, 1450: 493, 1451: 1377, 1452: 618, 1453: 1519, 1454: 1637, 1455: 1537,
  1456: 1638, 1457: 1657, 1458: 1497,
};

// Places a zone map image might be found, tried in order until one loads.
export function mapImageCandidates(mapId) {
  const ids = [mapId];
  if (CLASSIC_ZONE_IDS[mapId]) ids.push(CLASSIC_ZONE_IDS[mapId]);
  const out = [];
  for (const id of ids) {
    out.push(`https://wow.zamimg.com/images/wow/maps/enus/zoom/${id}.jpg`);
    out.push(`https://wow.zamimg.com/images/wow/maps/enus/original/${id}.jpg`);
    out.push(`https://wow.zamimg.com/images/wow/maps/enus/${id}.jpg`);
  }
  return out;
}

export function wowheadMapUrl(mapId) {
  return mapImageCandidates(mapId)[0];
}

// Density: points grouped into cells of `cell` percent, returning
// [{ x, y, n, w }] with w in 0..1 relative to the busiest cell.
export function heatCells(points, cell = 4) {
  const cells = new Map();
  for (const p of points) {
    if (p.x == null || p.y == null) continue;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    const key = `${cx}|${cy}`;
    const c = cells.get(key) || { x: (cx + 0.5) * cell, y: (cy + 0.5) * cell, n: 0 };
    c.n += p.w ?? 1;
    cells.set(key, c);
  }
  const max = Math.max(1, ...[...cells.values()].map((c) => c.n));
  return [...cells.values()].map((c) => ({ ...c, w: c.n / max }));
}

// Where a quest happened: pickup, objective progress, kills while it was
// active, turn-in, and the route walked in between. sessions must be the
// same character's, in order.
export function questTrail(quest, sessions, tracks, moment) {
  const start = quest.accepted[0]?.t ?? quest.offered[0]?.t;
  if (!start) return null;
  const end = quest.turnedIn[0]?.t ?? quest.abandoned[0]?.t ?? Infinity;
  const chars = new Set(quest.characters || []);
  const words = String(quest.objectives || '').toLowerCase().match(/[a-z']{4,}/g) || [];
  const objectives = [];
  const kills = new Map();
  const killSpots = [];
  const route = [];
  for (const s of sessions) {
    const who = s.char?.name ? `${s.char.name}-${s.char.realm ?? ''}` : 'unknown';
    if (chars.size && !chars.has(who)) continue;
    for (const e of s.events) {
      if (e.t < start || e.t > end) continue;
      if (e.e === 'objective' && e.text) {
        // Only progress lines that mention something from this quest's objectives.
        const text = e.text.toLowerCase();
        if (!words.length || words.some((w) => text.includes(w))) objectives.push({ text: e.text, ...moment(s, e) });
      } else if (e.e === 'kill' && e.name) {
        const k = kills.get(e.name) || { name: e.name, npcId: e.npcId ?? null, n: 0 };
        k.n++;
        kills.set(e.name, k);
        if (e.x != null) killSpots.push({ x: e.x, y: e.y, m: e.m, name: e.name, npcId: e.npcId ?? null, ...moment(s, e) });
      }
    }
    for (const str of (tracks?.get(s.id) || s.track || [])) {
      const p = parsePoint(str);
      if (p.t >= start && p.t <= end && (p.x > 0 || p.y > 0)) route.push(p);
    }
  }
  const mapCounts = new Map();
  for (const sp of [...quest.offered, ...quest.accepted, ...quest.turnedIn, ...killSpots, ...objectives]) if (sp.m) mapCounts.set(sp.m, (mapCounts.get(sp.m) || 0) + 1);
  const mapId = [...mapCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    start, end: end === Infinity ? null : end, mapId, objectives, killSpots,
    kills: [...kills.values()].sort((a, b) => b.n - a.n),
    routes: route.length > 1 ? [{ points: route.filter((p) => p.map === mapId).map((p) => [p.x, p.y, p.t, p.flags]) }] : [],
    minutes: end === Infinity ? null : Math.round((end - start) / 60),
  };
}

// Services (repair, innkeeper, trainer, flight master, vendor) nearest to a
// point on a map, from where you have seen them. Distances are in map
// percent; bearing is a compass direction.
export function nearestServices(people, mapId, x, y, limit = 8) {
  const out = [];
  for (const n of people) {
    const spots = n.spots.filter((sp) => sp.m === mapId);
    if (!spots.length) continue;
    const px = spots.reduce((a, sp) => a + sp.x, 0) / spots.length;
    const py = spots.reduce((a, sp) => a + sp.y, 0) / spots.length;
    const kinds = [];
    if (n.vendor?.repair) kinds.push('repair');
    if (n.vendor) kinds.push('vendor');
    if (n.trainer) kinds.push('trainer');
    if (n.taxi) kinds.push('flight');
    if (n.roles.includes('innkeeper')) kinds.push('inn');
    if (n.roles.includes('banker')) kinds.push('bank');
    if (n.quests?.size) kinds.push('quests');
    if (!kinds.length) continue;
    const dx = px - x;
    const dy = py - y;
    out.push({ key: n.key, name: n.name, titles: n.titles, kinds, x: px, y: py, dist: Math.hypot(dx, dy * 1.5), bearing: bearing(dx, dy) });
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
}

function bearing(dx, dy) {
  const dirs = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  const angle = Math.atan2(dy, dx);
  return dirs[Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
}

// GeoJSON of pins and routes. WoW map percentages become "coordinates":
// x as longitude, and 100 - y as latitude so the map is the right way up in
// ordinary viewers. properties.coordinate_system says so.
export function toGeoJSON({ name, mapId, zone, markers = [], routes = [] }) {
  const pos = (x, y) => [Number(x.toFixed(3)), Number((100 - y).toFixed(3))];
  const features = markers.map((mk) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: pos(mk.x, mk.y) },
    properties: { layer: mk.layer, label: mk.label, detail: mk.sub2 ?? null, subzone: mk.sub ?? null, count: mk.n ?? 1, time: mk.t ? new Date(mk.t * 1000).toISOString() : null, footage: mk.footage ? `${mk.footage.rec} @ ${mk.footage.offset.toFixed(2)}s` : null, wow_x: mk.x, wow_y: mk.y },
  }));
  routes.forEach((r, i) => features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: r.points.map(([x, y]) => pos(x, y)) },
    properties: { layer: 'route', segment: i + 1, character: r.char ?? null, points: r.points.length, start: r.points[0]?.[2] ? new Date(r.points[0][2] * 1000).toISOString() : null },
  }));
  return {
    type: 'FeatureCollection',
    name,
    properties: { map_id: mapId, zone, coordinate_system: 'World of Warcraft map percent: x east 0-100, y south 0-100 (stored as 100 - y)', generated: new Date().toISOString(), source: 'Chronicler' },
    features,
  };
}
