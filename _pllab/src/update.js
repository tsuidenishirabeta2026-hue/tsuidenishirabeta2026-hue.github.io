// 更新処理: 取得 → 検証 → 保存（表示用 HTML の生成は build.js が別に行う）
//
//   node src/update.js [--allow-rollback]
//
// 終了コード: 0 = 成功/変更なし/重複起動でスキップ, 2 = 取得・検証に失敗（前回データを維持）
import { loadConfig } from './config.js';
import { createSource } from './sources/index.js';
import { validateSeason, checkCompleteness } from './validate.js';
import { acquireLock, appendLog, hashOf, paths, readJson, redact, writeJsonAtomic } from './store.js';

export async function runUpdate({ config = loadConfig(), env = process.env, now = () => new Date(), allowRollback = false, source } = {}) {
  const p = paths(config.storeDir);
  const startedAt = now().toISOString();
  const release = await acquireLock(p.lock);
  if (!release) {
    const entry = { at: startedAt, result: 'skipped', message: '別の更新処理が実行中のためスキップしました' };
    await appendLog(config.logFile, entry);
    return entry;
  }
  const status = (await readJson(p.status)) || {};
  const secrets = [env.PLLAB_CSV_TOKEN, env.PLLAB_CSV_BASE_URL];
  let entry;
  try {
    const src = source || createSource(config, env);
    const prev = await readJson(p.current);
    let seasons = config.seasons || (await src.listSeasons());
    if (!seasons || seasons.length === 0) throw new Error('取得対象のシーズンがありません');

    const warnings = [];
    const out = {};
    for (const season of seasons) {
      const texts = await src.fetchSeason(season);
      const res = validateSeason(season, texts);
      warnings.push(...res.warnings.map((w) => `[${season}] ${w}`));
      if (!res.ok) {
        const e = new Error(`${season}年データの検証に失敗しました（${res.errors.length}件）`);
        e.details = res.errors.slice(0, 50).map((x) => `[${season}] ${x}`);
        throw e;
      }
      const comp = checkCompleteness(prev?.data?.seasons?.[season], res.data, { allowRollback });
      if (comp.length) {
        const e = new Error(`${season}年データが不完全な可能性があるため保存を中止しました`);
        e.details = comp.map((x) => `[${season}] ${x}`);
        throw e;
      }
      out[season] = res.data;
    }
    // 取得元から消えた過去シーズンは前回データを引き継ぐ（履歴を失わないため）
    if (prev?.data?.seasons && prev.data.source.id === src.id) {
      for (const [s, d] of Object.entries(prev.data.seasons)) {
        if (!(s in out)) {
          out[s] = d;
          warnings.push(`[${s}] 今回の取得対象に含まれないため前回データを引き継ぎました`);
        }
      }
    }
    const current = Math.max(...Object.keys(out).map(Number));
    const data = {
      schema: 1,
      source: { id: src.id, label: src.label, isDemo: !!src.isDemo },
      current_season: current,
      seasons: out,
    };
    const hash = hashOf(data);
    const changed = !prev || prev.hash !== hash;
    if (changed) {
      await writeJsonAtomic(p.current, { hash, saved_at: startedAt, data });
      // スナップショットは「シーズン×基準日」をキーに上書き保存（重複実行・訂正でも二重登録しない）
      const asOf = out[current].meta.as_of_date;
      // 容量を抑えるため、スナップショットには試合別・状況別の明細を含めない（current.json には含む）
      const slim = { ...out[current] };
      for (const k of ['batting_games', 'pitching_games', 'splits_batting', 'splits_pitching']) slim[k] = `省略（${out[current][k].length}行）`;
      await writeJsonAtomic(p.snapshot(current, asOf), { hash, saved_at: startedAt, season: current, data: slim });
    }
    Object.assign(status, {
      last_attempt_at: startedAt,
      last_success_at: startedAt,
      last_result: changed ? 'updated' : 'unchanged',
      last_error: null,
      last_error_details: [],
      warnings,
      data_hash: hash,
      consecutive_failures: 0,
    });
    entry = { at: startedAt, result: status.last_result, source: src.id, season: current, as_of: out[current].meta.as_of_date, warnings: warnings.length };
  } catch (e) {
    Object.assign(status, {
      last_attempt_at: startedAt,
      last_result: 'failed',
      last_error: redact(e.message, secrets),
      last_error_details: (e.details || []).map((d) => redact(d, secrets)),
      consecutive_failures: (status.consecutive_failures || 0) + 1,
    });
    entry = { at: startedAt, result: 'failed', error: status.last_error, details: status.last_error_details.slice(0, 10) };
  } finally {
    await writeJsonAtomic(p.status, status);
    await release();
  }
  await appendLog(config.logFile, entry);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const allowRollback = process.argv.includes('--allow-rollback');
  const r = await runUpdate({ allowRollback });
  const icon = { updated: '✔ 更新しました', unchanged: '✔ 変更はありません', skipped: '- スキップ', failed: '✘ 失敗（前回データを維持）' }[r.result];
  console.log(`${icon}  ${JSON.stringify(r)}`);
  process.exitCode = r.result === 'failed' ? 2 : 0;
}
