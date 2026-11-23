// 画面生成: 保存済みの正常データ（data/store/current.json）と更新状態から静的サイトを生成する
//
//   node src/build.js
//
// 取得・検証は行わない（update.js の役割）。保存データが無い場合は「準備中」ページを出す。
import { mkdir, readFile, rm, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { paths, readJson } from './store.js';
import { buildSeasonModel } from './model.js';
import { GLOSSARY } from './render/glossary.js';
import { renderIndex } from './render/page-index.js';
import { renderTeam } from './render/page-team.js';
import { renderPlayer } from './render/page-player.js';
import { renderList, playersJson } from './render/page-list.js';
import { renderAbout } from './render/page-about.js';
import { renderMoves } from './render/page-moves.js';
import { renderPrivacy } from './render/page-privacy.js';
import { loadNotes } from './notes.js';
import { loadTodayPicks } from './today.js';
import { buildHistory } from './history.js';
import { loadColumns, renderColumnIndex, renderColumn } from './render/page-columns.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = '.pllab-generated';

async function safeClean(dir) {
  // 生成物のディレクトリだけを消す（誤って別の場所を消さないよう、目印ファイルを確認）
  try {
    await stat(join(dir, MARKER));
  } catch {
    try {
      const items = await readdir(dir);
      if (items.length > 0) throw new Error(`出力先 ${dir} に生成物ではないファイルがあります。削除しないで中止します。`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MARKER), 'このディレクトリは _pllab/src/build.js が生成します。手で編集しないでください。\n');
}

async function out(dir, rel, content) {
  const p = join(dir, rel);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, content);
}

async function readLogTail(file, n = 10) {
  try {
    const lines = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean);
    return lines.slice(-n).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export async function runBuild({ config = loadConfig() } = {}) {
  const p = paths(config.storeDir);
  const store = await readJson(p.current);
  const status = (await readJson(p.status)) || {};
  const dir = config.outDir;
  if (basename(dir) === '' || dir === '/' ) throw new Error('出力先が不正です');
  await safeClean(dir);

  for (const f of ['style.css', 'app.js', 'players.js', 'moves.js']) await copyFile(join(HERE, 'assets', f), join(dir, 'assets', f)).catch(async () => {
    await mkdir(join(dir, 'assets'), { recursive: true });
    await copyFile(join(HERE, 'assets', f), join(dir, 'assets', f));
  });
  await out(dir, 'assets/glossary.js', `window.PL_GLOSSARY=${JSON.stringify(GLOSSARY)};\n`);

  if (!store) {
    await out(
      dir,
      'index.html',
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${config.siteName}（準備中）</title><link rel="stylesheet" href="assets/style.css"></head><body><main class="wrap"><h1>${config.siteName}</h1><p class="notice stale">まだ正常に取得できたデータがありません。${status.last_error ? `最後の取得エラー: ${String(status.last_error).replace(/</g, '&lt;')}` : ''}</p><p>非公式のファンサイトです。</p></main></body></html>`,
    );
    return { pages: 1, empty: true };
  }

  const data = store.data;
  const seasons = Object.keys(data.seasons).map(Number).sort((a, b) => a - b);
  const models = seasons.map((s) => buildSeasonModel(data.seasons[s]));
  const S = models[models.length - 1];
  const ctx = {
    site: { name: config.siteName, staleHours: config.staleHours },
    status,
    S,
    demo: data.source.isDemo,
    sourceLabel: data.source.label,
    th: config.thresholds,
    analytics: config.analytics || {},
    siteUrl: (config.siteUrl || '').replace(/\/+$/, ''),
    basePath: config.basePath || '/pl-lab/',
    adsense: config.adsense || {},
    noteProfileUrl: config.note?.profileUrl || '',
    repoSlug: config.repo || '',
    moves: await readJson(join(config.storeDir, 'moves.json')),
    movesStatus: await readJson(join(config.storeDir, 'moves-status.json')),
  };
  const nl = await loadNotes(join(config.inputDir, 'notes.csv'));
  for (const e of nl.errors) console.warn(`⚠ ${e}`);
  ctx.notes = nl.notes;
  ctx.columns = await loadColumns(config.columnsDir);
  ctx.todayPicks = await loadTodayPicks(join(config.inputDir, 'today.csv'));
  const ps = await readJson(join(config.storeDir, 'player-stats.json'));
  ctx.history = ps ? buildHistory(ps, [...S.players.values()], S.meta.season) : null;
  let pages = 0;
  const pageList = [];
  const base = ctx.siteUrl || `https://tsuidenishirabeta2026-hue.github.io${ctx.basePath.replace(/\/+$/, '')}`;
  const write = async (rel, html) => {
    const url = `${base}/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
    await out(dir, rel, html.replace('<!--PL_CANONICAL-->', `<link rel="canonical" href="${url}">`));
    pageList.push(url);
    pages++;
  };

  await write('index.html', renderIndex(ctx));
  await write('about.html', renderAbout(ctx, await readLogTail(config.logFile)));
  if (ctx.moves) await write('moves.html', renderMoves(ctx, ctx.moves, ctx.movesStatus));
  await write('privacy.html', renderPrivacy(ctx));
  await write('columns/index.html', renderColumnIndex(ctx));
  for (const c of ctx.columns) await write(`columns/${c.slug}.html`, renderColumn(ctx, c));
  for (const tid of S.teams.keys()) await write(`teams/${tid}.html`, renderTeam(ctx, tid, models));
  await write('players/index.html', renderList(ctx));
  await out(dir, 'data/players.json', JSON.stringify(playersJson(models, S.meta.season, ctx.history)));
  await out(dir, 'data/status.json', JSON.stringify({ ...status, season: S.meta.season, as_of_date: S.meta.as_of_date, phase: S.meta.phase, demo: ctx.demo }, null, 1));

  // 同姓同名の検出（シーズン×登録名）
  const sameName = new Map();
  for (const M of models) {
    for (const pl of M.players.values()) {
      const k = `${M.meta.season}|${pl.name}`;
      if (!sameName.has(k)) sameName.set(k, []);
      sameName.get(k).push(pl);
    }
  }
  // 選手IDごとに全シーズンの記録をまとめ、1選手1ページ
  const byId = new Map();
  for (const M of models) {
    for (const pl of M.players.values()) {
      if (!byId.has(pl.id)) byId.set(pl.id, []);
      byId.get(pl.id).push({ S: M, p: pl });
    }
  }
  for (const [id, entries] of byId) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`選手ID "${id}" にファイル名に使えない文字が含まれています`);
    await write(`players/${id}.html`, renderPlayer(ctx, entries, sameName));
  }
  // 検索エンジン向け（独自ドメインのルートに置かれたときに有効）
  const today = new Date().toISOString().slice(0, 10);
  await out(dir, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pageList.map((u) => `<url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  await out(dir, 'robots.txt', `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
  // AdSense の ads.txt（独自ドメインのルートに必要）
  const ac = ctx.adsense?.client || '';
  if (ctx.siteUrl && /^ca-pub-\d{16}$/.test(ac)) await out(dir, 'ads.txt', `google.com, ${ac.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
  return { pages, players: byId.size, season: S.meta.season };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runBuild();
  console.log(`✔ サイトを生成しました: ${JSON.stringify(r)}`);
}
