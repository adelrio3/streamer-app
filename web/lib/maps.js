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
  death: { name: 'Deaths', color: '#ff4d4d' },
  mark: { name: 'Marks & screenshots', color: '#b48cf0' },
  route: { name: 'Your route', color: '#f2cc6b' },
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
