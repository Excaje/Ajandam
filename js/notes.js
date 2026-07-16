/* ============ Notlar ============ */
"use strict";

const Notes = (() => {
  let cache = [];

  async function load() {
    cache = (await DB.live("notes")).sort((a, b) =>
      (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt)
    );
  }

  async function render() {
    await load();
    const list = $("#notes-list");
    $("#notes-empty").classList.toggle("hidden", cache.length > 0);
    list.innerHTML = "";
    for (const n of cache) {
      const card = document.createElement("div");
      card.className = "note-card";
      const d = new Date(n.updatedAt);
      card.innerHTML = `
        <h3>${n.pinned ? "📌 " : ""}${escapeHtml(n.title || "Başlıksız")}</h3>
        <div class="note-body">${escapeHtml(n.body || "")}</div>
        <div class="note-thumbs" data-thumbs></div>
        <div class="note-date">${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}</div>`;
      card.onclick = () => openForm(n.id);
      list.appendChild(card);
      // küçük görselleri asenkron yükle
      if (n.images?.length) {
        const wrap = card.querySelector("[data-thumbs]");
        for (const imgId of n.images.slice(0, 4)) {
          DB.get("images", imgId).then(img => {
            if (!img || img.deleted) return;
            const im = document.createElement("img");
            im.src = img.data;
            im.onclick = (e) => { e.stopPropagation(); showViewer(img.data); };
            wrap.appendChild(im);
          });
        }
      }
    }
  }

  async function openForm(noteId) {
    let n = noteId ? cache.find(x => x.id === noteId) : null;
    const isNew = !n;
    n = n || { id: uid(), title: "", body: "", images: [], pinned: 0 };
    const att = { ids: [...(n.images || [])], removed: [] };

    openModal(`
      <h2>${isNew ? "Yeni Not" : "Notu Düzenle"} <button class="close-x">✕</button></h2>
      <div class="form-grid">
        <div><label>Başlık</label><input type="text" id="nt-title" maxlength="120" value="${escapeHtml(n.title)}" placeholder="Not başlığı"></div>
        <div><label>İçerik</label><textarea id="nt-body" rows="8" placeholder="Notunu yaz…">${escapeHtml(n.body)}</textarea></div>
        <label class="form-check" style="color:var(--text)"><input type="checkbox" id="nt-pin" ${n.pinned ? "checked" : ""}> 📌 Üste sabitle</label>
        <div><label>Görseller</label><div class="img-attach" id="nt-attach"></div></div>
      </div>
      <div class="modal-actions">
        ${isNew ? "" : `<button class="btn btn-danger" id="nt-delete">Sil</button>`}
        <button class="btn btn-ghost" id="nt-cancel">Vazgeç</button>
        <button class="btn btn-primary" id="nt-save">Kaydet</button>
      </div>`);

    AttachUI.render($("#nt-attach"), att);
    $("#nt-cancel").onclick = closeModal;

    if (!isNew) $("#nt-delete").onclick = async () => {
      if (!await confirmBox(`"${n.title || "Başlıksız"}" notu silinsin mi?`)) return;
      for (const imgId of n.images || []) await DB.softDelete("images", imgId);
      await DB.softDelete("notes", n.id);
      closeModal(); toast("Not silindi"); render();
    };

    $("#nt-save").onclick = async () => {
      const title = $("#nt-title").value.trim();
      const body = $("#nt-body").value;
      if (!title && !body.trim() && !att.ids.length) { closeModal(); return; }
      await AttachUI.commitRemovals(att);
      await DB.save("notes", {
        id: n.id, title, body,
        pinned: $("#nt-pin").checked ? 1 : 0,
        images: att.ids
      });
      closeModal(); toast("Not kaydedildi"); render();
    };
  }

  /* --- Tam ekran görsel önizleme --- */
  function showViewer(dataUrl) {
    closeViewer();
    const v = document.createElement("div");
    v.className = "img-viewer";
    v.id = "img-viewer";
    v.innerHTML = `<img src="${dataUrl}" alt="">`;
    v.onclick = closeViewer;
    document.body.appendChild(v);
  }
  function closeViewer() { $("#img-viewer")?.remove(); }

  async function search(q) {
    if (!cache.length) await load();
    q = q.toLocaleLowerCase("tr");
    return cache.filter(n =>
      (n.title || "").toLocaleLowerCase("tr").includes(q) ||
      (n.body || "").toLocaleLowerCase("tr").includes(q)
    ).slice(0, 20);
  }

  return { render, openForm, search, showViewer, closeViewer };
})();
