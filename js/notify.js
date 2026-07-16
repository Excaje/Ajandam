/* ============ Bildirim ve Alarm ============
   Uygulama açıkken (veya arka plandaki sekmede/PWA'da) hatırlatıcıları
   düzenli aralıklarla kontrol eder, zamanı gelince sistem bildirimi
   gösterir; alarm işaretliyse ses çalar ve tam ekran uyarı açar. */
"use strict";

const Notify = (() => {
  const FIRED_KEY = "firedReminders";
  const CHECK_MS = 20_000;
  let audioCtx = null, alarmTimer = null, alarmStopper = null;

  function ensurePermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") Notification.requestPermission();
  }

  function firedMap() {
    try { return JSON.parse(localStorage.getItem(FIRED_KEY)) || {}; } catch { return {}; }
  }
  function markFired(key) {
    const m = firedMap();
    m[key] = Date.now();
    // 3 günden eski kayıtları temizle
    const limit = Date.now() - 3 * 86_400_000;
    for (const k in m) if (m[k] < limit) delete m[k];
    localStorage.setItem(FIRED_KEY, JSON.stringify(m));
  }

  async function check() {
    if (localStorage.getItem("notifOn") === "0") return;
    const events = (await DB.live("events")).filter(e => e.time && (e.remind !== "" && e.remind != null || e.alarm));
    if (!events.length) return;
    const now = Date.now();
    const fired = firedMap();

    for (let dOff = 0; dOff <= 1; dOff++) {
      const day = addDays(todayStr(), dOff);
      for (const ev of events) {
        if (!Calendar.occursOn(ev, day)) continue;
        const [h, m] = ev.time.split(":").map(Number);
        const evTime = parseDate(day).setHours(h, m, 0, 0);
        const remindMin = (ev.remind === "" || ev.remind == null) ? 0 : Number(ev.remind);
        const fireAt = evTime - remindMin * 60_000;
        const key = `${ev.id}|${day}|${remindMin}`;
        // zamanı geldiyse ve son 15 dk içindeyse (uygulama kapalıyken kaçanı açılışta yakala)
        if (now >= fireAt && now - fireAt < 15 * 60_000 && !fired[key]) {
          markFired(key);
          fire(ev, day, remindMin);
        }
      }
    }
  }

  function fire(ev, day, remindMin) {
    const when = remindMin === 0 ? `Şimdi · ${ev.time}` : `${remindMin >= 60 ? (remindMin / 60) + " saat" : remindMin + " dk"} sonra · ${ev.time}`;
    const body = `${when}${ev.desc ? "\n" + ev.desc : ""}`;

    if ("Notification" in window && Notification.permission === "granted") {
      const opts = {
        body, tag: ev.id + day,
        icon: "icons/icon-192.png", badge: "icons/icon-192.png",
        requireInteraction: !!ev.alarm,
        vibrate: ev.alarm ? [400, 150, 400, 150, 600] : [200, 100, 200],
      };
      navigator.serviceWorker?.getRegistration().then(reg => {
        if (reg) reg.showNotification("⏰ " + ev.title, opts);
        else new Notification("⏰ " + ev.title, opts);
      }).catch(() => { try { new Notification("⏰ " + ev.title, opts); } catch {} });
    }

    if (ev.alarm) startAlarm(ev, when);
    else beep(2);
  }

  /* --- Alarm: tam ekran + ses --- */
  function startAlarm(ev, when) {
    $("#alarm-title").textContent = ev.title;
    $("#alarm-time").textContent = when;
    $("#alarm-overlay").classList.remove("hidden");
    let count = 0;
    stopAlarmSound();
    alarmTimer = setInterval(() => {
      beep(3);
      if (++count > 40) stopAlarm(); // ~2 dk sonra kendiliğinden sus
    }, 3000);
    beep(3);
    alarmStopper = () => stopAlarm();
    $("#alarm-stop").onclick = alarmStopper;
  }
  function stopAlarm() {
    $("#alarm-overlay").classList.add("hidden");
    stopAlarmSound();
  }
  function stopAlarmSound() {
    if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  }

  /* --- Basit zil sesi (dosya gerekmez, WebAudio) --- */
  function beep(times = 1) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      for (let i = 0; i < times; i++) {
        const t0 = audioCtx.currentTime + i * 0.45;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, t0);
        osc.frequency.setValueAtTime(1174, t0 + 0.15);
        gain.gain.setValueAtTime(0.001, t0);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0); osc.stop(t0 + 0.42);
      }
    } catch { /* ses açılamadı */ }
  }

  function reschedule() { check(); }

  function init() {
    setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    check();
  }

  return { init, check, reschedule, ensurePermission, beep };
})();
