import { esc } from '../format.js';
import { relatedNotes, trackedUrl } from '../notes.js';

/**
 * 関連する note 記事への導線。記事が無ければプロフィールへの導線、それも無ければ何も出さない
 * （存在しない記事へのリンクや仮の URL は出さない）。
 * クリックは data-note-* 属性を元に app.js が計測イベントを送る。
 */
export function noteBlock(ctx, { pageType, playerId = null, teamId = null, heading = '関連する解説記事（note）' }) {
  const notes = relatedNotes(ctx.notes || [], { playerId, teamId });
  const attrs = (n) => `data-note-id="${esc(n.id)}" data-note-type="${esc(n.type)}" data-page-type="${esc(pageType)}"${playerId ? ` data-player-id="${esc(playerId)}"` : ''}${teamId ? ` data-team-id="${esc(teamId)}"` : ''}`;
  if (notes.length) {
    return `<section class="note-cta" aria-label="${esc(heading)}">
<h2>${esc(heading)}</h2>
<ul class="note-list">${notes
      .map(
        (n) => `<li><a class="note-link" href="${esc(trackedUrl(n.url, { pageType, playerId, teamId }))}" rel="noopener" target="_blank" ${attrs(n)}>
  <span class="note-badge ${n.type}">${n.type === 'paid' ? `有料 ${n.price.toLocaleString('ja-JP')}円` : '無料'}</span>
  <b>${esc(n.title)}</b>${n.summary ? `<span class="small muted">${esc(n.summary)}</span>` : ''}</a></li>`,
      )
      .join('')}</ul>
<p class="muted small">note（外部サイト）が開きます。有料記事は運営者による独自の解説で、このサイトの無料ページと同じデータを元にしています。</p>
</section>`;
  }
  const prof = ctx.noteProfileUrl;
  if (!prof) return '';
  return `<section class="note-cta"><p><a class="note-link" href="${esc(trackedUrl(prof, { pageType, playerId, teamId }))}" rel="noopener" target="_blank" data-note-id="profile" data-note-type="profile" data-page-type="${esc(pageType)}"${playerId ? ` data-player-id="${esc(playerId)}"` : ''}>noteで選手・球団の解説記事を読む</a></p></section>`;
}
