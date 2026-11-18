import type { InvestigationCase } from '../types/geoint';

const DB_NAME = 'crimnex_geoint_db';
const DB_VERSION = 1;
const STORE_CASES = 'cases';

export interface StoredCaseRecord {
  caseData: InvestigationCase;
  thumbnailDataUrl: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CASES)) {
        db.createObjectStore(STORE_CASES, { keyPath: 'caseData.caseId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB.'));
  });
}

export async function createThumbnailDataUrl(blob: Blob, maxEdge = 320): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    bitmap.close();
  }
}

export async function saveLocalSession(record: StoredCaseRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CASES, 'readwrite');
    tx.objectStore(STORE_CASES).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to persist session.'));
    };
  });
}

export async function listLocalSessions(): Promise<StoredCaseRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CASES, 'readonly');
      const req = tx.objectStore(STORE_CASES).getAll();
      req.onsuccess = () => {
        db.close();
        const rows = (req.result as StoredCaseRecord[]) || [];
        rows.sort((a, b) =>
          b.caseData.updatedAtIso.localeCompare(a.caseData.updatedAtIso)
        );
        resolve(rows);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return [];
  }
}

export async function deleteLocalSession(caseId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CASES, 'readwrite');
    tx.objectStore(STORE_CASES).delete(caseId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function clearAllLocalSessions(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CASES, 'readwrite');
    tx.objectStore(STORE_CASES).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
