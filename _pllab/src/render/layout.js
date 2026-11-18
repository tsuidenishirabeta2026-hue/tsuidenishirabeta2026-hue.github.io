import { esc, dateJa, dateTimeJst } from '../format.js';

export const PHASE_LABEL = { preseason: '開幕前', regular: 'レギュラーシーズン中', postseason: 'ポストシーズン', offseason: 'シーズン終了' };

export function term(label, key = label) {
  return `<button type="button" class="term" data-term="${esc(key)}" title="${esc(key)}の説明">${esc(label)}</button>`;
}

export function teamChip(t, root, { link = true, short = true } = {}) {
  if (!t) return '';
  const name = esc(short ? t.short_name : t.name);
  const inner = `<span class="team-chip" style="--tc:${esc(t.color || 'var(--accent)')}">${name}</span>`;
  return link ? `<a href="${root}teams/${esc(t.team_id)}.html">${inner}</a>` : inner;
}

export function playerLink(p, root) {
  return `<a href="${root}players/${esc(p.id)}.html">${esc(p.name)}</a>`;
}

/** 全ページ共通の注意表示（デモ・更新失敗・シーズン状態） */
export function notices(ctx, { realPage = false } = {}) {
  const { status, S, demo, site } = ctx;
  const out = [];
  if (demo && realPage) {
    out.push(`<div class="notice info" role="note"><strong>このページは実際の出来事です（出典: Wikipedia ほか）。</strong>なお、成績・順位・選手ページは現在デモデータ（架空）で表示しています。</div>`);
  } else if (demo) {
    out.push(`<div class="notice demo" role="note"><span class="demo-tag">デモ</span><strong style="display:inline">この画面はデモデータで表示しています。</strong>
      選手名・成績・試合結果はすべて乱数で作った架空のものです。実在の選手・試合とは関係ありません。球団名のみ実在のものを使用しています。</div>`);
  }
  if (status.last_result === 'failed') {
    out.push(`<div class="notice stale" role="alert"><strong>最新データの取得に失敗しました（${esc(dateTimeJst(status.last_attempt_at))}）</strong>
      前回取得に成功したデータ（基準日 ${esc(dateJa(S.meta.as_of_date))}、取得 ${esc(dateTimeJst(status.last_success_at))}）を表示しています。内容が古い可能性があります。</div>`);
  }
  out.push(`<div class="notice stale" id="stale-client" hidden><strong>データが古くなっている可能性があります</strong>最終取得成功日時から${site.staleHours}時間以上たっています。表示中の成績は ${esc(dateJa(S.meta.as_of_date))} 時点のものです。</div>`);
  return out.join('\n');
}

/** アクセス解析タグ（設定が無ければ何も出さない） */
export function analyticsTag(ctx, pageMeta = {}) {
  const a = ctx.analytics || {};
  if (a.provider === 'ga4' && /^G-[A-Z0-9]+$/.test(a.id || '')) {
    return `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(a.id)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(a.id)}',${JSON.stringify({ page_type: pageMeta.pageType || 'other', ...(pageMeta.playerId ? { player_id: pageMeta.playerId } : {}) }).replace(/</g, '\\u003c')});</script>`;
  }
  if (a.provider === 'umami' && /^[0-9a-f-]{36}$/i.test(a.id || '')) {
    return `<script defer src="${esc(a.umamiScript)}" data-website-id="${esc(a.id)}"></script>`;
  }
  return '';
}

/** 独自ドメインへの移転後: 正規URL（ビルド時に置換）と、旧URL（github.io）からの転送 */
export function siteTags(ctx) {
  const url = ctx.siteUrl;
  if (!url) return '';
  return `<!--PL_CANONICAL-->
<script>(function(){if(/(github\\.io|pages\\.dev)$/.test(location.hostname)){location.replace(${JSON.stringify(url)}+location.pathname.replace(/^\\/pl-lab/,'')+location.search+location.hash);}})();</script>`;
}

/** Google AdSense（自動広告）。独自ドメインと運営者IDがそろい、デモ表示でないときだけ出す */
export function adsTag(ctx) {
  const c = ctx.adsense?.client || '';
  if (!ctx.siteUrl || ctx.demo || !/^ca-pub-\d{16}$/.test(c)) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${c}" crossorigin="anonymous"></script>`;
}

export function page({ title, root, current, body, ctx, teamColor, description, realPage = false, pageMeta = {} }) {
  const { site, status, S } = ctx;
  const nav = [
    ['index', 'トップ', 'index.html'],
    ['standings', '順位表', 'index.html#standings'],
    ['teams', '球団', 'index.html#teams'],
    ['players', '選手一覧', 'players/index.html'],
    ['moves', '移籍・契約', 'moves.html'],
    ['about', 'データと分析の方法', 'about.html'],
  ];
  const fullTitle = title ? `${title}｜${site.name}` : `${site.name}（非公式）`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || 'パ・リーグ6球団のチーム成績と選手成績・分析をスマートフォンで確認できる非公式サイト。')}">
${ctx.demo && !realPage ? '<meta name="robots" content="noindex">' : ''}
<link rel="stylesheet" href="${root}assets/style.css">
${siteTags(ctx)}
${analyticsTag(ctx, pageMeta)}
${adsTag(ctx)}
${teamColor ? `<style>:root{--team:${esc(teamColor)}}</style>` : ''}
</head>
<body data-page-type="${esc(pageMeta.pageType || 'other')}"${pageMeta.playerId ? ` data-player-id="${esc(pageMeta.playerId)}" data-player-name="${esc(pageMeta.playerName || '')}"` : ''}>
<a class="sr-only" href="#main">本文へ移動</a>
<header class="site-header"><div class="wrap">
  <a class="brand" href="${root}index.html">${esc(site.name)}</a><span class="badge-unofficial">非公式</span>${ctx.demo && !realPage ? '<span class="badge-unofficial" style="border-color:var(--demo-line);color:var(--demo-line);font-weight:800">デモ</span>' : ''}
  <nav class="nav" aria-label="サイト内">${nav.map(([k, l, h]) => `<a href="${root}${h}"${current === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
</div></header>
<div class="wrap" data-last-success="${esc(status.last_success_at || '')}" data-stale-hours="${site.staleHours}" data-phase="${esc(S.meta.phase)}">
${notices(ctx, { realPage })}
</div>
<main id="main" class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">
  <p><strong>${esc(site.name)}</strong> は個人が運営する<strong>非公式</strong>のファンサイトです。日本野球機構（NPB）、パシフィックリーグマーケティング株式会社、各球団とは関係ありません。球団名・選手名等の権利は各権利者に帰属します。球団ロゴ・選手写真は使用していません。</p>
  <p>${realPage && ctx.demo ? '成績データ' : 'データ'}の出典: ${esc(S.meta.source_name)}${/CC BY-SA/.test(S.meta.source_name) ? '（<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.ja" rel="license noopener">ライセンス</a>。Wikipedia 由来の文章・表は同ライセンスで提供します）' : ''}${S.meta.source_url ? `（<a href="${esc(S.meta.source_url)}" rel="noopener">出典</a>）` : ''}。対象シーズン ${S.meta.season}年／基準日 ${esc(dateJa(S.meta.as_of_date))}／最終取得成功 ${esc(dateTimeJst(status.last_success_at))}</p>
  <p>掲載内容の正確性には注意していますが、公式記録は各公式発表をご確認ください。分析文は成績データから機械的に作成したもので、将来の成績を保証するものではありません。 <a href="${root}about.html">データと分析の方法</a>／<a href="${root}privacy.html">プライバシーポリシー</a>${adsTag(ctx) ? '（このサイトは Google AdSense による広告を掲載しています）' : ''}</p>
</div></footer>
<script src="${root}assets/glossary.js"></script>
<script src="${root}assets/app.js"></script>
</body>
</html>
`;
}
