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
  try { sidebarCollapsed = localStorage.getItem('pb-sidebar-collapsed') === '1'; } catch (e) {}
  function applySidebarState() {
    sidebar.classList.toggle('collapsed', sidebarCollapsed);
    sidebarToggle.innerHTML = sidebarCollapsed ? '&#8250;' : '&#8249;';
  }
  applySidebarState();
  sidebarToggle.addEventListener('click', function () {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem('pb-sidebar-collapsed', sidebarCollapsed ? '1' : '0'); } catch (e) {}
    applySidebarState();
  });
})();

document.addEventListener('DOMContentLoaded', function () {
  try {
    var saved = localStorage.getItem('pb-user-name');
    if (saved) document.getElementById('userName').value = saved;
  } catch (e) {}

  document.getElementById('userName').addEventListener('change', function () {
    try { localStorage.setItem('pb-user-name', this.value); } catch (e) {}
  });

  document.getElementById('userFilter').addEventListener('change', function () {
    fetchAndRenderPastes(this.value);
  });

  var pathParts = window.location.pathname.split('/').filter(Boolean);
  if (pathParts[0] === 'paste' && pathParts[1]) {
    var id = parseInt(pathParts[1], 10);
    if (!isNaN(id) && id > 0) {
      showDetailView(id);
      return;
    }
  }
  showListView();
});

document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    var ta = document.getElementById('pasteContent');
    if (ta && document.activeElement === ta) {
      e.preventDefault();
      submitPaste();
    }
  }
});

function showListView() {
  document.getElementById('new-paste-section').style.display = '';
  document.getElementById('paste-list').style.display = '';
  document.getElementById('paste-detail').style.display = 'none';
  document.getElementById('filterField').style.display = '';
  fetchAndRenderPastes('');
  fetchUsers();
}

function showDetailView(id) {
  document.getElementById('new-paste-section').style.display = 'none';
  document.getElementById('paste-list').style.display = 'none';
  document.getElementById('paste-detail').style.display = '';
  document.getElementById('filterField').style.display = 'none';
  fetchAndRenderDetail(id);
}

async function fetchAndRenderPastes(userFilter) {
  var url = '/api/pastes';
  if (userFilter) url += '?user=' + encodeURIComponent(userFilter);
  try {
    var res = await fetch(url);
    var pastes = await res.json();
    renderPasteList(pastes);
  } catch (e) {
    console.error('fetchPastes:', e);
  }
}

function renderPasteList(pastes) {
  var list = document.getElementById('paste-list');
  list.innerHTML = '';
  var count = document.getElementById('paste-count');
  if (pastes.length === 0) {
    list.innerHTML = '<div class="empty-state">No pastes yet.</div>';
    if (count) count.textContent = '';
    return;
  }
  if (count) {
    count.style.fontFamily = '"IBM Plex Mono", monospace';
    count.style.fontSize = '0.78rem';
    count.style.color = 'var(--text-faint)';
    count.textContent = pastes.length + (pastes.length === 1 ? ' paste' : ' pastes');
  }
  pastes.forEach(function (p) { list.appendChild(makePasteCard(p, false)); });
}

function makePasteCard(p, isDetail) {
  var card = document.createElement('div');
  card.className = 'paste-card';
  card.id = 'paste-card-' + p.id;

  var meta = document.createElement('div');
  meta.className = 'paste-meta';

  var idLink = document.createElement('a');
  idLink.href = '/paste/' + p.id;
  idLink.className = 'paste-id';
  idLink.textContent = '#' + p.id;

  var author = document.createElement('span');
  author.className = 'paste-author';
  author.textContent = p.author || 'Anonymous';

  var dateSpan = document.createElement('span');
  dateSpan.className = 'paste-date';
  try { dateSpan.textContent = new Date(p.date).toLocaleString(); } catch (e) { dateSpan.textContent = p.date; }

  var deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-danger-sm';
  deleteBtn.textContent = 'delete';
  deleteBtn.addEventListener('click', function () { deletePaste(p.id, isDetail); });

  meta.appendChild(idLink);
  meta.appendChild(author);
  meta.appendChild(dateSpan);
  meta.appendChild(deleteBtn);

  var content = document.createElement('pre');
  content.className = 'paste-content';
  content.textContent = p.content;

  card.appendChild(meta);
  card.appendChild(content);
  return card;
}

async function fetchAndRenderDetail(id) {
  var detail = document.getElementById('paste-detail');
  try {
    var res = await fetch('/api/paste/' + id);
    if (!res.ok) {
      detail.innerHTML = '<div class="empty-state">Paste not found.</div>';
      return;
    }
    var p = await res.json();
    detail.innerHTML = '';
    var back = document.createElement('a');
    back.href = '/';
    back.className = 'back-nav';
    back.textContent = '← all pastes';
    detail.appendChild(back);
    detail.appendChild(makePasteCard(p, true));
  } catch (e) {
    console.error('fetchDetail:', e);
  }
}

async function submitPaste() {
  var author = (document.getElementById('userName').value.trim()) || 'Anonymous';
  var content = document.getElementById('pasteContent').value;
  if (!content.trim()) return;
  try {
    var res = await fetch('/api/paste', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: author, content: content })
    });
    if (!res.ok) { console.error('submitPaste failed:', res.status); return; }
    var p = await res.json();
    document.getElementById('pasteContent').value = '';
    var list = document.getElementById('paste-list');
    var emptyState = list.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    list.insertBefore(makePasteCard(p, false), list.firstChild);
    var count = document.getElementById('paste-count');
    if (count) {
      var n = list.querySelectorAll('.paste-card').length;
      count.textContent = n + (n === 1 ? ' paste' : ' pastes');
    }
    fetchUsers();
  } catch (e) {
    console.error('submitPaste:', e);
  }
}

async function deletePaste(id, isDetail) {
  try {
    var res = await fetch('/api/paste/' + id + '/delete', { method: 'POST' });
    if (!res.ok) { console.error('deletePaste failed:', res.status); return; }
    if (isDetail) {
      window.location.href = '/';
    } else {
      var card = document.getElementById('paste-card-' + id);
      if (card) card.remove();
      var list = document.getElementById('paste-list');
      if (list && list.querySelectorAll('.paste-card').length === 0) {
        list.innerHTML = '<div class="empty-state">No pastes yet.</div>';
      }
      var count = document.getElementById('paste-count');
      if (count) {
        var n = list ? list.querySelectorAll('.paste-card').length : 0;
        count.textContent = n > 0 ? n + (n === 1 ? ' paste' : ' pastes') : '';
      }
      fetchUsers();
    }
  } catch (e) {
    console.error('deletePaste:', e);
  }
}

async function fetchUsers() {
  try {
    var res = await fetch('/api/users');
    var users = await res.json();
    var select = document.getElementById('userFilter');
    var current = select.value;
    select.innerHTML = '<option value="">All users</option>';
    users.forEach(function (u) {
      var opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      if (u === current) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (e) {
    console.error('fetchUsers:', e);
  }
}
