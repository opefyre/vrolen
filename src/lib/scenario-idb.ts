/**
 * VROL-425 — IndexedDB scenario cache.
 *
 * Promotes the scenario store to IndexedDB as a backup beyond localStorage.
 * localStorage stays the canonical hot read path (synchronous, simple
 * happy-dom-safe shape); IndexedDB is the durable replica that survives
 * larger payloads + clear-site-data nuances better than LS.
 *
 * API is intentionally tiny: `saveSnapshot(state)` writes the whole
 * `vrolen.scenarios` blob under a single key; `loadSnapshot()` reads it
 * back. Higher-level code in scenario-store.ts owns shape + merging.
 */

const DB_NAME = "vrolen";
const STORE = "scenario-cache";
const KEY = "vrolen.scenarios";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB open failed"));
    };
  });
}

export async function saveSnapshot(state: unknown): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error("IDB save failed"));
      };
    });
    db.close();
  } catch {
    // best-effort — localStorage is the canonical store.
  }
}

export async function loadSnapshot<T = unknown>(): Promise<T | null> {
  try {
    const db = await openDB();
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        resolve((req.result as T | undefined) ?? null);
      };
      req.onerror = () => {
        reject(req.error ?? new Error("IDB read failed"));
      };
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}
