'use strict';

/* ============================================================
   sync.js — Cloud sync via Supabase REST
   Stores ALL data in plain Supabase tables (readable from
   the dashboard) plus keeps an encrypted vault as backup.
   ============================================================ */

const Sync = (function () {

  /* ------ environment detection ------ */
  const _isLocal = (function () {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' ||
           window.location.protocol === 'file:';
  })();

  const CFG = {
    url: _isLocal
      ? 'https://cgaopjqydylfhkgnqegf.supabase.co/rest/v1'
      : '/api/supabase',
    key: 'sb_publishable_PZ5hmsfJLG8_Ox9Bdd2Nyg_9NSgeFwk',
    tables: {
      vaults:       'il_vaults',
      users:        'il_users',
      roles:        'il_roles',
      settings:     'il_settings',
      customers:    'il_customers',
      installments: 'il_installments',
      payments:     'il_payments',
      discounts:    'il_discounts',
      logs:         'il_logs'
    }
  };

  function apiPath(table) { return CFG.url + '/' + table; }

  let pushTimer = null;
  let lastStatus = 'Cloud sync ready';

  /* ------ helpers ------ */

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
    const el = document.getElementById('sync-status');
    if (el) el.textContent = text;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { headers: authHeaders() });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function upsertRows(table, rows) {
    if (!rows || !rows.length) return;
    const headers = Object.assign({}, authHeaders(), { Prefer: 'resolution=merge-duplicates' });
    const r = await fetch(apiPath(table), {
      method: 'POST', headers, body: JSON.stringify(rows)
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('Upsert ' + table + ' failed: ' + r.status + ' ' + txt);
    }
  }

  async function deleteWhere(table, filter) {
    try {
      await fetch(apiPath(table) + '?' + filter, {
        method: 'DELETE', headers: authHeaders()
      });
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     VAULT (encrypted backup — used for auth key delivery)
     ============================================================ */

  async function fetchMasterVault() {
    const rows = await fetchJson(
      apiPath(CFG.tables.vaults) + '?owner=eq.master&select=*&limit=1'
    );
    return rows && rows.length ? rows[0] : null;
  }

  async function pushMasterVault(payload, rev, encSalt) {
    const rec = {
      owner: 'master',
      enc_salt: encSalt || '',
      payload,
      rev,
      updated_at: new Date().toISOString()
    };
    const headers = Object.assign({}, authHeaders(), { Prefer: 'resolution=merge-duplicates' });
    const r = await fetch(apiPath(CFG.tables.vaults), {
      method: 'POST', headers, body: JSON.stringify([rec])
    });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error('Vault push failed: ' + r.status + ' ' + txt);
    }
  }

  /* ============================================================
     USERS
     ============================================================ */

  async function fetchUser(username) {
    const rows = await fetchJson(
      apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username) +
      '&select=*&limit=1'
    );
    return rows && rows.length ? rows[0] : null;
  }

  async function listUsers() {
    return await fetchJson(
      apiPath(CFG.tables.users) + '?select=*&order=created_at.desc'
    ) || [];
  }

  async function upsertUser(rec) {
    const row = {
      username:    rec.username,
      pass_hash:   rec.passHash,
      salt:        rec.salt,
      enc_salt:    rec.encSalt,
      pubkey:      rec.pubkey,
      privkey_enc: rec.privkeyEnc,
      wrapped_key: rec.wrappedKey || '',
      role:        rec.role       || '',
      is_admin:    !!rec.isAdmin,
      status:      rec.status     || 'pending',
      created_at:  rec.created    || new Date().toISOString()
    };
    const headers = Object.assign({}, authHeaders(), { Prefer: 'resolution=merge-duplicates' });
    await fetch(apiPath(CFG.tables.users), {
      method: 'POST', headers, body: JSON.stringify([row])
    });
  }

  async function updateUser(username, patch) {
    await fetch(
      apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username),
      { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) }
    );
  }

  async function deleteUser(username) {
    await fetch(
      apiPath(CFG.tables.users) + '?username=eq.' + encodeURIComponent(username),
      { method: 'DELETE', headers: authHeaders() }
    );
  }

  /* ============================================================
     ROLES
     ============================================================ */

  async function fetchRoles() {
    return await fetchJson(apiPath(CFG.tables.roles) + '?select=*') || [];
  }

  async function upsertRole(rec) {
    const headers = Object.assign({}, authHeaders(), { Prefer: 'resolution=merge-duplicates' });
    await fetch(apiPath(CFG.tables.roles), {
      method: 'POST', headers, body: JSON.stringify([rec])
    });
  }

  async function deleteRole(name) {
    await fetch(
      apiPath(CFG.tables.roles) + '?name=eq.' + encodeURIComponent(name),
      { method: 'DELETE', headers: authHeaders() }
    );
  }

  /* ============================================================
     BUSINESS DATA — push to individual plain tables
     ============================================================ */

  async function pushBusinessData(data) {
    if (!data) return;
    const customers = data.customers || [];
    const settings  = data.settings  || {};
    const logs      = data.logs      || [];

    /* --- Settings (4 key-value rows) --- */
    await upsertRows(CFG.tables.settings, [
      { key: 'businessName',    value: settings.businessName    || '' },
      { key: 'businessPhone',   value: settings.businessPhone   || '' },
      { key: 'businessAddress', value: settings.businessAddress || '' },
      { key: 'currency',        value: settings.currency        || '$' }
    ]);

    /* --- Customers: remove deleted, upsert current --- */
    if (customers.length > 0) {
      await deleteWhere(CFG.tables.customers,
        'id=not.in.(' + customers.map(function (c) { return c.id; }).join(',') + ')'
      );
    } else {
      await deleteWhere(CFG.tables.customers, 'id=gt.0');
    }

    if (customers.length > 0) {
      await upsertRows(CFG.tables.customers, customers.map(function (c) {
        return {
          id:                   c.id,
          name:                 c.name,
          notes:                c.notes || '',
          cat:                  c.cat   || 'gold',
          plan_type:            c.plan.type,
          plan_total:           c.plan.total,
          plan_down:            c.plan.down            || 0,
          plan_start_date:      c.plan.startDate       || '',
          plan_frequency:       c.plan.frequency       || 'monthly',
          plan_count:           c.plan.count           || 0,
          plan_amount_per_inst: c.plan.amountPerInstallment || 0,
          box_total:            c.boxTotal     != null ? c.boxTotal     : null,
          box_paid:             c.boxPaid      != null ? c.boxPaid      : null,
          box_remaining:        c.boxRemaining != null ? c.boxRemaining : null,
          created_at:           c.createdAt    || ''
        };
      }));
    }

    /* --- Child records: wipe then re-insert per customer --- */
    if (customers.length > 0) {
      var ids = customers.map(function (c) { return c.id; }).join(',');
      await deleteWhere(CFG.tables.installments, 'customer_id=in.(' + ids + ')');
      await deleteWhere(CFG.tables.payments,     'customer_id=in.(' + ids + ')');
      await deleteWhere(CFG.tables.discounts,    'customer_id=in.(' + ids + ')');
    }

    var instRows = [], payRows = [], discRows = [];
    customers.forEach(function (c) {
      (c.installments || []).forEach(function (inst) {
        instRows.push({ customer_id: c.id, inst_num: inst.i, due_date: inst.due, amount: inst.amount });
      });
      (c.payments || []).forEach(function (p) {
        payRows.push({ id: p.id, customer_id: c.id, date: p.date, amount: p.amount, note: p.note || '' });
      });
      (c.discounts || []).forEach(function (d) {
        discRows.push({ id: d.id, customer_id: c.id, date: d.date, inst_num: d.instNum || 0, amount: d.amount });
      });
    });

    if (instRows.length > 0) await upsertRows(CFG.tables.installments, instRows);
    if (payRows.length  > 0) await upsertRows(CFG.tables.payments,     payRows);
    if (discRows.length > 0) await upsertRows(CFG.tables.discounts,    discRows);

    /* --- Logs: upsert latest 500 --- */
    if (logs.length > 0) {
      await upsertRows(CFG.tables.logs, logs.slice(-500).map(function (l) {
        return { id: l.id, date: l.date, type: l.type, detail: l.detail || '' };
      }));
    }
  }

  /* ============================================================
     BUSINESS DATA — pull from plain tables
     ============================================================ */

  async function pullBusinessData() {
    var results = await Promise.all([
      fetchJson(apiPath(CFG.tables.settings)     + '?select=*').catch(function () { return []; }),
      fetchJson(apiPath(CFG.tables.customers)    + '?select=*&order=id.asc').catch(function () { return []; }),
      fetchJson(apiPath(CFG.tables.installments) + '?select=*&order=customer_id.asc,inst_num.asc').catch(function () { return []; }),
      fetchJson(apiPath(CFG.tables.payments)     + '?select=*&order=customer_id.asc,date.asc,id.asc').catch(function () { return []; }),
      fetchJson(apiPath(CFG.tables.discounts)    + '?select=*&order=customer_id.asc,id.asc').catch(function () { return []; }),
      fetchJson(apiPath(CFG.tables.logs)         + '?select=*&order=id.asc').catch(function () { return []; })
    ]);

    var settingsRows = results[0] || [];
    var custRows     = results[1] || [];
    var instRows     = results[2] || [];
    var payRows      = results[3] || [];
    var discRows     = results[4] || [];
    var logRows      = results[5] || [];

    /* settings map */
    var sm = {};
    settingsRows.forEach(function (r) { sm[r.key] = r.value; });

    /* customer map */
    var custMap = {};
    custRows.forEach(function (c) {
      custMap[c.id] = {
        id:        c.id,
        name:      c.name,
        notes:     c.notes     || '',
        cat:       c.cat       || 'gold',
        createdAt: c.created_at || '',
        plan: {
          type:                 c.plan_type,
          total:                parseFloat(c.plan_total)           || 0,
          down:                 parseFloat(c.plan_down)            || 0,
          startDate:            c.plan_start_date                  || '',
          frequency:            c.plan_frequency                   || 'monthly',
          count:                parseInt(c.plan_count)             || 0,
          amountPerInstallment: parseFloat(c.plan_amount_per_inst) || 0
        },
        boxTotal:     c.box_total     != null ? parseFloat(c.box_total)     : null,
        boxPaid:      c.box_paid      != null ? parseFloat(c.box_paid)      : null,
        boxRemaining: c.box_remaining != null ? parseFloat(c.box_remaining) : null,
        installments: [],
        payments:     [],
        discounts:    []
      };
    });

    instRows.forEach(function (r) {
      if (custMap[r.customer_id]) {
        custMap[r.customer_id].installments.push({
          i: parseInt(r.inst_num), due: r.due_date, amount: parseFloat(r.amount)
        });
      }
    });
    payRows.forEach(function (r) {
      if (custMap[r.customer_id]) {
        custMap[r.customer_id].payments.push({
          id: r.id, date: r.date, amount: parseFloat(r.amount), note: r.note || ''
        });
      }
    });
    discRows.forEach(function (r) {
      if (custMap[r.customer_id]) {
        custMap[r.customer_id].discounts.push({
          id: r.id, date: r.date, instNum: parseInt(r.inst_num), amount: parseFloat(r.amount)
        });
      }
    });

    return {
      _populated: settingsRows.length > 0,   /* true = tables have been synced before */
      settings: {
        businessName:    sm.businessName    || 'MHD ABO SALEM',
        businessPhone:   sm.businessPhone   || '',
        businessAddress: sm.businessAddress || '',
        currency:        sm.currency        || '$'
      },
      customers: Object.keys(custMap).map(function (k) { return custMap[k]; }),
      logs: logRows.map(function (l) {
        return { id: parseInt(l.id), date: l.date, type: l.type, detail: l.detail || '' };
      })
    };
  }

  /* ============================================================
     APPROVAL FLOW
     ============================================================ */

  async function approveUser(username, role) {
    var user = await fetchUser(username);
    if (!user) throw new Error('User not found');
    var wrappedKey = await Store.wrapKeyForUser(user.pubkey);
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

  /* ============================================================
     SIGN IN
     ============================================================ */

  async function signInFromCloud(username, password) {
    var user = await fetchUser(username);
    if (!user) return { ok: false, error: 'User not found' };
    if (user.status === 'pending') return { ok: false, error: 'Awaiting admin approval' };
    if (user.status === 'blocked') return { ok: false, error: 'Account blocked by admin' };

    /* validate password + derive session key via vault */
    var vault = await fetchMasterVault();
    var ok = await Store.loginWithUserRec(user, password, vault ? vault.payload : null);
    if (!ok) return { ok: false, error: 'Incorrect password' };

    /* overlay with latest plain-table data (if tables have been populated) */
    try {
      var bizData = await pullBusinessData();
      if (bizData && bizData._populated) {
        delete bizData._populated;
        await Store.importBusinessData(bizData);
      }
    } catch (e) { /* fall back to vault data already loaded */ }

    /* cache roles locally */
    var roles = await fetchRoles();
    Store.saveRoles(roles);

    return { ok: true };
  }

  /* ============================================================
     POST-LOGIN SYNC (background refresh)
     ============================================================ */

  async function syncAfterAuth() {
    try {
      var data = await pullBusinessData();
      if (data && data._populated) {
        delete data._populated;
        await Store.importBusinessData(data);
        updateSyncStatus('Synced from cloud ✓');
        return;
      }
      /* tables not yet populated — try vault */
      var vault = await fetchMasterVault();
      if (vault) {
        await Store.importVaultPayload(vault);
        updateSyncStatus('Synced from vault ✓');
      }
    } catch (e) {
      updateSyncStatus('Sync error: ' + e.message);
    }
  }

  /* ============================================================
     PUSH (triggered after every save)
     ============================================================ */

  async function push() {
    var session = await Store.getSession();
    if (!session || !session.username) return;
    var data = Store.getData();
    if (!data) return;

    /* push to plain tables (primary store) */
    try {
      await pushBusinessData(data);
      updateSyncStatus('Saved to cloud ✓');
    } catch (e) {
      updateSyncStatus('Sync error: ' + e.message);
      throw e;
    }

    /* keep encrypted vault in sync as backup */
    try {
      var vault = await Store.exportVaultPayload();
      if (vault) {
        var remote = await fetchMasterVault();
        var rev = (remote ? Number(remote.rev) : 0) + 1;
        await pushMasterVault(vault.payload, rev);
      }
    } catch (e) { /* non-critical */ }
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1000);
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  return {
    signInFromCloud,
    syncAfterAuth,
    fetchUser, listUsers, upsertUser, updateUser, deleteUser,
    fetchRoles, upsertRole, deleteRole,
    approveUser, blockUser, setUserAdmin, setUserRole,
    fetchMasterVault, pushMasterVault,
    pushBusinessData, pullBusinessData,
    push, schedulePush,
    getStatusText: function () { return lastStatus; }
  };
})();