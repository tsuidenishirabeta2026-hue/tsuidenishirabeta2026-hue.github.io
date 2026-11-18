// 選手記事（Wikipedia 日本語版）の「年度別打撃成績」「年度別投手成績」表を読む。
//
// 列の並び（テンプレート {{年度別打撃成績}} / {{投手成績}} の定義に基づく。合計値の検算で確認済み）
//   打撃: 試合 打席 打数 得点 安打 二塁打 三塁打 本塁打 塁打 打点 盗塁 盗塁死 犠打 犠飛 四球 敬遠 死球 三振 併殺打 打率 出塁率 長打率 OPS
//   投手: 登板 先発 完投 完封 無四球 勝利 敗戦 セーブ ホールド 勝率 打者 投球回 被安打 被本塁打 与四球 敬遠 与死球 奪三振 暴投 ボーク 失点 自責点 防御率 WHIP
// 各行は検算（打席 = 打数+四球+死球+犠打+犠飛+打撃妨害等、防御率の再計算）を行い、合わない行は使わない。
import { parseWikitable, firstLinkTarget } from './wikitable.js';
import { ipToOuts } from '../metrics.js';

const BAT_KEYS = ['G', 'PA', 'AB', 'R', 'H', 'D', 'T', 'HR', 'TB', 'RBI', 'SB', 'CS', 'SH', 'SF', 'BB', 'IBB', 'HBP', 'SO', 'GDP'];
const PIT_KEYS = ['G', 'GS', 'CG', 'SHO', 'NBB', 'W', 'L', 'SV', 'HLD', 'WPCT', 'BF', 'IP', 'H', 'HR', 'BB', 'IBB', 'HBP', 'SO', 'WP', 'BK', 'R', 'ER'];

export const PL_TEAM_NAMES = {
  F: ['北海道日本ハムファイターズ', '日本ハム'],
  E: ['東北楽天ゴールデンイーグルス', '楽天'],
  L: ['埼玉西武ライオンズ', '西武'],
  M: ['千葉ロッテマリーンズ', 'ロッテ'],
  B: ['オリックス・バファローズ', 'オリックス'],
  H: ['福岡ソフトバンクホークス', 'ソフトバンク'],
};

export function teamIdOf(cell) {
  if (!cell) return null;
  const target = firstLinkTarget(cell.raw);
  for (const [id, names] of Object.entries(PL_TEAM_NAMES)) {
    if (names.includes(cell.text) || (target && names.includes(target))) return id;
  }
  return null;
}

function num(s) {
  const t = (s || '').replace(/[,\s]/g, '');
  if (t === '' || /^-+$/.test(t) || t === '―' || t === '－') return null;
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** 見出し（例:「年度別打撃成績」）の直後の表を取り出す。見つからなければ null */
function tableAfter(text, heading) {
  const re = new RegExp(`^=+\\s*${heading}[^=\\n]*=+\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return null;
  const nextHeading = text.slice(m.index + m[0].length).search(/^==/m);
  const start = m.index + m[0].length;
  const tablePos = text.indexOf('{|', start);
  if (tablePos < 0 || (nextHeading >= 0 && tablePos > start + nextHeading)) return null;
  return parseWikitable(text, tablePos);
}

function rowsOf(grid, width) {
  const out = [];
  let lastYear = null;
  let lastTeam = null;
  for (const row of grid || []) {
    if (!row.length) continue;
    const first = row[0];
    const ym = first && !first.header ? /(\d{4})/.exec(first.raw + ' ' + first.text) : null;
    if (!ym) continue; // 通算などの行
    const year = Number(ym[1]);
    // 年・球団・数値の並び。球団セルは rowspan で上の行から引き継がれる
    let cells = row.slice(1);
    let teamCell = null;
    if (cells.length === width + 1) {
      teamCell = cells[0];
      cells = cells.slice(1);
    } else if (cells.length === width) {
      teamCell = lastTeam && lastYear !== null ? lastTeam : null;
    } else continue;
    lastYear = year;
    lastTeam = teamCell;
    out.push({ year, teamCell, values: cells.map((c) => (c ? c.text : '')) });
  }
  return out;
}

export function parseBatting(text) {
  const grid = tableAfter(text, '年度別打撃成績');
  if (!grid) return null;
  const rows = [];
  for (const r of rowsOf(grid, 23)) {
    const v = {};
    BAT_KEYS.forEach((k, i) => (v[k] = num(r.values[i])));
    const team = r.teamCell ? r.teamCell.text : '';
    const ok = [v.PA, v.AB, v.BB, v.HBP, v.SH, v.SF, v.H, v.D, v.T, v.HR].every((x) => x !== null);
    // 検算: 打席 ≧ 打数+四球+死球+犠打+犠飛（差は打撃妨害・走塁妨害で通常0〜2）、塁打の一致
    const paDiff = ok ? v.PA - (v.AB + v.BB + v.HBP + v.SH + v.SF) : null;
    const tbOk = ok && v.TB !== null ? v.TB === v.H + v.D + 2 * v.T + 3 * v.HR : false;
    rows.push({ year: r.year, team, team_id: teamIdOf(r.teamCell), ...v, valid: ok && paDiff >= 0 && paDiff <= 3 && tbOk && v.H <= v.AB });
  }
  return rows;
}

export function parsePitching(text) {
  const grid = tableAfter(text, '年度別投手成績');
  if (!grid) return null;
  const rows = [];
  for (const r of rowsOf(grid, 24)) {
    const v = {};
    PIT_KEYS.forEach((k, i) => {
      if (k === 'IP') {
        try {
          v.outs = ipToOuts((r.values[i] || '').replace(/\s/g, '')) ?? null;
        } catch {
          v.outs = null;
        }
      } else if (k !== 'WPCT') v[k] = num(r.values[i]);
    });
    const eraText = (r.values[22] || '').trim();
    const era = /^\d+\.\d+$/.test(eraText) ? Number(eraText) : null;
    const ok = [v.G, v.GS, v.W, v.L, v.SV, v.HLD, v.outs, v.H, v.HR, v.BB, v.HBP, v.SO, v.ER].every((x) => x !== null);
    // 検算: 防御率（表示値）と自責点×27÷アウト数の差が丸め誤差の範囲か
    let eraOk = false;
    if (ok) {
      if (v.outs === 0) eraOk = era === null;
      else eraOk = era !== null && Math.abs((v.ER * 27) / v.outs - era) < 0.006;
    }
    rows.push({ year: r.year, team: r.teamCell ? r.teamCell.text : '', team_id: teamIdOf(r.teamCell), ...v, valid: ok && eraOk && v.GS <= v.G });
  }
  return rows;
}

/** 記事が対象シーズン終了時点まで更新されているか（「2026年度シーズン終了時」などの注記、または当該年の行） */
export function updatedFor(text, season, batting, pitching) {
  if (new RegExp(`${season}年(?:度)?(?:シーズン)?終了時`).test(text)) return true;
  return [...(batting || []), ...(pitching || [])].some((r) => r.year === season);
}

export function parseArticle(text, season) {
  const batting = parseBatting(text);
  const pitching = parsePitching(text);
  return { batting, pitching, updated: updatedFor(text, season, batting, pitching) };
}
