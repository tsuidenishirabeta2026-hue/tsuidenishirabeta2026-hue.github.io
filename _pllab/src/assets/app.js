// 共通の小さなスクリプト（JavaScript が無効でもページ自体は読めるようにしている）
(function () {
  'use strict';
  var G = window.PL_GLOSSARY || {};

  // ---- 用語の説明ポップアップ ----
  var pop = null;
  function closePop() {
    if (pop) {
      pop.remove();
      pop = null;
    }
  }
  function openPop(btn) {
    closePop();
    var key = btn.getAttribute('data-term');
    var g = G[key];
    if (!g) return;
    pop = document.createElement('div');
    pop.id = 'term-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', key + 'の説明');
    var b = document.createElement('b');
    b.textContent = key;
    var d = document.createElement('span');
    d.textContent = g.d;
    pop.appendChild(b);
    pop.appendChild(d);
    if (g.f) {
      var f = document.createElement('span');
      f.className = 'f';
      f.textContent = '計算式: ' + g.f;
      pop.appendChild(f);
    }
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    x.textContent = '×';
    x.addEventListener('click', closePop);
    pop.appendChild(x);
    document.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    var left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 16);
    pop.style.left = Math.max(window.scrollX + 16, left) + 'px';
    pop.style.top = window.scrollY + r.bottom + 6 + 'px';
    x.focus();
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('button.term');
    if (t) {
      e.preventDefault();
      e.stopPropagation();
      openPop(t);
      return;
    }
    if (pop && !pop.contains(e.target)) closePop();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePop();
  });

  // ---- 静的な表の並べ替え（table.sortable） ----
  function cellVal(td) {
    var v = td.getAttribute('data-v');
    if (v === null) return td.textContent.trim();
    if (v === '') return null;
    var n = Number(v);
    return isNaN(n) ? v : n;
  }
  document.querySelectorAll('table.sortable').forEach(function (tbl) {
    var ths = tbl.querySelectorAll('thead th');
    ths.forEach(function (th, idx) {
      if (th.hasAttribute('data-nosort')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sort';
      btn.setAttribute('aria-label', th.textContent.trim() + 'で並べ替え');
      while (th.firstChild) btn.appendChild(th.firstChild);
      th.appendChild(btn);
      btn.addEventListener('click', function (e) {
        if (e.target.closest('button.term')) return;
        var cur = th.getAttribute('aria-sort');
        var asc = cur === 'descending';
        ths.forEach(function (o) {
          o.removeAttribute('aria-sort');
        });
        th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
        var body = tbl.tBodies[0];
        var rows = Array.prototype.slice.call(body.rows).filter(function (r) {
          return !r.classList.contains('total');
        });
        var totals = Array.prototype.slice.call(body.rows).filter(function (r) {
          return r.classList.contains('total');
        });
        rows.sort(function (a, b) {
          var x = cellVal(a.cells[idx]);
          var y = cellVal(b.cells[idx]);
          if (x === null && y === null) return 0;
          if (x === null) return 1; // データなしは常に末尾
          if (y === null) return -1;
          if (typeof x === 'number' && typeof y === 'number') return asc ? x - y : y - x;
          return asc ? String(x).localeCompare(String(y), 'ja') : String(y).localeCompare(String(x), 'ja');
        });
        rows.concat(totals).forEach(function (r) {
          body.appendChild(r);
        });
      });
    });
  });

  // ---- 計測（アクセス解析が設定されている場合のみ送信） ----
  function track(name, params) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, Object.assign({ transport_type: 'beacon' }, params));
      if (window.umami && typeof window.umami.track === 'function') window.umami.track(name, params);
    } catch (e) {}
  }
  // note へのクリック
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.note-link');
    if (!a) return;
    track('note_click', {
      note_id: a.getAttribute('data-note-id'),
      note_type: a.getAttribute('data-note-type'),
      page_type: a.getAttribute('data-page-type'),
      player_id: a.getAttribute('data-player-id') || '',
      team_id: a.getAttribute('data-team-id') || ''
    });
  });
  // トップの「今日の数字」「新着の記事」のクリック（top_today_click / top_new_click）
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-top-slot]');
    if (a) track('top_' + a.getAttribute('data-top-slot') + '_click', {});
  });
  // 選手ページの閲覧（ページビューに加え、選手IDつきのイベントを送って集計しやすくする）
  var b = document.body;
  if (b && b.getAttribute('data-page-type') === 'player') {
    var sendPV = function () { track('player_view', { player_id: b.getAttribute('data-player-id'), player_name: b.getAttribute('data-player-name') }); };
    if (window.umami) sendPV(); else window.addEventListener('load', sendPV);
  }

  // ---- データの鮮度チェック（更新処理そのものが止まった場合にも気づけるように） ----
  var el = document.querySelector('[data-last-success]');
  if (el) {
    var last = Date.parse(el.getAttribute('data-last-success'));
    var hours = Number(el.getAttribute('data-stale-hours')) || 30;
    var phase = el.getAttribute('data-phase');
    var box = document.getElementById('stale-client');
    if (box && phase === 'regular' && !isNaN(last) && Date.now() - last > hours * 3600 * 1000) {
      box.hidden = false;
    }
  }
})();
