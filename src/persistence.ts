import { SCHEMA_VERSION, type AudiobookState } from "./types";

const DB_NAME = "plaudio";
const STORE = "audiobooks";
const HANDLE_STORE = "handles";
const DB_VERSION = 2;
const LAST_BOOK_KEY = "plaudio.lastBookId";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("INDEXEDDB_UNAVAILABLE"));
  }
  const existing = dbPromise;
  if (existing) return existing;

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED"));
    request.onblocked = () => reject(new Error("INDEXEDDB_BLOCKED"));
  });

  dbPromise = attempt;
  void attempt.catch(() => {
    if (dbPromise === attempt) dbPromise = null;
  });
  return attempt;
}

export async function isPersistenceAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

export async function loadBookState(id: string): Promise<AudiobookState | undefined> {
  try {
    const db = await openDb();
    return await new Promise<AudiobookState | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(id);
      request.onsuccess = () => {
        const value = request.result as AudiobookState | undefined;
        if (!value || typeof value.position !== "number" || !Number.isFinite(value.position)) {
          resolve(undefined);
          return;
        }
        resolve(value);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("[plaudio] no se pudo leer el progreso", error);
    return undefined;
  }
}

export async function saveBookState(state: AudiobookState): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(state);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("[plaudio] no se pudo guardar el progreso", error);
  }
}

export function buildStateRecord(params: {
  id: string;
  filename: string;
  position: number;
  playbackRate: number;
  duration?: number;
  title?: string;
  author?: string;
}): AudiobookState {
  return {
    id: params.id,
    filename: params.filename,
    position: Math.max(0, params.position),
    playbackRate: params.playbackRate,
    duration: params.duration,
    title: params.title,
    author: params.author,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
  };
}

interface StoredHandle {
  id: string;
  handle: FileSystemFileHandle;
}

export async function saveFileHandle(id: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE, "readwrite");
      transaction.objectStore(HANDLE_STORE).put({ id, handle } satisfies StoredHandle);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch (error) {
    console.warn("[plaudio] no se pudo guardar el acceso al archivo", error);
  }
}

export async function getFileHandle(id: string): Promise<FileSystemFileHandle | undefined> {
  try {
    const db = await openDb();
    return await new Promise<FileSystemFileHandle | undefined>((resolve, reject) => {
      const transaction = db.transaction(HANDLE_STORE, "readonly");
      const request = transaction.objectStore(HANDLE_STORE).get(id);
      request.onsuccess = () => {
        const value = request.result as StoredHandle | undefined;
        resolve(value?.handle);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn("[plaudio] no se pudo leer el acceso al archivo", error);
    return undefined;
  }
}

export function getLastBookId(): string | undefined {
  try {
    return localStorage.getItem(LAST_BOOK_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setLastBookId(id: string): void {
  try {
    localStorage.setItem(LAST_BOOK_KEY, id);
  } catch {
    /* almacenamiento no disponible */
  }
}
