// 移籍・契約ページの絞り込み（JavaScript が無効なら全件表示のまま）
(function () {
  'use strict';
  var team = document.getElementById('mv-team');
  var cat = document.getElementById('mv-cat');
  var other = document.getElementById('mv-other');
  var count = document.getElementById('mv-count');
  if (!team) return;
  var h = new URLSearchParams(location.hash.slice(1));
  if (h.get('team')) team.value = h.get('team');
  if (h.get('cat')) cat.value = h.get('cat');
  function apply() {
    var t = team.value;
    var c = cat.value;
    var n = 0;
    document.querySelectorAll('li.move').forEach(function (li) {
      var teams = li.getAttribute('data-teams').split(' ');
      var cats = li.getAttribute('data-cats').split('|');
      var onlyOther = cats.length === 1 && cats[0] === 'その他';
      var show = (!t || teams.indexOf(t) >= 0) && (!c || cats.indexOf(c) >= 0) && (other.checked || c === 'その他' || !onlyOther);
      li.hidden = !show;
      if (show) n++;
    });
    document.querySelectorAll('section.move-month').forEach(function (s) {
      s.hidden = !s.querySelector('li.move:not([hidden])');
    });
    count.textContent = n + '件を表示中' + (other.checked ? '' : '（「その他」を除く）');
    var q = new URLSearchParams();
    if (t) q.set('team', t);
    if (c) q.set('cat', c);
    history.replaceState(null, '', q.toString() ? '#' + q : location.pathname);
  }
  team.addEventListener('change', apply);
  cat.addEventListener('change', apply);
  other.addEventListener('change', apply);
  apply();
})();
