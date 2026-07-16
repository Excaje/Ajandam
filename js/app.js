/* ============ Uygulama kabuğu ============ */
"use strict";

const App = (() => {
  let view = "calendar";
  let deferredInstall = null;

  const TITLES = { calendar: "Ajanda", notes: "Notlar", vault: "Kasa", settings: "Ayarlar" };

  /* ---------- Görünüm değiştir ---------- */
  function show(name) {
    view = name;
    $$(".view").forEach(v => v.classList.add("hidden"));
    $(`#view-${name}`).classList.remove("hidden");
    $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
    $("#page-title").textContent = TITLES[name];
    $("#fab").style.display = name === "settings" ? "none" : "";
    refresh();
  }
  const currentView = () => view;

  function refresh() {
    if (view === "calendar") Calendar.render();
    else if (view === "notes") Notes.render();
    else if (view === "vault") Vault.render();
    else if (view === "settings") renderSettings();
  }

  /* ---------- Tema ---------- */
  function applyTheme() {
    const pref = localStorage.getItem("theme") || "system";
    const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  function cycleTheme() {
    const order = ["system", "light", "dark"];
    const cur = localStorage.getItem("theme") || "system";
    const next = order[(order.indexOf(cur) + 1) % order.length];
    localStorage.setItem("theme", next);
    applyTheme();
    toast({ system: "Tema: Sistem", light: "Tema: Aydınlık ☀️", dark: "Tema: Karanlık 🌙" }[next]);
    if (view === "settings") renderSettings();
  }

  /* ---------- Arama ---------- */
  function initSearch() {
    const bar = $("#search-bar"), results = $("#search-results"), input = $("#search-input");
    $("#btn-search").onclick = () => {
      bar.classList.toggle("hidden");
      results.classList.add("hidden");
      if (!bar.classList.contains("hidden")) { input.value = ""; input.focus(); }
    };
    $("#search-close").onclick = () => { bar.classList.add("hidden"); results.classList.add("hidden"); };
    input.oninput = debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { results.classList.add("hidden"); return; }
      const evs = await Calendar.search(q);
      const nts = await Notes.search(q);
      results.innerHTML = "";
      if (!evs.length && !nts.length) results.innerHTML = `<p class="empty-msg">Sonuç bulunamadı.</p>`;
      for (const ev of evs) {
        const el = document.createElement("div");
        el.className = "search-hit";
        el.innerHTML = `<div class="hit-type">🗓️ Etkinlik</div>
          <div class="hit-title">${escapeHtml(ev.title)}</div>
          <div class="hit-sub">${trDateLong(ev.date)}${ev.time ? " · " + ev.time : ""}${ev.recur !== "none" ? " · " + Calendar.RECUR_TR[ev.recur] : ""}</div>`;
        el.onclick = () => { closeSearch(); show("calendar"); Calendar.gotoDate(ev.date); };
        results.appendChild(el);
      }
      for (const n of nts) {
        const el = document.createElement("div");
        el.className = "search-hit";
        el.innerHTML = `<div class="hit-type">📝 Not</div>
          <div class="hit-title">${escapeHtml(n.title || "Başlıksız")}</div>
          <div class="hit-sub">${escapeHtml((n.body || "").slice(0, 90))}</div>`;
        el.onclick = () => { closeSearch(); show("notes"); Notes.openForm(n.id); };
        results.appendChild(el);
      }
      results.classList.remove("hidden");
    }, 200);
    function closeSearch() { bar.classList.add("hidden"); results.classList.add("hidden"); }
  }

  /* ---------- Ayarlar sayfası ---------- */
  async function renderSettings() {
    const body = $("#settings-body");
    const theme = localStorage.getItem("theme") || "system";
    const notifOn = localStorage.getItem("notifOn") !== "0";
    const lockMin = localStorage.getItem("lockMin") || "5";
    const autoKey = localStorage.getItem("autoSyncKey") !== "0";
    const vaultSetup = await Crypto.isSetup();
    const syncCfg = Sync.isConfigured();
    const syncUser = Sync.currentUser();
    const perm = "Notification" in window ? Notification.permission : "unsupported";

    body.innerHTML = `
      <div class="set-card">
        <h3>🎨 Görünüm</h3>
        <div class="set-row"><label>Tema</label>
          <select id="set-theme">
            <option value="system" ${theme === "system" ? "selected" : ""}>Sistemle aynı</option>
            <option value="light" ${theme === "light" ? "selected" : ""}>Aydınlık</option>
            <option value="dark" ${theme === "dark" ? "selected" : ""}>Karanlık</option>
          </select>
        </div>
      </div>

      <div class="set-card">
        <h3>🔔 Bildirimler</h3>
        <p class="set-desc">Hatırlatıcılar uygulama açıkken veya arka planda dururken çalışır.
          İzin durumu: <span class="badge ${perm === "granted" ? "ok" : ""}">${
            { granted: "verildi ✓", denied: "reddedildi ✕", default: "sorulmadı", unsupported: "desteklenmiyor" }[perm]
          }</span></p>
        <div class="set-row"><label>Hatırlatıcılar açık</label><input type="checkbox" id="set-notif" ${notifOn ? "checked" : ""}></div>
        <div class="set-actions">
          <button class="btn btn-ghost" id="set-notif-perm">Bildirim izni iste</button>
          <button class="btn btn-ghost" id="set-notif-test">Test bildirimi 🔔</button>
        </div>
      </div>

      <div class="set-card">
        <h3>🔐 Güvenlik</h3>
        <p class="set-desc">Kasa: AES-256-GCM + PBKDF2 (600.000 tur). Ana parolan hiçbir yere kaydedilmez.</p>
        <div class="set-row"><label>Otomatik kilitleme</label>
          <select id="set-lock">
            <option value="1" ${lockMin === "1" ? "selected" : ""}>1 dakika</option>
            <option value="5" ${lockMin === "5" ? "selected" : ""}>5 dakika</option>
            <option value="15" ${lockMin === "15" ? "selected" : ""}>15 dakika</option>
            <option value="60" ${lockMin === "60" ? "selected" : ""}>1 saat</option>
            <option value="0" ${lockMin === "0" ? "selected" : ""}>Kapalı</option>
          </select>
        </div>
        <div class="set-row"><label>Kilitliyken de arka planda eşitle</label><input type="checkbox" id="set-autokey" ${autoKey ? "checked" : ""}></div>
        <div class="set-actions">
          <button class="btn btn-ghost" id="set-changepw" ${vaultSetup ? "" : "disabled"}>Ana parolayı değiştir</button>
        </div>
      </div>

      <div class="set-card">
        <h3>☁️ Cihazlar Arası Eşitleme</h3>
        <p class="set-desc">
          Durum: ${syncUser
            ? `<span class="badge ok">açık · ${escapeHtml(syncUser.email || "")}</span>`
            : syncCfg ? `<span class="badge">yapılandırıldı, giriş bekleniyor</span>`
            : `<span class="badge">kapalı</span>`}<br>
          Ücretsiz bir Firebase projesiyle çalışır; tüm veriler buluta <b>uçtan uca şifreli</b> gider.
          Kurulum adımları README.md dosyasında.</p>
        ${syncCfg ? "" : `
          <label style="font-size:13px;font-weight:600;color:var(--text2)">Firebase yapılandırması (console'dan kopyala-yapıştır)</label>
          <textarea id="set-fbcfg" rows="6" placeholder='const firebaseConfig = { apiKey: "...", projectId: "...", ... };'></textarea>`}
        <div class="set-actions">
          ${!syncCfg ? `<button class="btn btn-primary" id="set-fbsave">Yapılandırmayı Kaydet</button>` : ""}
          ${syncCfg && !syncUser ? `<button class="btn btn-primary" id="set-signin">Google ile giriş yap</button>` : ""}
          ${syncUser ? `<button class="btn btn-ghost" id="set-syncnow">Şimdi eşitle ⟳</button>
                        <button class="btn btn-ghost" id="set-signout">Oturumu kapat</button>` : ""}
          ${syncCfg ? `<button class="btn btn-danger" id="set-syncoff">Eşitlemeyi kaldır</button>` : ""}
        </div>
      </div>

      <div class="set-card">
        <h3>💾 Yedekleme</h3>
        <p class="set-desc">Tüm verini tek dosyaya aktar. ${vaultSetup ? "Yedek dosyası şifrelidir; geri yüklemek için ana parolan gerekir." : "Önce kasayı kurarsan yedek şifreli alınır."}</p>
        <div class="set-actions">
          <button class="btn btn-primary" id="set-export">Yedek indir</button>
          <button class="btn btn-ghost" id="set-import">Yedekten geri yükle</button>
        </div>
      </div>

      <div class="set-card">
        <h3>📲 Uygulama</h3>
        <p class="set-desc">Ajandam sürüm 1.0 · Verilerin bu cihazda saklanır, internet olmadan da çalışır.</p>
        <div class="set-actions">
          ${deferredInstall ? `<button class="btn btn-primary" id="set-install">Cihaza uygulama olarak yükle</button>` : ""}
          <button class="btn btn-danger" id="set-wipe">Bu cihazdaki tüm veriyi sil</button>
        </div>
      </div>`;

    $("#set-theme").onchange = e => { localStorage.setItem("theme", e.target.value); applyTheme(); };
    $("#set-notif").onchange = e => localStorage.setItem("notifOn", e.target.checked ? "1" : "0");
    $("#set-notif-perm").onclick = async () => {
      if (!("Notification" in window)) return toast("Bu tarayıcı bildirim desteklemiyor");
      await Notification.requestPermission();
      renderSettings();
    };
    $("#set-notif-test").onclick = () => {
      Notify.beep(2);
      if (Notification.permission === "granted") {
        navigator.serviceWorker?.getRegistration().then(reg =>
          reg?.showNotification("🔔 Test", { body: "Bildirimler çalışıyor!", icon: "icons/icon-192.png" }));
      } else toast("Önce bildirim izni ver");
    };
    $("#set-lock").onchange = e => { localStorage.setItem("lockMin", e.target.value); Crypto.armAutoLock(); };
    $("#set-autokey").onchange = async e => {
      localStorage.setItem("autoSyncKey", e.target.checked ? "1" : "0");
      if (!e.target.checked) { await Crypto.clearCachedMK(); toast("Anahtar bu cihazdan silindi; eşitleme kilit açıkken çalışır"); }
      else toast("Kilit bir kez açıldığında etkinleşir");
    };
    $("#set-changepw").onclick = openChangePassword;

    $("#set-fbsave")?.addEventListener("click", async () => {
      if (await Sync.saveConfig($("#set-fbcfg").value)) renderSettings();
    });
    $("#set-signin")?.addEventListener("click", () => Sync.signIn());
    $("#set-signout")?.addEventListener("click", async () => { await Sync.signOutUser(); renderSettings(); });
    $("#set-syncnow")?.addEventListener("click", () => { Sync.trySync(); toast("Eşitleniyor…"); });
    $("#set-syncoff")?.addEventListener("click", async () => {
      if (!await confirmBox("Eşitleme bu cihazdan kaldırılsın mı? (Buluttaki ve cihazdaki veriler silinmez)")) return;
      await Sync.disable(); renderSettings();
    });

    $("#set-export").onclick = exportBackup;
    $("#set-import").onclick = importBackup;
    $("#set-install")?.addEventListener("click", async () => {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null; renderSettings();
    });
    $("#set-wipe").onclick = async () => {
      if (!await confirmBox("Bu cihazdaki TÜM veriler (etkinlikler, notlar, kasa) silinecek. Eşitleme açıksa buluttaki veriler durur. Emin misin?")) return;
      indexedDB.deleteDatabase("ajandamDB");
      localStorage.clear();
      location.reload();
    };
  }

  /* ---------- Ana parola değiştirme ---------- */
  function openChangePassword() {
    openModal(`
      <h2>Ana Parolayı Değiştir <button class="close-x">✕</button></h2>
      <div class="form-grid">
        <div><label>Mevcut parola</label><input type="password" id="cp-old" autocomplete="current-password"></div>
        <div><label>Yeni parola (en az 8 karakter)</label><input type="password" id="cp-new" autocomplete="new-password"></div>
        <div><label>Yeni parola (tekrar)</label><input type="password" id="cp-new2" autocomplete="new-password"></div>
        <p class="form-error" id="cp-err"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cp-cancel">Vazgeç</button>
        <button class="btn btn-primary" id="cp-save">Değiştir</button>
      </div>`);
    $("#cp-cancel").onclick = closeModal;
    $("#cp-save").onclick = async () => {
      const err = $("#cp-err");
      const nw = $("#cp-new").value;
      if (nw.length < 8) { err.textContent = "Yeni parola en az 8 karakter olmalı."; return; }
      if (nw !== $("#cp-new2").value) { err.textContent = "Yeni parolalar eşleşmiyor."; return; }
      const btn = $("#cp-save"); btn.disabled = true; btn.textContent = "İşleniyor…";
      const ok = await Crypto.changePassword($("#cp-old").value, nw);
      btn.disabled = false; btn.textContent = "Değiştir";
      if (!ok) { err.textContent = "Mevcut parola yanlış."; return; }
      closeModal(); toast("Ana parola değiştirildi ✓");
    };
  }

  /* ---------- Yedekleme ---------- */
  async function exportBackup() {
    const data = {};
    for (const s of ["events", "notes", "images", "vault"]) data[s] = await DB.all(s);
    let out;
    if (await Crypto.isSetup() && await Crypto.loadCachedMK()) {
      out = {
        app: "ajandam", v: 1, encrypted: true,
        keyring: await Crypto.getKeyring(),
        payload: await Crypto.encSync(data)
      };
    } else {
      out = { app: "ajandam", v: 1, encrypted: false, data };
    }
    const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ajandam-yedek-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(out.encrypted ? "Şifreli yedek indirildi 🔐" : "Yedek indirildi");
  }

  function importBackup() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = async () => {
      try {
        const text = await inp.files[0].text();
        const bk = JSON.parse(text);
        if (bk.app !== "ajandam") throw new Error("Bu bir Ajandam yedeği değil");
        let data;
        if (bk.encrypted) {
          const localKr = await Crypto.getKeyring();
          if (!localKr || localKr.salt !== bk.keyring.salt) {
            // yedeğin anahtarlığını benimsemek için parola iste
            const pw = await askPassword("Yedeğin ana parolasını gir");
            if (pw == null) return;
            const ok = await Crypto.adoptKeyring(bk.keyring, pw);
            if (!ok) { toast("Parola yanlış"); return; }
          }
          if (!(await Crypto.loadCachedMK())) { toast("Önce kasanın kilidini aç"); return; }
          data = await Crypto.decSync(bk.payload);
        } else data = bk.data;
        let n = 0;
        for (const s of ["events", "notes", "images", "vault"]) {
          for (const r of data[s] || []) {
            const local = await DB.get(s, r.id);
            if (!local || (local.updatedAt || 0) < (r.updatedAt || 0)) {
              await DB.putRaw(s, r); n++;
            }
          }
        }
        Sync.markDirty();
        toast(`${n} kayıt geri yüklendi ✓`);
        refresh();
      } catch (e) { toast("Geri yükleme başarısız: " + e.message); }
    };
    inp.click();
  }

  function askPassword(label) {
    return new Promise(res => {
      openModal(`
        <h2>${escapeHtml(label)} <button class="close-x">✕</button></h2>
        <div class="form-grid"><input type="password" id="ask-pw" autocomplete="current-password"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="ask-cancel">Vazgeç</button>
          <button class="btn btn-primary" id="ask-ok">Tamam</button>
        </div>`);
      $("#ask-cancel").onclick = () => { closeModal(); res(null); };
      $("#ask-ok").onclick = () => { const v = $("#ask-pw").value; closeModal(); res(v); };
    });
  }

  /* ---------- Başlat ---------- */
  function init() {
    applyTheme();
    $$(".nav-btn").forEach(b => b.onclick = () => show(b.dataset.nav));
    $("#btn-theme").onclick = cycleTheme;
    $("#fab").onclick = () => {
      if (view === "calendar") Calendar.openForm();
      else if (view === "notes") Notes.openForm();
      else if (view === "vault") Vault.openForm();
    };
    initSearch();
    Calendar.init();
    Vault.init();
    Notify.init();
    Sync.init();
    show("calendar");

    // PWA
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredInstall = e;
      if (view === "settings") renderSettings();
    });
  }

  return { init, show, refresh, currentView, refreshSettings: () => { if (view === "settings") renderSettings(); } };
})();

document.addEventListener("DOMContentLoaded", App.init);
