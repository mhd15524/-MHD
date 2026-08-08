'use strict';

/* ============================================================
   Store — data layer + hardened authentication (shared workspace)
   ------------------------------------------------------------
   Security model:
   • ONE shared ledger (master vault) encrypted with a random
     workspace key (DK). Each approved user holds DK wrapped with
     their RSA public key. Private key encrypted with their
     password-derived AES key. Without the password, nothing readable.
   • Passwords: PBKDF2 (150k iterations) hash + salt stored.
   • Sessions: workspace key in sessionStorage (cleared on tab close).
   ============================================================ */

const Store = (function () {
  const K_USERS = 'il_users';
  const K_DATA = 'il_data';
  const K_SESSION = 'il_session';
  const K_KEY = 'il_key';
  const K_ROLES = 'il_roles';
  const VER = 3;
  const ITER = 150000;
  const SESSION_DAYS = 7;

  let mem = null;
  let memKey = null;
  let writeChain = Promise.resolve();

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ---------- Crypto helpers ---------- */

  function hex(bytes) {
    return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function hexToBytes(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function newSalt() { return hex(crypto.getRandomValues(new Uint8Array(16))); }
  function newToken() { return hex(crypto.getRandomValues(new Uint8Array(24))); }
  function b64(bytes) {
    let s = '';
    const u = new Uint8Array(bytes);
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }
  function b64ToBytes(b) {
    const s = atob(b);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  async function deriveBits(password, saltHex, lenBytes) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('il|' + password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: ITER, hash: 'SHA-256' },
      baseKey, lenBytes * 8));
  }
  async function hashPassword(password, saltHex) {
    return hex(await deriveBits(password, saltHex, 32));
  }
  async function makeAesKey(password, saltHex) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('il|' + password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: ITER, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function encryptBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    const out = new Uint8Array(iv.length + enc.byteLength);
    out.set(iv, 0); out.set(new Uint8Array(enc), 12);
    return b64(out);
  }
  async function decryptBytes(key, b64str) {
    const all = b64ToBytes(b64str);
    const iv = all.slice(0, 12);
    const data = all.slice(12);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new Uint8Array(dec);
  }

  async function encryptObj(key, obj) {
    const data = new TextEncoder().encode(JSON.stringify(obj));
    return await encryptBytes(key, data);
  }
  async function decryptObj(key, b64str) {
    const bytes = await decryptBytes(key, b64str);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ----- RSA-OAEP key wrapping ----- */
  async function generateRsaKeys() {
    const kp = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']);
    const pub = b64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey)));
    const priv = b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)));
    return { pub, priv };
  }
  async function rsaWrap(pubB64, dataKeyBytes) {
    const pub = await crypto.subtle.importKey('spki', b64ToBytes(pubB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
    const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, dataKeyBytes);
    return b64(new Uint8Array(enc));
  }
  async function rsaUnwrap(privB64, wrappedB64) {
    const priv = await crypto.subtle.importKey('pkcs8', b64ToBytes(privB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
    const dec = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64ToBytes(wrappedB64));
    return new Uint8Array(dec);
  }

  /* ---------- Data helpers ---------- */

  function defaultData() {
    return {
      customers: [],
      settings: {
        businessName: 'MHD ABO SALEM',
        businessPhone: '',
        businessAddress: '',
        currency: '$'
      }
    };
  }

  async function writeData(key, data) {
    writeChain = writeChain.then(async () => {
      const payload = await encryptObj(key, data);
      write(K_DATA, { payload, rev: 0 });
    });
    await writeChain;
  }

  async function readData(key) {
    const rec = read(K_DATA, null);
    if (!rec || !rec.payload) return null;
    try {
      return await decryptObj(key, rec.payload);
    } catch (e) {
      return null;
    }
  }

  function getData() { return mem; }
  function nextCustomerId(data) {
    let max = 0;
    (data.customers || []).forEach(function (c) { if (c.id > max) max = c.id; });
    return max + 1;
  }

  /* ---------- User/role management (local cache) ---------- */

  function getUsers() { return read(K_USERS, []); }
  function saveUsers(arr) { write(K_USERS, arr); }
  function getRoles() { return read(K_ROLES, []); }
  function saveRoles(arr) { write(K_ROLES, arr); }

  function currentUser() {
    const s = read(K_SESSION, null);
    return s ? s.username : null;
  }

  function isAdmin() {
    const u = currentUser();
    if (!u) return false;
    const users = getUsers();
    const usr = users.find(x => x.username === u);
    return !!(usr && usr.isAdmin);
  }

  function getUserRole() {
    const u = currentUser();
    if (!u) return '';
    const users = getUsers();
    const usr = users.find(x => x.username === u);
    return usr ? (usr.role || '') : '';
  }

  function getRoleDef(roleName) {
    if (!roleName) return null;
    const roles = getRoles();
    const r = roles.find(x => x.name === roleName);
    if (!r) return null;
    return {
      name: r.name,
      kind: r.kind || 'customers',
      colors: typeof r.colors === 'string' ? safeJson(r.colors, []) : (r.colors || []),
      pages: typeof r.pages === 'string' ? safeJson(r.pages, []) : (r.pages || [])
    };
  }

  function safeJson(s, fallback) {
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }

  /* ---------- Session ---------- */

  async function setSession(username, dataKeyRaw) {
    const token = newToken();
    const expiry = Date.now() + SESSION_DAYS * 86400000;
    write(K_SESSION, { username, token, expiry });
    const exportKey = await crypto.subtle.exportKey('raw', dataKeyRaw);
    write(K_KEY, { token, key: b64(exportKey) });
  }

  async function getSession() {
    const sess = read(K_SESSION, null);
    const krec = read(K_KEY, null);
    if (!sess || !krec || sess.token !== krec.token) return null;
    if (Date.now() > sess.expiry) { clearSession(); return null; }
    const key = await crypto.subtle.importKey('raw', b64ToBytes(krec.key), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return { username: sess.username, dataKey: key };
  }

  function clearSession() {
    localStorage.removeItem(K_SESSION);
    localStorage.removeItem(K_KEY);
  }

  async function restoreSession() {
    const sess = await getSession();
    if (!sess) return false;
    memKey = sess.dataKey;
    const data = await readData(memKey);
    if (!data) { clearSession(); return false; }
    mem = data;
    return true;
  }

  /* ---------- Core auth flows ---------- */

  async function bootstrapAdmin(username, password) {
    const users = getUsers();
    if (users.some(u => u.isAdmin)) throw new Error('Admin already exists');

    const salt = newSalt();
    const encSalt = newSalt();
    const passHash = await hashPassword(password, salt);

    const rsa = await generateRsaKeys();
    const userKey = await makeAesKey(password, encSalt);
    const privkeyEnc = await encryptBytes(userKey, b64ToBytes(rsa.priv));

    const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const wrappedKey = await rsaWrap(rsa.pub, dataKeyBytes);
    const dataKey = await crypto.subtle.importKey('raw', dataKeyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

    const user = {
      username, salt, encSalt, passHash,
      pubkey: rsa.pub, privkeyEnc, wrappedKey,
      role: '', isAdmin: true, status: 'approved',
      ver: VER, created: new Date().toISOString()
    };

    saveUsers([user]);
    memKey = dataKey;
    mem = defaultData();
    await writeData(memKey, mem);
    await setSession(username, dataKey);
    return user;
  }

  async function signUp(username, password) {
    const salt = newSalt();
    const encSalt = newSalt();
    const passHash = await hashPassword(password, salt);

    const rsa = await generateRsaKeys();
    const userKey = await makeAesKey(password, encSalt);
    const privkeyEnc = await encryptBytes(userKey, b64ToBytes(rsa.priv));

    const user = {
      username, salt, encSalt, passHash,
      pubkey: rsa.pub, privkeyEnc, wrappedKey: '',
      role: '', isAdmin: false, status: 'pending',
      ver: VER, created: new Date().toISOString()
    };

    return user;
  }

  async function verifyCloudUser(userRec, password) {
    const hash = await hashPassword(password, userRec.salt);
    if (hash !== userRec.passHash) return null;

    const userKey = await makeAesKey(password, userRec.encSalt);
    const privBytes = await decryptBytes(userKey, userRec.privkeyEnc);
    const dataKeyBytes = await rsaUnwrap(b64(privBytes), userRec.wrappedKey);
    const dataKey = await crypto.subtle.importKey('raw', dataKeyBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return dataKey;
  }

  async function loginWithUserRec(userRec, password, masterPayload) {
    /* Cloud rows use snake_case columns; normalize to camelCase. */
    const rec = {
      username: userRec.username,
      salt: userRec.salt,
      encSalt: userRec.enc_salt || userRec.encSalt,
      passHash: userRec.pass_hash || userRec.passHash,
      pubkey: userRec.pubkey,
      privkeyEnc: userRec.privkey_enc || userRec.privkeyEnc,
      wrappedKey: userRec.wrapped_key || userRec.wrappedKey,
      role: userRec.role || '',
      isAdmin: !!(userRec.is_admin || userRec.isAdmin),
      status: userRec.status || 'pending'
    };

    const dataKey = await verifyCloudUser(rec, password);
    if (!dataKey) return false;

    const data = await decryptObj(dataKey, masterPayload);
    if (!data) return false;

    // cache user locally
    const users = getUsers();
    const idx = users.findIndex(u => u.username === rec.username);
    const localUser = { ...rec, ver: VER, created: userRec.created_at || userRec.created };
    if (idx >= 0) users[idx] = localUser; else users.push(localUser);
    saveUsers(users);

    memKey = dataKey;
    mem = data;
    await writeData(memKey, mem);
    await setSession(rec.username, dataKey);
    return true;
  }

  async function changePassword(oldPw, newPw) {
    const username = currentUser();
    if (!username) throw new Error('No session');
    const users = getUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx < 0) throw new Error('User not found locally');
    const user = users[idx];

    const oldHash = await hashPassword(oldPw, user.salt);
    if (oldHash !== user.passHash) throw new Error('Incorrect current password');

    const newSalt = newSalt();
    const newEncSalt = newSalt();
    const newHash = await hashPassword(newPw, newSalt);

    const userKey = await makeAesKey(oldPw, user.encSalt);
    const privBytes = await decryptBytes(userKey, user.privkeyEnc);
    const newUserKey = await makeAesKey(newPw, newEncSalt);
    const newPrivkeyEnc = await encryptBytes(newUserKey, privBytes);

    user.salt = newSalt;
    user.encSalt = newEncSalt;
    user.passHash = newHash;
    user.privkeyEnc = newPrivkeyEnc;
    user.ver = VER;
    users[idx] = user;
    saveUsers(users);
    return true;
  }

  /* ---------- Admin helpers ---------- */

  async function unwrapWorkspaceKey() {
    const username = currentUser();
    const users = getUsers();
    const user = users.find(u => u.username === username);
    if (!user || !user.wrappedKey) throw new Error('No workspace key');
    const sess = await getSession();
    if (!sess) throw new Error('No session');
    return sess.dataKey;
  }

  async function wrapKeyForUser(pubB64) {
    const dataKey = await unwrapWorkspaceKey();
    const raw = await crypto.subtle.exportKey('raw', dataKey);
    return await rsaWrap(pubB64, raw);
  }

  /* ---------- Export/import for sync ---------- */

  async function exportVaultPayload() {
    if (!memKey || !mem) return null;
    return { payload: await encryptObj(memKey, mem), encSalt: '' }; // encSalt unused now
  }

  async function importVaultPayload(rec) {
    if (!memKey) return false;
    const data = await decryptObj(memKey, rec.payload);
    if (!data) return false;
    mem = data;
    await writeData(memKey, mem);
    return true;
  }

  function saveData(data) {
    mem = data;
    if (!memKey) return;
    writeData(memKey, data);
    if (onSave) onSave();
  }

  function getOnSave() { return onSave; }
  function setOnSave(fn) { onSave = fn; }
  let onSave = null;

  return {
    VER, ITER, SESSION_DAYS,
    defaultData, getData, nextCustomerId, saveData,
    getUsers, getRoles, saveRoles,
    currentUser, isAdmin, getUserRole, getRoleDef,
    setSession, getSession, clearSession, restoreSession,
    bootstrapAdmin, signUp, loginWithUserRec, changePassword,
    unwrapWorkspaceKey, wrapKeyForUser,
    exportVaultPayload, importVaultPayload,
    setOnSave
  };
})();