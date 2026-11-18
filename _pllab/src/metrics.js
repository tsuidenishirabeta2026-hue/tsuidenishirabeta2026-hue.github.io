// 指標計算モジュール（純粋関数のみ。丸めは行わず、表示側 format.js で行う）
//
// 値の表現:
//   計算結果は { v: number } か { v: null, why: 'nodata' | 'zero' } を返す。
//   'nodata' = 必要な元データが取得できていない（CSV の空欄）
//   'zero'   = 分母が 0 のため算出不可

export const NODATA = 'nodata';
export const ZERO = 'zero';

const ok = (v) => ({ v });
const nd = () => ({ v: null, why: NODATA });
const zd = () => ({ v: null, why: ZERO });

/** 数値として使える値か（null/undefined/NaN は「データなし」） */
export function has(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function allHave(...xs) {
  return xs.every(has);
}

function ratio(num, den) {
  if (!allHave(num, den)) return nd();
  if (den === 0) return zd();
  return ok(num / den);
}

// ---------------------------------------------------------------------------
// 投球回
// ---------------------------------------------------------------------------

/**
 * 投球回の表記（"123.1" = 123回1/3, "45.2" = 45回2/3）をアウト数に変換する。
 * 小数第1位は 0/1/2 のみ許可。"0.1" を 0.1 回として扱ってはいけない。
 * @returns {number|null} アウト数。空欄は null。形式不正は例外。
 */
export function ipToOuts(ip) {
  if (ip === null || ip === undefined) return null;
  const s = String(ip).trim();
  if (s === '') return null;
  const m = /^(\d+)(?:\.(\d))?$/.exec(s);
  if (!m) throw new Error(`投球回の形式が不正です: "${s}"`);
  const whole = Number(m[1]);
  const frac = m[2] === undefined ? 0 : Number(m[2]);
  if (frac > 2) throw new Error(`投球回の端数は .0/.1/.2 のみです: "${s}"`);
  return whole * 3 + frac;
}

/** アウト数を投球回の表記へ（370 -> "123.1"） */
export function outsToIp(outs) {
  if (!has(outs)) return null;
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/** アウト数を日本式表記へ（370 -> "123 1/3"） */
export function outsToIpJa(outs) {
  if (!has(outs)) return null;
  const w = Math.floor(outs / 3);
  const r = outs % 3;
  return r === 0 ? `${w}` : `${w} ${r}/3`;
}

// ---------------------------------------------------------------------------
// 打撃指標
// ---------------------------------------------------------------------------

/** 単打 = 安打 - 二塁打 - 三塁打 - 本塁打 */
export function singles(b) {
  if (!allHave(b.H, b.D, b.T, b.HR)) return null;
  return b.H - b.D - b.T - b.HR;
}

/** 塁打 = 単打 + 2×二塁打 + 3×三塁打 + 4×本塁打 */
export function totalBases(b) {
  const s = singles(b);
  if (s === null) return null;
  return s + 2 * b.D + 3 * b.T + 4 * b.HR;
}

/** 打率 = 安打 / 打数 */
export function avg(b) {
  return ratio(b.H, b.AB);
}

/**
 * 出塁率 = (安打 + 四球 + 死球) / (打数 + 四球 + 死球 + 犠飛)
 * 公認野球規則 9.05 に基づく。四球には故意四球を含む。犠打は分母に含めない。
 * 犠飛が取得できない場合は正確に算出できないため「データなし」とする。
 */
export function obp(b) {
  if (!allHave(b.H, b.BB, b.HBP, b.AB, b.SF)) return nd();
  return ratio(b.H + b.BB + b.HBP, b.AB + b.BB + b.HBP + b.SF);
}

/** 長打率 = 塁打 / 打数 */
export function slg(b) {
  const tb = totalBases(b);
  if (tb === null) return nd();
  return ratio(tb, b.AB);
}

/** OPS = 出塁率 + 長打率（丸める前の値同士を加算） */
export function ops(b) {
  const o = obp(b);
  const s = slg(b);
  if (o.v === null) return o;
  if (s.v === null) return s;
  return ok(o.v + s.v);
}

/** ISO（純長打率）= 長打率 - 打率 */
export function iso(b) {
  const s = slg(b);
  const a = avg(b);
  if (s.v === null) return s;
  if (a.v === null) return a;
  return ok(s.v - a.v);
}

/** 三振率（打席あたり）= 三振 / 打席 */
export function kPct(b) {
  return ratio(b.SO, b.PA);
}

/** 四球率（打席あたり）= 四球 / 打席 */
export function bbPct(b) {
  return ratio(b.BB, b.PA);
}

/** 本塁打率（打席あたり）= 本塁打 / 打席 */
export function hrPerPa(b) {
  return ratio(b.HR, b.PA);
}

/** 盗塁成功率 = 盗塁 / (盗塁 + 盗塁死) */
export function sbPct(b) {
  if (!allHave(b.SB, b.CS)) return nd();
  return ratio(b.SB, b.SB + b.CS);
}

/**
 * BABIP = (安打 - 本塁打) / (打数 - 三振 - 本塁打 + 犠飛)
 * 打球がフェアゾーンに飛んだ時の安打割合。運の影響も大きい指標。
 */
export function babip(b) {
  if (!allHave(b.H, b.HR, b.AB, b.SO, b.SF)) return nd();
  return ratio(b.H - b.HR, b.AB - b.SO - b.HR + b.SF);
}

// ---------------------------------------------------------------------------
// 投手指標（すべてアウト数ベース。outs = 投球回をアウト数に換算した値）
// ---------------------------------------------------------------------------

/** 防御率 = 自責点 × 9 / 投球回 = 自責点 × 27 / アウト数 */
export function era(p) {
  if (!allHave(p.ER, p.outs)) return nd();
  return ratio(p.ER * 27, p.outs);
}

/** WHIP = (与四球 + 被安打) / 投球回 = (与四球 + 被安打) × 3 / アウト数（死球は含めない） */
export function whip(p) {
  if (!allHave(p.BB, p.H, p.outs)) return nd();
  return ratio((p.BB + p.H) * 3, p.outs);
}

/** 奪三振率（9イニングあたり）= 奪三振 × 27 / アウト数 */
export function k9(p) {
  if (!allHave(p.SO, p.outs)) return nd();
  return ratio(p.SO * 27, p.outs);
}

/** 与四球率（9イニングあたり）= 与四球 × 27 / アウト数 */
export function bb9(p) {
  if (!allHave(p.BB, p.outs)) return nd();
  return ratio(p.BB * 27, p.outs);
}

/** 被本塁打率（9イニングあたり）= 被本塁打 × 27 / アウト数 */
export function hr9(p) {
  if (!allHave(p.HR, p.outs)) return nd();
  return ratio(p.HR * 27, p.outs);
}

/** K/BB = 奪三振 / 与四球 */
export function kbb(p) {
  return ratio(p.SO, p.BB);
}

/** 投手の奪三振割合（対戦打者あたり）= 奪三振 / 打者 */
export function pKPct(p) {
  return ratio(p.SO, p.BF);
}

/** 投手の与四球割合（対戦打者あたり）= 与四球 / 打者 */
export function pBBPct(p) {
  return ratio(p.BB, p.BF);
}

// ---------------------------------------------------------------------------
// 合計（リーグ平均・チーム合計は「平均の平均」ではなく元の合計値から計算する）
// ---------------------------------------------------------------------------

export const BAT_COUNT_KEYS = ['G', 'PA', 'AB', 'R', 'H', 'D', 'T', 'HR', 'RBI', 'SB', 'CS', 'BB', 'IBB', 'HBP', 'SO', 'SH', 'SF', 'GDP'];
export const PIT_COUNT_KEYS = ['G', 'GS', 'W', 'L', 'HLD', 'SV', 'outs', 'BF', 'H', 'HR', 'BB', 'HBP', 'SO', 'R', 'ER'];

/**
 * 複数行の計数を合計する。1行でも欠損がある項目は、合計も「データなし」(null) とする
 * （欠損を 0 とみなして合計すると、実態より小さい値になるため）。
 */
export function sumRows(rows, keys) {
  const out = {};
  for (const k of keys) {
    let total = 0;
    let missing = rows.length === 0;
    for (const r of rows) {
      if (!has(r[k])) {
        missing = true;
        break;
      }
      total += r[k];
    }
    out[k] = missing ? null : total;
  }
  return out;
}

/** 打撃の主要指標をまとめて計算 */
export function battingRates(b) {
  return {
    AVG: avg(b),
    OBP: obp(b),
    SLG: slg(b),
    OPS: ops(b),
    ISO: iso(b),
    KPCT: kPct(b),
    BBPCT: bbPct(b),
    HRPA: hrPerPa(b),
    SBPCT: sbPct(b),
    BABIP: babip(b),
  };
}

/** 投手の主要指標をまとめて計算 */
export function pitchingRates(p) {
  return {
    ERA: era(p),
    WHIP: whip(p),
    K9: k9(p),
    BB9: bb9(p),
    HR9: hr9(p),
    KBB: kbb(p),
    KPCT: pKPct(p),
    BBPCT: pBBPct(p),
  };
}

// ---------------------------------------------------------------------------
// 規定打席・規定投球回・順位
// ---------------------------------------------------------------------------

/**
 * 規定打席 = 所属球団の試合数 × 3.1（公認野球規則 9.22、NPB は「行なった試合数」で適用）
 * 端数は四捨五入（9.22 原注に準拠）。浮動小数誤差を避けるため整数演算で行う。
 */
export function qualifyingPA(teamGames) {
  if (!has(teamGames)) return null;
  return Math.floor((teamGames * 31 + 5) / 10);
}

/** 規定投球回（アウト数）= 所属球団の試合数 × 1.0 回 = 試合数 × 3 アウト */
export function qualifyingOuts(teamGames) {
  if (!has(teamGames)) return null;
  return teamGames * 3;
}

/** 勝率 = 勝利 / (勝利 + 敗戦)（引き分けは除く） */
export function winPct(t) {
  return ratio(t.W, t.W + t.L);
}

/** ゲーム差 = ((上位の勝利 - 下位の勝利) + (下位の敗戦 - 上位の敗戦)) / 2 */
export function gamesBehind(leader, t) {
  return ((leader.W - t.W) + (t.L - leader.L)) / 2;
}
