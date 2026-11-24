import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalary, yenOf, yenShort } from '../src/sources/salary.js';

test('年俸: 出典・補足つき', () => {
  const s = parseSalary('| 年俸 = 3億7000万円＋出来高（2026年）<ref>{{Cite web ja |url=https://x |title=t}}</ref><br />※2020年から7年契約（変動制）\n| 守備位置 = 外野手');
  assert.deepEqual(s, { text: '3億7000万円＋出来高', yen: 370000000, year: 2026, note: '※2020年から7年契約（変動制）' });
});

test('年俸: 万円だけ', () => {
  assert.deepEqual(parseSalary('| 年俸 = 6200万円（2026年）<ref name="a" />'), { text: '6200万円', yen: 62000000, year: 2026, note: '' });
});

test('年俸: 外国人選手のドル表記は金額を円にしない', () => {
  const s = parseSalary('| 年俸 = 150万ドル（2026年）');
  assert.equal(s.yen, null);
  assert.equal(s.text, '150万ドル');
  assert.equal(s.year, 2026);
});

test('年俸: 欄が無い・空', () => {
  assert.equal(parseSalary('| 背番号 = 9'), null);
  assert.equal(parseSalary('| 年俸 = \n'), null);
});

test('金額の変換と短い表示', () => {
  assert.equal(yenOf('４億８０００万円'), 480000000);
  assert.equal(yenOf('1億円'), 100000000);
  assert.equal(yenShort(480000000), '4.8億円');
  assert.equal(yenShort(62000000), '6,200万円');
});

test('年俸: 出典テンプレート {{R|…}} の名前を残さない', () => {
  assert.deepEqual(parseSalary('| 年俸 = 5億円{{R|sponichi20260114}}（2026年）<br />※2026年から4年契約{{R|hochi20231111|nikkan}}'), { text: '5億円', yen: 500000000, year: 2026, note: '※2026年から4年契約' });
  assert.equal(parseSalary('| 年俸 = {{Nowrap|1億5000万円}}（2026年）').text, '1億5000万円');
});
