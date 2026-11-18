// 保存モジュール: 検証済みデータの原子的な保存・読み出し、更新状態、ログ、排他ロック
import { mkdir, readFile, rename, writeFile, open, unlink, stat, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

/** 一時ファイルに書いてから rename する（書き込み途中で中断しても既存ファイルは壊れない） */
export async function writeJsonAtomic(path, obj) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(obj, null, 1) + '\n');
  await rename(tmp, path);
}

export function hashOf(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

export const paths = (storeDir) => ({
  current: join(storeDir, 'current.json'),
  status: join(storeDir, 'status.json'),
  lock: join(storeDir, '.update.lock'),
  snapshot: (season, asOf) => join(storeDir, 'snapshots', String(season), `${asOf}.json`),
});

/**
 * 排他ロック。同じ更新処理が重複起動された場合、後から来た方は何もせず終了する。
 * 30分以上残っているロックは異常終了の残骸とみなして削除する。
 */
export async function acquireLock(lockPath, { staleMs = 30 * 60 * 1000 } = {}) {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const st = await stat(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) await unlink(lockPath);
  } catch {}
  try {
    const fh = await open(lockPath, 'wx');
    await fh.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    await fh.close();
    return async () => {
      try {
        await unlink(lockPath);
      } catch {}
    };
  } catch (e) {
    if (e.code === 'EEXIST') return null;
    throw e;
  }
}

export async function appendLog(logFile, entry) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, JSON.stringify(entry) + '\n');
}

/** ログやエラーメッセージから秘密情報らしき文字列を伏せる */
export function redact(s, secrets = []) {
  let out = String(s);
  for (const v of secrets) if (v && v.length >= 4) out = out.split(v).join('***');
  return out.replace(/(token|key|secret|password|sig)=([^&\s]+)/gi, '$1=***');
}
