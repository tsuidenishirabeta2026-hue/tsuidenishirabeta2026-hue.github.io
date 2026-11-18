// note 記事の下書き用に、保存済みデータから選手の数値を書き出す（記事の数字の転記ミスを防ぐため）
//   node scripts/article-data.js 栗原陵矢 平良海馬 ...
// 出力: 年度別成績（記事の最新年度とその前年）、前年比、リーグ平均との差、出典（記事名・版番号）
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { readJson, paths } from '../src/store.js';
import { buildSeasonModel } from '../src/model.js';
import { buildHistory, playerInsight } from '../src/history.js';
import { battingRates, pitchingRates, outsToIp } from '../src/metrics.js';

const config = loadConfig();
const cur = await readJson(paths(config.storeDir).current);
const ps = await readJson(join(config.storeDir, 'player-stats.json'));
const S = buildSeasonModel(cur.data.seasons[cur.data.current_season]);
const H = buildHistory(ps, [...S.players.values()], S.meta.season);
console.log('# 年ごとの記事更新率と比較母集団');
for (const s of Object.values(H.seasons).sort((a, b) => b.year - a.year)) console.log(`${s.year}: 更新率 ${(s.coverage * 100).toFixed(0)}%（${s.updated}/${s.articles}）、野手 ${s.batPlayers}人・投手 ${s.pitPlayers}人、平均を使える: ${s.usable}`);
for (const name of process.argv.slice(2)) {
  const p = [...S.players.values()].find((x) => x.name === name || x.info.wiki_title === name);
  if (!p) {
    console.log(`\n## ${name}: 所属選手に見つかりません`);
    continue;
  }
  const h = H.per.get(p.id);
  const I = playerInsight(H, p);
  console.log(`\n## ${p.name}（${S.teams.get(p.info.team_id).short_name}・${p.info.position}・背番号${p.info.number}） 出典: Wikipedia「${p.info.wiki_title}」版 ${h?.revid}（${h?.updatedThrough}年終了時点まで掲載）`);
  if (I.status !== 'ok') {
    console.log(`  状態: ${I.status}`);
    continue;
  }
  const years = [...(p.isPitcher ? h.pit : h.bat).values()].sort((a, b) => a.year - b.year);
  for (const y of years) {
    const t = y.tot;
    if (p.isPitcher) {
      const r = pitchingRates(t);
      console.log(`  ${y.year} ${y.teams.join('→')}: ${t.G}登板 ${t.GS}先発 ${outsToIp(t.outs)}回 ${t.W}勝${t.L}敗 ${t.SV}S ${t.HLD}H 奪三振${t.SO} 与四球${t.BB} 被本塁打${t.HR} 防御率${r.ERA.v?.toFixed(2)} WHIP${r.WHIP.v?.toFixed(2)} K9 ${r.K9.v?.toFixed(2)} BB9 ${r.BB9.v?.toFixed(2)} K/BB ${r.KBB.v?.toFixed(2)}`);
    } else {
      const r = battingRates(t);
      console.log(`  ${y.year} ${y.teams.join('→')}: ${t.G}試合 ${t.PA}打席 安打${t.H} 本塁打${t.HR} 打点${t.RBI} 盗塁${t.SB} 四球${t.BB} 三振${t.SO} 打率${r.AVG.v?.toFixed(3)} 出塁率${r.OBP.v?.toFixed(3)} 長打率${r.SLG.v?.toFixed(3)} OPS${r.OPS.v?.toFixed(3)} ISO${r.ISO.v?.toFixed(3)} BB%${(r.BBPCT.v * 100).toFixed(1)} K%${(r.KPCT.v * 100).toFixed(1)}`);
    }
  }
  console.log(`  前年比（${I.latest - 1}→${I.latest}、判定可: ${I.enough}）: ${I.yoy.map((m) => `${m.label} ${m.prev}→${m.cur}${m.improved ? '▲' : m.worse ? '▼' : ''}`).join(' / ')}`);
  if (I.league) console.log(`  リーグ平均との差（${I.league.year}年、母集団${I.league.population}人、更新率${(I.league.coverage * 100).toFixed(0)}%）: ${I.league.rows.map((r) => `${r.label} ${r.me}/${r.lg}`).join(' / ')}`);
  console.log(`  短評: ${I.comment.map((c) => `[${c.kind}] ${c.text}`).join(' ')}`);
}
