'use strict';

/* ============================================================
   Sync — cloud sync via Supabase (PostgREST) for shared ledger
   ============================================================ */

const Sync = (function () {
const CFG = {
  url: '/api/supabase',
  key: 'sb_publishable_PZ5hmsfJLG8_Ox9Bdd2Nyg_9NSgeFwk',
  tables: {
    vaults: 'il_vaults',
    users: 'il_users',
    roles: 'il_roles'
  }
};

function apiPath(table) {
  return CFG.url + '/' + table;
}

  let pushTimer = null;
  let lastSyncAt = null;
  let lastStatus = 'Cloud sync ready';

  function authHeaders() {
    return {
      'apikey': CFG.key,
      'Authorization': 'Bearer ' + CFG.key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  function updateSyncStatus(text) {
    lastStatus = text;
    lastSyncAt = Date.now();
    const el = document.getElementById('sync-status');
    if (el) el.textContent = text;
  }

  async function fetchJson(url, opts = {}) {
    const r = await fetch(url, { headers: authHeaders(), ...opts });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Sync failed (' + r.status + ')');
    return r.json();
  }

  /* ---------- Vault (master ledger) ---------- */

  async function fetchMasterVault() {
    const url = apiPath(CFG.tables.vaults) + '?owner=eq.master&select=*&limit=1';
    const rows = await fetchJson(url);
    return rows && rows.length ? rows[0] : null;
  }

  async function upsertMasterVault(rec) {
    const url = apiPath(CFG.tables.vaults);
    const headers = { ...authHeaders(), Prefer: 'resolution=merge-duplicates' };
    await fetch(url, { method: 'POST', headers, body: JSON.stringify([rec]) });
  }

  async function pushMasterVault(payload, rev) {
    const rec = { owner: 'master', payload, rev, updated_at: new Date().toISOString() };
    await upsertMasterVault(rec);
  }

  /* ---------- Users ---------- */

  async function fetchUser(username) {
    const url = apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username) + '&select=*&limit=1';
    const rows = await fetchJson(url);
    return rows && rows.length ? rows[0] : null;
  }

  async function listUsers() {
    const url = apiPath(CFG.tables.users) + '?select=*&order=created_at.desc';
    return await fetchJson(url) || [];
  }

  async function upsertUser(rec) {
    const row = {
      username: rec.username,
      pass_hash: rec.passHash,
      salt: rec.salt,
      enc_salt: rec.encSalt,
      pubkey: rec.pubkey,
      privkey_enc: rec.privkeyEnc,
      wrapped_key: rec.wrappedKey || '',
      role: rec.role || '',
      is_admin: !!rec.isAdmin,
      status: rec.status || 'pending',
      created_at: rec.created || new Date().toISOString()
    };
    const url = apiPath(CFG.tables.users);
    const headers = { ...authHeaders(), Prefer: 'resolution=merge-duplicates' };
    await fetch(url, { method: 'POST', headers, body: JSON.stringify([row]) });
  }

  async function updateUser(username, patch) {
    const url = apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username);
    await fetch(url, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) });
  }

  async function deleteUser(username) {
    const url = apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username);
    await fetch(url, { method: 'DELETE', headers: authHeaders() });
  }

  /* ---------- Roles ---------- */

  async function fetchRoles() {
    const url = apiPath(CFG.tables.roles) + '?select=*';
    return await fetchJson(url) || [];
  }

  async function upsertRole(rec) {
    const url = apiPath(CFG.tables.roles);
    const headers = { ...authHeaders(), Prefer: 'resolution=merge-duplicates' };
    await fetch(url, { method: 'POST', headers, body: JSON.stringify([rec]) });
  }

  async function deleteRole(name) {
    const url = apiPath(CFG.tables.roles) + '?name=eq.' + encodeURIComponent(name);
    await fetch(url, { method: 'DELETE', headers: authHeaders() });
  }

  /* ---------- Approval flow ---------- */

  async function approveUser(username, role) {
    const user = await fetchUser(username);
    if (!user) throw new Error('User not found');
    const wrappedKey = await Store.wrapKeyForUser(user.pubkey);
    await updateUser(username, { wrapped_key: wrappedKey, status: 'approved', role: role || '' });
  }

  async function blockUser(username, block) {
    await updateUser(username, { status: block ? 'blocked' : 'approved' });
  }

  async function setUserAdmin(username, admin) {
    await updateUser(username, { is_admin: admin });
  }

  async function setUserRole(username, role) {
    await updateUser(username, { role: role || '' });
  }

  /* ---------- Sign in ---------- */

  async function signInFromCloud(username, password) {
    const user = await fetchUser(username);
    if (!user) return { ok: false, error: 'User not found' };
    if (user.status === 'pending') return { ok: false, error: 'Awaiting admin approval' };
    if (user.status === 'blocked') return { ok: false, error: 'Account blocked by admin' };

    const vault = await fetchMasterVault();
    if (!vault) return { ok: false, error: 'Master ledger not found' };

    const ok = await Store.loginWithUserRec(user, password, vault.payload);
    if (!ok) return { ok: false, error: 'Incorrect password' };

    // cache roles locally
    const roles = await fetchRoles();
    Store.saveRoles(roles);

    return { ok: true };
  }

  async function syncAfterAuth() {
    try {
      const vault = await fetchMasterVault();
      if (!vault) return;
      const localRev = 0; // we keep it simple, server wins
      if (vault.rev > localRev) {
        await Store.importVaultPayload(vault);
        updateSyncStatus('Synced from cloud');
      }
    } catch (e) {
      updateSyncStatus('Sync error: ' + e.message);
    }
  }

  async function push() {
    const session = await Store.getSession();
    if (!session || !session.username) return;
    const vault = await Store.exportVaultPayload();
    if (!vault) return;
    const remote = await fetchMasterVault();
    const rev = (remote ? Number(remote.rev) : 0) + 1;
    await pushMasterVault(vault.payload, rev);
    updateSyncStatus('Pushed to cloud');
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 500);
  }

  return {
    signInFromCloud,
    syncAfterAuth,
    fetchUser, listUsers, upsertUser, updateUser, deleteUser,
    fetchRoles, upsertRole, deleteRole,
    approveUser, blockUser, setUserAdmin, setUserRole,
    fetchMasterVault, pushMasterVault,
    push, schedulePush,
    getStatusText: () => lastStatus
  };
})();