// One-line, human-readable descriptions of logged events, used for markers,
// subtitles and the web UI.

const QUALITY = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom'];

export function qualityName(q) {
  return QUALITY[q] ?? null;
}

export function describe(e) {
  switch (e.e) {
    case 'session_start': return `Session start${e.z ? ` in ${place(e)}` : ''}`;
    case 'session_end': return 'Session end';
    case 'zone': return `Entered ${place(e)}`;
    case 'explore': return `Discovered ${e.area}`;
    case 'quest_detail': return `Quest offered: ${e.title ?? '?'}${e.npc ? ` (${e.npc})` : ''}`;
    case 'quest_accept': return `Accepted: ${e.title ?? `quest ${e.qid}`}`;
    case 'objective': return e.text;
    case 'quest_progress': return `Returned to ${e.npc ?? 'quest giver'}: ${e.title ?? ''}`.trim();
    case 'quest_complete': return `Completing: ${e.title ?? ''}`.trim();
    case 'quest_turnin': return `Turned in: ${e.title ?? `quest ${e.qid}`}`;
    case 'quest_abandon': return `Abandoned: ${e.title ?? '?'}`;
    case 'gossip': return `${e.npc ?? 'NPC'}: ${clip(e.text || (e.options || []).join(' / '))}`;
    case 'speech': return `${e.speaker ?? 'NPC'} ${speechVerb(e.kind)}: ${clip(e.text)}`;
    case 'book': return `Read: ${e.title ?? 'text'}`;
    case 'kill': return `Killed ${e.name ?? 'something'}`;
    case 'loot': {
      const verb = e.src === 'created' ? 'Created' : e.src === 'received' ? 'Received' : 'Looted';
      return `${verb} ${e.name ?? `item ${e.id}`}${e.n > 1 ? ` x${e.n}` : ''}`;
    }
    case 'skill': return e.text;
    case 'learn': return `Learned ${e.what}`;
    case 'level': return `Reached level ${e.level}`;
    case 'death': return e.killer ? `Killed by ${e.killer}${e.by && e.by !== 'Melee' ? ` (${e.by})` : ''}` : 'Died';
    case 'npc': return `Saw ${e.name ?? 'someone'}${e.level ? ` (level ${e.level}${e.rank ? ` ${RANKS[e.rank] ?? e.rank}` : ''})` : ''}${e.title ? ` <${e.title}>` : ''}`;
    case 'loot_window': {
      const from = (e.sources || []).map((x) => x.name).filter(Boolean).join(', ');
      const what = (e.items || []).map((i) => `${i.name ?? `item ${i.id}`}${i.n > 1 ? ` x${i.n}` : ''}`);
      if (e.money) what.push(e.money);
      return `Loot${from ? ` from ${from}` : ''}: ${what.join(', ') || 'nothing'}`;
    }
    case 'vendor': return `Vendor ${e.npc ?? ''}: ${(e.items || []).length} items for sale`;
    case 'trainer': return `Trainer ${e.npc ?? ''}: ${(e.services || []).length} services`;
    case 'taxi_map': return `Flight master ${e.npc ?? ''}`;
    case 'flight': return `Flying to ${e.to ?? '?'}`;
    case 'flight_end': return 'Landed';
    case 'bind': return `Hearthstone set to ${e.where ?? '?'}`;
    case 'fight': {
      const who = [...new Set((e.enemies || []).map((x) => x.name).filter(Boolean))];
      return `Fight: ${who.slice(0, 3).join(', ') || 'unknown'}${who.length > 3 ? ` +${who.length - 3}` : ''} (${e.dur ?? 0}s${e.close ? `, close call at ${e.minHp}%` : ''})`;
    }
    case 'equip': return e.id ? `Equipped ${e.name ?? `item ${e.id}`}` : `Unequipped ${SLOT_NAMES[e.slot] ?? 'item'}`;
    case 'gear': return 'Gear';
    case 'talents': return 'Talents';
    case 'stats': return 'Stats';
    case 'reputation': return 'Reputation standings';
    case 'skills': return 'Skills';
    case 'bags': return 'Bags';
    case 'money': return `${e.delta >= 0 ? '+' : '−'}${money(Math.abs(e.delta))}${e.ctx ? ` (${e.ctx})` : ''}`;
    case 'xp': return e.text ?? `+${e.amount} XP`;
    case 'rep': return e.text;
    case 'played': return 'Time played';
    case 'screenshot': return `Screenshot${e.reason && e.reason !== 'manual' ? ` (${e.reason})` : ''}`;
    case 'chat': return `[${e.ch}] ${e.from ?? ''}: ${clip(e.text)}`;
    case 'group': return `Group: ${(e.members || []).map((m) => m.name).join(', ') || 'solo'}`;
    case 'duel': return `Duel with ${e.with ?? '?'}`;
    case 'duel_end': return 'Duel over';
    case 'cinematic_start': return 'Cinematic';
    case 'cinematic_stop': return 'Cinematic ended';
    case 'movie': return 'Movie';
    case 'sync': return 'Sync flash';
    case 'mark': return `${MARK_NAMES[e.kind] ?? 'Mark'}${e.note ? `: ${e.note}` : ''}`;
    default: return e.e;
  }
}

export const RANKS = { elite: 'elite', rare: 'rare', rareelite: 'rare elite', worldboss: 'boss', minus: 'minor', trivial: 'trivial' };

export const SLOT_NAMES = {
  1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist', 10: 'Hands',
  11: 'Finger', 12: 'Finger', 13: 'Trinket', 14: 'Trinket', 15: 'Back', 16: 'Main hand', 17: 'Off hand', 18: 'Ranged', 19: 'Tabard',
};

// 12345 copper -> "1g 23s 45c"
export function money(copper) {
  const c = Math.round(Math.abs(copper ?? 0));
  const g = Math.floor(c / 10000);
  const s = Math.floor((c % 10000) / 100);
  const parts = [];
  if (g) parts.push(`${g}g`);
  if (s) parts.push(`${s}s`);
  if (c % 100 || !parts.length) parts.push(`${c % 100}c`);
  return parts.join(' ');
}

export const MARK_NAMES = { lore: 'Lore beat', shot: 'Beautiful shot', funny: 'Funny', redo: 'Redo', mark: 'Mark' };

// Rough grouping for filters and marker colours.
const CATEGORY = {
  objective: 'quest', gossip: 'lore', speech: 'lore', book: 'lore', cinematic_start: 'lore', cinematic_stop: 'lore', movie: 'lore',
  kill: 'combat', death: 'combat', fight: 'combat',
  loot: 'loot', loot_window: 'loot',
  mark: 'mark', sync: 'mark', screenshot: 'mark',
  zone: 'travel', explore: 'travel', session_start: 'travel', session_end: 'travel', flight: 'travel', flight_end: 'travel', bind: 'travel',
  npc: 'world',
  vendor: 'economy', trainer: 'economy', taxi_map: 'economy', money: 'economy',
  equip: 'character', gear: 'character', talents: 'character', stats: 'character', reputation: 'character', skills: 'character',
  bags: 'character', xp: 'character', rep: 'character', played: 'character',
  chat: 'social', group: 'social', duel: 'social', duel_end: 'social',
};

export function category(e) {
  if (e.e.startsWith('quest')) return 'quest';
  return CATEGORY[e.e] ?? 'progress';
}

export function place(e) {
  return e.sz && e.sz !== e.z ? `${e.z}: ${e.sz}` : (e.z || 'somewhere');
}

function speechVerb(kind) {
  return { yell: 'yells', emote: '', whisper: 'whispers', boss_emote: '', boss_whisper: 'whispers' }[kind] ?? 'says';
}

function clip(text, n = 90) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
