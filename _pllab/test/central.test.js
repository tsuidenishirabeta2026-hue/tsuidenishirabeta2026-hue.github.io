// セ・リーグ版（PLLAB_SITE=central）: リーグ設定の切り替えで同じ仕組みからサイトを作れることの確認
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../src/config.js';
import { loadLeague } from '../src/league.js';
import { parseStandings, parseTitles, standingsTitle } from '../src/sources/wikipedia.js';
import { teamsIn, parseEvents } from '../src/moves/wikipedia.js';
import { teamIdOf } from '../src/sources/player-articles.js';

const CL = loadLeague('central');
const PL = loadLeague('pacific');

// 書式を模したテスト用データ（Wikipedia の順位表テンプレートと同じ形。監督名は架空）
const STANDINGS = `{{NPB順位表
|リーグ=セントラル・リーグ|タイトル=2026年 セントラル・リーグ|年=2026
|1結果=1v|2結果=2|3結果=3|4結果=4|5結果=5|6結果=6
|阪神タイガース|79|62|2|[[監督T]]
|読売ジャイアンツ|76|64|3|[[監督G]]
|横浜DeNAベイスターズ|71|69|3|[[監督DB]]
|広島東洋カープ|61|78|4|[[監督C]]
|東京ヤクルトスワローズ|61|80|2|[[監督S]]
|中日ドラゴンズ|60|81|2|[[監督D]]
|}}`;

const YEAR = `== 個人タイトル ==
{| class="wikitable"
|-
! ||colspan="3"|セントラル・リーグ||colspan="3"|パシフィック・リーグ
|-
!タイトル||選手||球団||成績||選手||球団||成績
|-
|首位打者||[[内野T]]||阪神||.306||某||ソフトバンク||.313
|-
|最多セーブ投手||[[投手G (野球)|投手G]]||巨人||42S||某||日本ハム||30S
|}
`;

test('リーグ設定: 両リーグとも6球団・球団IDの重複なし・色と名前がそろっている', () => {
  for (const L of [PL, CL]) {
    assert.equal(L.teams.length, 6);
    assert.equal(new Set(L.teamIds).size, 6);
    for (const t of L.teams) {
      assert.match(t.team_id, /^[A-Z]{1,3}$/);
      assert.match(t.color, /^#[0-9a-f]{6}$/i);
      assert.ok(t.name && t.short_name && t.home && t.stadium);
    }
  }
  assert.deepEqual(PL.teamIds, ['F', 'E', 'L', 'M', 'B', 'H']);
  assert.deepEqual(CL.teamIds, ['G', 'T', 'DB', 'C', 'S', 'D']);
  // セとパで球団IDが重ならない（将来の親サイトで両方をまとめても区別できる）
  assert.equal(PL.teamIds.filter((x) => CL.teamIds.includes(x)).length, 0);
});

test('サイト設定: パ・リーグ版の URL・出力先は変えず、セ・リーグ版は別のドメイン・出力先・データ置き場', () => {
  const pc = loadConfig({}, 'pacific');
  const cc = loadConfig({}, 'central');
  assert.equal(pc.league, 'pacific');
  assert.equal(pc.siteUrl, 'https://pacific-labo.com');
  assert.equal(pc.basePath, '/pl-lab/');
  assert.equal(pc.outDir, join(ROOT, '..', 'pl-lab'));
  assert.equal(pc.analytics.id, 'G-WSNC046WSL');
  assert.equal(cc.league, 'central');
  assert.equal(cc.siteName, 'セ・リーグ成績ラボ');
  assert.equal(cc.siteUrl, 'https://centrallabo.com');
  assert.equal(cc.basePath, '/cl-lab/');
  assert.equal(cc.outDir, join(ROOT, '..', 'cl-lab'));
  // 計測・note・データ置き場はパ・リーグ版と共有しない
  assert.notEqual(cc.analytics.id, pc.analytics.id);
  assert.equal(cc.analytics.id, 'G-Y8PW9E6MMS');
  assert.equal(cc.note.profileUrl, 'https://note.com/central_labo');
  assert.notEqual(cc.note.profileUrl || '', pc.note.profileUrl);
  for (const k of ['inputDir', 'storeDir', 'logFile', 'columnsDir', 'outDir']) assert.notEqual(cc[k], pc[k], k);
  // AdSense の運営者IDは同じでよい
  assert.equal(cc.adsense.client, pc.adsense.client);
});

test('順位表: セ・リーグのテンプレート名と球団名で読める', () => {
  assert.equal(standingsTitle(2026, CL), 'Template:2026年のセントラル・リーグ順位表');
  assert.equal(standingsTitle(2026, PL), 'Template:2026年のパシフィック・リーグ順位表');
  const st = parseStandings(STANDINGS, CL);
  assert.deepEqual(st.rows.map((r) => r.team_id), ['T', 'G', 'DB', 'C', 'S', 'D']);
  assert.equal(st.champion, 'T');
  assert.equal(st.rows[2].t, 3);
  // パ・リーグの設定では読まない（取り違えの防止）
  assert.equal(parseStandings(STANDINGS, PL).rows.length, 0);
});

test('個人タイトル: セントラル・リーグ側の列だけを読む', () => {
  const t = parseTitles(YEAR, CL);
  assert.deepEqual(t.map((x) => [x.title, x.player, x.team_id, x.value]), [
    ['首位打者', '内野T', 'T', '.306'],
    ['最多セーブ投手', '投手G', 'G', '42S'],
  ]);
  assert.equal(parseTitles(YEAR, PL).length, 2);
  assert.equal(parseTitles(YEAR, PL)[0].team_id, 'H');
});

test('選手記事の球団セル: 略称・旧称でもセ・リーグ球団と判定し、パ・リーグ球団は対象外', () => {
  const cell = (text, raw = text) => ({ text, raw });
  assert.equal(teamIdOf(cell('巨人', '[[読売ジャイアンツ|巨人]]'), CL), 'G');
  assert.equal(teamIdOf(cell('横浜', '[[横浜DeNAベイスターズ|横浜]]'), CL), 'DB');
  assert.equal(teamIdOf(cell('DeNA'), CL), 'DB');
  assert.equal(teamIdOf(cell('ヤクルト'), CL), 'S');
  assert.equal(teamIdOf(cell('ソフトバンク'), CL), null);
  assert.equal(teamIdOf(cell('ソフトバンク'), PL), 'H');
  assert.equal(teamIdOf(cell('HOU'), CL), null);
});

test('移籍・契約: セ・リーグ球団を含む出来事を拾い、紛らわしい語（中日新聞・広島県など）では拾わない', () => {
  assert.deepEqual(teamsIn('横浜DeNAベイスターズは、オリックスから国内FA権を行使していた選手を獲得したと発表。', CL), ['DB']);
  assert.deepEqual(teamsIn('東京ヤクルトスワローズは、中日を戦力外となっていた選手を獲得。', CL), ['S', 'D']);
  assert.deepEqual(teamsIn('中日新聞の報道によると、広島県内で式典が行われた。', CL), []);
  assert.deepEqual(teamsIn('北海道日本ハムファイターズは、選手と契約を更改。', CL), []);
  const wt = `== できごと ==
=== 11月 ===
* [[11月20日]]
** [[中日ドラゴンズ]]は、[[選手A]]を育成契約で獲得したことを発表。
** [[千葉ロッテマリーンズ]]は、選手Bと契約を更改。
`;
  const r = parseEvents(wt, 2026, CL);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.events[0].teams, ['D']);
  assert.equal(r.events[0].date, '2026-11-20');
});

// 処理対象のリーグはプロセスごとに決まるため、セ・リーグ版の取得〜生成は別プロセスで確かめる
test('セ・リーグ版の取得 → 検証 → 保存 → サイト生成（PLLAB_SITE=central）', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'cllab-'));
  const roster = (t) => `{{Navbox
|list1 = {{Navbox
 |title = 支配下選手
|group1 = 投手
|list1 =
* {{nowrap|11 [[投手${t}]]}}
|group2 = 内野手
|list2 =
* {{nowrap|5 [[内野${t}]]}}
}}
}}`;
  const code = `
    import { wikipediaSource, standingsTitle, rosterTitle, yearTitle, TEAMS } from './src/sources/wikipedia.js';
    import { runUpdate } from './src/update.js';
    import { runBuild } from './src/build.js';
    import { loadConfig } from './src/config.js';
    const STANDINGS = ${JSON.stringify(STANDINGS)};
    const YEAR = ${JSON.stringify(YEAR)};
    const roster = ${roster.toString()};
    const pages = [
      { title: standingsTitle(2026), revisions: [{ revid: 1, slots: { main: { content: STANDINGS } } }] },
      { title: yearTitle(2026), revisions: [{ revid: 2, slots: { main: { content: YEAR } } }] },
      ...TEAMS.map((t, i) => ({ title: rosterTitle(t), revisions: [{ revid: 10 + i, slots: { main: { content: roster(t.team_id) } } }] })),
    ];
    const body = JSON.stringify({ query: { pages } });
    const tmp = ${JSON.stringify(tmp)};
    const config = { ...loadConfig(), storeDir: tmp + '/store', logFile: tmp + '/log.jsonl', outDir: tmp + '/cl-lab', inputDir: tmp + '/input' };
    const source = wikipediaSource({ fetchImpl: async () => new Response(body), now: () => new Date('2026-11-22T00:00:00Z') });
    const r = await runUpdate({ config, env: {}, source });
    const b = await runBuild({ config });
    console.log(JSON.stringify({ r, b }));
  `;
  const env = { ...process.env, PLLAB_SITE: 'central' };
  for (const k of ['PLLAB_STORE_DIR', 'PLLAB_OUT_DIR', 'PLLAB_LOG_FILE', 'PLLAB_INPUT_DIR']) delete env[k];
  const outText = execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: ROOT, env, encoding: 'utf8' });
  const { r, b } = JSON.parse(outText.trim().split('\n').pop());
  assert.equal(r.result, 'updated', JSON.stringify(r));
  assert.equal(b.players, 12);
  const out = join(tmp, 'cl-lab');
  const teams = (await readdir(join(out, 'teams'))).sort();
  assert.deepEqual(teams, ['C.html', 'D.html', 'DB.html', 'G.html', 'S.html', 'T.html']);
  const idx = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(idx, /<title>セ・リーグ成績ラボ（非公式）<\/title>/);
  assert.match(idx, /<h1>セ・リーグ 2026年 成績<\/h1>/);
  assert.match(idx, /2026年 セ・リーグ個人タイトル/);
  assert.match(idx, /<link rel="canonical" href="https:\/\/centrallabo\.com\/">/);
  // 旧URL（github.io/cl-lab/）からの転送は /cl-lab を取り除く
  assert.match(idx, /location\.pathname\.replace\(\/\^\\\/cl-lab\/,''\)/);
  assert.doesNotMatch(idx, /パ・リーグ|パシフィック|pacific-labo|G-WSNC046WSL/);
  const about = await readFile(join(out, 'about.html'), 'utf8');
  assert.match(about, /「セ・リーグ成績ラボ」は、セ・リーグ6球団/);
  assert.doesNotMatch(about, /パ・リーグ|パシフィック/);
  const priv = await readFile(join(out, 'privacy.html'), 'utf8');
  assert.match(priv, /対象: セ・リーグ成績ラボ（\/cl-lab\/ 以下のページ）/);
  assert.equal(await readFile(join(out, 'ads.txt'), 'utf8'), 'google.com, pub-4831721034846373, DIRECT, f08c47fec0942fa0\n');
  assert.match(await readFile(join(out, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/centrallabo\.com\/sitemap\.xml/);
});
