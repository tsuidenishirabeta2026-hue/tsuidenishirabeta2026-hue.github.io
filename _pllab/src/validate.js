// 検証モジュール: 取得した生 CSV テキストを型変換・整合性チェックし、正規化データにする。
// エラーが1件でもあれば、そのシーズンのデータは保存しない（呼び出し側で判断）。

import { parseCsv } from './csv.js';
import { FILES, LEAGUE_TEAMS } from './schema.js';
import { LEAGUE } from './league.js';
import { ipToOuts, sumRows, BAT_COUNT_KEYS, PIT_COUNT_KEYS } from './metrics.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function convert(col, raw, where, errors) {
  if (raw === '' || raw === undefined) {
    if (col.need === 'val') errors.push(`${where}: 「${col.label}」(${col.csv}) は必須です`);
    return null;
  }
  switch (col.type) {
    case 'int': {
      if (!/^\d+$/.test(raw)) {
        errors.push(`${where}: 「${col.label}」(${col.csv}) は0以上の整数で入力してください（値: "${raw}"）`);
        return null;
      }
      return Number(raw);
    }
    case 'date':
      if (!isValidDate(raw)) {
        errors.push(`${where}: 「${col.label}」(${col.csv}) は YYYY-MM-DD 形式の日付で入力してください（値: "${raw}"）`);
        return null;
      }
      return raw;
    case 'ip':
      try {
        return ipToOuts(raw);
      } catch (e) {
        errors.push(`${where}: ${e.message}`);
        return null;
      }
    case 'enum':
      if (!col.values.includes(raw)) {
        errors.push(`${where}: 「${col.label}」(${col.csv}) の値 "${raw}" は使用できません（${col.values.filter(Boolean).join(' / ')}）`);
        return null;
      }
      return raw;
    default:
      return raw;
  }
}

function parseTable(name, def, text, errors) {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    errors.push(`${def.file}: ${e.message}`);
    return [];
  }
  if (def.keyValue) {
    // key,value 形式 → 1 レコードへ
    const obj = {};
    const rec = { __line: 1 };
    for (const r of parsed.records) obj[r.key] = r.value ?? '';
    for (const col of def.columns) {
      if (!(col.csv in obj) && col.need) errors.push(`${def.file}: キー "${col.csv}" がありません`);
      rec[col.key] = convert(col, obj[col.csv] ?? '', `${def.file} の ${col.csv}`, errors);
    }
    return [rec];
  }
  const header = new Set(parsed.header);
  for (const col of def.columns) {
    if (col.need && !header.has(col.csv)) errors.push(`${def.file}: 列 "${col.csv}"（${col.label}）がありません`);
  }
  const known = new Set(def.columns.map((c) => c.csv));
  const unknown = parsed.header.filter((h) => !known.has(h));
  const out = [];
  for (const r of parsed.records) {
    const where = `${def.file} ${r.__line}行目`;
    if (r.__extra) errors.push(`${where}: 列数がヘッダーより多くなっています`);
    const rec = {};
    for (const col of def.columns) {
      if (!header.has(col.csv)) {
        rec[col.key] = null; // 任意列が無い → データなし
        continue;
      }
      rec[col.key] = convert(col, r[col.csv], where, errors);
    }
    rec.__line = r.__line;
    out.push(rec);
  }
  if (def.unique) {
    const seen = new Map();
    for (const rec of out) {
      const k = def.unique.map((u) => rec[u]).join('|');
      if (seen.has(k)) {
        errors.push(`${def.file} ${rec.__line}行目: ${def.unique.join('+')} = ${k} が ${seen.get(k)}行目と重複しています`);
      } else seen.set(k, rec.__line);
    }
  }
  return { rows: out, unknown };
}

const nn = (x) => x !== null && x !== undefined;

/**
 * @param {number} season ディレクトリ名などから想定されるシーズン
 * @param {Record<string,string>} texts ファイル名 → CSV テキスト
 * @returns {{ ok: boolean, errors: string[], warnings: string[], data: object|null }}
 */
export function validateSeason(season, texts) {
  const errors = [];
  const warnings = [];
  const data = {};

  for (const [name, def] of Object.entries(FILES)) {
    const text = texts[def.file];
    if (text === undefined) {
      if (def.required) errors.push(`${def.file} がありません（必須）`);
      data[name] = def.keyValue ? null : [];
      continue;
    }
    const res = parseTable(name, def, text, errors);
    if (def.keyValue) {
      data[name] = res[0];
    } else {
      data[name] = res.rows;
      if (res.unknown.length) warnings.push(`${def.file}: 未対応の列を無視しました（${res.unknown.join(', ')}）`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings, data: null };

  const meta = data.meta;
  if (meta.season !== season) errors.push(`meta.csv の season (${meta.season}) が対象シーズン (${season}) と一致しません`);
  if (meta.as_of_date && !meta.as_of_date.startsWith(String(meta.season)) && meta.phase !== 'offseason' && meta.phase !== 'preseason') {
    warnings.push(`基準日 ${meta.as_of_date} がシーズン ${meta.season} の年と異なります`);
  }
  if (meta.champion_team_id && !LEAGUE_TEAMS.includes(meta.champion_team_id)) {
    errors.push(`meta.csv の champion_team_id "${meta.champion_team_id}" は${LEAGUE.name}の球団IDではありません`);
  }

  // 球団・順位表: 6球団そろっていること
  for (const [name, rows] of [['teams.csv', data.teams], ['standings.csv', data.standings]]) {
    const ids = new Set(rows.map((r) => r.team_id));
    const missing = LEAGUE_TEAMS.filter((t) => !ids.has(t));
    if (missing.length) errors.push(`${name}: 球団 ${missing.join(', ')} の行がありません（6球団すべて必要）`);
  }
  for (const s of data.standings) {
    if (s.W + s.L + s.T !== s.G) errors.push(`standings.csv ${s.__line}行目: 試合(${s.G}) ≠ 勝利+敗戦+引き分け(${s.W + s.L + s.T})`);
  }
  const ranks = data.standings.map((s) => s.official_rank).filter(nn);
  if (ranks.length && ranks.length !== 6) errors.push('standings.csv: official_rank は6球団すべてに入力するか、すべて空欄にしてください');
  if (ranks.some((r) => r < 1 || r > 6)) errors.push('standings.csv: official_rank は1〜6で入力してください');

  // 選手
  const stint = new Set(data.players.map((p) => `${p.player_id}|${p.team_id}`));
  const nameById = new Map();
  for (const p of data.players) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(p.player_id)) errors.push(`players.csv ${p.__line}行目: 選手ID "${p.player_id}" は半角英数字・ハイフン・アンダースコアのみ使用できます`);
    if (nameById.has(p.player_id) && nameById.get(p.player_id) !== p.name) {
      warnings.push(`players.csv: 選手ID ${p.player_id} の登録名がシーズン内で異なります（${nameById.get(p.player_id)} / ${p.name}）`);
    }
    nameById.set(p.player_id, p.name);
    if (p.from_date && p.to_date && p.from_date > p.to_date) errors.push(`players.csv ${p.__line}行目: from_date が to_date より後です`);
  }
  // 同一選手の在籍中の行が複数ないこと
  const active = new Map();
  for (const p of data.players) {
    if (!p.to_date) {
      if (active.has(p.player_id)) errors.push(`players.csv ${p.__line}行目: 選手ID ${p.player_id} が複数球団に「在籍中」(to_date 空欄) になっています`);
      active.set(p.player_id, p.team_id);
    }
  }

  for (const b of data.batting) {
    const w = `batting.csv ${b.__line}行目`;
    if (!stint.has(`${b.player_id}|${b.team_id}`)) errors.push(`${w}: 選手ID ${b.player_id}（${b.team_id}）が players.csv にありません`);
    if (nn(b.AB) && nn(b.PA) && b.AB > b.PA) errors.push(`${w}: 打数(${b.AB}) が打席(${b.PA}) を超えています`);
    if (nn(b.H) && nn(b.AB) && b.H > b.AB) errors.push(`${w}: 安打(${b.H}) が打数(${b.AB}) を超えています`);
    if ([b.H, b.D, b.T, b.HR].every(nn) && b.D + b.T + b.HR > b.H) errors.push(`${w}: 二塁打+三塁打+本塁打 が安打を超えています`);
    if (nn(b.IBB) && nn(b.BB) && b.IBB > b.BB) errors.push(`${w}: 故意四球が四球を超えています`);
    if ([b.PA, b.AB, b.BB, b.HBP, b.SF].every(nn) && nn(b.SH)) {
      const sum = b.AB + b.BB + b.HBP + b.SF + b.SH;
      if (sum > b.PA) errors.push(`${w}: 打数+四球+死球+犠打+犠飛(${sum}) が打席(${b.PA}) を超えています`);
    }
  }
  for (const p of data.pitching) {
    const w = `pitching.csv ${p.__line}行目`;
    if (!stint.has(`${p.player_id}|${p.team_id}`)) errors.push(`${w}: 選手ID ${p.player_id}（${p.team_id}）が players.csv にありません`);
    if (nn(p.GS) && nn(p.G) && p.GS > p.G) errors.push(`${w}: 先発(${p.GS}) が登板(${p.G}) を超えています`);
    if (nn(p.HR) && nn(p.H) && p.HR > p.H) errors.push(`${w}: 被本塁打が被安打を超えています`);
    if (nn(p.ER) && nn(p.R) && p.ER > p.R) errors.push(`${w}: 自責点(${p.ER}) が失点(${p.R}) を超えています`);
  }

  // 試合
  const teamIds = new Set(LEAGUE_TEAMS);
  for (const g of data.games) {
    const w = `games.csv ${g.__line}行目`;
    if (!teamIds.has(g.home) && !teamIds.has(g.away)) errors.push(`${w}: ${LEAGUE.name}球団が含まれていません`);
    if (g.status === 'final' && (!nn(g.home_score) || !nn(g.away_score))) errors.push(`${w}: 試合終了(final) のスコアが空欄です`);
    if (g.status === 'final' && g.date > meta.as_of_date) errors.push(`${w}: 基準日(${meta.as_of_date}) より後の試合が final になっています`);
  }
  for (const [file, rows] of [['batting_games.csv', data.batting_games], ['pitching_games.csv', data.pitching_games]]) {
    for (const r of rows) {
      if (!stint.has(`${r.player_id}|${r.team_id}`)) errors.push(`${file} ${r.__line}行目: 選手ID ${r.player_id}（${r.team_id}）が players.csv にありません`);
      if (r.date > meta.as_of_date) errors.push(`${file} ${r.__line}行目: 基準日より後の日付です`);
    }
  }
  for (const r of data.batting_games) {
    if (r.AB > r.PA || r.H > r.AB || r.D + r.T + r.HR > r.H) errors.push(`batting_games.csv ${r.__line}行目: 打席・打数・安打の関係が不正です`);
  }

  // 試合別成績とシーズン累計の突き合わせ（不一致は警告。訂正反映の遅れ等を検知するため）
  checkLogTotals(data.batting_games, data.batting, ['PA', 'AB', 'H', 'HR', 'BB'], 'batting', warnings);
  checkLogTotals(data.pitching_games, data.pitching, ['outs', 'H', 'SO', 'ER'], 'pitching', warnings);

  if (errors.length) return { ok: false, errors, warnings, data: null };

  for (const k of Object.keys(data)) {
    if (Array.isArray(data[k])) data[k].forEach((r) => delete r.__line);
  }
  if (data.meta) delete data.meta.__line;
  return { ok: true, errors, warnings, data };
}

function checkLogTotals(logs, totals, keys, label, warnings) {
  if (!logs.length) return;
  const byStint = new Map();
  for (const r of logs) {
    const k = `${r.player_id}|${r.team_id}`;
    if (!byStint.has(k)) byStint.set(k, []);
    byStint.get(k).push(r);
  }
  let mismatch = 0;
  for (const t of totals) {
    const rows = byStint.get(`${t.player_id}|${t.team_id}`) || [];
    const s = sumRows(rows, keys);
    for (const k of keys) {
      if (t[k] !== null && rows.length && s[k] !== null && s[k] !== t[k]) {
        mismatch++;
        break;
      }
    }
  }
  if (mismatch) warnings.push(`${label}: 試合別成績の合計とシーズン累計が一致しない選手が ${mismatch} 名います（訂正の反映時期の差の可能性）`);
}

/**
 * 前回の正常データと比べて、不完全な取得結果でないかを確認する。
 * - 基準日が過去に戻っていないか
 * - 選手数・成績行数が大きく減っていないか（同一シーズン内）
 */
export function checkCompleteness(prev, next, { allowRollback = false } = {}) {
  const errors = [];
  if (!prev) return errors;
  if (prev.meta.season === next.meta.season) {
    if (!allowRollback && next.meta.as_of_date < prev.meta.as_of_date) {
      errors.push(`基準日が前回 (${prev.meta.as_of_date}) より古くなっています (${next.meta.as_of_date})`);
    }
    for (const k of ['players', 'batting', 'pitching']) {
      const a = prev[k].length;
      const b = next[k].length;
      if (a >= 20 && b < a * 0.8) errors.push(`${k} の件数が前回 ${a} 件から ${b} 件に大きく減少しています（取得が不完全な可能性）`);
    }
    const prevG = prev.standings.reduce((s, r) => s + r.G, 0);
    const nextG = next.standings.reduce((s, r) => s + r.G, 0);
    if (!allowRollback && nextG < prevG) errors.push(`順位表の総試合数が前回 (${prevG}) より減っています (${nextG})`);
  }
  return errors;
}

export { BAT_COUNT_KEYS, PIT_COUNT_KEYS };
