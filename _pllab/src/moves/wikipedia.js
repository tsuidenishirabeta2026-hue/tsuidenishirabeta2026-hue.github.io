// 移籍・契約などの動き: Wikipedia 日本語版「<年>年の日本プロ野球」の「できごと」節から抽出する。
//
// 利用条件（2026-11 確認）:
//   - 本文は CC BY-SA 4.0。再利用時は記事へのリンク（帰属表示）、ライセンス表示、改変した旨の表示が必要。
//     改変・追加した文章も CC BY-SA 4.0 で提供する。
//   - API の利用は可。サーバーに過度な負荷をかけないこと（1日1〜2リクエスト程度）。
//   - 記事は有志が編集するため、誤り・記載漏れ・遅れがありうる（画面に明記する）。
const API = 'https://ja.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const PL_TEAMS = [
  { id: 'F', names: ['北海道日本ハムファイターズ', '日本ハム'] },
  { id: 'E', names: ['東北楽天ゴールデンイーグルス', '楽天'] },
  { id: 'L', names: ['埼玉西武ライオンズ', '西武'] },
  { id: 'M', names: ['千葉ロッテマリーンズ', 'ロッテ'] },
  { id: 'B', names: ['オリックス・バファローズ', 'オリックス'] },
  { id: 'H', names: ['福岡ソフトバンクホークス', 'ソフトバンク'] },
];

// 分類（上から順に判定。1件に複数付くことがある）
export const CATEGORIES = [
  ['トレード', /トレード/],
  ['FA', /FA権|フリーエージェント|FA宣言/],
  ['ポスティング・海外', /ポスティング|MLB移籍|メジャー/],
  ['戦力外・退団', /契約を結ばない|契約は締結しない|契約を締結しない|契約を行わない|戦力外|退団|自由契約|ウエイバー/],
  ['現役引退', /引退/],
  ['獲得・入団・契約', /獲得|入団|契約合意|合意に達した|契約延長|育成契約|支配下/],
  ['契約更改', /契約更改|年俸/],
  ['首脳陣', /監督|コーチ/],
  ['ドラフト', /ドラフト/],
  ['背番号', /背番号/],
];

export function articleTitle(year) {
  return `${year}年の日本プロ野球`;
}

/** ウィキ記法を表示用のテキストにする（改変: 記法・脚注・テンプレートの除去） */
export function cleanWikitext(s) {
  let t = s;
  t = t.replace(/<!--[\s\S]*?-->/g, '');
  t = t.replace(/<ref[^>]*\/>/g, '');
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  t = t.replace(/\{\{仮リンク\|([^|}]+)[^}]*\}\}/g, '$1');
  t = t.replace(/\{\{by\|(\d+)年?\}\}/g, '$1年');
  for (let i = 0; i < 3; i++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');
  t = t.replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1');
  t = t.replace(/'''?/g, '');
  t = t.replace(/<[^>]+>/g, '');
  return t.replace(/[ \t]+/g, ' ').trim();
}

/** 1つの出来事に付いた脚注から出典（サイト名・URL）を取り出す */
export function extractSources(raw) {
  const out = [];
  const re = /<ref[^>]*>([\s\S]*?)<\/ref>/g;
  let m;
  while ((m = re.exec(raw))) {
    const body = m[1];
    const url = /\|\s*url\s*=\s*([^|}\s]+)/.exec(body)?.[1] || /\[(https?:\/\/[^\s\]]+)/.exec(body)?.[1];
    if (!url || !/^https?:\/\//.test(url)) continue;
    const site = /\|\s*(?:website|publisher|work)\s*=\s*([^|}]+)/.exec(body)?.[1]?.trim();
    const date = /\|\s*date\s*=\s*([^|}]+)/.exec(body)?.[1]?.trim();
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    if (!out.some((x) => x.url === url)) out.push({ url, site: cleanWikitext(site || host), date: date || null });
  }
  return out;
}

export function teamsIn(text) {
  return PL_TEAMS.filter((t) => t.names.some((n) => text.includes(n))).map((t) => t.id);
}

export function categorize(text) {
  const cats = CATEGORIES.filter(([, re]) => re.test(text)).map(([c]) => c);
  return cats.length ? cats : ['その他'];
}

/**
 * 「できごと」節を解析し、パ・リーグ球団に関係する出来事を返す。
 * @returns {{ events: Array, months: number }}
 */
export function parseEvents(wikitext, year) {
  const start = wikitext.search(/^==\s*できごと\s*==/m);
  if (start < 0) return { events: [], months: 0 };
  const rest = wikitext.slice(start);
  const next = rest.slice(2).search(/^==[^=]/m);
  const body = next < 0 ? rest : rest.slice(0, next + 2);
  const events = [];
  let month = null;
  let day = null;
  let months = 0;
  let cur = null;
  const flush = () => {
    if (cur) {
      const text = cleanWikitext(cur.raw);
      const details = cur.subs.map(cleanWikitext).filter(Boolean);
      const all = [text, ...details].join(' ');
      const teams = teamsIn(all);
      if (text && teams.length) {
        events.push({
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          text,
          details,
          teams,
          categories: categorize(text + ' ' + details.join(' ')),
          sources: extractSources(cur.raw + cur.subs.join(' ')),
        });
      }
    }
    cur = null;
  };
  for (const line of body.split('\n')) {
    const mm = /^===\s*(\d{1,2})月\s*===/.exec(line);
    if (mm) {
      flush();
      month = Number(mm[1]);
      day = null;
      months++;
      continue;
    }
    const dm = /^\*\s*(?:\[\[\d{1,2}月(\d{1,2})日(?:\|[^\]]*)?\]\]|(\d{1,2})日)/.exec(line);
    if (dm && !line.startsWith('**')) {
      flush();
      day = Number(dm[1] || dm[2]);
      continue;
    }
    if (/^\*\*\*/.test(line)) {
      if (cur) cur.subs.push(line.replace(/^\*+\s*/, ''));
      continue;
    }
    if (/^\*\*/.test(line)) {
      flush();
      if (month && day) cur = { raw: line.replace(/^\*+\s*/, ''), subs: [] };
      continue;
    }
    if (cur && line.trim() && !line.startsWith('*') && !line.startsWith('=')) cur.raw += ' ' + line.trim();
  }
  flush();
  return { events, months };
}

/**
 * 記事の wikitext を API で取得する（存在しない記事は null）。
 * 429/5xx は Retry-After を尊重して最大3回まで再試行。
 */
export async function fetchArticle(title, { fetchImpl = globalThis.fetch, userAgent, retryDelayMs = 5000 } = {}) {
  const params = new URLSearchParams({ action: 'parse', page: title, prop: 'wikitext|revid', format: 'json', formatversion: '2', redirects: '1', maxlag: '5' });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(`${API}?${params}`, { headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        throw Object.assign(new Error(`HTTP ${res.status}`), { wait: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1000 : null });
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const j = await res.json();
      if (j.error) {
        if (j.error.code === 'missingtitle') return null;
        if (j.error.code === 'maxlag') throw new Error('サーバー混雑（maxlag）');
        throw Object.assign(new Error(`API エラー: ${j.error.code}`), { fatal: true });
      }
      return { title: j.parse.title, revid: j.parse.revid, wikitext: j.parse.wikitext };
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      if (attempt < 3) await sleep(e.wait ?? retryDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Wikipedia「${title}」の取得に失敗しました: ${lastErr?.message}`);
}
