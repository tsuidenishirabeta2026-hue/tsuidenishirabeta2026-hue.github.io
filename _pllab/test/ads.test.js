import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, cp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { runBuild } from '../src/build.js';
import { adsTag, siteTags } from '../src/render/layout.js';

test('広告コード: 独自ドメイン・正しい運営者ID・デモでない、がそろったときだけ', () => {
  const ok = { siteUrl: 'https://example.com', adsense: { client: 'ca-pub-1234567890123456' }, demo: false };
  assert.match(adsTag(ok), /adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.equal(adsTag({ ...ok, siteUrl: '' }), '');
  assert.equal(adsTag({ ...ok, demo: true }), '');
  assert.equal(adsTag({ ...ok, adsense: { client: 'ca-pub-12"><script>' } }), '');
  assert.equal(siteTags({ siteUrl: '' }), '');
  assert.match(siteTags({ siteUrl: 'https://example.com' }), /location\.replace\("https:\/\/example\.com"/);
});

test('独自ドメイン設定時: 正規URL・サイトマップ・ads.txt・プライバシーポリシーの広告の項', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'pllab-ads-'));
  const base = loadConfig();
  const config = { ...base, outDir: join(tmp, 'pl-lab'), siteUrl: 'https://example.com', adsense: { client: 'ca-pub-1234567890123456' } };
  await runBuild({ config });
  const idx = await readFile(join(config.outDir, 'index.html'), 'utf8');
  assert.match(idx, /<link rel="canonical" href="https:\/\/example\.com\/">/);
  const pl = await readFile(join(config.outDir, 'players', 'index.html'), 'utf8');
  assert.match(pl, /<link rel="canonical" href="https:\/\/example\.com\/players\/">/);
  assert.equal(await readFile(join(config.outDir, 'ads.txt'), 'utf8'), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  const sm = await readFile(join(config.outDir, 'sitemap.xml'), 'utf8');
  assert.match(sm, /<loc>https:\/\/example\.com\/teams\/H\.html<\/loc>/);
  assert.match(await readFile(join(config.outDir, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/example\.com\/sitemap\.xml/);
  const pr = await readFile(join(config.outDir, 'privacy.html'), 'utf8');
  assert.match(pr, /Google AdSense/);
  assert.match(pr, /adssettings\.google\.com/);
  // 設定が無ければ ads.txt は作らない
  const config2 = { ...base, outDir: join(tmp, 'pl-lab2') };
  await runBuild({ config: config2 });
  await assert.rejects(access(join(config2.outDir, 'ads.txt')));
});
