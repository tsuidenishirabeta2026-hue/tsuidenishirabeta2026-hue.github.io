import { esc, dateShort, rate3, fixed, gb, int, plain, signed } from '../format.js';
import { has } from '../metrics.js';
import { analyzeTeam } from '../analysis.js';
import { page, term, teamChip, playerLink } from './layout.js';
import { BAT_COLS, PIT_COLS, td, headCells, termHelp } from './cols.js';
import { standingsTable, gamesSection } from './page-index.js';
import { movesList, isTransaction } from './page-moves.js';
import { noteBlock } from './notes.js';

function analysisList(items) {
  return `<ul>${items.map((x) => `<li><span class="kind k-${esc(x.kind)}">${esc(x.kind)}</span>${esc(x.text)}<span class="basis">根拠: ${esc(x.basis)}</span></li>`).join('')}</ul>`;
}

function stintNote(p, tid) {
  const st = p.stints.find((s) => s.team_id === tid);
  if (!st) return '';
  if (st.to_date) return ` <span class="tag">${dateShort(st.to_date)}まで在籍</span>`;
  if (st.from_date) return ` <span class="tag">${dateShort(st.from_date)}から在籍</span>`;
  return '';
}

export function renderTeam(ctx, tid, history) {
  const { S } = ctx;
  const root = '../';
  ctx.root = root;
  const t = S.teams.get(tid);
  const T = S.teamStats[tid];
  const st = T.standing;
  const A = analyzeTeam(S, tid);
  const L = S.league;

  // 所属選手（この球団に在籍した全選手。移籍者はこの球団での成績のみ）
  const roster = [...S.players.values()].filter((p) => p.stints.some((s) => s.team_id === tid));
  const batters = roster.filter((p) => !p.isPitcher);
  const pitchers = roster.filter((p) => p.isPitcher);
  const rowB = (p) => {
    const b = p.batRows.find((r) => r.team_id === tid);
    const num = p.stints.find((s) => s.team_id === tid)?.number;
    const lead = `<td class="l name">${playerLink(p, root)}${stintNote(p, tid)}</td><td>${esc(num || '')}</td><td class="l">${esc(p.info.position)}</td>`;
    if (!b) return `<tr>${lead}<td class="l" colspan="${BAT_COLS.length}"><span class="na">今季の出場記録なし</span></td></tr>`;
    const rates = (p.stints.length > 1 ? null : p.batRates) || ratesFor(b, 'bat');
    return `<tr>${lead}${BAT_COLS.map(([, k, f]) => td(f, k, b, rates)).join('')}</tr>`;
  };
  const rowP = (p) => {
    const r = p.pitRows.find((x) => x.team_id === tid);
    const num = p.stints.find((s) => s.team_id === tid)?.number;
    const lead = `<td class="l name">${playerLink(p, root)}${stintNote(p, tid)}</td><td>${esc(num || '')}</td><td class="l">${esc(p.role)}</td>`;
    if (!r) return `<tr>${lead}<td class="l" colspan="${PIT_COLS.length}"><span class="na">今季の登板記録なし</span></td></tr>`;
    return `<tr>${lead}${PIT_COLS.map(([, k, f]) => td(f, k, r, ratesFor(r, 'pit'))).join('')}</tr>`;
  };
  const byPA = (a, b) => (b.batRows.find((r) => r.team_id === tid)?.PA ?? -1) - (a.batRows.find((r) => r.team_id === tid)?.PA ?? -1);
  const byOuts = (a, b) => (b.pitRows.find((r) => r.team_id === tid)?.outs ?? -1) - (a.pitRows.find((r) => r.team_id === tid)?.outs ?? -1);

  const metricRows = A.table
    .map((m) => {
      const ev = m.rank === null ? '<span class="na">データなし</span>' : m.rank <= 2 ? `<span class="eval good">▲ ${m.rank}位</span>` : m.rank >= 5 ? `<span class="eval bad">▼ ${m.rank}位</span>` : `<span class="eval even">${m.rank}位</span>`;
      return `<tr><td class="l">${esc(m.label)}${m.higher ? '' : ' <span class="muted small">（低いほど良い）</span>'}</td><td>${m.v === null || m.v === undefined ? '<span class="na">データなし</span>' : esc(m.fmt(m.v))}</td><td>${ev}</td></tr>`;
    })
    .join('');

  // 過去シーズンとの比較
  const hist = history
    .map((H) => {
      const ts = H.teamStats[tid];
      if (!ts) return '';
      const s = ts.standing;
      return `<tr${H.meta.season === S.meta.season ? ' class="highlight"' : ''}><td class="l">${H.meta.season}</td><td>${s.rank}${s.tied ? '<span class="tag tie">同率</span>' : ''}</td><td>${s.G}</td><td>${s.W}</td><td>${s.L}</td><td>${s.T}</td><td>${rate3(s.pct)}</td><td>${has(s.RS) && s.G ? (s.RS / s.G).toFixed(2) : '<span class="na">データなし</span>'}</td><td>${has(s.RA) && s.G ? (s.RA / s.G).toFixed(2) : '<span class="na">データなし</span>'}</td>${S.statsAvailable ? `<td>${rate3(ts.batRates.OPS)}</td><td>${fixed(ts.pitRates.ERA)}</td>` : ''}</tr>`;
    })
    .join('');

  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › 球団</p>
<div class="card player-head">
  <h1>${esc(t.name)}</h1>
  <ul class="facts">
    <li><span>本拠地</span>${esc(t.home || 'データなし')}</li>
    <li><span>本拠地球場</span>${esc(t.stadium || 'データなし')}</li>
    <li><span>${S.meta.season}年</span>${st.rank}位${st.tied ? '（同率）' : ''}　${st.W}勝${st.L}敗${st.T}分　勝率${rate3(st.pct)}</li>
  </ul>
</div>

<h2>シーズン成績</h2>
${standingsTable(S, root, { highlight: tid })}
${A.pyth ? `<div class="card analysis"><ul><li><span class="kind k-${A.pyth.kind}">${A.pyth.kind}</span>${esc(A.pyth.text)}<span class="basis">根拠: ${esc(A.pyth.basis)}</span></li></ul></div>` : ''}

${S.statsAvailable ? `<h2>チームの強みと課題</h2>
<div class="grid two analysis">
  <div class="card"><h3 style="margin-top:0">強み（リーグ上位2球団の指標）</h3>${analysisList(A.strengths)}</div>
  <div class="card"><h3 style="margin-top:0">課題（リーグ下位2球団の指標）</h3>${analysisList(A.weaknesses)}</div>
</div>
<div class="table-scroll"><table class="wrap"><thead><tr><th class="l">指標</th><th>値</th><th>6球団中の順位</th></tr></thead><tbody>${metricRows}</tbody></table></div>
<p class="muted small">「▲」はリーグ1〜2位、「▼」は5〜6位。投手の率は9イニングあたり。チーム打撃・投手成績は所属選手の成績の合計から計算しています。</p>

<h2>打撃成績（チーム合計）</h2>
<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">区分</th>${headCells(BAT_COLS)}</tr></thead><tbody>
<tr><td class="l">${esc(t.short_name)}</td>${BAT_COLS.map(([, k, f]) => td(f, k, T.bat, T.batRates)).join('')}</tr>
<tr><td class="l">リーグ平均（1球団あたり）</td>${BAT_COLS.map(([, k, f]) => (f === 'int' ? `<td>${has(L.bat[k]) ? (L.bat[k] / 6).toFixed(1) : '<span class="na">データなし</span>'}</td>` : td(f, k, L.bat, L.batRates))).join('')}</tr>
</tbody></table></div>

<h2>投手成績（チーム合計）</h2>
<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">区分</th>${headCells(PIT_COLS)}</tr></thead><tbody>
<tr><td class="l">${esc(t.short_name)}</td>${PIT_COLS.map(([, k, f]) => td(f, k, T.pit, T.pitRates)).join('')}</tr>
<tr><td class="l">リーグ平均（1球団あたり）</td>${PIT_COLS.map(([, k, f]) => (f === 'int' || f === 'ip' ? `<td>${has(L.pit[k]) ? (f === 'ip' ? `${(L.pit[k] / 6 / 3).toFixed(1)}回` : (L.pit[k] / 6).toFixed(1)) : '<span class="na">データなし</span>'}</td>` : td(f, k, L.pit, L.pitRates))).join('')}</tr>
</tbody></table></div>
<p class="muted small">リーグ平均の率（打率・防御率など）はリーグ全体の合計値から計算しています（各球団の率の単純平均ではありません）。</p>

` : ''}
${S.games.length ? `<h2>直近の試合と日程</h2>
${gamesSection(S, root, { teamId: tid, recentN: 5, upcomingDays: 3 })}` : ''}

${ctx.moves ? `<h2 id="moves">最近の動き（移籍・契約など） <span class="tag" style="vertical-align:middle">実データ</span></h2>
<p class="muted small">出典: Wikipedia 日本語版（CC BY-SA 4.0、改変あり）ほか。${ctx.demo ? '下の成績・所属選手はデモデータです。' : ''}</p>
${movesList(ctx.moves.events.filter((e) => e.teams.includes(tid) && isTransaction(e)), S, root, { limit: 8 })}
<p><a href="${root}moves.html#team=${esc(tid)}">${esc(t.short_name)}の動きをすべて見る</a></p>` : ''}
${S.statsAvailable ? `<h2 id="roster">所属選手 — 野手</h2>
${termHelp(BAT_COLS)}
<div class="table-scroll"><table class="sticky-first sortable"><thead><tr><th class="l" scope="col">選手</th><th scope="col">背番号</th><th class="l" scope="col">守備</th>${headCells(BAT_COLS, { terms: false })}</tr></thead><tbody>${batters.sort(byPA).map(rowB).join('')}</tbody></table></div>
<h2>所属選手 — 投手</h2>
${termHelp(PIT_COLS)}
<div class="table-scroll"><table class="sticky-first sortable"><thead><tr><th class="l" scope="col">選手</th><th scope="col">背番号</th><th class="l" scope="col">役割</th>${headCells(PIT_COLS, { terms: false })}</tr></thead><tbody>${pitchers.sort(byOuts).map(rowP).join('')}</tbody></table></div>
<p class="muted small">シーズン途中に移籍した選手は、この球団に在籍中の成績のみを表示しています。見出しをタップすると並べ替えできます。</p>

` : simpleRoster(S, roster, tid, root) + salaryTop(ctx, roster, tid, root)}
${noteBlock(ctx, { pageType: 'team', teamId: tid, heading: `${t.short_name}の解説記事（note）` })}
<h2>過去シーズンとの比較</h2>
${history.length > 1 ? `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">年度</th><th>順位</th><th>${term('試合')}</th><th>${term('勝利')}</th><th>${term('敗戦')}</th><th>${term('引分')}</th><th>${term('勝率')}</th><th>1試合あたり得点</th><th>1試合あたり失点</th>${S.statsAvailable ? `<th>${term('OPS')}</th><th>${term('防御率')}</th>` : ''}</tr></thead><tbody>${hist}</tbody></table></div>` : '<p class="empty">比較できる過去シーズンのデータがありません。</p>'}
`;
  return page({ title: t.name, root, current: 'teams', body, ctx, teamColor: t.color, description: `${t.name}の${S.meta.season}年チーム成績・所属選手・強みと課題（非公式）`, pageMeta: { pageType: 'team' } });
}

import { battingRates, pitchingRates } from '../metrics.js';
function ratesFor(row, kind) {
  return kind === 'bat' ? battingRates(row) : pitchingRates(row);
}

/** 個人成績が無い場合の所属選手一覧（背番号・守備位置のみ） */
/** 年俸（推定）の高い選手。Wikipedia の基本情報に円で書かれている選手だけ */
function salaryTop(ctx, roster, tid, root) {
  const H = ctx.history;
  if (!H) return '';
  const list = roster
    .map((p) => ({ p, s: H.per.get(p.id)?.salary }))
    .filter((x) => x.s && x.s.yen !== null)
    .sort((a, b) => b.s.yen - a.s.yen)
    .slice(0, 10);
  if (!list.length) return '';
  return `<h2 id="salary">年俸（推定）の高い選手</h2>
<div class="table-scroll"><table><thead><tr><th class="l">選手</th><th>年俸（推定）</th><th>年</th></tr></thead><tbody>${list
    .map((x) => `<tr><td class="l name">${playerLink(x.p, root)}</td><td>${esc(x.s.text)}</td><td>${x.s.year || ''}</td></tr>`)
    .join('')}</tbody></table></div>
<p class="muted small">報道による推定の金額です（球団は公表していません）。出典: Wikipedia の各選手記事の基本情報（CC BY-SA 4.0）。ドル表記の選手と、記載のない選手は含みません。<a href="${root}players/index.html#team=${esc(tid)}&amp;sort=sal">全選手を年俸順に見る</a></p>`;
}

function simpleRoster(S, roster, tid, root) {
  const groups = ['投手', '捕手', '内野手', '外野手'];
  const num = (p) => p.stints.find((s) => s.team_id === tid)?.number ?? '';
  const nv = (p) => {
    const n = num(p);
    if (n === '' || Number.isNaN(Number(n))) return 9999;
    return Number(n) - (n.length > 1 && n[0] === '0' ? 0.5 : 0); // "0" と "00" を区別
  };
  const byNum = (a, b) => nv(a) - nv(b);
  const rows = groups
    .map((g) => {
      const ps = roster.filter((p) => p.info.position === g).sort(byNum);
      if (!ps.length) return '';
      return `<h3>${g}（${ps.length}人）</h3><div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">選手</th><th>背番号</th><th class="l">守備位置</th></tr></thead><tbody>${ps
        .map((p) => `<tr><td class="l name">${playerLink(p, root)}${p.info.roster_type === '育成' ? ' <span class="tag">育成</span>' : ''}${stintNote(p, tid)}</td><td>${esc(num(p))}</td><td class="l">${esc(p.info.position)}</td></tr>`)
        .join('')}</tbody></table></div>`;
    })
    .join('');
  return `<h2 id="roster">所属選手（${roster.length}人）</h2>
${S.meta.roster_note ? `<p class="muted small">${esc(S.meta.roster_note)}</p>` : ''}
${rows || '<p class="empty">所属選手のデータがありません。</p>'}
<p class="muted small">個人成績は、規約上利用できる取得元がないため掲載していません。</p>
`;
}
