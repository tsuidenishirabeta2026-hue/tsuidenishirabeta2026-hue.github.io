import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../src/metrics.js';
import { rate3, fixed, ip, int, plain } from '../src/format.js';
import { computeStandings } from '../src/model.js';

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('投球回: .1 は 1アウト、.2 は 2アウト（小数ではない）', () => {
  assert.equal(M.ipToOuts('0.1'), 1);
  assert.equal(M.ipToOuts('0.2'), 2);
  assert.equal(M.ipToOuts('45.2'), 137);
  assert.equal(M.ipToOuts('123'), 369);
  assert.equal(M.ipToOuts('123.0'), 369);
  assert.equal(M.ipToOuts(''), null);
  assert.throws(() => M.ipToOuts('10.3'), /\.0\/\.1\/\.2/);
  assert.throws(() => M.ipToOuts('10.33'));
  assert.throws(() => M.ipToOuts('abc'));
  assert.equal(M.outsToIp(137), '45.2');
  assert.equal(M.outsToIpJa(137), '45 2/3');
  // 0.1 + 0.2 回 = 1回（3アウト）。小数で足すと 0.3 になってしまう
  assert.equal(M.outsToIp(M.ipToOuts('0.1') + M.ipToOuts('0.2')), '1.0');
});

test('防御率・WHIP などはアウト数で計算する', () => {
  // 6回1/3 = 19アウト、自責点2 → 2 × 27 / 19
  const p = { ER: 2, outs: 19, BB: 1, H: 5, SO: 7, HR: 1 };
  close(M.era(p).v, 54 / 19);
  close(M.whip(p).v, 18 / 19);
  close(M.k9(p).v, (7 * 27) / 19);
  close(M.bb9(p).v, 27 / 19);
  close(M.kbb(p).v, 7);
  // 誤った計算（6.1 を小数とみなす）とは異なることを確認
  assert.notEqual(M.era(p).v.toFixed(4), ((2 * 9) / 6.1).toFixed(4));
});

test('出塁率は犠飛を分母に含め、犠打は含めない', () => {
  const b = { H: 30, BB: 10, HBP: 2, AB: 100, SF: 3, SH: 5, D: 6, T: 1, HR: 4 };
  close(M.obp(b).v, 42 / 115);
  // 塁打 = 単打19 + 2×6 + 3×1 + 4×4 = 50
  assert.equal(M.totalBases(b), 50);
  close(M.slg(b).v, 0.5);
  close(M.ops(b).v, 42 / 115 + 0.5); // 丸める前の値を合計
  close(M.avg(b).v, 0.3);
});

test('犠飛が取得できない場合、出塁率・OPS は「データなし」', () => {
  const b = { H: 30, BB: 10, HBP: 2, AB: 100, SF: null, D: 6, T: 1, HR: 4 };
  assert.deepEqual(M.obp(b), { v: null, why: M.NODATA });
  assert.equal(M.ops(b).why, M.NODATA);
  assert.equal(plain(rate3, M.ops(b)), 'データなし');
});

test('分母0は「算出不可」', () => {
  assert.deepEqual(M.avg({ H: 0, AB: 0 }), { v: null, why: M.ZERO });
  assert.equal(plain(rate3, M.avg({ H: 0, AB: 0 })), '算出不可');
  assert.equal(M.era({ ER: 3, outs: 0 }).why, M.ZERO);
  assert.equal(plain(fixed, M.era({ ER: 3, outs: 0 })), '算出不可');
  assert.equal(M.kbb({ SO: 5, BB: 0 }).why, M.ZERO);
  assert.equal(M.obp({ H: 0, BB: 0, HBP: 0, AB: 0, SF: 0 }).why, M.ZERO);
  assert.equal(M.winPct({ W: 0, L: 0 }).why, M.ZERO);
});

test('合計: 欠損が1行でもあれば合計も「データなし」（0で埋めない）', () => {
  const s = M.sumRows([{ H: 3, CS: 1 }, { H: 2, CS: null }], ['H', 'CS']);
  assert.equal(s.H, 5);
  assert.equal(s.CS, null);
  assert.equal(plain(int, s.CS), 'データなし');
});

test('リーグ平均は合計値から計算する（率の単純平均ではない）', () => {
  const rows = [
    { H: 1, AB: 2 }, // .500
    { H: 30, AB: 100 }, // .300
  ];
  const t = M.sumRows(rows, ['H', 'AB']);
  close(M.avg(t).v, 31 / 102);
  assert.notEqual(M.avg(t).v, (0.5 + 0.3) / 2);
});

test('規定打席・規定投球回', () => {
  assert.equal(M.qualifyingPA(143), 443); // 443.3
  assert.equal(M.qualifyingPA(125), 388); // 387.5 → 四捨五入
  assert.equal(M.qualifyingPA(5), 16); // 15.5 → 16
  assert.equal(M.qualifyingOuts(143), 429);
});

test('表示時の丸め', () => {
  assert.equal(rate3({ v: 0.28449 }), '.284');
  assert.equal(rate3({ v: 1.0126 }), '1.013');
  assert.equal(fixed({ v: 2.3449 }, 2), '2.34');
  assert.equal(fixed({ v: 0 }, 2), '0.00');
  assert.equal(plain(ip, 370), '123.1');
  assert.equal(plain(ip, null), 'データなし');
});

test('順位: 勝率順・ゲーム差・同率の扱い', () => {
  const rows = [
    { team_id: 'F', G: 10, W: 6, L: 4, T: 0, RS: 40, RA: 30 },
    { team_id: 'E', G: 10, W: 3, L: 2, T: 5, RS: 30, RA: 30 }, // 勝率 .600（Fと同率）
    { team_id: 'L', G: 10, W: 5, L: 5, T: 0, RS: 30, RA: 30 },
    { team_id: 'M', G: 10, W: 4, L: 5, T: 1, RS: 30, RA: 30 },
    { team_id: 'B', G: 10, W: 7, L: 2, T: 1, RS: 30, RA: 30 },
    { team_id: 'H', G: 10, W: 0, L: 9, T: 1, RS: 30, RA: 30 },
  ];
  const s = computeStandings(rows);
  assert.deepEqual(s.rows.map((r) => r.team_id), ['B', 'E', 'F', 'L', 'M', 'H']);
  const E = s.rows.find((r) => r.team_id === 'E');
  const F = s.rows.find((r) => r.team_id === 'F');
  assert.equal(E.rank, 2);
  assert.equal(F.rank, 2);
  assert.ok(E.tied && F.tied);
  assert.equal(s.rows[0].GB, 0);
  // B(7-2) と L(5-5): ((7-5)+(5-2))/2 = 2.5
  assert.equal(s.rows.find((r) => r.team_id === 'L').GB, 2.5);
  assert.equal(s.rows.find((r) => r.team_id === 'L').RD, 0);
  // 公式順位が入力されていれば優先
  const o = computeStandings(rows.map((r, i) => ({ ...r, official_rank: i + 1 })));
  assert.deepEqual(o.rows.map((r) => r.team_id), ['F', 'E', 'L', 'M', 'B', 'H']);
  assert.ok(o.rows.every((r) => !r.tied));
});
