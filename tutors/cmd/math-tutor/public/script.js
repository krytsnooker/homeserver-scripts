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
  try { sidebarCollapsed = localStorage.getItem('math-sidebar-collapsed') === '1'; } catch (e) {}
  function applySidebarState() {
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    sidebarToggle.innerHTML = sidebarCollapsed ? '&#8250;' : '&#8249;';
  }
  applySidebarState();
  sidebarToggle.addEventListener('click', function () {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem('math-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch (e) {}
    applySidebarState();
  });
})();

// === state ===
var state = {
  answer: 0, score: 0, attempted: 0,
  timeLeft: 0, interval: null, currentInput: ''
};

document.addEventListener('DOMContentLoaded', function () {
  // restore saved name
  try {
    var saved = localStorage.getItem('math-user-name');
    if (saved) document.getElementById('userName').value = saved;
  } catch (e) {}

  // variables dropdown
  var vc = document.getElementById('varCount');
  for (var i = 2; i <= 6; i++) vc.add(new Option(i, i));
  vc.value = 2;

  // font size dropdown
  var fs = document.getElementById('fontSize');
  for (var s = 24; s <= 96; s += 8) fs.add(new Option(s + 'px', s));
  fs.value = 48;

  // number grid 1-12
  var grid = document.getElementById('number-grid');
  var layout = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]];
  layout.forEach(function (row) {
    var div = document.createElement('div');
    div.className = 'num-row';
    row.forEach(function (n) {
      div.innerHTML += '<div class="num-item"><span>' + n + '</span>'
        + '<input type="checkbox" class="num-chk" value="' + n + '" checked></div>';
    });
    grid.appendChild(div);
  });

  onModeChange();
  fetchNames();

  // save name on change
  document.getElementById('userName').addEventListener('change', function () {
    try { localStorage.setItem('math-user-name', this.value); } catch (e) {}
  });
});

function onModeChange() {
  var mode = document.getElementById('mathMode').value;
  var varField = document.getElementById('varField');
  varField.style.display = (mode === 'addition' || mode === 'subtraction') ? '' : 'none';
}

function startSession() {
  if (document.activeElement) document.activeElement.blur();
  if (state.interval) clearInterval(state.interval);

  state = { answer: 0, score: 0, attempted: 0, timeLeft: 60, interval: null, currentInput: '' };

  var display = document.getElementById('display-area');
  display.className = '';
  display.style.fontSize = '';

  document.getElementById('results').innerHTML = '';
  document.getElementById('input-container').style.display = 'flex';
  document.getElementById('timer').textContent = '60s';

  clearInput();
  generate();

  state.interval = setInterval(function () {
    state.timeLeft--;
    document.getElementById('timer').textContent = state.timeLeft + 's';
    if (state.timeLeft <= 0) finish();
  }, 1000);
}

function generate() {
  var mode = document.getElementById('mathMode').value;
  var allowed = Array.from(document.querySelectorAll('.num-chk:checked')).map(function (c) { return parseInt(c.value); });
  var area = document.getElementById('display-area');

  if (allowed.length === 0) {
    alert('Select at least one number.');
    if (state.interval) clearInterval(state.interval);
    return;
  }

  var fontSize = parseInt(document.getElementById('fontSize').value);
  area.style.fontSize = fontSize + 'px';
  area.className = '';

  function pick() { return allowed[Math.floor(Math.random() * allowed.length)]; }

  if (mode === 'division') {
    var b = pick(), ans = pick();
    state.answer = ans;
    area.textContent = (b * ans) + ' ÷ ' + b + ' = ';
  } else if (mode === 'multiplication') {
    var base = pick();
    var mult = Math.floor(Math.random() * 12) + 1;
    state.answer = base * mult;
    area.textContent = base + ' × ' + mult + ' = ';
  } else {
    var count = parseInt(document.getElementById('varCount').value);
    var vars = [];
    for (var i = 0; i < count; i++) vars.push(pick());
    var op = mode === 'addition' ? '+' : '−';
    area.textContent = vars.join(' ' + op + ' ') + ' = ';
    state.answer = vars.reduce(function (a, b) {
      return mode === 'addition' ? a + b : a - b;
    });
  }
}

function numInput(n) {
  state.currentInput += n;
  document.getElementById('math-display-val').textContent = state.currentInput;
}

function clearInput() {
  state.currentInput = '';
  document.getElementById('math-display-val').textContent = '?';
}

function submitInput() {
  if (state.currentInput === '' || state.timeLeft <= 0) return;
  var val = parseInt(state.currentInput);
  state.attempted++;
  var area = document.getElementById('display-area');
  if (val === state.answer) {
    state.score++;
    area.className = 'correct';
  } else {
    area.className = 'incorrect';
  }
  setTimeout(function () {
    if (state.timeLeft > 0) { clearInput(); generate(); }
  }, 180);
}

window.addEventListener('keydown', function (e) {
  if (state.timeLeft <= 0) return;
  if (document.activeElement && document.activeElement.id === 'userName') return;
  if (e.key >= '0' && e.key <= '9') {
    numInput(e.key);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    submitInput();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    state.currentInput = state.currentInput.slice(0, -1);
    document.getElementById('math-display-val').textContent = state.currentInput || '?';
  } else if (e.key === 'Escape') {
    clearInput();
  }
});

async function finish() {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
  state.timeLeft = 0;

  document.getElementById('input-container').style.display = 'none';
  document.getElementById('display-area').className = '';
  document.getElementById('display-area').style.fontSize = '';
  document.getElementById('display-area').textContent = '';

  var acc = state.attempted > 0 ? (state.score / state.attempted) : 0;
  var accPct = Math.round(acc * 100);
  var name = document.getElementById('userName').value.trim() || 'Guest';

  document.getElementById('results').innerHTML =
    '<div class="result-panel">'
    + '<h3>Session Complete</h3>'
    + '<div class="result-stat"><span class="label">Score</span><span class="value">' + state.score + ' correct</span></div>'
    + '<div class="result-stat"><span class="label">Attempted</span><span class="value">' + state.attempted + '</span></div>'
    + '<div class="result-stat"><span class="label">Accuracy</span><span class="value">' + accPct + '%</span></div>'
    + '<div class="result-stat"><span class="label">Mode</span><span class="value">' + document.getElementById('mathMode').value + '</span></div>'
    + '</div>';

  document.getElementById('timer').textContent = '—';

  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        mode: document.getElementById('mathMode').value,
        score: state.score,
        accuracy: acc,
        date: new Date().toISOString()
      })
    });
  } catch (e) {
    console.error('Failed to save log:', e);
  }
  fetchNames();
}

function toggleAll(v) {
  document.querySelectorAll('.num-chk').forEach(function (c) { c.checked = v; });
}

async function fetchNames() {
  try {
    var res = await fetch('/api/names');
    var names = await res.json();
    var dl = document.getElementById('nameOptions');
    if (dl) {
      dl.innerHTML = '';
      names.forEach(function (n) { dl.add(new Option(n, n)); });
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
    var tbody = document.querySelector('#statsTable tbody');
    tbody.innerHTML = '';
    logs.slice().reverse().forEach(function (l) {
      var row = document.createElement('tr');
      row.innerHTML = '<td>' + new Date(l.date).toLocaleDateString() + '</td>'
        + '<td>' + (l.name || '') + '</td>'
        + '<td>' + (l.mode || '') + '</td>'
        + '<td>' + (l.score || 0) + '</td>'
        + '<td>' + Math.round((l.accuracy || 0) * 100) + '%</td>';
      tbody.appendChild(row);
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
