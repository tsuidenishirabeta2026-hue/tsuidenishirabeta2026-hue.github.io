// 取得 → 検証 → 保存 → 画面生成 の結合テスト（一時ディレクトリで実行）
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, ROOT } from '../src/config.js';
import { runUpdate } from '../src/update.js';
import { runBuild } from '../src/build.js';
import { validateSeason } from '../src/validate.js';
import { acquireLock } from '../src/store.js';
import { csvUrlSource } from '../src/sources/csv-url.js';
import { FILES } from '../src/schema.js';

let tmp;
let demoDir;

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pllab-test-'));
  demoDir = join(tmp, 'demo');
  // 基準日をシーズン途中にしたデモを生成（今後の日程・規定未到達などを確認するため）
  execFileSync(process.execPath, ['scripts/generate-demo.js', '--out', demoDir, '--as-of', '2026-07-20', '--phase', 'regular'], { cwd: ROOT });
});

function cfg(name, extra = {}) {
  const c = loadConfig();
  return { ...c, inputDir: join(tmp, name, 'input'), demoDir, storeDir: join(tmp, name, 'store'), logFile: join(tmp, name, 'log.jsonl'), outDir: join(tmp, name, 'pl-lab'), cacheDir: join(tmp, name, 'cache'), ...extra };
}

async function readAll(dir, season) {
  const out = {};
  for (const def of Object.values(FILES)) {
    try {
      out[def.file] = await readFile(join(dir, String(season), def.file), 'utf8');
    } catch {}
  }
  return out;
}

test('デモデータは検証を通過する', async () => {
  const r = validateSeason(2026, await readAll(demoDir, 2026));
  assert.equal(r.ok, true, r.errors.join('\n'));
  assert.equal(r.warnings.length, 0, r.warnings.join('\n'));
});

test('検証: 不正な値・整合性エラーを検出する', async () => {
  const t = await readAll(demoDir, 2026);
  const bad = { ...t };
  // 投球回の端数 .3 は不正
  bad['pitching.csv'] = t['pitching.csv'].replace(/\n(p\d+),([A-Z]),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\.\d,/, (m, a, b, c, d, e, f, g, h, i) => `\n${a},${b},${c},${d},${e},${f},${g},${h},${i}.3,`);
  // 安打 > 打数
  const lines = t['batting.csv'].split('\n');
  const cols = lines[1].split(',');
  cols[6] = String(Number(cols[4]) + 1);
  lines[1] = cols.join(',');
  bad['batting.csv'] = lines.join('\n');
  // 球団が1つ欠ける
  bad['standings.csv'] = t['standings.csv'].split('\n').filter((l) => !l.startsWith('H,')).join('\n');
  // 形式エラー（型変換の段階で検出）
  const r1 = validateSeason(2026, { ...t, 'pitching.csv': bad['pitching.csv'] });
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join('\n'), /\.0\/\.1\/\.2/);
  // 整合性エラー
  const r2 = validateSeason(2026, { ...t, 'batting.csv': bad['batting.csv'] });
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join('\n'), /安打\(\d+\) が打数/);
  const r3 = validateSeason(2026, { ...t, 'standings.csv': bad['standings.csv'] });
  assert.equal(r3.ok, false);
  assert.match(r3.errors.join('\n'), /球団 H の行がありません/);
});

test('検証: 必須ファイルが無ければ失敗、任意ファイルが無くても成功', async () => {
  const t = await readAll(demoDir, 2026);
  const noOpt = { ...t };
  for (const f of ['games.csv', 'batting_games.csv', 'pitching_games.csv', 'splits_batting.csv', 'splits_pitching.csv']) delete noOpt[f];
  assert.equal(validateSeason(2026, noOpt).ok, true);
  const noReq = { ...t };
  delete noReq['batting.csv'];
  const r = validateSeason(2026, noReq);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /batting\.csv がありません/);
});

test('更新: 成功 → 変更なし → 失敗時は前回データを維持し、画面に表示する', async () => {
  const c = cfg('keep', { source: 'csv-dir' });
  await cp(demoDir, c.inputDir, { recursive: true });
  const r1 = await runUpdate({ config: c, env: {} });
  assert.equal(r1.result, 'updated');
  const before = await readFile(join(c.storeDir, 'current.json'), 'utf8');

  const r2 = await runUpdate({ config: c, env: {} });
  assert.equal(r2.result, 'unchanged'); // 試合がなかった日・同じ内容: 正常終了

  // 取得結果が壊れている（打撃成績の大半が欠落）→ 保存しない
  const bf = join(c.inputDir, '2026', 'batting.csv');
  const orig = await readFile(bf, 'utf8');
  await writeFile(bf, orig.split('\n').slice(0, 10).join('\n') + '\n');
  const r3 = await runUpdate({ config: c, env: {} });
  assert.equal(r3.result, 'failed');
  assert.match(r3.error, /不完全/);
  assert.equal(await readFile(join(c.storeDir, 'current.json'), 'utf8'), before, '正常データが上書きされていない');
  const st = JSON.parse(await readFile(join(c.storeDir, 'status.json'), 'utf8'));
  assert.equal(st.last_result, 'failed');
  assert.equal(st.last_success_at, r2.at); // 最後に成功した（変更なしも成功）日時のまま
  assert.equal(st.consecutive_failures, 1);

  // 画面には前回データ＋失敗の表示
  await runBuild({ config: c });
  const html = await readFile(join(c.outDir, 'index.html'), 'utf8');
  assert.match(html, /最新データの取得に失敗しました/);
  assert.match(html, /前回取得に成功したデータ/);

  // 形式エラー（CSV の型不正）でも同様に維持
  await writeFile(bf, orig.replace(/\n(p\d+),([A-Z]),(\d+),/, '\n$1,$2,abc,'));
  const r4 = await runUpdate({ config: c, env: {} });
  assert.equal(r4.result, 'failed');
  assert.equal(await readFile(join(c.storeDir, 'current.json'), 'utf8'), before);

  // 復旧 → 成功に戻る
  await writeFile(bf, orig);
  const r5 = await runUpdate({ config: c, env: {} });
  assert.equal(r5.result, 'unchanged');
  const st2 = JSON.parse(await readFile(join(c.storeDir, 'status.json'), 'utf8'));
  assert.equal(st2.last_result, 'unchanged');
  assert.equal(st2.consecutive_failures, 0);

  const log = (await readFile(c.logFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l) => l.result), ['updated', 'unchanged', 'failed', 'failed', 'unchanged']);
});

test('更新: 基準日の逆戻りは拒否（--allow-rollback で訂正として許可）', async () => {
  const c = cfg('rollback', { source: 'csv-dir' });
  await cp(demoDir, c.inputDir, { recursive: true });
  assert.equal((await runUpdate({ config: c, env: {} })).result, 'updated');
  const mf = join(c.inputDir, '2026', 'meta.csv');
  await writeFile(mf, (await readFile(mf, 'utf8')).replace('as_of_date,2026-07-20', 'as_of_date,2026-07-19'));
  const r = await runUpdate({ config: c, env: {} });
  assert.equal(r.result, 'failed');
  assert.match(r.details.join(), /基準日が前回/);
  // ただし、7/20 の final 試合が残っているので検証で弾かれる → その試合も scheduled に戻した訂正なら許可
  const gf = join(c.inputDir, '2026', 'games.csv');
  await writeFile(gf, (await readFile(gf, 'utf8')).split('\n').filter((l) => !l.includes(',2026-07-20,')).join('\n'));
  for (const f of ['batting_games.csv', 'pitching_games.csv']) {
    const p = join(c.inputDir, '2026', f);
    await writeFile(p, (await readFile(p, 'utf8')).split('\n').filter((l) => !l.includes(',2026-07-20,')).join('\n'));
  }
  const r2 = await runUpdate({ config: c, env: {}, allowRollback: true });
  assert.equal(r2.result, 'updated', JSON.stringify(r2));
});

test('更新: 同時に起動された場合、後の処理はスキップされ二重登録しない', async () => {
  const c = cfg('lock', { source: 'csv-dir' });
  await cp(demoDir, c.inputDir, { recursive: true });
  const release = await acquireLock(join(c.storeDir, '.update.lock'));
  const r = await runUpdate({ config: c, env: {} });
  assert.equal(r.result, 'skipped');
  await release();
  // 同時実行（Promise.all）でも1件だけ処理される
  const rs = await Promise.all([runUpdate({ config: c, env: {} }), runUpdate({ config: c, env: {} })]);
  assert.deepEqual(rs.map((x) => x.result).sort(), ['skipped', 'updated']);
  const snaps = await readdir(join(c.storeDir, 'snapshots', '2026'));
  assert.deepEqual(snaps, ['2026-07-20.json']);
  // もう一度実行してもスナップショットは同じファイル（上書き）
  await runUpdate({ config: c, env: {} });
  assert.deepEqual(await readdir(join(c.storeDir, 'snapshots', '2026')), ['2026-07-20.json']);
});

test('CSV(URL) 取得元: 再試行・304キャッシュ・トークンをエラーに出さない', async () => {
  const files = await readAll(demoDir, 2026);
  let calls = 0;
  let fail = 2;
  const seenAuth = [];
  const fetchImpl = async (url, opts) => {
    calls++;
    seenAuth.push(opts.headers.Authorization);
    const name = url.split('/').pop();
    if (name === 'meta.csv' && fail-- > 0) return new Response('busy', { status: 503 });
    if (opts.headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    if (!(name in files)) return new Response('nf', { status: 404 });
    return new Response(files[name], { status: 200, headers: { etag: '"v1"' } });
  };
  const src = csvUrlSource({ baseUrl: 'https://example.invalid/data', token: 'SECRET-TOKEN-123', cacheDir: join(tmp, 'urlcache'), fetchImpl, retryDelayMs: 1 });
  const got = await src.fetchSeason(2026);
  assert.equal(got['meta.csv'], files['meta.csv']);
  assert.ok(seenAuth.every((a) => a === 'Bearer SECRET-TOKEN-123'));
  // 2回目は 304 → キャッシュから
  const got2 = await src.fetchSeason(2026);
  assert.equal(got2['players.csv'], files['players.csv']);
  // 恒常的な失敗はトークンを含まないエラー
  const src2 = csvUrlSource({ baseUrl: 'https://example.invalid/x?token=SECRET', token: 'SECRET-TOKEN-123', cacheDir: join(tmp, 'urlcache2'), fetchImpl: async () => new Response('', { status: 500 }), retryDelayMs: 1 });
  await assert.rejects(src2.fetchSeason(2026), (e) => !e.message.includes('SECRET') && /meta\.csv の取得に失敗/.test(e.message));
});

test('画面生成: シーズン途中（日程・規定未到達）とシーズン前・データなし', async () => {
  const c = cfg('build', { source: 'csv-dir' });
  await cp(demoDir, c.inputDir, { recursive: true });
  await runUpdate({ config: c, env: {} });
  const r = await runBuild({ config: c });
  assert.ok(r.pages > 200);
  const idx = await readFile(join(c.outDir, 'index.html'), 'utf8');
  assert.match(idx, /レギュラーシーズン中/);
  assert.match(idx, /今後の日程/);
  assert.doesNotMatch(idx, /予定されている試合はありません/);
  assert.doesNotMatch(idx, /優勝決定/); // シーズン途中は優勝表示なし
  assert.doesNotMatch(idx, /<span class="demo-tag">/); // csv-dir はデモ表示なし

  // シーズン前: 成績が空でも動く
  const pre = cfg('pre', { source: 'csv-dir' });
  const d = join(pre.inputDir, '2027');
  await mkdir(d, { recursive: true });
  await writeFile(join(d, 'meta.csv'), 'key,value\nseason,2027\nas_of_date,2027-03-01\nphase,preseason\nchampion_team_id,\nsource_name,テスト\n');
  await cp(join(demoDir, '2026', 'teams.csv'), join(d, 'teams.csv'));
  await writeFile(join(d, 'standings.csv'), 'team_id,g,w,l,t,rs,ra\n' + ['F', 'E', 'L', 'M', 'B', 'H'].map((t) => `${t},0,0,0,0,0,0`).join('\n') + '\n');
  const players = (await readFile(join(demoDir, '2026', 'players.csv'), 'utf8')).split('\n').filter((l, i) => i === 0 || (l && !l.includes(',2026-07-')));
  await writeFile(join(d, 'players.csv'), players.join('\n') + '\n');
  await writeFile(join(d, 'batting.csv'), 'player_id,team_id,g,pa,ab,r,h,2b,3b,hr,rbi,sb,bb,hbp,so,sf\n');
  await writeFile(join(d, 'pitching.csv'), 'player_id,team_id,g,gs,w,l,hld,sv,ip,h,hr,bb,hbp,so,er\n');
  const rr = await runUpdate({ config: pre, env: {} });
  assert.equal(rr.result, 'updated', JSON.stringify(rr));
  await runBuild({ config: pre });
  const pidx = await readFile(join(pre.outDir, 'index.html'), 'utf8');
  assert.match(pidx, /開幕前/);
  assert.match(pidx, /算出不可/); // 0勝0敗の勝率
  const anyPlayer = (await readdir(join(pre.outDir, 'players'))).find((f) => f !== 'index.html');
  const ph = await readFile(join(pre.outDir, 'players', anyPlayer), 'utf8');
  assert.match(ph, /今季は(打席に立った|登板)記録がありません|今季の(出場|登板)記録はありません/);

  // まだ正常データが一度もない場合
  const empty = cfg('empty', { source: 'csv-dir' });
  const re = await runUpdate({ config: empty, env: {} });
  assert.equal(re.result, 'failed');
  const rb = await runBuild({ config: empty });
  assert.equal(rb.empty, true);
});

test('画面生成: 出力先に生成物以外のファイルがあれば削除せず中止', async () => {
  const c = cfg('guard', { source: 'csv-dir' });
  await mkdir(c.outDir, { recursive: true });
  await writeFile(join(c.outDir, 'important.txt'), 'x');
  await assert.rejects(runBuild({ config: c }), /削除しないで中止/);
  assert.equal(await readFile(join(c.outDir, 'important.txt'), 'utf8'), 'x');
  await rm(c.outDir, { recursive: true });
});
