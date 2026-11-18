import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'config/site.json'), 'utf8'));
  const c = { ...raw, ...overrides };
  for (const k of ['inputDir', 'demoDir', 'storeDir', 'cacheDir', 'logFile', 'outDir']) {
    c[k] = resolve(ROOT, c[k]);
  }
  if (process.env.PLLAB_STORE_DIR) c.storeDir = resolve(process.env.PLLAB_STORE_DIR);
  if (process.env.PLLAB_OUT_DIR) c.outDir = resolve(process.env.PLLAB_OUT_DIR);
  if (process.env.PLLAB_LOG_FILE) c.logFile = resolve(process.env.PLLAB_LOG_FILE);
  if (process.env.PLLAB_INPUT_DIR) c.inputDir = resolve(process.env.PLLAB_INPUT_DIR);
  return c;
}
