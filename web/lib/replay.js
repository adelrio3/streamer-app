// Route replay: the route you walked on a map, drawn in over a few seconds
// as B-roll. The planning and drawing are here (pure, on any 2D context);
// the map page records the frames to a WebM or a PNG sequence.

// routes: from routesFor (points [x, y, t, flags] in map percent and
// seconds). Returns the timeline the replay plays: every route laid end to
// end in time order, with idle gaps squeezed to `gap` seconds.
export function planReplay(routes, { seconds = 8, fps = 30, gap = 2 } = {}) {
  const runs = routes.filter((r) => r.points.length > 1).slice().sort((a, b) => a.points[0][2] - b.points[0][2]);
  const segments = [];
  let clock = 0;
  for (const r of runs) {
    const t0 = r.points[0][2];
    const points = r.points.map(([x, y, t, f]) => ({ x, y, t: clock + (t - t0), f }));
    const end = points.at(-1).t;
    segments.push({ char: r.char ?? null, points, from: clock, to: end });
    clock = end + gap;
  }
  const total = Math.max(1, clock - gap);
  return { segments, total, seconds, fps, frames: Math.max(1, Math.round(seconds * fps)) };
}

// What is drawn at `progress` (0..1): each segment's points so far, and the
// head (the last point reached, interpolated).
export function routeAt(plan, progress) {
  const now = Math.max(0, Math.min(1, progress)) * plan.total;
  const out = [];
  for (const s of plan.segments) {
    if (s.from > now) continue;
    const pts = [];
    let head = null;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      if (p.t <= now) { pts.push(p); head = p; continue; }
      const prev = s.points[i - 1];
      if (prev && now > prev.t) {
        const k = (now - prev.t) / Math.max(0.001, p.t - prev.t);
        head = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k, t: now };
        pts.push(head);
      }
      break;
    }
    out.push({ char: s.char, points: pts, head, live: now <= s.to });
  }
  return out;
}

// Draws one frame. image: the map image (already loaded) or null; the route
// is drawn in map percent scaled to the canvas.
export function drawReplayFrame(ctx, { width, height, image, plan, progress, color = '#f2cc6b', glow = 'rgba(242, 204, 107, .55)', lineWidth = 4, headRadius = 7, dim = 0.25 }) {
  ctx.clearRect(0, 0, width, height);
  if (image) ctx.drawImage(image, 0, 0, width, height);
  else { ctx.fillStyle = '#0b0d12'; ctx.fillRect(0, 0, width, height); }
  if (dim > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${dim})`; ctx.fillRect(0, 0, width, height); }
  const sx = width / 100; const sy = height / 100;
  const drawn = routeAt(plan, progress);
  for (const seg of drawn) {
    if (seg.points.length < 2) continue;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    seg.points.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy)));
    ctx.strokeStyle = glow; ctx.lineWidth = lineWidth * 3; ctx.globalAlpha = 0.5; ctx.stroke();
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  }
  const head = drawn.filter((s) => s.live && s.head).at(-1)?.head;
  if (head) {
    ctx.beginPath(); ctx.arc(head.x * sx, head.y * sy, headRadius * 2.2, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();
    ctx.beginPath(); ctx.arc(head.x * sx, head.y * sy, headRadius, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke();
  }
  return drawn;
}

// Eases the replay: quick start, gentle finish.
export function easeProgress(frame, frames) {
  const t = frames <= 1 ? 1 : frame / (frames - 1);
  return 1 - Math.pow(1 - t, 2.2);
}
