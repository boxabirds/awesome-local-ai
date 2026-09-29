/**
 * The per-board asset registry (story 12).
 *
 * One board keeps a `Map` of what it has uploaded and what it knows exists,
 * keyed by asset key. Three rules live here, and each one exists to stop a
 * specific kind of duplicate:
 *
 *  - an asset already uploading is never started a second time (the dedupe
 *    that keeps retry and a second drop from double-uploading the same key);
 *  - the placeholder and the committed entry are the same slot: a late
 *    `asset_updated` for an asset the batch is still placeholdering *finds
 *    the placeholder* and settles it, instead of stranding an identical
 *    sibling next to it;
 *  - settled entries are dropped once they are older than the TTL
 *    (`settledBefore`), because a board that has been open for hours should
 *    not carry a memory of every 404 it ever saw.
 *
 * The registry does not do I/O — that is the uploader's job. It does not
 * read a clock either: `now` is always passed in, so the rules are testable
 * without waiting a day for the TTL to expire.
 */

/** What a registry slot knows about its asset. */
export interface AssetEntry {
  status: 'uploading' | 'committed' | 'failed';
  /** When the upload started (or restarted, after a retry). */
  startedAt: number;
  /** When it settled; `undefined` while it is still in flight. */
  settledAt?: number;
  /**
   * The bytes, kept until the entry settles and for as long as `settledBefore`
   * keeps the entry alive — so a Retry pressed right after a failure has
   * something to re-send. Once the entry is pruned the bytes go with it; a
   * viewer who never had them never did.
   */
  bytes?: Uint8Array;
}

/** How long a settled entry is remembered. A day is longer than anyone
 *  retries; shorter, and a second drop of the same file re-uploads it. */
export const ASSET_TTL_MS = 24 * 60 * 60 * 1000;

export interface AssetRegistry {
  /** The slot for `assetKey`, if there is one. */
  get(boardId: string, assetKey: string): AssetEntry | undefined;
  /**
   * Claim the slot for an upload. False when the key is already uploading —
   * that is the dedupe, and the caller must not start a second upload.
   * `bytes` rides along so a later Retry can re-send them.
   */
  begin(boardId: string, assetKey: string, now: number, bytes?: Uint8Array): boolean;
  /**
   * Settle a slot. An existing placeholder is updated in place — never
   * replaced by a second identical entry. A settle for a key nobody was
   * tracking creates a committed/failed slot, so the next sighting of the
   * same key is answered from memory instead of another request.
   */
  settle(boardId: string, assetKey: string, status: 'committed' | 'failed', now: number): void;
  /** Drop settled entries older than the TTL. Returns how many went. */
  settleBefore(boardId: string, now: number): number;
  /** Forget a board entirely (its document is gone; the memory is dead weight). */
  forgetBoard(boardId: string): void;
}

export function createAssetRegistry(ttlMs: number = ASSET_TTL_MS): AssetRegistry {
  const boards = new Map<string, Map<string, AssetEntry>>();

  const slots = (boardId: string): Map<string, AssetEntry> => {
    let board = boards.get(boardId);
    if (!board) {
      board = new Map<string, AssetEntry>();
      boards.set(boardId, board);
    }
    return board;
  };

  return {
    get(boardId, assetKey) {
      return boards.get(boardId)?.get(assetKey);
    },
    begin(boardId, assetKey, now, bytes) {
      const board = slots(boardId);
      const existing = board.get(assetKey);
      if (existing && existing.status === 'uploading') return false;
      board.set(assetKey, {
        status: 'uploading',
        startedAt: now,
        bytes,
      });
      return true;
    },
    settle(boardId, assetKey, status, now) {
      const board = slots(boardId);
      const existing = board.get(assetKey);
      if (existing) {
        existing.status = status;
        existing.settledAt = now;
        // The bytes have served their purpose: the upload answered.
        delete existing.bytes;
        return;
      }
      board.set(assetKey, { status, startedAt: now, settledAt: now });
    },
    settleBefore(boardId, now) {
      const board = boards.get(boardId);
      if (!board) return 0;
      let removed = 0;
      for (const [key, entry] of [...board]) {
        if (entry.status !== 'uploading' && entry.settledAt !== undefined
          && now - entry.settledAt >= ttlMs) {
          board.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    forgetBoard(boardId) {
      boards.delete(boardId);
    },
  };
}