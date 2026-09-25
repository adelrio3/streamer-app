// Parser for the Lua files WoW writes to WTF/Account/<account>/SavedVariables.
// They are a series of `Name = value` assignments where values are strings,
// numbers, booleans, nil or tables. Tables whose keys are exactly 1..n become
// arrays; everything else becomes a plain object.

export function parseSavedVariables(source) {
  const p = new Parser(source);
  const result = {};
  p.skip();
  while (!p.done()) {
    const name = p.identifier();
    p.skip();
    p.expect('=');
    result[name] = p.value();
    p.skip();
    if (p.peek() === ';') { p.pos++; p.skip(); }
  }
  return result;
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };

class Parser {
  constructor(src) {
    this.src = src;
    this.pos = 0;
  }

  done() { return this.pos >= this.src.length; }
  peek() { return this.src[this.pos]; }

  fail(msg) {
    const before = this.src.slice(0, this.pos);
    const line = before.split('\n').length;
    throw new Error(`SavedVariables parse error at line ${line}: ${msg}`);
  }

  expect(ch) {
    if (this.src[this.pos] !== ch) this.fail(`expected "${ch}", found "${this.src[this.pos] ?? 'end of file'}"`);
    this.pos++;
  }

  // Whitespace and comments (`-- [1]`, `--[[ ... ]]`).
  skip() {
    const s = this.src;
    for (;;) {
      while (this.pos < s.length && /\s/.test(s[this.pos])) this.pos++;
      if (s.startsWith('--', this.pos)) {
        const block = s.slice(this.pos + 2).match(/^\[(=*)\[/);
        if (block) {
          const close = `]${block[1]}]`;
          const end = s.indexOf(close, this.pos);
          this.pos = end === -1 ? s.length : end + close.length;
        } else {
          const nl = s.indexOf('\n', this.pos);
          this.pos = nl === -1 ? s.length : nl + 1;
        }
        continue;
      }
      return;
    }
  }

  identifier() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.pos, this.pos + 256));
    if (!m) this.fail('expected a variable name');
    this.pos += m[0].length;
    return m[0];
  }

  value() {
    this.skip();
    const ch = this.peek();
    if (ch === '{') return this.table();
    if (ch === '"' || ch === "'") return this.string();
    if (ch === '[' && /^\[=*\[/.test(this.src.slice(this.pos, this.pos + 64))) return this.longString();
    const rest = this.src.slice(this.pos, this.pos + 32);
    for (const [word, val] of [['true', true], ['false', false], ['nil', null]]) {
      if (rest.startsWith(word) && !/[A-Za-z0-9_]/.test(rest[word.length] ?? '')) {
        this.pos += word.length;
        return val;
      }
    }
    return this.number();
  }

  number() {
    const rest = this.src.slice(this.pos, this.pos + 64);
    const m = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf|nan|1\.#INF|1\.#IND)/i.exec(rest);
    if (!m) this.fail(`unexpected "${rest.slice(0, 12)}"`);
    this.pos += m[0].length;
    const text = m[0].toLowerCase();
    if (text.includes('inf')) return text.startsWith('-') ? -Infinity : Infinity;
    if (text.includes('nan') || text.includes('ind')) return NaN;
    if (/^-?0x/.test(text)) return text.startsWith('-') ? -parseInt(text.slice(3), 16) : parseInt(text.slice(2), 16);
    return Number(text);
  }

  string() {
    const quote = this.src[this.pos++];
    let out = '';
    for (;;) {
      if (this.done()) this.fail('unterminated string');
      const ch = this.src[this.pos++];
      if (ch === quote) return out;
      if (ch !== '\\') { out += ch; continue; }
      const next = this.src[this.pos++];
      if (next in ESCAPES) { out += ESCAPES[next]; continue; }
      if (next === '\r') { out += '\n'; if (this.src[this.pos] === '\n') this.pos++; continue; }
      if (/\d/.test(next)) {
        let digits = next;
        while (digits.length < 3 && /\d/.test(this.src[this.pos])) digits += this.src[this.pos++];
        out += String.fromCharCode(Number(digits));
        continue;
      }
      out += next;
    }
  }

  longString() {
    const open = /^\[(=*)\[/.exec(this.src.slice(this.pos));
    const close = `]${open[1]}]`;
    let start = this.pos + open[0].length;
    if (this.src[start] === '\n') start++;
    const end = this.src.indexOf(close, start);
    if (end === -1) this.fail('unterminated long string');
    this.pos = end + close.length;
    return this.src.slice(start, end);
  }

  table() {
    this.expect('{');
    const entries = [];
    let nextIndex = 1;
    for (;;) {
      this.skip();
      if (this.peek() === '}') { this.pos++; break; }
      let key;
      if (this.peek() === '[' && !/^\[=*\[/.test(this.src.slice(this.pos, this.pos + 64))) {
        this.pos++;
        key = this.value();
        this.skip();
        this.expect(']');
        this.skip();
        this.expect('=');
      } else {
        const save = this.pos;
        const m = /^[A-Za-z_][A-Za-z0-9_]*\s*=(?!=)/.exec(this.src.slice(this.pos, this.pos + 300));
        if (m && !/^(true|false|nil)\b/.test(m[0])) {
          key = this.identifier();
          this.skip();
          this.expect('=');
        } else {
          this.pos = save;
          key = nextIndex++;
        }
      }
      const val = this.value();
      if (val !== null) entries.push([key, val]);
      this.skip();
      if (this.peek() === ',' || this.peek() === ';') this.pos++;
    }
    return toJS(entries);
  }
}

function toJS(entries) {
  const numeric = entries.every(([k]) => typeof k === 'number' && Number.isInteger(k) && k >= 1);
  if (numeric) {
    const keys = entries.map(([k]) => k).sort((a, b) => a - b);
    if (keys.every((k, i) => k === i + 1)) {
      const arr = new Array(keys.length);
      for (const [k, v] of entries) arr[k - 1] = v;
      return arr;
    }
  }
  if (entries.length === 0) return [];
  const obj = {};
  for (const [k, v] of entries) obj[String(k)] = v;
  return obj;
}
