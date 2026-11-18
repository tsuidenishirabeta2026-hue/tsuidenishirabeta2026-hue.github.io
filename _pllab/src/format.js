// 表示用の整形（丸めはここでだけ行う）
import { NODATA, ZERO, has, outsToIp } from './metrics.js';

export const NA_TEXT = { [NODATA]: 'データなし', [ZERO]: '算出不可' };

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 計算結果 {v, why} または数値を受け取り、数値なら値を、欠損なら理由を返す */
function unwrap(x) {
  if (x && typeof x === 'object' && 'v' in x) return x.v === null ? { na: x.why || NODATA } : { v: x.v };
  if (has(x)) return { v: x };
  return { na: NODATA };
}

const naHtml = (why) => `<span class="na">${NA_TEXT[why] || 'データなし'}</span>`;

/** 欠損時のテキスト（HTML なし） */
export function naText(x) {
  const u = unwrap(x);
  return u.na ? NA_TEXT[u.na] : null;
}

// 率系（打率など）: ".285"、1以上は "1.012"
export function rate3(x) {
  const u = unwrap(x);
  if (u.na) return naHtml(u.na);
  const s = u.v.toFixed(3);
  return s.startsWith('0.') ? s.slice(1) : s;
}
export function fixed(x, d = 2) {
  const u = unwrap(x);
  if (u.na) return naHtml(u.na);
  return u.v.toFixed(d);
}
export function pct(x, d = 1) {
  const u = unwrap(x);
  if (u.na) return naHtml(u.na);
  return `${(u.v * 100).toFixed(d)}%`;
}
export function int(x) {
  return has(x) ? String(x) : naHtml(NODATA);
}
export function ip(outs) {
  return has(outs) ? outsToIp(outs) : naHtml(NODATA);
}
/** 欠損でも HTML ではなくテキストで返す版（JSON・title 属性用） */
export function plain(fn, x, ...a) {
  return fn(x, ...a).replace(/<[^>]+>/g, '');
}

export function signed(v, d = 3, strip = true) {
  if (!has(v)) return '';
  let s = Math.abs(v).toFixed(d);
  if (strip && s.startsWith('0.')) s = s.slice(1);
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + s;
}

/** ゲーム差: 0.5 単位 */
export function gb(v) {
  if (!has(v)) return '';
  if (v === 0) return '-';
  return Number.isInteger(v) ? `${v}.0` : v.toFixed(1);
}

export function dateJa(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${wd}）`;
}
export function dateShort(s) {
  if (!s) return '';
  const [, m, d] = s.split('-').map(Number);
  return `${m}/${d}`;
}
/** ISO 日時 → 日本時間表記 */
export function dateTimeJst(iso) {
  if (!iso) return '記録なし';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}（日本時間）`;
}

export function ageOn(birth, on) {
  if (!birth || !on) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let a = y - by;
  if (m < bm || (m === bm && d < bd)) a--;
  return a;
}
