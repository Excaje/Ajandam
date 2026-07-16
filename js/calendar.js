/* ============ Ajanda ============ */
"use strict";

/* --- Ortak görsel ekleme bileşeni (ajanda + notlar kullanır) --- */
const AttachUI = {
  /* container içine mevcut görselleri ve + düğmesini çizer; state.ids günceller */
  async render(container, state) {
    container.innerHTML = "";
    for (const id of state.ids) {
      const img = await DB.get("images", id);
      if (!img || img.deleted) continue;
      const div = document.createElement("div");
      div.className = "att";
      div.innerHTML = `<img src="${img.data}" alt=""><button type="button" class="rm">✕</button>`;
      div.querySelector("img").onclick = () => Notes.showViewer(img.data);
      div.querySelector(".rm").onclick = async (e) => {
        e.stopPropagation();
        state.ids = state.ids.filter(x => x !== id);
        state.removed.push(id);
        AttachUI.render(container, state);
      };
      container.appendChild(div);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "img-add-btn";
    add.textContent = "＋";
    add.title = "Görsel ekle";
    add.onclick = () => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.multiple = true;
      inp.onchange = async () => {
        for (const f of inp.files) {
          try {
            const data = await compressImage(f);
            const rec = { id: uid(), data };
            await DB.save("images", rec);
            state.ids.push(rec.id);
          } catch { toast("Görsel eklenemedi"); }
        }
        AttachUI.render(container, state);
      };
      inp.click();
    };
    container.appendChild(add);
  },
  /* formdan vazgeçilirse yeni eklenenleri geri almak yerine basit tutuyoruz;
     kaldırılanlar kaydetme anında gerçekten silinir */
  async commitRemovals(state) {
    for (const id of state.removed) await DB.softDelete("images", id);
  }
};

const Calendar = (() => {
  const COLORS = ["#5b5ce2", "#e05252", "#e8883a", "#d4a11e", "#2fa76a", "#2a9d9f", "#3a7be8", "#b04fd4"];
  const RECUR_TR = { none: "", daily: "Her gün", weekly: "Her hafta", monthly: "Her ay", yearly: "Her yıl" };

  let cursor = todayStr();   // görünümün odaklandığı tarih
  let view = "month";        // day | week | month | year
  let cache = [];            // silinmemiş etkinlikler

  async function load() { cache = await DB.live("events"); }

  /* --- Tekrarlama: etkinlik verilen günde geçer mi? --- */
  function occursOn(ev, dstr) {
    if (dstr < ev.date) return false;
    if (ev.recur === "none" || !ev.recur) return dstr === ev.date;
    if (ev.recurEnd && dstr > ev.recurEnd) return false;
    const d = parseDate(dstr), s = parseDate(ev.date);
    switch (ev.recur) {
      case "daily":   return true;
      case "weekly":  return d.getDay() === s.getDay();
      case "monthly": return d.getDate() === s.getDate();
      case "yearly":  return d.getDate() === s.getDate() && d.getMonth() === s.getMonth();
      default: return false;
    }
  }

  function eventsOn(dstr) {
    return cache
      .filter(ev => occursOn(ev, dstr))
      .sort((a, b) => (a.time || "99") < (b.time || "99") ? -1 : 1);
  }

  /* ================= GÖRÜNÜMLER ================= */
  async function render() {
    await load();
    $$(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.calview === view));
    const body = $("#cal-body");
    if (view === "month") renderMonth(body);
    else if (view === "year") renderYear(body);
    else renderDays(body, view === "day" ? 1 : 7);
  }

  function renderMonth(body) {
    const d = parseDate(cursor);
    $("#cal-title").textContent = `${AYLAR[d.getMonth()]} ${d.getFullYear()}`;
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    let start = fmtDate(first);
    start = addDays(start, -dowMon(first)); // ızgara pazartesiden başlar

    let html = `<div class="month-grid">`;
    for (const g of GUNLER_KISA) html += `<div class="dow">${g}</div>`;
    let cur = start;
    for (let i = 0; i < 42; i++) {
      const cd = parseDate(cur);
      const inMonth = cd.getMonth() === d.getMonth();
      const isToday = cur === todayStr();
      const evs = eventsOn(cur);
      html += `<div class="day-cell ${inMonth ? "" : "other"} ${isToday ? "today" : ""}" data-date="${cur}">
        <span class="day-num">${cd.getDate()}</span>`;
      evs.slice(0, 3).forEach(ev => {
        html += `<div class="ev-chip" style="background:${ev.color}">${ev.time ? ev.time + " " : ""}${escapeHtml(ev.title)}</div>`;
      });
      if (evs.length > 3) html += `<span class="ev-more">+${evs.length - 3} daha</span>`;
      html += `</div>`;
      cur = addDays(cur, 1);
    }
    html += `</div>`;
    body.innerHTML = html;
    $$(".day-cell", body).forEach(c => c.onclick = () => { cursor = c.dataset.date; view = "day"; render(); });
  }

  function renderDays(body, count) {
    let start = cursor;
    if (count === 7) start = addDays(cursor, -dowMon(parseDate(cursor)));
    const end = addDays(start, count - 1);
    $("#cal-title").textContent = count === 1
      ? trDateLong(cursor)
      : `${trDateShort(start)} – ${trDateShort(end)} ${parseDate(end).getFullYear()}`;

    let html = `<div class="day-list">`;
    for (let i = 0; i < count; i++) {
      const day = addDays(start, i);
      const evs = eventsOn(day);
      const isToday = day === todayStr();
      html += `<div class="day-block">
        <div class="day-block-head ${isToday ? "today-head" : ""}" data-date="${day}">
          <span>${trDateLong(day)}${isToday ? " · Bugün" : ""}</span>
          <button class="add-mini" data-add="${day}" title="Bu güne ekle">＋</button>
        </div>`;
      if (!evs.length) html += `<div class="no-events">Etkinlik yok</div>`;
      for (const ev of evs) {
        const flags = [
          ev.recur && ev.recur !== "none" ? "🔁" : "",
          ev.alarm ? "⏰" : (ev.remind != null && ev.remind !== "" ? "🔔" : ""),
          ev.images?.length ? "🖼️" : ""
        ].filter(Boolean).join(" ");
        const timeLabel = ev.time ? (ev.endTime ? `${ev.time}–${ev.endTime}` : ev.time) : "—";
        html += `<div class="event-row" data-ev="${ev.id}" data-date="${day}">
          <span class="ev-dot" style="background:${ev.color}"></span>
          <span class="ev-time">${timeLabel}</span>
          <span class="ev-name">${escapeHtml(ev.title)}</span>
          <span class="ev-flags">${flags}</span>
        </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    body.innerHTML = html;
    $$(".event-row", body).forEach(r => r.onclick = () => openForm(null, r.dataset.ev));
    $$(".add-mini", body).forEach(b => b.onclick = (e) => { e.stopPropagation(); openForm(b.dataset.add); });
  }

  function renderYear(body) {
    const y = parseDate(cursor).getFullYear();
    $("#cal-title").textContent = String(y);
    // yıl içinde etkinliği olan günleri hızlıca işaretle
    const marked = new Set();
    for (let m = 0; m < 12; m++) {
      const dim = new Date(y, m + 1, 0).getDate();
      for (let g = 1; g <= dim; g++) {
        const ds = fmtDate(new Date(y, m, g));
        if (cache.some(ev => occursOn(ev, ds))) marked.add(ds);
      }
    }
    let html = `<div class="year-grid">`;
    for (let m = 0; m < 12; m++) {
      html += `<div class="mini-month" data-month="${m}"><h4>${AYLAR[m]}</h4><div class="mini-grid">`;
      for (const g of GUNLER_KISA) html += `<div class="mini-day" style="font-weight:700">${g[0]}</div>`;
      const first = new Date(y, m, 1);
      for (let i = 0; i < dowMon(first); i++) html += `<div></div>`;
      const dim = new Date(y, m + 1, 0).getDate();
      for (let g = 1; g <= dim; g++) {
        const ds = fmtDate(new Date(y, m, g));
        html += `<div class="mini-day ${marked.has(ds) ? "has-ev" : ""} ${ds === todayStr() ? "today" : ""}">${g}</div>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;
    body.innerHTML = html;
    $$(".mini-month", body).forEach(mm => mm.onclick = () => {
      cursor = fmtDate(new Date(y, Number(mm.dataset.month), 1));
      view = "month"; render();
    });
  }

  /* ================= GEZİNME ================= */
  function move(dir) {
    const d = parseDate(cursor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "week") d.setDate(d.getDate() + 7 * dir);
    else if (view === "day") d.setDate(d.getDate() + dir);
    else d.setFullYear(d.getFullYear() + dir);
    cursor = fmtDate(d);
    render();
  }

  /* ================= ETKİNLİK FORMU ================= */
  async function openForm(dateStr, evId) {
    let ev = evId ? cache.find(x => x.id === evId) : null;
    if (evId && !ev) ev = await DB.get("events", evId);
    const isNew = !ev;
    ev = ev || {
      id: uid(), title: "", desc: "", date: dateStr || cursor, time: "", endTime: "",
      recur: "none", recurEnd: "", remind: "", alarm: false,
      color: COLORS[0], images: []
    };
    const att = { ids: [...(ev.images || [])], removed: [] };

    openModal(`
      <h2>${isNew ? "Yeni Etkinlik" : "Etkinliği Düzenle"} <button class="close-x">✕</button></h2>
      <form id="ev-form" class="form-grid">
        <div><label>Başlık</label><input type="text" id="ev-title" required maxlength="120" value="${escapeHtml(ev.title)}" placeholder="Ne yapılacak?"></div>
        <div><label>Tarih</label><input type="date" id="ev-date" required value="${ev.date}"></div>
        <div class="form-row2">
          <div><label>Başlangıç saati (isteğe bağlı)</label><input type="time" id="ev-time" value="${ev.time || ""}"></div>
          <div><label>Bitiş saati (isteğe bağlı)</label><input type="time" id="ev-endtime" value="${ev.endTime || ""}"></div>
        </div>
        <div class="form-row2">
          <div><label>Tekrar</label>
            <select id="ev-recur">
              <option value="none">Tekrarlama</option>
              <option value="daily">Her gün</option>
              <option value="weekly">Her hafta</option>
              <option value="monthly">Her ay</option>
              <option value="yearly">Her yıl</option>
            </select>
          </div>
          <div id="ev-recur-end-wrap" class="hidden"><label>Tekrar bitişi</label><input type="date" id="ev-recur-end" value="${ev.recurEnd || ""}"></div>
        </div>
        <div class="form-row2">
          <div><label>Hatırlatıcı</label>
            <select id="ev-remind">
              <option value="">Yok</option>
              <option value="0">Tam zamanında</option>
              <option value="5">5 dk önce</option>
              <option value="10">10 dk önce</option>
              <option value="30">30 dk önce</option>
              <option value="60">1 saat önce</option>
              <option value="1440">1 gün önce</option>
            </select>
          </div>
          <div style="display:flex;align-items:flex-end;padding-bottom:6px">
            <label class="form-check" style="color:var(--text)"><input type="checkbox" id="ev-alarm" ${ev.alarm ? "checked" : ""}> Alarm çalsın ⏰</label>
          </div>
        </div>
        <div><label>Renk</label>
          <div class="color-row">${COLORS.map(c =>
            `<div class="color-opt ${c === ev.color ? "sel" : ""}" data-c="${c}" style="background:${c}"></div>`).join("")}
          </div>
        </div>
        <div><label>Açıklama</label><textarea id="ev-desc" rows="3" placeholder="Notlar, ayrıntılar…">${escapeHtml(ev.desc || "")}</textarea></div>
        <div><label>Görseller</label><div class="img-attach" id="ev-attach"></div></div>
      </form>
      <div class="modal-actions">
        ${isNew ? "" : `<button class="btn btn-danger" id="ev-delete">Sil</button>`}
        <button class="btn btn-ghost close-x2" id="ev-cancel">Vazgeç</button>
        <button class="btn btn-primary" id="ev-save">Kaydet</button>
      </div>`);

    $("#ev-recur").value = ev.recur || "none";
    $("#ev-remind").value = ev.remind === 0 ? "0" : (ev.remind || "");
    const toggleRecurEnd = () => $("#ev-recur-end-wrap").classList.toggle("hidden", $("#ev-recur").value === "none");
    toggleRecurEnd();
    $("#ev-recur").onchange = toggleRecurEnd;

    let color = ev.color;
    $$(".color-opt").forEach(o => o.onclick = () => {
      $$(".color-opt").forEach(x => x.classList.remove("sel"));
      o.classList.add("sel"); color = o.dataset.c;
    });

    AttachUI.render($("#ev-attach"), att);
    $("#ev-cancel").onclick = closeModal;

    if (!isNew) $("#ev-delete").onclick = async () => {
      if (!await confirmBox(`"${ev.title}" etkinliği silinsin mi?`)) return;
      for (const imgId of ev.images || []) await DB.softDelete("images", imgId);
      await DB.softDelete("events", ev.id);
      closeModal(); toast("Etkinlik silindi");
      render(); Notify.reschedule();
    };

    $("#ev-save").onclick = async () => {
      const title = $("#ev-title").value.trim();
      if (!title) { $("#ev-title").focus(); return; }
      const remindVal = $("#ev-remind").value;
      const obj = {
        id: ev.id, title,
        desc: $("#ev-desc").value.trim(),
        date: $("#ev-date").value,
        time: $("#ev-time").value || "",
        endTime: $("#ev-endtime").value || "",
        recur: $("#ev-recur").value,
        recurEnd: $("#ev-recur").value === "none" ? "" : $("#ev-recur-end").value,
        remind: remindVal === "" ? "" : Number(remindVal),
        alarm: $("#ev-alarm").checked,
        color, images: att.ids
      };
      if ((obj.remind !== "" || obj.alarm) && !obj.time) {
        toast("Hatırlatıcı için başlangıç saati girmelisin"); return;
      }
      if (obj.endTime && !obj.time) {
        toast("Bitiş saati için önce başlangıç saati gir"); return;
      }
      if (obj.endTime && obj.endTime <= obj.time) {
        toast("Bitiş saati başlangıçtan sonra olmalı"); return;
      }
      await AttachUI.commitRemovals(att);
      await DB.save("events", obj);
      closeModal(); toast(isNew ? "Etkinlik eklendi" : "Kaydedildi");
      render(); Notify.reschedule();
      Notify.ensurePermission();
    };
  }

  /* --- Arama --- */
  async function search(q) {
    if (!cache.length) await load();
    q = q.toLocaleLowerCase("tr");
    return cache.filter(ev =>
      ev.title.toLocaleLowerCase("tr").includes(q) ||
      (ev.desc || "").toLocaleLowerCase("tr").includes(q)
    ).slice(0, 20);
  }

  /* --- Başlat --- */
  function init() {
    $("#cal-prev").onclick = () => move(-1);
    $("#cal-next").onclick = () => move(1);
    $("#cal-today").onclick = () => { cursor = todayStr(); render(); };
    $$(".seg-btn").forEach(b => b.onclick = () => { view = b.dataset.calview; render(); });
  }

  function gotoDate(dstr) { cursor = dstr; view = "day"; render(); }

  return { init, render, openForm, eventsOn, occursOn, search, gotoDate, get cache() { return cache; }, RECUR_TR };
})();
