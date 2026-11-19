import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markdownToHtml, parseFrontMatter } from '../src/markdown.js';
import { loadColumns } from '../src/render/page-columns.js';

test('Markdown: 見出し・表・箇条書き・太字・リンク、HTML はエスケープ', () => {
  const h = markdownToHtml('## 見出し\n\n**太字** と <script>x</script>\n\n- a\n- b\n\n| 指標 | 値 |\n|---|---|\n| OPS | .922 |\n\n[選手](../players/a.html) [外部](https://example.com) [危険](javascript:alert(1))\n\n---');
  assert.match(h, /<h3>見出し<\/h3>/);
  assert.match(h, /<strong>太字<\/strong>/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(h, /<td class="l">OPS<\/td><td class="n">\.922<\/td>/);
  assert.match(h, /<a href="\.\.\/players\/a\.html">選手<\/a>/);
  assert.match(h, /<a href="https:\/\/example\.com" rel="noopener">外部<\/a>/);
  assert.doesNotMatch(h, /href="javascript/);
  assert.match(h, /<hr>/);
});

test('コラムの読み込み: 前置き情報の必須項目、下書きは除外、新しい順', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pllab-col-'));
  await writeFile(join(dir, 'a.md'), '---\nslug: a\ntitle: A\ndate: 2026-11-01\nplayers: p1/p2\n---\n# A\n本文');
  await writeFile(join(dir, 'b.md'), '---\nslug: b\ntitle: B\ndate: 2026-11-10\n---\n本文');
  await writeFile(join(dir, 'c.md'), '---\nslug: c\ntitle: C\ndate: 2026-11-20\ndraft: true\n---\n本文');
  const cols = await loadColumns(dir);
  assert.deepEqual(cols.map((c) => c.slug), ['b', 'a']);
  assert.deepEqual(cols[1].players, ['p1', 'p2']);
  assert.doesNotMatch(cols[1].html, /<h2>A<\/h2>/); // 先頭の見出しは除く
  await writeFile(join(dir, 'd.md'), '---\nslug: Bad Slug\ntitle: D\ndate: 2026-11-01\n---\n');
  await assert.rejects(loadColumns(dir), /slug/);
  assert.deepEqual(parseFrontMatter('本文だけ').meta, {});
});
