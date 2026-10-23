// Browser shims for the Node built-ins the app uses, so the real src/ modules and test files can
// run unchanged in a browser when Node.js is unavailable. DEV ONLY.
// node:sqlite is emulated with sql.js (SQLite compiled to WebAssembly).

export const files = new Map(); // virtual FS: path -> text
const savedDbs = new Map(); // path -> Uint8Array (simulates a DB file surviving a restart)

// ---- node:sqlite ----
export class DatabaseSync {
  constructor(path) {
    this.path = path;
    const SQL = globalThis.__SQL;
    this.db = path !== ':memory:' && savedDbs.has(path) ? new SQL.Database(savedDbs.get(path)) : new SQL.Database();
  }
  exec(sql) {
    // sql.js has no WAL on in-memory DBs; ignore journal pragma errors
    try {
      this.db.exec(sql);
    } catch (e) {
      if (/journal_mode/i.test(sql) && !/CREATE/i.test(sql)) return;
      throw e;
    }
  }
  prepare(sql) {
    const db = this.db;
    const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
    return {
      run: (...p) => {
        const st = db.prepare(sql);
        try {
          st.bind(norm(p));
          st.step();
        } finally {
          st.free();
        }
        const changes = db.getRowsModified();
        const id = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
        return { changes, lastInsertRowid: id };
      },
      get: (...p) => {
        const st = db.prepare(sql);
        try {
          st.bind(norm(p));
          return st.step() ? st.getAsObject() : undefined;
        } finally {
          st.free();
        }
      },
      all: (...p) => {
        const st = db.prepare(sql);
        const out = [];
        try {
          st.bind(norm(p));
          while (st.step()) out.push(st.getAsObject());
        } finally {
          st.free();
        }
        return out;
      },
    };
  }
  close() {
    if (this.path !== ':memory:') savedDbs.set(this.path, this.db.export());
    this.db.close();
  }
}

// ---- node:path ----
const clean = (p) => {
  const abs = p.startsWith('/');
  const out = [];
  for (const s of p.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return (abs ? '/' : '') + out.join('/');
};
export const path = {
  join: (...a) => clean(a.filter(Boolean).join('/')),
  dirname: (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.'),
  extname: (p) => (/\.[^./]+$/.exec(p) || [''])[0],
  normalize: (p) => clean(p),
  resolve: (...a) => clean(a.join('/')),
};

// ---- node:fs ----
let tmpN = 0;
export const fs = {
  readdirSync: (dir) => [...files.keys()].filter((f) => path.dirname(f) === clean(dir)).map((f) => f.slice(f.lastIndexOf('/') + 1)),
  readFileSync: (p) => {
    if (!files.has(clean(p))) throw new Error('ENOENT ' + p);
    return files.get(clean(p));
  },
  mkdirSync: () => {},
  mkdtempSync: (prefix) => `${prefix}${++tmpN}`,
  rmSync: (p) => {
    const base = clean(p);
    for (const k of [...files.keys()]) if (k === base || k.startsWith(base + '/')) files.delete(k);
  },
  existsSync: (p) => files.has(clean(p)),
  writeFileSync: (p, data) => files.set(clean(p), String(data)),
  copyFileSync: (a, b) => {
    if (!files.has(clean(a))) throw new Error('ENOENT ' + a);
    files.set(clean(b), files.get(clean(a)));
  },
  appendFileSync: (p, data) => files.set(clean(p), (files.get(clean(p)) || '') + data),
};

// file URL of a virtual module: served as a blob, with its relative core import made absolute
export function pathToFileURL(p) {
  const src = fs.readFileSync(p).replace(/from '\.\/core\/arabic\.js'/g, `from '${location.origin}/src/core/arabic.js'`);
  return { href: URL.createObjectURL(new Blob([src], { type: 'text/javascript' })) };
}

// ---- node:test + node:assert ----
export const registered = [];
export function test(name, fn) {
  registered.push({ name, fn });
}
function fail(msg) {
  throw new Error(msg);
}
const show = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
export const assert = {
  equal: (a, b, m) => Object.is(a, b) || fail(`${m ? m + ': ' : ''}expected ${show(b)}, got ${show(a)}`),
  strictEqual: (a, b, m) => assert.equal(a, b, m),
  notEqual: (a, b, m) => !Object.is(a, b) || fail(`${m ? m + ': ' : ''}expected not ${show(b)}`),
  ok: (v, m) => v || fail(m || `expected truthy, got ${show(v)}`),
  match: (s, re, m) => re.test(s) || fail(`${m ? m + ': ' : ''}${show(s)} does not match ${re}`),
  doesNotMatch: (s, re, m) => !re.test(s) || fail(`${m ? m + ': ' : ''}unexpected match ${re}`),
  deepEqual: (a, b, m) => show(a) === show(b) || fail(`${m ? m + ': ' : ''}expected ${show(b)}, got ${show(a)}`),
};
assert.deepStrictEqual = assert.deepEqual;
