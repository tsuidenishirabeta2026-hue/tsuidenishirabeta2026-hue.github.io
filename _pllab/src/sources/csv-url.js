// HTTP(S) で公開・提供されている CSV を取得する取得元。
//   <PLLAB_CSV_BASE_URL>/<season>/<file>.csv
// 利用者が権利を持つ（または利用許諾を得た）CSV の置き場所を指定して使う。
// 例: 自分で管理するスプレッドシートの CSV 公開 URL、契約したデータ提供元の配布 URL。
//
// - 条件付きリクエスト（ETag / Last-Modified）とローカルキャッシュで転送量とアクセス回数を抑える
// - 一時的な失敗（ネットワーク・5xx・429）は指数バックオフで最大3回まで再試行
// - 認証トークン（PLLAB_CSV_TOKEN）は Authorization ヘッダーにのみ使い、ログ・エラーに出さない
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FILES } from '../schema.js';
import { LEAGUE } from '../league.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function csvUrlSource({ baseUrl, token, cacheDir, fetchImpl = globalThis.fetch, retryDelayMs = 2000 }) {
  if (!baseUrl) throw new Error('PLLAB_CSV_BASE_URL が設定されていません');
  const safeBase = baseUrl.replace(/\/+$/, '');

  async function getOne(season, file) {
    const url = `${safeBase}/${season}/${file}`;
    const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
    const metaPath = join(cacheDir, `${key}.json`);
    const bodyPath = join(cacheDir, `${key}.csv`);
    let cached = null;
    try {
      cached = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch {}

    const headers = { 'User-Agent': `${LEAGUE.updaterName}/1.0 (+unofficial fan site)` };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
        if (res.status === 304 && cached) return readFile(bodyPath, 'utf8');
        if (res.status === 404) return undefined; // 任意ファイルが無い
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
        const text = await res.text();
        await mkdir(cacheDir, { recursive: true });
        await writeFile(bodyPath, text);
        await writeFile(metaPath, JSON.stringify({ etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }));
        return text;
      } catch (e) {
        lastErr = e;
        if (e.fatal) break;
        if (attempt < 3) await sleep(retryDelayMs * 2 ** (attempt - 1));
      }
    }
    // URL にクエリ等で秘密情報が含まれる可能性があるため、ファイル名のみ表示する
    throw new Error(`${season}/${file} の取得に失敗しました: ${lastErr?.message ?? '不明なエラー'}`);
  }

  return {
    id: 'csv-url',
    label: 'CSV取り込み（URL）',
    isDemo: false,
    async listSeasons() {
      return null; // config.seasons を使う
    },
    async fetchSeason(season) {
      const out = {};
      // アクセス頻度を抑えるため 1 ファイルずつ順番に取得する
      for (const def of Object.values(FILES)) {
        const text = await getOne(season, def.file);
        if (text !== undefined) out[def.file] = text;
      }
      return out;
    },
  };
}
