import { esc, dateJa, dateShort, dateTimeJst } from '../format.js';
import { page, teamChip } from './layout.js';
import { CATEGORIES } from '../moves/wikipedia.js';

export const CAT_ORDER = [...CATEGORIES.map(([c]) => c), 'その他'];
// 既定で表示する分類（その他・背番号のみの出来事は既定では隠す）
const HIDDEN_BY_DEFAULT = new Set(['その他']);

export function isTransaction(e) {
  return e.categories.some((c) => !HIDDEN_BY_DEFAULT.has(c));
}

function eventItem(e, S, root) {
  const teams = e.teams.map((t) => teamChip(S.teams.get(t), root)).join(' ');
  const cats = e.categories.map((c) => `<span class="tag">${esc(c)}</span>`).join('');
  const src = e.sources.length ? `<span class="basis">出典: ${e.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener nofollow" target="_blank">${esc(s.site)}</a>`).join('、')}</span>` : '';
  const det = e.details.length ? `<details class="more small"><summary>詳細（${e.details.length}行）</summary><ul>${e.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : '';
  const origin = e.origin === 'manual' ? '<span class="tag">手動入力</span>' : '';
  return `<li class="move" data-teams="${esc(e.teams.join(' '))}" data-cats="${esc(e.categories.join('|'))}">
  <div class="move-head"><time datetime="${esc(e.date)}">${esc(dateShort(e.date))}</time> ${teams} ${cats}${origin}</div>
  <p>${esc(e.text)}</p>${det}${src}
</li>`;
}

export function movesList(events, S, root, { limit = null } = {}) {
  const list = limit ? events.slice(0, limit) : events;
  if (!list.length) return '<p class="empty">該当する出来事はありません。</p>';
  return `<ul class="moves">${list.map((e) => eventItem(e, S, root)).join('')}</ul>`;
}

export function licenseNote(moves, root) {
  const arts = moves.articles.map((a) => `<a href="${esc(a.url)}" rel="noopener">Wikipedia「${esc(a.title)}」（版 ${esc(a.revid)}）</a>`).join('、');
  return `<p class="muted small">出来事の文章は ${arts} の「できごと」節から、パ・リーグ球団に関係する項目を抽出し、記法・脚注を除去するなどの改変を加えたものです。ライセンス: <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" rel="noopener license">CC BY-SA 4.0</a>（この部分の文章も同ライセンスで提供します）。執筆者は記事の履歴をご覧ください。分類（トレード・FA など）は文中の語句から機械的に付けたもので、誤る場合があります。</p>`;
}

export function renderMoves(ctx, moves, movesStatus) {
  const root = './';
  ctx.root = root;
  const { S } = ctx;
  const events = moves.events;
  const catCounts = Object.fromEntries(CAT_ORDER.map((c) => [c, events.filter((e) => e.categories.includes(c)).length]));
  const months = [];
  for (const e of events) {
    const m = e.date.slice(0, 7);
    if (!months.includes(m)) months.push(m);
  }
  const groups = months
    .map((m) => {
      const es = events.filter((e) => e.date.startsWith(m));
      const [y, mo] = m.split('-').map(Number);
      return `<section class="move-month" data-month="${m}"><h2>${y}年${mo}月</h2>${movesList(es, S, root)}</section>`;
    })
    .join('');
  const failed = movesStatus?.last_result === 'failed';
  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › 移籍・契約</p>
<h1>移籍・契約・去就</h1>
<p class="lead">パ・リーグ6球団に関係する、トレード・FA・戦力外・引退・入団・契約・首脳陣人事などの動きを新しい順にまとめています。</p>
${failed ? `<div class="notice stale" role="alert"><strong>最新情報の取得に失敗しました（${esc(dateTimeJst(movesStatus.last_attempt_at))}）</strong>前回取得に成功した内容（${esc(dateTimeJst(movesStatus.last_success_at))}）を表示しています。</div>` : ''}
<div class="card">
<dl class="meta-list">
  <dt>出典</dt><dd>Wikipedia 日本語版（有志による百科事典）${events.some((e) => e.origin === 'manual') ? '／運営者による手動入力' : ''}</dd>
  <dt>最終取得成功</dt><dd>${esc(dateTimeJst(movesStatus?.last_success_at))}</dd>
  <dt>件数</dt><dd>${events.length}件（新しい順）</dd>
</dl>
<p class="muted small" style="margin:8px 0 0">Wikipedia は誰でも編集できるため、反映の遅れ・誤り・記載漏れがありえます。正式な情報は各球団・NPBの発表（各項目の出典リンク）でご確認ください。推定年俸などの金額は掲載していません。</p>
</div>

<div class="filters" id="move-filters">
  <label>球団<select id="mv-team"><option value="">パ・リーグ全球団</option>${[...S.teams.values()].map((t) => `<option value="${esc(t.team_id)}">${esc(t.short_name)}</option>`).join('')}</select></label>
  <label>分類<select id="mv-cat"><option value="">すべての分類</option>${CAT_ORDER.filter((c) => catCounts[c]).map((c) => `<option value="${esc(c)}">${esc(c)}（${catCounts[c]}）</option>`).join('')}</select></label>
  <label class="check full"><input id="mv-other" type="checkbox"><span>試合結果・記録などの「その他」も表示</span></label>
</div>
<p id="mv-count" class="result-count" aria-live="polite"></p>
${groups}
${licenseNote(moves, root)}
<script src="${root}assets/moves.js" defer></script>
`;
  return page({ title: '移籍・契約・去就', root, current: 'moves', body, ctx, pageMeta: { pageType: 'moves' }, realPage: true, description: 'パ・リーグ6球団のトレード・FA・戦力外・引退・入団などの動き（非公式）' });
}
