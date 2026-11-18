// ルールベースの分析文生成。
//
// 方針:
// - 各文に「種類」を付ける: 事実（記録そのもの）/ 計算（記録から計算した値・比較）/ 解釈（数字から読み取れる傾向）/ 注意
// - 各文に根拠（数値・対象期間・比較対象）を添える
// - 判定のしきい値はすべてこのファイルの RULES に明記し、サイトの「分析の方法」ページにも表示する
// - 故障・性格・努力・フォームなど、成績データから分からないことには触れない
// - 将来の成績を予測・保証する表現は使わない
import { has, outsToIp } from './metrics.js';
import { lastNBat, lastNPit, comparisonGroup, rankIn, monthlyBat, splitRows, teamRank, lastLogDate } from './model.js';
import { rate3, fixed, pct, plain, signed, dateShort } from './format.js';

/** 本人の最終出場がリーグの最終記録日より大きく前なら注意書きを返す */
function gapNote(S, lastDate, word) {
  const end = lastLogDate(S);
  if (!end || !lastDate) return null;
  const days = Math.round((Date.parse(end) - Date.parse(lastDate)) / 86400000);
  if (days < 14) return null;
  return item('注意', `本人の最後の${word}は${dateShort(lastDate)}で、それ以降（リーグの試合記録がある${dateShort(end)}まで）${word}記録がありません。以下の「直近」はその時点までの成績です。`, `出場がない理由は成績データからは分からないため、推測しません`);
}

export const RULES = {
  bat: {
    // [指標, 良いと判定する差, 悪いと判定する差, 大きいほど良いか]
    OPS: { good: 0.06, bad: -0.06, higher: true, label: 'OPS' },
    AVG: { good: 0.025, bad: -0.025, higher: true, label: '打率' },
    OBP: { good: 0.03, bad: -0.03, higher: true, label: '出塁率' },
    ISO: { good: 0.04, bad: -0.04, higher: true, label: 'ISO（純長打率）' },
    BBPCT: { good: 0.025, bad: -0.025, higher: true, label: '四球率' },
    KPCT: { good: -0.04, bad: 0.05, higher: false, label: '三振率' },
  },
  pit: {
    ERA: { good: -0.6, bad: 0.8, higher: false, label: '防御率' },
    WHIP: { good: -0.12, bad: 0.15, higher: false, label: 'WHIP' },
    K9: { good: 1.5, bad: -1.5, higher: true, label: '奪三振率' },
    BB9: { good: -0.8, bad: 0.8, higher: false, label: '与四球率' },
    HR9: { good: -0.3, bad: 0.35, higher: false, label: '被本塁打率' },
    KBB: { good: 1.0, bad: -0.8, higher: true, label: 'K/BB' },
  },
  recentGames: { bat: 10, pitSP: 5, pitRP: 10 },
  recentDiffOPS: 0.1,
  recentDiffERA: 1.5,
  recentMinPA: 20,
  recentMinOuts: 15,
};

const F = {
  OPS: (x) => plain(rate3, x),
  AVG: (x) => plain(rate3, x),
  OBP: (x) => plain(rate3, x),
  SLG: (x) => plain(rate3, x),
  ISO: (x) => plain(rate3, x),
  BABIP: (x) => plain(rate3, x),
  BBPCT: (x) => plain(pct, x),
  KPCT: (x) => plain(pct, x),
  ERA: (x) => plain(fixed, x, 2),
  WHIP: (x) => plain(fixed, x, 2),
  K9: (x) => plain(fixed, x, 2),
  BB9: (x) => plain(fixed, x, 2),
  HR9: (x) => plain(fixed, x, 2),
  KBB: (x) => plain(fixed, x, 2),
};
const diffText = (key, d) => {
  if (['BBPCT', 'KPCT'].includes(key)) return `${d > 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}ポイント`;
  if (['ERA', 'WHIP', 'K9', 'BB9', 'HR9', 'KBB'].includes(key)) return signed(d, 2, false);
  return signed(d, 3);
};

const item = (kind, text, basis) => ({ kind, text, basis });

function compareToLeague(rates, lg, rules) {
  const goods = [];
  const bads = [];
  for (const [key, r] of Object.entries(rules)) {
    const a = rates[key]?.v;
    const b = lg[key]?.v;
    if (!has(a) || !has(b)) continue;
    const d = a - b;
    const score = r.higher ? d / Math.abs(r.good) : -d / Math.abs(r.good);
    if (r.higher ? d >= r.good : d <= r.good) goods.push({ key, r, a, b, d, score });
    else if (r.higher ? d <= r.bad : d >= r.bad) bads.push({ key, r, a, b, d, score: -score });
  }
  goods.sort((x, y) => y.score - x.score);
  bads.sort((x, y) => y.score - x.score);
  return { goods, bads };
}

function sampleNoteBat(PA, th) {
  if (!has(PA) || PA === 0) return item('注意', '今季は打席に立った記録がありません。', '');
  if (PA < th.smallSamplePA) return item('注意', `今季は${PA}打席と少なく、1本の安打や四球で率が大きく動きます。以下は参考値として読んでください。`, `目安: ${th.smallSamplePA}打席未満を「サンプル少」としています`);
  return null;
}
function sampleNotePit(outs, th) {
  if (!has(outs) || outs === 0) return item('注意', '今季は登板記録がありません。', '');
  if (outs < th.smallSampleOuts) return item('注意', `今季の投球回は${outsToIp(outs)}回と少なく、1試合の結果で率が大きく動きます。以下は参考値として読んでください。`, `目安: ${th.smallSampleOuts / 3}投球回未満を「サンプル少」としています`);
  return null;
}

// ---------------------------------------------------------------------------
// 打者

export function analyzeBatter(S, p, th) {
  const season = S.meta.season;
  const period = `${season}年シーズン（${dateShort(S.meta.as_of_date)}時点）`;
  const out = { type: [], strengths: [], weaknesses: [], recent: [], watch: [], note: null };
  const b = p.bat;
  if (!b || !has(b.PA) || b.PA === 0) {
    out.note = sampleNoteBat(0, th);
    return out;
  }
  out.note = sampleNoteBat(b.PA, th);
  const small = b.PA < th.smallSamplePA;
  const R = p.batRates;
  const L = S.league.batRates;
  const basisLg = (k) => `${period}。本人 ${F[k](R[k])}／リーグ平均 ${F[k](L[k])}（${b.PA}打席）`;

  // 1. タイプ
  if (small) {
    out.type.push(item('注意', 'サンプルが少ないため、打撃タイプの判定は行っていません。', `${b.PA}打席`));
  } else {
    const tags = [];
    const iso = R.ISO.v;
    const lgIso = L.ISO.v;
    if (has(iso) && has(lgIso) && iso >= lgIso + 0.04) tags.push({ t: '長打力', basis: `ISO ${F.ISO(R.ISO)}（リーグ平均 ${F.ISO(L.ISO)}）、本塁打 ${b.HR}` });
    if (has(R.BBPCT.v) && R.BBPCT.v >= L.BBPCT.v + 0.025) tags.push({ t: '選球眼（四球を選ぶ力）', basis: `四球率 ${F.BBPCT(R.BBPCT)}（リーグ平均 ${F.BBPCT(L.BBPCT)}）` });
    if (has(R.KPCT.v) && R.KPCT.v <= L.KPCT.v - 0.04 && has(R.AVG.v) && R.AVG.v >= L.AVG.v) tags.push({ t: 'ミート力（三振の少なさ）', basis: `三振率 ${F.KPCT(R.KPCT)}（リーグ平均 ${F.KPCT(L.KPCT)}）、打率 ${F.AVG(R.AVG)}` });
    if (has(b.SB) && (b.SB >= 15 || (b.SB >= 8 && b.SB / b.PA >= (S.league.bat.SB / S.league.bat.PA) * 2.5))) tags.push({ t: '走力（盗塁）', basis: `盗塁 ${b.SB}${has(b.CS) ? `、盗塁死 ${b.CS}` : ''}` });
    if (tags.length === 0) {
      out.type.push(item('解釈', '長打・四球・三振の少なさ・盗塁のいずれも、リーグ平均から大きく偏っていない打者です。', `${period}。ISO ${F.ISO(R.ISO)}、四球率 ${F.BBPCT(R.BBPCT)}、三振率 ${F.KPCT(R.KPCT)}（いずれもリーグ平均との差がしきい値未満）`));
    } else {
      const names = tags.slice(0, 2).map((x) => x.t);
      out.type.push(item('解釈', `${names.join('と')}が数字に表れているタイプの${p.info.position}です。`, `${period}。${tags.slice(0, 2).map((x) => x.basis).join('／')}`));
    }
    out.type.push(item('事実', `${b.PA}打席で打率${F.AVG(R.AVG)}、${b.HR}本塁打、${b.RBI}打点${p.qualifiedBat ? '（規定打席到達）' : `（規定打席 ${p.qPA} に未到達）`}。`, period));
  }

  // 2・3. 強みと課題
  const { goods, bads } = compareToLeague(R, L, RULES.bat);
  for (const g of goods.slice(0, 3)) out.strengths.push(item('計算', `${g.r.label}がリーグ平均を${g.r.higher ? '上回って' : '下回って（良い方向）'}います（差 ${diffText(g.key, g.d)}）。`, basisLg(g.key)));
  if (has(b.SB) && has(b.CS) && b.SB + b.CS >= 10 && b.SB / (b.SB + b.CS) >= 0.75) {
    out.strengths.push(item('計算', `盗塁成功率が${pct({ v: b.SB / (b.SB + b.CS) })}と高い水準です。`, `${period}。盗塁 ${b.SB}、盗塁死 ${b.CS}（成功率75%以上を目安）`));
  }
  if (!out.strengths.length) out.strengths.push(item('計算', 'リーグ平均を明確に上回る打撃指標は見当たりません。', `${period}。判定基準は「分析の方法」を参照`));
  for (const g of bads.slice(0, 3)) out.weaknesses.push(item('計算', `${g.r.label}がリーグ平均より${g.r.higher ? '低く' : '高く'}なっています（差 ${diffText(g.key, g.d)}）。`, basisLg(g.key)));
  if (!out.weaknesses.length) out.weaknesses.push(item('計算', 'リーグ平均を明確に下回る打撃指標は見当たりません。', `${period}。判定基準は「分析の方法」を参照`));
  if (small) {
    // サンプルが少ないときは平均との比較で強み・課題を判定しない（偶然の影響が大きいため）
    const facts = item('事実', `${b.PA}打席で${b.H}安打、${b.HR}本塁打、${b.BB}四球、${b.SO}三振。`, period);
    out.strengths = [item('注意', 'サンプルが少ないため、強みの判定は行っていません。', `${b.PA}打席（目安 ${th.smallSamplePA}打席以上）`), facts];
    out.weaknesses = [item('注意', 'サンプルが少ないため、課題の判定は行っていません。', `${b.PA}打席（目安 ${th.smallSamplePA}打席以上）`)];
  }

  // 4. 最近の状態
  if (!S.hasBatLogs) {
    out.recent.push(item('注意', '試合別の成績データがないため、最近の状態は判定していません。', ''));
  } else {
    const r = lastNBat(p, RULES.recentGames.bat);
    if (!r) out.recent.push(item('事実', '試合別の出場記録がありません。', ''));
    else {
      const gap = gapNote(S, r.to, '出場');
      if (gap) out.recent.push(gap);
      const per = `直近${r.games}試合（${dateShort(r.from)}〜${dateShort(r.to)}、${r.tot.PA}打席）`;
      out.recent.push(item('事実', `${per}は打率${F.AVG(r.rates.AVG)}、OPS ${F.OPS(r.rates.OPS)}、本塁打${r.tot.HR}。`, `本人の出場試合ベース。シーズン通算OPS ${F.OPS(R.OPS)}`));
      if (r.tot.PA < RULES.recentMinPA) {
        out.recent.push(item('注意', `直近の打席数が${r.tot.PA}と少ないため、好不調の判定は行っていません。`, `目安: ${RULES.recentMinPA}打席以上`));
      } else if (has(r.rates.OPS.v) && has(R.OPS.v)) {
        const d = r.rates.OPS.v - R.OPS.v;
        const txt = d >= RULES.recentDiffOPS ? 'シーズン通算より高いOPSを記録しており、数字の上では上向きです。' : d <= -RULES.recentDiffOPS ? 'シーズン通算よりOPSが低く、数字の上では落ち込んでいます。' : 'シーズン通算と大きな差はありません。';
        out.recent.push(item('解釈', txt, `直近OPS − 通算OPS = ${signed(d)}（判定の目安 ±${RULES.recentDiffOPS.toFixed(3).slice(1)}）`));
      }
    }
  }

  // 5. 注目ポイント
  watchBatter(S, p, th, out, period);
  return out;
}

function watchBatter(S, p, th, out, period) {
  const b = p.bat;
  const R = p.batRates;
  const L = S.league.batRates;
  const phase = S.meta.phase;
  if (phase === 'regular' && !p.qualifiedBat && has(b.PA) && p.qPA && b.PA >= p.qPA * 0.8) {
    out.watch.push(item('計算', `規定打席（${p.qPA}）まで残り${p.qPA - b.PA}打席です。到達すれば打撃ランキングの対象になります。`, `${period}。規定打席 = 所属球団の試合数 × 3.1`));
  }
  if (has(b.PA) && b.PA >= 150 && has(R.BABIP.v) && has(L.BABIP.v)) {
    const d = R.BABIP.v - L.BABIP.v;
    if (Math.abs(d) >= 0.04) {
      out.watch.push(item('解釈', `BABIP（本塁打以外の打球が安打になった割合）が${F.BABIP(R.BABIP)}とリーグ平均（${F.BABIP(L.BABIP)}）より${d > 0 ? '高め' : '低め'}です。BABIPは打球の質だけでなく偶然の影響も受けやすいため、打率が今後どう推移するかに注目したいところです。`, `${period}。BABIP = (安打−本塁打) ÷ (打数−三振−本塁打+犠飛)`));
    }
  }
  const sp = splitRows(p).bat;
  const vl = sp.find((s) => s.split === 'vs_lhp');
  const vr = sp.find((s) => s.split === 'vs_rhp');
  if (vl && vr && vl.PA >= 40 && vr.PA >= 40 && has(vl.rates.OPS.v) && has(vr.rates.OPS.v)) {
    const d = vl.rates.OPS.v - vr.rates.OPS.v;
    if (Math.abs(d) >= 0.15) {
      out.watch.push(item('計算', `対${d > 0 ? '左' : '右'}投手の方が成績が良く、OPSの差は${signed(Math.abs(d)).slice(1)}あります。苦手な側の投手との対戦結果に注目したいところです。`, `${period}。対左 OPS ${F.OPS(vl.rates.OPS)}（${vl.PA}打席）／対右 OPS ${F.OPS(vr.rates.OPS)}（${vr.PA}打席）`));
    }
  }
  const risp = sp.find((s) => s.split === 'risp');
  if (risp && risp.PA >= 40 && has(risp.rates.OPS.v) && has(R.OPS.v)) {
    const d = risp.rates.OPS.v - R.OPS.v;
    if (Math.abs(d) >= 0.1) out.watch.push(item('計算', `得点圏ではOPSが通算より${d > 0 ? '高く' : '低く'}なっています（差 ${signed(d)}）。得点圏の成績は年によって変動しやすいとされる点にも留意が必要です。`, `${period}。得点圏 OPS ${F.OPS(risp.rates.OPS)}（${risp.PA}打席）`));
  }
  if (has(R.KPCT.v) && R.KPCT.v >= L.KPCT.v + 0.05 && b.PA >= th.smallSamplePA) {
    out.watch.push(item('計算', `三振率（${F.KPCT(R.KPCT)}）がリーグ平均より高く、この数字の推移が成績を左右するポイントになりそうです。`, `${period}。リーグ平均 ${F.KPCT(L.KPCT)}`));
  }
  if (!out.watch.length) {
    out.watch.push(item('解釈', phase === 'offseason' ? '来季も今季と同じ傾向が数字に表れるかを、主要指標（OPS・三振率・四球率）で確認していきたいところです。' : '主要指標（OPS・三振率・四球率）がこのままの水準で推移するかに注目したいところです。', period));
  }
  out.watch = out.watch.slice(0, 3);
}

// ---------------------------------------------------------------------------
// 投手

export function fip(p, lgPit, lgERA) {
  // FIP = (13×被本塁打 + 3×(与四球+与死球) − 2×奪三振) ÷ 投球回 + 定数
  // 定数 = リーグ防御率 − (13×リーグ被本塁打 + 3×(リーグ与四球+与死球) − 2×リーグ奪三振) ÷ リーグ投球回
  const ok = (o) => [o.HR, o.BB, o.HBP, o.SO, o.outs].every(has) && o.outs > 0;
  if (!ok(p) || !ok(lgPit) || !has(lgERA)) return null;
  const core = (o) => ((13 * o.HR + 3 * (o.BB + o.HBP) - 2 * o.SO) * 3) / o.outs;
  return core(p) + (lgERA - core(lgPit));
}

export function analyzePitcher(S, p, th) {
  const season = S.meta.season;
  const period = `${season}年シーズン（${dateShort(S.meta.as_of_date)}時点）`;
  const out = { type: [], strengths: [], weaknesses: [], recent: [], watch: [], note: null };
  const t = p.pit;
  if (!t || !has(t.outs) || t.outs === 0) {
    out.note = sampleNotePit(0, th);
    return out;
  }
  out.note = sampleNotePit(t.outs, th);
  const small = t.outs < th.smallSampleOuts;
  const R = p.pitRates;
  const group = comparisonGroup(S, p, th);
  const L = S.league.pitRates;
  const ipText = `${outsToIp(t.outs)}回`;
  const basisLg = (k) => `${period}。本人 ${F[k](R[k])}／リーグ平均 ${F[k](L[k])}（${ipText}）`;

  // 1. タイプ
  const roleText = p.role === '先発' ? '先発' : p.role === '救援' ? (has(t.SV) && t.SV >= 10 ? '抑え' : has(t.HLD) && t.HLD >= 10 ? 'セットアッパー' : '救援') : '投手';
  out.type.push(item('事実', `${t.G}試合に登板（うち先発${t.GS}）。役割は主に${roleText}です。`, `${period}。先発が登板の半数以上なら「先発」、セーブ10以上で「抑え」、ホールド10以上で「セットアッパー」と表記`));
  if (small) out.type.push(item('注意', 'サンプルが少ないため、投球タイプの判定は行っていません。', ipText));
  else {
    const tags = [];
    if (has(R.K9.v) && R.K9.v >= L.K9.v + 1.5) tags.push({ t: '三振を多く奪う', basis: `奪三振率 ${F.K9(R.K9)}（リーグ平均 ${F.K9(L.K9)}）` });
    if (has(R.BB9.v) && R.BB9.v <= L.BB9.v - 0.8) tags.push({ t: '四球が少ない', basis: `与四球率 ${F.BB9(R.BB9)}（リーグ平均 ${F.BB9(L.BB9)}）` });
    if (has(R.K9.v) && R.K9.v <= L.K9.v - 1.5) tags.push({ t: '三振以外のアウトが多い（打たせて取る）', basis: `奪三振率 ${F.K9(R.K9)}（リーグ平均 ${F.K9(L.K9)}）` });
    if (has(R.HR9.v) && R.HR9.v <= L.HR9.v - 0.3) tags.push({ t: '本塁打を打たれにくい', basis: `被本塁打率 ${F.HR9(R.HR9)}（リーグ平均 ${F.HR9(L.HR9)}）` });
    if (tags.length) out.type.push(item('解釈', `数字の上では「${tags.slice(0, 2).map((x) => x.t).join('」「')}」タイプの${roleText}投手です。`, `${period}。${tags.slice(0, 2).map((x) => x.basis).join('／')}`));
    else out.type.push(item('解釈', '奪三振・与四球・被本塁打のいずれも、リーグ平均から大きく偏っていない投手です。', `${period}。奪三振率 ${F.K9(R.K9)}、与四球率 ${F.BB9(R.BB9)}、被本塁打率 ${F.HR9(R.HR9)}`));
  }

  // 2・3
  const { goods, bads } = compareToLeague(R, L, RULES.pit);
  for (const g of goods.slice(0, 3)) out.strengths.push(item('計算', `${g.r.label}がリーグ平均より${g.r.higher ? '高く' : '低く'}、良い水準です（差 ${diffText(g.key, g.d)}）。`, basisLg(g.key)));
  if (!out.strengths.length) out.strengths.push(item('計算', 'リーグ平均を明確に上回る投球指標は見当たりません。', `${period}。判定基準は「分析の方法」を参照`));
  for (const g of bads.slice(0, 3)) out.weaknesses.push(item('計算', `${g.r.label}がリーグ平均より${g.r.higher ? '低く' : '高く'}なっています（差 ${diffText(g.key, g.d)}）。`, basisLg(g.key)));
  if (!out.weaknesses.length) out.weaknesses.push(item('計算', 'リーグ平均を明確に下回る投球指標は見当たりません。', `${period}。判定基準は「分析の方法」を参照`));
  if (small) {
    const facts = item('事実', `${ipText}で被安打${t.H}、与四球${t.BB}、奪三振${t.SO}、自責点${t.ER}。`, period);
    out.strengths = [item('注意', 'サンプルが少ないため、強みの判定は行っていません。', `${ipText}（目安 ${th.smallSampleOuts / 3}投球回以上）`), facts];
    out.weaknesses = [item('注意', 'サンプルが少ないため、課題の判定は行っていません。', `${ipText}（目安 ${th.smallSampleOuts / 3}投球回以上）`)];
  }

  if (group && group.members.length >= 5) {
    const r = rankIn(group.members, (m) => m.pitRates.ERA.v, R.ERA.v, false);
    const inGroup = group.members.some((m) => m.id === p.id);
    if (r && inGroup) out.type.push(item('計算', `防御率は${group.label}の中で${r.of}人中${r.rank}位です。`, `${period}。比較対象: ${group.label}`));
  }

  // 4
  if (!S.hasPitLogs) out.recent.push(item('注意', '試合別の成績データがないため、最近の状態は判定していません。', ''));
  else {
    const n = p.role === '先発' ? RULES.recentGames.pitSP : RULES.recentGames.pitRP;
    const r = lastNPit(p, n);
    if (!r) out.recent.push(item('事実', '試合別の登板記録がありません。', ''));
    else {
      const gap = gapNote(S, r.to, '登板');
      if (gap) out.recent.push(gap);
      const per = `直近${r.games}登板（${dateShort(r.from)}〜${dateShort(r.to)}、${outsToIp(r.tot.outs)}回）`;
      out.recent.push(item('事実', `${per}は防御率${F.ERA(r.rates.ERA)}、WHIP ${F.WHIP(r.rates.WHIP)}、奪三振${r.tot.SO}。`, `シーズン通算 防御率${F.ERA(R.ERA)}、WHIP ${F.WHIP(R.WHIP)}`));
      if (r.tot.outs < RULES.recentMinOuts) out.recent.push(item('注意', `直近の投球回が${outsToIp(r.tot.outs)}回と少ないため、好不調の判定は行っていません。`, `目安: ${RULES.recentMinOuts / 3}投球回以上`));
      else if (has(r.rates.ERA.v) && has(R.ERA.v)) {
        const d = r.rates.ERA.v - R.ERA.v;
        const txt = d <= -RULES.recentDiffERA ? 'シーズン通算より失点が少なく、数字の上では好調です。' : d >= RULES.recentDiffERA ? 'シーズン通算より失点が多く、数字の上では苦しい内容です。' : 'シーズン通算と大きな差はありません。';
        out.recent.push(item('解釈', txt, `直近防御率 − 通算防御率 = ${signed(d, 2, false)}（判定の目安 ±${RULES.recentDiffERA.toFixed(2)}）`));
      }
    }
  }

  // 5
  const f = fip(t, S.league.pit, L.ERA.v);
  if (f !== null && t.outs >= 90 && has(R.ERA.v) && Math.abs(R.ERA.v - f) >= 0.75) {
    out.watch.push(item('計算', `被本塁打・与四死球・奪三振だけから計算した値（FIP ${f.toFixed(2)}）と実際の防御率（${F.ERA(R.ERA)}）に差があります。守備や打球の結果など投手以外の要素も含めて、防御率が今後どちらに近づくかに注目したいところです。`, `${period}。FIP = (13×被本塁打 + 3×(与四球+与死球) − 2×奪三振) ÷ 投球回 + リーグ定数。定数はリーグ合計から算出`));
  }
  if (S.meta.phase === 'regular' && !p.qualifiedPit && p.role === '先発' && p.qOuts && t.outs >= p.qOuts * 0.8) {
    out.watch.push(item('計算', `規定投球回（${outsToIp(p.qOuts)}回）まで残り${outsToIp(p.qOuts - t.outs)}回です。`, `${period}。規定投球回 = 所属球団の試合数 × 1.0`));
  }
  const sp = splitRows(p).pit;
  const vl = sp.find((s) => s.split === 'vs_lhb');
  const vr = sp.find((s) => s.split === 'vs_rhb');
  if (vl && vr && vl.BF >= 40 && vr.BF >= 40 && has(vl.rates.AVG.v) && has(vr.rates.AVG.v)) {
    const d = vl.rates.AVG.v - vr.rates.AVG.v;
    if (Math.abs(d) >= 0.05) out.watch.push(item('計算', `対${d > 0 ? '左' : '右'}打者の被打率が高く、左右で差があります（差 ${signed(Math.abs(d)).slice(1)}）。`, `${period}。対左 被打率${F.AVG(vl.rates.AVG)}（${vl.BF}打者）／対右 被打率${F.AVG(vr.rates.AVG)}（${vr.BF}打者）`));
  }
  if (!out.watch.length) out.watch.push(item('解釈', S.meta.phase === 'offseason' ? '来季も奪三振率・与四球率が今季と同じ水準を保てるかを確認していきたいところです。' : '奪三振率・与四球率がこのままの水準で推移するかに注目したいところです。', period));
  out.watch = out.watch.slice(0, 3);
  return out;
}

// ---------------------------------------------------------------------------
// 球団

export function analyzeTeam(S, tid) {
  const T = S.teamStats[tid];
  const period = `${S.meta.season}年シーズン（${dateShort(S.meta.as_of_date)}時点）`;
  const metrics = [
    { label: '1試合あたり得点', get: (x) => (has(x.standing.RS) && x.standing.G ? x.standing.RS / x.standing.G : null), higher: true, fmt: (v) => v.toFixed(2) },
    { label: '1試合あたり失点', get: (x) => (has(x.standing.RA) && x.standing.G ? x.standing.RA / x.standing.G : null), higher: false, fmt: (v) => v.toFixed(2) },
    { label: 'チームOPS', get: (x) => x.batRates.OPS.v, higher: true, fmt: (v) => plain(rate3, { v }) },
    { label: 'チーム本塁打', get: (x) => x.bat.HR, higher: true, fmt: (v) => String(v) },
    { label: 'チーム盗塁', get: (x) => x.bat.SB, higher: true, fmt: (v) => String(v) },
    { label: 'チーム四球率（打撃）', get: (x) => x.batRates.BBPCT.v, higher: true, fmt: (v) => plain(pct, { v }) },
    { label: 'チーム三振率（打撃）', get: (x) => x.batRates.KPCT.v, higher: false, fmt: (v) => plain(pct, { v }) },
    { label: 'チーム防御率', get: (x) => x.pitRates.ERA.v, higher: false, fmt: (v) => v.toFixed(2) },
    { label: 'チームWHIP', get: (x) => x.pitRates.WHIP.v, higher: false, fmt: (v) => v.toFixed(2) },
    { label: '奪三振率（投手）', get: (x) => x.pitRates.K9.v, higher: true, fmt: (v) => v.toFixed(2) },
    { label: '与四球率（投手）', get: (x) => x.pitRates.BB9.v, higher: false, fmt: (v) => v.toFixed(2) },
  ];
  const strengths = [];
  const weaknesses = [];
  const table = [];
  for (const m of metrics) {
    const v = m.get(T);
    const rank = teamRank(S, m.get, tid, m.higher);
    table.push({ ...m, v, rank });
    if (rank === null) continue;
    const basis = `${period}。${m.label} ${m.fmt(v)}（リーグ6球団中${rank}位）`;
    if (rank <= 2) strengths.push(item('計算', `${m.label}がリーグ${rank}位です。`, basis));
    if (rank >= 5) weaknesses.push(item('計算', `${m.label}がリーグ${rank}位にとどまっています。`, basis));
  }
  if (!strengths.length) strengths.push(item('計算', 'リーグ上位2球団に入る主要指標はありません。', period));
  if (!weaknesses.length) weaknesses.push(item('計算', 'リーグ下位2球団に入る主要指標はありません。', period));

  // ピタゴラス勝率（得点と失点から見込まれる勝率）
  const st = T.standing;
  let pyth = null;
  if (has(st.RS) && has(st.RA) && st.RS + st.RA > 0 && st.pct.v !== null) {
    const e = 1.83;
    const exp = st.RS ** e / (st.RS ** e + st.RA ** e);
    pyth = item('計算', `得点${st.RS}・失点${st.RA}から計算した期待勝率は${plain(rate3, { v: exp })}で、実際の勝率${plain(rate3, st.pct)}との差は${signed(st.pct.v - exp)}です。${Math.abs(st.pct.v - exp) >= 0.03 ? (st.pct.v > exp ? '得失点差から見込まれるより多く勝っています（接戦での勝敗などが影響）。' : '得失点差から見込まれるほどは勝てていません（接戦での勝敗などが影響）。') : '得失点差に見合った勝敗です。'}`, `${period}。期待勝率 = 得点^1.83 ÷ (得点^1.83 + 失点^1.83)（ピタゴラス勝率）`);
  }
  return { strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 4), table, pyth };
}

export { monthlyBat };
