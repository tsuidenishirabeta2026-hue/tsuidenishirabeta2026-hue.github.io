import { esc, dateJa, dateTimeJst } from '../format.js';
import { RULES } from '../analysis.js';
import { GLOSSARY } from './glossary.js';
import { page } from './layout.js';

const RESULT_LABEL = { updated: '更新あり', unchanged: '変更なし', failed: '失敗（前回データを維持）', skipped: 'スキップ（重複起動）' };

export function renderAbout(ctx, logTail) {
  const root = './';
  ctx.root = root;
  const { S, status, th, demo, sourceLabel } = ctx;
  const r = RULES;
  const fmtRule = (k, x) => {
    const pctKeys = ['BBPCT', 'KPCT'];
    const f = (v) => (pctKeys.includes(k) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}ポイント` : `${v > 0 ? '+' : ''}${v}`);
    return `<tr><td class="l">${esc(x.label)}</td><td>${f(x.good)}</td><td>${f(x.bad)}</td><td class="l">${x.higher ? '高いほど良い' : '低いほど良い'}</td></tr>`;
  };
  const logs = logTail
    .slice()
    .reverse()
    .map((l) => `<tr><td class="l">${esc(dateTimeJst(l.at))}</td><td class="l">${esc(RESULT_LABEL[l.result] || l.result)}</td><td class="l">${esc(l.as_of ? `基準日 ${l.as_of}` : '')}${l.error ? esc(l.error) : ''}${l.warnings ? `（警告${l.warnings}件）` : ''}</td></tr>`)
    .join('');

  const body = `
<h1>データと分析の方法</h1>

<h2 id="site">このサイトについて</h2>
<p>「パ・リーグ成績ラボ」は、パ・リーグ6球団のチーム成績と選手成績を、スマートフォンで読みやすく整理し、数字から読み取れる特徴を説明する<strong>非公式</strong>のファンサイトです。NPB・パシフィックリーグマーケティング・各球団とは関係ありません。球団ロゴ・選手写真は、使用許諾を確認できていないため使用していません。</p>

<h2 id="source">データの出典と利用条件</h2>
<div class="card">
<dl class="meta-list">
  <dt>現在の取得元</dt><dd>${esc(sourceLabel)}${demo ? '（デモ）' : ''}</dd>
  <dt>出典表示</dt><dd>${esc(S.meta.source_name)}</dd>
  <dt>対象シーズン</dt><dd>${S.meta.season}年</dd>
  <dt>データの基準日</dt><dd>${esc(dateJa(S.meta.as_of_date))}</dd>
</dl>
</div>
<p>このサイトは、データを「取得 → 検証 → 保存 → 画面生成」の順に処理します。取得元は差し替え可能で、現在は<strong>CSV取り込み</strong>（リポジトリ内のCSV、または利用権限のあるURLのCSV）に対応しています。</p>
<p>公式サイト（NPB公式サイト、パ・リーグ.com）の成績ページは誰でも閲覧できますが、それぞれのサイトポリシー・利用規約で、掲載情報の二次利用・無断転載・複製・配信が禁止されています。閲覧できることと、自動取得して再配布できることは別のため、このサイトは公式サイトからの自動取得（スクレイピング）を行いません。実際の成績を掲載する場合は、運営者が利用許諾を得たデータ、または自ら作成・入力したデータをCSVで取り込みます。</p>
${demo ? '<p class="notice demo"><span class="demo-tag">デモ</span>現在表示しているデータは、動作確認用に乱数の試合シミュレーションで作った架空のデータです。球団名のみ実在のものを使用しています。</p>' : ''}

<h2 id="moves">移籍・契約ページのデータ</h2>
<ul>
  <li>Wikipedia 日本語版の「<年>年の日本プロ野球」の「できごと」節から、パ・リーグ6球団の名前を含む出来事を毎日1回、API で取得しています（1〜6月は前年の記事も対象）。</li>
  <li>Wikipedia の文章は CC BY-SA 4.0 で再利用が許可されています。記事へのリンク・ライセンス表示・改変の明示を行い、このページの該当部分も同ライセンスで提供します。</li>
  <li>分類（トレード・FA・戦力外など）は文中の語句から機械的に付けています。Wikipedia は誰でも編集できるため、誤り・遅れがありえます。正式な情報は各項目の出典（球団発表・報道）をご確認ください。</li>
  <li>記事の書式が読めない・件数が急減したなどの場合は保存せず、前回の内容を表示し続けます。</li>
  <li>契約更改など Wikipedia に載らない情報は、運営者が出典つきで手動入力（CSV）した場合に限り掲載します。推定年俸などの金額は掲載していません。</li>
</ul>

<h2 id="update">更新の仕組みと状況</h2>
<div class="card">
<dl class="meta-list">
  <dt>最終取得成功</dt><dd>${esc(dateTimeJst(status.last_success_at))}</dd>
  <dt>最終取得試行</dt><dd>${esc(dateTimeJst(status.last_attempt_at))}（${esc(RESULT_LABEL[status.last_result] || status.last_result || '記録なし')}）</dd>
  ${status.last_error ? `<dt>エラー</dt><dd>${esc(status.last_error)}</dd>` : ''}
  ${status.warnings?.length ? `<dt>警告</dt><dd>${status.warnings.map(esc).join('<br>')}</dd>` : ''}
</dl>
</div>
<ul>
  <li>毎日 日本時間 午前7時ごろに更新処理を実行する設定です（GitHub Actions。混雑時は開始が遅れることがあります）。</li>
  <li>取得したデータは保存前に検証します（必須項目、整数・日付・投球回の形式、打数≦打席・安打≦打数などの整合性、6球団がそろっているか、件数の急減や基準日の逆戻りがないか）。</li>
  <li>検証に1件でも失敗した場合は保存せず、<strong>前回の正常なデータを表示し続け</strong>、画面上部に「取得に失敗した」旨を表示します。</li>
  <li>試合のない日は「変更なし」として正常終了します。訂正データは次回の取得時にそのまま反映され、同じ基準日の記録は上書き保存されるため二重登録になりません。</li>
</ul>
${logs ? `<h3>最近の更新ログ</h3><div class="table-scroll"><table><thead><tr><th class="l">日時</th><th class="l">結果</th><th class="l">内容</th></tr></thead><tbody>${logs}</tbody></table></div>` : ''}

<h2 id="rules">順位・規定の扱い</h2>
<ul>
  <li>順位は勝率（勝利 ÷ (勝利＋敗戦)。引き分けは除く）の高い順です。</li>
  <li>勝率が並んだ場合は「同率」と表示し、同じ順位にしています。公式の順位決定方法による順位は、公式発表をCSVの <code>official_rank</code> 列に入力すると反映されます（このサイトでは推測しません）。</li>
  <li>リーグ優勝は、公式に決定した場合に限り表示します（CSVの <code>champion_team_id</code>）。マジックナンバーの計算は行っていません。</li>
  <li>規定打席 = 所属球団の試合数 × 3.1（端数は四捨五入）、規定投球回 = 所属球団の試合数 × 1.0（公認野球規則 9.22。NPBでは「行なった試合数」で適用）。シーズン途中に移籍した選手は、現在の所属球団の試合数で判定しています。</li>
</ul>

<h2 id="metrics">指標の定義と計算方法</h2>
<ul>
  <li>リーグ平均・チーム成績は、各選手の<strong>元の記録（安打数・打数など）を合計してから</strong>率を計算します。各選手の率の単純平均ではありません。</li>
  <li>投球回の「.1」「.2」は、それぞれ1/3回・2/3回（1アウト・2アウト）です。計算はすべてアウト数に換算して行います（例: 45.2回 = 137アウト）。</li>
  <li>分母が0になる場合（打数0の打率など）は「算出不可」、取得元に項目がない場合は「データなし」と表示し、0では埋めません。合計の対象に1行でも欠損があれば、その合計も「データなし」とします。</li>
  <li>丸めは表示の直前に行います（OPSは丸める前の出塁率と長打率を足しています）。</li>
  <li>WAR・UZRなど、独自のデータや算出方法が必要な指標は掲載していません。</li>
</ul>
<dl class="glossary">${Object.entries(GLOSSARY)
    .map(([k, g]) => `<dt id="g-${esc(k)}">${esc(k)}</dt><dd>${esc(g.d)}${g.f ? `<span class="f">計算式: ${esc(g.f)}</span>` : ''}</dd>`)
    .join('')}</dl>

<h2 id="analysis">分析の方法</h2>
<p>選手ページの分析文は、外部AIを使わず、以下の決まったルールで成績データから自動作成しています。各文には「事実（記録そのもの）」「計算（記録から計算した値や比較）」「解釈（数字から読み取れる傾向）」の区別と、根拠となる数値・対象期間を表示しています。</p>
<ul>
  <li><b>比較対象</b>: リーグ平均（${S.meta.season}年・パ・リーグ全選手の合計から計算）。同じ役割の比較は、野手は守備位置（捕手／内野手／外野手）ごとに${th.compareMinPA}打席以上、投手は先発／救援ごとに${th.compareMinOuts / 3}投球回以上の選手が対象。</li>
  <li><b>サンプルが少ない場合</b>: ${th.smallSamplePA}打席未満、または${th.smallSampleOuts / 3}投球回未満の選手は「サンプル少」と明記し、タイプ判定を行いません。</li>
  <li><b>最近の状態</b>: 野手は本人の直近${r.recentGames.bat}試合、先発投手は直近${r.recentGames.pitSP}登板、救援投手は直近${r.recentGames.pitRP}登板。直近OPSと通算OPSの差が±${r.recentDiffOPS.toFixed(3).slice(1)}以上（打席${r.recentMinPA}以上）、直近防御率と通算防御率の差が±${r.recentDiffERA.toFixed(2)}以上（${r.recentMinOuts / 3}投球回以上）で「上向き／落ち込み」と表現します。</li>
  <li><b>最近好調な選手（トップページ）</b>: 基準日以前で試合記録のある最終日までの14日間で、打者は${th.hotMinPA}打席以上のOPS上位、投手は${th.hotMinOuts / 3}投球回以上の防御率上位。</li>
  <li><b>使わない情報</b>: 故障・性格・努力・フォーム変更などは成績データから判断できないため、推測して書きません。守備・走塁・球速・球種の分析は、対応するデータがないため行っていません。将来の成績を保証・予測する表現は使いません。</li>
</ul>
<h3>強み・課題の判定基準（リーグ平均との差）</h3>
<div class="table-scroll"><table><thead><tr><th class="l">打撃指標</th><th>強みとする差</th><th>課題とする差</th><th class="l">向き</th></tr></thead><tbody>${Object.entries(r.bat)
    .map(([k, x]) => fmtRule(k, x))
    .join('')}</tbody></table></div>
<div class="table-scroll" style="margin-top:10px"><table><thead><tr><th class="l">投手指標</th><th>強みとする差</th><th>課題とする差</th><th class="l">向き</th></tr></thead><tbody>${Object.entries(r.pit)
    .map(([k, x]) => fmtRule(k, x))
    .join('')}</tbody></table></div>
<p class="muted small">投手の奪三振率・与四球率・被本塁打率は9イニングあたりの値。チームの強み・課題は、各指標の6球団中の順位（1〜2位を強み、5〜6位を課題）で判定しています。期待勝率（ピタゴラス勝率）の指数は1.83を使用しています。</p>

<h2 id="missing">取得・表示できない項目</h2>
<ul>
  <li>取得元のCSVに含まれない項目${demo ? '（例: デモでは故意四球、2025年の盗塁死・併殺打）' : ''}は「データなし」と表示します。</li>
  <li>試合別成績・状況別成績（左右別・得点圏・球場別）は、元データがある場合に限って表示します。通算成績から推測して作ることはしません。</li>
  <li>守備・走塁・球速・球種のデータは扱っていません。</li>
</ul>
`;
  return page({ title: 'データと分析の方法', root, current: 'about', body, ctx });
}
