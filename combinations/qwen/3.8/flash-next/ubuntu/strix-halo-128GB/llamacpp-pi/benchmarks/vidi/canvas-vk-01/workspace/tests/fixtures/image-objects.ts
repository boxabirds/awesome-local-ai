import * as Y from 'yjs';

import { initDoc } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
  placementSize,
  type ImageStatus,
} from '../../src/shared/objects/image';

/**
 * Image fixtures (story 12): documents holding images in each upload state.
 * Everything is created through the model, so a fixture is only ever in a state
 * the app itself can put an image in.
 */

/** The identity that uploads fixture images, and the one that only watches. */
export const UPLOADER_ID = 'uploader-1';
export const VIEWER_ID = 'viewer-1';

/** A wall-clock base far from `Date.now()`, so staleness is explicit per test. */
export const T0 = 1_700_000_000_000;

/** The key a ready fixture image points at, in the shape the asset API returns. */
export const ASSET_KEY = 'V2fXq0Kd7Yh1N4sT8pLm3a/0Jw6Qm2Xs9Yd4Kb7Tf1hNg';

export interface SeedImage {
  doc: Y.Doc;
  x?: number;
  y?: number;
  /** The placed size is always this scaled to fit, as the model decides. */
  naturalWidth?: number;
  naturalHeight?: number;
  status?: ImageStatus;
  /** Defaults to a plausible key; `null` keeps the placeholder's own state. */
  assetKey?: string | null;
  contentType?: string;
  uploaderId?: string;
  /** Upload start; staleness is judged against the `now` given to `displayStatus`. */
  uploadStartedAt?: number;
}

/**
 * One image, in the state asked for. `uploading` is a live upload, so its
 * `uploadStartedAt` defaults to T0 (recent); `ready` and `failed` carry the
 * outcome they name.
 */
export function seedImage(fixture: SeedImage): string {
  const { doc, status = 'uploading', assetKey } = fixture;
  const naturalWidth = fixture.naturalWidth ?? 400;
  const naturalHeight = fixture.naturalHeight ?? 300;
  const x = fixture.x ?? 0;
  const y = fixture.y ?? 0;
  const [id] = createImagePlaceholders(
    doc,
    [
      {
        rect: { x, y, ...placementSize(naturalWidth, naturalHeight) },
        naturalWidth,
        naturalHeight,
        contentType: fixture.contentType ?? 'image/png',
      },
    ],
    fixture.uploaderId ?? UPLOADER_ID,
    fixture.uploadStartedAt ?? T0,
  );
  if (id === undefined) throw new Error('fixture: image was refused');
  if (status === 'ready') {
    if (!markImageReady(doc, id, assetKey ?? ASSET_KEY)) {
      throw new Error('fixture: image was removed');
    }
  } else if (status === 'failed') {
    if (!markImageFailed(doc, id)) throw new Error('fixture: image was removed');
  } else if (assetKey !== undefined) {
    throw new Error('fixture: assetKey only applies to a ready image');
  }
  return id;
}

/** Images in every state at once, in a document of their own. */
export function imageFixtureDoc(): {
  doc: Y.Doc;
  uploading: string;
  uploadingNow: string;
  ready: string;
  failed: string;
} {
  const doc = new Y.Doc();
  initDoc(doc);
  const uploading = seedImage({ doc, x: 0, uploadStartedAt: T0 });
  // Started right now, so it is still "uploading" against the real clock too.
  const uploadingNow = seedImage({ doc, x: 600, uploadStartedAt: Date.now() });
  const ready = seedImage({ doc, x: 1200, status: 'ready' });
  const failed = seedImage({ doc, x: 1800, status: 'failed' });
  return { doc, uploading, uploadingNow, ready, failed };
}
