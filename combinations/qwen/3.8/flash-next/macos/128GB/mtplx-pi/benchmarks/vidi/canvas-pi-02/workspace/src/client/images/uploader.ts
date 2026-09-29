/**
 * The image uploader (story 12).
 *
 * Turns local bytes into bucket bytes, and the document's image entries from
 * `uploading` into `ready` or `failed` when the answers come back. Three
 * rules decide its shape:
 *
 *  - every image in a batch is uploaded **concurrently** — a slow 40 MB
 *    photo must not block the 20 KB icon behind it (design §"The contract",
 *    "in-flight uploads don't block the others");
 *  - an asset key that is already uploading is **not started again** — the
 *    registry says so, and the second attempt is skipped, not queued;
 *  - a Retry asks the server first: if the bytes are in the bucket the entry
 *    is committed straight away; if they are not, a Retry that still holds
 *    the bytes re-sends them under the same key (never a new key: that is
 *    how a retry lands on the placeholder it is retrying), and anything that
 *    still fails is `failed`. Nobody re-uploads behind your back: after the
 *    five-minute unfinished flip nothing fires on a timer.
 *
 * `fetchImpl` and the clock are injected for the same reason they are in
 * `api.ts`: the component tests drive success, failure and slowness without
 * a network.
 */
import { markImageFailed, markImageReady, markImageRetrying } from '../../shared/objects/image';
import { createAssetRegistry, type AssetRegistry } from '../board/assetRegistry';
import type { FetchImpl } from '../api';
import type * as Y from 'yjs';

/** One image waiting to go up: the document entry it belongs to, and its bytes. */
export interface UploadItem {
  /** The document entry's id. */
  id: string;
  /** `<boardId>/<assetId>` — the serving key, and the registry slot's name. */
  assetKey: string;
  bytes: Uint8Array;
}

export interface ImageUploaderOptions {
  registry?: AssetRegistry;
  fetchImpl?: FetchImpl;
  /** Millisecond clock; defaults to `Date.now`. */
  now?: () => number;
}

export interface ImageUploader {
  readonly registry: AssetRegistry;
  /**
   * Upload every item, concurrently. Resolves when all of them have settled;
   * the document has been told about each one as its answer arrived. Items
   * whose key was already uploading are skipped.
   */
  uploadAll(doc: Y.Doc, boardId: string, items: readonly UploadItem[]): Promise<void>;
  /**
   * Retry one entry. Asks the server whether the bytes are already there;
   * re-sends them if they are not and this client still has them. Either way
   * the attempt restarts the entry's clock (design: retry "starts a fresh
   * five-minute window").
   */
  retry(doc: Y.Doc, boardId: string, item: UploadItem & { bytes?: Uint8Array }): Promise<'ready' | 'failed'>;
}

/** The URL an asset is served from — the same URL the Worker answers. */
export function assetUrl(assetKey: string): string {
  return `/assets/${assetKey}`;
}

/** The upload address for an asset key: board-scoped, like everything else. */
export function assetUploadUrl(assetKey: string): string {
  return `/api/boards/${assetKey}`;
}

const defaultFetch: FetchImpl = (input, init) => fetch(input, init);

export function createImageUploader(options: ImageUploaderOptions = {}): ImageUploader {
  const registry = options.registry ?? createAssetRegistry();
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const clock = options.now ?? (() => Date.now());

  async function put(assetKey: string, bytes: Uint8Array): Promise<boolean> {
    try {
      const response = await fetchImpl(assetUploadUrl(assetKey), {
        method: 'POST',
        body: bytes.slice() as unknown as BodyInit,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function exists(assetKey: string): Promise<'there' | 'not-there' | 'unknown'> {
    try {
      const response = await fetchImpl(assetUrl(assetKey));
      if (response.ok) return 'there';
      if (response.status === 404) return 'not-there';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  return {
    registry,
    async uploadAll(doc, boardId, items) {
      const now = clock();
      const attempts = items
        .filter((item) => registry.begin(boardId, item.assetKey, now, item.bytes))
        .map(async (item) => {
          const uploaded = await put(item.assetKey, item.bytes);
          const settledAt = clock();
          if (uploaded) {
            registry.settle(boardId, item.assetKey, 'committed', settledAt);
            markImageReady(doc, item.id, item.assetKey);
          } else {
            registry.settle(boardId, item.assetKey, 'failed', settledAt);
            markImageFailed(doc, item.id);
          }
        });
      // Concurrent, and deliberately not sequential: the batch's slowest file
      // must not be everyone else's queue.
      await Promise.all(attempts);
    },
    async retry(doc, boardId, item) {
      const now = clock();
      const known = registry.get(boardId, item.assetKey);
      if (known && known.status === 'uploading') {
        // Already uploading — the dedupe answers, and nothing goes out.
        return 'failed';
      }
      // Re-arm the slot, keeping any bytes we still hold for it.
      registry.begin(boardId, item.assetKey, now, item.bytes ?? known?.bytes);
      // The entry's clock restarts with the attempt: the unfinished marker is
      // five minutes from the last thing anyone tried.
      markImageRetrying(doc, item.id, now);
      const state = await exists(item.assetKey);
      if (state === 'there') {
        registry.settle(boardId, item.assetKey, 'committed', clock());
        markImageReady(doc, item.id, item.assetKey);
        return 'ready';
      }
      const bytes = item.bytes ?? registry.get(boardId, item.assetKey)?.bytes;
      if (!bytes) {
        // A viewer (or a reloader) has no bytes to send, and the bucket has
        // none to serve: the 404 *is* the answer. Failed, and stay failed
        // until a person tries again.
        registry.settle(boardId, item.assetKey, 'failed', clock());
        markImageFailed(doc, item.id);
        return 'failed';
      }
      const uploaded = await put(item.assetKey, bytes);
      if (uploaded) {
        registry.settle(boardId, item.assetKey, 'committed', clock());
        markImageReady(doc, item.id, item.assetKey);
        return 'ready';
      }
      registry.settle(boardId, item.assetKey, 'failed', clock());
      markImageFailed(doc, item.id);
      return 'failed';
    },
  };
}
