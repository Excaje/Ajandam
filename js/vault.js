/* ============ Şifre Kasası ============
   Kayıtlar cihazda dahi yalnızca şifreli (AES-256-GCM) olarak durur;
   ana parola olmadan içerik okunamaz. */
"use strict";

const Vault = (() => {
  let items = [];      // çözülmüş kayıtlar (yalnızca kilit açıkken bellekte)
  let filter = "";

  async function render() {
    const setup = await Crypto.isSetup();
    const unlocked = Crypto.isUnlocked();
    $("#vault-locked").classList.toggle("hidden", unlocked);
    $("#vault-open").classList.toggle("hidden", !unlocked);

    if (!unlocked) {
      $("#vault-lock-title").textContent = setup ? "Kasa Kilitli" : "Kasanı Kur";
      $("#vault-lock-desc").textContent = setup
        ? "Parolalarına erişmek için ana parolanı gir."
        : "Tüm verilerini koruyacak bir ana parola belirle. Bu parola hiçbir yere kaydedilmez — unutursan kurtarılamaz, güçlü ama hatırlayacağın bir şey seç.";
      $("#vault-password2").classList.toggle("hidden", setup);
      $("#vault-unlock-btn").textContent = setup ? "Kilidi Aç" : "Kasayı Oluştur";
      $("#vault-error").textContent = "";
      $("#vault-password").value = ""; $("#vault-password2").value = "";
      return;
    }
    await loadItems();
    renderList();
  }

  async function loadItems() {
    const rows = await DB.live("vault");
    items = [];
    for (const r of rows) {
      try {
        const data = await Crypto.decVault({ iv: r.iv, ct: r.ct });
        items.push({ id: r.id, updatedAt: r.updatedAt, ...data });
      } catch { /* farklı anahtarla şifrelenmiş kayıt — atla */ }
    }
    items.sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }

  function renderList() {
    const list = $("#vault-list");
    const q = filter.toLocaleLowerCase("tr");
    const shown = items.filter(it =>
      !q || it.title.toLocaleLowerCase("tr").includes(q) ||
      (it.username || "").toLocaleLowerCase("tr").includes(q) ||
      (it.url || "").toLocaleLowerCase("tr").includes(q)
    );
    $("#vault-empty").classList.toggle("hidden", items.length > 0);
    list.innerHTML = "";
    for (const it of shown) {
      const el = document.createElement("div");
      el.className = "vault-item";
      el.innerHTML = `
        <div class="vault-fav">${escapeHtml((it.title || "?")[0])}</div>
        <div class="vault-info">
          <div class="v-title">${escapeHtml(it.title)}</div>
          <div class="v-user">${escapeHtml(it.username || it.url || "")}</div>
        </div>
        <button class="icon-btn vault-copy" title="Parolayı kopyala">📋</button>`;
      el.querySelector(".vault-copy").onclick = (e) => {
        e.stopPropagation();
        copyText(it.password || "", "Parola kopyalandı");
      };
      el.onclick = () => openDetail(it.id);
      list.appendChild(el);
    }
  }

  /* --- Kilit açma / kurulum formu --- */
  async function handleUnlockForm(e) {
    e.preventDefault();
    const pw = $("#vault-password").value;
    const err = $("#vault-error");
    err.textContent = "";
    const setup = await Crypto.isSetup();
    const btn = $("#vault-unlock-btn");
    btn.disabled = true; btn.textContent = "Çözülüyor…";
    try {
      if (!setup) {
        const pw2 = $("#vault-password2").value;
        if (pw.length < 8) { err.textContent = "Ana parola en az 8 karakter olmalı."; return; }
        if (pw !== pw2) { err.textContent = "Parolalar eşleşmiyor."; return; }
        await Crypto.setup(pw);
        toast("Kasa oluşturuldu 🎉");
      } else {
        const ok = await Crypto.unlock(pw);
        if (!ok) { err.textContent = "Parola yanlış."; return; }
      }
      render();
      Sync.trySync();
    } finally {
      btn.disabled = false;
      btn.textContent = setup ? "Kilidi Aç" : "Kasayı Oluştur";
    }
  }

  /* --- Kayıt detayı --- */
  function openDetail(id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    const rows = [
      ["Kullanıcı adı", it.username, false],
      ["Parola", it.password, true],
      ["Adres", it.url, false],
      ["Not", it.note, false],
    ].filter(r => r[1]);

    openModal(`
      <h2>${escapeHtml(it.title)} <button class="close-x">✕</button></h2>
      <div class="kv-list">
        ${rows.map(([label, val, secret], i) => `
          <div class="kv-row">
            <span class="kv-label">${label}</span>
            <span class="kv-val ${secret ? "mono" : ""}" data-i="${i}">${secret ? "••••••••••" : escapeHtml(val)}</span>
            ${secret ? `<button class="icon-btn" data-eye="${i}" title="Göster/Gizle">👁️</button>` : ""}
            <button class="icon-btn" data-copy="${i}" title="Kopyala">📋</button>
          </div>`).join("")}
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" id="vd-delete">Sil</button>
        <button class="btn btn-ghost" id="vd-edit">Düzenle</button>
        <button class="btn btn-primary close-x3" id="vd-close">Kapat</button>
      </div>`);

    $$("#modal [data-copy]").forEach(b => b.onclick = () => copyText(rows[b.dataset.copy][1], rows[b.dataset.copy][0] + " kopyalandı"));
    $$("#modal [data-eye]").forEach(b => b.onclick = () => {
      const span = $(`#modal .kv-val[data-i="${b.dataset.eye}"]`);
      const val = rows[b.dataset.eye][1];
      span.textContent = span.textContent === "••••••••••" ? val : "••••••••••";
    });
    $("#vd-close").onclick = closeModal;
    $("#vd-edit").onclick = () => openForm(id);
    $("#vd-delete").onclick = async () => {
      if (!await confirmBox(`"${it.title}" kaydı kasadan silinsin mi?`)) return;
      await DB.softDelete("vault", id);
      closeModal(); toast("Kayıt silindi");
      loadItems().then(renderList);
    };
  }

  /* --- Kayıt ekle / düzenle --- */
  function openForm(id) {
    if (!Crypto.isUnlocked()) { toast("Önce kasanın kilidini aç"); return; }
    const it = id ? items.find(x => x.id === id) : null;
    const isNew = !it;
    const v = it || { title: "", username: "", password: "", url: "", note: "" };

    openModal(`
      <h2>${isNew ? "Yeni Kayıt" : "Kaydı Düzenle"} <button class="close-x">✕</button></h2>
      <div class="form-grid">
        <div><label>Başlık</label><input type="text" id="vl-title" required maxlength="100" value="${escapeHtml(v.title)}" placeholder="Örn. Google, e-Devlet…"></div>
        <div><label>Kullanıcı adı / E-posta</label><input type="text" id="vl-user" value="${escapeHtml(v.username)}" autocomplete="off"></div>
        <div><label>Parola</label>
          <div class="pw-wrap">
            <input type="password" id="vl-pass" value="${escapeHtml(v.password)}" autocomplete="new-password">
            <button type="button" class="icon-btn" id="vl-eye" title="Göster/Gizle">👁️</button>
            <button type="button" class="icon-btn" id="vl-gen" title="Güçlü parola üret">🎲</button>
          </div>
        </div>
        <div><label>Web adresi</label><input type="url" id="vl-url" value="${escapeHtml(v.url)}" placeholder="https://…"></div>
        <div><label>Not</label><textarea id="vl-note" rows="3">${escapeHtml(v.note)}</textarea></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="vl-cancel">Vazgeç</button>
        <button class="btn btn-primary" id="vl-save">Kaydet</button>
      </div>`);

    $("#vl-eye").onclick = () => {
      const inp = $("#vl-pass");
      inp.type = inp.type === "password" ? "text" : "password";
    };
    $("#vl-gen").onclick = () => {
      $("#vl-pass").value = Crypto.generatePassword();
      $("#vl-pass").type = "text";
      toast("Güçlü parola üretildi");
    };
    $("#vl-cancel").onclick = closeModal;
    $("#vl-save").onclick = async () => {
      const title = $("#vl-title").value.trim();
      if (!title) { $("#vl-title").focus(); return; }
      const data = {
        title,
        username: $("#vl-user").value.trim(),
        password: $("#vl-pass").value,
        url: $("#vl-url").value.trim(),
        note: $("#vl-note").value.trim()
      };
      const pack = await Crypto.encVault(data);
      await DB.save("vault", { id: it?.id || uid(), iv: pack.iv, ct: pack.ct });
      closeModal(); toast(isNew ? "Kasaya eklendi 🔐" : "Güncellendi");
      loadItems().then(renderList);
    };
  }

  function init() {
    $("#vault-unlock-form").addEventListener("submit", handleUnlockForm);
    $("#vault-lock-now").onclick = () => { Crypto.lock(); };
    $("#vault-filter").oninput = debounce(e => { filter = e.target.value; renderList(); }, 150);
    document.addEventListener("vault-locked", () => {
      items = [];
      if (App.currentView() === "vault") render();
      else toast("Kasa otomatik kilitlendi 🔒");
    });
  }

  return { init, render, openForm };
})();
