// 選手の年度別成績の更新: 所属選手の Wikipedia 記事 → 年度別成績表を解析 → data/store/player-stats.json
//
//   node src/update-player-stats.js
//
// - 版番号を先に確認し、前回から変わった記事だけ本文を取得する（初回のみ全件。50件/リクエスト）
// - 解析できた件数が前回より大きく減った場合は保存しない（前回データを維持）
// - 成績の更新（update.js）の後に実行する（所属選手の記事名を current.json から読むため）
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { acquireLock, appendLog, hashOf, paths, readJson, redact, writeJsonAtomic } from './store.js';
import { fetchPages, fetchRevids, userAgent } from './wiki/client.js';
import { parseArticle } from './sources/player-articles.js';

export async function runPlayerStatsUpdate({ config = loadConfig(), env = process.env, now = () => new Date(), fetchImpl, pauseMs = 3000, log = () => {} } = {}) {
  const storeFile = join(config.storeDir, 'player-stats.json');
  const statusFile = join(config.storeDir, 'player-stats-status.json');
  const startedAt = now().toISOString();
  const release = await acquireLock(join(config.storeDir, '.player-stats.lock'));
  if (!release) {
    const entry = { at: startedAt, kind: 'player-stats', result: 'skipped' };
    await appendLog(config.logFile, entry);
    return entry;
  }
  const status = (await readJson(statusFile)) || {};
  const prev = (await readJson(storeFile)) || { articles: {} };
  let entry;
  try {
    const current = await readJson(paths(config.storeDir).current);
    if (!current) throw new Error('所属選手のデータ（current.json）がありません。先に update.js を実行してください');
    const season = current.data.current_season;
    const titles = [...new Set(current.data.seasons[season].players.map((p) => p.wiki_title).filter(Boolean))];
    if (!titles.length) throw new Error('記事名のある所属選手がいません');
    const opts = { fetchImpl, ua: userAgent(env), pauseMs, log };
    const latest = await fetchRevids(titles, opts);
    const changed = titles.filter((t) => latest.has(t) && prev.articles[t]?.revid !== latest.get(t).revid);
    log(`記事 ${titles.length}件中、更新・未取得 ${changed.length}件`);
    const pages = changed.length ? await fetchPages(changed, opts) : new Map();
    const articles = {};
    let parsedOk = 0;
    for (const t of titles) {
      const pg = pages.get(t);
      if (pg) {
        const r = parseArticle(pg.text, season);
        const yearsSeen = [...(r.batting || []), ...(r.pitching || [])].map((x) => x.year);
        const noted = /(\d{4})年(?:度)?(?:シーズン)?終了時/.exec(pg.text);
        // 記事が何年のシーズン終了時点まで更新されているか（注記 → 表の最新年の順に判断）
        const updatedThrough = noted ? Number(noted[1]) : yearsSeen.length ? Math.max(...yearsSeen) : null;
        articles[t] = { revid: pg.revid, title: pg.title, updatedThrough, batting: r.batting, pitching: r.pitching };
      } else if (prev.articles[t] && latest.get(t)?.revid === prev.articles[t].revid) {
        articles[t] = prev.articles[t];
      }
      if (articles[t]?.batting || articles[t]?.pitching) parsedOk++;
    }
    const prevOk = Object.values(prev.articles).filter((a) => a.batting || a.pitching).length;
    if (prevOk >= 50 && parsedOk < prevOk * 0.7) {
      throw Object.assign(new Error('年度別成績を読み取れた記事が大きく減少したため保存を中止しました'), { details: [`前回 ${prevOk}件 → 今回 ${parsedOk}件（記事の書式変更の可能性）`] });
    }
    const data = { season, articles };
    const hash = hashOf(data);
    const isChanged = prev.hash !== hash;
    if (isChanged) await writeJsonAtomic(storeFile, { hash, saved_at: startedAt, ...data });
    Object.assign(status, { last_attempt_at: startedAt, last_success_at: startedAt, last_result: isChanged ? 'updated' : 'unchanged', last_error: null, last_error_details: [], consecutive_failures: 0, articles: titles.length, parsed: parsedOk, fetched: pages.size });
    entry = { at: startedAt, kind: 'player-stats', result: status.last_result, articles: titles.length, parsed: parsedOk, fetched: pages.size };
  } catch (e) {
    Object.assign(status, { last_attempt_at: startedAt, last_result: 'failed', last_error: redact(e.message, [env.PLLAB_UA_CONTACT]), last_error_details: e.details || [], consecutive_failures: (status.consecutive_failures || 0) + 1 });
    entry = { at: startedAt, kind: 'player-stats', result: 'failed', error: status.last_error };
  } finally {
    await writeJsonAtomic(statusFile, status);
    await release();
  }
  await appendLog(config.logFile, entry);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runPlayerStatsUpdate({ log: (m) => console.log(m) });
  console.log(`${r.result === 'failed' ? '✘ 失敗（前回データを維持）' : '✔ ' + r.result}  ${JSON.stringify(r)}`);
  process.exitCode = r.result === 'failed' ? 2 : 0;
}
