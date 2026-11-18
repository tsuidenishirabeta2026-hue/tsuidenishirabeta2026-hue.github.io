// 選手一覧: 検索・絞り込み・並べ替え（データは ../data/players.json）
(function () {
  'use strict';
  var root = document.getElementById('plist');
  if (!root) return;
  var DATA = null;
  var state = { tab: 'bat', q: '', team: '', pos: '', season: '', qual: false, sort: null, asc: false };

  var COLS = {
    bat: [
      ['試合', 'G', 'int'], ['打席', 'PA', 'int'], ['打数', 'AB', 'int'], ['安打', 'H', 'int'], ['二塁打', 'D', 'int'], ['三塁打', 'T', 'int'],
      ['本塁打', 'HR', 'int'], ['打点', 'RBI', 'int'], ['得点', 'R', 'int'], ['盗塁', 'SB', 'int'], ['四球', 'BB', 'int'], ['死球', 'HBP', 'int'],
      ['三振', 'SO', 'int'], ['打率', 'AVG', 'rate'], ['出塁率', 'OBP', 'rate'], ['長打率', 'SLG', 'rate'], ['OPS', 'OPS', 'rate']
    ],
    pit: [
      ['登板', 'G', 'int'], ['先発', 'GS', 'int'], ['勝利', 'W', 'int'], ['敗戦', 'L', 'int'], ['ホールド', 'HLD', 'int'], ['セーブ', 'SV', 'int'],
      ['投球回', 'outs', 'ip'], ['被安打', 'H', 'int'], ['被本塁打', 'HR', 'int'], ['与四球', 'BB', 'int'], ['与死球', 'HBP', 'int'],
      ['奪三振', 'SO', 'int'], ['自責点', 'ER', 'int'], ['防御率', 'ERA', 'f2'], ['WHIP', 'WHIP', 'f2'], ['奪三振率', 'K9', 'f2'],
      ['与四球率', 'BB9', 'f2'], ['K/BB', 'KBB', 'f2']
    ]
  };
  // 個人成績が無いシーズン（stats_level=none）は背番号だけを表示する
  var LOWER = { ERA: 1, WHIP: 1, BB9: 1, L: 1, ER: 1 };
  var DEFAULT_SORT = { bat: 'PA', pit: 'outs' };

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    // カタカナ→ひらがな、空白除去、英字小文字化（検索用）
    return String(s || '').replace(/[ァ-ヶ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0x60);
    }).replace(/[\s　・]/g, '').toLowerCase();
  }
  // 値: 数値 / null（データなし）/ "z"（分母0で算出不可）
  function fmt(v, f) {
    if (v === null || v === undefined) return '<span class="na">データなし</span>';
    if (v === 'z') return '<span class="na">算出不可</span>';
    if (f === 'rate') { var s = v.toFixed(3); return s.indexOf('0.') === 0 ? s.slice(1) : s; }
    if (f === 'f2') return v.toFixed(2);
    if (f === 'ip') return Math.floor(v / 3) + '.' + (v % 3);
    return String(v);
  }
  function num(v) { return typeof v === 'number' ? v : null; }

  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('tab') === 'pit') state.tab = 'pit';
    state.q = h.get('q') || '';
    state.team = h.get('team') || '';
    state.pos = h.get('pos') || '';
    state.season = h.get('season') || '';
    state.qual = h.get('qual') === '1';
    if (h.get('sort')) { state.sort = h.get('sort'); state.asc = h.get('asc') === '1'; }
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (state.tab === 'pit') h.set('tab', 'pit');
    if (state.q) h.set('q', state.q);
    if (state.team) h.set('team', state.team);
    if (state.pos) h.set('pos', state.pos);
    if (state.season && state.season !== String(DATA.current)) h.set('season', state.season);
    if (state.qual) h.set('qual', '1');
    if (state.sort) { h.set('sort', state.sort); if (state.asc) h.set('asc', '1'); }
    var s = h.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  function posOptions() {
    var opts = state.tab === 'bat'
      ? [['', 'すべての守備位置'], ['捕手', '捕手'], ['内野手', '内野手'], ['外野手', '外野手']]
      : [['', 'すべての役割'], ['先発', '先発'], ['救援', '救援']];
    var sel = el('f-pos');
    sel.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    if (!opts.some(function (o) { return o[0] === state.pos; })) state.pos = '';
    sel.value = state.pos;
  }

  function render() {
    var tab = state.tab;
    var season = Number(state.season || DATA.current);
    var noStats = DATA.noStats.indexOf(season) >= 0;
    var cols = noStats ? [['背番号', 'num', 'text']] : COLS[tab];
    el('f-qual').closest('label').hidden = noStats;
    if (noStats) state.qual = false;
    var q = norm(state.q);
    var sortKey = state.sort || (noStats ? 'num' : DEFAULT_SORT[tab]);
    var rows = DATA.players.filter(function (r) {
      if (r.s !== season) return false;
      if (tab === 'bat' ? r.pos === '投手' : r.pos !== '投手') return false;
      if (state.team && r.ts.indexOf(state.team) < 0) return false;
      if (state.pos) {
        if (tab === 'bat' && r.pos !== state.pos) return false;
        if (tab === 'pit' && !noStats && r.role !== state.pos) return false;
      }
      if (state.qual && !(tab === 'bat' ? r.qb : r.qp)) return false;
      if (q && norm(r.n).indexOf(q) < 0 && norm(r.k).indexOf(q) < 0) return false;
      return true;
    });
    var asc = state.sort ? state.asc : !!LOWER[sortKey] || sortKey === 'num';
    rows.sort(function (a, b) {
      var sa = tab === 'bat' ? a.b : a.p;
      var sb = tab === 'bat' ? b.b : b.p;
      if (sortKey === 'name') return asc ? a.k.localeCompare(b.k, 'ja') : b.k.localeCompare(a.k, 'ja');
      if (sortKey === 'num') {
        var na = a.num === '' ? 9999 : Number(a.num) + (a.num.length > 1 && a.num[0] === '0' ? -0.5 : 0);
        var nb = b.num === '' ? 9999 : Number(b.num) + (b.num.length > 1 && b.num[0] === '0' ? -0.5 : 0);
        return asc ? na - nb : nb - na;
      }
      var x = sa ? num(sa[sortKey]) : null;
      var y = sb ? num(sb[sortKey]) : null;
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return asc ? x - y : y - x;
    });

    var thead = '<tr><th class="l" scope="col" aria-sort="' + (sortKey === 'name' ? (asc ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="sort" data-k="name">選手</button></th><th class="l" scope="col">球団</th><th class="l" scope="col">' + (tab === 'bat' ? '守備' : '役割') + '</th>' +
      cols.map(function (c) {
        var s = sortKey === c[1] ? (asc ? 'ascending' : 'descending') : 'none';
        return '<th scope="col" aria-sort="' + s + '"><button type="button" class="sort" data-k="' + c[1] + '">' + c[0] + '</button></th>';
      }).join('') + '</tr>';
    var body = rows.map(function (r) {
      var st = tab === 'bat' ? r.b : r.p;
      var lead = '<td class="l name"><a href="' + esc(r.id) + '.html">' + esc(r.n) + '</a>' + ((tab === 'bat' ? r.qb : r.qp) ? ' <span class="tag" title="規定到達">規定</span>' : '') + '</td><td class="l">' + esc(r.tn) + '</td><td class="l">' + esc(tab === 'bat' ? r.pos : r.role) + '</td>';
      if (noStats) return '<tr>' + lead + '<td>' + esc(r.num) + '</td></tr>';
      if (!st) return '<tr>' + lead + '<td class="l" colspan="' + cols.length + '"><span class="na">今季の' + (tab === 'bat' ? '出場' : '登板') + '記録なし</span></td></tr>';
      return '<tr>' + lead + cols.map(function (c) { return '<td>' + fmt(st[c[1]], c[2]) + '</td>'; }).join('') + '</tr>';
    }).join('');
    el('p-thead').innerHTML = thead;
    el('p-tbody').innerHTML = body || '<tr><td class="l" colspan="' + (cols.length + 3) + '">条件に合う選手がいません。</td></tr>';
    var lbl = cols.filter(function (c) { return c[1] === sortKey; })[0];
    if (noStats) {
      el('p-count').textContent = season + '年・' + (tab === 'bat' ? '野手' : '投手') + ' ' + rows.length + '人（個人成績は未取得のため、所属選手の一覧のみ）';
      document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab ? 'true' : 'false'); });
      writeHash();
      return;
    }
    el('p-count').textContent = season + '年・' + (tab === 'bat' ? '野手' : '投手') + ' ' + rows.length + '人' + (state.qual ? '（規定' + (tab === 'bat' ? '打席' : '投球回') + '到達者のみ）' : '（全選手）') + '／並び順: ' + (sortKey === 'name' ? '読み' : lbl ? lbl[0] : sortKey) + (asc ? '（昇順）' : '（降順）');
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab ? 'true' : 'false'); });
    el('f-qual-label').textContent = tab === 'bat' ? '規定打席到達者のみ' : '規定投球回到達者のみ';
    writeHash();
  }

  function bind() {
    el('f-q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    el('f-team').addEventListener('change', function (e) { state.team = e.target.value; render(); });
    el('f-pos').addEventListener('change', function (e) { state.pos = e.target.value; render(); });
    el('f-season').addEventListener('change', function (e) { state.season = e.target.value; render(); });
    el('f-qual').addEventListener('change', function (e) { state.qual = e.target.checked; render(); });
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        state.sort = null;
        posOptions();
        render();
      });
    });
    el('p-thead').addEventListener('click', function (e) {
      var b = e.target.closest('button.sort');
      if (!b) return;
      var k = b.getAttribute('data-k');
      var defAsc = k === 'name' || !!LOWER[k];
      if (state.sort === k) state.asc = !state.asc;
      else { state.sort = k; state.asc = defAsc; }
      render();
    });
  }

  fetch(root.getAttribute('data-src')).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) {
    DATA = d;
    readHash();
    var seasonSel = el('f-season');
    seasonSel.innerHTML = d.seasons.map(function (s) { return '<option value="' + s + '">' + s + '年</option>'; }).join('');
    state.season = state.season || String(d.current);
    seasonSel.value = state.season;
    el('f-team').innerHTML = '<option value="">すべての球団</option>' + d.teams.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join('');
    el('f-team').value = state.team;
    el('f-q').value = state.q;
    el('f-qual').checked = state.qual;
    posOptions();
    bind();
    render();
    el('p-loading').hidden = true;
  }).catch(function (e) {
    el('p-loading').textContent = '選手データの読み込みに失敗しました（' + e.message + '）。各球団ページの選手一覧をご利用ください。';
  });
})();
