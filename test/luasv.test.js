import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedVariables } from '../companion/src/luasv.js';

test('parses WoW-style nested tables, arrays and comments', () => {
  const src = `
ChroniclerDB = {
	["schema"] = 1,
	["sessions"] = {
		{
			["id"] = "Mankrik-Aldric-1790000000",
			["events"] = {
				{
					["e"] = "kill",
					["t"] = 1790000004.125,
					["x"] = -12.5,
				}, -- [1]
			},
		}, -- [1]
	},
}
OtherVar = nil
`;
  const out = parseSavedVariables(src);
  assert.equal(out.ChroniclerDB.schema, 1);
  assert.ok(Array.isArray(out.ChroniclerDB.sessions));
  const ev = out.ChroniclerDB.sessions[0].events[0];
  assert.deepEqual(ev, { e: 'kill', t: 1790000004.125, x: -12.5 });
  assert.equal(out.OtherVar, null);
});

test('handles string escapes, long strings and odd keys', () => {
  const src = String.raw`X = {
    ["a"] = "line one\nline \"two\"\\ \65\066",
    ['b'] = 'single',
    c = [[long
string]],
    [5] = true,
    [2.5] = false,
    ["nested"] = { 1, 2, 3, },
    ["hex"] = 0x1F,
    ["exp"] = 1e3,
    ["empty"] = {},
  }`;
  const x = parseSavedVariables(src).X;
  assert.equal(x.a, 'line one\nline "two"\\ AB');
  assert.equal(x.b, 'single');
  assert.equal(x.c, 'long\nstring');
  assert.equal(x['5'], true);
  assert.equal(x['2.5'], false);
  assert.deepEqual(x.nested, [1, 2, 3]);
  assert.equal(x.hex, 31);
  assert.equal(x.exp, 1000);
  assert.deepEqual(x.empty, []);
});

test('sparse numeric keys become an object', () => {
  const x = parseSavedVariables('X = { [1] = "a", [3] = "c" }').X;
  assert.deepEqual(x, { 1: 'a', 3: 'c' });
});

test('keeps UTF-8 text intact', () => {
  const x = parseSavedVariables('X = { ["name"] = "Thrall, Warchief — Orgrimmar ✦ Ünterstadt" }').X;
  assert.equal(x.name, 'Thrall, Warchief — Orgrimmar ✦ Ünterstadt');
});

test('reports the line of a syntax error', () => {
  assert.throws(() => parseSavedVariables('X = {\n  ["a"] = @\n}'), /line 2/);
});
