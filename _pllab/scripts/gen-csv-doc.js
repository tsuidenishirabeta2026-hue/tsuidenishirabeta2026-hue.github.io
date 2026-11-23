// docs/CSV_FORMAT.md と data/input/_template/*.csv を schema.js から生成する
//   node scripts/gen-csv-doc.js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FILES } from '../src/schema.js';
import { ROOT } from '../src/config.js';

const TYPE = { str: '文字列', int: '0以上の整数', date: '日付 YYYY-MM-DD', ip: '投球回（123.1 形式）', enum: '選択肢' };
const NEED = { val: '必須', col: '列は必須（空欄可＝データなし）', undefined: '任意（列ごと省略可）' };
let md = `# CSV 取り込み形式

このファイルは \`node scripts/gen-csv-doc.js\` で \`src/schema.js\` から自動生成しています。

## 置き場所

\`\`\`
_pllab/data/input/<シーズン>/meta.csv
                             teams.csv
                             standings.csv
                             players.csv
                             batting.csv
                             pitching.csv
                             games.csv            （任意）
                             batting_games.csv    （任意）
                             pitching_games.csv   （任意）
                             splits_batting.csv   （任意）
                             splits_pitching.csv  （任意）
\`\`\`

- 文字コードは UTF-8（BOM 付きも可）。1行目は列名。列の順番は自由です。
- **空欄は「データなし」**として扱い、0 とはみなしません。記録が 0 の場合は必ず \`0\` を入力してください。
- 未知の列は警告を出して無視します。
- 選手IDは半角英数字・ハイフン・アンダースコアで、シーズン・移籍・改名をまたいで同じIDを使ってください（同姓同名の区別にも使います）。
- シーズン途中の移籍は、players.csv・batting.csv・pitching.csv に球団ごとの行を分けて入力します（移籍前の行に \`to_date\`、移籍後の行に \`from_date\`）。
- 新しいシーズンのフォルダを追加すると、そのシーズンが「最新」として表示されます。過去シーズンのフォルダは残しておくと年度別成績・過去比較に使われます。
- 入力例は \`data/input/_template/\` と \`data/demo/\`（デモデータ）を参照してください。
- 球団IDは、パ・リーグ版が F=日本ハム, E=楽天, L=西武, M=ロッテ, B=オリックス, H=ソフトバンク、セ・リーグ版が G=巨人, T=阪神, DB=DeNA, C=広島, S=ヤクルト, D=中日（\`config/leagues/\` の設定）。下の表の球団IDの一覧は、パ・リーグ版で生成したものです。

`;
await mkdir(join(ROOT, 'data/input/_template'), { recursive: true });
for (const def of Object.values(FILES)) {
  md += `## ${def.file}（${def.required ? '必須' : '任意'}）\n\n${def.label}\n\n| 列名 | 内容 | 形式 | 入力 |\n|---|---|---|---|\n`;
  for (const c of def.columns) {
    md += `| \`${c.csv}\` | ${c.label} | ${TYPE[c.type]}${c.values ? `: ${c.values.filter(Boolean).join(' / ')}` : ''} | ${NEED[c.need]} |\n`;
  }
  let example = '';
  try {
    const t = await readFile(join(ROOT, 'data/demo/2026', def.file), 'utf8');
    example = t.split('\n').slice(0, def.keyValue ? 8 : 3).join('\n');
  } catch {}
  if (example) md += `\n入力例（デモデータより）:\n\n\`\`\`csv\n${example}\n\`\`\`\n`;
  md += '\n';
  const header = def.keyValue ? 'key,value\n' + def.columns.map((c) => `${c.csv},`).join('\n') : def.columns.map((c) => c.csv).join(',');
  await writeFile(join(ROOT, 'data/input/_template', def.file), header + '\n');
}
await mkdir(join(ROOT, 'docs'), { recursive: true });
await writeFile(join(ROOT, 'docs/CSV_FORMAT.md'), md);
console.log('docs/CSV_FORMAT.md と data/input/_template/ を生成しました');
