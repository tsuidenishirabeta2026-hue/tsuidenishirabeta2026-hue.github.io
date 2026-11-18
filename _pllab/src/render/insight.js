// 選手ページ: 「前年から伸びた指標」「リーグ平均との差」「根拠付きの短評」と年度別成績（Wikipedia の選手記事より）
import { esc, rate3, fixed, int, ip } from '../format.js';
import { battingRates, pitchingRates } from '../metrics.js';
import { playerInsight, fmtDiff, MIN_COVERAGE, YOY_MIN_PA, YOY_MIN_OUTS } from '../history.js';
import { term } from './layout.js';

const sizeText = (isP, n) => (n === null || n === undefined ? 'データなし' : isP ? `${Math.floor(n / 3)}${n % 3 ? `.${n % 3}` : ''}回` : `${n}打席`);

function judge(m, enough) {
  if (m.better === null) return '<span class="na">比較不可</span>';
  if (!enough) return '<span class="eval even">参考</span>';
  if (m.better >= m.minDiff) return `<span class="eval good">▲ ${m.higher ? '伸びた' : '改善'}</span>`;
  if (m.better <= -m.minDiff) return `<span class="eval bad">▼ ${m.higher ? '下がった' : '悪化'}</span>`;
  return '<span class="eval even">− 横ばい</span>';
}
function judgeLg(r) {
  if (r.better === null) return '<span class="na">比較不可</span>';
  if (r.better >= r.minDiff) return '<span class="eval good">▲ 平均より良い</span>';
  if (r.better <= -r.minDiff) return '<span class="eval bad">▼ 平均より悪い</span>';
  return '<span class="eval even">− 平均並み</span>';
}

function yearTable(h, isP) {
  const years = [...(isP ? h.pit : h.bat).values()].sort((a, b) => b.year - a.year);
  if (!years.length) return '';
  const rows = years
    .map(({ year, teams, tot }) => {
      if (isP) {
        const r = pitchingRates(tot);
        return `<tr><td class="l">${year}</td><td class="l">${esc(teams.join('→'))}</td><td>${int(tot.G)}</td><td>${ip(tot.outs)}</td><td>${int(tot.W)}</td><td>${int(tot.L)}</td><td>${int(tot.SV)}</td><td>${int(tot.HLD)}</td><td>${int(tot.SO)}</td><td>${fixed(r.ERA)}</td><td>${fixed(r.WHIP)}</td><td>${fixed(r.K9)}</td><td>${fixed(r.BB9)}</td></tr>`;
      }
      const r = battingRates(tot);
      return `<tr><td class="l">${year}</td><td class="l">${esc(teams.join('→'))}</td><td>${int(tot.G)}</td><td>${int(tot.PA)}</td><td>${int(tot.H)}</td><td>${int(tot.HR)}</td><td>${int(tot.RBI)}</td><td>${int(tot.SB)}</td><td>${rate3(r.AVG)}</td><td>${rate3(r.OBP)}</td><td>${rate3(r.SLG)}</td><td>${rate3(r.OPS)}</td></tr>`;
    })
    .join('');
  const head = isP
    ? ['登板', '投球回', '勝利', '敗戦', 'セーブ', 'ホールド', '奪三振', '防御率', 'WHIP', '奪三振率', '与四球率']
    : ['試合', '打席', '安打', '本塁打', '打点', '盗塁', '打率', '出塁率', '長打率', 'OPS'];
  return `<h3>年度別成績</h3><div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">年度</th><th class="l">球団</th>${head.map((x) => `<th>${term(x)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">日本のプロ野球（NPB）での成績。同じ年に複数球団に所属した場合は合算しています。率は記事の記録から再計算した値です。検算（打席数・塁打・防御率）が合わない行は使っていません。</p>`;
}

export function insightSection(ctx, p) {
  const H = ctx.history;
  if (!H) return null;
  const I = playerInsight(H, p);
  const h = H.per.get(p.id);
  const wiki = p.info.wiki_title;
  const src = h ? `<p class="muted small">出典: <a href="https://ja.wikipedia.org/w/index.php?title=${encodeURIComponent(wiki)}&oldid=${h.revid}" rel="noopener">Wikipedia「${esc(wiki)}」（版 ${esc(h.revid)}）</a>の年度別成績表（CC BY-SA 4.0）。記事は有志が編集しているため、公式記録と異なる・更新が遅れる場合があります。${h.updatedThrough ? `この記事は${h.updatedThrough}年シーズン終了時点の成績まで掲載されています。` : ''}</p>` : '';
  if (I.status !== 'ok') {
    const reason = { 'no-article': 'Wikipedia の選手記事を特定できない（または取得前の）ため', 'no-table': '記事に年度別成績の表がないため（新入団選手、表の書式が異なる記事など）', 'no-rows': '記事の年度別成績を読み取れなかったため' }[I.status];
    return { ok: false, html: `<div class="notice info"><strong>年度別成績を表示できません。</strong>${reason}、前年比・リーグ平均との比較は行っていません（推測で埋めることはしません）。</div>${src}` };
  }
  const isP = I.isPitcher;
  const li = (x) => `<li><span class="kind k-${esc(x.kind)}">${esc(x.kind)}</span>${esc(x.text)}${x.basis ? `<span class="basis">根拠: ${esc(x.basis)}</span>` : ''}</li>`;
  const skipped = (h.invalidYears || []).filter((y) => y > I.latest);
  const skipNote = skipped.length ? `<div class="notice info small"><strong>${skipped.join('・')}年の成績は使っていません。</strong>記事の数値が検算（打席数 = 打数＋四球＋死球＋犠打＋犠飛、塁打、防御率）と合わないためです。記事が修正されると自動で反映されます。</div>` : '';
  const short = `${skipNote}<div class="card analysis"><h3 style="margin-top:0">短評（${I.latest}年）</h3><ul>${I.comment.map(li).join('')}</ul>
<p class="muted small">成績の数字だけから機械的に作成しています。故障・調子の原因・フォームなど数字から分からないことには触れず、将来の成績を保証するものではありません。</p></div>`;

  const yoy = I.prev
    ? `<h3>前年から伸びた指標（${I.latest - 1}年 → ${I.latest}年）</h3>
<p class="small">比較条件: ${I.latest - 1}年 <b>${sizeText(isP, I.prevSize)}</b> → ${I.latest}年 <b>${sizeText(isP, I.curSize)}</b>。両年とも ${isP ? `${YOY_MIN_OUTS / 3}投球回` : `${YOY_MIN_PA}打席`}以上のときだけ「伸びた／下がった」を判定し、それ未満は「参考」としています。</p>
<p class="muted small">↓ の付いた指標は低いほど良い指標です。</p>
<div class="table-scroll"><table class="wrap"><thead><tr><th class="l">指標</th><th>${I.latest - 1}年</th><th>${I.latest}年</th><th>差・判定</th></tr></thead><tbody>${I.yoy
        .map((m) => `<tr><td class="l">${term(m.label.replace(/（.*）/, ''), m.key === 'ISO' ? 'ISO' : m.label.replace(/（.*）/, ''))}${m.higher ? '' : '<sup aria-label="低いほど良い">↓</sup>'}</td><td>${esc(m.prev)}</td><td><b>${esc(m.cur)}</b></td><td>${m.diff === null ? '' : `${esc(fmtDiff(m.key, m.diff))}<br>`}${judge(m, I.enough)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : `<h3>前年から伸びた指標</h3><p class="empty">${I.latest - 1}年の成績が記事に無いため、前年比は表示できません（${I.latest}年が初出場の年など）。</p>`;

  const lg = I.league
    ? `<h3>リーグ平均との差（${I.league.year}年）</h3>
<p class="small">比較条件: 本人 <b>${sizeText(isP, I.league.size)}</b>。比較対象は「現在パ・リーグ6球団に所属し、Wikipedia の記事が${I.league.year}年まで更新されている${isP ? '投手' : '野手'}${I.league.population}人」の、${I.league.year}年のパ・リーグ球団での成績の合計から計算した平均です（記事の更新率 ${Math.round(I.league.coverage * 100)}%）。退団・引退した選手を含まないため、公式のリーグ平均とは異なります。</p>
<div class="table-scroll"><table class="wrap"><thead><tr><th class="l">指標</th><th>本人</th><th>平均</th><th>差・判定</th></tr></thead><tbody>${I.league.rows
        .map((r) => `<tr><td class="l">${term(r.label.replace(/（.*）/, ''), r.key === 'ISO' ? 'ISO' : r.label.replace(/（.*）/, ''))}${r.higher ? '' : '<sup aria-label="低いほど良い">↓</sup>'}</td><td><b>${esc(r.me)}</b></td><td>${esc(r.lg)}</td><td>${r.diff === null ? '' : `${esc(fmtDiff(r.key, r.diff))}<br>`}${judgeLg(r)}</td></tr>`)
        .join('')}</tbody></table></div>
${I.league.year !== I.latest ? `<p class="muted small">${esc(I.coverageNote || `${I.latest}年のリーグ平均は計算できないため`)}、${I.league.year}年で比較しています。</p>` : ''}`
    : `<h3>リーグ平均との差</h3><p class="empty">比較できる年がありません。${esc(I.coverageNote || '')}（記事の更新率が${MIN_COVERAGE * 100}%以上の年だけ計算します）</p>`;

  return { ok: true, html: `${short}${yoy}${lg}${yearTable(h, isP)}${src}` };
}
