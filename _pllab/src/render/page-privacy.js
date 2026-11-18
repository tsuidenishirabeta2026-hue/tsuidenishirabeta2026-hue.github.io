import { esc } from '../format.js';
import { page } from './layout.js';

export function renderPrivacy(ctx) {
  const root = './';
  ctx.root = root;
  const a = ctx.analytics || {};
  const enabled = (a.provider === 'ga4' && a.id) || (a.provider === 'umami' && a.id);
  const ga = a.provider === 'ga4';
  const body = `
<h1>プライバシーポリシー</h1>
<p class="muted small">対象: パ・リーグ成績ラボ（/pl-lab/ 以下のページ）</p>
<h2>アクセス解析</h2>
${
  enabled
    ? `<p>サイトの改善と、記事への導線の効果を確認するため、${ga ? 'Google LLC の「Google アナリティクス」' : '「Umami」'}を利用しています。ページを開いたときや note へのリンクをクリックしたときに、閲覧したページのURL、参照元、ブラウザ・端末の種類、おおまかな地域、クリックしたリンクの種類などが${ga ? 'Google' : 'Umami'}に送信されます。氏名やメールアドレスなど個人を直接特定する情報は送信しません。</p>
${ga ? '<p>Google アナリティクスは Cookie を使用します。データの取り扱いは <a href="https://policies.google.com/technologies/partner-sites?hl=ja" rel="noopener">Google のサービスを使用するサイトやアプリから収集した情報の Google による使用</a> をご覧ください。ブラウザの設定で Cookie を無効にするか、<a href="https://tools.google.com/dlpage/gaoptout?hl=ja" rel="noopener">Google アナリティクス オプトアウト アドオン</a>を使うと送信を止められます。</p>' : '<p>Umami は Cookie を使用しない方式で集計します。</p>'}`
    : '<p>現在、アクセス解析は使用していません。使用を開始する場合は、このページで送信先と内容をお知らせします。</p>'
}
<h2>外部サイトへのリンク</h2>
<p>note・Wikipedia・報道機関などの外部サイトへのリンクがあります。note へのリンクには、このサイトからの訪問であることが分かるパラメータ（utm_source=pl-lab など）を付けています。リンク先での情報の取り扱いは各サイトのポリシーに従います。</p>
<h2>広告</h2>
${
  ctx.siteUrl && /^ca-pub-\d{16}$/.test(ctx.adsense?.client || '')
    ? `<p>このサイトは、第三者配信の広告サービス「Google AdSense」を利用しています。Google などの第三者配信事業者は Cookie を使用して、利用者がこのサイトや他のサイトに過去にアクセスした際の情報に基づいて広告を配信します。</p>
<p>Google が広告 Cookie を使用することにより、Google やそのパートナーは、このサイトや他のサイトへのアクセス情報に基づいて適切な広告を表示できます。パーソナライズ広告は <a href="https://adssettings.google.com/" rel="noopener">広告設定</a> で無効にできます。詳しくは <a href="https://policies.google.com/technologies/ads?hl=ja" rel="noopener">Google の広告に関するポリシー</a> をご覧ください。</p>
<p>広告の表示により送信される主な情報: 閲覧したページのURL、ブラウザ・端末の種類、IPアドレス、Cookie の識別子。送信先: Google LLC。</p>`
    : '<p>現在、広告は掲載していません。掲載する場合は、配信事業者と送信される情報をこのページでお知らせします。</p>'
}
<h2>お問い合わせ</h2>
<p>このサイトは個人が運営する非公式のファンサイトです。お問い合わせは<a href="https://github.com/${esc(ctx.repoSlug || '')}" rel="noopener">GitHub リポジトリ</a>からお願いします。</p>
`;
  return page({ title: 'プライバシーポリシー', root, current: '', body, ctx, realPage: true, pageMeta: { pageType: 'privacy' } });
}
