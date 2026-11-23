// MediaWiki API（ja.wikipedia.org）の小さなクライアント。
//
// Wikimedia の利用条件に合わせて:
//   - 1リクエストあたり最大50ページをまとめて取得し、リクエスト間に待ち時間を入れる
//   - 429/5xx は Retry-After を尊重し、指数バックオフで再試行
//   - maxlag=5（サーバー混雑時は自動的に待つ）
//   - User-Agent にサイト名（と任意の連絡先）を入れる
import { LEAGUE } from '../league.js';

const API = 'https://ja.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function userAgent(env = process.env) {
  return `${LEAGUE.updaterName}/1.0 (unofficial baseball fan site${env.PLLAB_UA_CONTACT ? `; ${env.PLLAB_UA_CONTACT}` : ''})`;
}

async function call(params, { fetchImpl = globalThis.fetch, ua, maxAttempts = 6, baseDelayMs = 5000, maxWaitMs = 300000, log = () => {} }) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(`${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`, {
        headers: { 'User-Agent': ua, 'Api-User-Agent': ua },
        signal: AbortSignal.timeout(90000),
      });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error(`HTTP ${res.status}`), { wait: ra > 0 ? ra * 1000 : null });
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const j = await res.json();
      if (j.error) {
        if (j.error.code === 'maxlag') throw Object.assign(new Error('maxlag'), { wait: 5000 });
        throw Object.assign(new Error(`API エラー: ${j.error.code}`), { fatal: true });
      }
      return j;
    } catch (e) {
      lastErr = e;
      if (e.fatal || attempt === maxAttempts) break;
      const wait = Math.min(maxWaitMs, Math.max(e.wait || 0, baseDelayMs * 2 ** (attempt - 1)));
      log(`  再試行 ${attempt}/${maxAttempts - 1}: ${e.message}（${Math.round(wait / 1000)}秒待機）`);
      await sleep(wait);
    }
  }
  throw new Error(`Wikipedia API の呼び出しに失敗しました: ${lastErr?.message}`);
}

/**
 * 複数ページの最新版の本文を取得する。
 * @returns {Promise<Map<string, {title, revid, text, requested}>>} 要求したタイトル → ページ（存在しないものは含まない）
 */
export async function fetchPages(titles, opts = {}) {
  const { batchSize = 50, pauseMs = 3000, onlyIfChanged = null, log = () => {} } = opts;
  const out = new Map();
  let targets = [...new Set(titles)];
  // 変更があったページだけ本文を取る（版番号だけを先に軽く確認）
  if (onlyIfChanged) {
    const latest = await fetchRevids(targets, opts);
    targets = targets.filter((t) => latest.has(t) && latest.get(t).revid !== onlyIfChanged.get(t));
    log(`本文の取得が必要なページ: ${targets.length}件`);
  }
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    let cont = {};
    do {
      const j = await call({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: batch.join('|'), redirects: '1', ...cont }, opts);
      const back = new Map();
      for (const r of j.query?.redirects || []) back.set(r.to, r.from);
      for (const n of j.query?.normalized || []) back.set(n.to, n.from);
      for (const p of j.query?.pages || []) {
        if (p.missing || !p.revisions) continue;
        let req = p.title;
        while (back.has(req) && !batch.includes(req)) req = back.get(req);
        out.set(req, { title: p.title, revid: p.revisions[0].revid, text: p.revisions[0].slots.main.content, requested: req });
      }
      // 応答が大きすぎて途中で切れた場合は continue の値をそのまま渡して続きを取得する
      cont = j.continue ? { ...j.continue } : null;
      if (cont) await sleep(pauseMs);
    } while (cont);
    log(`取得 ${Math.min(i + batchSize, targets.length)}/${targets.length}`);
    if (i + batchSize < targets.length) await sleep(pauseMs);
  }
  return out;
}

/** 版番号だけを取得（本文なし、軽量） */
export async function fetchRevids(titles, opts = {}) {
  const { batchSize = 50, pauseMs = 3000 } = opts;
  const out = new Map();
  const list = [...new Set(titles)];
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const j = await call({ action: 'query', prop: 'info', titles: batch.join('|'), redirects: '1' }, opts);
    const back = new Map();
    for (const r of j.query?.redirects || []) back.set(r.to, r.from);
    for (const n of j.query?.normalized || []) back.set(n.to, n.from);
    for (const p of j.query?.pages || []) {
      if (p.missing) continue;
      let req = p.title;
      while (back.has(req) && !batch.includes(req)) req = back.get(req);
      out.set(req, { title: p.title, revid: p.lastrevid });
    }
    if (i + batchSize < list.length) await sleep(pauseMs);
  }
  return out;
}
