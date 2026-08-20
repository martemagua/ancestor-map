// Nightly self-backup: a JSON export you can re-import, plus a consistent
// SQLite copy. Both land in DATA_DIR/backups so a filesystem snapshot picks
// them up. Ported from Friend-Map.
import fs from 'node:fs';
import path from 'node:path';
import { db, BACKUP_DIR, metaGet, metaSet } from './db.js';
import { exportAll } from './routes.js';

// A typo in the env must not turn pruning off: NaN slid through every
// comparison below and quietly kept all backups forever.
const keepEnv = Number(process.env.BACKUP_KEEP);
const KEEP = Number.isFinite(keepEnv) && keepEnv > 0 ? keepEnv : 30;

export function runBackup(reason = 'auto') {
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(BACKUP_DIR, `ancestormap-${stamp}.json`);
  const dbPath = path.join(BACKUP_DIR, `ancestormap-${stamp}.db`);

  fs.writeFileSync(jsonPath, JSON.stringify(exportAll(), null, 2));
  fs.rmSync(dbPath, { force: true });          // VACUUM INTO refuses an existing file
  db.exec(`VACUUM INTO '${dbPath.replace(/'/g, "''")}'`);

  prune('.json');
  prune('.db');
  // Dead geocache rows otherwise pile up in the file and ride along in every backup.
  db.prepare("DELETE FROM geocache WHERE at < datetime('now','-180 day')").run();
  metaSet('last_backup', new Date().toISOString());
  console.log(`[backup] ${reason} → ${path.basename(jsonPath)}`);
  return { date: stamp, json: path.basename(jsonPath), db: path.basename(dbPath) };
}

function prune(ext) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('ancestormap-') && f.endsWith(ext))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  }
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .sort().reverse()
    .map(f => ({ name: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size }));
}

/** Checks hourly; runs once per calendar day. Survives restarts without a cron. */
export function startBackupSchedule() {
  const tick = () => {
    try {
      const last = (metaGet('last_backup') || '').slice(0, 10);
      if (last !== new Date().toISOString().slice(0, 10)) runBackup('scheduled');
    } catch (err) {
      console.error('[backup] failed:', err.message);
    }
  };
  tick();
  setInterval(tick, 3600_000).unref();
}
