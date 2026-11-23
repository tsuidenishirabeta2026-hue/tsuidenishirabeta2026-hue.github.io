import { esc } from '../format.js';
import { battingRates } from '../metrics.js';
import { page, term, teamChip, playerLink } from './layout.js';
import { BAT_COLS, PIT_COLS, termHelp } from './cols.js';

/** 選手一覧ページ用の JSON（全シーズン分） */
export function playersJson(models, current, history = null) {
  const enc = (x) => {
    if (x && typeof x === 'object' && 'v' in x) return x.v === null ? (x.why === 'zero' ? 'z' : null) : Math.round(x.v * 10000) / 10000;
    return Number.isFinite(x) ? x : null;
  };
  const rows = [];
  for (const S of models) {
    for (const p of S.players.values()) {
      const ts = [...new Set(p.stints.map((s) => s.team_id))];
      const pick = (cols, tot, rates) => (tot ? Object.fromEntries(cols.map(([, k]) => [k, enc(rates && k in rates ? rates[k] : tot[k])])) : null);
      rows.push({
        s: S.meta.season,
        id: p.id,
        n: p.name,
        k: p.kana || '',
        ts,
        tn: ts.map((t) => S.teams.get(t)?.short_name || t).join('→'),
        pos: p.info.position,
        num: p.info.number || '',
        ...latestOf(history, p, S.meta.season === current),
        role: p.role,
        qb: p.qualifiedBat,
        qp: p.qualifiedPit,
        b: p.isPitcher ? null : pick(BAT_COLS, p.bat, p.batRates),
        p: p.isPitcher ? pick(PIT_COLS, p.pit, p.pitRates) : null,
      });
    }
  }
  const cur = models.find((m) => m.meta.season === current);
  return {
    current,
    seasons: models.map((m) => m.meta.season).sort((a, b) => b - a),
    noStats: models.filter((m) => !m.statsAvailable).map((m) => m.meta.season),
    teams: [...cur.teams.values()].map((t) => ({ id: t.team_id, name: t.short_name })),
    players: rows,
  };
}

export function renderList(ctx) {
  const root = '../';
  ctx.root = root;
  const { S } = ctx;
  // JavaScript が使えない環境向けの簡易一覧（球団別の名前リスト）
  const noscript = [...S.teams.values()]
    .map((t) => {
      const ps = [...S.players.values()].filter((p) => p.info.team_id === t.team_id).sort((a, b) => (a.kana || '').localeCompare(b.kana || '', 'ja'));
      return `<h3>${teamChip(t, root)}</h3><p>${ps.map((p) => playerLink(p, root)).join('、')}</p>`;
    })
    .join('');
  const body = `
<p class="breadcrumb"><a href="${root}index.html">トップ</a> › 選手一覧</p>
<h1>${S.statsAvailable ? '選手一覧・成績表' : '所属選手一覧'}</h1>
<p class="lead">${S.statsAvailable ? '名前（漢字・ひらがな・カタカナ）で検索し、球団・守備位置・年度で絞り込めます。表の見出しをタップすると並べ替えます。選手名をタップすると個別の成績と分析を表示します。' : (ctx.history ? '登録名で検索し、球団・守備位置で絞り込めます。見出しをタップすると並べ替えます。成績と年俸（推定）は Wikipedia の選手記事から作っています（成績は記事に載っている最新年度のもの）。選手名をタップすると、前年比・平均との差・短評を表示します。' : '登録名で検索し、球団・守備位置で絞り込めます。見出しをタップすると並べ替えます。個人成績は、規約上利用できる取得元がないため掲載していません。')}</p>
<div id="plist" data-src="${root}data/players.json">
  <div class="tabs" role="tablist" aria-label="野手と投手の切り替え">
    <button type="button" role="tab" data-tab="bat" aria-selected="true">野手</button>
    <button type="button" role="tab" data-tab="pit" aria-selected="false">投手</button>
  </div>
  <div class="filters">
    <label class="full">選手名で検索<input id="f-q" type="search" placeholder="例: たかだ／高田" autocomplete="off"></label>
    <label>球団<select id="f-team"></select></label>
    <label>守備位置・役割<select id="f-pos"></select></label>
    <label>年度<select id="f-season"></select></label>
    <label class="check full"><input id="f-qual" type="checkbox"><span id="f-qual-label">規定打席到達者のみ</span></label>
  </div>
  <p id="p-loading" class="muted">読み込み中…</p>
  <p id="p-count" class="result-count" aria-live="polite"></p>
  <div class="table-scroll" style="max-height:75vh"><table class="sticky-first"><thead id="p-thead"></thead><tbody id="p-tbody"></tbody></table></div>
  <details class="more"><summary>表の見方・用語の説明</summary>
    <p class="small">「データなし」は取得元にその項目がないこと、「算出不可」は分母が0（例: 打数0の打率、投球回0の防御率）で計算できないことを示します。0で埋めることはしていません。「規定」は規定打席（試合数×3.1）・規定投球回（試合数×1.0）に到達していることを示します。所属選手のうち出場記録のない選手も一覧に含めています（全選手表示時）。</p>
    ${termHelp(BAT_COLS)}
    ${termHelp(PIT_COLS)}
  </details>
</div>
<noscript><div class="notice info"><strong>JavaScript が無効のため、検索・並べ替えは使えません。</strong>以下の一覧から選手ページへ移動できます。</div>${noscript}</noscript>
<script src="${root}assets/players.js" defer></script>
`;
  return page({ title: S.statsAvailable ? '選手一覧・成績表' : '所属選手一覧', root, current: 'players', body, ctx, pageMeta: { pageType: 'list' } });
}

/** 選手一覧に出す「記事の最新年度」の成績（個人成績の取得元が無いシーズン用） */
function latestOf(H, p, isCurrent) {
  if (!H || !isCurrent) return {};
  const h = H.per.get(p.id);
  if (!h) return {};
  const sal = h.salary?.yen ?? null;
  const out = latestStats(h, p);
  return sal === null ? out : { ...out, sal };
}

function latestStats(h, p) {
  const years = p.isPitcher ? h.pit : h.bat;
  if (!years.size) return {};
  const y = Math.max(...years.keys());
  const t = years.get(y).tot;
  if (p.isPitcher) {
    const era = t.outs > 0 && t.ER !== null ? Math.round(((t.ER * 27) / t.outs) * 100) / 100 : t.outs === 0 ? 'z' : null;
    return { ly: y, sz: t.outs, km: era };
  }
  const o = battingRates(t).OPS;
  return { ly: y, sz: t.PA, km: o.v === null ? (o.why === 'zero' ? 'z' : null) : Math.round(o.v * 1000) / 1000 };
}
