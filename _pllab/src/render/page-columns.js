// コラム（運営者が書いた独自記事）: content/columns/*.md から一覧と記事ページを作る
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { esc, dateJa } from '../format.js';
import { markdownToHtml, parseFrontMatter } from '../markdown.js';
import { page, teamChip, playerLink } from './layout.js';
import { noteBlock } from './notes.js';

export async function loadColumns(dir) {
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const f of files) {
    const { meta, body } = parseFrontMatter(await readFile(join(dir, f), 'utf8'));
    if (!/^[a-z0-9-]+$/.test(meta.slug || '')) throw new Error(`コラム ${f}: slug は半角英小文字・数字・ハイフンで指定してください`);
    if (!meta.title || !/^\d{4}-\d{2}-\d{2}$/.test(meta.date || '')) throw new Error(`コラム ${f}: title と date（YYYY-MM-DD）は必須です`);
    if (meta.draft === 'true') continue;
    const text = body.replace(/^#\s+.*\n+/, ''); // 本文先頭の見出しはページの h1 と重複するため除く
    out.push({
      slug: meta.slug,
      title: meta.title,
      date: meta.date,
      description: meta.description || '',
      teams: (meta.teams || '').split('/').map((s) => s.trim()).filter(Boolean),
      players: (meta.players || '').split('/').map((s) => s.trim()).filter(Boolean),
      html: markdownToHtml(text),
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function columnCards(ctx, columns, root, { limit = null } = {}) {
  const list = limit ? columns.slice(0, limit) : columns;
  if (!list.length) return '<p class="empty">コラムはまだありません。</p>';
  return `<ul class="note-list">${list
    .map(
      (c) => `<li><a class="column-link" href="${root}columns/${esc(c.slug)}.html"><span class="small muted">${esc(dateJa(c.date))}</span><b>${esc(c.title)}</b>${c.description ? `<span class="small muted">${esc(c.description)}</span>` : ''}</a></li>`,
    )
    .join('')}</ul>`;
}

export function columnsFor(ctx, { playerId = null, teamId = null }) {
  return (ctx.columns || []).filter((c) => (playerId && c.players.includes(playerId)) || (teamId && c.teams.includes(teamId)));
}

export function renderColumnIndex(ctx) {
  const root = '../';
  ctx.root = root;
  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › コラム</p>
<h1>コラム</h1>
<p class="lead">成績の数字を元に、運営者が選手やチームの変化を読み解く記事です。数字の出典と比較の条件を、それぞれの記事に明記しています。</p>
${columnCards(ctx, ctx.columns || [], root)}
${noteBlock(ctx, { pageType: 'column-index', heading: 'note で読む解説記事' })}
`;
  return page({ title: 'コラム', root, current: 'columns', body, ctx, realPage: true, pageMeta: { pageType: 'column-index' }, description: 'パ・リーグの選手・チームを数字で読み解くコラム（非公式）' });
}

export function renderColumn(ctx, c) {
  const root = '../';
  ctx.root = root;
  const S = ctx.S;
  const teams = c.teams.map((t) => S.teams.get(t)).filter(Boolean);
  const players = c.players.map((id) => S.players.get(id)).filter(Boolean);
  const related = (ctx.columns || []).filter((x) => x.slug !== c.slug).slice(0, 3);
  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › <a href="${root}columns/index.html">コラム</a> › 記事</p>
<article class="column">
<h1>${esc(c.title)}</h1>
<p class="muted small">${esc(dateJa(c.date))}　パ・リーグ成績ラボ${teams.length ? `　${teams.map((t) => teamChip(t, root)).join(' ')}` : ''}</p>
${c.html}
</article>
${players.length ? `<h2>この記事の選手</h2><p>${players.map((p) => playerLink(p, root)).join('、')}</p>` : ''}
${noteBlock(ctx, { pageType: 'column', playerId: c.players[0] || null, teamId: c.teams[0] || null, heading: 'さらに詳しい解説（note）' })}
${related.length ? `<h2>ほかのコラム</h2>${columnCards(ctx, related, root)}` : ''}
`;
  return page({ title: c.title, root, current: 'columns', body, ctx, realPage: true, pageMeta: { pageType: 'column' }, description: c.description });
}
