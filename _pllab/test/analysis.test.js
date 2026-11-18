import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadConfig } from '../src/config.js';
import { validateSeason } from '../src/validate.js';
import { buildSeasonModel } from '../src/model.js';
import { analyzeBatter, analyzePitcher, analyzeTeam, fip } from '../src/analysis.js';
import { FILES } from '../src/schema.js';

async function demoModel() {
  const texts = {};
  for (const def of Object.values(FILES)) {
    try {
      texts[def.file] = await readFile(join(ROOT, 'data/demo/2026', def.file), 'utf8');
    } catch {}
  }
  const r = validateSeason(2026, texts);
  assert.ok(r.ok, r.errors.join('\n'));
  return buildSeasonModel(r.data);
}

// 成績から推測してはいけない内容・将来を保証する表現
const FORBIDDEN = /故障|怪我|ケガ|性格|努力|練習|フォーム|球速|球種|守備力|確実に|必ず|間違いなく|保証|活躍するでしょう|優勝するでしょう/;

test('全選手の分析文: 禁止表現なし・根拠つき・5項目の順序', async () => {
  const S = await demoModel();
  const th = loadConfig().thresholds;
  let n = 0;
  for (const p of S.players.values()) {
    const A = p.isPitcher ? analyzePitcher(S, p, th) : analyzeBatter(S, p, th);
    const items = [A.note, ...A.type, ...A.strengths, ...A.weaknesses, ...A.recent, ...A.watch].filter(Boolean);
    for (const it of items) {
      assert.ok(['事実', '計算', '解釈', '注意'].includes(it.kind), it.kind);
      assert.doesNotMatch(it.text, FORBIDDEN, `${p.name}: ${it.text}`);
      if (it.kind === '計算' || it.kind === '解釈') assert.ok(it.basis && it.basis.length > 5, `根拠なし: ${it.text}`);
    }
    const hasStats = p.isPitcher ? p.pit && p.pit.outs > 0 : p.bat && p.bat.PA > 0;
    if (hasStats) {
      assert.ok(A.type.length && A.strengths.length && A.weaknesses.length && A.recent.length && A.watch.length, `${p.name} の分析が欠けている`);
      n++;
    } else {
      assert.match(A.note.text, /記録がありません/);
    }
  }
  assert.ok(n > 150);
});

test('サンプルが少ない選手は注意書きを出し、タイプ判定をしない', async () => {
  const S = await demoModel();
  const th = loadConfig().thresholds;
  const small = [...S.players.values()].find((p) => !p.isPitcher && p.bat && p.bat.PA > 0 && p.bat.PA < th.smallSamplePA);
  assert.ok(small, 'テスト用の少打席選手がいる');
  const A = analyzeBatter(S, small, th);
  assert.equal(A.note.kind, '注意');
  assert.match(A.note.text, /打席と少なく/);
  assert.match(A.type[0].text, /判定は行っていません/);
  assert.match(A.strengths[0].text, /判定は行っていません/);
  assert.match(A.weaknesses[0].text, /判定は行っていません/);
});

test('試合別データが無い場合、最近の状態は「判定していません」', async () => {
  const S = await demoModel();
  S.hasBatLogs = false;
  const p = [...S.players.values()].find((x) => !x.isPitcher && x.bat?.PA > 300);
  const A = analyzeBatter(S, p, loadConfig().thresholds);
  assert.match(A.recent[0].text, /判定していません/);
});

test('FIP: リーグ全体の FIP はリーグ防御率と一致する（定数の定義）', async () => {
  const S = await demoModel();
  const f = fip(S.league.pit, S.league.pit, S.league.pitRates.ERA.v);
  assert.ok(Math.abs(f - S.league.pitRates.ERA.v) < 1e-9);
});

test('球団分析: 6球団中の順位で強み・課題を判定', async () => {
  const S = await demoModel();
  for (const tid of S.teams.keys()) {
    const A = analyzeTeam(S, tid);
    assert.ok(A.strengths.length && A.weaknesses.length);
    assert.ok(A.table.every((m) => m.rank === null || (m.rank >= 1 && m.rank <= 6)));
  }
});
