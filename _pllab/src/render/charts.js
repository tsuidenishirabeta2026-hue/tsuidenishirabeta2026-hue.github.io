// SVG グラフ（単位・対象期間・比較対象を必ず図の見出しに入れる。数値は表でも併記する）
import { esc } from '../format.js';

/**
 * リーグ平均=100 の指数の横棒グラフ（指標ごとに尺度が違うため、共通の1軸に揃える）
 * items: [{ label, index, valueText, refText }]  index は「大きいほど良い」向きに揃えた値
 */
export function indexBars({ title, sub, items }) {
  const rows = items.filter((x) => Number.isFinite(x.index));
  if (!rows.length) return '';
  const W = 360;
  const rowH = 30;
  const left = 62;
  const right = 78;
  const top = 22;
  const H = top + rows.length * rowH + 22;
  const maxIdx = Math.max(150, ...rows.map((r) => Math.min(r.index, 250)));
  const x = (v) => left + (Math.min(v, 250) / maxIdx) * (W - left - right);
  const ticks = [0, 50, 100, 150, 200, 250].filter((t) => t <= maxIdx);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  for (const t of ticks) {
    s += `<line class="${t === 100 ? 'ref' : 'grid'}" x1="${x(t)}" x2="${x(t)}" y1="${top - 6}" y2="${H - 18}"/>`;
    s += `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${t}</text>`;
  }
  s += `<text x="${x(100) + 4}" y="${top - 10}">リーグ平均 = 100</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, x(r.index) - left);
    s += `<text x="${left - 8}" y="${y + 20}" text-anchor="end">${esc(r.label)}</text>`;
    s += `<rect class="bar" x="${left}" y="${y + 6}" width="${w}" height="16" rx="4"><title>${esc(`${r.label}: 本人 ${r.valueText} ／ リーグ平均 ${r.refText}（指数 ${Math.round(r.index)}）`)}</title></rect>`;
    s += `<text class="val" x="${left + w + 6}" y="${y + 20}">${Math.round(r.index)}</text>`;
    s += `<text x="${W - 4}" y="${y + 20}" text-anchor="end">${esc(r.valueText)}</text>`;
  });
  s += '</svg>';
  return `<figure class="chart"><figcaption><b>${esc(title)}</b>${esc(sub)}</figcaption>${s}</figure>`;
}

/**
 * 推移の折れ線（1系列＋参照線）
 * points: [{ label, y, n }]  ref: { y, label }
 */
export function trendLine({ title, sub, points, ref, fmt, lowerIsBetter = false }) {
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (pts.length < 2) return '';
  const W = 360;
  const H = 220;
  const left = 40;
  const right = 16;
  const top = 18;
  const bottom = 40;
  const ys = pts.map((p) => p.y).concat(ref && Number.isFinite(ref.y) ? [ref.y] : []);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const X = (i) => left + 14 + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - left - right - 28));
  const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    s += `<line class="grid" x1="${left}" x2="${W - right}" y1="${Y(v)}" y2="${Y(v)}"/>`;
    s += `<text x="${left - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  if (ref && Number.isFinite(ref.y)) {
    s += `<line class="ref" x1="${left}" x2="${W - right}" y1="${Y(ref.y)}" y2="${Y(ref.y)}"/>`;
    s += `<text x="${W - right}" y="${Y(ref.y) - 5}" text-anchor="end">${esc(ref.label)} ${esc(fmt(ref.y))}</text>`;
  }
  s += `<polyline class="line" points="${pts.map((p, i) => `${X(i)},${Y(p.y)}`).join(' ')}"/>`;
  pts.forEach((p, i) => {
    s += `<circle class="dot" cx="${X(i)}" cy="${Y(p.y)}" r="4.5"><title>${esc(`${p.label}: ${fmt(p.y)}（${p.n}）`)}</title></circle>`;
    s += `<text x="${X(i)}" y="${H - 22}" text-anchor="middle">${esc(p.label)}</text>`;
    s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" style="font-size:9px">${esc(p.n)}</text>`;
  });
  s += '</svg>';
  return `<figure class="chart"><figcaption><b>${esc(title)}</b>${esc(sub)}${lowerIsBetter ? '（低いほど良い）' : ''}</figcaption>${s}</figure>`;
}
