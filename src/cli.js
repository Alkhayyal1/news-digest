// Command-line entry used by GitHub Actions (static mode).
//   node src/cli.js update [--force]   one scheduler tick (or a forced manual run), then retention
//   node src/cli.js build [outDir]     generate the static site from the database
import { appendFileSync } from 'node:fs';
import { config } from './config.js';
import { openDb, syncSources, setSetting } from './db.js';
import { tick, runUpdate, recoverAfterRestart, getAnchor, intervalMs, lastDoneSlot } from './runner.js';
import { slotIndexAt } from './core/schedule.js';
import { applyOverrides, applyFinancials } from './config-files.js';
import { prune, compact } from './maintenance.js';
import { buildSite } from './static/build.js';

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`${key}=${value}`);
}

async function update(force) {
  const db = openDb(config.dbPath);
  try {
    // each Actions job is a fresh process: a "running" run here was interrupted
    recoverAfterRestart(db);
    syncSources(db);
    const notes = [...applyOverrides(db), ...applyFinancials(db)];
    if (notes.length) setSetting(db, 'config_log', JSON.stringify({ at: Date.now(), notes }));
    for (const n of notes) console.log('[config]', n);
    let ran = false;
    if (force) {
      const r = await runUpdate(db, { kind: 'manual' });
      console.log('[update] forced run:', r.status);
      ran = r.status !== 'skipped_locked';
      // A successful manual run covers the current slot, so the hourly tick does not
      // start another full update right after it (e.g. on the very first deployment).
      const now = Date.now();
      const anchor = getAnchor(db, now);
      const k = slotIndexAt(anchor, intervalMs(), now);
      if (r.status !== 'failed' && ran && k > lastDoneSlot(db)) {
        db.prepare("INSERT OR IGNORE INTO schedule_slots (slot_index, planned_at, status, run_id, attempts, updated_at) VALUES (?, ?, 'done', ?, 1, ?)").run(k, anchor + k * intervalMs(), r.runId, now);
      }
    } else {
      const r = await tick(db);
      console.log('[update] tick:', JSON.stringify(r));
      ran = r.action === 'ran';
    }
    console.log('[prune]', JSON.stringify(prune(db)));
    output('ran', ran || notes.length > 0 ? 'true' : 'false');
  } finally {
    compact(db);
    db.close();
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'update') await update(arg === '--force' || process.env.FORCE_RUN === 'true');
else if (cmd === 'build') {
  const db = openDb(config.dbPath);
  try {
    const stats = buildSite(db, arg || 'site');
    console.log('[build]', JSON.stringify(stats));
  } finally {
    db.close();
  }
} else {
  console.error('usage: node src/cli.js update [--force] | build [outDir]');
  process.exit(2);
}
