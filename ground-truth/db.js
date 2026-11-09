// Shared SQLite plumbing for the ground-truth collectors, copied from
// history.js's own style (sqlite3 CLI, no npm deps) rather than imported,
// since each collector is meant to be a small standalone script.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DB = process.env.FF_GROUND_TRUTH_DB || path.join(__dirname, '..', 'data', 'ground-truth.db');
const SQLITE = '/usr/bin/sqlite3';

const q = v => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const n = v => v == null || Number.isNaN(v) ? 'NULL' : String(v);

function sql(script) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const r = spawnSync(SQLITE, [DB], { input: script, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite3: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function rows(query) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const r = spawnSync(SQLITE, ['-json', DB, query], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite3: ${r.stderr || r.stdout}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

module.exports = { DB, q, n, sql, rows };
