// 選手記事の基本情報（Infobox）の「年俸」欄を読む
//   例: "3億7000万円＋出来高（2026年）<ref>…</ref><br />※2020年から7年契約（変動制）"
// 年俸は球団が公表しないため、記事の値は報道による推定。表示するときは必ず「推定」と出典を添える。

const FW = '０１２３４５６７８９';
const half = (s) => s.replace(/[０-９]/g, (c) => String(FW.indexOf(c))).replace(/，/g, ',');

const KEEP = new Set(['nowrap', 'nobr', 'small', 'big', 'lang', 'font']);

/** wiki 記法・HTML を取り除いた表示用の文字列 */
function plain(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{\s*0\s*\}\}/g, '')
    // 見た目だけを整えるテンプレート（{{Nowrap|…}} など）は中身を残し、出典の {{R|…}} などは消す
    .replace(/\{\{\s*([^{}|]*?)\s*\|([^{}]*)\}\}/g, (m, name, body) => (KEEP.has(name.toLowerCase()) ? body.split('|').pop() : ''))
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 「4億8000万円」→ 480000000。円でなければ null */
export function yenOf(s) {
  const t = half(s).replace(/,/g, '');
  const m = t.match(/(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?円/);
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((Number(m[1] || 0) * 1e8 + Number(m[2] || 0) * 1e4));
}

/**
 * @returns {{ text: string, yen: number|null, year: number|null, note: string } | null}
 *   text: 金額の部分（例 "3億7000万円＋出来高"）、note: 「※2020年から7年契約」などの補足
 */
export function parseSalary(wikitext) {
  const m = wikitext.match(/\|\s*年俸\s*=([^\n]*)/);
  if (!m) return null;
  const parts = m[1].split(/<br\s*\/?>/i).map(plain).filter(Boolean);
  if (!parts.length) return null;
  const head = half(parts[0]);
  const ym = head.match(/[（(]\s*(\d{4})\s*年(?:度)?\s*[）)]/);
  const year = ym ? Number(ym[1]) : null;
  const text = head.replace(/[（(]\s*\d{4}\s*年(?:度)?\s*[）)]/, '').trim();
  if (!text || !/\d/.test(text)) return null;
  return { text, yen: yenOf(text), year, note: parts.slice(1).join(' ') };
}

/** 表示用の短い金額（例 480000000 → "4.8億円"、62000000 → "6200万円"） */
export function yenShort(yen) {
  if (yen === null || yen === undefined) return '';
  if (yen >= 1e8) return `${Math.round(yen / 1e7) / 10}億円`;
  return `${Math.round(yen / 1e4).toLocaleString('ja-JP')}万円`;
}
