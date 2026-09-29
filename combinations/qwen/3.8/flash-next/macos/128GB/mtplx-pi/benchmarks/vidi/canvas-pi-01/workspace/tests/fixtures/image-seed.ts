/**
 * Story 12 · seeding image objects for the component and e2e tests.
 *
 * The board is a `Y.Doc`, so a "given an image already on the board" test writes
 * the record the same way the app would — through the model functions — rather
 * than reaching into internals. These helpers build an image in a chosen status
 * (`uploading`, `ready`, `failed`) at an exact rectangle, so a test that needs a
 * rendered `<img>` (component) or a draggable corner handle (e2e) starts from
 * that state in one call. No server, no R2, no real upload is involved — the
 * `<img>` / decode part is faked at the browser boundary by the test.
 */
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
} from '../../src/shared/objects/image';

export interface SeedImage {
  /** Where the image sits, top-left, in world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The persisted status to seed. `ready` also needs `assetKey`. */
  status?: 'uploading' | 'ready' | 'failed';
  assetKey?: string | null;
  contentType?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  /** When the (current) upload began; a stale value drives `unfinished`. */
  uploadStartedAt?: number;
  uploaderId?: string;
}

/**
 * Seed one image object in the given status. Placement runs first (one
 * `LOCAL_ORIGIN` transaction, exactly as a real add does), then the status is
 * moved to `ready` / `failed` under `UPLOAD_ORIGIN`, so the seeded document is
 * byte-for-byte what a completed or failed upload would leave behind.
 */
export function seedImages(doc: Y.Doc, images: readonly SeedImage[], now = 0): string[] {
  const items = images.map((image) => ({
    rect: { x: image.x, y: image.y, width: image.width, height: image.height },
    naturalWidth: image.naturalWidth ?? image.width,
    naturalHeight: image.naturalHeight ?? image.height,
    contentType: image.contentType ?? 'image/png',
  }));
  const ids = createImagePlaceholders(doc, items, 'seed', now);
  ids.forEach((id, index) => {
    const image = images[index];
    const startedAt = image.uploadStartedAt ?? now;
    // Reset the clock the placeholder stamped, so a stale `uploadStartedAt`
    // actually reads as unfinished in the render.
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id);
    record?.set('uploadStartedAt', startedAt);
    if (image.status === 'ready' && image.assetKey) {
      markImageReady(doc, id, image.assetKey);
    } else if (image.status === 'failed') {
      markImageFailed(doc, id);
    }
  });
  return ids;
}

/** Build a `Y.Doc` already containing the given images (and optional stickies). */
export function seedDocWithImages(images: readonly SeedImage[] = []): {
  doc: Y.Doc;
  ids: string[];
} {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = seedImages(doc, images);
  return { doc, ids };
}
