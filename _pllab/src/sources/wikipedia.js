// 取得元: Wikipedia 日本語版（CC BY-SA 4.0）
//
// 取得するもの（1日1回、1リクエストにまとめて取得）:
//   - Template:<年>年のパシフィック・リーグ順位表   … 勝利・敗戦・引分・順位（得点・失点は無し）
//   - Template:<球団名>の選手・スタッフ             … 所属選手（背番号・登録名・守備位置・支配下/育成）
//   - <年>年の日本プロ野球                          … 個人タイトル
// 個人成績（打率・防御率など）は含まれないため stats_level=none とし、画面では「未取得」と表示する。
//
// 出力は他の取得元と同じ CSV 形式（validate.js でそのまま検証できる）。
import { createHash } from 'node:crypto';
import { toCsv } from '../csv.js';
import { cleanWikitext } from '../moves/wikipedia.js';
import { parseWikitable, firstLinkTarget } from './wikitable.js';
import { FILES } from '../schema.js';

const API = 'https://ja.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TEAMS = [
  { team_id: 'F', name: '北海道日本ハムファイターズ', short_name: '日本ハム', home: '北海道', stadium: 'エスコンフィールドHOKKAIDO', color: '#0b4ea2' },
  { team_id: 'E', name: '東北楽天ゴールデンイーグルス', short_name: '楽天', home: '宮城県', stadium: '楽天モバイル 最強パーク宮城', color: '#85002a' },
  { team_id: 'L', name: '埼玉西武ライオンズ', short_name: '西武', home: '埼玉県', stadium: 'ベルーナドーム', color: '#1f3f80' },
  { team_id: 'M', name: '千葉ロッテマリーンズ', short_name: 'ロッテ', home: '千葉県', stadium: 'ZOZOマリンスタジアム', color: '#333333' },
  { team_id: 'B', name: 'オリックス・バファローズ', short_name: 'オリックス', home: '大阪府・兵庫県', stadium: '京セラドーム大阪', color: '#9a7b2f' },
  { team_id: 'H', name: '福岡ソフトバンクホークス', short_name: 'ソフトバンク', home: '福岡県', stadium: 'みずほPayPayドーム福岡', color: '#c98a00' },
];
const BY_NAME = new Map(TEAMS.flatMap((t) => [[t.name, t.team_id], [t.short_name, t.team_id]]));

export const standingsTitle = (y) => `Template:${y}年のパシフィック・リーグ順位表`;
export const rosterTitle = (t) => `Template:${t.name}の選手・スタッフ`;
export const yearTitle = (y) => `${y}年の日本プロ野球`;

function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
}

/** 記事名から安定した選手IDを作る（移籍・登録名変更でも記事名は通常変わらない） */
export function playerIdFor(key) {
  return 'w' + createHash('sha1').update(key).digest('hex').slice(0, 10);
}

/** 順位表テンプレート {{NPB順位表 |チーム名|勝|敗|分|監督 ...}} */
export function parseStandings(wikitext) {
  const rows = [];
  let champion = null;
  const resultMarks = {};
  for (const m of wikitext.matchAll(/\|(\d)結果=([^|\n}]*)/g)) resultMarks[Number(m[1])] = m[2];
  for (const line of wikitext.split('\n')) {
    const m = /^\|([^|=]+)\|(\d+)\|(\d+)\|(\d+)(?:\||$)/.exec(line.trim());
    if (!m) continue;
    const team_id = BY_NAME.get(m[1].trim());
    if (!team_id) continue;
    const rank = rows.length + 1;
    rows.push({ team_id, w: Number(m[2]), l: Number(m[3]), t: Number(m[4]), g: Number(m[2]) + Number(m[3]) + Number(m[4]), official_rank: rank });
    if (/v/.test(resultMarks[rank] || '')) champion = team_id;
  }
  return { rows, champion };
}

/** 選手・スタッフのテンプレートから支配下・育成選手を取り出す */
export function parseRoster(wikitext, team_id) {
  const out = [];
  // 子 Navbox ごとに「支配下選手」「育成選手」「監督・コーチ」を判定
  const blocks = wikitext.split(/\{\{Navbox/).slice(1);
  for (const b of blocks) {
    const title = /\|\s*title\s*=\s*([^\n]+)/.exec(b)?.[1] || '';
    const type = /育成/.test(title) ? '育成' : /支配下/.test(title) ? '支配下' : null;
    if (!type) continue;
    const groups = {};
    for (const m of b.matchAll(/\|\s*group(\d+)\s*=\s*([^\n|]+)/g)) groups[m[1]] = m[2].trim();
    const listRe = /\|\s*list(\d+)\s*=([\s\S]*?)(?=\n\|\s*(?:group|list)\d+\s*=|\n\}\})/g;
    for (const m of b.matchAll(listRe)) {
      const position = groups[m[1]];
      if (!['投手', '捕手', '内野手', '外野手'].includes(position)) continue;
      for (const item of m[2].matchAll(/\{\{nowrap\|\s*(\d+)\s+(\[\[[^\]]+\]\]|[^}（(]+)/gi)) {
        const raw = decodeEntities(item[2]);
        const target = firstLinkTarget(raw);
        const name = cleanWikitext(raw).replace(/\s+/g, ' ').trim();
        if (!name) continue;
        out.push({ team_id, number: item[1], name, position, roster_type: type, wiki_title: target || '', key: target || `${team_id}:${name}` });
      }
    }
  }
  return out;
}

/** 年の記事の「個人タイトル」表から、パ・リーグ側の受賞者を取り出す */
export function parseTitles(wikitext) {
  const at = wikitext.search(/^=+\s*個人タイトル\s*=+/m);
  if (at < 0) return [];
  const grid = parseWikitable(wikitext, at);
  if (!grid || grid.length < 3) return [];
  // 1行目: リーグ見出し、2行目: 列見出し。パ・リーグの「選手・球団・成績」列を探す
  const head = grid[0].map((c) => c?.text || '');
  const plCol = head.findIndex((h) => h.includes('パシフィック'));
  if (plCol < 0) return [];
  const out = [];
  const seen = new Set();
  for (const row of grid.slice(2)) {
    const title = row[0]?.text;
    const pl = row[plCol];
    const team = row[plCol + 1]?.text;
    const value = row[plCol + 2]?.text || '';
    if (!title || !pl || !pl.text || !team) continue;
    const team_id = BY_NAME.get(team);
    if (!team_id) continue;
    const k = `${title}|${pl.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ title, player: pl.text, team_id, value, wiki_title: firstLinkTarget(pl.raw) || '' });
  }
  return out;
}

/** タイトル受賞者を所属選手に結びつける（記事名 → 登録名の順で照合） */
export function linkTitles(titles, players) {
  const norm = (s) => s.replace(/\s/g, '').replace(/^[A-Z]\./, '');
  const byWiki = new Map();
  for (const t of titles) if (t.wiki_title) byWiki.set(norm(t.player), t.wiki_title);
  return titles.map((t) => {
    const wiki = t.wiki_title || byWiki.get(norm(t.player)) || '';
    const p = players.find((x) => (wiki && x.wiki_title === wiki) || (x.team_id === t.team_id && norm(x.name) === norm(t.player)));
    return { ...t, player_id: p ? p.player_id : '' };
  });
}

async function apiQuery(titles, { fetchImpl, userAgent, retryDelayMs }) {
  const params = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main', titles: titles.join('|'), format: 'json', formatversion: '2', redirects: '1', maxlag: '5' });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(`${API}?${params}`, { headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent }, signal: AbortSignal.timeout(60000) });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error(`HTTP ${res.status}`), { wait: ra > 0 ? Math.min(ra, 120) * 1000 : null });
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const j = await res.json();
      if (j.error) throw new Error(`API エラー: ${j.error.code}`);
      const pages = {};
      for (const p of j.query.pages) {
        if (p.missing || !p.revisions) continue;
        pages[p.title] = { revid: p.revisions[0].revid, text: p.revisions[0].slots.main.content };
      }
      return pages;
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      if (attempt < 3) await sleep(e.wait ?? retryDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Wikipedia の取得に失敗しました: ${lastErr?.message}`);
}

function jstToday(now) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 日付からおおよその期間区分を決める（公式日程ではなく目安） */
export function phaseFor(dateStr, season) {
  const [y, m] = dateStr.split('-').map(Number);
  if (y > season) return 'offseason';
  if (m <= 2) return 'preseason';
  if (m === 3) return 'preseason';
  if (m >= 11) return 'offseason';
  if (m === 10) return 'postseason';
  return 'regular';
}

export function wikipediaSource({ fetchImpl = globalThis.fetch, userAgent = 'pl-lab-updater/1.0 (unofficial baseball fan site)', now = () => new Date(), retryDelayMs = 5000 } = {}) {
  let cache = null;
  async function load() {
    if (cache) return cache;
    const today = jstToday(now());
    const y = Number(today.slice(0, 4));
    // 今年と前年の順位表・今年の記事・6球団の選手一覧を 1 リクエストで取得
    const titles = [standingsTitle(y), standingsTitle(y - 1), standingsTitle(y - 2), yearTitle(y), yearTitle(y - 1), ...TEAMS.map(rosterTitle)];
    const pages = await apiQuery(titles, { fetchImpl, userAgent, retryDelayMs });
    const seasons = [y, y - 1, y - 2].filter((s) => pages[standingsTitle(s)]).sort();
    if (!seasons.length) throw new Error('順位表のテンプレートが見つかりません');
    cache = { pages, seasons, today, current: seasons[seasons.length - 1] };
    return cache;
  }
  return {
    id: 'wikipedia',
    label: 'Wikipedia 日本語版（CC BY-SA 4.0）',
    isDemo: false,
    async listSeasons() {
      return (await load()).seasons;
    },
    async fetchSeason(season) {
      const { pages, today, current } = await load();
      const st = parseStandings(pages[standingsTitle(season)].text);
      const isCurrent = season === current;
      const out = {};
      const revs = [`${standingsTitle(season)}（版 ${pages[standingsTitle(season)].revid}）`];
      let players = [];
      if (isCurrent) {
        for (const t of TEAMS) {
          const pg = pages[rosterTitle(t)];
          if (!pg) throw new Error(`${rosterTitle(t)} が見つかりません`);
          revs.push(`${rosterTitle(t)}（版 ${pg.revid}）`);
          players.push(...parseRoster(pg.text, t.team_id));
        }
        players = players.map((p) => ({ ...p, player_id: playerIdFor(p.key) }));
        // 同じ記事名が2球団に出る場合（テンプレート更新の途中など）は後の行を除く
        const seen = new Set();
        players = players.filter((p) => !seen.has(p.player_id) && seen.add(p.player_id));
      }
      const yt = pages[yearTitle(season)];
      const titles = isCurrent && yt ? linkTitles(parseTitles(yt.text), players) : [];
      if (yt && isCurrent) revs.push(`${yearTitle(season)}（版 ${yt.revid}）`);
      const asOf = isCurrent ? today : `${season}-10-31`;
      const meta = [
        { key: 'season', value: season },
        { key: 'as_of_date', value: asOf < `${season}-03-01` ? `${season}-03-01` : asOf },
        { key: 'phase', value: isCurrent ? phaseFor(today, season) : 'offseason' },
        { key: 'champion_team_id', value: st.champion || '' },
        { key: 'source_name', value: 'Wikipedia 日本語版（CC BY-SA 4.0）' },
        { key: 'source_url', value: `https://ja.wikipedia.org/wiki/${encodeURIComponent(yearTitle(season))}` },
        { key: 'note', value: '得点・失点と個人成績は取得元に無いため掲載していません。' },
        { key: 'source_detail', value: revs.join('、') },
        { key: 'stats_level', value: 'none' },
        { key: 'roster_note', value: isCurrent ? `所属選手は Wikipedia の各球団「選手・スタッフ」テンプレートの記載（${today} 取得、支配下・育成を含む）です。` : '' },
      ];
      out['meta.csv'] = toCsv(['key', 'value'], meta);
      out['teams.csv'] = toCsv(['team_id', 'name', 'short_name', 'home', 'stadium', 'color'], TEAMS);
      out['standings.csv'] = toCsv(['team_id', 'g', 'w', 'l', 't', 'rs', 'ra', 'official_rank'], st.rows);
      out['players.csv'] = toCsv(['player_id', 'team_id', 'name', 'name_kana', 'number', 'position', 'throws', 'bats', 'birth_date', 'roster_type', 'wiki_title'], players.map((p) => ({ ...p, name_kana: '', throws: '', bats: '', birth_date: '' })));
      out['batting.csv'] = FILES.batting.columns.filter((c) => c.need).map((c) => c.csv).join(',') + '\n';
      out['pitching.csv'] = FILES.pitching.columns.filter((c) => c.need).map((c) => c.csv).join(',') + '\n';
      if (titles.length) out['titles.csv'] = toCsv(['title', 'player', 'team_id', 'value', 'player_id'], titles);
      return out;
    },
  };
}
