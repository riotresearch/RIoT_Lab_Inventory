/* RIoT Center Inventory — website script. Generated from Index.html by tests/build_website.js.
   The server link is in config.js: edit that file, not this one. */

/* =====================================================================
   RIoT Center Inventory — front end
   ===================================================================== */
/* ---------------------------------------------------------------------
   SERVER LINK — on the website (GitHub Pages) the Apps Script /exec link
   is read from config.js. Do NOT edit it here: the website's security
   policy only allows this exact script. Inside Apps Script it is ignored.
   --------------------------------------------------------------------- */
const API_URL = String((window.RIOT_CONFIG && window.RIOT_CONFIG.apiUrl) || 'https://script.google.com/macros/s/AKfycbxsW_v19SkMVE3wH6y2OumhT54-cVhAuQUKi1DIpLgDnEqSfIrI8QFfHzC-90RNNifk/exec').trim();

let CFG = {   // defaults; the server's settings replace these after sign-in
  labName: 'RIoT Center', orgName: 'Independent University, Bangladesh', appTitle: 'RIoT Center Inventory',
  raCanEditItems: true, requestRoles: ['student', 'ra', 'admin'], approverRoles: ['ra', 'admin'], autoApproveRoles: ['admin'],
  approvalBy: { student: ['ra', 'admin'], ra: ['admin'], admin: ['admin'] },
  roomVisibleTo: ['admin', 'ra'], showCreditTo: ['ra', 'student'],
  roles: { student: 'Student', ra: 'Research Assistant (RA)', admin: 'Admin' },
  creditName: 'JH Rony', creditUrl: 'https://rony-cse.github.io/',
  rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6'],
  categories: ['Sensors', 'Microcontrollers & Boards', 'Modules', 'Actuators & Motors', 'Power & Batteries',
               'Communication & Networking', 'Displays', 'IT Products', 'Passive Components', 'Cables & Connectors', 'Tools & Equipment', 'Other'],
  conditions: ['New', 'Good', 'Fair', 'Needs repair', 'Damaged'],
};
const IN_APPS_SCRIPT = typeof google !== 'undefined' && !!(google.script && google.script.run);
const S = { token: null, user: null, items: [], myLoans: [], allLoans: [], users: [], log: [], overview: null, pending: null,
            view: 'inventory', adminTab: 'overview', reqFilter: 'requests', allocs: [], cat: '', room: '', layout: 'grid', currentItem: null, imgCache: {} };

// ---------- small helpers ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const modal = (id) => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const role = () => (S.user ? S.user.Role : '');
const isAdmin = () => role() === 'admin';
/* What each user type may do (the server enforces the same rules). */
const inRoles = (list) => (list || []).indexOf(role()) >= 0;
const CAN = {
  admin: () => role() === 'admin',
  addItem: () => role() === 'admin' || role() === 'ra',
  editItem: () => role() === 'admin' || (role() === 'ra' && CFG.raCanEditItems),
  deleteItem: () => role() === 'admin',
  request: () => inRoles(CFG.requestRoles),
  approve: () => inRoles(CFG.approverRoles),
  takeDirect: () => inRoles(CFG.autoApproveRoles),
  loansView: () => !!S.user,
  seeRoom: () => inRoles(CFG.roomVisibleTo),
  credit: () => !!CFG.creditName && inRoles(CFG.showCreditTo),
};
function applyPerms(root) {
  (root || document).querySelectorAll('[data-perm]').forEach((el) => {
    const f = CAN[el.dataset.perm];
    el.classList.toggle('d-none', !(f && f()));
  });
}
const pad = (n) => String(n).padStart(2, '0');
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fmtDate(s) {
  if (!s) return '—';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  return isNaN(d) ? esc(s) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d) ? esc(s) : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const isOverdue = (l) => (l.Status === 'OPEN' || l.Status === 'RETURN_PENDING') && l.ExpectedReturn && l.ExpectedReturn < todayStr();
const ACTIVE = { REQUESTED: 1, OPEN: 1, RETURN_PENDING: 1 };
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const isLow = (it) => it.MinQty > 0 && it.AvailableQty <= it.MinQty && it.AvailableQty > 0;

// ---------- server calls ----------
let busyCount = 0, busyTimer = null;
function busy(on) {
  busyCount += on ? 1 : -1;
  if (busyCount > 0 && !busyTimer) busyTimer = setTimeout(() => $('#busy').classList.add('show'), 250);
  if (busyCount <= 0) { busyCount = 0; clearTimeout(busyTimer); busyTimer = null; $('#busy').classList.remove('show'); }
}
const apiConfigured = () => IN_APPS_SCRIPT || /^https:\/\/script\.google(usercontent)?\.com\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(API_URL);

/** Low-level call: google.script.run inside Apps Script, otherwise fetch() to the /exec URL. */
function call(fn, args) {
  if (IN_APPS_SCRIPT) {
    return new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve)
        .withFailureHandler((err) => reject(new Error(String((err && err.message) || err).replace(/^(Error|Exception):\s*/i, ''))))[fn](...args);
    });
  }
  if (!apiConfigured()) return Promise.reject(new Error('This website is not connected to the server yet. Set API_URL in index.html.'));
  return fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // "simple" request: no CORS preflight
    body: JSON.stringify({ fn: fn, args: args }),
    redirect: 'follow',
    credentials: 'omit',                                       // never send Google cookies -> no account conflicts
  }).catch(() => { throw new Error('Cannot reach the server. Check your internet connection and try again.'); })
    .then((res) => res.text())
    .then((text) => {
      let r;
      try { r = JSON.parse(text); }
      catch (e) { throw new Error('The server gave an unexpected reply. Check that the Apps Script deployment has "Who has access: Anyone" and that API_URL is the /exec link.'); }
      if (!r.ok) throw new Error(String(r.error || 'Unknown error').replace(/^(Error|Exception):\s*/i, ''));
      return r.data;
    });
}
function run(fn, ...args) {
  busy(true);
  return call(fn, args).then(
    (r) => { busy(false); return r; },
    (err) => {
      busy(false);
      if (err.message.indexOf('SESSION_EXPIRED') >= 0) { endSession('Your session has expired. Please sign in again.'); throw new Error('Session expired'); }
      throw err;
    });
}
const api = (fn, ...args) => run(fn, S.token, ...args);
function applyConfig(c) {
  if (!c) return;
  CFG = Object.assign({}, CFG, c);
  document.title = CFG.appTitle;
  $('#loginLab').textContent = CFG.labName; $('#loginOrg').textContent = CFG.orgName;
  $('#navLab').textContent = CFG.labName; $('#navOrg').textContent = CFG.orgName;
  $('#footer').textContent = CFG.labName + ' · ' + CFG.orgName + ' · Lab Inventory';
  // credit is filled in only for the user types in showCreditTo (not for Admin, not on the sign-in page)
  const credit = CAN.credit()
    ? 'Developed by ' + (safeUrl(CFG.creditUrl) ? '<a href="' + esc(CFG.creditUrl) + '" target="_blank" rel="noopener">' + esc(CFG.creditName) + '</a>' : esc(CFG.creditName))
    : '';
  $$('.credit-line').forEach((el) => { el.innerHTML = credit; });
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast align-items-center border-0 text-bg-' + (type || 'success');
  el.innerHTML = '<div class="d-flex"><div class="toast-body">' + esc(msg) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
  $('#toasts').appendChild(el);
  const t = new bootstrap.Toast(el, { delay: type === 'danger' ? 6000 : 3000 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}
const fail = (e) => { if (e && e.message !== 'Session expired') toast(e.message, 'danger'); };
function showErr(id, msg) { const el = $(id); el.textContent = msg || ''; el.classList.toggle('d-none', !msg); }

function confirmBox(title, msg, okText) {
  return new Promise((resolve) => {
    $('#cfTitle').textContent = title; $('#cfMsg').textContent = msg; $('#cfOk').textContent = okText || 'Confirm';
    const m = modal('confirmModal'); let ok = false;
    $('#cfOk').onclick = () => { ok = true; m.hide(); };
    document.getElementById('confirmModal').addEventListener('hidden.bs.modal', () => resolve(ok), { once: true });
    m.show();
  });
}
function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(10); crypto.getRandomValues(a);
  return Array.from(a, (n) => chars[n % chars.length]).join('');
}
function copyText(text) {
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e) { toast('Select the text and copy it manually', 'warning'); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied'), fallback);
  else fallback();
}
function showCreds(username, password) {
  $('#credText').textContent = CFG.labName + ' Inventory\nUsername: ' + username + '\nPassword: ' + password;
  modal('credModal').show();
}

// =====================================================================
//  SESSION
// =====================================================================
function showLogin(msg) {
  $('#appView').classList.add('d-none');
  $('#loginView').classList.remove('d-none');
  showErr('#loginAlert', msg);
  setTimeout(() => $('#loginUser').focus(), 50);
}
function endSession(msg) {
  S.token = null; S.user = null; S.pending = null; store.del('riot_token');
  applyConfig({});   // removes the footer credit
  $$('.modal.show').forEach((m) => bootstrap.Modal.getInstance(m) && bootstrap.Modal.getInstance(m).hide());
  showLogin(msg);
}
async function doLogin(e) {
  e.preventDefault();
  showErr('#loginAlert', '');
  const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await run('login', $('#loginUser').value, $('#loginPass').value);
    S.token = r.token; store.set('riot_token', r.token);
    $('#loginPass').value = '';
    await loadApp();
  } catch (err) { showErr('#loginAlert', err.message); }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}
async function loadApp() {
  const d = await api('getBootstrap');
  S.user = d.user; S.items = d.items; S.myLoans = d.myLoans; S.pending = d.pending;
  applyConfig(d.config);
  S.reqFilter = CAN.approve() ? 'requests' : 'all';
  $('#loginView').classList.add('d-none');
  $('#appView').classList.remove('d-none');
  $('#navUser').textContent = S.user.FullName || S.user.Username;
  $('#navUserRole').textContent = '@' + S.user.Username + ' · ' + ((CFG.roles || {})[role()] || role());
  applyPerms();
  fillCategoryList(); fillRoomFilter(); renderBadge();
  setLayout(store.get('riot_layout') || 'grid', true);
  setView(store.get('riot_view') || 'inventory');
}
/* RA/Admin: keep the "Requests" badge up to date (every 60 s while the page is open). */
setInterval(() => {
  if (!S.token || !CAN.approve() || document.visibilityState !== 'visible') return;
  call('getPendingCounts', [S.token]).then((p) => { S.pending = p; renderBadge(); }).catch(() => {});
}, 60000);
function renderBadge() {
  const p = S.pending, n = p ? p.requests + p.returns : 0, b = $('#navBadge');
  b.textContent = n; b.classList.toggle('d-none', !n);
  b.title = p ? p.requests + ' request(s) to approve, ' + p.returns + ' return(s) to check' : '';
}
async function doLogout() {
  const t = S.token;
  endSession('');
  if (t) run('logout', t).catch(() => {});
}

// =====================================================================
//  NAVIGATION
// =====================================================================
function setView(v) {
  if ((v === 'admin' && !CAN.admin()) || (v === 'loans' && !CAN.request()) || (v === 'requests' && !CAN.loansView()) ||
      !document.getElementById('view-' + v)) v = 'inventory';
  S.view = v; store.set('riot_view', v);
  $$('.app-view').forEach((el) => el.classList.toggle('d-none', el.id !== 'view-' + v));
  $$('.app-nav .nav-link').forEach((el) => el.classList.toggle('active', el.dataset.view === v));
  const nav = document.getElementById('mainNav');
  if (nav.classList.contains('show')) bootstrap.Collapse.getOrCreateInstance(nav).hide();
  if (v === 'inventory') renderInventory();
  if (v === 'loans') { renderMyLoans(); refreshMyLoans(true); }
  if (v === 'requests') loadRequests();
  if (v === 'admin') setAdminTab(S.adminTab === 'loans' ? 'overview' : S.adminTab);
  window.scrollTo(0, 0);
}

// =====================================================================
//  INVENTORY
// =====================================================================
function allCategories() {
  const set = new Set(CFG.categories);
  S.items.forEach((i) => i.Category && set.add(String(i.Category)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
function fillCategoryList() {   // suggestions in the Add/Edit item form
  $('#catList').innerHTML = allCategories().map((c) => '<option value="' + esc(c) + '">').join('');
  const locs = new Set(S.items.map((i) => String(i.Location || '').trim()).filter(Boolean));
  $('#locList').innerHTML = Array.from(locs).sort().map((c) => '<option value="' + esc(c) + '">').join('');
}
/* ---- rooms ---- */
const NO_ROOM = '__none__';
function allRooms() {   // configured rooms first (Room 1..6), then any other places people typed
  const extra = new Set();
  S.items.forEach((i) => { const r = String(i.Room || '').trim(); if (r && CFG.rooms.indexOf(r) < 0) extra.add(r); });
  return CFG.rooms.concat(Array.from(extra).sort((a, b) => a.localeCompare(b)));
}
function fillRoomFilter() {
  const counts = {}; S.items.forEach((i) => { const r = String(i.Room || '').trim() || NO_ROOM; counts[r] = (counts[r] || 0) + 1; });
  const opt = (v, label) => '<option value="' + esc(v) + '">' + esc(label) + (counts[v] ? ' (' + counts[v] + ')' : '') + '</option>';
  $('#fRoom').innerHTML = '<option value="">All rooms</option>' + allRooms().map((r) => opt(r, r)).join('') + (counts[NO_ROOM] ? opt(NO_ROOM, 'Room not set') : '');
  $('#fRoom').value = S.room;
  if ($('#fRoom').value !== S.room) { S.room = ''; $('#fRoom').value = ''; }
  $('#roomList').innerHTML = allRooms().map((r) => '<option value="' + esc(r) + '">').join('');
}
const roomOf = (it) => String(it.Room || '').trim() || NO_ROOM;
const NO_CAT = '__none__';
const catOf = (it) => String(it.Category || '').trim() || NO_CAT;
const compact = (s) => s.replace(/[^a-z0-9]/g, '');

/* ---- dynamic search ----
   Every word must match somewhere in: name, description, category, ID, location, condition.
   Forgiving: case-insensitive, "dht22" finds "DHT-22", "sensors" finds "sensor". */
function searchWords() {
  return $('#fSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
}
function matchesSearch(it, words) {
  if (!words.length) return true;
  const hay = [it.ItemID, it.Name, it.Category, it.Details, it.Room, it.Location, it.Condition].join(' ').toLowerCase();
  const hayC = compact(hay);
  return words.every((w) => {
    // single letters/digits ("cabinet a", "drawer 3") must be a whole word, otherwise they match everything
    if (w.length === 1) return new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9]/g, '\\$&') + '([^a-z0-9]|$)').test(hay);
    const stem = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    return hay.indexOf(w) >= 0 || hay.indexOf(stem) >= 0 || (compact(stem) && hayC.indexOf(compact(stem)) >= 0);
  });
}
const matchesRoom = (it) => !S.room || roomOf(it) === S.room;
function matchesStock(it) {
  const stock = $('#fStock').value;
  if (stock === 'avail') return it.AvailableQty > 0;
  if (stock === 'low') return isLow(it);
  if (stock === 'out') return it.AvailableQty <= 0;
  return true;
}
function filteredItems() {
  const words = searchWords(), sort = $('#fSort').value;
  const list = S.items.filter((it) => (!S.cat || catOf(it) === S.cat) && matchesRoom(it) && matchesStock(it) && matchesSearch(it, words));
  const by = {
    name: (a, b) => String(a.Name).localeCompare(String(b.Name)),
    recent: (a, b) => String(b.UpdatedAt).localeCompare(String(a.UpdatedAt)),
    avail: (a, b) => a.AvailableQty - b.AvailableQty,
    id: (a, b) => String(a.ItemID).localeCompare(String(b.ItemID)),
  };
  return list.sort(by[sort] || by.name);
}
/** Category chips with live counts (counts follow the current search & stock filter). */
function renderChips() {
  const words = searchWords();
  const base = S.items.filter((it) => matchesRoom(it) && matchesStock(it) && matchesSearch(it, words));
  const counts = {};
  S.items.forEach((it) => { counts[catOf(it)] = 0; });
  base.forEach((it) => { counts[catOf(it)]++; });
  const cats = Object.keys(counts).sort((a, b) => (a === NO_CAT) - (b === NO_CAT) || a.localeCompare(b));
  if (S.cat && !(S.cat in counts)) S.cat = '';
  const chip = (val, label, n, icon) =>
    '<button type="button" class="chip' + (S.cat === val ? ' active' : '') + '" data-action="cat" data-id="' + esc(val) + '"' + (n === 0 && S.cat !== val ? ' disabled' : '') + '>' +
    (icon ? '<i class="bi ' + icon + ' me-1"></i>' : '') + esc(label) + '<span class="n">' + n + '</span></button>';
  $('#catChips').innerHTML = chip('', 'All', base.length, 'bi-grid') +
    cats.map((c) => chip(c, c === NO_CAT ? 'Uncategorized' : c, counts[c], catIcon(c === NO_CAT ? '' : c))).join('');
}
function hl(text, words) {   // highlight search words
  text = String(text == null ? '' : text);
  if (!words.length) return esc(text);
  const re = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
  return text.split(re).map((p, i) => (i % 2 ? '<mark>' + esc(p) + '</mark>' : esc(p))).join('');
}
function setLayout(l, silent) {
  S.layout = l === 'list' ? 'list' : 'grid';
  store.set('riot_layout', S.layout);
  $$('[data-action="set-layout"]').forEach((b) => b.classList.toggle('active', b.dataset.layout === S.layout));
  if (!silent) renderInventory();
}
function clearFilters() {
  $('#fSearch').value = ''; $('#fStock').value = ''; $('#fRoom').value = ''; S.cat = ''; S.room = '';
  renderInventory();
}
const CAT_ICONS = [[/sensor/i, 'bi-thermometer-half'], [/micro|board|arduino|esp|raspberry/i, 'bi-cpu'], [/module/i, 'bi-motherboard'],
  [/motor|actuator|servo/i, 'bi-gear'], [/power|batter/i, 'bi-battery-charging'], [/network|communic|wifi|lora/i, 'bi-wifi'],
  [/display|lcd|oled/i, 'bi-display'], [/^IT\b|computer|laptop/, 'bi-laptop'], [/cable|connector|wire/i, 'bi-plug'], [/tool|equipment/i, 'bi-tools'], [/passive|component/i, 'bi-diagram-2']];
function catIcon(c) { const m = CAT_ICONS.find(([re]) => re.test(c || '')); return m ? m[1] : 'bi-box-seam'; }
function imgHtml(it, cls) {
  if (!it.ImageFileId) return '<i class="bi ' + catIcon(it.Category) + ' ' + cls + '"></i>';
  const cached = S.imgCache[it.ImageFileId];
  return '<img class="item-photo" loading="lazy" referrerpolicy="no-referrer" alt="" data-fid="' + esc(it.ImageFileId) + '" data-cat="' + esc(it.Category) + '" src="' + esc(cached || it.ImageURL) + '">';
}
const whereText = (it) => [it.Room, it.Location].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
function stockBadge(it) {
  if (it.AvailableQty <= 0) return '<span class="badge text-bg-danger">Out of stock</span>';
  if (isLow(it)) return '<span class="badge text-bg-warning">Low · ' + it.AvailableQty + ' left</span>';
  return '<span class="badge text-bg-success">' + it.AvailableQty + ' available</span>';
}
function renderInventory() {
  const list = filteredItems();
  const units = S.items.reduce((a, i) => a + i.TotalQty, 0);
  const onLoan = S.items.reduce((a, i) => a + Math.max(0, i.TotalQty - i.AvailableQty), 0);
  const low = S.items.filter(isLow).length, out = S.items.filter((i) => i.AvailableQty <= 0).length;
  const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  $('#invSummary').textContent = pl(S.items.length, 'item') + ' · ' + pl(units, 'unit') + ' · ' + onLoan + ' on loan' +
    (low ? ' · ' + low + ' low' : '') + (out ? ' · ' + out + ' out of stock' : '');
  renderChips();
  const words = searchWords();
  const filtering = !!(words.length || S.cat || S.room || $('#fStock').value);
  $('#clearFilters').classList.toggle('d-none', !filtering);
  const catLabel = S.cat === NO_CAT ? 'Uncategorized' : S.cat;
  $('#resultInfo').textContent = filtering
    ? 'Showing ' + list.length + ' of ' + pl(S.items.length, 'item') + (S.cat ? ' in “' + catLabel + '”' : '') + (S.room ? ' in ' + (S.room === NO_ROOM ? 'no room' : S.room) : '') + (words.length ? ' matching “' + $('#fSearch').value.trim() + '”' : '')
    : '';
  if (!list.length) {
    $('#itemGrid').innerHTML = '<div class="empty"><i class="bi bi-inboxes"></i>' +
      (S.items.length ? 'No items match your search.' : (CAN.addItem() ? 'No items yet. Click <b>Add item</b> to create the first one.' : 'No items in the inventory yet.')) + '</div>';
    return;
  }
  const snippet = (it) => {   // show the matching part of the description
    const d = String(it.Details || '').replace(/\s+/g, ' ');
    if (!d) return '';
    let start = 0;
    if (words.length) { const i = d.toLowerCase().indexOf(words[0]); if (i > 40) start = i - 30; }
    return (start ? '…' : '') + d.slice(start, start + 110) + (d.length > start + 110 ? '…' : '');
  };
  if (S.layout === 'list') {
    $('#itemGrid').innerHTML = '<div class="card table-card"><div class="table-responsive"><table class="table table-hover mb-0">' +
      '<thead class="table-light small"><tr><th></th><th>Item</th><th class="d-none d-md-table-cell">Category</th><th class="d-none d-lg-table-cell">Where</th><th class="text-end">Stock</th></tr></thead><tbody>' +
      list.map((it) =>
        '<tr class="list-row" data-action="open-item" data-id="' + esc(it.ItemID) + '">' +
          '<td style="width:60px"><div class="list-thumb">' + imgHtml(it, 'ph') + '</div></td>' +
          '<td><div class="fw-semibold">' + hl(it.Name, words) + '</div>' +
            '<div class="small text-muted">' + esc(it.ItemID) + '<span class="d-md-none"> · ' + hl(it.Category, words) + '</span></div>' +
            (snippet(it) ? '<div class="small text-muted d-none d-sm-block">' + hl(snippet(it), words) + '</div>' : '') + '</td>' +
          '<td class="small d-none d-md-table-cell">' + hl(it.Category, words) + '</td>' +
          '<td class="small d-none d-lg-table-cell">' + hl(whereText(it), words) + '</td>' +
          '<td class="text-end text-nowrap">' + stockBadge(it) + '<div class="small text-muted">of ' + it.TotalQty + '</div></td>' +
        '</tr>').join('') +
      '</tbody></table></div></div>';
    return;
  }
  $('#itemGrid').innerHTML = '<div class="row g-3">' + list.map((it) =>
    '<div class="col-6 col-md-4 col-lg-3 col-xxl-2">' +
      '<div class="card item-card h-100" data-action="open-item" data-id="' + esc(it.ItemID) + '">' +
        '<div class="item-img">' + imgHtml(it, 'ph') + '</div>' +
        '<div class="card-body p-2 p-md-3 d-flex flex-column">' +
          '<div class="small text-muted text-truncate">' + esc(it.ItemID) + (it.Category ? ' · ' + hl(it.Category, words) : '') + '</div>' +
          '<div class="fw-semibold clamp-2 my-1">' + hl(it.Name, words) + '</div>' +
          '<div class="mt-auto d-flex flex-wrap align-items-center justify-content-between gap-1">' + stockBadge(it) +
            '<span class="small text-muted">of ' + it.TotalQty + '</span></div>' +
          (whereText(it) ? '<div class="small text-muted text-truncate mt-1"><i class="bi bi-geo-alt me-1"></i>' + hl(whereText(it), words) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>').join('') + '</div>';
}
// Images that cannot load from Drive (e.g. domain sharing policy) are fetched through the server.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('item-photo') || img.dataset.retried) return;
  img.dataset.retried = '1';
  const fid = img.dataset.fid;
  call('getImageData', [S.token, fid])
    .then((data) => { S.imgCache[fid] = data; $$('img[data-fid="' + fid + '"]').forEach((el) => { el.src = data; }); })
    .catch(() => { if (img.isConnected) img.outerHTML = '<i class="bi ' + catIcon(img.dataset.cat) + ' ph"></i>'; });
}, true);

function upsertItem(it) {
  if (!it) return;
  const i = S.items.findIndex((x) => x.ItemID === it.ItemID);
  if (i >= 0) S.items[i] = it; else S.items.push(it);
}
async function refreshAll() {
  try {
    const d = await api('getBootstrap');
    S.items = d.items; S.myLoans = d.myLoans; S.user = d.user; S.pending = d.pending;
    applyConfig(d.config);
    applyPerms(); fillCategoryList(); fillRoomFilter(); renderBadge(); setView(S.view); toast('Inventory refreshed');
  } catch (e) { fail(e); }
}

// ---------- item detail ----------
function openItem(id) {
  const it = S.items.find((x) => x.ItemID === id);
  if (!it) return;
  S.currentItem = it;
  $('#imId').textContent = it.ItemID + (it.Category ? ' · ' + it.Category : '');
  $('#imName').textContent = it.Name;
  const row = (k, v) => v ? '<tr><th>' + k + '</th><td>' + v + '</td></tr>' : '';
  const link = safeUrl(it.DatasheetURL);
  let html =
    '<div class="row g-4">' +
      '<div class="col-md-5"><div class="detail-img-wrap">' + imgHtml(it, 'detail-ph') + '</div></div>' +
      '<div class="col-md-7">' +
        '<div class="d-flex align-items-center gap-2 mb-3">' + stockBadge(it) + '<span class="text-muted small">' + it.AvailableQty + ' of ' + it.TotalQty + ' in the lab</span></div>' +
        '<table class="table table-sm kv mb-3"><tbody>' +
          row('Room', esc(it.Room)) + row('Shelf / box', esc(it.Location)) + row('Condition', esc(it.Condition)) +
          row('Purchased', it.PurchaseDate ? fmtDate(it.PurchaseDate) : '') +
          row('Low-stock alert', it.MinQty ? 'at ' + it.MinQty : '') +
          row('Datasheet', link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Open link <i class="bi bi-box-arrow-up-right"></i></a>' : '') +
          row('Last updated', fmtDateTime(it.UpdatedAt) + (it.UpdatedBy ? ' by ' + esc(it.UpdatedBy) : '')) +
        '</tbody></table>' +
        (it.Details ? '<h6 class="fw-semibold small text-muted text-uppercase">Details</h6><div class="pre-wrap small mb-3">' + esc(it.Details) + '</div>' : '') +
      '</div>' +
    '</div>';
  if (CAN.request()) {
    const direct = CAN.takeDirect();
    const mine = S.myLoans.filter((l) => l.ItemID === it.ItemID && ACTIVE[l.Status]);
    html += '<hr><h6 class="fw-bold mb-2"><i class="bi ' + (direct ? 'bi-box-arrow-up-right' : 'bi-send') + ' me-2 text-brand"></i>' + (direct ? 'Take out' : 'Request to borrow') + '</h6>';
    if (mine.length) {
      html += '<div class="alert alert-info py-2 small">' + mine.map((l) => 'You have ' + l.Qty + ' × this item: <b>' + esc(loanLabel(l)[0]) + '</b>').join('<br>') +
        ' — see <a href="#" data-action="nav" data-view="loans">My Items</a>.</div>';
    }
    if (it.AvailableQty > 0) {
      html +=
        (direct ? '' : '<p class="small text-muted mb-2">' + esc(approverText().replace(/^./, (c) => c.toUpperCase())) + ' will approve your request. Collect the item from the lab after it is approved.</p>') +
        '<form id="borrowForm" class="row g-2 align-items-end">' +
          '<div class="col-4 col-md-2"><label class="form-label small fw-medium" for="bQty">Qty</label><input class="form-control" type="number" id="bQty" min="1" max="' + it.AvailableQty + '" value="1" required></div>' +
          '<div class="col-8 col-md-4"><label class="form-label small fw-medium" for="bDate">Return by (optional)</label><input class="form-control" type="date" id="bDate" min="' + todayStr() + '"></div>' +
          '<div class="col-12 col-md-6"><label class="form-label small fw-medium" for="bPurpose">Purpose / project *</label><input class="form-control" id="bPurpose" maxlength="300" placeholder="e.g. CSE-499 capstone, smart irrigation" required></div>' +
          '<div class="col-12"><div id="bError" class="alert alert-danger py-2 small d-none mb-2"></div><button class="btn btn-primary" type="submit" id="bSubmit">' +
            (direct ? '<i class="bi bi-check2-circle me-1"></i>Confirm take out' : '<i class="bi bi-send me-1"></i>Send request') + '</button></div>' +
        '</form>';
    } else {
      html += '<p class="text-muted small mb-0">Currently out of stock.</p>';
    }
  }
  html += '<hr><h6 class="fw-bold mb-2"><i class="bi bi-people me-2 text-brand"></i>Who has requested / borrowed this</h6><div id="imLoans" class="small text-muted">Loading…</div>';
  if (CAN.admin()) html += '<h6 class="fw-bold mb-2 mt-3"><i class="bi bi-person-workspace me-2 text-brand"></i>Allocated to</h6><div id="imAllocs" class="small text-muted">Loading…</div>';
  $('#imBody').innerHTML = html;
  const f = $('#borrowForm'); if (f) f.addEventListener('submit', submitBorrow);
  applyPerms($('#imFooter'));
  $('#imFooter').classList.toggle('d-none', !(CAN.editItem() || CAN.deleteItem()));
  modal('itemModal').show();
  if (CAN.admin()) {
    api('listAllocations', it.ItemID).then((list) => {
      const el = $('#imAllocs'); if (!el || S.currentItem !== it) return;
      el.innerHTML = list.length ? '<ul class="list-unstyled mb-0">' + list.map((a) =>
        '<li class="py-1 border-bottom"><b>' + a.Qty + '×</b> ' + esc(a.FullName) + ' <span class="text-muted">(@' + esc(a.Username) + ')</span> · since ' + fmtDate(a.AllocatedAt) +
        (a.Note ? '<div class="text-muted">' + esc(a.Note) + '</div>' : '') + '</li>').join('') + '</ul>' : 'Not allocated to anyone.';
    }).catch(fail);
  }
  {
    api('listLoans', 'item', it.ItemID).then((loans) => {
      const el = $('#imLoans'); if (!el || S.currentItem !== it) return;
      el.innerHTML = loans.length ? '<ul class="list-unstyled mb-0">' + loans.map((l) =>
        '<li class="py-1 border-bottom"><b>' + l.Qty + '×</b> ' + esc(l.FullName) + ' <span class="text-muted">(@' + esc(l.Username) + ')</span> · ' +
        statusBadge(l) + ' <span class="text-muted">' + fmtDate(l.BorrowedAt || l.RequestedAt) + '</span><div class="text-muted">' + esc(l.Purpose) + '</div></li>').join('') + '</ul>'
        : 'Nobody has this item or has asked for it right now.';
    }).catch(fail);
  }
}
async function submitBorrow(e) {
  e.preventDefault();
  const it = S.currentItem;
  showErr('#bError', '');
  const btn = $('#bSubmit'); btn.disabled = true;
  try {
    const r = await api('requestLoan', it.ItemID, Number($('#bQty').value), $('#bPurpose').value, $('#bDate').value);
    upsertItem(r.item); S.myLoans.unshift(r.loan);
    modal('itemModal').hide(); renderInventory();
    if (r.loan.Status === 'OPEN') toast('You took ' + r.loan.Qty + ' × ' + r.loan.ItemName + '. Remember to return it!');
    else toast('Request sent for ' + r.loan.Qty + ' × ' + r.loan.ItemName + '. You will see the answer in My Items.');
  } catch (err) { showErr('#bError', err.message); btn.disabled = false; }
}

// ---------- item form ----------
let pendingImage = null;
const ROOM_OTHER = '__other__';
function setRoomField(value) {
  const v = String(value || '').trim();
  const rooms = allRooms();
  $('#ifRoom').innerHTML = '<option value="">— not set —</option>' + rooms.map((r) => '<option value="' + esc(r) + '">' + esc(r) + '</option>').join('') +
    '<option value="' + ROOM_OTHER + '">Other…</option>';
  const known = !v || rooms.indexOf(v) >= 0;
  $('#ifRoom').value = known ? v : ROOM_OTHER;
  $('#ifRoomOther').value = known ? '' : v;
  $('#ifRoomOther').classList.toggle('d-none', known);
}
function roomFieldValue() {
  return $('#ifRoom').value === ROOM_OTHER ? $('#ifRoomOther').value.trim() : $('#ifRoom').value;
}
function openItemForm(id) {
  const it = id ? S.items.find((x) => x.ItemID === id) : null;
  pendingImage = null;
  $('#itemForm').reset();
  showErr('#ifError', '');
  hideSuggest(); $('#ifDup').classList.add('d-none');
  $('#ifTitle').textContent = it ? 'Edit ' + it.ItemID : 'Add item';
  $('#ifCondition').innerHTML = '<option value="">—</option>' + CFG.conditions.map((c) => '<option>' + esc(c) + '</option>').join('');
  fillCategoryList();
  $('#ifId').value = it ? it.ItemID : '';
  $('#ifName').value = it ? it.Name : '';
  $('#ifCategory').value = it ? it.Category : '';
  $('#ifCondition').value = it ? (it.Condition || '') : 'New';
  $('#ifTotal').value = it ? it.TotalQty : 1;
  $('#ifMin').value = it && it.MinQty ? it.MinQty : '';
  setRoomField(it ? it.Room : '');
  $('#ifLocation').value = it ? it.Location : '';
  $('#ifPurchase').value = it ? it.PurchaseDate : '';
  $('#ifDetails').value = it ? it.Details : '';
  $('#ifLink').value = it ? it.DatasheetURL : '';
  const onLoan = it ? it.TotalQty - it.AvailableQty : 0;
  $('#ifLoanNote').textContent = onLoan > 0 ? onLoan + ' currently on loan — available stock will be total minus ' + onLoan + '.' : '';
  $('#ifPreview').innerHTML = it && it.ImageFileId ? imgHtml(it, '') : '<i class="bi bi-image text-secondary fs-1"></i>';
  $('#ifImgInfo').textContent = 'Photos are shrunk automatically (max 800 px, about 100 KB) before upload.';
  $('#ifRemoveWrap').classList.toggle('d-none', !(it && it.ImageFileId));
  modal('itemFormModal').show();
}

/* ---- item name suggestions (like a search box): type "Sta" → "Stapler" ---- */
let sugIndex = -1, sugList = [];
function hideSuggest() {
  $('#ifNameSug').classList.add('d-none'); $('#ifNameSug').innerHTML = '';
  $('#ifName').setAttribute('aria-expanded', 'false'); sugIndex = -1; sugList = [];
}
function nameSuggestions(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  const self = $('#ifId').value, seen = new Set(), out = [];
  S.items.forEach((it) => {
    if (it.ItemID === self) return;
    const n = String(it.Name || ''), l = n.toLowerCase();
    if (seen.has(l)) return;
    const rank = l.startsWith(q) ? 0 : (l.split(/[^a-z0-9]+/).some((w) => w.startsWith(q)) ? 1 : (l.indexOf(q) >= 0 ? 2 : -1));
    if (rank < 0 || l === q) return;
    seen.add(l); out.push({ it, rank });
  });
  return out.sort((a, b) => a.rank - b.rank || String(a.it.Name).localeCompare(String(b.it.Name))).slice(0, 7).map((x) => x.it);
}
function showSuggest() {
  const q = $('#ifName').value;
  sugList = nameSuggestions(q); sugIndex = -1;
  checkDuplicate();
  if (!sugList.length) { hideSuggest(); return; }
  const words = [q.trim().toLowerCase()];
  $('#ifNameSug').innerHTML = sugList.map((it, i) =>
    '<div class="list-group-item" role="option" id="sug' + i + '" data-i="' + i + '">' +
      '<div>' + hl(it.Name, words) + '</div>' +
      '<div class="meta">' + esc(it.ItemID) + (it.Category ? ' · ' + esc(it.Category) : '') + ' · ' + it.AvailableQty + ' of ' + it.TotalQty + ' available</div>' +
    '</div>').join('');
  $('#ifNameSug').classList.remove('d-none');
  $('#ifName').setAttribute('aria-expanded', 'true');
}
function pickSuggest(i) {
  const it = sugList[i]; if (!it) return;
  $('#ifName').value = it.Name;
  if (!$('#ifCategory').value) $('#ifCategory').value = it.Category || '';
  hideSuggest(); checkDuplicate();
}
function moveSuggest(d) {
  if (!sugList.length) return;
  sugIndex = (sugIndex + d + sugList.length) % sugList.length;
  $$('#ifNameSug .list-group-item').forEach((el, i) => el.classList.toggle('active', i === sugIndex));
  $('#ifName').setAttribute('aria-activedescendant', 'sug' + sugIndex);
}
/** Warn when the name already exists, so people update the quantity instead of adding a duplicate. */
function checkDuplicate() {
  const n = $('#ifName').value.trim().toLowerCase(), self = $('#ifId').value;
  const dup = n && S.items.find((it) => it.ItemID !== self && String(it.Name).trim().toLowerCase() === n);
  const el = $('#ifDup');
  el.classList.toggle('d-none', !dup);
  if (dup) {
    el.innerHTML = '<i class="bi bi-info-circle me-1"></i>“' + esc(dup.Name) + '” is already in the inventory (' + esc(dup.ItemID) + ', ' + dup.TotalQty + ' total). ' +
      (CAN.editItem() ? '<a href="#" data-action="open-dup" data-id="' + esc(dup.ItemID) + '">Edit that item</a> to change its quantity, or save to add a separate entry.' : '');
  }
}
$('#ifName').addEventListener('input', showSuggest);
$('#ifName').addEventListener('focus', showSuggest);
$('#ifName').addEventListener('blur', () => setTimeout(hideSuggest, 150));
$('#ifName').addEventListener('keydown', (e) => {
  if ($('#ifNameSug').classList.contains('d-none')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSuggest(-1); }
  else if (e.key === 'Enter' && sugIndex >= 0) { e.preventDefault(); pickSuggest(sugIndex); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggest(); }
});
$('#ifNameSug').addEventListener('mousedown', (e) => {   // mousedown fires before the input loses focus
  const el = e.target.closest('[data-i]'); if (!el) return;
  e.preventDefault(); pickSuggest(Number(el.dataset.i));
});

/* ---- photo optimisation: every photo is shrunk in the browser before it reaches Google Drive ----
   max 800 px on the long side, JPEG, quality lowered step by step until it is ≤ ~120 KB. */
const IMG_MAX_PX = 800, IMG_TARGET_BYTES = 120 * 1024, IMG_MAX_INPUT = 30 * 1024 * 1024;
function decodeImage(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => decodeWithImg(file));
  }
  return decodeWithImg(file);
}
function decodeWithImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format is not supported. Use a JPG or PNG photo.')); };
    img.src = url;
  });
}
const canvasBlob = (c, q) => new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', q));
const blobToDataUrl = (b) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the image.')); r.readAsDataURL(b); });
async function optimizeImage(file) {
  if (!/^image\//.test(file.type || 'image/')) throw new Error('Please choose an image file.');
  if (file.size > IMG_MAX_INPUT) throw new Error('This file is too large (over 30 MB).');
  const src = await decodeImage(file);
  const W = src.width, H = src.height;
  let scale = Math.min(1, IMG_MAX_PX / Math.max(W, H)), blob = null, w = 0, h = 0;
  for (let round = 0; round < 4; round++) {
    w = Math.max(1, Math.round(W * scale)); h = Math.max(1, Math.round(H * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, w, h);
    for (const q of [0.8, 0.7, 0.6, 0.5]) {
      blob = await canvasBlob(c, q);
      if (blob && blob.size <= IMG_TARGET_BYTES) break;
    }
    if (blob && blob.size <= IMG_TARGET_BYTES) break;
    scale *= 0.8;   // still too big: make it smaller and try again
  }
  if (src.close) src.close();
  if (!blob) throw new Error('Could not process this image.');
  return { dataUrl: await blobToDataUrl(blob), bytes: blob.size, w, h, original: file.size };
}
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
async function onImagePicked() {
  const file = $('#ifImage').files[0];
  if (!file) { pendingImage = null; return; }
  $('#ifImgInfo').textContent = 'Optimising photo…';
  try {
    const r = await optimizeImage(file);
    pendingImage = { data: r.dataUrl.split(',')[1], mimeType: 'image/jpeg' };
    $('#ifPreview').innerHTML = '<img src="' + r.dataUrl + '" alt="">';
    $('#ifRemove').checked = false;
    $('#ifImgInfo').innerHTML = '<i class="bi bi-check-circle text-success me-1"></i>Optimised: ' + kb(r.original) + ' → <b>' + kb(r.bytes) + '</b> (' + r.w + '×' + r.h + ')';
  } catch (e) {
    pendingImage = null; $('#ifImage').value = ''; $('#ifImgInfo').textContent = ''; showErr('#ifError', e.message);
  }
}
async function submitItemForm(e) {
  e.preventDefault();
  showErr('#ifError', '');
  hideSuggest();
  if (!$('#ifName').value.trim()) return showErr('#ifError', 'Item name is required.');
  if ($('#ifTotal').value === '') return showErr('#ifError', 'Total quantity is required.');
  if ($('#ifRoom').value === ROOM_OTHER && !$('#ifRoomOther').value.trim()) return showErr('#ifError', 'Type the room / place, or choose a room from the list.');
  const data = {
    ItemID: $('#ifId').value, Name: $('#ifName').value, Category: $('#ifCategory').value, Condition: $('#ifCondition').value,
    TotalQty: Number($('#ifTotal').value), MinQty: $('#ifMin').value === '' ? 0 : Number($('#ifMin').value),
    Room: roomFieldValue(), Location: $('#ifLocation').value, PurchaseDate: $('#ifPurchase').value, Details: $('#ifDetails').value,
    DatasheetURL: $('#ifLink').value.trim(), RemoveImage: $('#ifRemove').checked,
  };
  const btn = $('#ifSave'); btn.disabled = true;
  try {
    const it = await api('saveItem', data, pendingImage);
    upsertItem(it); fillCategoryList(); fillRoomFilter(); renderInventory();
    modal('itemFormModal').hide();
    toast((data.ItemID ? 'Saved ' : 'Added ') + it.Name);
  } catch (err) { showErr('#ifError', err.message); }
  finally { btn.disabled = false; }
}
async function deleteCurrentItem() {
  const it = S.currentItem; if (!it) return;
  modal('itemModal').hide();
  if (!(await confirmBox('Delete ' + it.Name + '?', 'This removes the item and its photo. Loan history is kept. This cannot be undone.', 'Delete'))) return;
  try {
    await api('deleteItem', it.ItemID);
    S.items = S.items.filter((x) => x.ItemID !== it.ItemID);
    fillCategoryList(); fillRoomFilter(); renderInventory(); toast('Item deleted');
  } catch (e) { fail(e); }
}

// =====================================================================
//  MY ITEMS (requests & loans)
// =====================================================================
/** [label, bootstrap colour] for each loan status */
function loanLabel(l) {
  switch (l.Status) {
    case 'REQUESTED': return ['Waiting for approval', 'warning'];
    case 'OPEN': return isOverdue(l) ? ['Overdue', 'danger'] : ['With ' + (S.user && l.Username === S.user.Username ? 'me' : 'user'), 'primary'];
    case 'RETURN_PENDING': return ['Return being checked', 'info'];
    case 'RETURNED': return ['Returned' + (l.ReturnCondition ? ' · ' + l.ReturnCondition : ''), 'success'];
    case 'PARTIAL': return ['Partly returned (' + l.ReturnedQty + '/' + l.Qty + ')', 'warning'];
    case 'LOST': case 'CONSUMED': return ['Lost / used up', 'secondary'];
    case 'REJECTED': return ['Rejected', 'danger'];
    case 'CANCELLED': return ['Cancelled', 'light'];
    default: return [l.Status || '—', 'light'];
  }
}
function approverText(r) {
  const names = { ra: 'an RA', admin: 'the Admin', student: 'a student' };
  return ((CFG.approvalBy || {})[r || role()] || ['admin']).map((x) => names[x] || x).join(' or ');
}
function statusBadge(l) {
  const [t, c] = loanLabel(l);
  return '<span class="badge text-bg-' + c + (c === 'light' ? ' border' : '') + '">' + esc(t) + '</span>';
}
function renderMyLoans() {
  const direct = CAN.takeDirect();
  const who = esc(approverText());
  $('#myHowTo').innerHTML = direct
    ? '<i class="bi bi-info-circle me-1"></i>As ' + esc((CFG.roles || {})[role()] || role()) + ' you can take items directly. When you put an item back, use <b>Check return</b> to record its condition.'
    : '<i class="bi bi-info-circle me-1"></i><b>How it works:</b> open an item in Inventory → <b>Request to borrow</b> → ' + who + ' approves → collect it from the lab. ' +
      'When you give it back, press <b>I returned it</b>; ' + who + ' checks the item and closes the loan.';
  const open = S.myLoans.filter((l) => ACTIVE[l.Status]);
  const hist = S.myLoans.filter((l) => !ACTIVE[l.Status]);
  const action = (l) => {
    if (l.Status === 'REQUESTED') return '<button class="btn btn-outline-danger btn-sm mt-3" data-action="cancel-request" data-id="' + esc(l.LoanID) + '"><i class="bi bi-x-circle me-1"></i>Cancel request</button>';
    if (l.Status === 'OPEN' && l.CanAct) return '<button class="btn btn-outline-primary btn-sm mt-3" data-action="verify-return" data-id="' + esc(l.LoanID) + '"><i class="bi bi-clipboard-check me-1"></i>Check return</button>';
    if (l.Status === 'OPEN') return '<button class="btn btn-outline-primary btn-sm mt-3" data-action="return-loan" data-id="' + esc(l.LoanID) + '"><i class="bi bi-box-arrow-in-down-left me-1"></i>I returned it</button>';
    if (l.Status === 'RETURN_PENDING' && l.CanAct) return '<button class="btn btn-outline-primary btn-sm mt-3" data-action="verify-return" data-id="' + esc(l.LoanID) + '"><i class="bi bi-clipboard-check me-1"></i>Check return</button>';
    if (l.Status === 'RETURN_PENDING') return '<div class="small text-muted mt-3"><i class="bi bi-hourglass-split me-1"></i>' + esc(approverText().replace(/^./, (c) => c.toUpperCase())) + ' will check the item and close this loan.</div>';
    return '';
  };
  $('#myOpenLoans').innerHTML = open.length ? '<div class="row g-3">' + open.map((l) =>
    '<div class="col-md-6 col-lg-4"><div class="card soft-card h-100"><div class="card-body">' +
      '<div class="d-flex justify-content-between align-items-start mb-1 gap-2"><div class="small text-muted">' + esc(l.LoanID) + ' · ' + esc(l.ItemID) + '</div>' + statusBadge(l) + '</div>' +
      '<h6 class="fw-bold mb-1">' + l.Qty + ' × ' + esc(l.ItemName) + '</h6>' +
      '<div class="small text-muted mb-2">' + esc(l.Purpose) + '</div>' +
      (l.Status === 'REQUESTED' ? '<div class="small">Requested: ' + fmtDateTime(l.RequestedAt) + '</div>'
        : '<div class="small">Taken: ' + fmtDateTime(l.BorrowedAt) + (l.ApprovedBy && l.ApprovedBy !== l.Username ? ' <span class="text-muted">(approved by ' + esc(l.ApprovedBy) + ')</span>' : '') + '</div>') +
      '<div class="small' + (isOverdue(l) ? ' text-danger fw-semibold' : '') + '">Return by: ' + fmtDate(l.ExpectedReturn) + '</div>' +
      (l.Note ? '<div class="small text-muted fst-italic mt-1"><i class="bi bi-chat-left-text me-1"></i>' + esc(l.Note) + '</div>' : '') +
      action(l) +
    '</div></div></div>').join('') + '</div>'
    : '<div class="card soft-card"><div class="empty"><i class="bi bi-bag"></i>No requests or items right now.' +
      (CAN.request() ? '<div class="small mt-1">Open an item in <a href="#" data-action="nav" data-view="inventory">Inventory</a> to ' + (CAN.takeDirect() ? 'take it out' : 'request it') + '.</div>' : '') + '</div></div>';
  $('#myLoanHistory').innerHTML = hist.length ? '<div class="card table-card"><div class="table-responsive"><table class="table table-hover small">' +
    '<thead class="table-light"><tr><th>Item</th><th>Qty</th><th class="d-none d-sm-table-cell">Purpose</th><th class="d-none d-md-table-cell">Date</th><th class="d-none d-md-table-cell">Closed</th><th class="d-none d-sm-table-cell">Status</th></tr></thead><tbody>' +
    hist.map((l) => '<tr><td>' + esc(l.ItemName) + '<div class="text-muted">' + esc(l.ItemID) + '</div>' +
      '<div class="d-sm-none mt-1">' + statusBadge(l) + ' <span class="text-muted">' + fmtDate(l.ClosedAt || l.BorrowedAt || l.RequestedAt) + '</span>' +
      (l.Note ? '<div class="text-muted fst-italic">' + esc(l.Note) + '</div>' : '') + '</div></td><td>' + l.Qty + '</td>' +
      '<td class="d-none d-sm-table-cell">' + esc(l.Purpose) + (l.Note ? '<div class="text-muted fst-italic">' + esc(l.Note) + '</div>' : '') + '</td>' +
      '<td class="d-none d-md-table-cell">' + fmtDate(l.BorrowedAt || l.RequestedAt) + '</td><td class="d-none d-md-table-cell">' + fmtDate(l.ClosedAt) + '</td>' +
      '<td class="d-none d-sm-table-cell">' + statusBadge(l) + '</td></tr>').join('') +
    '</tbody></table></div></div>' : '<div class="text-muted small">No history yet.</div>';
}
function replaceLoan(loan) {
  [S.myLoans, S.allLoans].forEach((arr) => { const i = arr.findIndex((x) => x.LoanID === loan.LoanID); if (i >= 0) arr[i] = loan; });
}
async function cancelRequest(id) {
  const l = S.myLoans.find((x) => x.LoanID === id); if (!l) return;
  if (!(await confirmBox('Cancel this request?', l.Qty + ' × ' + l.ItemName, 'Cancel request'))) return;
  try { const r = await api('cancelRequest', id); replaceLoan(r.loan); renderMyLoans(); toast('Request cancelled'); } catch (e) { fail(e); }
}
async function reportReturn(id) {
  const l = S.myLoans.find((x) => x.LoanID === id); if (!l) return;
  if (!(await confirmBox('Return ' + l.Qty + ' × ' + l.ItemName + '?', 'Give the item to ' + approverText() + ' in the lab. They will check it and close the loan.', 'Yes, I returned it'))) return;
  try { const r = await api('markReturned', id); replaceLoan(r.loan); renderMyLoans(); toast('Thanks! ' + approverText().replace(/^./, (c) => c.toUpperCase()) + ' will check the item.'); } catch (e) { fail(e); }
}
async function refreshMyLoans(silent) {
  try {
    S.myLoans = silent ? await call('listLoans', [S.token, 'mine']) : await api('listLoans', 'mine');
    if (S.view === 'loans') renderMyLoans();
  } catch (e) { if (!silent) fail(e); }
}

// =====================================================================
//  LOANS & REQUESTS — everyone can see who asked for / has what; only allowed people act
// =====================================================================
const REQ_FILTERS = [
  ['requests', 'Waiting approval', (l) => l.Status === 'REQUESTED'],
  ['returns', 'Being returned', (l) => l.Status === 'RETURN_PENDING'],
  ['out', 'Out on loan', (l) => l.Status === 'OPEN' || l.Status === 'RETURN_PENDING'],
  ['overdue', 'Overdue', isOverdue],
  ['closed', 'History', (l) => !ACTIVE[l.Status]],
  ['all', 'All', () => true],
];
async function loadRequests() {
  renderRequests();
  try {
    S.allLoans = await api('listLoans', 'all');
    if (CAN.approve()) {
      S.pending = { requests: S.allLoans.filter((l) => l.CanAct && l.Status === 'REQUESTED').length, returns: S.allLoans.filter((l) => l.CanAct && l.Status === 'RETURN_PENDING').length };
      renderBadge();
    }
    renderRequests();
  } catch (e) { fail(e); }
}
function renderRequests() {
  $('#reqSub').textContent = CAN.approve()
    ? 'Approve requests and check returned items' + (role() === 'ra' ? ' (students’ requests; RA requests are approved by the Admin)' : '') + '. Everyone can see this list.'
    : 'Who has asked for or borrowed what. Open an item in Inventory to request it.';
  const counts = {};
  // badge counts: for RA/Admin only what they can act on
  REQ_FILTERS.forEach(([k, , f]) => { counts[k] = S.allLoans.filter((l) => f(l) && (k === 'overdue' || !CAN.approve() || l.CanAct)).length; });
  $('#reqFilters').innerHTML = REQ_FILTERS.map(([k, label]) =>
    '<button type="button" class="btn btn-sm ' + (S.reqFilter === k ? 'btn-primary' : 'btn-outline-secondary') + '" data-action="req-filter" data-id="' + k + '">' + label +
    ((CAN.approve() ? ['requests', 'returns', 'overdue'] : ['overdue']).indexOf(k) >= 0 && counts[k] ? '<span class="badge rounded-pill text-bg-' + (k === 'overdue' ? 'danger' : 'warning') + '">' + counts[k] + '</span>' : '') + '</button>').join('');
  const filt = (REQ_FILTERS.find(([k]) => k === S.reqFilter) || REQ_FILTERS[0])[2];
  const q = $('#reqSearch').value.trim().toLowerCase();
  const list = S.allLoans.filter((l) => filt(l) && (!q || [l.LoanID, l.ItemID, l.ItemName, l.Username, l.FullName, l.Purpose, l.Note].join(' ').toLowerCase().indexOf(q) >= 0));
  if (!list.length) {
    const msg = { requests: 'No requests waiting for approval.', returns: 'No returns waiting to be checked.', out: 'Nothing is out on loan.', overdue: 'Nothing is overdue.' }[S.reqFilter] || 'Nothing to show.';
    $('#reqList').innerHTML = '<div class="card soft-card"><div class="empty"><i class="bi bi-check2-all"></i>' + msg + '</div></div>';
    return;
  }
  $('#reqList').innerHTML = '<div class="row g-3">' + list.map((l) => {
    const it = S.items.find((x) => x.ItemID === l.ItemID);
    let buttons = '';
    if (!l.CanAct) {
      if (CAN.approve() && (l.Status === 'REQUESTED' || l.Status === 'RETURN_PENDING')) buttons = '<span class="small text-muted"><i class="bi bi-shield-lock me-1"></i>' + esc(approverText(l.Role).replace(/^./, (c) => c.toUpperCase())) + ' handles this</span>';
    } else if (l.Status === 'REQUESTED') {
      buttons = '<button class="btn btn-success btn-sm" data-action="approve-req" data-id="' + esc(l.LoanID) + '"><i class="bi bi-check-lg me-1"></i>Approve</button>' +
                '<button class="btn btn-outline-danger btn-sm" data-action="reject-req" data-id="' + esc(l.LoanID) + '"><i class="bi bi-x-lg me-1"></i>Reject</button>';
    } else if (l.Status === 'OPEN' || l.Status === 'RETURN_PENDING') {
      buttons = '<button class="btn btn-' + (l.Status === 'RETURN_PENDING' ? '' : 'outline-') + 'primary btn-sm" data-action="verify-return" data-id="' + esc(l.LoanID) + '"><i class="bi bi-clipboard-check me-1"></i>Check return</button>';
    }
    return '<div class="col-md-6 col-xl-4"><div class="card req-card h-100"><div class="card-body d-flex flex-column">' +
      '<div class="d-flex justify-content-between align-items-start gap-2 mb-1"><div class="small text-muted">' + esc(l.LoanID) + '</div>' + statusBadge(l) + '</div>' +
      '<h6 class="fw-bold mb-1"><a href="#" class="text-reset text-decoration-none" data-action="open-item" data-id="' + esc(l.ItemID) + '">' + l.Qty + ' × ' + esc(l.ItemName) + '</a></h6>' +
      '<div class="who mb-1"><i class="bi bi-person me-1"></i>' + esc(l.FullName) + ' <span class="text-muted">@' + esc(l.Username) + '</span>' + (l.Role === 'ra' || l.Role === 'admin' ? ' ' + roleBadge(l.Role) : '') + '</div>' +
      '<div class="small text-muted mb-2">' + esc(l.Purpose) + '</div>' +
      '<div class="small">' + (l.Status === 'REQUESTED' ? 'Requested ' + fmtDateTime(l.RequestedAt) : (l.BorrowedAt ? 'Taken ' + fmtDateTime(l.BorrowedAt) : '')) + '</div>' +
      (l.ExpectedReturn ? '<div class="small' + (isOverdue(l) ? ' text-danger fw-semibold' : '') + '">Return by ' + fmtDate(l.ExpectedReturn) + '</div>' : '') +
      (l.Status === 'REQUESTED' && it ? '<div class="small ' + (it.AvailableQty >= l.Qty ? 'text-success' : 'text-danger') + '">' + it.AvailableQty + ' available now' + (it.Room ? ' · ' + esc(it.Room) : '') + '</div>' : '') +
      (l.ClosedAt ? '<div class="small text-muted">Closed ' + fmtDate(l.ClosedAt) + ' by ' + esc(l.ClosedBy) + '</div>' : '') +
      (l.Note ? '<div class="small text-muted fst-italic mt-1"><i class="bi bi-chat-left-text me-1"></i>' + esc(l.Note) + '</div>' : '') +
      (buttons ? '<div class="d-flex gap-2 mt-auto pt-3 align-items-center">' + buttons + '</div>' : '') +
    '</div></div></div>';
  }).join('') + '</div>';
}
function findAnyLoan(id) { return S.allLoans.find((x) => x.LoanID === id) || S.myLoans.find((x) => x.LoanID === id); }
function openDecide(id, approve) {
  const l = findAnyLoan(id); if (!l) return;
  const it = S.items.find((x) => x.ItemID === l.ItemID);
  $('#decideForm').reset(); showErr('#dcError', '');
  $('#dcId').value = id; $('#dcMode').value = approve ? 'approve' : 'reject';
  $('#dcTitle').textContent = approve ? 'Approve request' : 'Reject request';
  $('#dcInfo').innerHTML = '<b>' + esc(l.FullName) + '</b> <span class="text-muted">@' + esc(l.Username) + '</span> asks for <b>' + l.Qty + ' × ' + esc(l.ItemName) + '</b>' +
    '<div class="small text-muted">' + esc(l.Purpose) + (l.ExpectedReturn ? ' · return by ' + fmtDate(l.ExpectedReturn) : '') + '</div>';
  $('#dcQtyWrap').classList.toggle('d-none', !approve);
  const avail = it ? it.AvailableQty : 0;
  $('#dcQty').value = Math.min(l.Qty, Math.max(avail, 1)); $('#dcQty').max = l.Qty;
  $('#dcQtyHelp').textContent = it ? avail + ' available now' + (it.Room ? ' in ' + it.Room : '') + (it.Location ? ' (' + it.Location + ')' : '') + '. You can give fewer than requested.' : 'This item no longer exists.';
  $('#dcNoteLabel').textContent = approve ? 'Message (optional), e.g. where to collect it' : 'Reason (optional)';
  $('#dcNote').placeholder = approve ? 'e.g. Collect from Room 3 after 2 pm' : 'e.g. Reserved for a course lab this week';
  const btn = $('#dcSubmit');
  btn.className = 'btn ' + (approve ? 'btn-success' : 'btn-danger');
  btn.textContent = approve ? 'Approve' : 'Reject';
  modal('decideModal').show();
}
async function submitDecide(e) {
  e.preventDefault(); showErr('#dcError', '');
  const id = $('#dcId').value, approve = $('#dcMode').value === 'approve';
  const btn = $('#dcSubmit'); btn.disabled = true;
  try {
    const r = await api('decideRequest', id, approve, approve ? Number($('#dcQty').value) : '', $('#dcNote').value);
    replaceLoan(r.loan); if (r.item) upsertItem(r.item);
    if (S.pending) { S.pending.requests = Math.max(0, S.pending.requests - 1); renderBadge(); }
    modal('decideModal').hide(); renderRequests(); renderMyLoans();
    toast(approve ? 'Approved: ' + r.loan.Qty + ' × ' + r.loan.ItemName + ' for ' + r.loan.FullName : 'Request rejected');
  } catch (err) { showErr('#dcError', err.message); }
  finally { btn.disabled = false; }
}
function openVerify(id) {
  const l = findAnyLoan(id); if (!l) return;
  const it = S.items.find((x) => x.ItemID === l.ItemID);
  $('#verifyForm').reset(); showErr('#vfError', '');
  $('#vfId').value = id; $('#vfKind').value = 'loan';
  $('#vfTitle').textContent = 'Check returned item';
  $('#vfInfo').innerHTML = '<b>' + esc(l.FullName) + '</b> <span class="text-muted">@' + esc(l.Username) + '</span> has <b>' + l.Qty + ' × ' + esc(l.ItemName) + '</b>' +
    '<div class="small text-muted">' + esc(l.Purpose) + ' · taken ' + fmtDate(l.BorrowedAt) + (l.Status === 'RETURN_PENDING' ? ' · <span class="text-info-emphasis">marked returned ' + fmtDateTime(l.ReturnReportedAt) + '</span>' : '') + '</div>';
  const before = it && it.Condition ? it.Condition : '';
  $('#vfCond').innerHTML = CFG.conditions.map((c) => '<option>' + esc(c) + '</option>').join('') + '<option value="Lost">Lost / not returned</option>';
  $('#vfCond').value = CFG.conditions.indexOf(before) >= 0 ? before : 'Good';
  $('#vfCond').dataset.before = before;
  $('#vfQty').value = l.Qty; $('#vfQty').max = l.Qty; $('#vfQty').dataset.qty = l.Qty;
  $('#vfSetCond').checked = true;
  verifyHelp();
  modal('verifyModal').show();
}
function openEndAlloc(id) {
  const a = S.allocs.find((x) => x.AllocID === id); if (!a) return;
  const it = S.items.find((x) => x.ItemID === a.ItemID);
  $('#verifyForm').reset(); showErr('#vfError', '');
  $('#vfId').value = id; $('#vfKind').value = 'alloc';
  $('#vfTitle').textContent = 'End allocation';
  $('#vfInfo').innerHTML = '<b>' + esc(a.FullName) + '</b> <span class="text-muted">@' + esc(a.Username) + '</span> has <b>' + a.Qty + ' × ' + esc(a.ItemName) + '</b>' +
    '<div class="small text-muted">allocated ' + fmtDate(a.AllocatedAt) + (a.Note ? ' · ' + esc(a.Note) : '') + '</div>';
  const before = it && it.Condition ? it.Condition : '';
  $('#vfCond').innerHTML = CFG.conditions.map((c) => '<option>' + esc(c) + '</option>').join('') + '<option value="Lost">Lost / not returned</option>';
  $('#vfCond').value = CFG.conditions.indexOf(before) >= 0 ? before : 'Good';
  $('#vfCond').dataset.before = before;
  $('#vfQty').value = a.Qty; $('#vfQty').max = a.Qty; $('#vfQty').dataset.qty = a.Qty;
  $('#vfSetCond').checked = true;
  verifyHelp();
  modal('verifyModal').show();
}
function verifyHelp() {
  const lost = $('#vfCond').value === 'Lost', qty = Number($('#vfQty').dataset.qty || 0);
  if (lost) $('#vfQty').value = 0;
  $('#vfQty').disabled = lost;
  const ret = Math.min(qty, Math.max(0, Number($('#vfQty').value) || 0)), missing = qty - ret;
  $('#vfHelp').innerHTML = missing
    ? '<span class="text-danger"><i class="bi bi-exclamation-triangle me-1"></i>' + missing + ' not returned → counted as <b>lost / used up</b> and removed from the item total.</span>'
    : 'All ' + qty + ' back in the lab.';
  const before = $('#vfCond').dataset.before, cond = $('#vfCond').value;
  $('#vfSetWrap').classList.toggle('d-none', lost || ret === 0 || cond === before);
  $('#vfSetLabel').textContent = 'Change the item\'s condition' + (before ? ' from “' + before + '”' : '') + ' to “' + cond + '”';
}
async function submitVerify(e) {
  e.preventDefault(); showErr('#vfError', '');
  const id = $('#vfId').value, cond = $('#vfCond').value;
  const setCond = !$('#vfSetWrap').classList.contains('d-none') && $('#vfSetCond').checked;
  const btn = $('#vfSubmit'); btn.disabled = true;
  if ($('#vfKind').value === 'alloc') {
    try {
      const r = await api('endAllocation', id, cond === 'Lost' ? 0 : Number($('#vfQty').value), cond, setCond, $('#vfNote').value);
      const i = S.allocs.findIndex((x) => x.AllocID === id); if (i >= 0) S.allocs[i] = r.allocation;
      upsertItem(r.item); modal('verifyModal').hide(); renderAllocations(); toast('Allocation ended');
    } catch (err) { showErr('#vfError', err.message); }
    finally { btn.disabled = false; }
    return;
  }
  try {
    const r = await api('verifyReturn', id, cond === 'Lost' ? 0 : Number($('#vfQty').value), cond, setCond, $('#vfNote').value);
    const wasPending = (findAnyLoan(id) || {}).Status === 'RETURN_PENDING';
    replaceLoan(r.loan); upsertItem(r.item);
    if (S.pending && wasPending) { S.pending.returns = Math.max(0, S.pending.returns - 1); renderBadge(); }
    modal('verifyModal').hide();
    if (S.view === 'requests') renderRequests(); if (S.view === 'loans') renderMyLoans(); if (S.view === 'inventory') renderInventory();
    toast('Loan closed: ' + loanLabel(r.loan)[0]);
  } catch (err) { showErr('#vfError', err.message); }
  finally { btn.disabled = false; }
}

// =====================================================================
//  ADMIN
// =====================================================================
function setAdminTab(tab) {
  S.adminTab = tab;
  $$('#adminTabs .nav-link').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  $$('.admin-tab').forEach((el) => el.classList.toggle('d-none', el.id !== 'tab-' + tab));
  if (tab === 'overview') loadOverview();
  if (tab === 'users') api('listUsers').then((u) => { S.users = u; renderUsers(); }).catch(fail);
  if (tab === 'log') api('getLog', 300).then((l) => { S.log = l; renderLog(); }).catch(fail);
  if (tab === 'allocations') loadAllocations();
}
async function loadAllocations() {
  try { S.allocs = await api('listAllocations', ''); renderAllocations(); } catch (e) { fail(e); }
}
function renderAllocations() {
  const f = $('#aAllocFilter').value, q = $('#aAllocSearch').value.trim().toLowerCase();
  const list = S.allocs.filter((a) => (f === 'all' || (f === 'active' ? a.Status === 'ACTIVE' : a.Status !== 'ACTIVE')) &&
    (!q || [a.AllocID, a.ItemID, a.ItemName, a.Username, a.FullName, a.Note].join(' ').toLowerCase().indexOf(q) >= 0));
  $('#aAllocs').innerHTML = list.length ? '<div class="row g-3">' + list.map((a) =>
    '<div class="col-md-6 col-xl-4"><div class="card req-card h-100"><div class="card-body d-flex flex-column">' +
      '<div class="d-flex justify-content-between align-items-start gap-2 mb-1"><div class="small text-muted">' + esc(a.AllocID) + ' · ' + esc(a.ItemID) + '</div>' +
        (a.Status === 'ACTIVE' ? '<span class="badge text-bg-primary">In use</span>' : '<span class="badge text-bg-secondary">Ended' + (a.ReturnCondition ? ' · ' + esc(a.ReturnCondition) : '') + '</span>') + '</div>' +
      '<h6 class="fw-bold mb-1"><a href="#" class="text-reset text-decoration-none" data-action="open-item" data-id="' + esc(a.ItemID) + '">' + a.Qty + ' × ' + esc(a.ItemName) + '</a></h6>' +
      '<div class="who mb-1"><i class="bi bi-person me-1"></i>' + esc(a.FullName) + ' <span class="text-muted">@' + esc(a.Username) + '</span></div>' +
      (a.Note ? '<div class="small text-muted mb-1">' + esc(a.Note) + '</div>' : '') +
      '<div class="small">Since ' + fmtDate(a.AllocatedAt) + ' <span class="text-muted">by ' + esc(a.AllocatedBy) + '</span></div>' +
      (a.EndedAt ? '<div class="small text-muted">Ended ' + fmtDate(a.EndedAt) + ' by ' + esc(a.EndedBy) + (a.EndNote ? ' — ' + esc(a.EndNote) : '') + '</div>' : '') +
      (a.Status === 'ACTIVE' ? '<div class="mt-auto pt-3"><button class="btn btn-outline-primary btn-sm" data-action="end-alloc" data-id="' + esc(a.AllocID) + '"><i class="bi bi-box-arrow-in-down-left me-1"></i>End allocation</button></div>' : '') +
    '</div></div></div>').join('') + '</div>'
    : '<div class="card soft-card"><div class="empty"><i class="bi bi-person-workspace"></i>' + (S.allocs.length ? 'Nothing matches.' : 'No allocations yet. Click <b>Allocate</b>, or open an item → <b>Allocate</b>.') + '</div></div>';
}
async function openAllocate(itemId) {
  $('#allocForm').reset(); showErr('#alError', '');
  if (!S.users.length) { try { S.users = await api('listUsers'); } catch (e) { return fail(e); } }
  const items = S.items.filter((i) => i.AvailableQty > 0 || i.ItemID === itemId).sort((a, b) => String(a.Name).localeCompare(String(b.Name)));
  $('#alItem').innerHTML = '<option value="">Choose an item…</option>' + items.map((i) =>
    '<option value="' + esc(i.ItemID) + '">' + esc(i.Name) + ' (' + esc(i.ItemID) + ') — ' + i.AvailableQty + ' available</option>').join('');
  $('#alItem').value = itemId || '';
  const users = S.users.filter((u) => u.Active).sort((a, b) => ROLE_ORDER[a.Role] - ROLE_ORDER[b.Role] || a.FullName.localeCompare(b.FullName));
  $('#alUser').innerHTML = '<option value="">Choose a person…</option>' + users.map((u) =>
    '<option value="' + esc(u.Username) + '">' + esc(u.FullName) + ' (@' + esc(u.Username) + ') — ' + esc((CFG.roles || {})[u.Role] || u.Role) + '</option>').join('');
  allocHelp();
  modal('allocModal').show();
}
function allocHelp() {
  const it = S.items.find((x) => x.ItemID === $('#alItem').value);
  $('#alQty').max = it ? it.AvailableQty : 1;
  $('#alHelp').textContent = it ? it.AvailableQty + ' of ' + it.TotalQty + ' available' + (it.Room ? ' · ' + it.Room : '') + '. Allocated units are taken out of the available stock until the allocation ends.' : '';
}
async function submitAllocate(e) {
  e.preventDefault(); showErr('#alError', '');
  if (!$('#alItem').value || !$('#alUser').value) return showErr('#alError', 'Choose the item and the person.');
  const btn = $('#alSubmit'); btn.disabled = true;
  try {
    const r = await api('allocateItem', $('#alItem').value, $('#alUser').value, Number($('#alQty').value), $('#alNote').value);
    upsertItem(r.item); S.allocs.unshift(r.allocation);
    modal('allocModal').hide();
    if (S.view === 'admin' && S.adminTab === 'allocations') renderAllocations(); else if (S.view === 'inventory') renderInventory();
    toast('Allocated ' + r.allocation.Qty + ' × ' + r.allocation.ItemName + ' to ' + r.allocation.FullName);
  } catch (err) { showErr('#alError', err.message); }
  finally { btn.disabled = false; }
}
async function loadOverview() {
  try {
    const [ov, loans] = await Promise.all([api('getAdminOverview'), api('listLoans', 'all')]);
    S.overview = ov; S.allLoans = loans;
    const open = loans.filter((l) => l.Status === 'OPEN' || l.Status === 'RETURN_PENDING'), overdue = open.filter(isOverdue);
    const waiting = loans.filter((l) => l.Status === 'REQUESTED').length + loans.filter((l) => l.Status === 'RETURN_PENDING').length;
    const units = S.items.reduce((a, i) => a + i.TotalQty, 0);
    const low = S.items.filter((i) => isLow(i) || i.AvailableQty <= 0);
    const stat = (icon, color, v, l, view) => '<div class="col-6 col-md-4 col-xl"><div class="card stat h-100"' + (view ? ' role="button" data-action="nav" data-view="' + view + '"' : '') + '><div class="card-body"><i class="bi ' + icon + ' text-' + color + '"></i><div class="v mt-1">' + v + '</div><div class="l">' + l + '</div></div></div></div>';
    $('#tab-overview').innerHTML =
      '<div class="row g-3 mb-4">' +
        stat('bi-box-seam', 'primary', S.items.length, 'Item types') + stat('bi-stack', 'info', units, 'Total units') +
        stat('bi-inbox', 'warning', waiting, 'Waiting', 'requests') + stat('bi-clipboard-check', 'success', open.length, 'Out on loan', 'requests') +
        stat('bi-alarm', 'danger', overdue.length, 'Overdue', 'requests') + stat('bi-person-workspace', 'primary', ov.allocatedUnits || 0, 'Allocated units') + stat('bi-people', 'secondary', ov.activeUsers, 'Active users') +
      '</div>' +
      '<div class="row g-3">' +
        '<div class="col-lg-7"><div class="card soft-card h-100"><div class="card-body"><h6 class="fw-bold mb-3"><i class="bi bi-exclamation-triangle text-warning me-2"></i>Low / out of stock</h6>' +
          (low.length ? '<ul class="list-group list-group-flush">' + low.map((i) => '<li class="list-group-item px-0 d-flex justify-content-between align-items-center" role="button" data-action="open-item" data-id="' + esc(i.ItemID) + '"><span>' + esc(i.Name) + ' <span class="text-muted small">' + esc(i.ItemID) + '</span></span>' + stockBadge(i) + '</li>').join('') + '</ul>'
            : '<p class="text-muted small mb-0">All items are above their low-stock level.</p>') +
        '</div></div></div>' +
        '<div class="col-lg-5"><div class="card soft-card h-100"><div class="card-body"><h6 class="fw-bold mb-3"><i class="bi bi-database me-2 text-brand"></i>Data & backup</h6>' +
          '<div class="d-grid gap-2 mb-3">' +
            '<a class="btn btn-outline-primary text-start" href="' + esc(safeUrl(ov.sheetUrl)) + '" target="_blank" rel="noopener"><i class="bi bi-table me-2"></i>Open database (Google Sheet)</a>' +
            '<a class="btn btn-outline-primary text-start" href="' + esc(safeUrl(ov.folderUrl)) + '" target="_blank" rel="noopener"><i class="bi bi-folder2-open me-2"></i>Open Drive folder (images & backups)</a>' +
          '</div>' +
          '<div class="small">Weekly backup: ' + (ov.backupEnabled ? '<span class="text-success fw-semibold">On</span> (every Friday)' : '<span class="text-danger fw-semibold">Off</span> — run setup() again') + '</div>' +
          '<div class="small text-muted">Last backup: ' + (ov.lastBackup ? fmtDateTime(ov.lastBackup) : 'not yet') + '</div>' +
          '<div class="small text-muted mt-2">To export: open the Sheet → File → Download → Excel/CSV.</div>' +
        '</div></div></div>' +
      '</div>';
  } catch (e) { fail(e); }
}

// ---------- users ----------
const ROLE_ORDER = { admin: 0, ra: 1, student: 2 };
function roleBadge(r) {
  if (r === 'admin') return '<span class="badge text-bg-dark">Admin</span>';
  if (r === 'ra') return '<span class="badge text-bg-info">RA</span>';
  return '<span class="badge text-bg-light border">Student</span>';
}
function roleHelp() {
  const r = $('#ufRole').value, has = (list) => (list || []).indexOf(r) >= 0;
  const can = ['search and view the inventory'];
  if (r === 'admin' || r === 'ra') can.push('add' + (r === 'admin' || CFG.raCanEditItems ? ' and edit' : '') + ' items');
  if (has(CFG.requestRoles)) can.push(has(CFG.autoApproveRoles) ? 'take items out directly' : 'request to borrow items (approved by ' + approverText(r) + ')');
  const approves = Object.keys(CFG.approvalBy || {}).filter((k) => k !== r && (CFG.approvalBy[k] || []).indexOf(r) >= 0).map((k) => k === 'ra' ? 'RAs’' : k + 's’');
  if (approves.length) can.push('approve ' + approves.join(' and ') + ' requests and check their returns');
  if (r === 'admin') can.push('allocate items (e.g. laptops), delete items, manage users and see the activity log');
  const last = can.pop();
  $('#ufRoleHelp').textContent = ((CFG.roles || {})[r] || r) + ': can ' + (can.length ? can.join(', ') + ' and ' : '') + last + '.';
}
function renderUsers() {
  const q = $('#aUserSearch').value.trim().toLowerCase();
  const list = S.users.filter((u) => !q || [u.Username, u.FullName, u.Contact].join(' ').toLowerCase().indexOf(q) >= 0)
    .sort((a, b) => ROLE_ORDER[a.Role] - ROLE_ORDER[b.Role] || a.Username.localeCompare(b.Username));
  $('#aUsers').innerHTML = '<div class="card table-card"><div class="table-responsive"><table class="table table-hover small">' +
    '<thead class="table-light"><tr><th>User</th><th>Contact</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>' +
    list.map((u) => '<tr' + (u.Active ? '' : ' class="text-muted"') + '><td><b>' + esc(u.FullName) + '</b><div class="text-muted">@' + esc(u.Username) + '</div></td>' +
      '<td>' + esc(u.Contact) + '</td><td>' + roleBadge(u.Role) + '</td>' +
      '<td>' + (u.Active ? '<span class="badge text-bg-success">Active</span>' : '<span class="badge text-bg-secondary">Disabled</span>') + '</td>' +
      '<td class="text-nowrap">' + fmtDateTime(u.LastLogin) + '</td>' +
      '<td class="text-end"><div class="dropdown"><button class="btn btn-sm btn-light border" data-bs-toggle="dropdown"><i class="bi bi-three-dots"></i></button><ul class="dropdown-menu dropdown-menu-end">' +
        '<li><a class="dropdown-item" href="#" data-action="edit-user" data-id="' + esc(u.Username) + '"><i class="bi bi-pencil me-2"></i>Edit</a></li>' +
        '<li><a class="dropdown-item" href="#" data-action="reset-user-pass" data-id="' + esc(u.Username) + '"><i class="bi bi-key me-2"></i>Reset password</a></li>' +
        '<li><a class="dropdown-item" href="#" data-action="toggle-user" data-id="' + esc(u.Username) + '"><i class="bi ' + (u.Active ? 'bi-person-dash' : 'bi-person-check') + ' me-2"></i>' + (u.Active ? 'Disable' : 'Enable') + '</a></li>' +
        (u.Username !== S.user.Username ? '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="#" data-action="delete-user" data-id="' + esc(u.Username) + '"><i class="bi bi-trash me-2"></i>Delete</a></li>' : '') +
      '</ul></div></td></tr>').join('') +
    '</tbody></table></div></div>' +
    '<p class="small text-muted mt-2">Tip: disable accounts of students who have left instead of deleting them — their loan history stays linked.</p>';
}
function openUserForm(username) {
  const u = username ? S.users.find((x) => x.Username === username) : null;
  $('#userForm').reset(); showErr('#ufError', '');
  $('#ufMode').value = u ? 'edit' : 'add';
  $('#ufTitle').textContent = u ? 'Edit @' + u.Username : 'Add user';
  $('#ufUsername').value = u ? u.Username : ''; $('#ufUsername').disabled = !!u;
  $('#ufFullName').value = u ? u.FullName : '';
  $('#ufContact').value = u ? u.Contact : '';
  $('#ufRole').value = u ? u.Role : 'student';
  roleHelp();
  $('#ufActive').checked = u ? u.Active : true;
  $('#ufActiveWrap').classList.toggle('d-none', !u);
  $('#ufPassWrap').classList.toggle('d-none', !!u);
  $('#ufPassword').value = u ? '' : genPassword();
  modal('userModal').show();
}
async function submitUserForm(e) {
  e.preventDefault(); showErr('#ufError', '');
  const data = { Username: $('#ufUsername').value.trim().toLowerCase(), FullName: $('#ufFullName').value, Contact: $('#ufContact').value, Role: $('#ufRole').value };
  try {
    if ($('#ufMode').value === 'add') {
      const pw = $('#ufPassword').value;
      const u = await api('createUser', data, pw);
      S.users.push(u); renderUsers(); modal('userModal').hide();
      setTimeout(() => showCreds(u.Username, pw), 350);
    } else {
      data.Active = $('#ufActive').checked;
      const u = await api('updateUser', data);
      S.users[S.users.findIndex((x) => x.Username === u.Username)] = u; renderUsers(); modal('userModal').hide(); toast('User updated');
    }
  } catch (err) { showErr('#ufError', err.message); }
}
async function toggleUser(username) {
  const u = S.users.find((x) => x.Username === username); if (!u) return;
  if (u.Active && !(await confirmBox('Disable @' + u.Username + '?', 'They will be signed out and cannot log in until re-enabled.', 'Disable'))) return;
  try {
    const r = await api('updateUser', Object.assign({}, u, { Active: !u.Active }));
    S.users[S.users.indexOf(u)] = r; renderUsers(); toast(r.Active ? 'User enabled' : 'User disabled');
  } catch (e) { fail(e); }
}
async function deleteUserAction(username) {
  if (!(await confirmBox('Delete @' + username + '?', 'The account is removed permanently. Consider disabling instead.', 'Delete'))) return;
  try { await api('deleteUser', username); S.users = S.users.filter((x) => x.Username !== username); renderUsers(); toast('User deleted'); }
  catch (e) { fail(e); }
}

// ---------- passwords ----------
function openPwModal(mode, username) {
  $('#pwForm').reset(); showErr('#pwError', '');
  $('#pwMode').value = mode; $('#pwUser').value = username || '';
  const reset = mode === 'reset';
  $('#pwTitle').textContent = reset ? 'Reset password for @' + username : 'Change your password';
  $('#pwCurrentWrap').classList.toggle('d-none', reset);
  $('#pwConfirmWrap').classList.toggle('d-none', reset);
  $('#pwGen').classList.toggle('d-none', !reset);
  $('#pwNew').type = reset ? 'text' : 'password';
  if (reset) $('#pwNew').value = genPassword();
  modal('pwModal').show();
}
async function submitPw(e) {
  e.preventDefault(); showErr('#pwError', '');
  const mode = $('#pwMode').value, pw = $('#pwNew').value;
  if (pw.length < 8) return showErr('#pwError', 'Password must be at least 8 characters.');
  try {
    if (mode === 'reset') {
      const u = $('#pwUser').value;
      await api('resetUserPassword', u, pw);
      modal('pwModal').hide(); setTimeout(() => showCreds(u, pw), 350);
    } else {
      if (pw !== $('#pwConfirm').value) return showErr('#pwError', 'New passwords do not match.');
      const r = await api('changePassword', $('#pwCurrent').value, pw);
      S.token = r.token; store.set('riot_token', r.token);
      modal('pwModal').hide(); toast('Password changed. Other devices were signed out.');
    }
  } catch (err) { showErr('#pwError', err.message); }
}

// ---------- activity log ----------
function renderLog() {
  const q = $('#aLogSearch').value.trim().toLowerCase();
  const list = S.log.filter((l) => !q || [l.Username, l.Action, l.ItemID, l.Details].join(' ').toLowerCase().indexOf(q) >= 0);
  $('#aLog').innerHTML = list.length ? '<div class="card table-card"><div class="table-responsive"><table class="table table-sm table-hover small">' +
    '<thead class="table-light"><tr><th>When</th><th>User</th><th>Action</th><th>Item</th><th>Details</th></tr></thead><tbody>' +
    list.map((l) => '<tr><td class="text-nowrap">' + fmtDateTime(l.Timestamp) + '</td><td>' + esc(l.Username) + '</td><td><code>' + esc(l.Action) + '</code></td><td>' + esc(l.ItemID) + '</td><td>' + esc(l.Details) + '</td></tr>').join('') +
    '</tbody></table></div></div><p class="small text-muted mt-2">Showing the latest 300 entries. The full log is in the "Log" tab of the Google Sheet.</p>'
    : '<div class="card soft-card"><div class="empty"><i class="bi bi-journal"></i>No activity yet.</div></div>';
}

// =====================================================================
//  EVENTS
// =====================================================================
const ACTIONS = {
  'nav': (id, el) => { $$('.modal.show').forEach((m) => { const i = bootstrap.Modal.getInstance(m); if (i) i.hide(); }); setView(el.dataset.view); },
  'logout': doLogout,
  'refresh': refreshAll,
  'refresh-myloans': refreshMyLoans,
  'open-item': (id) => openItem(id),
  'cat': (id) => { S.cat = S.cat === id ? '' : id; renderInventory(); },
  'set-layout': (id, el) => setLayout(el.dataset.layout),
  'clear-filters': clearFilters,
  'add-item': () => openItemForm(null),
  'edit-item': () => { const it = S.currentItem; modal('itemModal').hide(); setTimeout(() => openItemForm(it.ItemID), 300); },
  'delete-item': deleteCurrentItem,
  'return-loan': (id) => reportReturn(id),
  'cancel-request': (id) => cancelRequest(id),
  'refresh-requests': loadRequests,
  'req-filter': (id) => { S.reqFilter = id; renderRequests(); },
  'approve-req': (id) => openDecide(id, true),
  'reject-req': (id) => openDecide(id, false),
  'verify-return': (id) => openVerify(id),
  'allocate-item': () => { const it = S.currentItem; modal('itemModal').hide(); setTimeout(() => openAllocate(it.ItemID), 300); },
  'add-alloc': () => openAllocate(''),
  'end-alloc': (id) => openEndAlloc(id),
  'open-dup': (id) => { modal('itemFormModal').hide(); setTimeout(() => openItemForm(id), 300); },
  'admin-tab': (id, el) => setAdminTab(el.dataset.tab),
  'add-user': () => openUserForm(null),
  'edit-user': (id) => openUserForm(id),
  'reset-user-pass': (id) => openPwModal('reset', id),
  'toggle-user': (id) => toggleUser(id),
  'delete-user': (id) => deleteUserAction(id),
  'change-pass': () => openPwModal('change'),
  'gen-pass': (id, el) => { const t = document.getElementById(el.dataset.target); t.value = genPassword(); t.type = 'text'; },
  'toggle-pass': (id, el) => { const t = document.getElementById(el.dataset.target); t.type = t.type === 'password' ? 'text' : 'password'; },
  'copy-cred': () => copyText($('#credText').textContent),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset.id, el, e);
});

$('#loginForm').addEventListener('submit', doLogin);
$('#itemForm').addEventListener('submit', submitItemForm);
$('#ifImage').addEventListener('change', onImagePicked);
$('#decideForm').addEventListener('submit', submitDecide);
$('#verifyForm').addEventListener('submit', submitVerify);
$('#vfCond').addEventListener('change', verifyHelp);
$('#vfQty').addEventListener('input', verifyHelp);
$('#ifRoom').addEventListener('change', () => { const o = $('#ifRoom').value === ROOM_OTHER; $('#ifRoomOther').classList.toggle('d-none', !o); if (o) $('#ifRoomOther').focus(); });
$('#fRoom').addEventListener('change', () => { S.room = $('#fRoom').value; renderInventory(); });
$('#reqSearch').addEventListener('input', renderRequests);
$('#userForm').addEventListener('submit', submitUserForm);
$('#ufRole').addEventListener('change', roleHelp);
$('#pwForm').addEventListener('submit', submitPw);
$('#fSearch').addEventListener('input', renderInventory);
['#fStock', '#fSort'].forEach((s) => $(s).addEventListener('change', renderInventory));
$('#aUserSearch').addEventListener('input', renderUsers);
$('#allocForm').addEventListener('submit', submitAllocate);
$('#alItem').addEventListener('change', allocHelp);
$('#aAllocFilter').addEventListener('change', renderAllocations);
$('#aAllocSearch').addEventListener('input', renderAllocations);
$('#aLogSearch').addEventListener('input', renderLog);

// =====================================================================
//  START
// =====================================================================
(function init() {
  const boot = document.getElementById('bootMsg'); if (boot) boot.remove();   // script is running
  // the website must not be shown inside someone else's page (click-jacking)
  if (!IN_APPS_SCRIPT && window.top !== window.self) { document.body.innerHTML = '<p style="padding:24px">Open this page directly.</p>'; return; }
  applyConfig({});
  if (!apiConfigured()) return showLogin('Setup needed: this page is not connected to the server yet. Paste your Apps Script /exec link into API_URL in index.html.');
  const saved = store.get('riot_token');
  if (saved) {
    S.token = saved;
    loadApp().catch((e) => { if (e.message !== 'Session expired') endSession(e.message); });
  } else {
    showLogin('');
  }
})();
