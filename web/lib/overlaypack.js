// Overlay pack for Premiere: transparent PNG stills (item cards, quest and
// level banners, a kill counter) rendered at the sequence size, and an FCP7
// XML sequence that lays them on video tracks above the recording at the
// right frames. Import the XML into Premiere and every overlay is already in
// place.

import { fileURL, stem } from './exports.js';

export const QUALITY_COLORS = ['#9d9d9d', '#ffffff', '#1eff00', '#0070dd', '#a335ee', '#ff8000', '#e6cc80'];
const QUALITY = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact'];
export const CORNERS = { tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' };

// Which stills a recording needs and when. timeline: the recording's events
// (offset in seconds). Returns { stills: Map<file, spec>, clips: [{ file, start, end, track }] }.
export function planOverlays(timeline, {
  drops = true, minQuality = 2, quests = true, levels = true, kills = true, killsBefore = 0, cardSeconds = 4, duration = Infinity,
} = {}) {
  const stills = new Map();
  const clips = [];
  const add = (file, spec, start, end) => {
    if (!stills.has(file)) stills.set(file, spec);
    clips.push({ file, start, end: Math.min(end, duration), kind: spec.kind });
  };
  let killCount = killsBefore;
  const killEvents = timeline.filter((e) => e.e === 'kill');
  for (const e of timeline) {
    if (drops && e.e === 'loot' && e.id && (e.q ?? 1) >= minQuality && e.src !== 'created') {
      add(`item-${e.id}${e.n > 1 ? `-x${e.n}` : ''}.png`, { kind: 'item', id: e.id, name: e.name, q: e.q ?? 1, n: e.n || 1, source: e.source ?? null }, e.offset, e.offset + cardSeconds);
    } else if (quests && e.e === 'quest_turnin') {
      add(`quest-${e.qid ?? stem(String(e.title || 'quest')).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, { kind: 'quest', title: e.title || 'Quest complete', sub: 'Quest complete' }, e.offset, e.offset + cardSeconds);
    } else if (levels && e.e === 'level') {
      add(`level-${e.level}.png`, { kind: 'level', title: `Level ${e.level}`, sub: 'ding' }, e.offset, e.offset + cardSeconds + 1);
    }
  }
  if (kills && killEvents.length) {
    killEvents.forEach((e, i) => {
      killCount++;
      const next = killEvents[i + 1];
      add(`kills-${killCount}.png`, { kind: 'kills', value: killCount }, e.offset, next ? next.offset : duration);
    });
  }
  // Cards that would overlap go on the next track up (at most four).
  const lanes = [[], [], [], []];
  for (const c of clips.filter((x) => x.kind !== 'kills').sort((a, b) => a.start - b.start)) {
    const lane = lanes.findIndex((l) => !l.length || l.at(-1).end <= c.start);
    const i = lane < 0 ? 3 : lane;
    if (lane < 0) lanes[3].at(-1).end = Math.min(lanes[3].at(-1).end, c.start);
    c.track = 2 + i;
    lanes[i].push(c);
  }
  const killClips = clips.filter((x) => x.kind === 'kills');
  for (const c of killClips) c.track = 2 + lanes.filter((l) => l.length).length;
  return { stills, clips: clips.filter((c) => c.end > c.start) };
}

// Draws one still on a canvas of the sequence size. ctx: a 2D context.
// spec: from planOverlays. icon: an Image or null. corner: tl/tr/bl/br.
export function drawStill(ctx, spec, { width, height, corner = 'br', icon = null, font = 'Inter, Arial, sans-serif', serif = '"Cormorant Garamond", Georgia, serif', margin = 48 } = {}) {
  ctx.clearRect(0, 0, width, height);
  const round = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  const place = (w, h) => ({ x: corner.endsWith('l') ? margin : width - margin - w, y: corner.startsWith('t') ? margin : height - margin - h });
  if (spec.kind === 'item') {
    const color = QUALITY_COLORS[spec.q] ?? '#fff';
    const w = 640; const h = 150;
    const { x, y } = place(w, h);
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(12, 9, 5, .88)';
    round(x, y, w, h, 18); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.globalAlpha = .7; round(x, y, w, h, 18); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = color; round(x, y, 8, h, 4); ctx.fill();
    const ix = x + 24; const iy = y + 21; const is = 108;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; round(ix, iy, is, is, 12); ctx.fill();
    if (icon) {
      ctx.save(); round(ix + 3, iy + 3, is - 6, is - 6, 10); ctx.clip(); ctx.drawImage(icon, ix + 3, iy + 3, is - 6, is - 6); ctx.restore();
    } else {
      ctx.fillStyle = color; ctx.font = `600 56px ${serif}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((spec.name || '?')[0].toUpperCase(), ix + is / 2, iy + is / 2 + 4);
    }
    ctx.lineWidth = 2; ctx.strokeStyle = color; round(ix, iy, is, is, 12); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color; ctx.font = `700 44px ${serif}`;
    const name = spec.n > 1 ? `${spec.name} ×${spec.n}` : spec.name;
    ctx.fillText(fit(ctx, name, w - is - 70), ix + is + 22, y + 72);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = `500 22px ${font}`;
    ctx.fillText(spec.source ? `from ${spec.source}` : QUALITY[spec.q] ?? '', ix + is + 22, y + 110);
  } else if (spec.kind === 'quest' || spec.kind === 'level') {
    const gold = '#ffd77a';
    const w = Math.min(width - 2 * margin, 900); const h = 130;
    const x = (width - w) / 2; const y = corner.startsWith('t') ? margin : height - margin - h;
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = 'rgba(12, 9, 5, .85)'; round(x, y, w, h, 18); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = gold; ctx.globalAlpha = .6; ctx.lineWidth = 2; round(x, y, w, h, 18); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = gold; ctx.font = `700 ${spec.kind === 'level' ? 64 : 48}px ${serif}`;
    ctx.fillText(fit(ctx, spec.title, w - 60), x + w / 2, y + (spec.kind === 'level' ? 78 : 66));
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `600 20px ${font}`;
    ctx.fillText(spec.sub.toUpperCase(), x + w / 2, y + h - 26);
  } else if (spec.kind === 'kills') {
    const w = 300; const h = 120;
    const { x, y } = place(w, h);
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(12, 9, 5, .82)'; round(x, y, w, h, 16); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(232,182,74,.5)'; ctx.lineWidth = 2; round(x, y, w, h, 16); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8b64a'; ctx.font = `700 16px ${font}`;
    ctx.fillText('K I L L S', x + 24, y + 38);
    ctx.fillStyle = '#ffd77a'; ctx.font = `700 64px ${serif}`;
    ctx.fillText(spec.value.toLocaleString(), x + 24, y + 98);
  }
}

function fit(ctx, text, maxWidth) {
  let t = String(text ?? '');
  while (t.length > 3 && ctx.measureText(t).width > maxWidth) t = `${t.slice(0, -2)}…`;
  return t;
}

// The sequence: the recording on V1 and A1, every still on the tracks above.
// folder: where the PNGs will live on the editing computer.
export function toOverlayXML(recording, clips, { fps = 60, width = 1920, height = 1080, folder = '' } = {}) {
  const timebase = Math.round(fps);
  const ntsc = Math.abs(fps - timebase) > 0.001 ? 'TRUE' : 'FALSE';
  const frames = (sec) => Math.round(sec * fps);
  const duration = frames(recording.duration);
  const rate = `<rate><timebase>${timebase}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const name = xml(recording.name);
  const chars = `<samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics>`;
  const file = `<file id="file-1"><name>${name}</name><pathurl>${xml(fileURL(recording.path || recording.name))}</pathurl>${rate}<duration>${duration}</duration><media><video>${chars}</video><audio><channelcount>2</channelcount></audio></media></file>`;
  const main = (id, mediaFile, extra = '') => `<clipitem id="${id}"><name>${name}</name><duration>${duration}</duration>${rate}<start>0</start><end>${duration}</end><in>0</in><out>${duration}</out>${mediaFile}${extra}</clipitem>`;
  const base = folder ? `${folder.replace(/[\\/]+$/, '')}/` : '';
  const fileIds = new Map();
  const stillClip = (c, i) => {
    const start = frames(c.start);
    const end = Math.max(start + 1, frames(c.end));
    const len = end - start;
    let fileXml;
    if (fileIds.has(c.file)) fileXml = `<file id="${fileIds.get(c.file)}"/>`;
    else {
      const id = `still-${fileIds.size + 1}`;
      fileIds.set(c.file, id);
      fileXml = `<file id="${id}"><name>${xml(c.file)}</name><pathurl>${xml(fileURL(`${base}${c.file}`))}</pathurl>${rate}<duration>${Math.max(len, frames(10))}</duration><media><video>${chars}</video></media></file>`;
    }
    return `<clipitem id="overlay-${i + 1}"><name>${xml(c.file)}</name><duration>${len}</duration>${rate}<start>${start}</start><end>${end}</end><in>0</in><out>${len}</out>${fileXml}<compositemode>normal</compositemode></clipitem>`;
  };
  const tracks = new Map();
  clips.forEach((c, i) => { if (!tracks.has(c.track)) tracks.set(c.track, []); tracks.get(c.track).push(stillClip(c, i)); });
  const overlayTracks = [...tracks.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => `<track>${list.join('')}</track>`).join('\n        ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xml(`Chronicler overlays - ${stem(recording.name)}`)}</name>
    <duration>${duration}</duration>
    ${rate}
    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format>${chars}</format>
        <track>${main('clipitem-1', file)}</track>
        ${overlayTracks}
      </video>
      <audio>
        <track>${main('clipitem-2', '<file id="file-1"/>', '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>')}</track>
      </audio>
    </media>
  </sequence>
</xmeml>
`;
}

export function packReadme(recording, folder, count) {
  return `Chronicler overlay pack for ${recording.name}

${count} PNG stills in overlays/ (transparent, ${'1920×1080'}) and ${stem(recording.name)}.overlays.xml.

1. Unzip. Put the overlays folder at:
   ${folder || '(the folder you entered in Chronicler)'}
   The XML points there; if you put it elsewhere, Premiere will ask you to locate the first file and then finds the rest.
2. In Premiere: File > Import, choose the .xml. A sequence appears with the recording on V1 and every overlay on the tracks above, already at the right time.
3. Slide, trim or delete any of them like normal clips.

Item cards last a few seconds; the kill counter changes with every kill.
`;
}

const ICON_CACHE = new Map();

// Wowhead's item data, for the icon name (nether.wowhead.com allows this).
export async function iconName(itemId, fetchFn = globalThis.fetch) {
  if (ICON_CACHE.has(itemId)) return ICON_CACHE.get(itemId);
  let icon = null;
  try {
    const res = await fetchFn(`https://nether.wowhead.com/tooltip/item/${itemId}?dataEnv=4&locale=0`);
    if (res.ok) icon = (await res.json()).icon ?? null;
  } catch { icon = null; }
  ICON_CACHE.set(itemId, icon);
  return icon;
}

export function iconUrl(icon) {
  return `https://wow.zamimg.com/images/wow/icons/large/${icon}.jpg`;
}

function xml(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
