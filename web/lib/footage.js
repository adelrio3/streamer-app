// Finding footage: stretches of recording that match what you want (UI hidden,
// mounted, dusk...) from the addon's 2-second position track, and highlights
// worth a short.

import { aligner } from './timeline.js';
import { describe } from './describe.js';

export const FLAGS = {
  mounted: 1, flight: 2, swimming: 4, indoors: 8, resting: 16, combat: 32, dead: 64, uiHidden: 128, stealth: 256, falling: 512, afk: 1024,
};

// "t,mapID,x,y,facing,speed,flags,gameMinutes,fps,latency"
export function parsePoint(str) {
  const p = String(str).split(',');
  return {
    t: Number(p[0]), map: p[1] ? Number(p[1]) : null, x: Number(p[2]), y: Number(p[3]), facing: Number(p[4]),
    speed: Number(p[5]), flags: Number(p[6]) || 0, gameMinutes: Number(p[7]), fps: Number(p[8]), latency: Number(p[9]),
  };
}

export function timeOfDay(gameMinutes) {
  const h = Math.floor((gameMinutes ?? 0) / 60) % 24;
  if (h >= 5 && h < 8) return 'dawn';
  if (h >= 8 && h < 18) return 'day';
  if (h >= 18 && h < 21) return 'dusk';
  return 'night';
}

const has = (p, flag) => (p.flags & flag) !== 0;

export function matches(p, f = {}) {
  if (f.ui === 'hidden' && !has(p, FLAGS.uiHidden)) return false;
  if (f.noCombat !== false && has(p, FLAGS.combat)) return false;
  if (has(p, FLAGS.dead) && f.allowDead !== true) return false;
  if (f.motion === 'moving' && !(p.speed > 0.1)) return false;
  if (f.motion === 'still' && p.speed > 0.1) return false;
  if (f.motion === 'mounted' && !has(p, FLAGS.mounted)) return false;
  if (f.motion === 'flight' && !has(p, FLAGS.flight)) return false;
  if (f.motion === 'foot' && (has(p, FLAGS.mounted) || has(p, FLAGS.flight) || !(p.speed > 0.1))) return false;
  if (f.motion === 'swimming' && !has(p, FLAGS.swimming)) return false;
  if (f.place === 'indoors' && !has(p, FLAGS.indoors)) return false;
  if (f.place === 'outdoors' && has(p, FLAGS.indoors)) return false;
  if (f.time && f.time !== 'any' && timeOfDay(p.gameMinutes) !== f.time) return false;
  if (f.map && p.map !== Number(f.map)) return false;
  return true;
}

// Zone names by map ID, learned from events.
export function zoneNames(sessions) {
  const names = new Map();
  for (const s of sessions) for (const e of s.events) if (e.m && e.z && !names.has(e.m)) names.set(e.m, e.z);
  return names;
}

// Matching stretches of recorded footage, longest first.
// tracks: Map<sessionId, string[]>; toMs(session, t) -> shared-clock ms.
export function findSegments(sessions, tracks, recordings, toMs, filters = {}) {
  const align = aligner(recordings);
  const minSeconds = Number(filters.minSeconds ?? 60);
  const zones = zoneNames(sessions);
  const out = [];
  for (const s of sessions) {
    const points = (tracks.get(s.id) || s.track || []).map(parsePoint).filter((p) => Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
    let run = null;
    const close = () => {
      if (run && run.to - run.from >= minSeconds) out.push(run);
      run = null;
    };
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const hit = align(toMs(s, p.t));
      const ok = hit && matches(p, filters);
      // Points are every 2 s while moving, every 30 s standing still.
      const continues = run && ok && hit.recording.id === run.rec && p.t - run.lastT <= 32;
      if (!continues) close();
      if (!ok) continue;
      if (!run) {
        run = { rec: hit.recording.id, recName: hit.recording.name, session: s.id, char: s.char?.name ?? null, from: hit.offset, to: hit.offset, lastT: p.t, t: p.t, maps: new Map(), flags: 0, times: new Set(), speedSum: 0, n: 0 };
      }
      run.to = hit.offset + 2;
      run.lastT = p.t;
      run.flags |= p.flags;
      run.times.add(timeOfDay(p.gameMinutes));
      run.speedSum += p.speed;
      run.n++;
      if (p.map) run.maps.set(p.map, (run.maps.get(p.map) || 0) + 1);
    }
    close();
  }
  return out.map((r) => ({
    rec: r.rec, recName: r.recName, session: r.session, char: r.char, from: r.from, to: r.to, duration: r.to - r.from, t: r.t,
    zones: [...r.maps.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => zones.get(m) ?? `Map ${m}`),
    mounted: (r.flags & FLAGS.mounted) !== 0, flight: (r.flags & FLAGS.flight) !== 0, uiHidden: (r.flags & FLAGS.uiHidden) !== 0,
    indoors: (r.flags & FLAGS.indoors) !== 0, swimming: (r.flags & FLAGS.swimming) !== 0,
    times: [...r.times], avgSpeed: r.n ? r.speedSum / r.n : 0,
  })).sort((a, b) => b.duration - a.duration);
}

export const HIGHLIGHT_KINDS = {
  close: 'Close calls', death: 'Deaths', rare: 'Rare sightings', elite: 'Elite and boss fights', brawl: 'Big fights',
  loot: 'Great loot', level: 'Level ups', discovery: 'Discoveries', mark: 'Marks',
};

// Moments worth a short. quality(itemId) -> item quality or null.
export function findHighlights(sessions, moment, quality = () => null) {
  const out = [];
  const push = (kind, s, e, label, extra = {}) => out.push({ kind, label, char: s.char?.name ?? null, zone: e.z ?? null, ...moment(s, e), ...extra });
  for (const s of sessions) {
    for (const e of s.events) {
      switch (e.e) {
        case 'fight': {
          const ranks = (e.enemies || []).map((x) => x.rank).filter(Boolean);
          if (e.close) push('close', s, e, describe(e), { score: 100 - (e.minHp ?? 0) });
          if (ranks.some((r) => r !== 'minus' && r !== 'trivial')) push('elite', s, e, describe(e));
          if (new Set((e.enemies || []).map((x) => x.name)).size >= 3 || (e.enemies || []).length >= 3) push('brawl', s, e, describe(e));
          break;
        }
        case 'death': push('death', s, e, describe(e)); break;
        case 'npc': if (e.rare) push('rare', s, e, describe(e)); break;
        case 'level': push('level', s, e, describe(e)); break;
        case 'explore': push('discovery', s, e, describe(e)); break;
        case 'mark': push('mark', s, e, describe(e)); break;
        case 'loot': {
          const q = e.q ?? quality(e.id);
          if (q >= 3) push('loot', s, e, describe(e), { quality: q });
          break;
        }
        default:
      }
    }
  }
  return out.sort((a, b) => b.t - a.t);
}
