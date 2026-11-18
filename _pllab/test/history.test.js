import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBatting, parsePitching, parseArticle } from '../src/sources/player-articles.js';
import { buildHistory, playerInsight, biggestRisers } from '../src/history.js';
import { loadNotes, relatedNotes, trackedUrl } from '../src/notes.js';
import { noteBlock } from '../src/render/notes.js';
import { analyticsTag } from '../src/render/layout.js';

// 書式を模した架空の選手記事（数値は検算が合うように作成）
const BAT_ARTICLE = `== 詳細情報 ==
=== 年度別打撃成績 ===
{| {{年度別打撃成績|リーグ=日本野球機構}}
|-
|style="text-align:center;"|{{by2|2025}}
|rowspan="2" style="text-align:center;"|[[福岡ソフトバンクホークス|ソフトバンク]]
|100||400||350||40||84||15||1||8||125||40||5||2||5||5||35||2||5||80||6||.240||.312||.357||.669
|-
|style="text-align:center;"|{{by2|2026}}
|120||500||430||70||'''129'''||25||2||25||233||90||8||3||2||8||50||4||10||90||8||.300||.384||.542||.926
|-
|style="text-align:center;"|{{by2|2024}}
|[[阪神タイガース|阪神]]
|10||20||18||1||3||0||0||0||3||1||0||0||1||0||1||0||0||5||0||.167||.211||.167||.378
|-
!colspan="2"|通算：3年
|230||920||798||111||216||40||3||33||361||131||13||5||8||13||86||6||15||175||14||.271||.348||.452||.800
|}
* 2026年度シーズン終了時
`;

const PIT_ARTICLE = `=== 年度別投手成績 ===
{| {{投手成績}}
|-
|style="text-align:center;"|{{by2|2025}}
|rowspan="2"|[[埼玉西武ライオンズ|西武]]
|20||20||1||0||0||8||8||0||0||.500||500||120.0||120||12||40||1||5||90||2||0||60||56||4.20||1.33
|-
|style="text-align:center;"|{{by2|2026}}
|25||25||2||1||1||12||6||0||0||.667||600||150.1||120||10||35||0||4||140||1||0||45||40||2.39||1.03
|-
|style="text-align:center;"|{{by2|2023}}
|[[西武]]
|5||0||0||0||0||0||1||0||1||.000||40||9.0||10||1||5||0||0||8||0||0||6||6||9.99||1.67
|}
`;

test('年度別打撃成績: rowspan の球団を引き継ぎ、検算が合う行だけ有効', () => {
  const rows = parseBatting(BAT_ARTICLE);
  assert.equal(rows.length, 3); // 通算行は除く
  const [a, b, c] = rows;
  assert.deepEqual([a.year, a.team_id, a.PA, a.valid], [2025, 'H', 400, true]);
  assert.deepEqual([b.year, b.team_id, b.H, b.valid], [2026, 'H', 129, true]); // '''太字''' も数値として読む
  assert.deepEqual([c.year, c.team, c.team_id], [2024, '阪神', null]); // セ・リーグ球団は team_id なし
});

test('年度別投手成績: 投球回をアウト数で読み、防御率の検算が合わない行は無効', () => {
  const rows = parsePitching(PIT_ARTICLE);
  assert.equal(rows[0].outs, 360);
  assert.equal(rows[1].outs, 451); // 150.1回
  assert.equal(rows[1].valid, true);
  assert.equal(rows[2].valid, false); // 防御率 9.99 は 6×27÷27=6.00 と合わない
});

test('記事の更新判定', () => {
  assert.equal(parseArticle(BAT_ARTICLE, 2026).updated, true);
  assert.equal(parseArticle(PIT_ARTICLE.replace('2026', '2027'), 2026).updated, false);
});

function fixtureHistory() {
  const mk = (id, title, pos) => ({ id, isPitcher: pos === '投手', info: { wiki_title: title, team_id: 'H', position: pos }, name: id });
  const players = [mk('a', 'A', '外野手'), mk('b', 'B', '投手'), mk('c', 'C', '内野手')];
  const store = {
    articles: {
      A: { revid: 1, updatedThrough: 2026, ...parseArticle(BAT_ARTICLE, 2026) },
      B: { revid: 2, updatedThrough: 2026, ...parseArticle(PIT_ARTICLE, 2026) },
      // C は記事が2025年までしか更新されていない
      C: { revid: 3, updatedThrough: 2025, batting: parseBatting(BAT_ARTICLE).filter((r) => r.year === 2025), pitching: null },
    },
  };
  return { H: buildHistory(store, players, 2026), players };
}

test('前年比・リーグ平均・短評: 比較条件つき、母集団は更新済みの記事のみ', () => {
  const { H, players } = fixtureHistory();
  // 2026年: 3記事中2記事が更新 → 67% < 70% → リーグ平均は計算しない。2025年は 100%
  assert.equal(H.seasons[2026].usable, false);
  assert.equal(H.seasons[2025].usable, true);
  const I = playerInsight(H, players[0]);
  assert.equal(I.latest, 2026);
  assert.equal(I.curSize, 500);
  assert.equal(I.prevSize, 400);
  assert.ok(I.enough);
  const ops = I.yoy.find((m) => m.key === 'OPS');
  assert.ok(ops.improved);
  assert.equal(I.league.year, 2025); // 2026年は更新率不足のため 2025年で比較
  assert.ok(I.coverageNote.includes('67%'));
  assert.ok(I.comment.length >= 1);
  assert.ok(I.comment.every((c) => c.text && ['事実', '計算', '解釈', '注意'].includes(c.kind)));
  assert.match(I.comment[0].text, /OPS|打率|出塁率|ISO|四球率|三振率/);
  // 投手: 防御率 4.20 → 2.39 は改善
  const P = playerInsight(H, players[1]);
  assert.ok(P.yoy.find((m) => m.key === 'ERA').improved);
  // 記事の無い選手
  assert.equal(playerInsight(H, { id: 'z', isPitcher: false, info: {} }).status, 'no-article');
});

test('前年から伸びた選手: 更新率を満たす年で比較', () => {
  const { H, players } = fixtureHistory();
  const R = biggestRisers(H, new Map(players.map((p) => [p.id, p])));
  assert.equal(R.year, 2025); // 2026年は更新率不足
  assert.equal(R.bats.length, 0); // 2024年の打席が少ないため対象外
});

test('note の導線: 公開済みのみ、選手→球団→全体の順、utm 付き、計測用属性', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pllab-notes-'));
  const f = join(tmp, 'notes.csv');
  await writeFile(
    f,
    'note_id,status,type,price,title,url,published_at,teams,players,summary\n' +
      'n1,published,paid,500,選手Aの深掘り,https://note.com/x/n/n1,2026-11-20,H,a,概要\n' +
      'n2,published,free,0,全体の話,https://note.com/x/n/n2,2026-11-19,,,\n' +
      'n3,draft,free,0,下書き,https://note.com/x/n/n3,2026-11-21,,,\n' +
      'n4,published,paid,,価格なし,https://note.com/x/n/n4,2026-11-21,,,\n' +
      'n5,published,free,0,偽URL,https://example.com/a,2026-11-21,,,\n',
  );
  const { notes, errors } = await loadNotes(f);
  assert.deepEqual(notes.map((n) => n.id), ['n1', 'n2']);
  assert.equal(errors.length, 2);
  assert.deepEqual(relatedNotes(notes, { playerId: 'a', teamId: 'H' }).map((n) => n.id), ['n1', 'n2']);
  assert.deepEqual(relatedNotes(notes, { teamId: 'F' }).map((n) => n.id), ['n2']);
  const u = new URL(trackedUrl('https://note.com/x/n/n1', { pageType: 'player', playerId: 'a' }));
  assert.equal(u.searchParams.get('utm_source'), 'pl-lab');
  assert.equal(u.searchParams.get('utm_content'), 'a');
  const html = noteBlock({ notes }, { pageType: 'player', playerId: 'a', teamId: 'H' });
  assert.match(html, /data-note-id="n1"/);
  assert.match(html, /data-player-id="a"/);
  assert.match(html, /有料 500円/);
  // 記事もプロフィールも無ければ何も出さない（仮のリンクを出さない）
  assert.equal(noteBlock({ notes: [] }, { pageType: 'player' }), '');
});

test('計測タグ: 正しい ID のときだけ出力', () => {
  assert.equal(analyticsTag({ analytics: {} }), '');
  assert.equal(analyticsTag({ analytics: { provider: 'ga4', id: 'bad"><script>' } }), '');
  assert.match(analyticsTag({ analytics: { provider: 'ga4', id: 'G-ABC123' } }, { pageType: 'player', playerId: 'a' }), /gtag\/js\?id=G-ABC123/);
  assert.match(analyticsTag({ analytics: { provider: 'umami', id: '12345678-1234-1234-1234-123456789abc', umamiScript: 'https://cloud.umami.is/script.js' } }), /data-website-id/);
});
