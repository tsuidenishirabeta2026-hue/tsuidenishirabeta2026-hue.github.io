// デモデータ生成（動作確認用・架空）
//
//   node scripts/generate-demo.js [--out data/demo] [--as-of 2026-09-30] [--phase offseason]
//
// 実在の球団名は使うが、選手・成績はすべて乱数による試合シミュレーションで作った架空のもの。
// 試合単位で 1 打席ずつ計算するため、試合別成績・シーズン累計・順位表・状況別成績が互いに矛盾しない。
// 動作確認のため、以下のケースを意図的に含める:
//   - 同姓同名の選手（別球団・別ID）
//   - シーズン途中の移籍（同一IDで2球団に在籍行）
//   - 登録名の変更（2025年と2026年で名前が異なる同一ID）
//   - 出場のない所属選手、出場機会の少ない選手
//   - 取得できない項目（故意四球は全シーズン、盗塁死・併殺打は2025年に列なし = データなし）
//   - 延長12回引き分け、雨天中止と代替試合
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { toCsv } from '../src/csv.js';
import { ROOT } from '../src/config.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []),
);
const OUT = resolve(ROOT, args.out || 'data/demo');

// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20260401);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const normal = (m, s) => {
  const u = 1 - rnd();
  const v = rnd();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------------------------------------------------------------------------
const TEAMS = [
  { team_id: 'F', name: '北海道日本ハムファイターズ', short_name: '日本ハム', home: '北海道', stadium: 'エスコンフィールドHOKKAIDO', color: '#0b4ea2' },
  { team_id: 'E', name: '東北楽天ゴールデンイーグルス', short_name: '楽天', home: '宮城県', stadium: '楽天モバイル 最強パーク宮城', color: '#85002a' },
  { team_id: 'L', name: '埼玉西武ライオンズ', short_name: '西武', home: '埼玉県', stadium: 'ベルーナドーム', color: '#1f3f80' },
  { team_id: 'M', name: '千葉ロッテマリーンズ', short_name: 'ロッテ', home: '千葉県', stadium: 'ZOZOマリンスタジアム', color: '#333333' },
  { team_id: 'B', name: 'オリックス・バファローズ', short_name: 'オリックス', home: '大阪府・兵庫県', stadium: '京セラドーム大阪', color: '#9a7b2f' },
  { team_id: 'H', name: '福岡ソフトバンクホークス', short_name: 'ソフトバンク', home: '福岡県', stadium: 'みずほPayPayドーム福岡', color: '#c98a00' },
];
const TEAM = Object.fromEntries(TEAMS.map((t) => [t.team_id, t]));

const SURNAMES = ['青井', '赤松', '朝倉', '天野', '荒川', '飯塚', '石倉', '泉谷', '市原', '稲葉', '今泉', '岩城', '上原', '内海', '江口', '大石', '大槻', '岡部', '小田切', '笠井', '梶原', '片桐', '金森', '川瀬', '神田', '菊池', '北見', '木村', '久保田', '倉持', '黒沢', '小泉', '古賀', '小松', '近藤', '斎藤', '酒井', '佐久間', '笹本', '沢井', '柴崎', '島袋', '清水', '白石', '杉浦', '鈴鹿', '関口', '瀬戸', '高城', '高田', '竹中', '田村', '千葉', '塚原', '辻', '土屋', '寺岡', '富岡', '中条', '永井', '中野', '西岡', '野口', '萩原', '橋爪', '長谷部', '浜口', '早川', '平野', '広瀬', '福島', '藤代', '星野', '堀内', '前川', '牧田', '松浦', '丸山', '三浦', '水谷', '南', '宮園', '村瀬', '望月', '森下', '矢野', '山岸', '湯浅', '横溝', '吉住', '若林', '渡会'];
const GIVEN = ['蒼', '朝陽', '篤', '新', '郁人', '一輝', '海斗', '楓', '奏太', '和真', '岳', '貴之', '恭平', '慶', '健吾', '孝介', '颯', '駿', '翔', '俊介', '慎吾', '大河', '大地', '拓海', '匠', '健', '千尋', '恒平', '哲也', '智也', '直樹', '尚人', '陽', '遥斗', '久志', '大和', '悠真', '優斗', '湧', '洋平', '理人', '陸', '凌', '亮', '琉生', '玲', '蓮', '航', '亘'];
const KANA_S = { 青井: 'あおい', 赤松: 'あかまつ', 朝倉: 'あさくら', 天野: 'あまの', 荒川: 'あらかわ', 飯塚: 'いいづか', 石倉: 'いしくら', 泉谷: 'いずみや', 市原: 'いちはら', 稲葉: 'いなば', 今泉: 'いまいずみ', 岩城: 'いわき', 上原: 'うえはら', 内海: 'うつみ', 江口: 'えぐち', 大石: 'おおいし', 大槻: 'おおつき', 岡部: 'おかべ', 小田切: 'おだぎり', 笠井: 'かさい', 梶原: 'かじわら', 片桐: 'かたぎり', 金森: 'かなもり', 川瀬: 'かわせ', 神田: 'かんだ', 菊池: 'きくち', 北見: 'きたみ', 木村: 'きむら', 久保田: 'くぼた', 倉持: 'くらもち', 黒沢: 'くろさわ', 小泉: 'こいずみ', 古賀: 'こが', 小松: 'こまつ', 近藤: 'こんどう', 斎藤: 'さいとう', 酒井: 'さかい', 佐久間: 'さくま', 笹本: 'ささもと', 沢井: 'さわい', 柴崎: 'しばさき', 島袋: 'しまぶくろ', 清水: 'しみず', 白石: 'しらいし', 杉浦: 'すぎうら', 鈴鹿: 'すずか', 関口: 'せきぐち', 瀬戸: 'せと', 高城: 'たかぎ', 高田: 'たかだ', 竹中: 'たけなか', 田村: 'たむら', 千葉: 'ちば', 塚原: 'つかはら', 辻: 'つじ', 土屋: 'つちや', 寺岡: 'てらおか', 富岡: 'とみおか', 中条: 'なかじょう', 永井: 'ながい', 中野: 'なかの', 西岡: 'にしおか', 野口: 'のぐち', 萩原: 'はぎわら', 橋爪: 'はしづめ', 長谷部: 'はせべ', 浜口: 'はまぐち', 早川: 'はやかわ', 平野: 'ひらの', 広瀬: 'ひろせ', 福島: 'ふくしま', 藤代: 'ふじしろ', 星野: 'ほしの', 堀内: 'ほりうち', 前川: 'まえかわ', 牧田: 'まきた', 松浦: 'まつうら', 丸山: 'まるやま', 三浦: 'みうら', 水谷: 'みずたに', 南: 'みなみ', 宮園: 'みやぞの', 村瀬: 'むらせ', 望月: 'もちづき', 森下: 'もりした', 矢野: 'やの', 山岸: 'やまぎし', 湯浅: 'ゆあさ', 横溝: 'よこみぞ', 吉住: 'よしずみ', 若林: 'わかばやし', 渡会: 'わたらい' };
const KANA_G = { 蒼: 'あおい', 朝陽: 'あさひ', 篤: 'あつし', 新: 'あらた', 郁人: 'いくと', 一輝: 'かずき', 海斗: 'かいと', 楓: 'かえで', 奏太: 'そうた', 和真: 'かずま', 岳: 'がく', 貴之: 'たかゆき', 恭平: 'きょうへい', 慶: 'けい', 健吾: 'けんご', 孝介: 'こうすけ', 颯: 'はやて', 駿: 'しゅん', 翔: 'しょう', 俊介: 'しゅんすけ', 慎吾: 'しんご', 大河: 'たいが', 大地: 'だいち', 拓海: 'たくみ', 匠: 'たくみ', 健: 'たける', 千尋: 'ちひろ', 恒平: 'こうへい', 哲也: 'てつや', 智也: 'ともや', 直樹: 'なおき', 尚人: 'なおと', 陽: 'はる', 遥斗: 'はると', 久志: 'ひさし', 大和: 'やまと', 悠真: 'ゆうま', 優斗: 'ゆうと', 湧: 'ゆう', 洋平: 'ようへい', 理人: 'りひと', 陸: 'りく', 凌: 'りょう', 亮: 'りょう', 琉生: 'るい', 玲: 'れい', 蓮: 'れん', 航: 'わたる', 亘: 'わたる' };

const usedNames = new Set();
function makeName() {
  for (;;) {
    const s = pick(SURNAMES);
    const g = pick(GIVEN);
    const n = `${s} ${g}`;
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return { name: n, kana: `${KANA_S[s]} ${KANA_G[g]}` };
    }
  }
}

// ---------------------------------------------------------------------------
// 選手プール
let nextId = 10001;
const players = [];
function newPlayer(team, position, role, opts = {}) {
  const nm = opts.name ? { name: opts.name, kana: opts.kana } : makeName();
  const y = 1990 + Math.floor(rnd() * 17);
  const m = 1 + Math.floor(rnd() * 12);
  const d = 1 + Math.floor(rnd() * 28);
  const p = {
    player_id: `p${nextId++}`,
    team,
    name: nm.name,
    name_kana: nm.kana,
    position,
    role, // SP/RP/CL/SU (投手), REG/BENCH (野手), RES (出場なし)
    throws: rnd() < (position === '投手' ? 0.3 : 0.12) ? '左' : '右',
    bats: null,
    birth_date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    seasons: opts.seasons || [2025, 2026],
    // 能力（1.0 = リーグ平均）
    k: clamp(normal(1, 0.22), 0.5, 1.8),
    bb: clamp(normal(1, 0.28), 0.4, 2.0),
    hr: clamp(Math.exp(normal(0, 0.45)), 0.2, 2.8),
    hit: clamp(normal(1, 0.09), 0.75, 1.25),
    spd: clamp(Math.exp(normal(0, 0.6)), 0.15, 4),
    stamina: 22 + Math.floor(rnd() * 8),
  };
  if (position !== '投手') {
    const r = rnd();
    p.bats = r < 0.32 ? '左' : r < 0.38 ? '両' : '右';
    if (p.throws === '左' && p.bats === '右') p.bats = '左';
    if (role === 'REG') {
      p.hit *= 1.04;
      p.k *= 0.93;
    }
    if (position === '捕手') p.hr *= 0.75;
  } else {
    // 投手の能力差は打者より小さめにする（チーム間の極端な戦力差を避ける）
    p.k = 1 + (p.k - 1) * 0.7;
    p.bb = 1 + (p.bb - 1) * 0.7;
    p.hr = Math.sqrt(p.hr);
    p.hit = 1 + (p.hit - 1) * 0.6;
    p.bats = rnd() < 0.25 ? '左' : '右';
    if (role !== 'SP') p.k *= 1.1;
    if (role === 'CL') {
      p.k *= 1.15;
      p.hit *= 0.95;
    }
  }
  players.push(p);
  return p;
}

const rosterPlan = [
  ...Array(6).fill(['投手', 'SP']),
  ['投手', 'CL'],
  ['投手', 'SU'],
  ['投手', 'SU'],
  ...Array(5).fill(['投手', 'RP']),
  ['捕手', 'REG'],
  ['捕手', 'BENCH'],
  ...Array(5).fill(['内野手', 'REG']),
  ...Array(3).fill(['内野手', 'BENCH']),
  ...Array(4).fill(['外野手', 'REG']),
  ...Array(2).fill(['外野手', 'BENCH']),
  ['投手', 'RES'],
  ['外野手', 'RES'],
];
for (const t of TEAMS) {
  for (const [pos, role] of rosterPlan) newPlayer(t.team_id, pos, role);
}
// 2026年の新人（2025年は在籍なし）・2025年限りの選手
for (const t of TEAMS) {
  newPlayer(t.team_id, '内野手', 'BENCH', { seasons: [2026] });
  newPlayer(t.team_id, '投手', 'RP', { seasons: [2026] });
  newPlayer(t.team_id, '外野手', 'BENCH', { seasons: [2025] });
}
// 同姓同名（別球団・別ID）
const dupA = players.find((p) => p.team === 'F' && p.role === 'BENCH' && p.position === '内野手');
const dupB = players.find((p) => p.team === 'H' && p.role === 'RP');
dupA.name = dupB.name = '高田 翔';
dupA.name_kana = dupB.name_kana = 'たかだ しょう';
// 登録名の変更（2025年→2026年）
const renamed = players.find((p) => p.team === 'B' && p.role === 'REG' && p.position === '外野手');
renamed.oldName = renamed.name;
renamed.oldKana = renamed.name_kana;
renamed.name = renamed.name.split(' ')[1].length >= 2 ? renamed.name.split(' ')[1] : `${renamed.name.split(' ')[1]}斗`;
renamed.name_kana = renamed.name_kana.split(' ')[1];
// シーズン途中の移籍（2026-07-15 に L → E）
const traded = players.find((p) => p.team === 'L' && p.role === 'REG' && p.position === '内野手');
traded.trade = { date: '2026-07-15', to: 'E' };

// 背番号
for (const t of TEAMS) {
  const used = new Set();
  for (const p of players.filter((x) => x.team === t.team_id)) {
    let n;
    do {
      n = p.position === '投手' ? 11 + Math.floor(rnd() * 60) : 1 + Math.floor(rnd() * 66);
    } while (used.has(n));
    used.add(n);
    p.number = String(n);
  }
}
// 移籍後の背番号
traded.trade.number = '0';

// ---------------------------------------------------------------------------
// 1打席の結果
const LG = { SO: 0.195, BB: 0.082, HBP: 0.011, HR: 0.02, D: 0.042, T: 0.004, S: 0.142 };

function paOutcome(b, p, platoonSame) {
  const pl = platoonSame ? { k: 1.08, hit: 0.96, hr: 0.88 } : { k: 0.96, hit: 1.02, hr: 1.05 };
  const probs = {
    SO: LG.SO * b.k * p.k * pl.k,
    BB: LG.BB * b.bb * p.bb,
    HBP: LG.HBP,
    HR: LG.HR * b.hr * p.hr * pl.hr,
    D: LG.D * b.hit * p.hit * Math.sqrt(b.hr) * pl.hit,
    T: LG.T * b.spd * pl.hit,
    S: LG.S * b.hit * p.hit * pl.hit,
  };
  let r = rnd();
  for (const [e, pr] of Object.entries(probs)) {
    if (r < pr) return e;
    r -= pr;
  }
  return 'OUT';
}

const blankBat = () => ({ PA: 0, AB: 0, R: 0, H: 0, D: 0, T: 0, HR: 0, RBI: 0, SB: 0, CS: 0, BB: 0, HBP: 0, SO: 0, SH: 0, SF: 0, GDP: 0 });
const blankPit = () => ({ outs: 0, BF: 0, H: 0, HR: 0, BB: 0, HBP: 0, SO: 0, R: 0, ER: 0 });
const blankSplitB = () => ({ PA: 0, AB: 0, H: 0, D: 0, T: 0, HR: 0, BB: 0, HBP: 0, SO: 0, SF: 0 });
const blankSplitP = () => ({ BF: 0, AB: 0, H: 0, HR: 0, BB: 0, HBP: 0, SO: 0 });

// ---------------------------------------------------------------------------
function teamOn(p, date) {
  if (p.trade && date >= p.trade.date) return p.trade.to;
  return p.team;
}

function rosterFor(teamId, season, date) {
  return players.filter((p) => p.seasons.includes(season) && teamOn(p, season === 2026 ? date : '0000') === teamId);
}

function buildLineup(roster) {
  const bat = roster.filter((p) => p.position !== '投手' && p.role !== 'RES');
  const reg = bat.filter((p) => p.role === 'REG');
  const bench = bat.filter((p) => p.role === 'BENCH');
  const lineup = [];
  for (const p of reg) {
    if (rnd() < 0.9 || bench.length === 0) lineup.push(p);
    else lineup.push(bench.splice(Math.floor(rnd() * bench.length), 1)[0]);
  }
  while (lineup.length < 9 && bench.length) lineup.push(bench.splice(Math.floor(rnd() * bench.length), 1)[0]);
  // 9人を超えたら、移籍加入選手を優先して残し、能力の低い順に外す
  const q = (p) => (p.trade ? 99 : p.hit * (1 + p.hr * 0.3));
  while (lineup.length > 9) {
    let w = 0;
    lineup.forEach((p, i) => {
      if (q(p) < q(lineup[w])) w = i;
    });
    lineup.splice(w, 1);
  }
  // 打順: 出塁・長打力の高い順に大まかに並べる
  lineup.sort((a, b) => b.hit * (1 + b.hr * 0.3) * b.bb ** 0.3 - a.hit * (1 + a.hr * 0.3) * a.bb ** 0.3);
  const order = [lineup[2], lineup[1], lineup[0], lineup[3], lineup[4], lineup[5], lineup[6], lineup[7], lineup[8]].filter(Boolean);
  return order;
}

function simulateGame(game, season, ctx) {
  const sides = {};
  for (const side of ['away', 'home']) {
    const tid = game[side];
    const roster = rosterFor(tid, season, game.date);
    const sps = roster.filter((p) => p.role === 'SP');
    const state = ctx.teamState[tid];
    const starter = sps[state.rotation++ % sps.length];
    sides[side] = {
      tid,
      lineup: buildLineup(roster),
      idx: 0,
      starter,
      pen: roster.filter((p) => ['RP', 'SU', 'CL'].includes(p.role)),
      used: new Set([starter.player_id]),
      cur: null,
      apps: [],
      bat: new Map(),
    };
    sides[side].cur = newApp(sides[side], starter, 1, 0, true);
  }
  const score = { away: 0, home: 0 };
  let lead = null; // 最後に勝ち越した時点の情報
  const other = (s) => (s === 'away' ? 'home' : 'away');

  function newApp(side, p, inning, margin, gs) {
    const a = { p, gs, inning, enterMargin: margin, line: blankPit(), exitMargin: null };
    side.apps.push(a);
    return a;
  }
  function batLine(side, p) {
    if (!side.bat.has(p.player_id)) side.bat.set(p.player_id, { p, line: blankBat() });
    return side.bat.get(p.player_id).line;
  }
  function choosePitcher(fSide, inning) {
    const s = sides[fSide];
    const margin = score[fSide] - score[other(fSide)];
    const cur = s.cur;
    let change = false;
    if (cur.gs) change = cur.line.BF >= cur.p.stamina || inning >= 9 || (cur.line.R >= 5 && inning >= 4);
    else change = cur.line.outs >= 3 && !(Math.abs(margin) >= 5 && cur.line.outs < 6 && rnd() < 0.5);
    if (!change) return;
    const avail = s.pen.filter((p) => !s.used.has(p.player_id));
    if (avail.length === 0) return;
    let next = null;
    const cl = avail.find((p) => p.role === 'CL');
    const su = avail.filter((p) => p.role === 'SU');
    if (inning >= 9 && margin >= 1 && margin <= 3 && cl) next = cl;
    else if (inning >= 7 && Math.abs(margin) <= 3 && su.length) next = su[0];
    else {
      const rp = avail.filter((p) => p.role === 'RP');
      next = rp.length ? pick(rp) : avail[0];
    }
    cur.exitMargin = margin;
    s.used.add(next.player_id);
    s.cur = newApp(s, next, inning, margin, false);
  }

  function addSplitB(p, key, rec) {
    const m = ctx.splitB;
    const k = `${p.player_id}|${key}`;
    if (!m.has(k)) m.set(k, { player_id: p.player_id, split: key, ...blankSplitB() });
    const o = m.get(k);
    for (const [kk, v] of Object.entries(rec)) o[kk] += v;
  }
  function addSplitP(p, key, rec) {
    const m = ctx.splitP;
    const k = `${p.player_id}|${key}`;
    if (!m.has(k)) m.set(k, { player_id: p.player_id, split: key, ...blankSplitP() });
    const o = m.get(k);
    for (const [kk, v] of Object.entries(rec)) o[kk] += v;
  }

  function scoreRun(bSide, fSide, runner, batterLine, rbi) {
    score[bSide]++;
    batLine(sides[bSide], runner).R++;
    if (rbi && batterLine) batterLine.RBI++;
    const app = sides[fSide].cur;
    app.line.R++;
    if (rnd() > 0.06) app.line.ER++;
    const diff = score[bSide] - score[fSide];
    if (diff === 1) {
      lead = { side: bSide, winApp: sides[bSide].cur, loseApp: app };
    }
  }

  function halfInning(inning, bSide) {
    const fSide = other(bSide);
    choosePitcher(fSide, inning);
    const B = sides[bSide];
    const F = sides[fSide];
    let outs = 0;
    const bases = [null, null, null];
    const walkoff = () => bSide === 'home' && inning >= 9 && score.home > score.away;
    while (outs < 3 && !walkoff()) {
      const pit = F.cur;
      // 盗塁
      if (bases[0] && !bases[1] && outs < 2 && rnd() < 0.045 * bases[0].spd) {
        const r = bases[0];
        if (rnd() < 0.55 + 0.1 * Math.min(r.spd, 2.5)) {
          batLine(B, r).SB++;
          bases[1] = r;
          bases[0] = null;
        } else {
          batLine(B, r).CS++;
          bases[0] = null;
          outs++;
          pit.line.outs++;
          continue;
        }
      }
      const batter = B.lineup[B.idx % B.lineup.length];
      B.idx++;
      const L = batLine(B, batter);
      const bHand = batter.bats === '両' ? (pit.p.throws === '右' ? '左' : '右') : batter.bats;
      const same = bHand === pit.p.throws;
      const risp = !!(bases[1] || bases[2]);
      const stadium = TEAM[game.home].stadium;
      // 犠打
      if (outs === 0 && (bases[0] || bases[1]) && !bases[2] && B.idx % 9 >= 7 && rnd() < 0.35) {
        L.PA++;
        L.SH++;
        pit.line.BF++;
        pit.line.outs++;
        outs++;
        if (bases[1]) bases[2] = bases[1];
        bases[1] = bases[0];
        bases[0] = null;
        continue;
      }
      let ev = paOutcome(batter, pit.p, same);
      if (ev === 'OUT' && bases[2] && outs < 2 && rnd() < 0.3) ev = 'SF';
      if (ev === 'OUT' && bases[0] && outs < 2 && rnd() < 0.14) ev = 'GDP';
      const sb = blankSplitB();
      const sp = blankSplitP();
      sb.PA = 1;
      sp.BF = 1;
      L.PA++;
      pit.line.BF++;
      const isAB = !['BB', 'HBP', 'SF'].includes(ev);
      if (isAB) {
        L.AB++;
        sb.AB = 1;
        sp.AB = 1;
      }
      const hit = ['S', 'D', 'T', 'HR'].includes(ev);
      if (hit) {
        L.H++;
        pit.line.H++;
        sb.H = 1;
        sp.H = 1;
      }
      const runners = [];
      const adv = (n) => {
        // n 塁進める（押し出し・単純化）
        for (let i = 2; i >= 0; i--) {
          if (!bases[i]) continue;
          const to = i + n;
          if (to >= 3) runners.push(bases[i]);
          else bases[to] = bases[i];
          bases[i] = null;
        }
      };
      switch (ev) {
        case 'SO':
          L.SO++;
          pit.line.SO++;
          sb.SO = 1;
          sp.SO = 1;
          outs++;
          pit.line.outs++;
          break;
        case 'BB':
        case 'HBP': {
          if (ev === 'BB') {
            L.BB++;
            pit.line.BB++;
            sb.BB = 1;
            sp.BB = 1;
          } else {
            L.HBP++;
            pit.line.HBP++;
            sb.HBP = 1;
            sp.HBP = 1;
          }
          // 押し出し
          if (bases[0]) {
            if (bases[1]) {
              if (bases[2]) runners.push(bases[2]);
              bases[2] = bases[1];
            }
            bases[1] = bases[0];
          }
          bases[0] = batter;
          break;
        }
        case 'S': {
          if (bases[2]) runners.push(bases[2]);
          bases[2] = null;
          if (bases[1]) {
            if (rnd() < 0.55) runners.push(bases[1]);
            else bases[2] = bases[1];
            bases[1] = null;
          }
          if (bases[0]) {
            if (!bases[2] && rnd() < 0.28) bases[2] = bases[0];
            else bases[1] = bases[0];
            bases[0] = null;
          }
          bases[0] = batter;
          break;
        }
        case 'D': {
          L.D++;
          sb.D = 1;
          if (bases[2]) runners.push(bases[2]);
          if (bases[1]) runners.push(bases[1]);
          bases[2] = bases[1] = null;
          if (bases[0]) {
            if (rnd() < 0.4) runners.push(bases[0]);
            else bases[2] = bases[0];
            bases[0] = null;
          }
          bases[1] = batter;
          break;
        }
        case 'T':
          L.T++;
          sb.T = 1;
          adv(3);
          bases[2] = batter;
          break;
        case 'HR':
          L.HR++;
          pit.line.HR++;
          sb.HR = 1;
          sp.HR = 1;
          adv(3);
          runners.push(batter);
          break;
        case 'SF':
          L.SF++;
          sb.SF = 1;
          runners.push(bases[2]);
          bases[2] = null;
          outs++;
          pit.line.outs++;
          break;
        case 'GDP':
          L.GDP++;
          bases[0] = null;
          outs += 2;
          pit.line.outs += 2;
          if (outs < 3 && bases[2] && outs === 2) {
            // 3アウト目でなければ三塁走者は生還しない（単純化）
          }
          break;
        default: {
          outs++;
          pit.line.outs++;
          if (outs < 3 && bases[1] && !bases[2] && rnd() < 0.3) {
            bases[2] = bases[1];
            bases[1] = null;
          }
        }
      }
      if (outs > 3) {
        pit.line.outs -= outs - 3;
        outs = 3;
      }
      if (outs < 3 || ev === 'HR') {
        for (const r of runners) {
          scoreRun(bSide, fSide, r, L, ev !== 'GDP');
          if (walkoff() && ev !== 'HR') break;
        }
      }
      addSplitB(batter, same ? (pit.p.throws === '左' ? 'vs_lhp' : 'vs_rhp') : pit.p.throws === '左' ? 'vs_lhp' : 'vs_rhp', sb);
      addSplitB(batter, `stadium:${stadium}`, sb);
      addSplitP(pit.p, bHand === '左' ? 'vs_lhb' : 'vs_rhb', sp);
      if (risp) {
        addSplitB(batter, 'risp', sb);
        addSplitP(pit.p, 'risp', sp);
      }
    }
  }

  let inning = 1;
  for (;;) {
    halfInning(inning, 'away');
    if (inning >= 9 && score.home > score.away) break;
    halfInning(inning, 'home');
    if (inning >= 9 && score.home !== score.away) break;
    if (inning >= 12) break;
    inning++;
  }
  for (const side of ['away', 'home']) {
    const s = sides[side];
    s.cur.exitMargin = score[side] - score[other(side)];
  }

  // 勝敗・セーブ・ホールド（簡略化した判定。デモ用）
  const decisions = new Map();
  if (score.home !== score.away) {
    const winSide = score.home > score.away ? 'home' : 'away';
    const loseSide = other(winSide);
    let w = lead.winApp;
    if (w.gs && w.line.outs < 15) {
      const rel = sides[winSide].apps.filter((a) => !a.gs);
      if (rel.length) w = rel.reduce((a, b) => (b.line.outs > a.line.outs ? b : a));
    }
    decisions.set(w, 'W');
    decisions.set(lead.loseApp, 'L');
    const apps = sides[winSide].apps;
    const last = apps[apps.length - 1];
    if (last !== w && !last.gs && ((last.enterMargin >= 1 && last.enterMargin <= 3 && last.line.outs >= 3) || last.line.outs >= 9)) {
      decisions.set(last, 'SV');
    }
    for (const a of apps) {
      if (a.gs || decisions.has(a) || a === last) continue;
      if (a.enterMargin >= 1 && a.enterMargin <= 3 && a.line.outs >= 1 && a.exitMargin > 0) decisions.set(a, 'HLD');
    }
  }

  const result = { away_score: score.away, home_score: score.home, batting: [], pitching: [] };
  for (const side of ['away', 'home']) {
    const s = sides[side];
    for (const { p, line } of s.bat.values()) result.batting.push({ p, team: s.tid, line });
    for (const a of s.apps) {
      const dcs = decisions.get(a);
      result.pitching.push({ p: a.p, team: s.tid, gs: a.gs ? 1 : 0, line: a.line, W: dcs === 'W' ? 1 : 0, L: dcs === 'L' ? 1 : 0, SV: dcs === 'SV' ? 1 : 0, HLD: dcs === 'HLD' ? 1 : 0 });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 日程
function schedule(season) {
  const ids = TEAMS.map((t) => t.team_id);
  // 6球団の完全マッチング5通り（円順列法）
  const matchings = [];
  for (let r = 0; r < 5; r++) {
    const rot = [ids[0], ...ids.slice(1).slice(r), ...ids.slice(1).slice(0, r)];
    matchings.push([
      [rot[0], rot[5]],
      [rot[1], rot[4]],
      [rot[2], rot[3]],
    ]);
  }
  const days = [];
  for (let round = 0; round < 8; round++) {
    for (let m = 0; m < 5; m++) {
      for (let g = 0; g < 3; g++) days.push(matchings[m].map(([a, b]) => ((round + m) % 2 ? [a, b] : [b, a])));
    }
  }
  for (let m = 0; m < 5; m++) days.push(matchings[m].map(([a, b]) => (m % 2 ? [b, a] : [a, b])));

  const games = [];
  let d = new Date(Date.UTC(season, 2, 27));
  let n = 1;
  const makeups = [];
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const nextDay = () => {
    do d = new Date(d.getTime() + 86400000);
    while (d.getUTCDay() === 1);
  };
  for (const day of days) {
    for (const [away, home] of day) {
      const g = { game_id: `${season}${String(n++).padStart(4, '0')}`, date: fmt(d), start_time: d.getUTCDay() === 0 || d.getUTCDay() === 6 ? '14:00' : '18:00', away, home, stadium: TEAM[home].stadium };
      if (rnd() < 0.015) {
        games.push({ ...g, status: 'postponed' });
        makeups.push({ away, home });
      } else games.push({ ...g, status: 'final' });
    }
    nextDay();
  }
  for (const mk of makeups) {
    games.push({ game_id: `${season}${String(n++).padStart(4, '0')}`, date: fmt(d), start_time: '18:00', ...mk, stadium: TEAM[mk.home].stadium, status: 'final' });
    nextDay();
  }
  return games;
}

// ---------------------------------------------------------------------------
async function generateSeason(season, { asOf, phase, withLogs, omitCols }) {
  rnd = mulberry32(season * 7919);
  // 年ごとの能力の変動（成長・衰え）
  for (const p of players) {
    const f = season === 2026 ? 1 : 0;
    p.cur = {
      k: p.k * (1 + f * normal(0, 0.06)),
      bb: p.bb * (1 + f * normal(0, 0.06)),
      hr: p.hr * (1 + f * normal(0, 0.1)),
      hit: p.hit * (1 + f * normal(0, 0.03)),
    };
  }
  const view = (p) => ({ ...p, ...p.cur });
  const games = schedule(season);
  const ctx = { teamState: Object.fromEntries(TEAMS.map((t) => [t.team_id, { rotation: 0 }])), splitB: new Map(), splitP: new Map() };
  const batLogs = [];
  const pitLogs = [];
  const standings = Object.fromEntries(TEAMS.map((t) => [t.team_id, { team_id: t.team_id, g: 0, w: 0, l: 0, t: 0, rs: 0, ra: 0 }]));
  const pmap = new Map(players.map((p) => [p.player_id, p]));
  // 能力値を季節ごとの値に差し替えた選手オブジェクトでシミュレーション
  const swapped = players.map(view);
  players.splice(0, players.length, ...swapped);

  for (const g of games) {
    if (g.date > asOf) {
      if (g.status === 'final') g.status = 'scheduled';
      continue;
    }
    if (g.status !== 'final') continue;
    const r = simulateGame(g, season, ctx);
    g.away_score = r.away_score;
    g.home_score = r.home_score;
    for (const [side, opp] of [['away', 'home'], ['home', 'away']]) {
      const s = standings[g[side]];
      s.g++;
      s.rs += r[`${side}_score`];
      s.ra += r[`${opp}_score`];
      if (r[`${side}_score`] > r[`${opp}_score`]) s.w++;
      else if (r[`${side}_score`] < r[`${opp}_score`]) s.l++;
      else s.t++;
    }
    for (const b of r.batting) batLogs.push({ game_id: g.game_id, date: g.date, player_id: b.p.player_id, team_id: b.team, ...b.line });
    for (const p of r.pitching) pitLogs.push({ game_id: g.game_id, date: g.date, player_id: p.p.player_id, team_id: p.team, GS: p.gs, W: p.W, L: p.L, SV: p.SV, HLD: p.HLD, ...p.line });
  }
  players.splice(0, players.length, ...players.map((p) => Object.assign(pmap.get(p.player_id), { cur: p.cur })));

  // 累計
  const agg = (logs, keys) => {
    const m = new Map();
    for (const l of logs) {
      const k = `${l.player_id}|${l.team_id}`;
      if (!m.has(k)) m.set(k, { player_id: l.player_id, team_id: l.team_id, G: 0, ...Object.fromEntries(keys.map((x) => [x, 0])) });
      const o = m.get(k);
      o.G++;
      for (const x of keys) o[x] += l[x];
    }
    return [...m.values()];
  };
  const bat = agg(batLogs, Object.keys(blankBat()));
  const pit = agg(pitLogs, ['GS', 'W', 'L', 'SV', 'HLD', ...Object.keys(blankPit())]);

  const dir = join(OUT, String(season));
  await mkdir(dir, { recursive: true });
  const write = (f, header, rows) => writeFile(join(dir, f), toCsv(header, rows));
  const ip = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;

  // meta
  const order = Object.values(standings).sort((a, b) => b.w / Math.max(1, b.w + b.l) - a.w / Math.max(1, a.w + a.l));
  const meta = [
    { key: 'season', value: season },
    { key: 'as_of_date', value: asOf },
    { key: 'phase', value: phase },
    { key: 'champion_team_id', value: phase === 'offseason' || phase === 'postseason' ? order[0].team_id : '' },
    { key: 'source_name', value: 'デモデータ（乱数による架空の試合シミュレーション。実在の成績ではありません）' },
    { key: 'source_url', value: '' },
    { key: 'note', value: 'デモは交流戦を含まないリーグ内125試合で構成しています。選手名・成績はすべて架空です。' },
  ];
  await write('meta.csv', ['key', 'value'], meta);
  await write('teams.csv', ['team_id', 'name', 'short_name', 'home', 'stadium', 'color'], TEAMS);
  await write('standings.csv', ['team_id', 'g', 'w', 'l', 't', 'rs', 'ra', 'official_rank'], Object.values(standings));

  const prow = [];
  for (const p of players.filter((x) => x.seasons.includes(season))) {
    const base = { player_id: p.player_id, name: season === 2025 && p.oldName ? p.oldName : p.name, name_kana: season === 2025 && p.oldKana ? p.oldKana : p.name_kana, number: p.number, position: p.position, throws: p.throws, bats: p.bats, birth_date: p.birth_date };
    if (p.trade && season === 2026) {
      prow.push({ ...base, team_id: p.team, from_date: '', to_date: '2026-07-14' });
      prow.push({ ...base, team_id: p.trade.to, number: p.trade.number, from_date: p.trade.date, to_date: '' });
    } else prow.push({ ...base, team_id: p.team, from_date: '', to_date: '' });
  }
  await write('players.csv', ['player_id', 'team_id', 'name', 'name_kana', 'number', 'position', 'throws', 'bats', 'birth_date', 'from_date', 'to_date'], prow);

  const batCols = ['player_id', 'team_id', 'g', 'pa', 'ab', 'r', 'h', '2b', '3b', 'hr', 'rbi', 'sb', 'cs', 'bb', 'hbp', 'so', 'sh', 'sf', 'gdp'].filter((c) => !omitCols.includes(c));
  const lc = (o) => ({ ...o, g: o.G, pa: o.PA, ab: o.AB, r: o.R, h: o.H, '2b': o.D, '3b': o.T, hr: o.HR, rbi: o.RBI, sb: o.SB, cs: o.CS, bb: o.BB, hbp: o.HBP, so: o.SO, sh: o.SH, sf: o.SF, gdp: o.GDP });
  await write('batting.csv', batCols, bat.map(lc));
  const pc = (o) => ({ ...o, g: o.G, gs: o.GS, w: o.W, l: o.L, hld: o.HLD, sv: o.SV, ip: ip(o.outs), bf: o.BF, h: o.H, hr: o.HR, bb: o.BB, hbp: o.HBP, so: o.SO, r: o.R, er: o.ER });
  await write('pitching.csv', ['player_id', 'team_id', 'g', 'gs', 'w', 'l', 'hld', 'sv', 'ip', 'bf', 'h', 'hr', 'bb', 'hbp', 'so', 'r', 'er'], pit.map(pc));
  await write('games.csv', ['game_id', 'date', 'start_time', 'away_team', 'home_team', 'stadium', 'status', 'away_score', 'home_score'], games.map((g) => ({ ...g, away_team: g.away, home_team: g.home })));

  if (withLogs) {
    await write('batting_games.csv', ['game_id', 'date', 'player_id', 'team_id', 'pa', 'ab', 'r', 'h', '2b', '3b', 'hr', 'rbi', 'sb', 'bb', 'hbp', 'so', 'sf'], batLogs.map(lc));
    await write('pitching_games.csv', ['game_id', 'date', 'player_id', 'team_id', 'gs', 'ip', 'bf', 'h', 'hr', 'bb', 'hbp', 'so', 'er'], pitLogs.map(pc));
    const sb = [...ctx.splitB.values()].map((o) => ({ ...lc(o), split: o.split }));
    await write('splits_batting.csv', ['player_id', 'split', 'pa', 'ab', 'h', '2b', '3b', 'hr', 'bb', 'hbp', 'so', 'sf'], sb);
    const sp = [...ctx.splitP.values()].map((o) => ({ player_id: o.player_id, split: o.split, bf: o.BF, ab: o.AB, h: o.H, hr: o.HR, bb: o.BB, hbp: o.HBP, so: o.SO }));
    await write('splits_pitching.csv', ['player_id', 'split', 'bf', 'ab', 'h', 'hr', 'bb', 'hbp', 'so'], sp);
  }
  console.log(`${season}: ${games.length}試合（基準日 ${asOf}, ${phase}）, 打撃 ${bat.length}行, 投手 ${pit.length}行 → ${dir}`);
}

const asOf = args['as-of'] || '2026-09-30';
const phase = args.phase || 'offseason';
await generateSeason(2025, { asOf: '2025-09-30', phase: 'offseason', withLogs: false, omitCols: ['cs', 'gdp'] });
await generateSeason(2026, { asOf, phase, withLogs: true, omitCols: [] });
