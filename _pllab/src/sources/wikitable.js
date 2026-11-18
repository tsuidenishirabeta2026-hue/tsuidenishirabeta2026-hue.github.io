// Wikipedia の表（wikitable 記法）を2次元配列にする小さなパーサ。rowspan / colspan に対応。
import { cleanWikitext } from '../moves/wikipedia.js';

/** "|" をリンク [[..|..]] やテンプレート {{..|..}} の外側だけで分割する */
function splitOutside(s, sep) {
  const out = [];
  let depthL = 0;
  let depthT = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith('[[', i)) depthL++;
    if (s.startsWith(']]', i)) depthL = Math.max(0, depthL - 1);
    if (s.startsWith('{{', i)) depthT++;
    if (s.startsWith('}}', i)) depthT = Math.max(0, depthT - 1);
    if (depthL === 0 && depthT === 0 && s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

function parseCell(raw, header) {
  const parts = splitOutside(raw, '|');
  let attrs = '';
  let content = raw;
  if (parts.length > 1 && /^\s*(?:[a-z-]+\s*=\s*("[^"]*"|'[^']*'|\S+)\s*)+$/i.test(parts[0])) {
    attrs = parts[0];
    content = parts.slice(1).join('|');
  }
  const num = (name) => Number(new RegExp(`${name}\\s*=\\s*"?(\\d+)`, 'i').exec(attrs)?.[1] || 1);
  return { raw: content.trim(), text: cleanWikitext(content), header, rowspan: num('rowspan'), colspan: num('colspan') };
}

/** wikitext 中の最初の（または start 以降の）表を解析 */
export function parseWikitable(wikitext, start = 0) {
  const i = wikitext.indexOf('{|', start);
  if (i < 0) return null;
  const j = wikitext.indexOf('\n|}', i);
  const body = wikitext.slice(i, j < 0 ? undefined : j);
  const rawRows = [];
  let cur = null;
  for (const line of body.split('\n').slice(1)) {
    const l = line.trimEnd();
    if (l.startsWith('|-')) {
      cur = [];
      rawRows.push(cur);
      continue;
    }
    if (l.startsWith('|+')) continue; // 表題
    if (l.startsWith('!') || l.startsWith('|')) {
      if (!cur) {
        cur = [];
        rawRows.push(cur);
      }
      const header = l.startsWith('!');
      const sep = header ? /!!|\|\|/ : /\|\|/;
      for (const c of l.slice(1).split(sep)) cur.push(parseCell(c, header));
    } else if (cur && cur.length && l.trim()) {
      // セルの続きの行
      const last = cur[cur.length - 1];
      last.raw += '\n' + l;
      last.text = cleanWikitext(last.raw);
    }
  }
  // rowspan/colspan を展開して格子にする
  const grid = [];
  const pending = []; // 列ごとの { cell, left }
  for (const row of rawRows.filter((r) => r.length)) {
    const out = [];
    let col = 0;
    const take = () => {
      while (pending[col] && pending[col].left > 0) {
        out[col] = pending[col].cell;
        pending[col].left--;
        col++;
      }
    };
    for (const cell of row) {
      take();
      for (let k = 0; k < cell.colspan; k++) {
        out[col] = cell;
        if (cell.rowspan > 1) pending[col] = { cell, left: cell.rowspan - 1 };
        col++;
      }
    }
    take();
    grid.push(out);
  }
  return grid;
}

/** [[記事名|表示名]] の記事名（最初のリンク） */
export function firstLinkTarget(raw) {
  const m = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/.exec(raw || '');
  return m ? m[1].trim() : null;
}
