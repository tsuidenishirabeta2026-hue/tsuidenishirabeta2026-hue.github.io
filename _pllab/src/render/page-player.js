import { esc, dateJa, dateShort, rate3, fixed, pct, int, plain, ageOn } from '../format.js';
import { has, outsToIp, battingRates, pitchingRates } from '../metrics.js';
import { analyzeBatter, analyzePitcher } from '../analysis.js';
import { lastNBat, lastNPit, monthlyBat, monthlyPit, splitRows, comparisonGroup, rankIn } from '../model.js';
import { splitLabel } from '../schema.js';
import { page, term, teamChip, playerLink } from './layout.js';
import { BAT_COLS, PIT_COLS, td, headCells } from './cols.js';
import { indexBars, trendLine } from './charts.js';

const SECTION_TITLES = [
  ['type', 'どのようなタイプの選手か'],
  ['strengths', '数字から確認できる強み'],
  ['weaknesses', '数字から確認できる課題'],
  ['recent', '最近の状態'],
  ['watch', '今後注目したいポイント'],
];

function analysisBlock(A, title) {
  if (!A) return '';
  const li = (x) => `<li><span class="kind k-${esc(x.kind)}">${esc(x.kind)}</span>${esc(x.text)}${x.basis ? `<span class="basis">根拠: ${esc(x.basis)}</span>` : ''}</li>`;
  const sections = SECTION_TITLES.map(([k, t]) => (A[k].length ? `<li><h3>${t}</h3><ul>${A[k].map(li).join('')}</ul></li>` : '')).join('');
  return `<div class="card analysis">
<h3 style="margin-top:0">${esc(title)}</h3>
${A.note ? `<ul>${li(A.note)}</ul>` : ''}
${sections ? `<ol class="sections">${sections}</ol>` : ''}
<p class="muted small">「事実」は記録そのもの、「計算」は記録から計算した値や平均との比較、「解釈」は数字から読み取れる傾向です。成績データから分からないこと（故障・調子の原因・フォームなど）には触れていません。判定基準は<a href="../about.html#analysis">分析の方法</a>を参照。</p>
</div>`;
}

const evalCell = (a, b, higher, tol) => {
  if (!has(a) || !has(b)) return '<td><span class="na">比較不可</span></td>';
  const d = a - b;
  if (Math.abs(d) < tol) return '<td><span class="eval even">− 平均並み</span></td>';
  const good = higher ? d > 0 : d < 0;
  return `<td><span class="eval ${good ? 'good' : 'bad'}">${good ? '▲ 平均より良い' : '▼ 平均より悪い'}</span></td>`;
};

function batCompare(S, p, th) {
  const R = p.batRates;
  const L = S.league.batRates;
  const G = comparisonGroup(S, p, th);
  const defs = [
    ['打率', 'AVG', rate3, true, 0.01],
    ['出塁率', 'OBP', rate3, true, 0.01],
    ['長打率', 'SLG', rate3, true, 0.015],
    ['OPS', 'OPS', rate3, true, 0.02],
    ['ISO', 'ISO', rate3, true, 0.01],
    ['四球率', 'BBPCT', pct, true, 0.005],
    ['三振率', 'KPCT', pct, false, 0.01],
    ['BABIP', 'BABIP', rate3, true, 0.01],
  ];
  const rows = defs
    .map(([label, k, f, higher, tol]) => {
      const rk = G && G.members.some((m) => m.id === p.id) ? rankIn(G.members, (m) => m.batRates[k].v, R[k].v, higher) : null;
      return `<tr><td class="l">${term(label)}${higher ? '' : ' <span class="muted small">低いほど良い</span>'}</td><td><b>${f(R[k])}</b></td><td>${f(L[k])}</td><td>${G ? f(G.rates[k]) : '<span class="na">データなし</span>'}</td>${evalCell(R[k].v, L[k].v, higher, tol)}<td>${rk ? `${rk.of}人中${rk.rank}位` : '<span class="na">対象外</span>'}</td></tr>`;
    })
    .join('');
  const chart = indexBars({
    title: 'リーグ平均との比較（指数）',
    sub: `${S.meta.season}年シーズン・${dateShort(S.meta.as_of_date)}時点。リーグ平均=100、右に長いほど良い（三振率は低いほど良いため「リーグ平均÷本人×100」で指数化）。右端の数字は本人の実数値。`,
    items: [
      ['打率', 'AVG', rate3, true],
      ['出塁率', 'OBP', rate3, true],
      ['長打率', 'SLG', rate3, true],
      ['OPS', 'OPS', rate3, true],
      ['四球率', 'BBPCT', pct, true],
      ['三振率', 'KPCT', pct, false],
    ].map(([label, k, f, higher]) => ({
      label,
      index: has(R[k].v) && has(L[k].v) && L[k].v > 0 && R[k].v > 0 ? (higher ? (R[k].v / L[k].v) * 100 : (L[k].v / R[k].v) * 100) : NaN,
      valueText: plain(f, R[k]),
      refText: plain(f, L[k]),
    })),
  });
  return `${chart}<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">指標</th><th>本人</th><th>リーグ平均</th><th>${esc(G ? G.label : '同じ役割')}の平均</th><th>リーグ平均と比べて</th><th>同じ役割での順位</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">リーグ平均・同じ役割の平均は、対象選手の成績を合計してから計算しています。「平均並み」は差が小さい場合（指標ごとの許容幅は分析の方法を参照）。同じ役割での順位は${esc(G ? G.label : '')}の選手${G ? G.members.length : 0}人が対象で、本人が条件を満たさない場合は「対象外」です。</p>`;
}

function pitCompare(S, p, th) {
  const R = p.pitRates;
  const L = S.league.pitRates;
  const G = comparisonGroup(S, p, th);
  const defs = [
    ['防御率', 'ERA', false, 0.15],
    ['WHIP', 'WHIP', false, 0.04],
    ['奪三振率', 'K9', true, 0.3],
    ['与四球率', 'BB9', false, 0.2],
    ['被本塁打率', 'HR9', false, 0.08],
    ['K/BB', 'KBB', true, 0.2],
  ];
  const rows = defs
    .map(([label, k, higher, tol]) => {
      const rk = G && G.members.some((m) => m.id === p.id) ? rankIn(G.members, (m) => m.pitRates[k].v, R[k].v, higher) : null;
      return `<tr><td class="l">${term(label)}${higher ? '' : ' <span class="muted small">低いほど良い</span>'}</td><td><b>${fixed(R[k])}</b></td><td>${fixed(L[k])}</td><td>${G ? fixed(G.rates[k]) : '<span class="na">データなし</span>'}</td>${evalCell(R[k].v, L[k].v, higher, tol)}<td>${rk ? `${rk.of}人中${rk.rank}位` : '<span class="na">対象外</span>'}</td></tr>`;
    })
    .join('');
  const chart = indexBars({
    title: 'リーグ平均との比較（指数）',
    sub: `${S.meta.season}年シーズン・${dateShort(S.meta.as_of_date)}時点。リーグ平均=100、右に長いほど良い（防御率・WHIP・与四球率・被本塁打率は低いほど良いため「リーグ平均÷本人×100」で指数化）。右端の数字は本人の実数値。`,
    items: defs.map(([label, k, higher]) => ({
      label,
      index: has(R[k].v) && has(L[k].v) && L[k].v > 0 && R[k].v > 0 ? (higher ? (R[k].v / L[k].v) * 100 : (L[k].v / R[k].v) * 100) : NaN,
      valueText: plain(fixed, R[k]),
      refText: plain(fixed, L[k]),
    })),
  });
  return `${chart}<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">指標</th><th>本人</th><th>リーグ平均</th><th>${esc(G ? G.label : '同じ役割')}の平均</th><th>リーグ平均と比べて</th><th>同じ役割での順位</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">リーグ平均・同じ役割の平均は、対象投手の成績を合計してから計算しています。防御率・WHIP などで投球回・自責点が0のときは「算出不可」と表示します。同じ役割での順位は${esc(G ? G.label : '')}の投手${G ? G.members.length : 0}人が対象。</p>`;
}

function batTrend(S, p) {
  if (!S.hasBatLogs) return '<p class="empty">試合別の成績データがないため、月別・直近の推移は表示できません（通算成績からは推測しません）。</p>';
  if (!p.bLogs.length) return '<p class="empty">今季の試合別出場記録がありません。</p>';
  const months = monthlyBat(p);
  const l5 = lastNBat(p, 5);
  const l10 = lastNBat(p, 10);
  const row = (label, r, games) => `<tr><td class="l">${label}</td><td>${games}</td><td>${r.tot.PA}</td><td>${r.tot.H}</td><td>${r.tot.HR}</td><td>${r.tot.BB}</td><td>${r.tot.SO}</td><td>${rate3(r.rates.AVG)}</td><td>${rate3(r.rates.OBP)}</td><td>${rate3(r.rates.OPS)}</td></tr>`;
  const head = `<thead><tr><th class="l">期間</th><th>${term('試合')}</th><th>${term('打席')}</th><th>${term('安打')}</th><th>${term('本塁打')}</th><th>${term('四球')}</th><th>${term('三振')}</th><th>${term('打率')}</th><th>${term('出塁率')}</th><th>${term('OPS')}</th></tr></thead>`;
  const chart = trendLine({
    title: '月別OPSの推移',
    sub: `${S.meta.season}年・月ごとの集計（下段の数字は打席数）。点線はリーグ平均OPS（シーズン通算）。`,
    points: months.map((m) => ({ label: `${Number(m.month.slice(5))}月`, y: m.rates.OPS.v, n: `${m.tot.PA}打席` })),
    ref: { y: S.league.batRates.OPS.v, label: 'リーグ平均' },
    fmt: (v) => plain(rate3, { v }),
  });
  return `${chart}<div class="table-scroll"><table class="sticky-first">${head}<tbody>
${l5 ? row(`直近5試合<br><span class="muted small">${dateShort(l5.from)}〜${dateShort(l5.to)}</span>`, l5, l5.games) : ''}
${l10 ? row(`直近10試合<br><span class="muted small">${dateShort(l10.from)}〜${dateShort(l10.to)}</span>`, l10, l10.games) : ''}
${months.map((m) => row(`${m.month.replace('-', '年')}月`, m, m.games)).join('')}
<tr class="total"><td class="l">シーズン通算</td><td>${int(p.bat.G)}</td><td>${int(p.bat.PA)}</td><td>${int(p.bat.H)}</td><td>${int(p.bat.HR)}</td><td>${int(p.bat.BB)}</td><td>${int(p.bat.SO)}</td><td>${rate3(p.batRates.AVG)}</td><td>${rate3(p.batRates.OBP)}</td><td>${rate3(p.batRates.OPS)}</td></tr>
</tbody></table></div><p class="muted small">直近の試合数は本人が出場した試合で数えています。打席数が少ない期間の率は大きく変動します。</p>`;
}

function pitTrend(S, p) {
  if (!S.hasPitLogs) return '<p class="empty">試合別の成績データがないため、月別・直近の推移は表示できません（通算成績からは推測しません）。</p>';
  if (!p.pLogs.length) return '<p class="empty">今季の試合別登板記録がありません。</p>';
  const months = monthlyPit(p);
  const l5 = lastNPit(p, 5);
  const l10 = lastNPit(p, 10);
  const row = (label, r, games) => `<tr><td class="l">${label}</td><td>${games}</td><td>${outsToIp(r.tot.outs)}</td><td>${r.tot.H}</td><td>${r.tot.BB}</td><td>${r.tot.SO}</td><td>${r.tot.ER}</td><td>${fixed(r.rates.ERA)}</td><td>${fixed(r.rates.WHIP)}</td></tr>`;
  const head = `<thead><tr><th class="l">期間</th><th>${term('登板')}</th><th>${term('投球回')}</th><th>${term('被安打')}</th><th>${term('与四球')}</th><th>${term('奪三振')}</th><th>${term('自責点')}</th><th>${term('防御率')}</th><th>${term('WHIP')}</th></tr></thead>`;
  const chart = trendLine({
    title: '月別防御率の推移',
    sub: `${S.meta.season}年・月ごとの集計（下段は投球回）。点線はリーグ平均防御率（シーズン通算）。`,
    points: months.map((m) => ({ label: `${Number(m.month.slice(5))}月`, y: m.rates.ERA.v, n: `${outsToIp(m.tot.outs)}回` })),
    ref: { y: S.league.pitRates.ERA.v, label: 'リーグ平均' },
    fmt: (v) => v.toFixed(2),
    lowerIsBetter: true,
  });
  return `${chart}<div class="table-scroll"><table class="sticky-first">${head}<tbody>
${l5 ? row(`直近5登板<br><span class="muted small">${dateShort(l5.from)}〜${dateShort(l5.to)}</span>`, l5, l5.games) : ''}
${l10 ? row(`直近10登板<br><span class="muted small">${dateShort(l10.from)}〜${dateShort(l10.to)}</span>`, l10, l10.games) : ''}
${months.map((m) => row(`${m.month.replace('-', '年')}月`, m, m.games)).join('')}
<tr class="total"><td class="l">シーズン通算</td><td>${int(p.pit.G)}</td><td>${outsToIp(p.pit.outs)}</td><td>${int(p.pit.H)}</td><td>${int(p.pit.BB)}</td><td>${int(p.pit.SO)}</td><td>${int(p.pit.ER)}</td><td>${fixed(p.pitRates.ERA)}</td><td>${fixed(p.pitRates.WHIP)}</td></tr>
</tbody></table></div><p class="muted small">投球回が少ない期間の防御率は大きく変動します。投球回 0 の期間の防御率は「算出不可」です。</p>`;
}

function splitsBlock(S, p) {
  const sp = splitRows(p);
  if (!p.isPitcher) {
    if (!sp.bat.length) return '<p class="empty">状況別（左右別・得点圏・球場別）の元データがないため表示できません。</p>';
    const order = (s) => (s.split === 'vs_lhp' ? 0 : s.split === 'vs_rhp' ? 1 : s.split === 'risp' ? 2 : 3);
    const rows = [...sp.bat].sort((a, b) => order(a) - order(b) || b.PA - a.PA);
    return `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">区分</th><th>${term('打席')}</th><th>${term('打数')}</th><th>${term('安打')}</th><th>${term('本塁打')}</th><th>${term('四球')}</th><th>${term('三振')}</th><th>${term('打率')}</th><th>${term('出塁率')}</th><th>${term('長打率')}</th><th>${term('OPS')}</th></tr></thead><tbody>${rows
      .map((s) => `<tr><td class="l">${esc(splitLabel(s.split))}</td><td>${int(s.PA)}</td><td>${int(s.AB)}</td><td>${int(s.H)}</td><td>${int(s.HR)}</td><td>${int(s.BB)}</td><td>${int(s.SO)}</td><td>${rate3(s.rates.AVG)}</td><td>${rate3(s.rates.OBP)}</td><td>${rate3(s.rates.SLG)}</td><td>${rate3(s.rates.OPS)}</td></tr>`)
      .join('')}</tbody></table></div><p class="muted small">${S.meta.season}年シーズン。打席数が少ない区分は偶然の影響が大きいため、参考程度に見てください。</p>`;
  }
  if (!sp.pit.length) return '<p class="empty">状況別（対左右打者・得点圏）の元データがないため表示できません。</p>';
  return `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">区分</th><th>${term('打者')}</th><th>${term('被安打')}</th><th>${term('被本塁打')}</th><th>${term('与四球')}</th><th>${term('奪三振')}</th><th>被打率</th><th>${term('三振率')}</th></tr></thead><tbody>${sp.pit
    .map((s) => `<tr><td class="l">${esc(splitLabel(s.split))}</td><td>${int(s.BF)}</td><td>${int(s.H)}</td><td>${int(s.HR)}</td><td>${int(s.BB)}</td><td>${int(s.SO)}</td><td>${rate3(s.rates.AVG)}</td><td>${pct(s.rates.KPCT)}</td></tr>`)
    .join('')}</tbody></table></div><p class="muted small">${S.meta.season}年シーズン。被打率 = 被安打 ÷ 打数、三振率 = 奪三振 ÷ 対戦打者。</p>`;
}

function seasonTable(S, p, root) {
  // 今季（移籍者は球団別＋合計）
  if (!p.isPitcher) {
    if (!p.bat) return '<p class="empty">今季の出場記録はありません。</p>';
    const rows = p.batRows.map((r) => `<tr><td class="l">${teamChip(S.teams.get(r.team_id), root)}</td>${BAT_COLS.map(([, k, f]) => td(f, k, r, battingRates(r))).join('')}</tr>`);
    if (p.batRows.length > 1) rows.push(`<tr class="total"><td class="l">合計</td>${BAT_COLS.map(([, k, f]) => td(f, k, p.bat, p.batRates)).join('')}</tr>`);
    const extra = `<ul class="facts small"><li><span>${term('盗塁死')}</span>${int(p.bat.CS)}</li><li><span>${term('犠打')}</span>${int(p.bat.SH)}</li><li><span>${term('犠飛')}</span>${int(p.bat.SF)}</li><li><span>${term('併殺打')}</span>${int(p.bat.GDP)}</li><li><span>故意四球</span>${int(p.bat.IBB)}</li><li><span>${term('規定打席')}</span>${p.qPA ?? 'データなし'}（${p.qualifiedBat ? '到達' : '未到達'}）</li></ul>`;
    return `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">球団</th>${headCells(BAT_COLS)}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${extra}`;
  }
  if (!p.pit) return '<p class="empty">今季の登板記録はありません。</p>';
  const rows = p.pitRows.map((r) => `<tr><td class="l">${teamChip(S.teams.get(r.team_id), root)}</td>${PIT_COLS.map(([, k, f]) => td(f, k, r, pitchingRates(r))).join('')}</tr>`);
  if (p.pitRows.length > 1) rows.push(`<tr class="total"><td class="l">合計</td>${PIT_COLS.map(([, k, f]) => td(f, k, p.pit, p.pitRates)).join('')}</tr>`);
  const extra = `<ul class="facts small"><li><span>${term('打者')}</span>${int(p.pit.BF)}</li><li><span>${term('失点')}</span>${int(p.pit.R)}</li><li><span>${term('被本塁打率')}</span>${fixed(p.pitRates.HR9)}</li><li><span>${term('規定投球回')}</span>${p.qOuts !== null ? outsToIp(p.qOuts) : 'データなし'}（${p.qualifiedPit ? '到達' : '未到達'}）</li></ul>`;
  return `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">球団</th>${headCells(PIT_COLS)}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${extra}`;
}

function yearByYear(entries, p, root) {
  const isP = p.isPitcher;
  const cols = isP ? PIT_COLS : BAT_COLS;
  const rows = entries
    .map(({ S, p: q }) => {
      const tot = isP ? q.pit : q.bat;
      const rates = isP ? q.pitRates : q.batRates;
      const teams = [...new Set(q.stints.map((s) => s.team_id))].map((t) => esc(S.teams.get(t)?.short_name || t)).join('→');
      if (!tot) return `<tr><td class="l">${S.meta.season}</td><td class="l">${teams}</td><td class="l" colspan="${cols.length}"><span class="na">出場記録なし</span></td></tr>`;
      return `<tr><td class="l">${S.meta.season}</td><td class="l">${teams}</td>${cols.map(([, k, f]) => td(f, k, tot, rates)).join('')}</tr>`;
    })
    .join('');
  return `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">年度</th><th class="l">球団</th>${headCells(cols)}</tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">このサイトが保持しているシーズンのみ表示しています（通算成績ではありません）。「データなし」はその年の取得元に該当項目がなかったことを示します。</p>`;
}

export function renderPlayer(ctx, entries, sameNameMap) {
  // entries: [{ S, p }] 古い順。最後が最新シーズン
  const root = '../';
  ctx.root = root;
  const { th } = ctx;
  const { S, p } = entries[entries.length - 1];
  const cur = S === ctx.S; // 最新シーズンに在籍しているか
  const t = S.teams.get(p.info.team_id);
  const age = ageOn(p.info.birth_date, S.meta.as_of_date);
  const tb = p.info.throws && p.info.bats ? `${p.info.throws}投${p.info.bats === '両' ? '両' : p.info.bats}打` : 'データなし';

  const names = [];
  for (const e of entries) {
    if (!names.length || names[names.length - 1].name !== e.p.name) names.push({ name: e.p.name, season: e.S.meta.season });
  }
  const nameHistory = names.length > 1 ? `<li><span>登録名の履歴</span>${names.map((n) => `${n.season}年〜 ${esc(n.name)}`).join(' → ')}</li>` : '';
  const transfers = p.stints.length > 1 ? `<li><span>${S.meta.season}年の所属</span>${p.stints.map((s) => `${esc(S.teams.get(s.team_id).short_name)}${s.from_date ? `（${dateShort(s.from_date)}〜）` : ''}${s.to_date ? `（〜${dateShort(s.to_date)}）` : ''}`).join(' → ')}</li>` : '';
  const same = (sameNameMap.get(`${S.meta.season}|${p.name}`) || []).filter((x) => x.id !== p.id);
  const sameNote = same.length ? `<p class="notice info small" style="margin:10px 0 0"><strong>同じ登録名の選手がいます</strong>${same.map((x) => `${playerLink(x, root)}（${esc(S.teams.get(x.info.team_id).short_name)}・${esc(x.info.position)}・背番号${esc(x.info.number || '—')}）`).join('、')}。このページは選手ID ${esc(p.id)} の選手です。</p>` : '';

  const A = p.isPitcher ? analyzePitcher(S, p, th) : analyzeBatter(S, p, th);
  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › <a href="${root}players/index.html">選手一覧</a> › ${esc(p.name)}</p>
<div class="card player-head">
  <h1>${esc(p.name)}</h1>
  ${p.kana ? `<div class="kana">${esc(p.kana)}</div>` : ''}
  <ul class="facts">
    <li><span>所属</span>${teamChip(t, root, { short: false })}${cur ? '' : `（${S.meta.season}年時点）`}</li>
    <li><span>背番号</span>${esc(p.info.number || 'データなし')}</li>
    <li><span>守備位置</span>${esc(p.info.position)}${p.isPitcher && p.role !== '投手' ? `（主に${esc(p.role)}）` : ''}</li>
    <li><span>投打</span>${esc(tb)}</li>
    <li><span>年齢</span>${age !== null ? `${age}歳（基準日 ${dateShort(S.meta.as_of_date)} 時点）` : 'データなし'}</li>
    ${p.info.birth_date ? `<li><span>生年月日</span>${esc(dateJa(p.info.birth_date).replace(/（.）/, ''))}</li>` : ''}
    ${nameHistory}${transfers}
    <li><span>選手ID</span>${esc(p.id)}</li>
  </ul>
  ${sameNote}
</div>
${cur ? '' : `<p class="notice info">この選手は最新シーズン（${ctx.S.meta.season}年）のデータに所属記録がありません。${S.meta.season}年の情報を表示しています。</p>`}

<h2>分析</h2>
${analysisBlock(A, `${S.meta.season}年の成績から読み取れること`)}

<h2>${S.meta.season}年の成績</h2>
${seasonTable(S, p, root)}

${(p.isPitcher ? p.pit : p.bat) ? `<h2>リーグ平均・同じ役割の選手との比較</h2>${p.isPitcher ? pitCompare(S, p, th) : batCompare(S, p, th)}` : ''}

<h2>推移（月別・直近）</h2>
${p.isPitcher ? pitTrend(S, p) : batTrend(S, p)}

<h2>状況別成績</h2>
${splitsBlock(S, p)}

<h2>年度別成績</h2>
${yearByYear(entries, p, root)}
`;
  return page({ title: `${p.name}（${t.short_name}）`, root, current: 'players', body, ctx, teamColor: t.color, description: `${p.name}選手（${t.name}）の成績と分析（非公式）` });
}
