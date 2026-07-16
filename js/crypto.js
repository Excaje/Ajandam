/* ============ Şifreleme çekirdeği ============
   Tasarım (endüstri standardı, 1Password benzeri):
   - Ana paroladan PBKDF2 (600.000 tur, SHA-256) ile KEK (anahtar şifreleme anahtarı) türetilir.
   - KEK hiçbir yere kaydedilmez; yalnızca iki rastgele anahtarı "sarmalamak" için kullanılır:
       VK (kasa anahtarı)  : parolalarını şifreler. Yalnızca kilit açıkken bellekte durur.
       MK (eşitleme anahtarı): buluta giden HER veriyi uçtan uca şifreler.
   - Tüm şifreleme AES-256-GCM (bütünlük korumalı).
   - Parola değişince yalnızca sarmalar yenilenir; veriler yeniden şifrelenmez. */
"use strict";

const Crypto = (() => {
  const ITER = 600_000;
  let VK = null;          // bellekteki kasa anahtarı (CryptoKey)
  let MK = null;          // bellekteki eşitleme anahtarı (CryptoKey)
  let lockTimer = null;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKEK(password, saltBuf) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBuf, iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }

  async function aesEncrypt(key, dataBuf) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBuf);
    return { iv: bufToB64(iv), ct: bufToB64(ct) };
  }
  async function aesDecrypt(key, pack) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(pack.iv) }, key, b64ToBuf(pack.ct));
  }

  const importRaw = (rawBuf) =>
    crypto.subtle.importKey("raw", rawBuf, "AES-GCM", false, ["encrypt", "decrypt"]);

  /* --- Kurulum durumu --- */
  async function getKeyring() { return DB.metaGet("keyring"); }
  async function isSetup() { return !!(await getKeyring()); }

  /* --- İlk kurulum: ana parola belirle --- */
  async function setup(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await deriveKEK(password, salt);
    const rawVK = crypto.getRandomValues(new Uint8Array(32));
    const rawMK = crypto.getRandomValues(new Uint8Array(32));
    const keyring = {
      v: 1, iter: ITER, salt: bufToB64(salt),
      wrappedVK: await aesEncrypt(kek, rawVK),
      wrappedMK: await aesEncrypt(kek, rawMK),
      updatedAt: Date.now()
    };
    await DB.metaSet("keyring", keyring);
    VK = await importRaw(rawVK);
    MK = await importRaw(rawMK);
    await cacheMKIfAllowed(rawMK);
    armAutoLock();
    Sync?.markDirty?.();
    return true;
  }

  /* --- Kilit aç --- */
  async function unlock(password) {
    const kr = await getKeyring();
    if (!kr) throw new Error("Kurulum yok");
    const kek = await deriveKEK(password, b64ToBuf(kr.salt));
    let rawVK, rawMK;
    try {
      rawVK = await aesDecrypt(kek, kr.wrappedVK);
      rawMK = await aesDecrypt(kek, kr.wrappedMK);
    } catch {
      return false; // yanlış parola (GCM bütünlük kontrolü)
    }
    VK = await importRaw(rawVK);
    MK = await importRaw(rawMK);
    await cacheMKIfAllowed(rawMK);
    armAutoLock();
    return true;
  }

  function lock() {
    VK = null;
    clearTimeout(lockTimer);
    document.dispatchEvent(new CustomEvent("vault-locked"));
  }
  const isUnlocked = () => !!VK;

  /* --- Otomatik kilit --- */
  function armAutoLock() {
    clearTimeout(lockTimer);
    const min = Number(localStorage.getItem("lockMin") || 5);
    if (min > 0 && VK) lockTimer = setTimeout(lock, min * 60_000);
  }
  ["pointerdown", "keydown"].forEach(evt =>
    document.addEventListener(evt, () => { if (VK) armAutoLock(); }, { passive: true })
  );

  /* --- Eşitleme anahtarını cihazda sakla (arka planda eşitleme için) ---
     Bulut verisi yine uçtan uca şifreli kalır; bu yalnızca bu cihazın
     kilit açılmadan da eşitleyebilmesini sağlar. Ayarlardan kapatılabilir. */
  async function cacheMKIfAllowed(rawMK) {
    if (localStorage.getItem("autoSyncKey") !== "0") {
      await DB.metaSet("mkCache", bufToB64(rawMK));
    }
  }
  async function loadCachedMK() {
    if (MK) return MK;
    const b64 = await DB.metaGet("mkCache");
    if (!b64) return null;
    MK = await importRaw(b64ToBuf(b64));
    return MK;
  }
  async function clearCachedMK() { await DB.metaDel("mkCache"); }

  /* --- Nesne şifrele/çöz --- */
  async function encWith(key, obj) { return aesEncrypt(key, enc.encode(JSON.stringify(obj))); }
  async function decWith(key, pack) { return JSON.parse(dec.decode(await aesDecrypt(key, pack))); }

  const encVault = (obj) => { if (!VK) throw new Error("Kasa kilitli"); return encWith(VK, obj); };
  const decVault = (pack) => { if (!VK) throw new Error("Kasa kilitli"); return decWith(VK, pack); };
  const encSync = async (obj) => { const k = await loadCachedMK(); if (!k) throw new Error("Eşitleme anahtarı yok"); return encWith(k, obj); };
  const decSync = async (pack) => { const k = await loadCachedMK(); if (!k) throw new Error("Eşitleme anahtarı yok"); return decWith(k, pack); };

  /* --- Parola değiştir --- */
  async function changePassword(oldPw, newPw) {
    const kr = await getKeyring();
    const oldKek = await deriveKEK(oldPw, b64ToBuf(kr.salt));
    let rawVK, rawMK;
    try {
      rawVK = await aesDecrypt(oldKek, kr.wrappedVK);
      rawMK = await aesDecrypt(oldKek, kr.wrappedMK);
    } catch { return false; }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const newKek = await deriveKEK(newPw, salt);
    const newKr = {
      v: 1, iter: ITER, salt: bufToB64(salt),
      wrappedVK: await aesEncrypt(newKek, rawVK),
      wrappedMK: await aesEncrypt(newKek, rawMK),
      updatedAt: Date.now()
    };
    await DB.metaSet("keyring", newKr);
    Sync?.markDirty?.();
    return true;
  }

  /* --- Başka cihazdan gelen anahtarlığı benimse (ilk eşitlemede) --- */
  async function adoptKeyring(keyring, password) {
    const kek = await deriveKEK(password, b64ToBuf(keyring.salt));
    let rawVK, rawMK;
    try {
      rawVK = await aesDecrypt(kek, keyring.wrappedVK);
      rawMK = await aesDecrypt(kek, keyring.wrappedMK);
    } catch { return false; }
    await DB.metaSet("keyring", keyring);
    VK = await importRaw(rawVK);
    MK = await importRaw(rawMK);
    await cacheMKIfAllowed(rawMK);
    armAutoLock();
    return true;
  }

  /* --- Güçlü parola üretici --- */
  function generatePassword(len = 18) {
    const sets = [
      "abcdefghjkmnpqrstuvwxyz",
      "ABCDEFGHJKMNPQRSTUVWXYZ",
      "23456789",
      "!@#$%^&*-_=+?"
    ];
    const alphabet = sets.join("");
    const rnd = new Uint32Array(len);
    crypto.getRandomValues(rnd);
    let out = [...rnd].map(n => alphabet[n % alphabet.length]);
    // her kümeden en az bir karakter garanti et
    sets.forEach((set, i) => {
      const r = new Uint32Array(1); crypto.getRandomValues(r);
      out[i] = set[r[0] % set.length];
    });
    // karıştır
    for (let i = out.length - 1; i > 0; i--) {
      const r = new Uint32Array(1); crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join("");
  }

  return {
    isSetup, setup, unlock, lock, isUnlocked, armAutoLock,
    encVault, decVault, encSync, decSync,
    getKeyring, adoptKeyring, changePassword,
    loadCachedMK, clearCachedMK, generatePassword
  };
})();
