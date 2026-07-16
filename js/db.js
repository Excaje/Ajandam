/* ============ Yerel veritabanı (IndexedDB) ============
   Tüm veriler önce bu cihazda saklanır; internet olmadan da çalışır.
   Eşitleme için her kayıtta updatedAt ve silinen kayıtlarda deleted=1 tutulur. */
"use strict";

const DB = (() => {
  const NAME = "ajandamDB", VERSION = 1;
  const STORES = ["events", "notes", "images", "vault", "meta"];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  const get = (store, id) => tx(store, "readonly", os => os.get(id));
  const all = (store) => tx(store, "readonly", os => os.getAll());
  const putRaw = (store, obj) => tx(store, "readwrite", os => os.put(obj));
  const delRaw = (store, id) => tx(store, "readwrite", os => os.delete(id));

  /* Kaydet: updatedAt damgala, eşitleyiciye haber ver */
  async function save(store, obj) {
    obj.updatedAt = Date.now();
    await putRaw(store, obj);
    Sync?.markDirty?.();
    return obj;
  }

  /* Yumuşak silme: eşitleme diğer cihaza da silmeyi taşısın diye kayıt tutulur */
  async function softDelete(store, id) {
    const obj = await get(store, id);
    if (!obj) return;
    const tomb = { id: obj.id, deleted: 1, updatedAt: Date.now() };
    await putRaw(store, tomb);
    Sync?.markDirty?.();
  }

  /* Silinmemiş kayıtlar */
  async function live(store) {
    return (await all(store)).filter(x => !x.deleted);
  }

  /* meta deposu: anahtar-değer */
  const metaGet = async (key) => (await get("meta", key))?.value;
  const metaSet = (key, value) => putRaw("meta", { id: key, value });
  const metaDel = (key) => delRaw("meta", key);

  return { open, get, all, live, save, softDelete, putRaw, delRaw, metaGet, metaSet, metaDel };
})();
