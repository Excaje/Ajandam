/* ============ Yardımcı fonksiyonlar ============ */
"use strict";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

const AYLAR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const GUNLER = ["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Pazar"];
const GUNLER_KISA = ["Pzt","Sal","Çar","Per","Cum","Cmt","Paz"];

/* --- Tarih yardımcıları (yerel saat, "YYYY-MM-DD") --- */
function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}
function parseDate(s) { const [y, m, g] = s.split("-").map(Number); return new Date(y, m - 1, g); }
function todayStr() { return fmtDate(new Date()); }
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
// Pazartesi=0 olacak şekilde haftanın günü
function dowMon(d) { return (d.getDay() + 6) % 7; }
function trDateLong(s) {
  const d = parseDate(s);
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${d.getFullYear()}, ${GUNLER[dowMon(d)]}`;
}
function trDateShort(s) {
  const d = parseDate(s);
  return `${d.getDate()} ${AYLAR[d.getMonth()].slice(0, 3)}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* --- Toast --- */
function toast(msg, ms = 2400) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* --- Modal --- */
function openModal(html) {
  const bd = $("#modal-backdrop");
  $("#modal").innerHTML = html;
  bd.classList.remove("hidden");
  const first = $("#modal input, #modal textarea");
  if (first && window.matchMedia("(min-width: 900px)").matches) first.focus();
}
function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  $("#modal").innerHTML = "";
}
document.addEventListener("click", e => {
  if (e.target.id === "modal-backdrop") closeModal();
  if (e.target.classList?.contains("close-x")) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeModal(); Notes?.closeViewer?.(); }
});

/* --- Onay kutusu --- */
function confirmBox(msg) {
  return new Promise(res => {
    openModal(`
      <h2>Emin misin?</h2>
      <p style="color:var(--text2);line-height:1.55">${escapeHtml(msg)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cf-no">Vazgeç</button>
        <button class="btn btn-primary" id="cf-yes" style="background:var(--danger)">Evet, sil</button>
      </div>`);
    $("#cf-no").onclick = () => { closeModal(); res(false); };
    $("#cf-yes").onclick = () => { closeModal(); res(true); };
  });
}

/* --- Görsel sıkıştırma: File -> dataURL (eşitleme için küçültülür) --- */
function compressImage(file, maxDim = 1400, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxDim) {
        const k = maxDim / Math.max(w, h);
        w = Math.round(w * k); h = Math.round(h * k);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      let out = cv.toDataURL("image/jpeg", quality);
      // Firestore belge sınırı (~1MB) için gerekirse daha çok sıkıştır
      if (out.length > 800_000) out = cv.toDataURL("image/jpeg", 0.55);
      if (out.length > 800_000) {
        const cv2 = document.createElement("canvas");
        const k2 = 900 / Math.max(w, h);
        cv2.width = Math.round(w * Math.min(1, k2)); cv2.height = Math.round(h * Math.min(1, k2));
        cv2.getContext("2d").drawImage(img, 0, 0, cv2.width, cv2.height);
        out = cv2.toDataURL("image/jpeg", 0.55);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel okunamadı")); };
    img.src = url;
  });
}

/* --- Panoya kopyala --- */
async function copyText(txt, label = "Kopyalandı") {
  try {
    await navigator.clipboard.writeText(txt);
    toast(label + " 📋");
  } catch {
    toast("Kopyalanamadı");
  }
}

/* --- base64 <-> ArrayBuffer --- */
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
