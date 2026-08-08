'use strict';

/* ============================================================
   Installments Ledger — main application
   ============================================================ */

/* ---------- helpers ---------- */
const $ = function (sel, root) { return (root || document).querySelector(sel); };
const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) { return escHtml(s); }

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function pad(n) { return n < 10 ? '0' + n : String(n); }
function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function todayISO() { return isoOf(new Date()); }

function fmtDate(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return pad(p[2]) + ' ' + months[(p[1] || 1) - 1] + ' ' + p[0];
}

function addInterval(iso, freq, n) {
  const p = iso.split('-').map(Number);
  const y = p[0], m = p[1] - 1, d = p[2];
  if (freq === 'weekly') return isoOf(new Date(y, m, d + n * 7));
  return isoOf(new Date(y, m + n, Math.min(d, new Date(y, m + n + 1, 0).getDate())));
}

function fmtMoney(n) {
  return state.settings.currency + round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name) { return (String(name || '?').trim().charAt(0) || '?').toUpperCase(); }

/* ---------- global state ---------- */
let state = {
  settings: { businessName: 'MHD ABO SALEM', businessPhone: '', businessAddress: '', currency: '$' },
  customers: [],
  logs: [],
  view: 'dashboard',
  customerId: null
};

let wizard = null;

/* ---------- toast ---------- */
function toast(msg, type) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.innerHTML = (type === 'ok' ? '✓ ' : type === 'err' ? '✕ ' : '') + escHtml(msg);
  root.appendChild(el);
  setTimeout(function () {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(function () { el.remove(); }, 320);
  }, 2600);
}

/* ---------- modal ---------- */
function openModal(title, bodyHtml, footHtml, lg) {
  $('#modal-root').innerHTML =
    '<div class="modal-overlay show" onclick="if(event.target===this)closeModal()">' +
    '<div class="modal' + (lg ? ' lg' : '') + '">' +
    '<div class="modal-head"><h3>' + title + '</h3><button class="modal-close" onclick="closeModal()">×</button></div>' +
    '<div class="modal-body">' + bodyHtml + '</div>' +
    (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
    '</div></div>';
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function renderModal(title, bodyHtml, footHtml, lg) {
  const overlay = $('#modal-root');
  const existing = overlay ? overlay.querySelector('.modal') : null;
  if (!existing) { openModal(title, bodyHtml, footHtml, lg); return; }
  const headH3 = existing.querySelector('.modal-head h3');
  if (headH3) headH3.innerHTML = title;
  const body = existing.querySelector('.modal-body');
  if (body) body.innerHTML = bodyHtml;
  let foot = existing.querySelector('.modal-foot');
  if (footHtml) {
    if (foot) foot.innerHTML = footHtml;
    else { const f = document.createElement('div'); f.className = 'modal-foot'; f.innerHTML = footHtml; existing.appendChild(f); }
  } else if (foot) { foot.parentNode.removeChild(foot); }
  if (body) {
    body.classList.remove('wiz-swap');
    void body.offsetWidth;
    body.classList.add('wiz-swap');
  }
}

/* ============================================================
   DATA
   ============================================================ */
function loadData() {
  const d = Store.getData();
  state.settings = d.settings || { businessName: 'MHD ABO SALEM', businessPhone: '', businessAddress: '', currency: '$' };
  if (!state.settings.businessName || state.settings.businessName === 'My Business') state.settings.businessName = 'MHD ABO SALEM';
  state.customers = d.customers || [];
  state.logs = d.logs || [];
}
function saveData() {
  Store.saveData({ customers: state.customers, settings: state.settings, logs: state.logs });
}

/* ---------- Roles & permissions ---------- */
function myRole() {
  return Store.getRoleDef(Store.getUserRole());
}

/* Customers a user is allowed to see (admin sees all). */
function visibleCustomers() {
  const role = myRole();
  if (Store.isAdmin() || !role || role.kind !== 'customers') return state.customers;
  const colors = (role.colors && role.colors.length) ? role.colors : [];
  if (!colors.length) return [];
  return state.customers.filter(function (c) { return colors.indexOf(c.cat || 'gold') >= 0; });
}

/* Whether the current user may open a given page. */
function pageAllowed(view) {
  if (Store.isAdmin() || view === 'dashboard') return true;
  const role = myRole();
  if (!role || role.kind !== 'pages') return true;
  const pages = (role.pages && role.pages.length) ? role.pages : [];
  return pages.indexOf(view) >= 0;
}

function catLabel(cat) { return cat || 'gold'; }
function catClass(cat) {
  const c = cat || 'gold';
  return 'cat-' + c;
}
function parseJsonArr(s, fallback) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : (fallback || []); }
  catch (e) { return fallback || []; }
}

function logAction(type, detail) {
  const entry = { id: (state.logs.length ? state.logs[state.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: type, detail: detail };
  state.logs.push(entry);
  if (state.logs.length > 500) state.logs = state.logs.slice(-500);
  saveData();
}

function paidOf(c) { return (c.payments || []).reduce(function (s, p) { return s + p.amount; }, 0); }
function balanceOf(c) { return Math.max(0, round2(c.plan.total - totalDiscount(c) - paidOf(c))); }

function discountsOf(c) { return (c.discounts || []).slice(); }
function totalDiscount(c) { return round2(discountsOf(c).reduce(function (s, d) { return s + d.amount; }, 0)); }
/* Discount applied to a single installment (specific + proportional share of 'all'). */
function instDiscount(it, c) {
  const insts = installmentsOf(c);
  const totalBase = insts.reduce(function (s, x) { return s + x.amount; }, 0);
  const specific = discountsOf(c).filter(function (d) { return d.instNum === it.i; }).reduce(function (s, d) { return s + d.amount; }, 0);
  const allTotal = discountsOf(c).filter(function (d) { return d.instNum === 0; }).reduce(function (s, d) { return s + d.amount; }, 0);
  const share = totalBase > 0 ? allTotal * (it.amount / totalBase) : 0;
  return round2(specific + share);
}
function effectiveInstAmount(it, c) { return round2(Math.max(0, it.amount - instDiscount(it, c))); }
function effectiveInstallments(c) {
  return installmentsOf(c).map(function (it) {
    return { i: it.i, due: it.due, amount: effectiveInstAmount(it, c), original: it.amount };
  });
}
/* Remaining after paying installment X (schedule-based): plan total − down − cumulative through X. */
function remainingAfter(c, it) {
  const insts = installmentsOf(c);
  let cum = 0;
  for (let j = 0; j < insts.length; j++) {
    cum += effectiveInstAmount(insts[j], c);
    if (insts[j].i === it.i) break;
  }
  return round2(Math.max(0, (c.plan.total - (c.plan.down || 0)) - cum));
}
function weekdayOf(iso) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const p = String(iso).split('-').map(Number);
  return days[new Date(p[0], (p[1] || 1) - 1, p[2] || 1).getDay()];
}

function installmentsOf(c) {
  const plan = c.plan;
  if (plan.type === 'cash') return [];
  if (Array.isArray(c.installments) && c.installments.length) {
    return c.installments.map(function (x) {
      return { i: x.i, due: x.due, amount: round2(x.amount) };
    });
  }
  const list = [];
  const remaining = round2(plan.total - (plan.down || 0));
  const per = round2(plan.amountPerInstallment);
  for (let i = 1; i <= plan.count; i++) {
    list.push({ i: i, due: addInterval(plan.startDate, plan.frequency, i), amount: per });
  }
  const sum = list.reduce(function (s, x) { return s + x.amount; }, 0);
  if (list.length && Math.abs(remaining - sum) > 0.001) {
    list[list.length - 1].amount = round2(list[list.length - 1].amount + (remaining - sum));
  }
  return list;
}

/* Rebuild stored installments from a given list: renumber, drop zero amounts, keep total stable. */
function storeInstallments(c, list) {
  const kept = list.filter(function (x) { return x.amount > 0.005; });
  const clean = kept.map(function (x, k) {
    return { i: k + 1, due: x.due, amount: round2(x.amount) };
  });
  c.installments = clean;
  c.plan.count = clean.length;
  return clean;
}
function lastInstallmentAmount(c) {
  const insts = installmentsOf(c);
  return insts.length ? insts[insts.length - 1].amount : 0;
}
function nextInstallmentDue(c) {
  const insts = installmentsOf(c);
  if (!insts.length) return todayISO();
  return addInterval(insts[insts.length - 1].due, c.plan.frequency, 1);
}

function instStatus(it, c) {
  const insts = effectiveInstallments(c);
  const pays = paymentsOf(c);
  const notePaid = {};
  let manualTotal = 0;
  pays.forEach(function (p) {
    if (p.note && p.note.indexOf('Installment #') === 0) {
      const n = parseInt(p.note.slice('Installment #'.length), 10);
      if (n) notePaid[n] = (notePaid[n] || 0) + p.amount;
    } else {
      manualTotal += p.amount;
    }
  });
  let target = it.amount;
  let covered = 0;
  let manualUsed = 0;
  for (const x of insts) {
    const noteCov = Math.min(x.amount, notePaid[x.i] || 0);
    const needManual = Math.max(0, x.amount - noteCov);
    const manualCov = Math.min(needManual, Math.max(0, manualTotal - manualUsed));
    manualUsed += manualCov;
    if (x.i === it.i) {
      target = x.amount;
      covered = noteCov + manualCov;
      break;
    }
  }
  const today = todayISO();
  let status;
  if (covered >= target - 0.005) status = 'paid';
  else if (it.due < today) status = 'overdue';
  else if (it.due === today) status = 'due';
  else status = 'upcoming';
  return { covered: round2(covered), remaining: round2(target - covered), status: status };
}

/* Which payment fully covered this installment, and the remaining after it. */
function instPaymentDetail(it, c) {
  const pays = paymentsOf(c);
  const insts = effectiveInstallments(c);
  const instAmt = it.amount;
  const matched = pays.filter(function (p) { return p.note === 'Installment #' + it.i; });
  if (matched.length) {
    let mCovered = 0;
    for (const p of matched) {
      mCovered += p.amount;
      if (mCovered >= instAmt - 0.005) {
        return { date: p.date, paidAmount: instAmt, remainingAfter: 0 };
      }
    }
  }
  let cumBefore = 0, foundIdx = false;
  for (let k = 0; k < insts.length; k++) {
    if (insts[k].i === it.i) { foundIdx = true; break; }
    cumBefore += insts[k].amount;
  }
  if (!foundIdx) return { date: null, paidAmount: 0, remainingAfter: it.amount };
  const target = cumBefore + it.amount;
  let totalPaid = 0;
  for (const p of pays) {
    totalPaid += p.amount;
    if (totalPaid >= target - 0.005) {
      return { date: p.date, paidAmount: it.amount, remainingAfter: 0 };
    }
  }
  const applied = Math.max(0, Math.min(it.amount, totalPaid - cumBefore));
  return { date: null, paidAmount: round2(applied), remainingAfter: round2(it.amount - applied) };
}

function overdueAmount(c) {
  if (c.plan.type === 'cash') return 0;
  let tot = 0;
  installmentsOf(c).forEach(function (it) {
    const s = instStatus(it, c);
    if (s.status === 'overdue') tot += s.remaining;
  });
  return round2(tot);
}

function customerStatus(c) {
  if (c.plan.type === 'cash') return { text: 'Cash', cls: 'badge-cash' };
  if (balanceOf(c) <= 0.005) return { text: 'Completed', cls: 'badge-paid' };
  if (overdueAmount(c) > 0) return { text: 'Overdue', cls: 'badge-overdue' };
  return { text: 'Active', cls: 'badge-upcoming' };
}

function paidInstallmentsCount(c) {
  if (c.plan.type === 'cash') return 1;
  return installmentsOf(c).filter(function (it) { return instStatus(it, c).status === 'paid'; }).length;
}

/* ============================================================
   AUTH
   ============================================================ */
function readLoginDraft() {
  try { return sessionStorage.getItem('il_login_draft') || ''; } catch (e) { return ''; }
}
function writeLoginDraft(v) {
  try { sessionStorage.setItem('il_login_draft', v || ''); } catch (e) {}
}
function clearLoginDraft() {
  try { sessionStorage.removeItem('il_login_draft'); } catch (e) {}
}

let loginMode = null; /* null = auto, 'create', 'signin' */

function setLoginMode(m) {
  loginMode = m;
  const draft = readLoginDraft();
  $('#app').innerHTML = '';
  buildLoginForm(draft);
}

function buildLoginForm(draft) {
  const mode = loginMode || 'signin';
  const needsAccount = mode === 'create';
  const toggleLink = needsAccount
    ? '<p class="login-toggle">Already have an account? <a href="#" onclick="event.preventDefault();setLoginMode(\'signin\')">Sign in</a></p>'
    : '<p class="login-toggle">New here? <a href="#" onclick="event.preventDefault();setLoginMode(\'create\')">Create an account</a></p>';
  $('#app').innerHTML =
    '<div class="login-wrap"><div class="login-card">' +
    '<div class="login-logo"><div class="logo-mark">MS</div><div>' +
    '<h1>MHD ABO SALEM</h1><p class="login-tag">Installments Ledger</p></div></div>' +
    '<p class="sub">' + (needsAccount ? 'Create your account. The first account becomes the admin.' : 'Sign in to unlock your encrypted ledger.') + '</p>' +
    '<div class="login-secure"><span class="lock">🔒</span><span>Data encrypted at rest — unlocked only with your password</span></div>' +
    '<div class="login-error" id="login-error"></div>' +
    (needsAccount
      ? '<form onsubmit="event.preventDefault();handleCreate()">' +
        '<div class="field"><label>Username</label><input type="text" id="l_user" autocomplete="username" value="' + escAttr(draft) + '" oninput="writeLoginDraft(this.value)"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="l_pass" autocomplete="new-password"></div>' +
        '<div class="field"><label>Confirm Password</label><input type="password" id="l_pass2" autocomplete="new-password"></div>' +
        '<button class="btn btn-primary btn-block btn-lg" type="submit">Create Account</button></form>'
      : '<form onsubmit="event.preventDefault();handleLogin()">' +
        '<div class="field"><label>Username</label><input type="text" id="l_user" autocomplete="username" value="' + escAttr(draft) + '" oninput="writeLoginDraft(this.value)"></div>' +
        '<div class="field"><label>Password</label><input type="password" id="l_pass" autocomplete="current-password"></div>' +
        '<button class="btn btn-primary btn-block btn-lg" type="submit">Sign In</button></form>') +
    toggleLink +
    '</div></div>';
  const userEl = $('#l_user');
  if (userEl && draft) {
    const len = userEl.value.length;
    userEl.setSelectionRange(len, len);
  }
}

function renderLogin() {
  const draft = readLoginDraft();
  if ($('#l_user')) {
    if (draft) {
      const ue = $('#l_user');
      if (ue && ue.value !== draft) ue.value = draft;
    }
    return;
  }
  buildLoginForm(draft);
}

function loginError(msg) {
  const el = $('#login-error');
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

async function handleLogin() {
  const u = $('#l_user').value.trim();
  const p = $('#l_pass').value;
  if (!u || !p) { loginError('Enter your username and password.'); return; }
  try {
    const res = await Sync.signInFromCloud(u, p);
    if (!res.ok) { loginError(res.error); return; }
    afterAuthenticated();
  } catch (e) {
    loginError('Cannot reach the sync server. Check your connection.');
  }
}

async function handleCreate() {
  const u = $('#l_user').value.trim();
  const p = $('#l_pass').value;
  const p2 = $('#l_pass2').value;
  if (!u || !p) { loginError('Enter a username and password.'); return; }
  if (p.length < 4) { loginError('Password must be at least 4 characters.'); return; }
  if (p !== p2) { loginError('Passwords do not match.'); return; }
  try {
    /* First account ever becomes the admin (bootstrap). Otherwise create
       a pending account that waits for admin approval. */
    const users = await Sync.listUsers();
    const anyAdmin = users.some(function (x) { return x.is_admin && x.status === 'approved'; });
    if (!anyAdmin) {
      const user = await Store.bootstrapAdmin(u, p);
      await Sync.upsertUser(user);
      const vault = await Store.exportVaultPayload();
      await Sync.pushMasterVault(vault.payload, 0);
      clearLoginDraft();
      toast('Admin account created. Welcome!', 'ok');
      afterAuthenticated();
      return;
    }
    const exists = users.some(function (x) { return x.username === u; });
    if (exists) { loginError('That username already exists. Sign in instead.'); return; }
    const user = await Store.signUp(u, p);
    await Sync.upsertUser(user);
    clearLoginDraft();
    loginMode = 'signin';
    buildLoginForm('');
    loginError('Account created. An admin must approve it before you can sign in.');
  } catch (e) {
    loginError(e.message || 'Could not create account.');
  }
}

function afterAuthenticated() {
  clearLoginDraft();
  navigate('dashboard');
  render();
  Sync.syncAfterAuth();
}

function doLogout() {
  Store.clearSession();
  loginMode = null;
  location.hash = '';
  renderLogin();
}

/* ============================================================
   SHELL + ROUTING
   ============================================================ */
function navigate(hash) { location.hash = '#/' + hash; }

/* Render wrapped in the View Transitions API for smooth page changes.
   Falls back to a plain render where unsupported. */
function renderWithTransition() {
  const doRender = function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
  };
  if (document.startViewTransition) {
    try {
      document.startViewTransition(doRender);
      return;
    } catch (e) { /* fall through */ }
  }
  doRender();
}

function parseRoute() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'customers' && parts[1]) return { view: 'detail', id: Number(parts[1]) };
  return { view: parts[0] || 'dashboard' };
}

const VIEW_TITLES = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  reports: 'Reports & Export',
  settings: 'Settings',
  logs: 'Activity Logs',
  admin: 'Admin Panel'
};

function render() {
  if (!Store.currentUser()) { renderLogin(); return; }
  loadData();
  const route = parseRoute();
  state.view = route.view;
  state.customerId = route.id || null;

  /* Route guard: block pages the role isn't allowed to see. */
  if (!pageAllowed(state.view)) {
    state.view = 'dashboard';
    state.customerId = null;
    location.hash = '#/dashboard';
  }

  const title = VIEW_TITLES[state.view] || 'Dashboard';
  let crumb = '';
  if (state.view === 'detail') {
    const c = state.customers.find(function (x) { return x.id === state.customerId; });
    crumb = 'Customers <span style="color:var(--muted-2)">›</span> ' + (c ? escHtml(c.name) : 'Customer');
  }

  let topActions = '';
  if (state.view === 'customers') {
    topActions = '<button class="btn btn-secondary btn-sm" onclick="exportExcel()">⬇ Export Excel</button>' +
      '<button class="btn btn-primary btn-sm" onclick="openAddWizard()">+ Add Customer</button>';
  }
  if (state.view === 'dashboard') {
    topActions = '<button class="btn btn-primary btn-sm" onclick="openAddWizard()">+ Add Customer</button>';
  }

  const userName = Store.currentUser();
  const isAdmin = Store.isAdmin();

  $('#app').innerHTML =
    '<div class="app-shell">' +
    '<aside class="sidebar">' +
    '<div class="brand"><div class="logo-mark">MS</div><div><b>MHD ABO SALEM</b><small>Installments Ledger</small></div></div>' +
    '<nav>' +
    '<div class="nav-label">Menu</div>' +
    (pageAllowed('dashboard') ? navItem('dashboard', '⌂', 'Dashboard') : '') +
    (pageAllowed('customers') ? navItem('customers', '👤', 'Customers') : '') +
    (pageAllowed('reports') ? navItem('reports', '⬇', 'Reports & Export') : '') +
    (pageAllowed('logs') ? navItem('logs', '📋', 'Logs') : '') +
    (pageAllowed('settings') ? navItem('settings', '⚙', 'Settings') : '') +
    (isAdmin ? navItem('admin', '🛡', 'Admin Panel') : '') +
    '</nav>' +
    '<div class="side-foot">' +
    '<div class="side-user"><div class="avatar">' + initials(userName) + '</div>' +
    '<div><b>' + escHtml(userName) + '</b><small>' + (isAdmin ? 'Administrator' : 'User') + '</small></div></div>' +
    '<button class="btn btn-ghost btn-sm btn-block" style="color:#b8a968" onclick="doLogout()">↪ Sign out</button>' +
    '</div>' +
    '</aside>' +
    '<div class="main">' +
    '<header class="topbar"><div><h2>' + escHtml(title) + '</h2>' + (crumb ? '<div class="crumb">' + crumb + '</div>' : '') + '</div>' +
    '<div class="actions">' + topActions + '</div></header>' +
    '<div class="content" id="content"></div>' +
    '</div>' +
    '</div>' +
    bottomNav();

  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'customers') renderCustomers();
  else if (state.view === 'detail') renderCustomerDetail(state.customerId);
  else if (state.view === 'reports') renderReports();
  else if (state.view === 'logs') renderLogs();
  else if (state.view === 'settings') renderSettings();
  else if (state.view === 'admin') renderAdmin();
  else renderDashboard();

  if ((state.view === 'dashboard' || state.view === 'customers') && pageAllowed('customers')) renderFAB();
}

function navItem(view, icon, label) {
  const active = state.view === view || (view === 'customers' && (state.view === 'detail'));
  return '<button class="nav-item' + (active ? ' active' : '') + '" onclick="navigate(\'' + view + '\')">' +
    '<span class="ico">' + icon + '</span><span class="label">' + label + '</span></button>';
}

function bottomNav() {
  const items = [
    ['dashboard', '⌂', 'Home'],
    ['customers', '👤', 'Customers'],
    ['logs', '📋', 'Logs'],
    ['settings', '⚙', 'Settings']
  ].filter(function (it) { return pageAllowed(it[0]); });
  return '<nav class="bottom-nav">' + items.map(function (it) {
    const active = state.view === it[0] || (it[0] === 'customers' && state.view === 'detail');
    return '<button class="bn-item' + (active ? ' active' : '') + '" onclick="navigate(\'' + it[0] + '\')">' +
      '<span class="ic">' + it[1] + '</span><span class="bn-label">' + it[2] + '</span></button>';
  }).join('') + '</nav>';
}

function renderFAB() {
  const el = document.createElement('button');
  el.className = 'fab';
  el.innerHTML = '<span>+</span>';
  el.onclick = openAddWizard;
  el.title = 'Add customer';
  $('#app').appendChild(el);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const visible = visibleCustomers();
  let totalCustomers = visible.length;
  let collected = 0, outstanding = 0, overdue = 0;
  visible.forEach(function (c) {
    collected += paidOf(c);
    outstanding += balanceOf(c);
    overdue += overdueAmount(c);
  });

  const overdueList = visible
    .map(function (c) { return { c: c, amt: overdueAmount(c) }; })
    .filter(function (x) { return x.amt > 0; })
    .sort(function (a, b) { return b.amt - a.amt; });

  const dueWeek = dueThisWeek();
  const recent = visible.slice().sort(function (a, b) { return b.id - a.id; }).slice(0, 6);

  $('#content').innerHTML =
    '<div class="stat-grid">' +
    statCardCount('ico-teal', '👥', 'Total Customers', totalCustomers, 'customers registered', totalCustomers, false) +
    statCardCount('ico-blue', '💰', 'Amount Collected', fmtMoney(collected), 'payments received', collected, true) +
    statCardCount('ico-amber', '📌', 'Outstanding Balance', fmtMoney(outstanding), 'still to be collected', outstanding, true) +
    statCardCount('ico-red', '⚠', 'Overdue', fmtMoney(overdue), (overdueList.length) + ' customer(s) behind', overdue, true) +
    '</div>' +
    '<div class="dash-grid">' +
    '<div>' +
    panel('Overdue Payments', overdueList.length ? '<a class="muted" style="font-size:12px" href="#/customers">View all →</a>' : '',
      overdueList.length
        ? overdueList.map(function (x) {
          return '<div class="list-row" onclick="navigate(\'customers/' + x.c.id + '\')">' +
            '<div class="avatar" style="width:38px;height:38px;background:linear-gradient(135deg,#d8b24a,#9a781f)">' + initials(x.c.name) + '</div>' +
            '<div class="grow"><b>' + escHtml(x.c.name) + '</b><small>overdue balance</small></div>' +
            '<span class="badge badge-overdue">' + fmtMoney(x.amt) + '</span>' +
            '</div>';
        }).join('')
        : '<div class="empty"><span class="big">🎉</span>No overdue payments. Great job!</div>') +
    panel('Due This Week', '', dueWeek.length ? '' :
      '<div class="empty"><span class="big">📅</span>No installments due this week</div>') +
    '</div>' +
    '<div>' +
    panel('Recent Customers', '<a class="muted" style="font-size:12px" href="#/customers">View all →</a>',
      recent.map(function (c) {
        const st = customerStatus(c);
        return '<div class="list-row" onclick="navigate(\'customers/' + c.id + '\')">' +
          '<div class="avatar" style="width:38px;height:38px">' + initials(c.name) + '</div>' +
          '<div class="grow"><b>' + escHtml(c.name) + '</b><small>balance ' + fmtMoney(balanceOf(c)) + '</small></div>' +
          '<span class="badge ' + st.cls + '">' + st.text + '</span>' +
          '</div>';
      }).join('') || '<div class="empty"><span class="big">👤</span>No customers yet — tap <b>+</b> to add one</div>') +
    '</div>' +
    '</div>';

  if (dueWeek.length) {
    const box = $$('.panel')[1];
    const body = box.querySelector('.panel-body');
    body.innerHTML = dueWeek.map(function (x) {
      return '<div class="list-row" onclick="navigate(\'customers/' + x.c.id + '\')">' +
        '<div class="avatar" style="width:38px;height:38px">' + initials(x.c.name) + '</div>' +
        '<div class="grow"><b>' + escHtml(x.c.name) + '</b><small>Installment #' + x.it.i + ' · due ' + fmtDate(x.it.due) + '</small></div>' +
        '<span class="badge ' + (x.status === 'due' ? 'badge-due' : 'badge-upcoming') + '">' + fmtMoney(x.remaining) + '</span>' +
        '</div>';
    }).join('');
  }

  animateStats($('#content'));
}

/* Animate the numeric stat cards with a soft count-up. */
function animateStats(root) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = $$('.stat-card .value', root);
  cards.forEach(function (el) {
    const target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    const money = el.getAttribute('data-money') === '1';
    const start = performance.now();
    const dur = 900;
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = target * eased;
      el.textContent = money ? fmtMoney(val) : String(Math.round(val));
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = money ? fmtMoney(target) : String(Math.round(target));
    }
    requestAnimationFrame(step);
  });
}

function statCardCount(icoCls, icon, label, value, sub, count, money) {
  return '<div class="stat-card"><div class="ico ' + icoCls + '">' + icon + '</div>' +
    '<div class="label">' + label + '</div><div class="value" data-count="' + count + '" data-money="' + (money ? 1 : 0) + '">' + value + '</div>' +
    '<div class="subline">' + sub + '</div></div>';
}

function panel(title, headExtra, bodyHtml) {
  return '<div class="panel"><div class="panel-head"><h3>' + title + '</h3>' + (headExtra || '') + '</div>' +
    '<div class="panel-body">' + bodyHtml + '</div></div>';
}

function dueThisWeek() {
  const today = todayISO();
  const end = addInterval(today, 'weekly', 1);
  const out = [];
  visibleCustomers().forEach(function (c) {
    if (c.plan.type === 'cash') return;
    installmentsOf(c).forEach(function (it) {
      const s = instStatus(it, c);
      if ((s.status === 'upcoming' || s.status === 'due') && it.due >= today && it.due <= end) {
        out.push({ c: c, it: it, remaining: s.remaining, status: s.status });
      }
    });
  });
  out.sort(function (a, b) { return a.it.due.localeCompare(b.it.due); });
  return out.slice(0, 8);
}

/* ============================================================
   CUSTOMERS LIST
   ============================================================ */
function renderCustomers() {
  const q = $('#cust-search') ? $('#cust-search').value.trim().toLowerCase() : '';
  const visible = visibleCustomers();
  const list = visible.slice().sort(function (a, b) { return b.id - a.id; })
    .filter(function (c) {
      if (!q) return true;
      return (c.name || '').toLowerCase().indexOf(q) >= 0;
    });

  $('#content').innerHTML =
    '<div class="toolbar">' +
    '<div class="search-box"><span class="icon">🔍</span><input id="cust-search" type="text" placeholder="Search by name…" value="' + escAttr(q) + '" oninput="renderCustomers()"></div>' +
    '<span class="muted" style="font-size:13px">' + list.length + ' customer(s)</span>' +
    '</div>' +
    '<div class="panel"><div class="tbl-wrap"><table class="tbl">' +
    '<thead><tr><th>Customer</th><th>Category</th><th>Plan</th><th>Installments</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>' +
    '<tbody>' +
    (list.map(function (c) {
      const st = customerStatus(c);
      const totalInst = c.plan.type === 'cash' ? 1 : c.plan.count;
      const paidInst = paidInstallmentsCount(c);
      const planLabel = c.plan.type === 'cash'
        ? '<span class="badge badge-cash">Cash</span>'
        : '<span class="badge badge-install">Installments</span> <span class="muted" style="font-size:12px">' +
          (c.plan.frequency === 'weekly' ? 'Weekly' : 'Monthly') + '</span>';
      return '<tr class="row-main" onclick="navigate(\'customers/' + c.id + '\')">' +
        '<td data-label="Customer"><div class="flex" style="gap:10px"><div class="avatar" style="width:36px;height:36px">' + initials(c.name) + '</div>' +
        '<div><b>' + escHtml(c.name) + '</b><div class="muted" style="font-size:12px">Customer #' + c.id + '</div></div></div></td>' +
        '<td data-label="Category"><span class="badge ' + catClass(c.cat) + '">' + escHtml(catLabel(c.cat)) + '</span></td>' +
        '<td data-label="Plan">' + planLabel + '</td>' +
        '<td data-label="Installments"><span class="num">' + paidInst + ' / ' + totalInst + '</span></td>' +
        '<td data-label="Paid" class="num money">' + fmtMoney(paidOf(c)) + '</td>' +
        '<td data-label="Balance" class="num money">' + fmtMoney(balanceOf(c)) + '</td>' +
        '<td data-label="Status"><span class="badge ' + st.cls + '">' + st.text + '</span></td>' +
        '<td style="text-align:right"><span class="muted">›</span></td>' +
        '</tr>';
    }).join('')) ||
    '<tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:40px">' +
    (q ? 'No customers match your search.' : 'No customers yet. Click “+ Add Customer” to get started.') + '</td></tr>' +
    '</tbody></table></div></div>';
}

/* ============================================================
   CUSTOMER DETAIL
   ============================================================ */
function getCustomer(id) {
  return state.customers.find(function (c) { return c.id === id; });
}

function renderCustomerDetail(id) {
  const c = getCustomer(id);
  if (!c) {
    $('#content').innerHTML = '<div class="notfound"><h1>404</h1><p>Customer not found.</p>' +
      '<button class="btn btn-primary" onclick="navigate(\'customers\')">Back to customers</button></div>';
    return;
  }
  const st = customerStatus(c);
  const insts = installmentsOf(c);
  const paid = paidOf(c);
  const plan = c.plan;

  const planRows = plan.type === 'cash'
    ? [['Total Amount', fmtMoney(plan.total)], ['Paid', fmtMoney(paid)], ['Balance', fmtMoney(balanceOf(c))], ['Date', fmtDate(plan.startDate)]]
    : [['Total Amount', fmtMoney(plan.total)], ['Down Payment', fmtMoney(plan.down)],
      ['Per Installment', fmtMoney(plan.amountPerInstallment)], ['Frequency', plan.frequency === 'weekly' ? 'Weekly' : 'Monthly'],
      ['Installments', String(plan.count)], ['Start Date', fmtDate(plan.startDate)],
      ['Paid', fmtMoney(paid)], ['Balance', fmtMoney(balanceOf(c))]];

  $('#content').innerHTML =
    '<div class="mb"><button class="btn btn-ghost btn-sm" onclick="navigate(\'customers\')">← Back to customers</button></div>' +

    '<div class="cust-head">' +
    '<div class="cust-avatar">' + initials(c.name) + '</div>' +
    '<div class="grow">' +
    '<h1>' + escHtml(c.name) + ' <span class="badge ' + st.cls + '">' + st.text + '</span> <span class="badge ' + catClass(c.cat) + '">' + escHtml(catLabel(c.cat)) + '</span></h1>' +
    '<div class="meta">' +
    '<span>🕒 Added ' + fmtDate(c.createdAt) + '</span>' +
    '</div>' +
    (c.notes ? '<div class="muted" style="font-size:12.5px;margin-top:6px">📝 ' + escHtml(c.notes) + '</div>' : '') +
    '<div class="kv-grid">' + planRows.map(function (r) {
      return '<div class="kv"><div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div></div>';
    }).join('') + '</div>' +
    '</div>' +
    '<div class="flex" style="flex-wrap:wrap">' +
    '<button class="btn btn-secondary" onclick="exportCustomerPdf(' + c.id + ')">⬇ Statement PDF</button>' +
    '<button class="btn btn-secondary" onclick="openEditModal(' + c.id + ')">✎ Edit</button>' +
    '<button class="btn btn-danger" onclick="confirmDeleteCustomer(' + c.id + ')">🗑</button>' +
    '</div>' +
    '</div>' +

    '<div class="summary-boxes">' +
    '<div class="summary-box summary-box--total"><div class="box-label">Car Total</div><div class="box-value num"><input type="number" class="box-input" step="0.01" value="' + escAttr(c.boxTotal == null ? plan.total : c.boxTotal) + '" onchange="saveCustomerBox(' + c.id + ',\'boxTotal\',this.value)"></div></div>' +
    '<div class="summary-box summary-box--paid"><div class="box-label">Cash Paid</div><div class="box-value num"><input type="number" class="box-input" step="0.01" value="' + escAttr(c.boxPaid == null ? paid : c.boxPaid) + '" onchange="saveCustomerBox(' + c.id + ',\'boxPaid\',this.value)"></div></div>' +
    '<div class="summary-box summary-box--remaining' + ((balanceOf(c) <= 0 && c.boxRemaining == null) ? ' is-zero' : '') + '"><div class="box-label">Remaining</div><div class="box-value num"><input type="number" class="box-input" step="0.01" value="' + escAttr(c.boxRemaining == null ? balanceOf(c) : c.boxRemaining) + '" onchange="saveCustomerBox(' + c.id + ',\'boxRemaining\',this.value)"></div></div>' +
    '</div>' +

    /* Schedule */
    '<div class="panel mb"><div class="panel-head"><h3>Installment Schedule</h3></div><div class="tbl-wrap">' +
    '<table class="tbl"><thead><tr><th>#</th><th class="num">Amount</th><th class="num">Actions</th><th class="num">Paid</th><th>Status</th><th class="num">Remaining</th></tr></thead><tbody>' +
    (plan.type === 'cash'
      ? '<tr><td data-label="#">1</td><td data-label="Amount" class="num"><span class="inst-amt">' + fmtMoney(plan.total) + '</span><span class="inst-day">' + weekdayOf(plan.startDate) + ' · ' + fmtDate(plan.startDate) + '</span></td><td data-label="Actions" style="text-align:center"></td><td data-label="Paid" class="num">' + fmtMoney(paid) + '</td><td data-label="Status"><span class="badge badge-paid">Paid</span></td><td data-label="Remaining" class="num"><span class="inst-rem">' + fmtMoney(0) + '</span></td></tr>'
      : insts.map(function (it) {
        const eff = effectiveInstAmount(it, c);
        const itEff = Object.assign({}, it, { amount: eff });
        const s = instStatus(itEff, c);
        const cls = s.status === 'paid' ? 'badge-paid' : s.status === 'overdue' ? 'badge-overdue' : s.status === 'due' ? 'badge-due' : 'badge-upcoming';
        const lbl = s.status === 'paid' ? 'Paid' : s.status === 'overdue' ? 'Overdue' : s.status === 'due' ? 'Due Today' : 'Upcoming';
        const checked = s.status === 'paid' ? ' checked' : '';
        const hasDiscount = instDiscount(it, c) > 0.005;
        let payDetail = '';
        if (s.status === 'paid') {
          const pd = instPaymentDetail(itEff, c);
          if (pd.date) {
            payDetail = '<small class="muted" style="font-size:11.5px;display:block;margin-top:2px">' + fmtDate(pd.date) + ' · paid ' + fmtMoney(pd.paidAmount) + ' · rem ' + fmtMoney(pd.remainingAfter) + '</small>';
          }
        }
        return '<tr><td data-label="#">' + it.i + '</td>' +
          '<td data-label="Amount" class="num"><span class="inst-amt">' + fmtMoney(eff) + '</span>' + (hasDiscount ? '<span class="inst-disc">disc −' + fmtMoney(instDiscount(it, c)) + '</span>' : '') + '<span class="inst-day">' + weekdayOf(it.due) + ' · <input type="date" class="inst-date" title="Change date — schedule re-arranges by date" value="' + escAttr(it.due) + '" onchange="setInstallmentDate(' + c.id + ',' + it.i + ',this.value)"></span></td>' +
          '<td data-label="Actions" class="inst-actions-cell">' +
          '<span class="inst-actions">' +
          '<button class="inst-btn inst-btn--plus" title="Add payment (extra moves from the last installment)" onclick="openInstPlusModal(' + c.id + ',' + it.i + ',' + eff + ')">+</button>' +
          '<span class="divider"></span>' +
          '<button class="inst-btn inst-btn--minus" title="Paid less or discount" onclick="openInstMinusModal(' + c.id + ',' + it.i + ',' + eff + ')">−</button>' +
          '<span class="divider"></span>' +
          '<input type="checkbox" class="pay-check" ' + checked + ' onchange="toggleInstallmentPayment(' + c.id + ',' + it.i + ',' + eff + ',' + round2(eff - s.remaining) + ',this.checked)">' +
          '</span></td>' +
          '<td data-label="Paid" class="num">' + fmtMoney(s.covered) + payDetail + '</td><td data-label="Status"><span class="badge ' + cls + '">' + lbl + '</span></td>' +
          '<td data-label="Remaining" class="num"><span class="inst-rem">' + fmtMoney(remainingAfter(c, it)) + '</span></td></tr>';
      }).join('')) +
    '</tbody></table></div></div>' +

    /* Payments */
    '<div class="panel mb"><div class="panel-head"><h3>Payment History</h3>' +
    '<button class="btn btn-secondary btn-sm" onclick="openPaymentModal(' + c.id + ')">+ Record</button></div><div class="tbl-wrap">' +
    '<table class="tbl"><thead><tr><th>Date</th><th>Note</th><th class="num">Amount</th><th class="num">Running Total</th><th></th></tr></thead><tbody>' +
    (paymentsOf(c).map(function (p, idx) {
      const run = paymentsOf(c).slice(0, idx + 1).reduce(function (s, x) { return s + x.amount; }, 0);
      return '<tr><td data-label="Date">' + fmtDate(p.date) + '</td><td data-label="Note">' + escHtml(p.note || 'Payment') + '</td>' +
        '<td data-label="Amount" class="num money">' + fmtMoney(p.amount) + '</td><td data-label="Running Total" class="num">' + fmtMoney(run) + '</td>' +
        '<td style="text-align:right"><button class="icon-btn danger" title="Delete payment" onclick="confirmDeletePayment(' + c.id + ',' + p.id + ')">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted-2);padding:30px">No payments recorded yet.</td></tr>') +
    '</tbody></table></div></div>' +

    /* Discounts */
    '<div class="panel"><div class="panel-head"><h3>Discounts</h3>' +
    '<span class="muted" style="font-size:12.5px">Total: ' + fmtMoney(totalDiscount(c)) + '</span></div><div class="tbl-wrap">' +
    '<table class="tbl"><thead><tr><th>Date</th><th>Applied to</th><th class="num">Amount</th><th></th></tr></thead><tbody>' +
    (discountsOf(c).map(function (d) {
      const scope = d.instNum === 0 ? 'All installments' : 'Installment #' + d.instNum;
      return '<tr><td data-label="Date">' + fmtDate(d.date) + '</td><td data-label="Applied to">' + escHtml(scope) + '</td>' +
        '<td data-label="Amount" class="num money" style="color:var(--green)">−' + fmtMoney(d.amount) + '</td>' +
        '<td style="text-align:right"><button class="icon-btn danger" title="Remove discount" onclick="confirmDeleteDiscount(' + c.id + ',' + d.id + ')">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted-2);padding:30px">No discounts yet. Use the − button on an installment to add one.</td></tr>') +
    '</tbody></table></div></div>';
}

function paymentsOf(c) {
  return (c.payments || []).slice().sort(function (a, b) {
    return a.date === b.date ? a.id - b.id : a.date.localeCompare(b.date);
  });
}

function saveCustomerBox(id, field, value) {
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  if (!cust) return;
  cust[field] = (value === '' || value == null) ? null : parseFloat(value);
  Store.saveData(data);
  toast('Saved.', 'ok');
}

/* Edit an installment's date — informational only, amounts/schedule unchanged. */
function setInstallmentDate(id, instNum, date) {
  if (!date) { render(); return; }
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  if (!cust) return;
  const insts = installmentsOf(cust);
  const idx = insts.findIndex(function (x) { return x.i === instNum; });
  if (idx < 0) return;
  insts[idx].due = date;
  insts.sort(function (a, b) { return a.due === b.due ? a.i - b.i : a.due.localeCompare(b.due); });
  const newNums = {};
  insts.forEach(function (x, k) { newNums[x.i] = k + 1; });
  storeInstallments(cust, insts);
  (cust.payments || []).forEach(function (p) {
    if (p.note && p.note.indexOf('Installment #') === 0) {
      const old = parseInt(p.note.slice('Installment #'.length), 10);
      if (newNums[old] && newNums[old] !== old) p.note = 'Installment #' + newNums[old];
    }
  });
  (cust.discounts || []).forEach(function (d) {
    if (d.instNum && d.instNum !== 0 && newNums[d.instNum] && newNums[d.instNum] !== d.instNum) d.instNum = newNums[d.instNum];
  });
  Store.saveData(data);
  toast('Date updated — ' + fmtDate(date) + ', schedule re-arranged by date.', 'ok');
  render();
}

/* ============================================================
   LOGS
   ============================================================ */
function renderLogs() {
  const logs = (state.logs || []).slice().reverse();
  const typeIcons = { customer_added: '👤', payment_recorded: '💰', payment_deleted: '🗑', customer_edited: '✎', customer_deleted: '🗑', settings_changed: '⚙', export_pdf: '📄', export_excel: '📊', system: '🔧' };
  const typeLabels = { customer_added: 'Customer Added', payment_recorded: 'Payment Recorded', payment_deleted: 'Payment Deleted', customer_edited: 'Customer Edited', customer_deleted: 'Customer Deleted', settings_changed: 'Settings Changed', export_pdf: 'PDF Export', export_excel: 'Excel Export', system: 'System' };

  $('#content').innerHTML =
    '<div class="toolbar">' +
    '<span class="muted" style="font-size:13px">' + logs.length + ' log(s) recorded</span>' +
    (logs.length ? '<button class="btn btn-secondary btn-sm" onclick="clearLogs()">Clear All</button>' : '') +
    '</div>' +
    '<div class="panel"><div class="tbl-wrap"><table class="tbl">' +
    '<thead><tr><th>Date & Time</th><th>Action</th><th>Details</th></tr></thead><tbody>' +
    (logs.length ? logs.map(function (log) {
      const icon = typeIcons[log.type] || '•';
      const label = typeLabels[log.type] || log.type;
      const d = new Date(log.date);
      const ts = pad(d.getDate()) + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear() + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      return '<tr><td data-label="Date" style="white-space:nowrap">' + ts + '</td>' +
        '<td data-label="Action"><span style="margin-right:6px">' + icon + '</span>' + escHtml(label) + '</td>' +
        '<td data-label="Details" class="muted">' + escHtml(log.detail || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="3" style="text-align:center;color:var(--muted-2);padding:40px">No logs yet. Actions will appear here automatically.</td></tr>') +
    '</tbody></table></div></div>';
}

function clearLogs() {
  if (!confirm('Clear all logs?')) return;
  state.logs = [];
  saveData();
  toast('Logs cleared.', 'ok');
  renderLogs();
}

/* ============================================================
   WIZARD — add customer
   ============================================================ */
function openAddWizard() {
  wizard = {
    step: 1, frequency: 'monthly',
    name: '', notes: '', cat: 'gold',
    total: 0, startDate: todayISO(), count: 6,
    calcMode: 'count'
  };
  renderWizard();
}

function renderWizard() {
  if (!wizard) return;
  const s = wizard;
  if (s.step === 1) {
    renderModal('Add New Customer', step1Html(), stepNav(1));
  } else if (s.step === 2) {
    renderModal('Payment Plan', step2Html(), stepNav(2), true);
  } else {
    renderModal('Confirm & Create', step3Html(), stepNav(3));
  }
}

function step1Html() {
  const role = myRole();
  const allowed = (Store.isAdmin() || !role || role.kind !== 'customers')
    ? ['pink', 'gold', 'silver']
    : ((role.colors && role.colors.length) ? role.colors : ['gold']);
  const catOptions = ['pink', 'gold', 'silver'].map(function (c) {
    return '<button type="button" class="seg-btn' + (wizard.cat === c ? ' on' : '') + '" onclick="wizardPickCat(\'' + c + '\')">' + c + '</button>';
  }).join('');
  return '<div class="wizard-dots"><div class="dot on"></div><div class="dot"></div><div class="dot"></div></div>' +
    '<div class="field"><label>Full Name *</label><input type="text" id="w_name" placeholder="e.g. Ahmed Mohamed" value="' + escAttr(wizard.name) + '"></div>' +
    '<div class="field"><label>Notes</label><textarea id="w_notes" placeholder="Optional notes about the customer">' + escHtml(wizard.notes) + '</textarea></div>' +
    '<div class="field"><label>Category</label><div class="seg">' + catOptions + '</div></div>';
}

function wizardPickCat(c) { wizard.name = wVal('w_name').trim(); wizard.notes = wVal('w_notes').trim(); wizard.cat = c; renderWizard(); }

function step2Html() {
  const s = wizard;
  const isPerPayment = s.calcMode === 'perPayment';
  return '<div class="wizard-dots"><div class="dot on"></div><div class="dot on"></div><div class="dot"></div></div>' +
    '<div class="field"><label>Total Amount *</label><input type="number" id="w_total" min="0" step="0.01" value="' + (s.total || '') + '"></div>' +
    '<div class="field"><label>Start Date *</label><input type="date" id="w_start" value="' + s.startDate + '"></div>' +
    '<div class="field"><label>Calculate Installments By</label>' +
    '<div class="seg">' +
    '<button type="button" class="' + (!isPerPayment ? 'on' : '') + '" onclick="wizardPickCalc(\'count\')">Number of Installments</button>' +
    '<button type="button" class="' + (isPerPayment ? 'on' : '') + '" onclick="wizardPickCalc(\'perPayment\')">Amount Per Installment</button>' +
    '</div></div>' +
    (isPerPayment
      ? '<div class="field"><label>Amount Per Installment *</label><input type="number" id="w_per" min="0.01" step="0.01" value="' + (s.perPayment || '') + '" placeholder="e.g. 500"></div>'
      : '<div class="field"><label>Number of Installments *</label><input type="number" id="w_count" min="1" step="1" value="' + s.count + '"></div>') +
    '<div class="field"><label>Payment Frequency *</label>' +
    '<div class="seg">' +
    '<button type="button" class="' + (s.frequency === 'weekly' ? 'on' : '') + '" onclick="wizardPickFreq(\'weekly\')">Weekly</button>' +
    '<button type="button" class="' + (s.frequency === 'monthly' ? 'on' : '') + '" onclick="wizardPickFreq(\'monthly\')">Monthly</button>' +
    '</div></div>';
}

function step3Html() {
  const s = wizard;
  const per = s.calcMode === 'perPayment' ? round2(s.perPayment) : round2(s.total / s.count);
  const last = round2(s.total - per * (s.count - 1));
  const rows = [
    ['Customer', s.name],
    ['Type', 'Installments — ' + (s.frequency === 'weekly' ? 'Weekly' : 'Monthly')],
    ['Total Amount', fmtMoney(s.total)],
    ['Number of Installments', String(s.count)],
    ['Amount per Installment', fmtMoney(per)]
  ];
  if (Math.abs(last - per) > 0.005) rows.push(['Last Installment', fmtMoney(Math.max(0, last))]);
  rows.push(['Start Date', fmtDate(s.startDate)]);
  return '<div class="wizard-dots"><div class="dot on"></div><div class="dot on"></div><div class="dot on"></div></div>' +
    '<p class="muted" style="font-size:13px;margin-bottom:12px">Review the details, then confirm to create the customer.</p>' +
    '<div class="summary-block">' + rows.map(function (r) {
      return '<div class="summary-row"><span class="muted">' + escHtml(r[0]) + '</span><span class="num">' + escHtml(r[1]) + '</span></div>';
    }).join('') +
    '<div class="summary-row total"><span>Balance to be paid</span><span>' + fmtMoney(s.total) + '</span></div>' +
    '</div>';
}

function stepNav(step) {
  const back = step > 1 ? '<button class="btn btn-secondary" onclick="wizardBack()">← Back</button>' : '';
  const next = step < 3 ? '<button class="btn btn-primary" onclick="wizardNext()">Next →</button>' : '<button class="btn btn-primary" onclick="wizardConfirm()">✓ Confirm & Create</button>';
  return '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>' + back + next;
}

function wizardCaptureStep2() {
  if (!wizard || wizard.step !== 2) return;
  const t = parseFloat(wVal('w_total'));
  if (!isNaN(t) && t > 0) wizard.total = t;
  const st = wVal('w_start');
  if (st) wizard.startDate = st;
  const c = parseInt(wVal('w_count'), 10);
  if (!isNaN(c) && c >= 1) wizard.count = c;
  const p = parseFloat(wVal('w_per'));
  if (!isNaN(p) && p > 0) wizard.perPayment = p;
}

function wizardPickFreq(f) { wizardCaptureStep2(); wizard.frequency = f; renderWizard(); }

function wizardPickCalc(mode) { wizardCaptureStep2(); wizard.calcMode = mode; renderWizard(); }

function wVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

function wizardNext() {
  if (wizard.step === 1) {
    const name = wVal('w_name').trim();
    if (!name) { toast('Customer name is required.', 'err'); return; }
    wizard.name = name;
    wizard.notes = wVal('w_notes').trim();
    wizard.step = 2;
    renderWizard();
    return;
  }
  if (wizard.step === 2) {
    const total = parseFloat(wVal('w_total'));
    const start = wVal('w_start');
    if (!(total > 0)) { toast('Enter the total amount.', 'err'); return; }
    if (!start) { toast('Select the start date.', 'err'); return; }
    let count;
    if (wizard.calcMode === 'perPayment') {
      const per = parseFloat(wVal('w_per'));
      if (!(per > 0)) { toast('Enter the amount per installment.', 'err'); return; }
      count = Math.ceil(total / per);
      if (count < 1) count = 1;
      wizard.perPayment = per;
    } else {
      count = parseInt(wVal('w_count'), 10);
      if (!(count >= 1)) { toast('Enter the number of installments.', 'err'); return; }
    }
    wizard.total = round2(total);
    wizard.startDate = start;
    wizard.count = count;
    wizard.step = 3;
    renderWizard();
  }
}

function wizardBack() {
  if (wizard.step > 1) { wizard.step--; renderWizard(); }
}

function wizardConfirm() {
  const data = Store.getData();
  const id = Store.nextCustomerId(data);
  const per = wizard.calcMode === 'perPayment' ? round2(wizard.perPayment) : round2(wizard.total / wizard.count);
  const plan = { type: 'installments', total: wizard.total, down: 0, startDate: wizard.startDate, frequency: wizard.frequency, count: wizard.count, amountPerInstallment: per };
  const payments = [];
  const customer = {
    id: id,
    name: wizard.name,
    notes: wizard.notes,
    cat: wizard.cat || 'gold',
    createdAt: todayISO(),
    plan: plan,
    payments: payments
  };
  data.customers.push(customer);
  const insts = installmentsOf(customer);
  storeInstallments(customer, insts);
  Store.saveData(data);
  closeModal();
  logAction('customer_added', escHtml(customer.name) + ' — ' + fmtMoney(plan.total));
  toast('Customer added successfully.', 'ok');
  navigate('customers/' + id);
}

/* ============================================================
   PAYMENT + EDIT + DELETE
   ============================================================ */
function openPaymentModal(id) {
  const c = getCustomer(id);
  if (!c) return;
  const balance = balanceOf(c);
  openModal('Record Payment — ' + c.name,
    '<div class="modal-notice">💰 Balance due: <b>' + fmtMoney(balance) + '</b></div>' +
    '<div class="field-row">' +
    '<div class="field"><label>Date</label><input type="date" id="p_date" value="' + todayISO() + '"></div>' +
    '<div class="field"><label>Amount</label><input type="number" id="p_amount" min="0" step="0.01" placeholder="0.00"></div>' +
    '</div>' +
    '<div class="field"><label>Note <span class="opt">optional</span></label><input type="text" id="p_note" placeholder="e.g. Installment #3 payment"></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="addPayment(' + id + ')">✓ Record Payment</button>');
}

/* + button: customer paid more than the installment. The extra is removed from the LAST
   installment, so the schedule stays balanced. Records the payment too. */
function openInstPlusModal(id, instNum, instAmount) {
  const c = getCustomer(id);
  if (!c) return;
  const lastAmt = lastInstallmentAmount(c);
  openModal('+ Add to Installment #' + instNum + ' · ' + c.name,
    '<div class="modal-notice">➕ Installment #' + instNum + ' is <b>' + fmtMoney(instAmount) + '</b>. Paying more moves the <b>extra from the last installment</b>, shortening the schedule.</div>' +
    '<div class="field-row">' +
    '<div class="field"><label>Date</label><input type="date" id="p_date" value="' + todayISO() + '"></div>' +
    '<div class="field"><label>Amount paid</label><input type="number" id="p_amount" min="0" step="0.01" value="' + instAmount + '"></div>' +
    '</div>' +
    '<div class="field"><label>Note <span class="opt">optional</span></label><input type="text" id="p_note" placeholder="e.g. Paid extra on installment #' + instNum + '"></div>' +
    '<div class="kv-grid" style="margin-top:4px"><div class="kv"><div class="k">This installment</div><div class="v">' + fmtMoney(instAmount) + '</div></div>' +
    '<div class="kv"><div class="k">Last installment</div><div class="v">' + fmtMoney(lastAmt) + '</div></div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="applyInstPlus(' + id + ',' + instNum + ')">✓ Add Payment</button>');
}

function applyInstPlus(id, instNum) {
  const c = getCustomer(id);
  if (!c) return;
  const date = wVal('p_date');
  const amount = parseFloat(wVal('p_amount'));
  const note = wVal('p_note').trim();
  if (!date) { toast('Please pick a date.', 'err'); return; }
  if (!(amount > 0)) { toast('Enter a valid amount.', 'err'); return; }
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  if (!cust) return;

  const insts = installmentsOf(cust);
  const idx = insts.findIndex(function (x) { return x.i === instNum; });
  if (idx < 0) { toast('Installment not found.', 'err'); return; }
  const original = insts[idx].amount;
  const extra = round2(Math.max(0, amount - original));

  /* move the extra from the tail (last installment backwards) */
  if (extra > 0) {
    let left = extra;
    for (let k = insts.length - 1; k >= 0 && left > 0.005; k--) {
      if (k === idx) continue;
      const take = Math.min(insts[k].amount, left);
      insts[k].amount = round2(insts[k].amount - take);
      left = round2(left - take);
    }
    insts[idx].amount = round2(original + extra);
  }
  storeInstallments(cust, insts);

  recordPayment(cust, data, date, amount, note || ('Paid on installment #' + instNum));
  Store.saveData(data);
  closeModal();
  toast('Payment of ' + fmtMoney(amount) + ' added, schedule updated.', 'ok');
  render();
}

/* − button: ask what happened — discount, or the customer paid less than usual. */
function openInstMinusModal(id, instNum, instAmount) {
  const c = getCustomer(id);
  if (!c) return;
  openModal('Installment #' + instNum + ' · ' + c.name,
    '<div class="modal-notice">This installment is <b>' + fmtMoney(instAmount) + '</b>. What would you like to do?</div>' +
    '<div class="choice-grid">' +
    '<button class="choice-card" onclick="openPaidLessModal(' + id + ',' + instNum + ',' + instAmount + ')">' +
    '<span class="choice-icon">💳</span><span class="choice-txt"><b>Customer paid less</b><small>The unpaid part moves to the end of the schedule.</small></span></button>' +
    '<button class="choice-card" onclick="openDiscountModal(' + id + ',' + instNum + ',' + instAmount + ')">' +
    '<span class="choice-icon">🏷️</span><span class="choice-txt"><b>Apply a discount</b><small>Reduce this installment or the whole plan.</small></span></button>' +
    '</div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>');
}

/* − "paid less": e.g. installment is 100, they pay 75 → installment becomes 75 and a new
   last installment of 25 appears, so the rest stays due later. Records the payment too. */
function openPaidLessModal(id, instNum, instAmount) {
  const c = getCustomer(id);
  if (!c) return;
  openModal('Paid Less — Installment #' + instNum + ' · ' + c.name,
    '<div class="modal-notice">💡 Installment #' + instNum + ' is <b>' + fmtMoney(instAmount) + '</b> — if the customer pays less, the <b>unpaid part is moved to the end</b> of the schedule.</div>' +
    '<div class="field-row">' +
    '<div class="field"><label>Date</label><input type="date" id="p_date" value="' + todayISO() + '"></div>' +
    '<div class="field"><label>Amount actually paid</label><input type="number" id="p_amount" min="0" step="0.01" value="' + instAmount + '"></div>' +
    '</div>' +
    '<div class="field"><label>Note <span class="opt">optional</span></label><input type="text" id="p_note" placeholder="e.g. Paid 75 of 100"></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="applyPaidLess(' + id + ',' + instNum + ')">✓ Save</button>');
}

function applyPaidLess(id, instNum) {
  const c = getCustomer(id);
  if (!c) return;
  const date = wVal('p_date');
  const amount = parseFloat(wVal('p_amount'));
  const note = wVal('p_note').trim();
  if (!date) { toast('Please pick a date.', 'err'); return; }
  if (!(amount >= 0)) { toast('Enter a valid amount.', 'err'); return; }
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  if (!cust) return;

  const insts = installmentsOf(cust);
  const idx = insts.findIndex(function (x) { return x.i === instNum; });
  if (idx < 0) { toast('Installment not found.', 'err'); return; }
  const original = insts[idx].amount;
  if (amount >= original - 0.005) {
    /* they actually paid the full amount — nothing to move */
    recordPayment(cust, data, date, amount, note || ('Payment for installment #' + instNum));
    Store.saveData(data);
    closeModal();
    toast('Payment of ' + fmtMoney(amount) + ' recorded.', 'ok');
    render();
    return;
  }
  const shortfall = round2(original - amount);
  insts[idx].amount = round2(amount);
  if (insts[idx].amount <= 0.005) insts.splice(idx, 1);
  insts.push({ i: 0, due: nextInstallmentDue(cust), amount: shortfall });
  storeInstallments(cust, insts);

  recordPayment(cust, data, date, amount, note || ('Partial payment for installment #' + instNum + ' (moved ' + fmtMoney(shortfall) + ' to the end)'));
  Store.saveData(data);
  closeModal();
  toast('Paid ' + fmtMoney(amount) + ', moved ' + fmtMoney(shortfall) + ' to the end of the schedule.', 'ok');
  render();
}

function recordPayment(cust, data, date, amount, note) {
  const nextId = (cust.payments || []).reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1;
  cust.payments = cust.payments || [];
  cust.payments.push({ id: nextId, date: date, amount: round2(amount), note: note });
  data.logs = state.logs || [];
  const entry = { id: (data.logs.length ? data.logs[data.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: 'payment_recorded', detail: escHtml(cust.name) + ' — ' + escHtml(note) + ' — ' + fmtMoney(amount) };
  data.logs.push(entry);
}

/* Discount on one installment or all installments. */
function openDiscountModal(id, instNum, instAmount) {
  const c = getCustomer(id);
  if (!c) return;
  openModal('Discount — Installment #' + instNum + ' · ' + c.name,
    '<div class="modal-notice">🏷️ A discount reduces the <b>remaining balance</b> — no payment is recorded.</div>' +
    '<div class="field"><label>Applies to</label><select id="d_scope">' +
    '<option value="one">This installment only (#' + instNum + ')</option>' +
    '<option value="all">All installments</option></select></div>' +
    '<div class="field"><label>Discount amount</label><input type="number" id="d_amount" min="0.01" step="0.01" placeholder="0.00"></div>' +
    '<div class="kv-grid" style="margin-top:4px"><div class="kv"><div class="k">This installment</div><div class="v">' + fmtMoney(instAmount) + '</div></div>' +
    '<div class="kv"><div class="k">Remaining balance</div><div class="v">' + fmtMoney(balanceOf(c)) + '</div></div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="addDiscount(' + id + ',' + instNum + ')">✓ Apply Discount</button>');
}

function addDiscount(id, instNum) {
  const c = getCustomer(id);
  if (!c) return;
  const scope = wVal('d_scope');
  const amount = parseFloat(wVal('d_amount'));
  if (!(amount > 0)) { toast('Enter a valid discount amount.', 'err'); return; }
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  if (!cust) return;
  cust.discounts = cust.discounts || [];
  const nextId = cust.discounts.reduce(function (m, d) { return Math.max(m, d.id); }, 0) + 1;
  const discount = { id: nextId, instNum: scope === 'all' ? 0 : instNum, amount: round2(amount), date: todayISO() };
  cust.discounts.push(discount);
  data.logs = state.logs || [];
  const entry = { id: (data.logs.length ? data.logs[data.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: 'discount_applied', detail: escHtml(cust.name) + ' — discount ' + fmtMoney(amount) + (scope === 'all' ? ' (all installments)' : ' (inst #' + instNum + ')') };
  data.logs.push(entry);
  Store.saveData(data);
  closeModal();
  toast('Discount of ' + fmtMoney(amount) + ' applied.', 'ok');
  render();
}

function confirmDeleteDiscount(customerId, discountId) {
  if (!confirm('Remove this discount?')) return;
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === customerId; });
  if (!cust) return;
  cust.discounts = (cust.discounts || []).filter(function (d) { return d.id !== discountId; });
  Store.saveData(data);
  toast('Discount removed.', 'ok');
  render();
}

function toggleInstallmentPayment(customerId, instNum, instAmount, alreadyPaid, checked) {
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === customerId; });
  if (!cust) return;
  if (checked) {
    const remaining = round2(instAmount - alreadyPaid);
    if (remaining <= 0) return;
    const nextId = (cust.payments || []).reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1;
    cust.payments = cust.payments || [];
    cust.payments.push({ id: nextId, date: todayISO(), amount: remaining, note: 'Installment #' + instNum });
    data.logs = state.logs || [];
    const entry = { id: (data.logs.length ? data.logs[data.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: 'payment_recorded', detail: escHtml(cust.name) + ' — Inst #' + instNum + ' — ' + fmtMoney(remaining) };
    data.logs.push(entry);
    Store.saveData(data);
    toast('Installment #' + instNum + ' marked as paid (' + fmtMoney(remaining) + ')', 'ok');
  } else {
    const instPay = (cust.payments || []).slice().reverse().find(function (p) {
      return p.note && p.note.indexOf('Installment #' + instNum) >= 0 && p.date === todayISO();
    });
    if (instPay) {
      cust.payments = cust.payments.filter(function (p) { return p.id !== instPay.id; });
      Store.saveData(data);
      toast('Payment for installment #' + instNum + ' removed', 'ok');
    } else {
      toast('Use the ✕ button in Payment History to remove a manual payment.', 'err');
    }
  }
  render();
}

function addPayment(id) {
  const c = getCustomer(id);
  if (!c) return;
  const date = wVal('p_date');
  const amount = parseFloat(wVal('p_amount'));
  const note = wVal('p_note').trim();
  if (!date) { toast('Select a date.', 'err'); return; }
  if (!(amount > 0)) { toast('Enter a valid amount.', 'err'); return; }
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === id; });
  const nextId = (cust.payments || []).reduce(function (m, p) { return Math.max(m, p.id); }, 0) + 1;
  cust.payments = cust.payments || [];
  cust.payments.push({ id: nextId, date: date, amount: round2(amount), note: note });
  Store.saveData(data);
  closeModal();
  logAction('payment_recorded', escHtml(c.name) + ' — ' + fmtMoney(amount));
  toast('Payment recorded.', 'ok');
  render();
}

function confirmDeletePayment(customerId, paymentId) {
  if (!confirm('Delete this payment record? This cannot be undone.')) return;
  const data = Store.getData();
  const cust = data.customers.find(function (x) { return x.id === customerId; });
  if (cust) {
    cust.payments = (cust.payments || []).filter(function (p) { return p.id !== paymentId; });
    data.logs = state.logs || [];
    const entry = { id: (data.logs.length ? data.logs[data.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: 'payment_deleted', detail: 'Payment #' + paymentId + ' from ' + (cust.name || 'customer #' + customerId) };
    data.logs.push(entry);
    Store.saveData(data);
  }
  toast('Payment deleted.', 'ok');
  render();
}

function openEditModal(id) {
  const c = getCustomer(id);
  if (!c) return;
  const planEditable = (c.payments || []).every(function (p) { return p.auto === true; });
  const plan = c.plan;
  let planFields = '';
  if (planEditable && plan.type !== 'cash') {
    planFields =
      '<div class="row"><div class="field"><label>Total Amount</label><input type="number" id="e_total" min="0" step="0.01" value="' + plan.total + '"></div>' +
      '<div class="field"><label>Down Payment</label><input type="number" id="e_down" min="0" step="0.01" value="' + plan.down + '"></div></div>' +
      '<div class="row"><div class="field"><label>Start Date</label><input type="date" id="e_start" value="' + plan.startDate + '"></div>' +
      '<div class="field"><label>Number of Installments</label><input type="number" id="e_count" min="1" step="1" value="' + plan.count + '"></div></div>' +
      '<div class="field"><label>Frequency</label>' +
      '<div class="seg">' +
      '<button type="button" id="seg-w" class="' + (plan.frequency === 'weekly' ? 'on' : '') + '" onclick="editPickFreq(\'weekly\')">Weekly</button>' +
      '<button type="button" id="seg-m" class="' + (plan.frequency === 'monthly' ? 'on' : '') + '" onclick="editPickFreq(\'monthly\')">Monthly</button>' +
      '</div></div>';
  } else if (planEditable && plan.type === 'cash') {
    planFields = '<p class="muted" style="font-size:13px">This customer was recorded as paid in full (cash).</p>';
  }
  openModal('Edit Customer — ' + c.name,
    '<div class="field"><label>Full Name</label><input type="text" id="e_name" value="' + escAttr(c.name) + '"></div>' +
    '<div class="field"><label>Notes</label><textarea id="e_notes">' + escHtml(c.notes || '') + '</textarea></div>' +
    (planFields ? '<hr style="border:none;border-top:1px solid var(--border);margin:18px 0">' +
      '<div class="field"><label>Payment Plan' + (planEditable ? '' : ' <span class="hint">(locked — payments exist)</span>') + '</label></div>' +
      planFields : ''),
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveEdit(' + id + ')">✓ Save Changes</button>', true);
  window._editFreq = plan.frequency;
}

function editPickFreq(f) {
  window._editFreq = f;
  $('#seg-w').classList.toggle('on', f === 'weekly');
  $('#seg-m').classList.toggle('on', f === 'monthly');
}

function saveEdit(id) {
  const data = Store.getData();
  const c = data.customers.find(function (x) { return x.id === id; });
  if (!c) return;
  const name = wVal('e_name').trim();
  if (!name) { toast('Name is required.', 'err'); return; }
  c.name = name;
  c.notes = wVal('e_notes').trim();

  const planEditable = (c.payments || []).every(function (p) { return p.auto === true; });
  if (planEditable && c.plan.type !== 'cash') {
    const total = parseFloat(wVal('e_total'));
    const down = wVal('e_down') === '' ? 0 : parseFloat(wVal('e_down'));
    const start = wVal('e_start');
    const count = parseInt(wVal('e_count'), 10);
    const freq = window._editFreq || c.plan.frequency;
    if (!(total > 0)) { toast('Enter a valid total.', 'err'); return; }
    if (isNaN(down) || down < 0) { toast('Down payment must be 0 or more.', 'err'); return; }
    if (down >= total) { toast('Down payment must be less than the total.', 'err'); return; }
    if (!start) { toast('Select a start date.', 'err'); return; }
    if (!(count >= 1)) { toast('Enter the number of installments.', 'err'); return; }
    c.plan.total = round2(total);
    c.plan.down = round2(down);
    c.plan.startDate = start;
    c.plan.count = count;
    c.plan.frequency = freq;
    c.plan.amountPerInstallment = round2((total - down) / count);
    const autoPay = (c.payments || []).find(function (p) { return p.auto === true; });
    if (autoPay) autoPay.amount = round2(down);
  }
  Store.saveData(data);
  closeModal();
  logAction('customer_edited', escHtml(c.name));
  toast('Changes saved.', 'ok');
  render();
}

function confirmDeleteCustomer(id) {
  const c = getCustomer(id);
  if (!c) return;
  if (!confirm('Delete customer "' + c.name + '" and all their records? This cannot be undone.')) return;
  const data = Store.getData();
  data.customers = data.customers.filter(function (x) { return x.id !== id; });
  data.logs = state.logs || [];
  const entry = { id: (data.logs.length ? data.logs[data.logs.length - 1].id : 0) + 1, date: new Date().toISOString(), type: 'customer_deleted', detail: escHtml(c.name) };
  data.logs.push(entry);
  Store.saveData(data);
  toast('Customer deleted.', 'ok');
  navigate('customers');
}

/* ============================================================
   EXPORTS
   ============================================================ */
function exportCustomerPdf(id) {
  const c = getCustomer(id);
  if (!c) return;
  const data = Store.getData();
  const withInst = Object.assign({}, c, {
    installments: effectiveInstallments(c),
    discounts: discountsOf(c),
    today: todayISO(),
    statementDate: todayISO()
  });
  const blob = PDF.buildStatement(withInst, data.settings);
  PDF.download(blob, 'statement_customer_' + c.id + '_' + todayISO() + '.pdf');
  logAction('export_pdf', escHtml(c.name));
  toast('Statement PDF downloaded.', 'ok');
}

function exportExcel() {
  const data = Store.getData();
  Excel.exportAll(data, data.settings);
  logAction('export_excel', data.customers.length + ' customer(s) exported');
  toast('Excel file downloaded.', 'ok');
}

/* ============================================================
   REPORTS
   ============================================================ */
function renderReports() {
  let collected = 0, outstanding = 0;
  visibleCustomers().forEach(function (c) {
    collected += paidOf(c);
    outstanding += balanceOf(c);
  });
  $('#content').innerHTML =
    '<div class="stat-grid">' +
    statCardCount('ico-teal', '👥', 'Total Customers', state.customers.length, '', state.customers.length, false) +
    statCardCount('ico-blue', '💰', 'Amount Collected', fmtMoney(collected), '', collected, true) +
    statCardCount('ico-amber', '📌', 'Outstanding Balance', fmtMoney(outstanding), '', outstanding, true) +
    '</div>' +
    '<div class="settings-grid">' +
    '<div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Export to Excel</h3><p class="desc">Download all customer data and all installment payments as Excel-compatible files (CSV).</p>' +
    '<button class="btn btn-primary" onclick="exportExcel()">⬇ Export All Data to Excel</button>' +
    '<p class="muted mt" style="font-size:12.5px">Two files are downloaded: <b>customers</b> and <b>payments</b>. They open directly in Excel.</p>' +
    '</div></div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Statement PDF per customer</h3><p class="desc">Open any customer page and click <b>“Statement PDF”</b> for a professional, printable statement.</p>' +
    '</div></div>' +
    '</div>' +
    '<div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Backup & Restore</h3><p class="desc">Keep a safe copy of all your data as a JSON file, or restore from a previous backup.</p>' +
    '<div class="flex mb"><button class="btn btn-secondary" onclick="backupJson()">⬇ Download Backup</button>' +
    '<button class="btn btn-secondary" onclick="document.getElementById(\'restore-file\').click()">⬆ Restore Backup</button>' +
    '<input type="file" id="restore-file" accept=".json" style="display:none" onchange="restoreJson(event)"></div>' +
    '</div></div>' +
    '</div>' +
    '</div>';

  animateStats($('#content'));
}

function backupJson() {
  const data = Store.getData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  PDF.download(blob, 'installments_ledger_backup_' + todayISO() + '.json');
  toast('Backup downloaded.', 'ok');
}

function restoreJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = JSON.parse(reader.result);
      if (!data.customers || !Array.isArray(data.customers)) throw new Error('bad file');
      if (!data.settings) data.settings = { businessName: 'My Business', businessPhone: '', businessAddress: '', currency: '$' };
      if (!confirm('This will replace ALL current data with the backup. Continue?')) return;
      Store.saveData(data);
      toast('Backup restored successfully.', 'ok');
      render();
    } catch (e) {
      toast('Invalid backup file.', 'err');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* ============================================================
   ADMIN PANEL
   ============================================================ */
async function renderAdmin() {
  if (!Store.isAdmin()) { navigate('dashboard'); return; }
  let users = [], roles = [];
  try {
    users = await Sync.listUsers();
    roles = await Sync.fetchRoles();
    Store.saveRoles(roles);
  } catch (e) {
    $('#content').innerHTML = '<div class="panel"><div class="set-section"><h3>Admin Panel</h3><p class="muted">Could not load users — check connection.</p></div></div>';
    return;
  }

  const statusBadge = function (st) {
    const map = { approved: 'badge-paid', pending: 'badge-due', blocked: 'badge-overdue' };
    return '<span class="badge ' + (map[st] || 'badge-muted') + '">' + (st || '—') + '</span>';
  };

  const roleOpts = '<option value="">— none —</option>' + roles.map(function (r) {
    return '<option value="' + escAttr(r.name) + '">' + escHtml(r.name) + '</option>';
  }).join('');

  const rows = users.map(function (u) {
    const isSelf = u.username === Store.currentUser();
    const adminBtn = '<button class="btn btn-secondary btn-sm" onclick="adminToggleAdmin(\'' + escAttr(u.username) + '\',' + (u.is_admin ? 0 : 1) + ')">' + (u.is_admin ? 'Remove admin' : 'Make admin') + '</button>';
    const approveBtn = u.status === 'approved'
      ? '<button class="btn btn-danger btn-sm" onclick="adminBlock(\'' + escAttr(u.username) + '\')">Block</button>'
      : '<button class="btn btn-primary btn-sm" onclick="adminApprove(\'' + escAttr(u.username) + '\')">' + (u.status === 'pending' ? 'Approve' : 'Unblock') + '</button>';
    return '<tr>' +
      '<td data-label="User"><b>' + escHtml(u.username) + '</b>' + (u.is_admin ? ' <span class="badge badge-cash">Admin</span>' : '') + (isSelf ? ' <span class="badge badge-muted">you</span>' : '') + '</td>' +
      '<td data-label="Status">' + statusBadge(u.status) + '</td>' +
      '<td data-label="Role"><select onchange="adminSetRole(\'' + escAttr(u.username) + '\',this.value)">' +
      '<option value="">— none —</option>' + roles.map(function (r) {
        return '<option value="' + escAttr(r.name) + '"' + (u.role === r.name ? ' selected' : '') + '>' + escHtml(r.name) + '</option>';
      }).join('') + '</select></td>' +
      '<td data-label="Actions" class="admin-actions">' + approveBtn + adminBtn +
      (isSelf ? '' : '<button class="btn btn-danger btn-sm" onclick="adminDelete(\'' + escAttr(u.username) + '\')">🗑</button>') +
      '</td>' +
      '</tr>';
  }).join('');

  const roleRows = roles.map(function (r) {
    const kindLabel = r.kind === 'pages' ? 'Pages' : 'Customers';
    const colors = typeof r.colors === 'string' ? parseJsonArr(r.colors) : (r.colors || []);
    const pages = typeof r.pages === 'string' ? parseJsonArr(r.pages) : (r.pages || []);
    const detail = r.kind === 'pages' ? pages.join(', ') : colors.join(', ');
    return '<tr>' +
      '<td data-label="Role"><b>' + escHtml(r.name) + '</b></td>' +
      '<td data-label="Controls"><span class="badge ' + (r.kind === 'pages' ? 'badge-install' : 'badge-cash') + '">' + kindLabel + '</span></td>' +
      '<td data-label="Visibility" class="muted">' + escHtml(detail || 'All') + '</td>' +
      '<td data-label="Actions" class="admin-actions">' +
      '<button class="btn btn-secondary btn-sm" onclick="adminEditRole(\'' + escAttr(r.name) + '\')">Edit</button>' +
      '<button class="btn btn-danger btn-sm" onclick="adminDeleteRole(\'' + escAttr(r.name) + '\')">🗑</button>' +
      '</td></tr>';
  }).join('');

  $('#content').innerHTML =
    '<div class="toolbar"><h2 style="font-family:var(--font-serif);color:var(--gold-2)">🛡 Admin Panel</h2></div>' +
    '<div class="settings-grid">' +
    '<div>' +
    '<div class="panel"><div class="panel-head"><h3>User Accounts</h3>' +
    '<button class="btn btn-secondary btn-sm" onclick="adminRefresh()">⟳ Refresh</button></div>' +
    '<div class="tbl-wrap"><table class="tbl">' +
    '<thead><tr><th>User</th><th>Status</th><th>Role</th><th>Actions</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="4" style="text-align:center;color:var(--muted-2);padding:30px">No users yet.</td></tr>') +
    '</tbody></table></div></div>' +
    '<div class="panel"><div class="panel-head"><h3>Roles</h3>' +
    '<button class="btn btn-primary btn-sm" onclick="adminNewRole()">+ New Role</button></div>' +
    '<div class="tbl-wrap"><table class="tbl">' +
    '<thead><tr><th>Role</th><th>Controls</th><th>Visibility</th><th>Actions</th></tr></thead>' +
    '<tbody>' + (roleRows || '<tr><td colspan="4" style="text-align:center;color:var(--muted-2);padding:30px">No roles yet.</td></tr>') +
    '</tbody></table></div></div>' +
    '</div>' +
    '<div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>How roles work</h3>' +
    '<p class="desc" style="margin-bottom:10px">Roles control what a user can see.</p>' +
    '<div class="dz-item"><div><b>Customers role</b><small>User only sees customers in the chosen colors (pink / gold / silver).</small></div></div>' +
    '<div class="dz-item"><div><b>Pages role</b><small>User only sees the chosen pages in the menu.</small></div></div>' +
    '<div class="dz-item"><div><b>Admins</b><small>Admins see everything and can manage users.</small></div></div>' +
    '<p class="muted" style="font-size:12.5px;margin-top:12px">Sign-ups land as <b>pending</b> until you approve them. Blocked users cannot sign in.</p>' +
    '</div></div>' +
    '</div>' +
    '</div>';
}

async function adminRefresh() { renderAdmin(); }

async function adminApprove(username) {
  try { await Sync.approveUser(username, null); toast(username + ' approved.', 'ok'); renderAdmin(); }
  catch (e) { toast(e.message, 'err'); }
}

async function adminBlock(username) {
  try { await Sync.blockUser(username, true); toast(username + ' blocked.', 'ok'); renderAdmin(); }
  catch (e) { toast(e.message, 'err'); }
}

async function adminToggleAdmin(username, makeAdmin) {
  try { await Sync.setUserAdmin(username, !!makeAdmin); toast(username + (makeAdmin ? ' is now admin.' : ' is no longer admin.'), 'ok'); renderAdmin(); }
  catch (e) { toast(e.message, 'err'); }
}

async function adminSetRole(username, role) {
  try { await Sync.setUserRole(username, role); toast('Role updated.', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
}

async function adminDelete(username) {
  if (!confirm('Delete user "' + username + '"?')) return;
  try { await Sync.deleteUser(username); toast('User deleted.', 'ok'); renderAdmin(); }
  catch (e) { toast(e.message, 'err'); }
}

function adminNewRole() {
  openModal('New Role',
    '<div class="field"><label>Role Name</label><input type="text" id="r_name" placeholder="e.g. Pink Customers"></div>' +
    '<div class="field"><label>Controls</label><select id="r_kind">' +
    '<option value="customers">Customers (by color)</option>' +
    '<option value="pages">Pages</option></select></div>' +
    '<div class="field" id="r_colorsField"><label>Allowed colors</label><select id="r_colors" multiple size="3">' +
    '<option value="pink" selected>Pink</option><option value="gold" selected>Gold</option><option value="silver" selected>Silver</option></select></div>' +
    '<div class="field" id="r_pagesField" style="display:none"><label>Allowed pages</label><select id="r_pages" multiple size="5">' +
    '<option value="dashboard" selected>Dashboard</option><option value="customers" selected>Customers</option>' +
    '<option value="reports">Reports</option><option value="logs">Logs</option><option value="settings">Settings</option></select></div>' +
    '<div class="field"><label>Select all colors / pages you want this role to see.</label></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="adminSaveRole()">Create Role</button>');
  const kind = $('#r_kind');
  kind.onchange = function () {
    $('#r_colorsField').style.display = kind.value === 'customers' ? '' : 'none';
    $('#r_pagesField').style.display = kind.value === 'pages' ? '' : 'none';
  };
}

function adminEditRole(name) {
  const roles = Store.getRoles();
  const role = roles.find(function (r) { return r.name === name; });
  if (!role) return;
  const colors = typeof role.colors === 'string' ? parseJsonArr(role.colors) : (role.colors || []);
  const pages = typeof role.pages === 'string' ? parseJsonArr(role.pages) : (role.pages || []);
  openModal('Edit Role',
    '<div class="field"><label>Role Name</label><input type="text" id="r_name" value="' + escAttr(role.name) + '"></div>' +
    '<div class="field"><label>Controls</label><select id="r_kind">' +
    '<option value="customers"' + (role.kind !== 'pages' ? ' selected' : '') + '>Customers (by color)</option>' +
    '<option value="pages"' + (role.kind === 'pages' ? ' selected' : '') + '>Pages</option></select></div>' +
    '<div class="field" id="r_colorsField"><label>Allowed colors</label><select id="r_colors" multiple size="3">' +
    ['pink', 'gold', 'silver'].map(function (c) {
      return '<option value="' + c + '"' + (colors.indexOf(c) >= 0 ? ' selected' : '') + '>' + c + '</option>';
    }).join('') + '</select></div>' +
    '<div class="field" id="r_pagesField"><label>Allowed pages</label><select id="r_pages" multiple size="5">' +
    ['dashboard', 'customers', 'reports', 'logs', 'settings'].map(function (p) {
      return '<option value="' + p + '"' + (pages.indexOf(p) >= 0 ? ' selected' : '') + '>' + p + '</option>';
    }).join('') + '</select></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="adminSaveRole(true,\'' + escAttr(role.name) + '\')">Save</button>');
  const kind = $('#r_kind');
  kind.onchange = function () {
    $('#r_colorsField').style.display = kind.value === 'customers' ? '' : 'none';
    $('#r_pagesField').style.display = kind.value === 'pages' ? '' : 'none';
  };
  kind.onchange();
}

async function adminSaveRole(editing, oldName) {
  const name = $('#r_name').value.trim();
  if (!name) { toast('Role name required.', 'err'); return; }
  const kind = $('#r_kind').value;
  const colors = kind === 'customers'
    ? Array.from($('#r_colors').selectedOptions || []).map(function (o) { return o.value; })
    : [];
  const pages = kind === 'pages'
    ? Array.from($('#r_pages').selectedOptions || []).map(function (o) { return o.value; })
    : [];
  try {
    if (editing && oldName && oldName !== name) {
      await Sync.deleteRole(oldName);
    }
    await Sync.upsertRole({ name: name, kind: kind, colors: JSON.stringify(colors), pages: JSON.stringify(pages) });
    closeModal();
    toast('Role saved.', 'ok');
    renderAdmin();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function adminDeleteRole(name) {
  if (!confirm('Delete role "' + name + '"?')) return;
  try { await Sync.deleteRole(name); toast('Role deleted.', 'ok'); renderAdmin(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  const s = state.settings;
  $('#content').innerHTML =
    '<div class="settings-grid">' +
    '<div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Business Information</h3><p class="desc">Shown on the PDF statements.</p>' +
    '<div class="field"><label>Business Name</label><input type="text" id="s_name" value="' + escAttr(s.businessName) + '"></div>' +
    '<div class="row"><div class="field"><label>Phone</label><input type="text" id="s_phone" value="' + escAttr(s.businessPhone || '') + '"></div>' +
    '<div class="field"><label>Address</label><input type="text" id="s_address" value="' + escAttr(s.businessAddress || '') + '"></div></div>' +
    '<div class="field"><label>Currency Symbol</label><input type="text" id="s_currency" maxlength="6" value="' + escAttr(s.currency) + '" placeholder="$"></div>' +
    '<button class="btn btn-primary" onclick="saveSettings()">✓ Save Settings</button>' +
    '</div></div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Change Password</h3><p class="desc">Update your admin password.</p>' +
    '<div class="field"><label>Current Password</label><input type="password" id="s_old" autocomplete="current-password"></div>' +
    '<div class="row"><div class="field"><label>New Password</label><input type="password" id="s_new" autocomplete="new-password"></div>' +
    '<div class="field"><label>Confirm New Password</label><input type="password" id="s_new2" autocomplete="new-password"></div></div>' +
    '<button class="btn btn-secondary" onclick="changePassword()">Update Password</button>' +
    '</div></div>' +
    '</div>' +
    '<div>' +
    '<div class="panel danger-zone"><div class="set-section">' +
    '<h3>Account</h3><p class="desc">Signed in as <b>' + escHtml(Store.currentUser()) + '</b></p>' +
    '<div class="dz-item"><div><b>Sign out</b><small>Lock this ledger until you sign in again.</small></div>' +
    '<button class="btn btn-secondary btn-sm" onclick="doLogout()">Sign out</button></div>' +
    '</div></div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>Cloud Sync</h3><p class="desc">Keeps your encrypted ledger in sync across devices via Supabase.</p>' +
    '<div class="dz-item"><div><b>Status</b><small id="sync-status">' + escHtml(Sync.getStatusText()) + '</small></div>' +
    '<button class="btn btn-secondary btn-sm" onclick="manualSync()">Sync Now</button></div>' +
    '</div></div>' +
    '<div class="panel danger-zone"><div class="set-section">' +
    '<h3>Danger Zone</h3><p class="desc">These actions cannot be undone.</p>' +
    '<div class="dz-item"><div><b>Reset all customer data</b><small>Deletes every customer and payment.</small></div>' +
    '<button class="btn btn-danger btn-sm" onclick="resetAll()">Reset</button></div>' +
    '</div></div>' +
    '<div class="panel"><div class="set-section">' +
    '<h3>About</h3><p class="desc">MHD ABO SALEM — Installments Ledger v1.2</p>' +
    '<p class="muted" style="font-size:12.5px">All data is encrypted on this device (AES-256) and can only be unlocked with your password. Cloud sync keeps the encrypted data in sync across your devices.</p>' +
    '</div></div>' +
    '</div>' +
    '</div>';
}

function saveSettings() {
  const data = Store.getData();
  data.settings = {
    businessName: wVal('s_name').trim() || 'My Business',
    businessPhone: wVal('s_phone').trim(),
    businessAddress: wVal('s_address').trim(),
    currency: wVal('s_currency').trim() || '$'
  };
  Store.saveData(data);
  logAction('settings_changed', 'Business info updated');
  toast('Settings saved.', 'ok');
  render();
}

async function manualSync() {
  const btn = document.getElementById('sync-status');
  if (btn) btn.textContent = 'Syncing…';
  try {
    await Sync.push();
    if (btn) btn.textContent = Sync.getStatusText();
    toast('Cloud sync complete.', 'ok');
  } catch (e) {
    if (btn) btn.textContent = 'Sync failed';
    toast('Sync failed — check connection and Supabase setup.', 'err');
  }
}

async function changePassword() {
  const oldP = wVal('s_old');
  const np = wVal('s_new');
  const np2 = wVal('s_new2');
  if (np !== np2) { toast('New passwords do not match.', 'err'); return; }
  try {
    await Store.changePassword(oldP, np);
    toast('Password updated.', 'ok');
    render();
  } catch (e) {
    toast(e.message || 'Password update failed.', 'err');
  }
}

function resetAll() {
  if (!confirm('Delete ALL customers and payments? This cannot be undone.')) return;
  const data = Store.getData();
  data.customers = [];
  Store.saveData(data);
  toast('All customer data cleared.', 'ok');
  render();
}

/* ============================================================
   SECURITY GUARDS (deterrents — data is encrypted at rest)
   ============================================================ */
function installSecurityGuards() {
  document.addEventListener('contextmenu', function (e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    e.preventDefault();
  });
  document.addEventListener('keydown', function (e) {
    const key = e.keyCode || e.which;
    const hotkeys = [123]; /* F12 */
    if (e.ctrlKey && e.shiftKey) hotkeys.push(73, 74, 67, 75); /* I, J, C, K */
    if (e.ctrlKey && !e.shiftKey && !e.altKey) hotkeys.push(83); /* S */
    if ((e.metaKey && e.altKey) || (e.ctrlKey && e.altKey)) hotkeys.push(73, 75);
    if (hotkeys.indexOf(key) >= 0 && !e.repeat) {
      e.preventDefault();
      toast('Developer tools are disabled in this ledger.', 'err');
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */
window.addEventListener('DOMContentLoaded', function () {
  installSecurityGuards();
  window.addEventListener('hashchange', renderWithTransition);
  /* After any local save, push the encrypted data to the cloud. */
  Store.setOnSave(function () { Sync.schedulePush(); });
  (async function () {
    try {
      const ok = await Store.restoreSession();
      if (ok && Store.currentUser()) {
        render();
        Sync.syncAfterAuth();
      } else renderLogin();
    } catch (e) {
      renderLogin();
    }
  })();
});
