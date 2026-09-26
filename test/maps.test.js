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
const log = readAddonLog(fs.readFileSync(path.join(here, 'fixtures', 'Chronicler.lua'), 'utf8'));
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
  assert.equal(m.counts.death, undefined, 'the death had no coordinates, so no pin');
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
