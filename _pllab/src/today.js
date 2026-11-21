// トップページの「今日の数字」と「新着の記事」
//
// 今日の数字: data/input/today.csv（date,player_id,label,from,to,comment）の、今日（日本時間）以前で最も新しい行を使う。
//   3日以上前の行しかなければ、最新のコラム・note 記事の選手から、前年から最も伸びた指標を自動で選ぶ。
import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.js';
import { playerInsight } from './history.js';

export function todayJst(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function loadTodayPicks(file) {
  try {
    const { records } = parseCsv(await readFile(file, 'utf8'));
    return records.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.player_id && r.label && r.from && r.to);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** @returns {{ player, label, from, to, comment, auto } | null} */
export function pickToday(ctx, picks, today = todayJst()) {
  const { S, history } = ctx;
  const row = picks
    .filter((r) => r.date <= today && S.players.has(r.player_id))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (row && daysBetween(row.date, today) < 3) {
    return { player: S.players.get(row.player_id), label: row.label, from: row.from, to: row.to, comment: row.comment || '', auto: false };
  }
  if (!history) return null;
  // 最新の記事（コラム・note）で扱った選手から、前年から最も伸びた指標
  const recent = feedItems(ctx).flatMap((x) => x.players);
  for (const id of recent) {
    const p = S.players.get(id);
    if (!p) continue;
    const I = playerInsight(history, p);
    if (I.status !== 'ok' || !I.enough) continue;
    const best = I.yoy.filter((m) => m.improved).sort((a, b) => b.better / b.minDiff - a.better / a.minDiff)[0];
    if (best) return { player: p, label: `${best.label}（${I.latest - 1}→${I.latest}年）`, from: best.prev, to: best.cur, comment: '', auto: true };
  }
  return null;
}

/** コラムと公開済みの note 記事を、日付の新しい順に並べる */
export function feedItems(ctx) {
  const cols = (ctx.columns || []).map((c) => ({ kind: 'column', date: c.date, title: c.title, desc: c.description || '', slug: c.slug, players: c.players || [] }));
  const notes = (ctx.notes || []).map((n) => ({ kind: 'note', date: n.published_at || '', title: n.title, desc: n.summary || '', note: n, players: n.players || [] }));
  // 同じ題名のコラムと note は、サイト内のコラムだけ出す（コラムの最後に note への導線がある）
  const colTitles = new Set(cols.map((c) => c.title));
  return [...cols, ...notes.filter((n) => !colTitles.has(n.title))].sort((a, b) => b.date.localeCompare(a.date) || (a.kind === 'note' ? 1 : -1));
}
