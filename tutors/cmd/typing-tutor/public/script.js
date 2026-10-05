(function () {
  // === theme toggle (matches homepage) ===
  var root = document.documentElement;
  var themeBtn = document.getElementById('themeToggle');
  var stored = null;
  try { stored = localStorage.getItem('hs-theme'); } catch (e) {}
  if (stored === 'dark' || stored === 'light') root.setAttribute('data-theme', stored);
  function updateThemeLabel() {
    themeBtn.textContent = 'theme: ' + (root.getAttribute('data-theme') || 'auto');
  }
  updateThemeLabel();
  themeBtn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
    if (next) { root.setAttribute('data-theme', next); try { localStorage.setItem('hs-theme', next); } catch (e) {} }
    else { root.removeAttribute('data-theme'); try { localStorage.removeItem('hs-theme'); } catch (e) {} }
    updateThemeLabel();
  });

  // === sidebar toggle ===
  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebarToggle');
  var sidebarCollapsed = false;
  try { sidebarCollapsed = localStorage.getItem('typing-sidebar-collapsed') === '1'; } catch (e) {}
  function applySidebarState() {
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    sidebarToggle.innerHTML = sidebarCollapsed ? '&#8250;' : '&#8249;';
  }
  applySidebarState();
  sidebarToggle.addEventListener('click', function () {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem('typing-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch (e) {}
    applySidebarState();
  });
})();

var letterRowsConfig = [
  ['A','S','D','F'], ['J','K','L','G','H'],
  ['T','U','Y','I','R'], ['E','O','P','W','Q'],
  ['V','N','C','B'], ['X','M','Z']
];

var state = {
  mode: 'words', fullText: '', currentIndex: 0, isStarted: false,
  startTime: null, timerInterval: null, firstTimeCorrect: 0,
  errors: new Set(), timeLeft: 60, starting: false
};

document.addEventListener('DOMContentLoaded', function () {
  // restore saved name
  try {
    var saved = localStorage.getItem('typing-user-name');
    if (saved) document.getElementById('userName').value = saved;
  } catch (e) {}

  ['wordsPerLine', 'totalLines', 'visibleLines'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { for (var i = 1; i <= 12; i++) el.add(new Option(i, i)); el.value = 5; }
  });

  var fs = document.getElementById('fontSize');
  for (var s = 12; s <= 48; s += 2) fs.add(new Option(s + 'px', s));
  fs.value = 16;

  var grid = document.getElementById('letter-grid');
  letterRowsConfig.forEach(function (rowChars) {
    var rowDiv = document.createElement('div');
    rowDiv.className = 'letter-row';
    rowChars.forEach(function (char) {
      var item = document.createElement('div');
      item.className = 'letter-item';
      item.innerHTML = '<span>' + char + '</span>'
        + '<input type="checkbox" class="letter-chk" value="' + char.toLowerCase() + '" checked>';
      rowDiv.appendChild(item);
    });
    grid.appendChild(rowDiv);
  });

  fetchNames();

  document.getElementById('userName').addEventListener('change', function () {
    try { localStorage.setItem('typing-user-name', this.value); } catch (e) {}
  });
});

function toggleModeUI() {
  var mode = document.getElementById('practiceMode').value;
  document.getElementById('wordSettings').style.display = (mode === 'chars') ? 'none' : '';
}

async function startSession() {
  if (state.starting) return;
  state.starting = true;

  var mode = document.getElementById('practiceMode').value;
  var allowed = Array.from(document.querySelectorAll('.letter-chk:checked')).map(function (c) { return c.value; });
  if (allowed.length === 0) { alert('Select at least one letter.'); state.starting = false; return; }

  var fSize = parseInt(document.getElementById('fontSize').value);
  var generatedText = '';

  if (mode === 'words') {
    var res;
    try {
      res = await fetch('/api/words?letters=' + allowed.join(''));
      var wordPool = await res.json();
      if (wordPool.length === 0) { alert('No words match the selected letters.'); state.starting = false; return; }
      var wpl = parseInt(document.getElementById('wordsPerLine').value);
      var totalL = parseInt(document.getElementById('totalLines').value);
      var lines = [];
      for (var i = 0; i < totalL; i++) {
        var line = [];
        for (var j = 0; j < wpl; j++) line.push(wordPool[Math.floor(Math.random() * wordPool.length)]);
        lines.push(line.join(' '));
      }
      generatedText = lines.join('\n');
    } catch (e) {
      console.error('fetchWords:', e);
      alert('Failed to load word list.');
      state.starting = false;
      return;
    }
  } else {
    var chars = [];
    for (var k = 0; k < 800; k++) {
      chars.push(allowed[Math.floor(Math.random() * allowed.length)]);
      if (k > 0 && k % 10 === 0) chars.push('\n');
      else if (k > 0 && k % 2 === 0) chars.push(' ');
    }
    generatedText = chars.join('').trim();
  }

  if (state.timerInterval) clearInterval(state.timerInterval);

  state = {
    mode: mode,
    userName: document.getElementById('userName').value.trim() || 'Guest',
    fullText: generatedText, currentIndex: 0, isStarted: false,
    startTime: null, timerInterval: null, firstTimeCorrect: 0,
    errors: new Set(), timeLeft: 60, starting: false
  };

  var area = document.getElementById('display-area');
  area.className = '';
  area.style.fontSize = fSize + 'px';
  area.innerHTML = '';
  document.getElementById('results').innerHTML = '';
  document.getElementById('timer').textContent = mode === 'words' ? '0.0s' : '60s';

  state.fullText.split('').forEach(function (char, i) {
    var span = document.createElement('span');
    span.className = 'char';
    span.id = 'char-' + i;
    span.textContent = char === '\n' ? '↵\n' : char;
    area.appendChild(span);
  });
  updateCursor();
}

window.addEventListener('keydown', function (e) {
  if (!state.fullText || state.currentIndex >= state.fullText.length) return;
  if (e.key.length !== 1 && e.key !== 'Enter') return;
  if (document.activeElement && document.activeElement.id === 'userName') return;
  e.preventDefault();

  if (!state.isStarted) {
    state.isStarted = true;
    state.startTime = Date.now();
    state.timerInterval = setInterval(function () {
      var elapsed = (Date.now() - state.startTime) / 1000;
      if (state.mode === 'words') {
        document.getElementById('timer').textContent = elapsed.toFixed(1) + 's';
      } else {
        state.timeLeft = 60 - Math.floor(elapsed);
        document.getElementById('timer').textContent = state.timeLeft + 's';
        if (state.timeLeft <= 0) finish();
      }
    }, 100);
  }

  var expected = state.fullText[state.currentIndex];
  var input = e.key === 'Enter' ? '\n' : e.key;
  var el = document.getElementById('char-' + state.currentIndex);

  if (input === expected) {
    if (!state.errors.has(state.currentIndex)) state.firstTimeCorrect++;
    el.className = 'char correct';
    state.currentIndex++;
    if (state.currentIndex === state.fullText.length && state.mode === 'words') finish();
    else updateCursor();
  } else {
    el.className = 'char incorrect';
    state.errors.add(state.currentIndex);
  }
});

function updateCursor() {
  document.querySelectorAll('.cursor').forEach(function (c) { c.remove(); });
  var curEl = document.getElementById('char-' + state.currentIndex);
  if (curEl) {
    var cursor = document.createElement('div');
    cursor.className = 'cursor';
    curEl.appendChild(cursor);
    curEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

async function finish() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = null;
  var duration = (Date.now() - state.startTime) / 1000;
  var totalAttempted = state.currentIndex;
  var acc = totalAttempted > 0 ? (state.firstTimeCorrect / totalAttempted) : 0;
  var speed = duration > 0 ? (totalAttempted / duration) : 0;

  document.getElementById('timer').textContent = '—';
  document.getElementById('results').innerHTML =
    '<div class="result-panel">'
    + '<h3>Complete</h3>'
    + '<div class="result-stats">'
    + '<div class="result-stat"><span class="label">Accuracy</span><span class="value">' + Math.round(acc * 100) + '%</span></div>'
    + '<div class="result-stat"><span class="label">Speed</span><span class="value">' + speed.toFixed(2) + ' CPS</span></div>'
    + '<div class="result-stat"><span class="label">Duration</span><span class="value">' + duration.toFixed(1) + 's</span></div>'
    + '</div></div>';

  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: Date.now(),
        name: state.userName,
        mode: state.mode,
        accuracy: acc,
        speedCPS: speed,
        date: new Date().toISOString()
      })
    });
  } catch (e) {
    console.error('Failed to save log:', e);
  }
  fetchNames();
}

function toggleAllLetters(checked) {
  document.querySelectorAll('.letter-chk').forEach(function (c) { c.checked = checked; });
}

async function fetchNames() {
  try {
    var res = await fetch('/api/names');
    var names = await res.json();
    var dl = document.getElementById('nameOptions');
    if (dl) {
      dl.innerHTML = '';
      names.forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        dl.appendChild(opt);
      });
    }
  } catch (e) {
    console.error('fetchNames:', e);
  }
}

async function showStats() {
  document.getElementById('statsModal').style.display = 'block';
  try {
    var res = await fetch('/api/logs');
    var logs = await res.json();
    var wordBody = document.querySelector('#wordStatsTable tbody');
    var charBody = document.querySelector('#charStatsTable tbody');
    wordBody.innerHTML = '';
    charBody.innerHTML = '';
    logs.slice().reverse().forEach(function (log) {
      var row = document.createElement('tr');
      row.innerHTML = '<td>' + new Date(log.date).toLocaleDateString() + '</td>'
        + '<td>' + (log.name || '') + '</td>'
        + '<td>' + Math.round((log.accuracy || 0) * 100) + '%</td>'
        + '<td>' + (parseFloat(log.speedCPS) || 0).toFixed(2) + '</td>';
      if (log.mode === 'chars') charBody.appendChild(row);
      else wordBody.appendChild(row);
    });
  } catch (e) {
    console.error('showStats:', e);
  }
}

function closeStats() {
  document.getElementById('statsModal').style.display = 'none';
}

window.addEventListener('click', function (e) {
  var modal = document.getElementById('statsModal');
  if (e.target === modal) closeStats();
});
