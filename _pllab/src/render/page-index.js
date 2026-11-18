import { esc, dateJa, dateShort, dateTimeJst, rate3, fixed, gb, signed, int, plain, pct } from '../format.js';
import { has, outsToIp } from '../metrics.js';
import { leaders, hotPlayers } from '../model.js';
import { page, term, teamChip, playerLink, PHASE_LABEL } from './layout.js';
import { movesList, isTransaction } from './page-moves.js';

function movesSection(ctx, root) {
  if (!ctx.moves) return '';
  const ev = ctx.moves.events.filter(isTransaction);
  return `<h2 id="moves">移籍・契約の最新の動き <span class="tag" style="vertical-align:middle">実データ</span></h2>
<p class="muted small">出典: Wikipedia 日本語版（CC BY-SA 4.0、改変あり）ほか。成績のデモ表示とは別に、実際の出来事を掲載しています。</p>
${movesList(ev, ctx.S, root, { limit: 6 })}
<p><a href="${root}moves.html"><b>移籍・契約の一覧へ（球団・分類で絞り込み）</b></a></p>`;
}

export function statusBlock(ctx) {
  const { S, status } = ctx;
  const champ = S.meta.champion_team_id ? S.teams.get(S.meta.champion_team_id) : null;
  return `<div class="card">
  <dl class="meta-list">
    <dt>対象シーズン</dt><dd>${S.meta.season}年（${PHASE_LABEL[S.meta.phase]}）</dd>
    <dt>データの基準日</dt><dd>${esc(dateJa(S.meta.as_of_date))} 終了時点</dd>
    <dt>最終取得成功</dt><dd>${esc(dateTimeJst(status.last_success_at))}</dd>
    ${status.last_result === 'failed' ? `<dt>最終取得試行</dt><dd>${esc(dateTimeJst(status.last_attempt_at))}（失敗）</dd>` : ''}
    ${champ ? `<dt>リーグ優勝</dt><dd>${teamChip(champ, ctx.root, { short: false })} <span class="tag champ">優勝決定</span></dd>` : ''}
  </dl>
  ${S.meta.note ? `<p class="muted small" style="margin:8px 0 0">${esc(S.meta.note)}</p>` : ''}
</div>`;
}

export function standingsTable(S, root, { highlight } = {}) {
  const rows = S.standings.rows
    .map((r) => {
      const t = S.teams.get(r.team_id);
      const rd = has(r.RD) ? (r.RD > 0 ? `+${r.RD}` : String(r.RD)) : '<span class="na">データなし</span>';
      return `<tr${highlight === r.team_id ? ' class="highlight"' : ''}>
  <td class="l"><b>${r.rank}</b>${r.tied ? '<span class="tag tie">同率</span>' : ''}</td>
  <td class="l name">${teamChip(t, root)}${S.meta.champion_team_id === r.team_id ? '<span class="tag champ">優勝</span>' : ''}</td>
  <td>${r.G}</td><td>${r.W}</td><td>${r.L}</td><td>${r.T}</td>
  <td><b>${rate3(r.pct)}</b></td><td>${gb(r.GB)}</td>
  <td>${int(r.RS)}</td><td>${int(r.RA)}</td><td>${rd}</td>
</tr>`;
    })
    .join('');
  return `<div class="table-scroll"><table class="sticky-first">
<caption class="sr-only">パ・リーグ順位表</caption>
<thead><tr><th class="l" scope="col">順位</th><th class="l" scope="col">球団</th><th scope="col">${term('試合')}</th><th scope="col">${term('勝利')}</th><th scope="col">${term('敗戦')}</th><th scope="col">${term('引分')}</th><th scope="col">${term('勝率')}</th><th scope="col">${term('ゲーム差', 'ゲーム差')}</th><th scope="col">${term('得点')}</th><th scope="col">${term('失点')}</th><th scope="col">${term('得失点差')}</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="muted small">順位は勝率（勝利÷(勝利+敗戦)、引き分けは除く）の順。${S.standings.usesOfficialRank ? '公式発表の順位を反映しています。' : '勝率が並んだ場合は「同率」と表示し、公式の順位決定方法による順位は公式発表が入力され次第反映します。'}</p>`;
}

function gameItem(g, S, root) {
  const tn = (id) => {
    const t = S.teams.get(id);
    return t ? teamChip(t, root) : esc(id);
  };
  let score = '';
  let sub = `${dateShort(g.date)}${g.start_time ? ` ${esc(g.start_time)}` : ''}　${esc(g.stadium || '')}`;
  if (g.status === 'final') {
    score = `${g.away_score} - ${g.home_score}`;
    if (g.away_score === g.home_score) sub += '　引き分け';
  } else if (g.status === 'postponed') score = '中止';
  else if (g.status === 'cancelled') score = '中止';
  else score = 'vs';
  return `<li><span class="t">${tn(g.away)}</span><span class="sc">${score}</span><span class="t home">${tn(g.home)}</span><span class="sub">${sub}</span></li>`;
}

export function gamesSection(S, root, { teamId = null, recentDays = 1, upcomingDays = 2, recentN = null } = {}) {
  if (!S.games.length) {
    return `<p class="empty">試合日程・結果のデータがないため表示できません。</p>`;
  }
  const mine = teamId ? S.games.filter((g) => g.home === teamId || g.away === teamId) : S.games;
  const finals = mine.filter((g) => g.status === 'final' && g.date <= S.meta.as_of_date);
  let recent;
  if (recentN) recent = finals.slice(-recentN).reverse();
  else {
    const dates = [...new Set(finals.map((g) => g.date))].slice(-recentDays);
    recent = finals.filter((g) => dates.includes(g.date));
  }
  const upcoming = mine.filter((g) => g.status === 'scheduled' && g.date > S.meta.as_of_date);
  const upDates = [...new Set(upcoming.map((g) => g.date))].slice(0, upcomingDays);
  const up = upcoming.filter((g) => upDates.includes(g.date));
  const upText =
    up.length > 0
      ? `<ul class="games">${up.map((g) => gameItem(g, S, root)).join('')}</ul>`
      : `<p class="empty">${S.meta.phase === 'offseason' ? `${S.meta.season}年のレギュラーシーズンは終了しました。予定されている試合はありません。` : '基準日より後の試合日程データはありません。'}</p>`;
  return `<p class="muted small">各カードは 左: ビジター／右: ホーム。日付・開始時刻・球場はカード下段。</p><div class="grid two">
<div><h3>直近の試合結果</h3>${recent.length ? `<ul class="games">${recent.map((g) => gameItem(g, S, root)).join('')}</ul>` : '<p class="empty">基準日までに終了した試合はありません。</p>'}</div>
<div><h3>今後の日程</h3>${upText}</div>
</div>`;
}

function leaderBox(title, key, list, fmt, root, S, note) {
  const body = list.length
    ? `<ol>${list
        .map(({ p, v, rank }) => `<li><span class="rk">${rank}</span><span class="who">${playerLink(p, root)}<span class="muted">${esc(S.teams.get(p.info.team_id)?.short_name || '')}</span></span><span class="val">${fmt(v)}</span></li>`)
        .join('')}</ol>`
    : '<p class="muted small">対象選手がいません。</p>';
  return `<div class="leader"><h3>${term(title, key)}<span class="muted small">${esc(note)}</span></h3>${body}</div>`;
}

export function leadersSection(S, root, th) {
  const n = th.rankingRows;
  const r3 = (v) => plain(rate3, { v });
  const f2 = (v) => v.toFixed(2);
  const i = (v) => String(v);
  const q = '規定打席以上';
  const qp = '規定投球回以上';
  const bat = [
    leaderBox('打率', '打率', leaders(S, 'bat', 'AVG', { qualified: true, n }), r3, root, S, q),
    leaderBox('本塁打', '本塁打', leaders(S, 'bat', 'HR', { n, min: 1 }), i, root, S, ''),
    leaderBox('打点', '打点', leaders(S, 'bat', 'RBI', { n, min: 1 }), i, root, S, ''),
    leaderBox('出塁率', '出塁率', leaders(S, 'bat', 'OBP', { qualified: true, n }), r3, root, S, q),
    leaderBox('OPS', 'OPS', leaders(S, 'bat', 'OPS', { qualified: true, n }), r3, root, S, q),
    leaderBox('盗塁', '盗塁', leaders(S, 'bat', 'SB', { n, min: 1 }), i, root, S, ''),
  ];
  const pit = [
    leaderBox('防御率', '防御率', leaders(S, 'pit', 'ERA', { qualified: true, higher: false, n }), f2, root, S, qp),
    leaderBox('勝利', '勝利', leaders(S, 'pit', 'W', { n, min: 1 }), i, root, S, ''),
    leaderBox('奪三振', '奪三振', leaders(S, 'pit', 'SO', { n, min: 1 }), i, root, S, ''),
    leaderBox('セーブ', 'セーブ', leaders(S, 'pit', 'SV', { n, min: 1 }), i, root, S, ''),
    leaderBox('ホールド', 'ホールド', leaders(S, 'pit', 'HLD', { n, min: 1 }), i, root, S, ''),
    leaderBox('WHIP', 'WHIP', leaders(S, 'pit', 'WHIP', { qualified: true, higher: false, n }), f2, root, S, qp),
  ];
  return `<h3>打撃部門</h3><div class="leader-grid">${bat.join('')}</div>
<h3>投手部門</h3><div class="leader-grid">${pit.join('')}</div>
<p class="muted small">率の部門は規定到達者が対象（規定打席 = 所属球団の試合数×3.1、規定投球回 = 試合数×1.0）。同じ値は同順位。</p>`;
}

export function hotSection(S, root, th) {
  const h = hotPlayers(S, th);
  if (!h.available) return '<p class="empty">試合別の成績データがないため、最近好調な選手は表示できません（通算成績からは推測しません）。</p>';
  const per = `${dateShort(h.from)}〜${dateShort(h.to)}（記録のある最終日 ${dateShort(h.to)} までの${h.days}日間）`;
  const bats = h.bats.length
    ? `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">選手</th><th>${term('打席')}</th><th>${term('打率')}</th><th>${term('本塁打')}</th><th>${term('OPS')}</th><th>通算OPS</th></tr></thead><tbody>${h.bats
        .map(({ p, r }) => `<tr><td class="l name">${playerLink(p, root)} <span class="muted">${esc(S.teams.get(p.info.team_id)?.short_name || '')}</span></td><td>${r.tot.PA}</td><td>${rate3(r.rates.AVG)}</td><td>${r.tot.HR}</td><td><b>${rate3(r.rates.OPS)}</b></td><td>${rate3(p.batRates.OPS)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="empty">条件を満たす打者がいません。</p>';
  const pits = h.pits.length
    ? `<div class="table-scroll"><table class="sticky-first"><thead><tr><th class="l">選手</th><th>${term('投球回')}</th><th>${term('防御率')}</th><th>${term('WHIP')}</th><th>${term('奪三振')}</th><th>通算防御率</th></tr></thead><tbody>${h.pits
        .map(({ p, r }) => `<tr><td class="l name">${playerLink(p, root)} <span class="muted">${esc(S.teams.get(p.info.team_id)?.short_name || '')}</span></td><td>${outsToIp(r.tot.outs)}</td><td><b>${fixed(r.rates.ERA)}</b></td><td>${fixed(r.rates.WHIP)}</td><td>${r.tot.SO}</td><td>${fixed(p.pitRates.ERA)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="empty">条件を満たす投手がいません。</p>';
  return `<p class="lead small">対象期間: <b>${per}</b>。打者は期間中${th.hotMinPA}打席以上でOPSが高い順、投手は期間中${th.hotMinOuts / 3}投球回以上で防御率が低い順（同値はWHIP順）。短期間の成績のため、偶然の影響が大きい点に注意してください。</p>
<div class="grid two"><div><h3>打者</h3>${bats}</div><div><h3>投手</h3>${pits}</div></div>`;
}

export function renderIndex(ctx) {
  const { S, th } = ctx;
  const root = './';
  ctx.root = root;
  const teamCards = S.standings.rows
    .map((r) => {
      const t = S.teams.get(r.team_id);
      return `<a class="team-card" style="--tc:${esc(t.color || 'var(--accent)')}" href="teams/${t.team_id}.html"><b>${esc(t.short_name)}</b><span>${r.rank}位　${r.W}勝${r.L}敗${r.T}分</span></a>`;
    })
    .join('');
  const body = `
<h1>パ・リーグ ${S.meta.season}年 成績</h1>
<p class="lead">${S.statsAvailable ? '順位表・主要ランキング・最近好調な選手をまとめて確認できます。' : '順位表・個人タイトル・移籍や契約の動きをまとめて確認できます。'}各指標名をタップすると説明が表示されます。</p>
${statusBlock(ctx)}
<h2 id="standings">順位表</h2>
${standingsTable(S, root)}
${S.meta.phase === 'offseason' || S.meta.phase === 'preseason' ? movesSection(ctx, root) : ''}
<h2 id="games">試合結果と日程</h2>
${gamesSection(S, root)}
${S.statsAvailable ? `<h2 id="leaders">主要ランキング</h2>
${leadersSection(S, root, th)}
<h2 id="hot">最近好調な選手</h2>
${hotSection(S, root, th)}` : titlesSection(S, root)}
${S.meta.phase === 'offseason' || S.meta.phase === 'preseason' ? '' : movesSection(ctx, root)}
<h2 id="teams">球団別ページ</h2>
<div class="team-cards">${teamCards}</div>
<h2>選手を探す</h2>
<p><a href="players/index.html"><b>${S.statsAvailable ? '選手一覧・成績表へ' : '所属選手一覧へ'}</b></a>（名前検索、球団・守備位置${S.statsAvailable ? '・年度の絞り込み、並べ替え' : 'の絞り込み'}）</p>
`;
  return page({ title: '', root, current: 'index', body, ctx });
}

export function titlesSection(S, root) {
  const rows = S.titles
    .map((t) => {
      const team = S.teams.get(t.team_id);
      const pl = t.player_id && S.players.get(t.player_id);
      return `<tr><td class="l">${esc(t.title)}</td><td class="l name">${pl ? playerLink(pl, root) : esc(t.player)}</td><td class="l">${teamChip(team, root)}</td><td>${esc(t.value || '')}</td></tr>`;
    })
    .join('');
  return `<h2 id="titles">${S.meta.season}年 パ・リーグ個人タイトル</h2>
${rows ? `<div class="table-scroll"><table class="sticky-first wrap"><thead><tr><th class="l">タイトル</th><th class="l">選手</th><th class="l">球団</th><th>成績</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="muted small">出典: Wikipedia 日本語版（CC BY-SA 4.0）の記載。同じタイトルに複数の選手がいる場合は同時受賞です。正式な記録は NPB の発表をご確認ください。</p>` : '<p class="empty">個人タイトルのデータはまだありません。</p>'}
<p class="notice info small"><strong>個人成績のランキング・好調な選手は表示していません。</strong>規約上利用できる、全選手の個人成績の取得元がないためです（<a href="${root}about.html#source">詳しく</a>）。</p>`;
}
