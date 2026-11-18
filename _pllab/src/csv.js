// 依存ライブラリなしの CSV パーサ（RFC 4180 準拠: ダブルクォート、カンマ・改行を含むフィールドに対応）

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 除去（Excel 出力対策）
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (c === '\r') {
      i++;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (inQuotes) throw new Error('CSV の引用符が閉じられていません');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 完全な空行は除外
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (nonEmpty.length === 0) return { header: [], records: [] };
  const header = nonEmpty[0].map((h) => h.trim());
  const records = nonEmpty.slice(1).map((r, idx) => {
    const o = { __line: idx + 2 };
    header.forEach((h, j) => {
      o[h] = r[j] === undefined ? '' : r[j].trim();
    });
    if (r.length > header.length && r.slice(header.length).some((x) => x.trim() !== '')) {
      o.__extra = true;
    }
    return o;
  });
  return { header, records };
}

function esc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h])).join(','));
  return lines.join('\n') + '\n';
}
