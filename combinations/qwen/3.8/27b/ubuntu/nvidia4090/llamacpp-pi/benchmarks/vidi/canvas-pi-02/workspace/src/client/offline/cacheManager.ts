/**
 * Cache manager for device copies (story 13, offline.cache_manager).
 *
 * Pure eviction functions for unit testing; IndexedDB operations for
 * the cache index database.
 */
import { LOCAL_BOARD_CACHE_MAX_BOARDS, LOCAL_STORAGE_PRESSURE_RATIO, CACHE_INDEX_DB } from '../../shared/config';

export interface CacheEntry {
  boardId: string;
  lastOpenedAt: number;
  unsynced: boolean;
  formatVersion: number;
}

/**
 * Choose which boards to evict to stay within the limit.
 * Sorts by lastOpenedAt ascending; removes oldest entries that are
 * neither unsynced nor the open board until at most `max` remain.
 */
export function chooseEvictions(
  entries: CacheEntry[],
  openBoardId: string,
  max: number = LOCAL_BOARD_CACHE_MAX_BOARDS,
): string[] {
  const total = entries.length;
  if (total <= max) return [];

  const toRemove = total - max;
  // Sort by lastOpenedAt ascending (oldest first).
  const sorted = [...entries].sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);

  const evicted: string[] = [];
  for (const entry of sorted) {
    if (evicted.length >= toRemove) break;
    // Never evict unsynced or the open board.
    if (entry.unsynced) continue;
    if (entry.boardId === openBoardId) continue;
    evicted.push(entry.boardId);
  }

  return evicted;
}

/**
 * Choose which boards to evict under storage pressure.
 * Returns synced, non-open entries oldest first.
 */
export function choosePressureEvictions(
  entries: CacheEntry[],
  openBoardId: string,
): string[] {
  return entries
    .filter((e) => !e.unsynced && e.boardId !== openBoardId)
    .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt)
    .map((e) => e.boardId);
}

// --- IndexedDB index operations (browser only) ---------------------------------

const INDEX_STORE = 'boards';

function openIndexDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_INDEX_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(INDEX_STORE)) {
        db.createObjectStore(INDEX_STORE, { keyPath: 'boardId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Touch a board's cache entry (update lastOpenedAt).
 */
export async function touch(boardId: string): Promise<void> {
  try {
    const db = await openIndexDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INDEX_STORE, 'readwrite');
      const store = tx.objectStore(INDEX_STORE);
      // Read existing to preserve unsynced flag.
      const getReq = store.get(boardId);
      getReq.onsuccess = () => {
        const existing = getReq.result as CacheEntry | undefined;
        store.put({
          boardId,
          lastOpenedAt: Date.now(),
          unsynced: existing?.unsynced ?? false,
          formatVersion: existing?.formatVersion ?? 1,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      getReq.onerror = () => { db.close(); reject(getReq.error); };
    });
  } catch {
    // Swallow: availability handled by localBoardStore.
  }
}

/**
 * Set the unsynced flag for a board.
 */
export async function setUnsynced(boardId: string, unsynced: boolean): Promise<void> {
  try {
    const db = await openIndexDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(INDEX_STORE, 'readwrite');
      const store = tx.objectStore(INDEX_STORE);
      const getReq = store.get(boardId);
      getReq.onsuccess = () => {
        const existing = getReq.result as CacheEntry | undefined;
        store.put({
          boardId,
          lastOpenedAt: existing?.lastOpenedAt ?? Date.now(),
          unsynced,
          formatVersion: existing?.formatVersion ?? 1,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      getReq.onerror = () => { db.close(); reject(getReq.error); };
    });
  } catch {
    // Swallow.
  }
}

/**
 * Check if a board has a device copy.
 */
export async function hasCopy(boardId: string): Promise<boolean> {
  try {
    const db = await openIndexDb();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(INDEX_STORE, 'readonly');
      const store = tx.objectStore(INDEX_STORE);
      const req = store.get(boardId);
      req.onsuccess = () => { db.close(); resolve(req.result !== undefined); };
      req.onerror = () => { db.close(); resolve(false); };
    });
  } catch {
    return false;
  }
}

/**
 * Enforce cache limits and storage pressure eviction.
 * Never throws.
 */
export async function enforceLimits(
  openBoardId: string,
  estimate?: () => Promise<{ usage: number; quota: number }>,
): Promise<{ evicted: string[]; skipped: string[] }> {
  const evicted: string[] = [];
  const skipped: string[] = [];

  try {
    const db = await openIndexDb();

    // Read all entries.
    const entries: CacheEntry[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(INDEX_STORE, 'readonly');
      const store = tx.objectStore(INDEX_STORE);
      const req = store.getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as CacheEntry[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    });

    // Apply limit evictions.
    const limitEvictions = chooseEvictions(entries, openBoardId);
    for (const boardId of limitEvictions) {
      try {
        await deleteBoardDb(boardId);
        await removeIndexEntry(boardId);
        evicted.push(boardId);
      } catch {
        skipped.push(boardId);
      }
    }

    // Storage pressure evictions.
    if (estimate) {
      try {
        const { usage, quota } = await estimate();
        if (quota > 0 && usage / quota > LOCAL_STORAGE_PRESSURE_RATIO) {
          // Re-read entries after limit evictions.
          const remaining = entries.filter((e) => !limitEvictions.includes(e.boardId));
          const pressureCandidates = choosePressureEvictions(remaining, openBoardId);
          for (const boardId of pressureCandidates) {
            try {
              await deleteBoardDb(boardId);
              await removeIndexEntry(boardId);
              evicted.push(boardId);
              // Re-estimate.
              const check = await estimate();
              if (check.quota > 0 && check.usage / check.quota <= LOCAL_STORAGE_PRESSURE_RATIO) break;
            } catch {
              skipped.push(boardId);
            }
          }
        }
      } catch {
        // estimate unsupported or threw — skip pressure step.
      }
    }
  } catch {
    // Never throws.
  }

  return { evicted, skipped };
}

async function deleteBoardDb(boardId: string): Promise<void> {
  const dbName = 'vidi6-board-' + boardId;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
    req.onblocked = () => reject(new Error('blocked'));
  });
}

async function removeIndexEntry(boardId: string): Promise<void> {
  const db = await openIndexDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(INDEX_STORE, 'readwrite');
    tx.objectStore(INDEX_STORE).delete(boardId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
