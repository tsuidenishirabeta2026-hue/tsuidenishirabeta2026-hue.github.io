// 移籍・契約などの動きの更新: Wikipedia から取得 → 検証 → 保存（data/store/moves.json）
// ＋ 手動入力の CSV（data/input/moves.csv、任意）を統合する。
//
//   node src/update-moves.js
//
// 成績データの更新（update.js）とは独立しており、どちらかが失敗しても他方には影響しない。
// 終了コード: 0 = 成功/変更なし, 2 = 失敗（前回データを維持）
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { acquireLock, appendLog, hashOf, readJson, redact, writeJsonAtomic } from './store.js';
import { parseCsv } from './csv.js';
import { articleTitle, fetchArticle, parseEvents, CATEGORIES } from './moves/wikipedia.js';
import { LEAGUE_TEAMS } from './schema.js';
import { LEAGUE } from './league.js';

const CAT_NAMES = [...CATEGORIES.map(([c]) => c), 'その他'];

/** 取得対象の年: 今年の記事。1〜6月は前年の記事も（前年オフの動きを含めるため） */
export function targetYears(now) {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  return jst.getUTCMonth() + 1 <= 6 ? [y - 1, y] : [y];
}

async function readManual(file, errors) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const { header, records } = parseCsv(text);
  for (const c of ['date', 'team_id', 'category', 'text']) if (!header.includes(c)) errors.push(`moves.csv: 列 "${c}" がありません`);
  if (errors.length) return [];
  const out = [];
  for (const r of records) {
    const w = `moves.csv ${r.__line}行目`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errors.push(`${w}: date は YYYY-MM-DD`);
    const teams = r.team_id.split(/[ /|]+/).filter(Boolean);
    if (!teams.length || teams.some((t) => !LEAGUE_TEAMS.includes(t))) errors.push(`${w}: team_id は ${LEAGUE.teamIdsText}（複数は / 区切り）`);
    if (!CAT_NAMES.includes(r.category)) errors.push(`${w}: category は ${CAT_NAMES.join(' / ')} のいずれか`);
    if (!r.text) errors.push(`${w}: text は必須`);
    if (r.source_url && !/^https?:\/\//.test(r.source_url)) errors.push(`${w}: source_url は http(s) の URL`);
    out.push({
      date: r.date,
      text: r.text,
      details: [],
      teams,
      categories: [r.category],
      sources: r.source_url ? [{ url: r.source_url, site: r.source_name || new URL(r.source_url).hostname, date: null }] : [],
      origin: 'manual',
    });
  }
  return out;
}

export async function runMovesUpdate({ config = loadConfig(), env = process.env, now = () => new Date(), fetchImpl } = {}) {
  const storeFile = join(config.storeDir, 'moves.json');
  const statusFile = join(config.storeDir, 'moves-status.json');
  const startedAt = now().toISOString();
  const release = await acquireLock(join(config.storeDir, '.moves.lock'));
  if (!release) {
    const entry = { at: startedAt, kind: 'moves', result: 'skipped' };
    await appendLog(config.logFile, entry);
    return entry;
  }
  const status = (await readJson(statusFile)) || {};
  const prev = await readJson(storeFile);
  // Wikimedia の User-Agent 方針: 連絡先を含めることが推奨。設定されていなければ一般名のみ
  const ua = `${LEAGUE.updaterName}/1.0 (unofficial baseball fan site${env.PLLAB_UA_CONTACT ? `; ${env.PLLAB_UA_CONTACT}` : ''})`;
  let entry;
  try {
    const errors = [];
    const articles = [];
    let events = [];
    for (const year of targetYears(now())) {
      const title = articleTitle(year);
      const a = await fetchArticle(title, { fetchImpl, userAgent: ua });
      if (!a) continue; // 年初で記事がまだ無い場合など
      const parsed = parseEvents(a.wikitext, year);
      // 検証: 記事はあるのに「できごと」節が読めない → 書式変更の可能性。保存しない
      if (parsed.months === 0) errors.push(`「${title}」の「できごと」節を読み取れませんでした（記事の書式が変わった可能性）`);
      const prevCount = prev?.articles?.find((x) => x.title === a.title)?.count ?? 0;
      if (prevCount >= 20 && parsed.events.length < prevCount * 0.5) errors.push(`「${title}」から抽出した件数が前回 ${prevCount} 件から ${parsed.events.length} 件に大きく減少しました（記事の荒らし・書式変更の可能性）`);
      articles.push({ title: a.title, revid: a.revid, count: parsed.events.length, url: `https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(a.title)}&oldid=${a.revid}` });
      events.push(...parsed.events.map((e) => ({ ...e, origin: 'wikipedia', article: a.title })));
    }
    if (!articles.length) errors.push('取得できる記事がありませんでした');
    const manual = await readManual(join(config.inputDir, 'moves.csv'), errors);
    if (errors.length) throw Object.assign(new Error('移籍・契約データの検証に失敗しました'), { details: errors });
    events.push(...manual);
    events.sort((a, b) => b.date.localeCompare(a.date));
    const data = { articles: articles.map(({ title, revid, url, count }) => ({ title, revid, url, count })), events };
    const hash = hashOf(data);
    const changed = !prev || prev.hash !== hash;
    if (changed) await writeJsonAtomic(storeFile, { hash, saved_at: startedAt, ...data });
    Object.assign(status, { last_attempt_at: startedAt, last_success_at: startedAt, last_result: changed ? 'updated' : 'unchanged', last_error: null, last_error_details: [], consecutive_failures: 0 });
    entry = { at: startedAt, kind: 'moves', result: status.last_result, events: events.length, revids: articles.map((a) => a.revid) };
  } catch (e) {
    Object.assign(status, {
      last_attempt_at: startedAt,
      last_result: 'failed',
      last_error: redact(e.message, [env.PLLAB_UA_CONTACT]),
      last_error_details: (e.details || []).slice(0, 20),
      consecutive_failures: (status.consecutive_failures || 0) + 1,
    });
    entry = { at: startedAt, kind: 'moves', result: 'failed', error: status.last_error, details: status.last_error_details.slice(0, 5) };
  } finally {
    await writeJsonAtomic(statusFile, status);
    await release();
  }
  await appendLog(config.logFile, entry);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runMovesUpdate();
  console.log(`${r.result === 'failed' ? '✘ 失敗（前回データを維持）' : '✔ ' + r.result}  ${JSON.stringify(r)}`);
  process.exitCode = r.result === 'failed' ? 2 : 0;
}
