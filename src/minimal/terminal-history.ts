// ---------------------------------------------------------------------------
// Terminal history — IndexedDB persistence for terminal sessions.
//
// Each open terminal is stored as one record keyed by its persistent id so the
// scrollback survives a page reload and can be restored ("history restore").
// Records are removed only when the user explicitly closes a terminal.
// ---------------------------------------------------------------------------

const DB_NAME = 'webterminal-terminals';
const STORE = 'sessions';
const VERSION = 1;

export interface TerminalSessionRecord {
  id: string;
  title: string;
  cwd: string;
  buffer: string;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(record: TerminalSessionRecord): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(record));
  } catch {
    // Persistence is best-effort — never break the terminal on IDB failure.
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

export async function listSessions(): Promise<TerminalSessionRecord[]> {
  try {
    const all = await withStore<TerminalSessionRecord[]>('readonly', (s) => s.getAll());
    return (all ?? []).sort((a, b) => a.updatedAt - b.updatedAt);
  } catch {
    return [];
  }
}
