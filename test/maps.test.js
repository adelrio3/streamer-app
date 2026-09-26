import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAddonLog } from '../web/lib/sessions.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCodex } from '../web/lib/codex.js';
import { buildMaps, routesFor, cluster, spread } from '../web/lib/maps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Compendium.lua'), 'utf8'));
const moment = (s, e) => ({ session: s.id, t: e.t, footage: null });

test('bestiary holds only what you can fight; people are everyone else', () => {
  const world = buildWorld(log.sessions, log.items, moment);
  assert.deepEqual(world.creatures.map((n) => n.name).sort(), ['Defias Thug', 'Hogger', 'Kobold Vermin', 'Kobold Worker', 'Mother Fang', 'Young Wolf']);
  assert.deepEqual(world.people.map((n) => [n.name, n.roles]), [['Deputy Willem', ['quest']], ['Marshal McBride', ['talker']], ['Brother Danil', ['vendor', 'trainer', 'taxi']]]);
  assert.ok(world.byNpc.get('n6').spots.length >= 3, 'every sighting keeps its coordinates');
  assert.equal(world.byNpc.get('n6').spots[0].x, 48);
});

test('maps collect pins per zone map, with a route from the track', () => {
  const world = buildWorld(log.sessions, log.items, moment);
  const codex = buildCodex(log.sessions);
  const maps = buildMaps(log.sessions, world, codex, moment);
  assert.equal(maps.length, 1);
  const m = maps[0];
  assert.equal(m.id, 1429);
  assert.equal(m.zone, 'Elwynn Forest');
  assert.ok(m.counts.quest >= 2, 'quest offered and turned in');
  assert.ok(m.counts.creature >= 5);
  assert.ok(m.counts.vendor >= 1);
  assert.equal(m.counts.death, 1, 'the close call has coordinates; the death itself had none');
  const pins = cluster(m.markers);
  assert.ok(pins.length < m.markers.length, 'repeated sightings cluster');
  const kobold = pins.find((p) => p.key === 'n6');
  assert.ok(kobold.n >= 3);
  const routes = routesFor(1429, log.sessions, new Map());
  assert.equal(routes.length, 1);
  assert.ok(routes[0].points.length >= 3);
});

test('pins at the same spot are fanned out so all can be clicked', () => {
  const pins = spread([{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50.2, y: 49.9 }, { x: 10, y: 10 }]);
  const keys = new Set(pins.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
  assert.equal(keys.size, 4);
  assert.deepEqual(pins[3], { x: 10, y: 10 }, 'a lone pin stays put');
});

test('quest trail: pickup, kills while active, objective progress, turn-in', async () => {
  const { questTrail, heatCells } = await import('../web/lib/maps.js');
  const sessions = log.sessions;
  const moment = (s, e) => ({ session: s.id, t: e.t, footage: null, m: e.m ?? null, x: e.x ?? null, y: e.y ?? null, z: e.z ?? null, sz: e.sz ?? null });
  const codex = buildCodex(sessions);
  const q = codex.quests.find((x) => x.qid === 7);
  const trail = questTrail(q, sessions, new Map(), moment);
  assert.equal(trail.mapId, 1429);
  assert.deepEqual(trail.kills, [{ name: 'Kobold Vermin', npcId: 6, n: 2 }], 'only kills between accept and turn-in');
  assert.equal(trail.objectives.length, 1);
  assert.match(trail.objectives[0].text, /Kobold Vermin slain/);
  assert.equal(trail.killSpots.length, 2);
  assert.ok(trail.minutes >= 0);
  const heat = heatCells(trail.killSpots, 3);
  assert.equal(heat.length, 1);
  assert.equal(heat[0].w, 1);
  assert.equal(heatCells([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 50, y: 50 }], 4)[1].w, 0.5);
});

test('nearest services, GeoJSON and loose ends', async () => {
  const { nearestServices, toGeoJSON } = await import('../web/lib/maps.js');
  const { looseEnds } = await import('../web/lib/coverage.js');
  const world = buildWorld(log.sessions, log.items, moment);
  const codex = buildCodex(log.sessions);
  // Danil stands at (46, 42), Willem at (48, 42): from (40, 42) Danil is closer.
  const near = nearestServices(world.people, 1429, 40, 42);
  assert.equal(near[0].name, 'Brother Danil');
  assert.deepEqual(near[0].kinds, ['repair', 'vendor', 'trainer', 'flight']);
  assert.equal(near[0].bearing, 'E');
  assert.ok(near[0].dist > 5 && near[0].dist < 7);
  assert.equal(nearestServices(world.people, 1429, 60, 42)[0].name, 'Deputy Willem');
  assert.ok(near.some((n) => n.name === 'Deputy Willem' && n.kinds.includes('quests')));

  const maps = buildMaps(log.sessions, world, codex, moment);
  const geo = toGeoJSON({ name: 'Elwynn', mapId: 1429, zone: 'Elwynn Forest', markers: cluster(maps[0].markers), routes: routesFor(1429, log.sessions, new Map()) });
  assert.equal(geo.type, 'FeatureCollection');
  const line = geo.features.find((f) => f.geometry.type === 'LineString');
  assert.ok(line && line.geometry.coordinates.length >= 3);
  const point = geo.features.find((f) => f.geometry.type === 'Point');
  assert.equal(point.geometry.coordinates[1], Number((100 - point.properties.wow_y).toFixed(3)), 'y is flipped so the map is upright');

  const le = looseEnds('Elwynn Forest', codex, world);
  assert.deepEqual(le.quests.map((q) => q.title), [], 'the one quest was turned in');
  assert.ok(le.creatures.some((n) => n.name === 'Hogger'), 'seen but never killed');
  assert.ok(le.rares.some((n) => n.name === 'Mother Fang'));
  assert.equal(le.total, le.quests.length + le.creatures.length + le.shops.length + le.trainers.length);
});
