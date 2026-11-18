// 選手の年度別成績（Wikipedia の選手記事から取得したもの）を使った比較と短評。
//
// 比較の決まり（画面にも表示する）
//   - 前年比: 選手ごとに、記事に載っている最新年度 T と前年 T-1 を比べる
//   - リーグ平均: 「現在パ・リーグ6球団に所属し、記事がその年まで更新されている選手」の、
//     その年のパ・リーグ球団での成績を合計して計算（平均の平均ではない）
//     → 退団・引退した選手は含まれないため、実際のリーグ全体の平均とは異なる（限界として明示）
//   - 記事の更新率が MIN_COVERAGE 未満の年は、偏りが大きいためリーグ平均を計算しない
//   - 前年比の判定は、両年とも 100 打席以上（投手は 30 投球回以上）のときだけ行い、それ未満は参考扱い
import { battingRates, pitchingRates, sumRows, has, outsToIp } from './metrics.js';
import { rate3, fixed, pct, plain, signed } from './format.js';

export const MIN_COVERAGE = 0.7;
export const YOY_MIN_PA = 100;
export const YOY_MIN_OUTS = 90;
const BAT_SUM = ['G', 'PA', 'AB', 'R', 'H', 'D', 'T', 'HR', 'RBI', 'SB', 'CS', 'SH', 'SF', 'BB', 'IBB', 'HBP', 'SO', 'GDP'];
const PIT_SUM = ['G', 'GS', 'W', 'L', 'SV', 'HLD', 'BF', 'outs', 'H', 'HR', 'BB', 'IBB', 'HBP', 'SO', 'R', 'ER'];

// 前年比・平均比較で見る指標 [キー, ラベル, 書式, 大きいほど良いか, 「伸びた」とみなす最小の差]
export const BAT_METRICS = [
  ['OPS', 'OPS', (x) => plain(rate3, x), true, 0.03],
  ['AVG', '打率', (x) => plain(rate3, x), true, 0.015],
  ['OBP', '出塁率', (x) => plain(rate3, x), true, 0.015],
  ['ISO', 'ISO（長打力）', (x) => plain(rate3, x), true, 0.02],
  ['BBPCT', '四球率', (x) => plain(pct, x), true, 0.015],
  ['KPCT', '三振率', (x) => plain(pct, x), false, 0.02],
];
export const PIT_METRICS = [
  ['ERA', '防御率', (x) => plain(fixed, x, 2), false, 0.4],
  ['WHIP', 'WHIP', (x) => plain(fixed, x, 2), false, 0.08],
  ['K9', '奪三振率', (x) => plain(fixed, x, 2), true, 0.7],
  ['BB9', '与四球率', (x) => plain(fixed, x, 2), false, 0.4],
  ['KBB', 'K/BB', (x) => plain(fixed, x, 2), true, 0.4],
];

/** 選手の年度ごとの合計（同じ年に複数球団なら合算）。teamFilter でパ・リーグ球団分だけに絞れる */
function yearTotals(rows, keys, plOnly = false) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r.valid) continue;
    if (plOnly && !r.team_id) continue;
    if (!by.has(r.year)) by.set(r.year, []);
    by.get(r.year).push(r);
  }
  const out = new Map();
  for (const [y, rs] of by) out.set(y, { year: y, teams: [...new Set(rs.map((x) => x.team))], tot: sumRows(rs, keys) });
  return out;
}

/**
 * @param store player-stats.json の内容 { articles: { [title]: { batting, pitching, updatedThrough } } }
 * @param players 現在の所属選手（wiki_title を持つ）
 */
export function buildHistory(store, players, currentSeason) {
  const byTitle = store?.articles || {};
  const per = new Map(); // player_id → { bat: Map(year→), pit: Map(year→), updatedThrough }
  for (const p of players) {
    const a = p.info?.wiki_title ? byTitle[p.info.wiki_title] : null;
    if (!a) continue;
    per.set(p.id, {
      bat: yearTotals(a.batting, BAT_SUM),
      pit: yearTotals(a.pitching, PIT_SUM),
      batPL: yearTotals(a.batting, BAT_SUM, true),
      pitPL: yearTotals(a.pitching, PIT_SUM, true),
      updatedThrough: a.updatedThrough,
      hasTables: !!(a.batting?.length || a.pitching?.length),
      revid: a.revid,
    });
  }
  // 年ごとの更新率とリーグ平均（母集団: その年まで更新済みの記事）
  const withTables = [...per.values()].filter((h) => h.hasTables);
  const seasons = {};
  for (let y = currentSeason; y >= currentSeason - 3; y--) {
    const upd = withTables.filter((h) => (h.updatedThrough || 0) >= y);
    const coverage = withTables.length ? upd.length / withTables.length : 0;
    const batRows = upd.map((h) => h.batPL.get(y)?.tot).filter(Boolean);
    const pitRows = upd.map((h) => h.pitPL.get(y)?.tot).filter(Boolean);
    const bat = sumRows(batRows, BAT_SUM);
    const pit = sumRows(pitRows, PIT_SUM);
    seasons[y] = {
      year: y,
      coverage,
      articles: withTables.length,
      updated: upd.length,
      usable: coverage >= MIN_COVERAGE && batRows.length > 0,
      batPlayers: batRows.length,
      pitPlayers: pitRows.length,
      bat,
      pit,
      batRates: battingRates(bat),
      pitRates: pitchingRates(pit),
    };
  }
  return { per, seasons, currentSeason };
}

function cmp(a, b, higher) {
  if (!has(a) || !has(b)) return null;
  return higher ? a - b : b - a; // 正なら「良くなった／平均より良い」
}

/** 選手ページ用: 対象年度、前年比、リーグ平均との差、短評 */
export function playerInsight(H, player) {
  const h = H.per.get(player.id);
  if (!h) return { status: 'no-article' };
  const isP = player.isPitcher;
  const years = isP ? h.pit : h.bat;
  if (!years.size) return { status: h.hasTables ? 'no-rows' : 'no-table' };
  const latest = Math.max(...years.keys());
  const cur = years.get(latest);
  const prev = years.get(latest - 1) || null;
  const rates = (t) => (isP ? pitchingRates(t) : battingRates(t));
  const size = (t) => (isP ? t.outs : t.PA);
  const minSize = isP ? YOY_MIN_OUTS : YOY_MIN_PA;
  const metrics = isP ? PIT_METRICS : BAT_METRICS;
  const curR = rates(cur.tot);
  const prevR = prev ? rates(prev.tot) : null;
  const enough = prev && has(size(cur.tot)) && has(size(prev.tot)) && size(cur.tot) >= minSize && size(prev.tot) >= minSize;

  const yoy = prev
    ? metrics.map(([k, label, f, higher, minDiff]) => {
        const d = cmp(curR[k].v, prevR[k].v, higher);
        return { key: k, label, cur: f(curR[k]), prev: f(prevR[k]), diff: has(curR[k].v) && has(prevR[k].v) ? curR[k].v - prevR[k].v : null, better: d, improved: enough && d !== null && d >= minDiff, worse: enough && d !== null && d <= -minDiff, minDiff, higher, f };
      })
    : [];

  // リーグ平均: 対象年度が使えなければ、更新率を満たす直近の年を使う（年を明示）
  let lgYear = null;
  for (let y = latest; y >= latest - 2; y--) {
    if (H.seasons[y]?.usable && years.get(y)) {
      lgYear = y;
      break;
    }
  }
  let league = null;
  if (lgYear !== null) {
    const S = H.seasons[lgYear];
    const mine = years.get(lgYear);
    const mr = rates(mine.tot);
    const lr = isP ? S.pitRates : S.batRates;
    league = {
      year: lgYear,
      size: size(mine.tot),
      population: isP ? S.pitPlayers : S.batPlayers,
      coverage: S.coverage,
      rows: metrics.map(([k, label, f, higher, minDiff]) => ({ key: k, label, me: f(mr[k]), lg: f(lr[k]), diff: has(mr[k].v) && has(lr[k].v) ? mr[k].v - lr[k].v : null, better: cmp(mr[k].v, lr[k].v, higher), minDiff, higher, f })),
    };
  }
  const coverageNote = H.seasons[latest] && !H.seasons[latest].usable ? `${latest}年は記事の更新率が${Math.round(H.seasons[latest].coverage * 100)}%（目安 ${MIN_COVERAGE * 100}%）のため、リーグ平均を計算していません` : null;

  return {
    status: 'ok',
    isPitcher: isP,
    latest,
    cur,
    prev,
    curSize: size(cur.tot),
    prevSize: prev ? size(prev.tot) : null,
    enough,
    yoy,
    league,
    coverageNote,
    comment: shortComment({ isP, latest, cur, prev, enough, yoy, league, size }),
  };
}

const sizeText = (isP, n) => (isP ? `${outsToIp(n)}回` : `${n}打席`);
const fmtDiff = (key, d) => {
  if (['BBPCT', 'KPCT'].includes(key)) return `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}ポイント`;
  if (['ERA', 'WHIP', 'K9', 'BB9', 'KBB'].includes(key)) return signed(d, 2, false);
  return signed(d, 3);
};
export { fmtDiff };

/** 根拠つきの短評（2〜3文）。数字にない事柄（故障・フォーム等）には触れない */
function shortComment({ isP, latest, cur, prev, enough, yoy, league }) {
  const out = [];
  const curSize = isP ? cur.tot.outs : cur.tot.PA;
  if (!has(curSize) || curSize === 0) return [{ kind: '事実', text: `${latest}年は出場記録が${isP ? '登板' : '打席'}0でした。`, basis: '' }];
  const small = curSize < (isP ? YOY_MIN_OUTS : YOY_MIN_PA);
  // 1. 前年比で最も伸びた指標
  const ups = yoy.filter((m) => m.improved).sort((a, b) => b.better / b.minDiff - a.better / a.minDiff);
  const downs = yoy.filter((m) => m.worse).sort((a, b) => a.better / a.minDiff - b.better / b.minDiff);
  if (prev && enough && ups.length) {
    const m = ups[0];
    out.push({ kind: '計算', text: `${latest}年は${m.label}が前年の${m.prev}から${m.cur}へ${m.higher ? '上昇' : '改善'}し、最も伸びた指標です。`, basis: `${latest - 1}年 ${sizeText(isP, isP ? prev.tot.outs : prev.tot.PA)} → ${latest}年 ${sizeText(isP, curSize)}。差 ${fmtDiff(m.key, m.diff)}（「伸びた」の目安 ${fmtDiff(m.key, m.higher ? m.minDiff : -m.minDiff)} 以上）` });
  } else if (prev && enough) {
    out.push({ kind: '計算', text: `${latest}年は前年と比べて、目安を超えて伸びた指標はありませんでした。`, basis: `${latest - 1}年 ${sizeText(isP, isP ? prev.tot.outs : prev.tot.PA)} → ${latest}年 ${sizeText(isP, curSize)}` });
  } else if (prev) {
    out.push({ kind: '注意', text: `前年比は、どちらかの年の${isP ? '投球回' : '打席数'}が少ないため参考値です。`, basis: `${latest - 1}年 ${sizeText(isP, isP ? prev.tot.outs : prev.tot.PA)}、${latest}年 ${sizeText(isP, curSize)}（目安 ${isP ? `${YOY_MIN_OUTS / 3}回` : `${YOY_MIN_PA}打席`}以上）` });
  }
  // 2. リーグ平均との比較で最も差が大きい指標（良い方・悪い方）
  if (league && !small) {
    const rows = league.rows.filter((r) => r.better !== null);
    const best = rows.filter((r) => r.better >= r.minDiff).sort((a, b) => b.better / b.minDiff - a.better / a.minDiff)[0];
    const worst = rows.filter((r) => r.better <= -r.minDiff).sort((a, b) => a.better / a.minDiff - b.better / b.minDiff)[0];
    if (best) out.push({ kind: '計算', text: `${league.year}年の${best.label}（${best.me}）は比較対象の平均（${best.lg}）より良い水準です。`, basis: `${league.year}年・${sizeText(isP, league.size)}。比較対象: 現所属のパ・リーグ選手${league.population}人の合計` });
    if (worst) out.push({ kind: '計算', text: `${best ? '一方で' : `${league.year}年は`}${worst.label}（${worst.me}）が比較対象の平均（${worst.lg}）より悪く、数字の上での課題です。`, basis: `${league.year}年・${sizeText(isP, league.size)}・差 ${fmtDiff(worst.key, worst.diff)}。比較対象: 現所属のパ・リーグ選手${league.population}人の合計` });
    if (!best && !worst) out.push({ kind: '解釈', text: `${league.year}年の主要指標は、比較対象の平均から大きく離れていません。`, basis: `${league.year}年・${sizeText(isP, league.size)}` });
  }
  // 3. 下降した指標
  if (prev && enough && downs.length && out.length < 3) {
    const m = downs[0];
    out.push({ kind: '計算', text: `前年から${m.label}は${m.prev}→${m.cur}と${m.higher ? '下がって' : '悪化して'}おり、この推移が注目点です。`, basis: `差 ${fmtDiff(m.key, m.diff)}` });
  }
  if (small) out.push({ kind: '注意', text: `${latest}年は${sizeText(isP, curSize)}と出場機会が少なく、数字は大きく変動しやすい点に注意が必要です。`, basis: `目安 ${isP ? `${YOY_MIN_OUTS / 3}回` : `${YOY_MIN_PA}打席`}` });
  return out.slice(0, 4);
}

/** トップページ用: 前年から伸びた選手（両年とも規定量以上） */
export function biggestRisers(H, playersMap, { n = 5 } = {}) {
  // 比較年度: 更新率を満たす最新の年 Y と Y-1
  const Y = Object.values(H.seasons)
    .filter((s) => s.usable)
    .map((s) => s.year)
    .sort((a, b) => b - a)[0];
  if (!Y) return null;
  const bats = [];
  const pits = [];
  for (const [id, h] of H.per) {
    const p = playersMap.get(id);
    if (!p) continue;
    if (!p.isPitcher) {
      const a = h.bat.get(Y);
      const b = h.bat.get(Y - 1);
      if (a && b && a.tot.PA >= YOY_MIN_PA && b.tot.PA >= YOY_MIN_PA) {
        const ra = battingRates(a.tot).OPS.v;
        const rb = battingRates(b.tot).OPS.v;
        if (has(ra) && has(rb)) bats.push({ p, d: ra - rb, cur: ra, prev: rb, size: a.tot.PA, prevSize: b.tot.PA });
      }
    } else {
      const a = h.pit.get(Y);
      const b = h.pit.get(Y - 1);
      if (a && b && a.tot.outs >= YOY_MIN_OUTS && b.tot.outs >= YOY_MIN_OUTS) {
        const ra = pitchingRates(a.tot).ERA.v;
        const rb = pitchingRates(b.tot).ERA.v;
        if (has(ra) && has(rb)) pits.push({ p, d: rb - ra, cur: ra, prev: rb, size: a.tot.outs, prevSize: b.tot.outs });
      }
    }
  }
  bats.sort((a, b) => b.d - a.d);
  pits.sort((a, b) => b.d - a.d);
  return { year: Y, bats: bats.slice(0, n), pits: pits.slice(0, n), coverage: H.seasons[Y].coverage };
}
