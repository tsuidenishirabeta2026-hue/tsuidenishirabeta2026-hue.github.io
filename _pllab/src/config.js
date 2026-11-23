import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// どのサイトを処理するか（リーグごとに設定ファイルを分ける）
//   pacific（既定）: config/site.json         → パ・リーグ成績ラボ（pl-lab/）
//   central        : config/site-central.json → セ・リーグ成績ラボ（cl-lab/）
// 例: PLLAB_SITE=central node src/build.js
export const SITE_ID = process.env.PLLAB_SITE || 'pacific';

export function siteConfigFile(id = SITE_ID) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`PLLAB_SITE の値が不正です: ${id}`);
  return resolve(ROOT, id === 'pacific' ? 'config/site.json' : `config/site-${id}.json`);
}

export function loadConfig(overrides = {}, id = SITE_ID) {
  const raw = JSON.parse(readFileSync(siteConfigFile(id), 'utf8'));
  const c = { league: 'pacific', columnsDir: 'content/columns', ...raw, ...overrides };
  for (const k of ['inputDir', 'demoDir', 'storeDir', 'cacheDir', 'logFile', 'outDir', 'columnsDir']) {
    c[k] = resolve(ROOT, c[k]);
  }
  if (process.env.PLLAB_STORE_DIR) c.storeDir = resolve(process.env.PLLAB_STORE_DIR);
  if (process.env.PLLAB_OUT_DIR) c.outDir = resolve(process.env.PLLAB_OUT_DIR);
  if (process.env.PLLAB_LOG_FILE) c.logFile = resolve(process.env.PLLAB_LOG_FILE);
  if (process.env.PLLAB_INPUT_DIR) c.inputDir = resolve(process.env.PLLAB_INPUT_DIR);
  return c;
}
