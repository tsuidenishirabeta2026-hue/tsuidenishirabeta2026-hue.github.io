// 表示用モデル: 保存済みデータから順位・集計・比較母集団・推移などを導出する（表示の整形は行わない）
import {
  BAT_COUNT_KEYS,
  PIT_COUNT_KEYS,
  battingRates,
  pitchingRates,
  sumRows,
  winPct,
  gamesBehind,
  qualifyingPA,
  qualifyingOuts,
  has,
} from './metrics.js';

const BAT_LOG_KEYS = ['PA', 'AB', 'R', 'H', 'D', 'T', 'HR', 'RBI', 'SB', 'BB', 'HBP', 'SO', 'SF'];
const PIT_LOG_KEYS = ['outs', 'BF', 'H', 'HR', 'BB', 'HBP', 'SO', 'ER'];
export const SPLIT_BAT_KEYS = ['PA', 'AB', 'H', 'D', 'T', 'HR', 'BB', 'HBP', 'SO', 'SF'];

/**
 * 順位表を計算する。
 * - 勝率 = 勝利 / (勝利 + 敗戦)。引き分けは勝率の計算から除く。
 * - official_rank（公式発表の順位）が入力されていれば、それを優先する。
 * - 勝率が同じ球団は、公式順位が無い限り同順位として扱い「同率」と表示する
 *   （同率時の決定方法はリーグの規定・公式発表に従うため、ここで推測しない）。
 * - ゲーム差は 1 位球団との差。
 */
export function computeStandings(rows) {
  const list = rows.map((r) => ({ ...r, pct: winPct(r), RD: has(r.RS) && has(r.RA) ? r.RS - r.RA : null }));
  const hasOfficial = list.every((r) => has(r.official_rank));
  const pctv = (r) => (r.pct.v === null ? -1 : r.pct.v);
  if (hasOfficial) {
    list.sort((a, b) => a.official_rank - b.official_rank);
    list.forEach((r) => {
      r.rank = r.official_rank;
      r.tied = false;
    });
  } else {
    list.sort((a, b) => pctv(b) - pctv(a) || a.team_id.localeCompare(b.team_id));
    list.forEach((r, i) => {
      // 勝率は分数で比較（浮動小数の誤差で同率を見逃さないため）
      const same = (x, y) => x.W * (y.W + y.L) === y.W * (x.W + x.L);
      const first = list.findIndex((x) => same(x, r));
      r.rank = first + 1;
      r.tied = list.filter((x) => same(x, r)).length > 1;
    });
  }
  const leader = list[0];
  list.forEach((r) => (r.GB = gamesBehind(leader, r)));
  return { rows: list, usesOfficialRank: hasOfficial };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function aggregateLogs(rows, keys) {
  return sumRows(rows, keys);
}

/** シーズン1つ分のモデル */
export function buildSeasonModel(d) {
  const meta = d.meta;
  const teams = new Map(d.teams.map((t) => [t.team_id, t]));
  const standings = computeStandings(d.standings);
  const teamGames = new Map(d.standings.map((s) => [s.team_id, s.G]));

  // リーグ全体（元の計数の合計から率を計算）
  const lgBat = sumRows(d.batting, BAT_COUNT_KEYS);
  const lgPit = sumRows(d.pitching, PIT_COUNT_KEYS);
  // リーグ合計の「試合」は球団の試合数の合計（選手の出場試合数の合計ではない）
  lgBat.G = lgPit.G = d.standings.reduce((a, r) => a + r.G, 0);
  const league = { bat: lgBat, pit: lgPit, batRates: battingRates(lgBat), pitRates: pitchingRates(lgPit) };

  // 球団別
  const teamStats = {};
  for (const tid of teams.keys()) {
    const b = sumRows(d.batting.filter((r) => r.team_id === tid), BAT_COUNT_KEYS);
    const p = sumRows(d.pitching.filter((r) => r.team_id === tid), PIT_COUNT_KEYS);
    const st = standings.rows.find((r) => r.team_id === tid);
    // 選手の試合数の合計はチームの試合数ではないため、順位表の試合数で置き換える
    b.G = st ? st.G : null;
    p.G = st ? st.G : null;
    teamStats[tid] = { bat: b, pit: p, batRates: battingRates(b), pitRates: pitchingRates(p), standing: st };
  }

  // 選手
  const stintsBy = groupBy(d.players, (p) => p.player_id);
  const batBy = groupBy(d.batting, (r) => r.player_id);
  const pitBy = groupBy(d.pitching, (r) => r.player_id);
  const bLogBy = groupBy(d.batting_games, (r) => r.player_id);
  const pLogBy = groupBy(d.pitching_games, (r) => r.player_id);
  const sBBy = groupBy(d.splits_batting, (r) => r.player_id);
  const sPBy = groupBy(d.splits_pitching, (r) => r.player_id);

  const players = new Map();
  for (const [pid, stints] of stintsBy) {
    const sorted = [...stints].sort((a, b) => (a.from_date || '') .localeCompare(b.from_date || ''));
    const current = sorted.find((s) => !s.to_date) || sorted[sorted.length - 1];
    const batRows = batBy.get(pid) || [];
    const pitRows = pitBy.get(pid) || [];
    const bat = batRows.length ? sumRows(batRows, BAT_COUNT_KEYS) : null;
    const pit = pitRows.length ? sumRows(pitRows, PIT_COUNT_KEYS) : null;
    // 規定は現在の所属球団の試合数で判定
    const tg = teamGames.get(current.team_id);
    const qPA = qualifyingPA(tg);
    const qOuts = qualifyingOuts(tg);
    const isPitcher = current.position === '投手';
    let role = isPitcher ? '投手' : current.position;
    if (pit && has(pit.G) && pit.G > 0 && has(pit.GS)) {
      if (pit.GS / pit.G >= 0.5) role = '先発';
      else role = '救援';
    } else if (isPitcher) role = '投手';
    const bLogs = (bLogBy.get(pid) || []).sort((a, b) => a.date.localeCompare(b.date));
    const pLogs = (pLogBy.get(pid) || []).sort((a, b) => a.date.localeCompare(b.date));
    players.set(pid, {
      id: pid,
      name: current.name,
      kana: current.name_kana,
      info: current,
      stints: sorted,
      isPitcher,
      role,
      bat,
      batRows,
      batRates: bat ? battingRates(bat) : null,
      pit,
      pitRows,
      pitRates: pit ? pitchingRates(pit) : null,
      qualifiedBat: !!(bat && has(bat.PA) && qPA !== null && bat.PA >= qPA),
      qualifiedPit: !!(pit && has(pit.outs) && qOuts !== null && pit.outs >= qOuts),
      qPA,
      qOuts,
      bLogs,
      pLogs,
      splitsBat: sBBy.get(pid) || [],
      splitsPit: sPBy.get(pid) || [],
    });
  }

  const hasBatLogs = d.batting_games.length > 0;
  const hasPitLogs = d.pitching_games.length > 0;

  return {
    meta,
    teams,
    standings,
    league,
    teamStats,
    players,
    games: [...d.games].sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || '')),
    hasBatLogs,
    hasPitLogs,
    hasSplits: d.splits_batting.length + d.splits_pitching.length > 0,
    // 取得元に個人成績が無い場合（stats_level=none）、「出場なし」と誤って表示しないために使う
    statsAvailable: meta.stats_level !== 'none',
    titles: d.titles || [],
  };
}

// ---------------------------------------------------------------------------
// 期間別

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 打撃: 直近 n 試合（本人の出場試合） */
export function lastNBat(p, n) {
  const rows = p.bLogs.slice(-n);
  if (!rows.length) return null;
  const t = aggregateLogs(rows, BAT_LOG_KEYS);
  return { games: rows.length, from: rows[0].date, to: rows[rows.length - 1].date, tot: t, rates: battingRates(t) };
}
export function lastNPit(p, n) {
  const rows = p.pLogs.slice(-n);
  if (!rows.length) return null;
  const t = aggregateLogs(rows, PIT_LOG_KEYS);
  return { games: rows.length, from: rows[0].date, to: rows[rows.length - 1].date, tot: t, rates: pitchingRates(t) };
}
/** 期間（両端含む）の集計 */
export function rangeBat(p, from, to) {
  const rows = p.bLogs.filter((r) => r.date >= from && r.date <= to);
  if (!rows.length) return null;
  const t = aggregateLogs(rows, BAT_LOG_KEYS);
  return { games: rows.length, from, to, tot: t, rates: battingRates(t) };
}
export function rangePit(p, from, to) {
  const rows = p.pLogs.filter((r) => r.date >= from && r.date <= to);
  if (!rows.length) return null;
  const t = aggregateLogs(rows, PIT_LOG_KEYS);
  return { games: rows.length, from, to, tot: t, rates: pitchingRates(t) };
}
export function monthlyBat(p) {
  const m = groupBy(p.bLogs, (r) => r.date.slice(0, 7));
  return [...m.entries()].map(([month, rows]) => {
    const t = aggregateLogs(rows, BAT_LOG_KEYS);
    return { month, games: rows.length, tot: t, rates: battingRates(t) };
  });
}
export function monthlyPit(p) {
  const m = groupBy(p.pLogs, (r) => r.date.slice(0, 7));
  return [...m.entries()].map(([month, rows]) => {
    const t = aggregateLogs(rows, PIT_LOG_KEYS);
    return { month, games: rows.length, tot: t, rates: pitchingRates(t) };
  });
}
export function splitRows(p) {
  return {
    bat: p.splitsBat.map((s) => ({ ...s, rates: battingRates(s) })),
    pit: p.splitsPit.map((s) => {
      // 被打率・被出塁率に相当する値（打者目線の率）を計算
      const asBat = { PA: s.BF, AB: s.AB, H: s.H, HR: s.HR, BB: s.BB, HBP: s.HBP, SO: s.SO };
      return { ...s, rates: { AVG: battingRates({ ...asBat, D: null, T: null, SF: null }).AVG, KPCT: battingRates(asBat).KPCT, BBPCT: battingRates(asBat).BBPCT } };
    }),
  };
}

// ---------------------------------------------------------------------------
// 好調な選手（基準日までの直近 days 日間）

/** 基準日以前で、試合別記録がある最後の日 */
export function lastLogDate(S) {
  if (S._lastLog !== undefined) return S._lastLog;
  let to = null;
  for (const p of S.players.values()) {
    for (const l of [p.bLogs[p.bLogs.length - 1], p.pLogs[p.pLogs.length - 1]]) {
      if (l && l.date <= S.meta.as_of_date && (!to || l.date > to)) to = l.date;
    }
  }
  S._lastLog = to;
  return to;
}

export function hotPlayers(S, th, days = 14) {
  // 期間の終わりは「基準日以前で最後に試合別記録がある日」（シーズン終了後・試合のない期間でも空にならないように）
  const to = lastLogDate(S) || S.meta.as_of_date;
  const from = addDays(to, -(days - 1));
  const bats = [];
  const pits = [];
  if (S.hasBatLogs) {
    for (const p of S.players.values()) {
      const r = rangeBat(p, from, to);
      if (r && r.tot.PA >= th.hotMinPA && r.rates.OPS.v !== null) bats.push({ p, r });
    }
    bats.sort((a, b) => b.r.rates.OPS.v - a.r.rates.OPS.v);
  }
  if (S.hasPitLogs) {
    for (const p of S.players.values()) {
      const r = rangePit(p, from, to);
      if (r && r.tot.outs >= th.hotMinOuts && r.rates.ERA.v !== null && r.rates.WHIP.v !== null) pits.push({ p, r });
    }
    pits.sort((a, b) => a.r.rates.ERA.v - b.r.rates.ERA.v || a.r.rates.WHIP.v - b.r.rates.WHIP.v);
  }
  return { from, to, days, bats: bats.slice(0, 5), pits: pits.slice(0, 5), available: S.hasBatLogs || S.hasPitLogs };
}

// ---------------------------------------------------------------------------
// 比較母集団（同じ役割の選手）

export function batGroupKey(p) {
  return p.info.position; // 捕手/内野手/外野手
}
export function comparisonGroup(S, p, th) {
  if (!p.isPitcher && p.bat) {
    const members = [...S.players.values()].filter((x) => !x.isPitcher && x.bat && has(x.bat.PA) && x.bat.PA >= th.compareMinPA && batGroupKey(x) === batGroupKey(p));
    const tot = sumRows(members.map((m) => m.bat), BAT_COUNT_KEYS);
    return { label: `${batGroupKey(p)}（${th.compareMinPA}打席以上）`, members, rates: battingRates(tot) };
  }
  if (p.pit) {
    const members = [...S.players.values()].filter((x) => x.pit && has(x.pit.outs) && x.pit.outs >= th.compareMinOuts && x.role === p.role);
    const tot = sumRows(members.map((m) => m.pit), PIT_COUNT_KEYS);
    return { label: `${p.role}投手（${th.compareMinOuts / 3}投球回以上）`, members, rates: pitchingRates(tot) };
  }
  return null;
}

/** 母集団内での順位（higher=true なら大きいほど上位） */
export function rankIn(members, getter, value, higher = true) {
  const vals = members.map(getter).filter((v) => v !== null && v !== undefined);
  if (value === null || value === undefined || !vals.length) return null;
  const better = vals.filter((v) => (higher ? v > value : v < value)).length;
  return { rank: better + 1, of: vals.length };
}

// ---------------------------------------------------------------------------
// ランキング

export function leaders(S, kind, key, { qualified = false, higher = true, n = 5, min = null } = {}) {
  const list = [];
  for (const p of S.players.values()) {
    const obj = kind === 'bat' ? p.bat : p.pit;
    if (!obj) continue;
    if (qualified && !(kind === 'bat' ? p.qualifiedBat : p.qualifiedPit)) continue;
    const rates = kind === 'bat' ? p.batRates : p.pitRates;
    const v = key in rates ? rates[key].v : obj[key];
    if (v === null || v === undefined) continue;
    if (min !== null && v < min) continue;
    list.push({ p, v });
  }
  list.sort((a, b) => (higher ? b.v - a.v : a.v - b.v));
  // 同値は同順位
  let prevV = null;
  let prevRank = 0;
  list.forEach((x, i) => {
    x.rank = x.v === prevV ? prevRank : i + 1;
    prevV = x.v;
    prevRank = x.rank;
  });
  return list.filter((x) => x.rank <= n);
}

/** 6球団内の順位（同値は同順位） */
export function teamRank(S, getter, tid, higher = true) {
  const vals = [...S.teams.keys()].map((t) => ({ t, v: getter(S.teamStats[t]) }));
  const me = vals.find((x) => x.t === tid);
  if (me.v === null || me.v === undefined) return null;
  const better = vals.filter((x) => x.v !== null && (higher ? x.v > me.v : x.v < me.v)).length;
  return better + 1;
}
