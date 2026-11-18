import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseStandings, parseRoster, parseTitles, linkTitles, phaseFor, wikipediaSource, playerIdFor, TEAMS, standingsTitle, rosterTitle, yearTitle } from '../src/sources/wikipedia.js';
import { validateSeason } from '../src/validate.js';
import { runUpdate } from '../src/update.js';
import { runBuild } from '../src/build.js';
import { loadConfig } from '../src/config.js';

// 書式を模したテスト用データ（選手名は架空）
const STANDINGS = `{{NPB順位表
|1結果=1v|2結果=2|3結果=3|4結果=4|5結果=5|6結果=6r
|福岡ソフトバンクホークス|91|49|3|監督A
|埼玉西武ライオンズ|79|60|4|監督B
|北海道日本ハムファイターズ|78|62|3|監督C
|オリックス・バファローズ|65|76|2|監督D
|千葉ロッテマリーンズ|63|77|3|監督E
|東北楽天ゴールデンイーグルス|58|84|1|監督F
|}}`;

const roster = (team, prefix) => `{{Navbox
|list1 = {{Navbox
 |title = 監督・コーチ
|group1 = 監督
|list1 =
* {{nowrap|1 [[監督${prefix}]]}}
}}
|list2 ={{Navbox
 |title = 支配下選手
|group1 = 投手
|list1 =
* {{Nowrap|11 [[投手${prefix} (野球)|投手${prefix}]]}}
* {{nowrap|12 [[外国人${prefix}・テスト|テスト]]}}
|group2 = 捕手
|list2 =
* {{nowrap|00 [[捕手${prefix}]]}}
|group3 = 内野手
|list3 =
* {{nowrap|5 [[内野${prefix}]]}}
|group4 = 外野手
|list4 =
* {{nowrap|7 [[外野${prefix}]]}}
}}
|list3 = {{Navbox
 |title = 育成選手
|group1 = 投手
|list1 =
* {{nowrap|121 [[育成${prefix}]]}}
}}
}}`;

const YEAR = `== 個人タイトル ==
=== 個人タイトル ===
{| class="wikitable"
|-
! ||colspan="3"|セントラル・リーグ||colspan="3"|パシフィック・リーグ
|-
!タイトル||選手||球団||成績||選手||球団||成績
|-
|首位打者||某||阪神||.300||[[内野H]]||ソフトバンク||.313
|-
|rowspan="2"|最多勝利||rowspan="2"|某||rowspan="2"|阪神||rowspan="2"|16勝||[[投手F (野球)|投手F]]||日本ハム||rowspan="2"|13勝
|-
|投手B||オリックス
|}
`;

function fixture() {
  const pages = [
    { title: standingsTitle(2026), revisions: [{ revid: 1, slots: { main: { content: STANDINGS } } }] },
    { title: yearTitle(2026), revisions: [{ revid: 2, slots: { main: { content: YEAR } } }] },
    ...TEAMS.map((t, i) => ({ title: rosterTitle(t), revisions: [{ revid: 10 + i, slots: { main: { content: roster(t, t.team_id) } } }] })),
    { title: standingsTitle(2025), missing: true },
  ];
  return JSON.stringify({ query: { pages } });
}

test('順位表: 勝敗・公式順位（掲載順）・優勝', () => {
  const r = parseStandings(STANDINGS);
  assert.deepEqual(r.rows.map((x) => `${x.team_id}${x.w}-${x.l}-${x.t}#${x.official_rank}`), ['H91-49-3#1', 'L79-60-4#2', 'F78-62-3#3', 'B65-76-2#4', 'M63-77-3#5', 'E58-84-1#6']);
  assert.equal(r.rows[0].g, 143);
  assert.equal(r.champion, 'H');
});

test('選手一覧: 支配下・育成、守備位置、背番号 00、監督・コーチは除外、Nowrap の大文字も読む', () => {
  const ps = parseRoster(roster(TEAMS[0], 'F'), 'F');
  assert.deepEqual(ps.map((p) => `${p.number}:${p.name}:${p.position}:${p.roster_type}`), ['11:投手F:投手:支配下', '12:テスト:投手:支配下', '00:捕手F:捕手:支配下', '5:内野F:内野手:支配下', '7:外野F:外野手:支配下', '121:育成F:投手:育成']);
  assert.equal(ps[0].wiki_title, '投手F (野球)');
  assert.ok(!ps.some((p) => p.name.includes('監督')));
});

test('個人タイトル: rowspan を展開し、パ・リーグ側だけを取り出して選手に結びつける', () => {
  const t = parseTitles(YEAR);
  assert.deepEqual(t.map((x) => `${x.title}:${x.player}:${x.team_id}:${x.value}`), ['首位打者:内野H:H:.313', '最多勝利:投手F:F:13勝', '最多勝利:投手B:B:13勝']);
  const players = [
    { player_id: 'a', team_id: 'H', name: '内野H', wiki_title: '内野H' },
    { player_id: 'b', team_id: 'F', name: '投手F', wiki_title: '投手F (野球)' },
    { player_id: 'c', team_id: 'B', name: '投手B', wiki_title: '投手B' },
  ];
  assert.deepEqual(linkTitles(t, players).map((x) => x.player_id), ['a', 'b', 'c']);
});

test('選手IDは記事名から安定して作られる', () => {
  assert.equal(playerIdFor('投手F (野球)'), playerIdFor('投手F (野球)'));
  assert.notEqual(playerIdFor('投手F (野球)'), playerIdFor('投手F'));
  assert.match(playerIdFor('x'), /^w[0-9a-f]{10}$/);
});

test('期間区分の目安', () => {
  assert.equal(phaseFor('2026-11-18', 2026), 'offseason');
  assert.equal(phaseFor('2026-06-01', 2026), 'regular');
  assert.equal(phaseFor('2027-01-10', 2026), 'offseason');
  assert.equal(phaseFor('2026-03-10', 2026), 'preseason');
});

test('取得元全体: 1リクエストで取得し、検証を通る CSV を返す（存在しない年は除外）', async () => {
  let calls = 0;
  const src = wikipediaSource({ fetchImpl: async () => (calls++, new Response(fixture())), now: () => new Date('2026-11-18T00:00:00Z') });
  assert.deepEqual(await src.listSeasons(), [2026]);
  const texts = await src.fetchSeason(2026);
  assert.equal(calls, 1);
  const r = validateSeason(2026, texts);
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(r.data.meta.stats_level, 'none');
  assert.equal(r.data.players.length, 36);
  assert.equal(r.data.titles.length, 3);
  assert.equal(r.data.batting.length, 0);
});

test('個人成績なしの画面: 「出場記録なし」と誤表示せず、未掲載と明記する', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pllab-wp-'));
  const config = { ...loadConfig(), storeDir: join(tmp, 'store'), logFile: join(tmp, 'log.jsonl'), outDir: join(tmp, 'pl-lab') };
  const source = wikipediaSource({ fetchImpl: async () => new Response(fixture()), now: () => new Date('2026-11-18T00:00:00Z') });
  const r = await runUpdate({ config, env: {}, source });
  assert.equal(r.result, 'updated', JSON.stringify(r));
  await runBuild({ config });
  const idx = await readFile(join(config.outDir, 'index.html'), 'utf8');
  assert.match(idx, /個人タイトル/);
  assert.doesNotMatch(idx, /主要ランキング/);
  assert.doesNotMatch(idx, /class="notice demo"/);
  assert.match(idx, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
  const team = await readFile(join(config.outDir, 'teams', 'H.html'), 'utf8');
  assert.match(team, /所属選手（6人）/);
  assert.doesNotMatch(team, /出場記録なし|登板記録なし/);
  const files = (await readdir(join(config.outDir, 'players'))).filter((f) => f !== 'index.html');
  assert.equal(files.length, 36);
  const pl = await readFile(join(config.outDir, 'players', files[0]), 'utf8');
  assert.match(pl, /個人成績は掲載していません/);
  assert.doesNotMatch(pl, /出場記録|登板記録/);
});
