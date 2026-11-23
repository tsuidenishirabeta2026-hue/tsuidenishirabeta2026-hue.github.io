// note 記事の一覧（data/input/notes.csv）を読み、ページごとの関連記事を選ぶ
//
// 列: note_id,status,type,price,title,url,published_at,teams,players,summary
//   status: published（表示）/ draft（表示しない）
//   type:   free / paid
//   teams:  球団ID（パ: F/E/L/M/B/H、セ: G/T/DB/C/S/D）を / 区切り（空欄=全体向け）
//   players: 選手ID を / 区切り
import { readFile } from 'node:fs/promises';
import { parseCsv } from './csv.js';
import { LEAGUE_TEAMS } from './schema.js';
import { LEAGUE } from './league.js';

export async function loadNotes(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { notes: [], errors: [] };
    throw e;
  }
  const { records } = parseCsv(text);
  const notes = [];
  const errors = [];
  for (const r of records) {
    const w = `notes.csv ${r.__line}行目`;
    if (r.status !== 'published') continue;
    const teams = (r.teams || '').split('/').map((s) => s.trim()).filter(Boolean);
    const players = (r.players || '').split('/').map((s) => s.trim()).filter(Boolean);
    const errs = [];
    if (!/^[A-Za-z0-9_-]+$/.test(r.note_id || '')) errs.push('note_id は半角英数字');
    if (!/^https:\/\/note\.com\//.test(r.url || '')) errs.push('url は https://note.com/ で始まる記事URL');
    if (!['free', 'paid'].includes(r.type)) errs.push('type は free か paid');
    if (r.type === 'paid' && !/^\d+$/.test(r.price || '')) errs.push('有料記事の price は整数（円）');
    if (!r.title) errs.push('title は必須');
    if (teams.some((t) => !LEAGUE_TEAMS.includes(t))) errs.push(`teams は ${LEAGUE.teamIdsText}`);
    if (errs.length) {
      errors.push(`${w}: ${errs.join('、')}（この行は表示しません）`);
      continue;
    }
    notes.push({ id: r.note_id, type: r.type, price: r.type === 'paid' ? Number(r.price) : 0, title: r.title, url: r.url, published_at: r.published_at || '', teams, players, summary: r.summary || '' });
  }
  notes.sort((a, b) => b.published_at.localeCompare(a.published_at));
  return { notes, errors };
}

/** 選手 → 球団 → 全体 の順に関連の強い記事を選ぶ */
export function relatedNotes(notes, { playerId = null, teamId = null, limit = 3 } = {}) {
  const score = (n) => (playerId && n.players.includes(playerId) ? 3 : teamId && n.teams.includes(teamId) ? 2 : n.teams.length === 0 && n.players.length === 0 ? 1 : 0);
  return notes
    .map((n) => ({ n, s: score(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n.published_at.localeCompare(a.n.published_at))
    .slice(0, limit)
    .map((x) => x.n);
}

/** note への導線 URL（流入元が分かるよう utm パラメータを付ける） */
export function trackedUrl(url, { pageType, playerId, teamId }) {
  const u = new URL(url);
  u.searchParams.set('utm_source', LEAGUE.utmSource);
  u.searchParams.set('utm_medium', 'referral');
  u.searchParams.set('utm_campaign', pageType);
  if (playerId || teamId) u.searchParams.set('utm_content', playerId || teamId);
  return u.toString();
}
