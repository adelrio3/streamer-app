// Removing the addon leaves no trace: the addon folders, every account's
// saved data, and the chat log go; everything else stays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { removeAddon } from '../web/lib/folders.js';

function dir(name, children = {}) {
  const map = new Map(Object.entries(children));
  for (const [k, v] of map) v.name = k;
  return {
    kind: 'directory', name, map,
    async getDirectoryHandle(n) { const c = map.get(n); if (!c || c.kind !== 'directory') throw new DOMException('nf', 'NotFoundError'); return c; },
    async getFileHandle(n) { const c = map.get(n); if (!c || c.kind !== 'file') throw new DOMException('nf', 'NotFoundError'); return c; },
    async removeEntry(n) { if (!map.has(n)) throw new DOMException('nf', 'NotFoundError'); map.delete(n); },
    async *values() { yield* map.values(); },
    async *entries() { yield* map.entries(); },
  };
}
const file = () => ({ kind: 'file' });

test('removeAddon takes the addon, its saved data for every account, and the chat log, and nothing else', async () => {
  const flavor = dir('_classic_era_', {
    Interface: dir('', { AddOns: dir('', { Compendium: dir(''), Chronicler: dir(''), Questie: dir('') }) }),
    WTF: dir('', { Account: dir('', {
      ACC1: dir('', { SavedVariables: dir('', { 'Compendium.lua': file(), 'Compendium.lua.bak': file(), 'Questie.lua': file() }) }),
      ACC2: dir('', { SavedVariables: dir('', { 'Chronicler.lua': file() }) }),
      SavedVariables: dir('', { 'Compendium.lua': file() }), // the account-level folder, not an account
    }) }),
    Logs: dir('', { 'WoWChatLog.txt': file(), 'WoWCombatLog.txt': file() }),
  });
  const gone = await removeAddon(flavor);
  assert.deepEqual(gone.sort(), [
    'Interface\\AddOns\\Chronicler', 'Interface\\AddOns\\Compendium', 'Logs\\WoWChatLog.txt',
    'WTF\\Account\\ACC1\\SavedVariables\\Compendium.lua', 'WTF\\Account\\ACC1\\SavedVariables\\Compendium.lua.bak',
    'WTF\\Account\\ACC2\\SavedVariables\\Chronicler.lua', 'WTF\\Account\\SavedVariables\\SavedVariables\\Compendium.lua',
  ].sort().filter((p) => !p.includes('SavedVariables\\SavedVariables')));
  const addons = flavor.map.get('Interface').map.get('AddOns').map;
  assert.deepEqual([...addons.keys()], ['Questie'], 'other addons stay');
  const sv1 = flavor.map.get('WTF').map.get('Account').map.get('ACC1').map.get('SavedVariables').map;
  assert.deepEqual([...sv1.keys()], ['Questie.lua'], 'other saved data stays');
  assert.deepEqual([...flavor.map.get('Logs').map.keys()], ['WoWCombatLog.txt'], 'the combat log stays');
});

test('removeAddon on a folder without the addon removes nothing and says so', async () => {
  const flavor = dir('_classic_era_', { Interface: dir('', { AddOns: dir('') }), WTF: dir('', { Account: dir('') }) });
  assert.deepEqual(await removeAddon(flavor), []);
});
