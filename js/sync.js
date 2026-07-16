/* ============ Cihazlar arası eşitleme (isteğe bağlı) ============
   Ücretsiz Firebase projesi üzerinden çalışır (kurulum: README.md).
   Buluta giden HER kayıt önce cihazda MK ile AES-256-GCM şifrelenir;
   Firebase/Google verilerin içeriğini GÖREMEZ. Girişler yalnızca kendi
   Google hesabınla yapılır ve güvenlik kuralları başka kimseye izin vermez. */
"use strict";

const Sync = (() => {
  const STORES = ["events", "notes", "images", "vault"];
  let fb = null;            // yüklü firebase modülleri
  let app = null, auth = null, db = null;
  let user = null;
  let dirtyTimer = null;
  let unsubscribe = null;
  let syncing = false;
  let started = false;

  /* --- durum göstergesi --- */
  function setStatus(mode, title) {
    const el = $("#sync-status");
    el.className = "sync-status" + (mode === "on" ? " on" : mode === "err" ? " err" : "");
    el.textContent = mode === "off" ? "" : mode === "sync" ? "⟳" : mode === "on" ? "●" : "!";
    el.title = title || (mode === "on" ? "Eşitleme açık" : "");
  }

  function getConfig() {
    const raw = localStorage.getItem("fbConfig");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  /* Kullanıcının yapıştırdığı metinden config nesnesini çıkar
     (JSON veya "const firebaseConfig = {...}" kod parçası olabilir) */
  function parseConfigText(text) {
    try { return JSON.parse(text); } catch {}
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const obj = new Function("return (" + m[0] + ")")();
      return (obj && obj.apiKey && obj.projectId) ? obj : null;
    } catch { return null; }
  }

  async function saveConfig(text) {
    const cfg = parseConfigText(text);
    if (!cfg) { toast("Yapılandırma anlaşılamadı — Firebase config'i olduğu gibi yapıştır"); return false; }
    localStorage.setItem("fbConfig", JSON.stringify(cfg));
    toast("Firebase yapılandırması kaydedildi");
    await start(true);
    return true;
  }

  async function loadSDK() {
    if (fb) return fb;
    const V = "10.12.2";
    const [appM, authM, fsM] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
    ]);
    fb = { ...appM, ...authM, ...fsM };
    return fb;
  }

  /* --- başlat --- */
  async function start(force = false) {
    const cfg = getConfig();
    if (!cfg) { setStatus("off"); return; }
    if (started && !force) return;
    try {
      await loadSDK();
      if (!app) {
        app = fb.initializeApp(cfg);
        auth = fb.getAuth(app);
        db = fb.getFirestore(app);
        fb.getRedirectResult(auth).catch(() => {});
        fb.onAuthStateChanged(auth, u => {
          user = u;
          if (u) { setStatus("on", "Eşitleme açık: " + (u.email || "")); trySync(); }
          else setStatus("err", "Giriş yapılmadı");
          App.refreshSettings?.();
        });
      }
      started = true;
    } catch (e) {
      console.error("Firebase başlatılamadı", e);
      setStatus("err", "Firebase başlatılamadı");
    }
  }

  async function signIn() {
    await start();
    if (!auth) { toast("Önce Firebase yapılandırmasını kaydet"); return; }
    const provider = new fb.GoogleAuthProvider();
    try {
      await fb.signInWithPopup(auth, provider);
    } catch (e) {
      try { await fb.signInWithRedirect(auth, provider); }
      catch (e2) { toast("Giriş başarısız: " + (e2.code || e2.message)); }
    }
  }

  async function signOutUser() {
    if (auth) await fb.signOut(auth);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    toast("Eşitleme oturumu kapatıldı");
  }

  const lastKey = (k) => `sync_${k}_${user?.uid || ""}`;
  const getLast = (k) => Number(localStorage.getItem(lastKey(k)) || 0);
  const setLast = (k, v) => localStorage.setItem(lastKey(k), String(v));

  /* --- anahtarlık uzlaştırma ---
     Anahtarlık; parola-türevli anahtarla SARMALANMIŞ anahtarları içerir,
     buluta açık koymak güvenlidir (parolasız çözülemez). */
  async function ensureKeyring() {
    const ref = fb.doc(db, "users", user.uid, "meta", "keyring");
    const snap = await fb.getDoc(ref);
    const cloud = snap.exists() ? snap.data() : null;
    const local = await Crypto.getKeyring();

    if (!cloud && local) { await fb.setDoc(ref, local); return true; }
    if (!cloud && !local) return false; // önce kasa kurulmalı
    if (cloud && !local) {
      // yeni cihaz: ana parolayı sorup anahtarlığı benimse
      return await promptAdopt(cloud);
    }
    if (cloud.salt === local.salt) {
      if ((cloud.updatedAt || 0) > (local.updatedAt || 0)) await DB.metaSet("keyring", cloud);
      else if ((local.updatedAt || 0) > (cloud.updatedAt || 0)) await fb.setDoc(ref, local);
      return true;
    }
    // iki cihazda ayrı ayrı kasa kurulmuş — kullanıcıya sor
    return await promptKeyringConflict(cloud, ref, local);
  }

  function promptAdopt(cloudKeyring) {
    return new Promise(res => {
      openModal(`
        <h2>Eşitlemeye Katıl <button class="close-x">✕</button></h2>
        <p style="color:var(--text2);line-height:1.6;margin-bottom:14px">
          Bulutta bu hesaba ait şifreli veri bulundu. Çözebilmek için
          <b>diğer cihazda belirlediğin ana parolayı</b> gir.</p>
        <div class="form-grid">
          <input type="password" id="adopt-pw" placeholder="Ana parola" autocomplete="current-password">
          <p class="form-error" id="adopt-err"></p>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="adopt-cancel">Şimdi değil</button>
          <button class="btn btn-primary" id="adopt-ok">Katıl</button>
        </div>`);
      $("#adopt-cancel").onclick = () => { closeModal(); res(false); };
      $("#adopt-ok").onclick = async () => {
        const btn = $("#adopt-ok");
        btn.disabled = true; btn.textContent = "Çözülüyor…";
        const ok = await Crypto.adoptKeyring(cloudKeyring, $("#adopt-pw").value);
        btn.disabled = false; btn.textContent = "Katıl";
        if (!ok) { $("#adopt-err").textContent = "Parola yanlış."; return; }
        closeModal(); toast("Eşitlemeye katıldın 🎉");
        res(true);
      };
    });
  }

  function promptKeyringConflict(cloud, ref, local) {
    return new Promise(res => {
      openModal(`
        <h2>Anahtar Çakışması <button class="close-x">✕</button></h2>
        <p style="color:var(--text2);line-height:1.6;margin-bottom:14px">
          Hem bulutta hem bu cihazda birbirinden bağımsız kurulmuş kasa var.
          Hangisi geçerli olsun? (Seçilmeyen taraftaki <b>kasa kayıtları</b> çözülemez hâle gelir;
          ajanda ve notlar etkilenmez.)</p>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-ghost" id="kc-local">Bu cihazdaki kalsın</button>
          <button class="btn btn-primary" id="kc-cloud">Buluttaki kalsın</button>
        </div>`);
      $("#kc-local").onclick = async () => {
        await fb.setDoc(ref, local);
        closeModal(); res(true);
      };
      $("#kc-cloud").onclick = async () => {
        closeModal();
        res(await promptAdopt(cloud));
      };
    });
  }

  /* --- indirme --- */
  async function pull() {
    const lastPull = getLast("pull");
    const q = fb.query(
      fb.collection(db, "users", user.uid, "items"),
      fb.where("u", ">", lastPull)
    );
    const snap = await fb.getDocs(q);
    let newest = lastPull, changed = 0;
    for (const d of snap.docs) {
      const applied = await applyRemote(d.data());
      if (applied) changed++;
      newest = Math.max(newest, d.data().u || 0);
    }
    setLast("pull", newest);
    if (changed) App.refresh();
    return changed;
  }

  async function applyRemote(d) {
    if (!STORES.includes(d.s)) return false;
    let obj;
    try { obj = await Crypto.decSync(d.payload); } catch { return false; }
    const local = await DB.get(d.s, obj.id);
    if (local && (local.updatedAt || 0) >= (obj.updatedAt || 0)) return false;
    await DB.putRaw(d.s, obj);
    return true;
  }

  /* --- gönderme --- */
  async function push() {
    const lastPush = getLast("push");
    let newest = lastPush, count = 0;
    for (const s of STORES) {
      const rows = (await DB.all(s)).filter(r => (r.updatedAt || 0) > lastPush);
      for (const r of rows) {
        const payload = await Crypto.encSync(r);
        await fb.setDoc(fb.doc(db, "users", user.uid, "items", `${s}__${r.id}`),
          { s, id: r.id, u: r.updatedAt, payload });
        newest = Math.max(newest, r.updatedAt);
        count++;
      }
    }
    setLast("push", newest);
    return count;
  }

  /* --- canlı dinleyici: diğer cihazdaki değişiklik anında gelsin --- */
  function listen() {
    if (unsubscribe) unsubscribe();
    const q = fb.query(
      fb.collection(db, "users", user.uid, "items"),
      fb.where("u", ">", getLast("pull"))
    );
    const refresh = debounce(() => App.refresh(), 400);
    unsubscribe = fb.onSnapshot(q, snap => {
      snap.docChanges().forEach(async ch => {
        if (ch.type === "removed") return;
        const d = ch.doc.data();
        if (await applyRemote(d)) refresh();
        if ((d.u || 0) > getLast("pull")) setLast("pull", d.u);
      });
    }, () => setStatus("err", "Bağlantı sorunu"));
  }

  /* --- tam eşitleme --- */
  async function trySync() {
    if (!user || syncing || !navigator.onLine) return;
    const mk = await Crypto.loadCachedMK().catch(() => null);
    syncing = true;
    setStatus("sync", "Eşitleniyor…");
    try {
      const ok = await ensureKeyring();
      if (!ok) {
        setStatus("on", "Eşitleme, kasa kurulunca başlayacak");
        return;
      }
      if (!(await Crypto.loadCachedMK())) {
        setStatus("on", "Kilit açılınca eşitlenecek");
        return;
      }
      await pull();
      await push();
      listen();
      setStatus("on", "Eşitleme güncel · " + new Date().toLocaleTimeString("tr"));
    } catch (e) {
      console.error("Eşitleme hatası", e);
      setStatus("err", "Eşitleme hatası: " + (e.code || e.message));
    } finally {
      syncing = false;
    }
  }

  /* --- yerel değişiklik oldu: kısa süre sonra gönder --- */
  function markDirty() {
    if (!user) return;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(async () => {
      try {
        if (await Crypto.loadCachedMK()) {
          await push();
          setStatus("on", "Eşitleme güncel");
        }
      } catch (e) { setStatus("err", "Gönderilemedi"); }
    }, 2000);
  }

  function init() {
    start();
    window.addEventListener("online", () => trySync());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") trySync();
    });
    setInterval(trySync, 120_000);
  }

  const isConfigured = () => !!getConfig();
  const currentUser = () => user;

  async function disable() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (auth?.currentUser) await fb.signOut(auth);
    localStorage.removeItem("fbConfig");
    setStatus("off");
    toast("Eşitleme kapatıldı (buluttaki veriler durur, silinmez)");
  }

  return { init, start, signIn, signOutUser, saveConfig, trySync, markDirty, isConfigured, currentUser, disable };
})();
