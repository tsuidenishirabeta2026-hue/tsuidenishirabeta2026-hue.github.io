// コラム用の小さな Markdown 変換（見出し・段落・箇条書き・表・太字・リンク・区切り線のみ）
// 入力は運営者が書いた原稿だけを想定し、HTML はすべてエスケープする。
import { esc } from './format.js';

function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // リンク: http(s) か相対パスのみ（javascript: などは無視）
  t = t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\.\.?\/|\/)[^)\s]*)\)/g, (m, label, href) => {
    const ext = /^https?:/.test(href);
    return `<a href="${href}"${ext ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  return t;
}

/** "--- key: value ---" 形式の前置き情報と本文に分ける */
export function parseFrontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const lv = Math.min(h[1].length + 1, 4); // 記事内の # はページの h2 として扱う
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }
    if (/^-{3,}\s*$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      (list ||= []).push(line.replace(/^\s*[-*]\s+/, ''));
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushPara();
      flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      out.push(`<div class="table-scroll"><table class="wrap"><thead><tr>${head.map((c, k) => `<th${k === 0 ? ' class="l"' : ''}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => `<td${k === 0 ? ' class="l"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}
