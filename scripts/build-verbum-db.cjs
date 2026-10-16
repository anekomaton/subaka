/**
 * Build Verbum Offline SQLite Database from GitHub Sources
 */

const path = require('path');
const { spawnSync } = require('child_process');

const targetDb = process.argv[2] || path.join(__dirname, '..', 'src-tauri', 'resources', 'verbum_offline.sqlite3');
const pyScript = path.join(__dirname, 'build-verbum-db.py');

console.log('[build-verbum-db.cjs] Invoking Python builder for', targetDb);
const res = spawnSync('python3', [pyScript, targetDb], { stdio: 'inherit' });
if (res.status !== 0) {
  const res2 = spawnSync('python', [pyScript, targetDb], { stdio: 'inherit' });
  if (res2.status !== 0) {
    console.error('[build-verbum-db.cjs] Failed with python:', res2.error || res2.status);
    process.exit(res2.status || 1);
  }
}
