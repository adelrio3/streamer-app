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
    case 'death': return 'Died';
    case 'cinematic_start': return 'Cinematic';
    case 'cinematic_stop': return 'Cinematic ended';
    case 'movie': return 'Movie';
    case 'mark': return `${MARK_NAMES[e.kind] ?? 'Mark'}${e.note ? `: ${e.note}` : ''}`;
    default: return e.e;
  }
}

export const MARK_NAMES = { lore: 'Lore beat', shot: 'Beautiful shot', funny: 'Funny', redo: 'Redo', mark: 'Mark' };

// Rough grouping for filters and marker colours.
export function category(e) {
  if (e.e.startsWith('quest') || e.e === 'objective') return 'quest';
  if (['gossip', 'speech', 'book', 'cinematic_start', 'cinematic_stop', 'movie'].includes(e.e)) return 'lore';
  if (e.e === 'kill' || e.e === 'death') return 'combat';
  if (e.e === 'loot') return 'loot';
  if (e.e === 'mark') return 'mark';
  if (['zone', 'explore', 'session_start', 'session_end'].includes(e.e)) return 'travel';
  return 'progress';
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
