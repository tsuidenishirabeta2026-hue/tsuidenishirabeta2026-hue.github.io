import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEvents, cleanWikitext, extractSources, categorize, fetchArticle } from '../src/moves/wikipedia.js';
import { runMovesUpdate, targetYears } from '../src/update-moves.js';
import { loadConfig } from '../src/config.js';

// 書式を模したテスト用の短い記事（架空の内容）
const SAMPLE = `前文
== できごと ==
=== 10月 ===
* [[10月1日|1日]]
** 架空ライオンズ……ではなく、埼玉西武ライオンズは、[[テスト太郎]]に来季の契約を結ばない旨を通告したと発表<ref>{{Cite web ja|title=見出し|url=https://example.com/a|website=テスト新聞|date=2026-10-01}}</ref>。
** 読売ジャイアンツは、[[テスト次郎|次郎]]の引退を発表<ref>{{Cite web|url=https://example.com/b|website=別新聞}}</ref>。
=== 11月 ===
* [[11月6日|6日]]
** 広島東洋カープは、福岡ソフトバンクホークスとの無償トレードにより、'''テスト三郎'''を獲得したことを発表{{R|x}}。
* [[11月8日|8日]]
** 北海道日本ハムファイターズは、来季のコーチングスタッフを以下の通り発表。
*** 【一軍】[[テスト四郎]]（監督）、テスト五郎（打撃、'''70'''）
* 9日
** 千葉ロッテマリーンズは、記念試合を開催<!-- コメント -->。
== 達成された記録 ==
* 東北楽天ゴールデンイーグルスの記録（できごと節の外なので対象外）
`;

test('wikitext の整形・出典抽出・分類', () => {
  assert.equal(cleanWikitext("[[A|B]]と[[C]]、'''D'''<ref>x</ref>{{R|y}}{{仮リンク|E|en|F}}"), 'BとC、DE');
  const s = extractSources('本文<ref>{{Cite web|url=https://example.com/a|website=テスト新聞|date=2026-10-01}}</ref>');
  assert.deepEqual(s, [{ url: 'https://example.com/a', site: 'テスト新聞', date: '2026-10-01' }]);
  assert.deepEqual(categorize('無償トレードにより獲得'), ['トレード', '獲得・入団・契約']);
  assert.deepEqual(categorize('記念試合を開催'), ['その他']);
});

test('できごと節から、パ・リーグ球団に関係する出来事だけを日付つきで抽出', () => {
  const r = parseEvents(SAMPLE, 2026);
  assert.equal(r.months, 2);
  const dates = r.events.map((e) => `${e.date} ${e.teams.join(',')}`);
  assert.deepEqual(dates, ['2026-10-01 L', '2026-11-06 H', '2026-11-08 F', '2026-11-09 M']);
  const [l, h, f] = r.events;
  assert.ok(l.categories.includes('戦力外・退団'));
  assert.equal(l.sources[0].site, 'テスト新聞');
  assert.ok(!l.text.includes('<ref'));
  assert.ok(h.categories.includes('トレード'));
  assert.equal(h.text, '広島東洋カープは、福岡ソフトバンクホークスとの無償トレードにより、テスト三郎を獲得したことを発表。');
  assert.deepEqual(f.details, ['【一軍】テスト四郎（監督）、テスト五郎（打撃、70）']);
  assert.ok(f.categories.includes('首脳陣'));
  // 「達成された記録」節は対象外、セ・リーグのみの出来事も対象外
  assert.ok(!r.events.some((e) => e.text.includes('対象外') || e.text.includes('読売')));
});

test('取得対象の年（1〜6月は前年の記事も）', () => {
  assert.deepEqual(targetYears(new Date('2026-11-18T00:00:00Z')), [2026]);
  assert.deepEqual(targetYears(new Date('2027-01-10T00:00:00Z')), [2026, 2027]);
  assert.deepEqual(targetYears(new Date('2026-12-31T16:00:00Z')), [2026, 2027]); // 日本時間では1月1日
});

test('API: 429 は再試行、存在しない記事は null', async () => {
  let n = 0;
  const ok = { parse: { title: 'T', revid: 5, wikitext: SAMPLE } };
  const f1 = async () => (++n < 2 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : new Response(JSON.stringify(ok)));
  const a = await fetchArticle('T', { fetchImpl: f1, userAgent: 'test', retryDelayMs: 1 });
  assert.equal(a.revid, 5);
  assert.equal(n, 2);
  const f2 = async () => new Response(JSON.stringify({ error: { code: 'missingtitle' } }));
  assert.equal(await fetchArticle('X', { fetchImpl: f2, userAgent: 'test' }), null);
});

test('更新: 成功 → 書式が読めない取得結果では前回データを維持 → 手動CSVの統合', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pllab-moves-'));
  const config = { ...loadConfig(), storeDir: join(tmp, 'store'), inputDir: join(tmp, 'input'), logFile: join(tmp, 'log.jsonl') };
  const now = () => new Date('2026-11-18T00:00:00Z');
  const respond = (wikitext, revid) => async () => new Response(JSON.stringify({ parse: { title: '2026年の日本プロ野球', revid, wikitext } }));
  const r1 = await runMovesUpdate({ config, env: {}, now, fetchImpl: respond(SAMPLE, 1) });
  assert.equal(r1.result, 'updated');
  const before = await readFile(join(config.storeDir, 'moves.json'), 'utf8');
  const r2 = await runMovesUpdate({ config, env: {}, now, fetchImpl: respond('== 別の節 ==\n本文', 2) });
  assert.equal(r2.result, 'failed');
  assert.equal(await readFile(join(config.storeDir, 'moves.json'), 'utf8'), before);
  const st = JSON.parse(await readFile(join(config.storeDir, 'moves-status.json'), 'utf8'));
  assert.equal(st.last_result, 'failed');
  // 手動CSV（契約更改など）
  await mkdir(config.inputDir, { recursive: true });
  await writeFile(join(config.inputDir, 'moves.csv'), 'date,team_id,category,text,source_name,source_url\n2026-12-01,H,契約更改,テスト選手が契約を更改,球団発表,https://example.com/c\n');
  const r3 = await runMovesUpdate({ config, env: {}, now, fetchImpl: respond(SAMPLE, 1) });
  assert.equal(r3.result, 'updated');
  const saved = JSON.parse(await readFile(join(config.storeDir, 'moves.json'), 'utf8'));
  assert.equal(saved.events[0].origin, 'manual');
  assert.equal(saved.events[0].categories[0], '契約更改');
  // 手動CSVの誤りは失敗扱い（前回データ維持）
  await writeFile(join(config.inputDir, 'moves.csv'), 'date,team_id,category,text\n2026-13-01,X,なし,\n');
  const r4 = await runMovesUpdate({ config, env: {}, now, fetchImpl: respond(SAMPLE, 1) });
  assert.equal(r4.result, 'failed');
  assert.ok(r4.details.some((d) => d.includes('team_id')));
});
