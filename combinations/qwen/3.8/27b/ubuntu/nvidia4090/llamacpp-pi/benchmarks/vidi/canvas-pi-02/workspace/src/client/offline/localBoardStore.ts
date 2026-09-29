/**
 * Device copy store (story 13, offline.local_store).
 *
 * Pure functions for unit testing; the IndexedDB operations use
 * y-indexeddb for persistence.
 */
import * as Y from 'yjs';
import { LOCAL_DB_PREFIX, LOCAL_COPY_FORMAT_VERSION } from '../../shared/config';

export type Availability = 'available' | 'unavailable';

/**
 * Return the IndexedDB database name for a board's device copy.
 */
export function localDbName(boardId: string): string {
  return LOCAL_DB_PREFIX + boardId;
}

/**
 * Check whether a copy's format version is usable.
 * A mismatch means the copy should be treated as absent.
 */
export function isUsableCopy(formatVersion: number | null | undefined): boolean {
  return formatVersion === LOCAL_COPY_FORMAT_VERSION;
}

/**
 * Probe whether IndexedDB is available on this device.
 * Opens a probe database, writes and reads a record, then cleans up.
 * Any failure returns 'unavailable'.
 */
export async function probeAvailability(factory?: IDBFactory): Promise<Availability> {
  const idb = factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (idb === null || idb === undefined) return 'unavailable';

  const PROBE_DB = 'vidi6-probe';
  const PROBE_STORE = 'probe';

  try {
    await new Promise<void>((resolve, reject) => {
      const req = idb.open(PROBE_DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(PROBE_STORE);
      };
      req.onerror = () => reject(req.error ?? new Error('open failed'));
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(PROBE_STORE, 'readwrite');
          const store = tx.objectStore(PROBE_STORE);
          store.put('ok', 'probe');
          tx.oncomplete = () => {
            // Read back.
            const rtx = db.transaction(PROBE_STORE, 'readonly');
            const rstore = rtx.objectStore(PROBE_STORE);
            const getReq = rstore.get('probe');
            getReq.onsuccess = () => {
              if (getReq.result === 'ok') {
                // Delete the probe record and close.
                const dtx = db.transaction(PROBE_STORE, 'readwrite');
                dtx.objectStore(PROBE_STORE).delete('probe');
                dtx.oncomplete = () => {
                  db.close();
                  // Delete the database.
                  const delReq = idb.deleteDatabase(PROBE_DB);
                  delReq.onsuccess = () => resolve();
                  delReq.onerror = () => resolve(); // best effort
                };
                dtx.onerror = () => { db.close(); resolve(); };
              } else {
                db.close();
                reject(new Error('probe read failed'));
              }
            };
            getReq.onerror = () => { db.close(); reject(getReq.error ?? new Error('get failed')); };
          };
          tx.onerror = () => { db.close(); reject(tx.error ?? new Error('tx failed')); };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
    });
    return 'available';
  } catch {
    return 'unavailable';
  }
}

/**
 * Open a local device copy for a board, loading it into the given Y.Doc.
 * If the load times out, returns { loaded: false, timedOut: true, persistence: null }.
 */
export async function openLocalCopy(
  boardId: string,
  doc: Y.Doc,
  timeoutMs: number = 2000,
): Promise<{ loaded: boolean; timedOut: boolean; persistence: unknown | null }> {
  const db = typeof indexedDB !== 'undefined' ? indexedDB : null;
  if (db === null) return { loaded: false, timedOut: false, persistence: null };

  const dbName = localDbName(boardId);

  // Check if the database exists.
  const dbs = await (typeof indexedDB.databases === 'function'
    ? indexedDB.databases().catch(() => [] as IDBDatabaseInfo[])
    : Promise.resolve([] as IDBDatabaseInfo[]));

  const exists = dbs.some((d) => d.name === dbName);
  if (!exists) return { loaded: false, timedOut: false, persistence: null };

  // Try to load via y-indexeddb.
  try {
    const yIndexeddb = await import(/* webpackIgnore: true */ 'y-indexeddb' as string);
    const IndexeddbPersistence = (yIndexeddb as { default: new (id: string, doc: Y.Doc) => { whenSynced: Promise<void>; destroy?: () => Promise<void> } }).default;
    const persistence = new IndexeddbPersistence(dbName, doc);

    // Race whenSynced against timeout.
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });

    try {
      await Promise.race([persistence.whenSynced, timeout]);
      return { loaded: true, timedOut: false, persistence };
    } catch {
      // Timed out — destroy the persistence and continue without copy.
      try { (persistence as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
      return { loaded: false, timedOut: true, persistence: null };
    }
  } catch {
    return { loaded: false, timedOut: false, persistence: null };
  }
}

/**
 * Discard a device copy: delete the database and remove the index entry.
 * Rejects if deleteDatabase fails.
 */
export async function discardCopy(boardId: string): Promise<void> {
  const db = typeof indexedDB !== 'undefined' ? indexedDB : null;
  if (db === null) throw new Error('IndexedDB unavailable');

  const dbName = localDbName(boardId);

  await new Promise<void>((resolve, reject) => {
    const req = db.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('deleteDatabase failed'));
    req.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}

/**
 * Register a listener for QuotaExceededError via unhandledrejection.
 * Returns an unsubscribe function.
 */
export function onQuotaExceeded(listener: () => void): () => void {
  const handler = (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    if (reason instanceof DOMException && reason.name === 'QuotaExceededError') {
      listener();
    }
  };
  window.addEventListener('unhandledrejection', handler);
  return () => window.removeEventListener('unhandledrejection', handler);
}
