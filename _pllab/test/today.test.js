import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickToday, feedItems, todayJst } from '../src/today.js';

const player = { id: 'w1', name: '選手A', info: { team_id: 'B' } };
const ctx = { S: { players: new Map([['w1', player]]) }, history: null, columns: [{ date: '2026-11-20', title: '記事A', slug: 'a', players: ['w1'] }], notes: [{ id: 'n1', type: 'free', price: 0, title: '記事A', published_at: '2026-11-20', players: ['w1'] }, { id: 'n2', type: 'paid', price: 300, title: '記事B', published_at: '2026-11-19', players: [] }] };

test('今日の数字: 今日以前で最も新しい行を使う', () => {
  const picks = [{ date: '2026-11-21', player_id: 'w1', label: '本塁打', from: '9', to: '18本' }, { date: '2026-11-22', player_id: 'w1', label: '四球', from: '1', to: '2' }];
  assert.equal(pickToday(ctx, picks, '2026-11-21').label, '本塁打');
  assert.equal(pickToday(ctx, picks, '2026-11-23').label, '四球');
});

test('今日の数字: 3日以上前の行しかなく、履歴も無ければ出さない', () => {
  assert.equal(pickToday(ctx, [{ date: '2026-11-10', player_id: 'w1', label: 'x', from: '1', to: '2' }], '2026-11-21'), null);
});

test('新着の記事: 同じ題名の note はコラムに寄せ、日付の新しい順', () => {
  const f = feedItems(ctx);
  assert.deepEqual(f.map((x) => x.kind + ':' + x.title), ['column:記事A', 'note:記事B']);
});

test('日本時間の日付', () => {
  assert.equal(todayJst(Date.parse('2026-11-20T15:30:00Z')), '2026-11-21');
});
