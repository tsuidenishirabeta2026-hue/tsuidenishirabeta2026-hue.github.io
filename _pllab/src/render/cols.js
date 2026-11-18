// 成績表の列定義（静的ページと選手一覧の JSON で共通に使う）
import { rate3, fixed, int, ip, pct } from '../format.js';
import { term } from './layout.js';

// [見出し, キー, 形式]
export const BAT_COLS = [
  ['試合', 'G', 'int'],
  ['打席', 'PA', 'int'],
  ['打数', 'AB', 'int'],
  ['安打', 'H', 'int'],
  ['二塁打', 'D', 'int'],
  ['三塁打', 'T', 'int'],
  ['本塁打', 'HR', 'int'],
  ['打点', 'RBI', 'int'],
  ['得点', 'R', 'int'],
  ['盗塁', 'SB', 'int'],
  ['四球', 'BB', 'int'],
  ['死球', 'HBP', 'int'],
  ['三振', 'SO', 'int'],
  ['打率', 'AVG', 'rate'],
  ['出塁率', 'OBP', 'rate'],
  ['長打率', 'SLG', 'rate'],
  ['OPS', 'OPS', 'rate'],
];
export const PIT_COLS = [
  ['登板', 'G', 'int'],
  ['先発', 'GS', 'int'],
  ['勝利', 'W', 'int'],
  ['敗戦', 'L', 'int'],
  ['ホールド', 'HLD', 'int'],
  ['セーブ', 'SV', 'int'],
  ['投球回', 'outs', 'ip'],
  ['被安打', 'H', 'int'],
  ['被本塁打', 'HR', 'int'],
  ['与四球', 'BB', 'int'],
  ['与死球', 'HBP', 'int'],
  ['奪三振', 'SO', 'int'],
  ['自責点', 'ER', 'int'],
  ['防御率', 'ERA', 'f2'],
  ['WHIP', 'WHIP', 'f2'],
  ['奪三振率', 'K9', 'f2'],
  ['与四球率', 'BB9', 'f2'],
  ['K/BB', 'KBB', 'f2'],
];
// 低いほど良い指標（並べ替えの初期方向に使用）
export const LOWER_BETTER = new Set(['ERA', 'WHIP', 'BB9', 'HR9', 'KPCT_BAT', 'L', 'ER', 'BB_P', 'HBP_P']);

/** totals と rates から値（数値 or {v,why}）を取り出す */
export function rawValue(key, tot, rates) {
  if (rates && key in rates) return rates[key];
  return tot ? tot[key] : null;
}

export function fmtCell(fmt, x) {
  switch (fmt) {
    case 'rate':
      return rate3(x);
    case 'f2':
      return fixed(x, 2);
    case 'ip':
      return ip(x);
    case 'pct':
      return pct(x);
    default:
      return int(x);
  }
}

/** 並べ替え用の値（data-v）。欠損は空文字 */
export function sortValue(x) {
  if (x && typeof x === 'object' && 'v' in x) return x.v === null ? '' : String(x.v);
  return Number.isFinite(x) ? String(x) : '';
}

export function td(fmt, key, tot, rates) {
  const x = rawValue(key, tot, rates);
  return `<td data-v="${sortValue(x)}">${fmtCell(fmt, x)}</td>`;
}

/** 見出しセル。並べ替え可能な表では見出し自体がボタンになるため、用語ボタンは入れない */
export function headCells(cols, { terms = true } = {}) {
  return cols.map(([label]) => `<th scope="col">${terms ? term(label) : label}</th>`).join('');
}

/** 表の上に置く「用語の説明」（並べ替え表向け） */
export function termHelp(cols) {
  return `<p class="muted small">用語の説明: ${cols.map(([l]) => term(l)).join('、')}</p>`;
}
