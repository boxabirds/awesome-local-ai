/**
 * Component (jsdom) tests for the states an image object can be in:
 * TC-21 to TC-24.
 *
 * The presentational `ImageObject` is rendered with explicit facts for the
 * states that depend only on them, and the registry component
 * `ImageBoardObject` is used wherever the upload queue is part of the story
 * (Retry availability, Retry actually working, Remove forgetting the file).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageBoardObject, ImageObject } from '../../src/client/objects/ImageObject';
import {
  createImagePlaceholders,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { snapshotAll } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { SESSION_IDENTITY } from '../../src/client/sync/sessionIdentity';
import {
  canRetryImage,
  resetUploadQueue,
  retryUpload,
  startUpload,
} from '../../src/client/images/uploadQueue';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { clearToasts } from '../../src/client/ui/Toast';
import { pngBytes } from '../fixtures/imageBytes';

const { uploadMock } = vi.hoisted(() => ({ uploadMock: vi.fn() }));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) =>
    uploadMock(boardId, file, onProgress),
  assetUrlFor: (key: string) => `/api/assets/${key}`,
}));

const BOARD_ID = 'a'.repeat(22);
const ASSET_KEY = `${BOARD_ID}/${'c'.repeat(22)}`;

let settleNext: (result: UploadResult) => void = () => undefined;

beforeEach(() => {
  uploadMock.mockImplementation(() => {
    const promise = new Promise<UploadResult>((resolve) => {
      settleNext = resolve;
    });
    return { promise, abort() {} };
  });
  window.history.pushState({}, '', `/b/${BOARD_ID}`);
});

afterEach(() => {
  cleanup();
  clearToasts();
  resetUploadQueue();
  vi.restoreAllMocks();
});

// --- helpers -----------------------------------------------------------------
function imageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 100,
    y: 200,
    width: 320,
    height: 180,
    rotation: 0,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 640,
    naturalHeight: 360,
    status: 'uploading',
    uploadStartedAt: 1_000,
    uploaderId: SESSION_IDENTITY,
    ...overrides,
  } as ImageSnap;
}

function presentational(image: ImageSnap, overrides: Partial<Parameters<typeof ImageObject>[0]> = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  render(
    <ImageObject
      image={image}
      isUploader
      progress={image.status === 'uploading' ? 0.4 : undefined}
      canRetry={image.status === 'failed'}
      now={image.uploadStartedAt}
      onRetry={onRetry}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onRetry, onRemove };
}

/** One image in a real doc, as the insert flow creates it. */
function docWithImage(doc: Y.Doc, startedAt: number): string {
  const [id] = createImagePlaceholders(
    doc,
    [
      {
        rect: { x: 10, y: 20, width: 200, height: 100 },
        naturalWidth: 400,
        naturalHeight: 200,
        contentType: 'image/png',
      },
    ],
    SESSION_IDENTITY,
    startedAt,
  );
  return id;
}

function snapOf(doc: Y.Doc, id: string): ImageSnap {
  const found = snapshotAll(doc).find((o) => o.id === id);
  if (!found) throw new Error(`image ${id} is not in the doc`);
  return found as unknown as ImageSnap;
}

function mountBoardObject(doc: Y.Doc, id: string): void {
  render(
    <ImageBoardObject
      obj={snapOf(doc, id)}
      doc={doc}
      zoom={1}
      selected
      editing={false}
      readOnly={false}
      onObjectPointerDown={() => undefined}
      onStartEdit={() => undefined}
      onEndEdit={() => undefined}
    />,
  );
}

// ---------------------------------------------------------------------------
// TC-21: a failed upload
// ---------------------------------------------------------------------------
describe('TC-21: failed upload', () => {
  it('offers Retry and Remove to the person who uploaded it', () => {
    presentational(imageSnap({ status: 'failed' }));

    expect(screen.getByTestId('image-failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByText('Image unavailable')).toBeNull();
  });

  it('only says "Image unavailable" to everybody else', () => {
    presentational(imageSnap({ status: 'failed' }), { isUploader: false, canRetry: false });

    expect(screen.getByTestId('image-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-22: an upload that was abandoned
// ---------------------------------------------------------------------------
describe('TC-22: an upload older than IMAGE_UPLOAD_STALE_MS', () => {
  it('says the upload did not finish and offers Remove, to the uploader too', () => {
    const started = 1_000;
    presentational(imageSnap({ status: 'uploading' }), {
      now: started + IMAGE_UPLOAD_STALE_MS + 1,
      canRetry: false,
    });

    expect(screen.getByTestId('image-unfinished')).toBeInTheDocument();
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // No progress bar: nothing is moving any more.
    expect(screen.queryByTestId('image-progress-bar')).toBeNull();
  });

  it('says the same thing to another participant', () => {
    const started = 1_000;
    presentational(imageSnap({ status: 'uploading', uploaderId: 'someone-else' }), {
      now: started + IMAGE_UPLOAD_STALE_MS + 1,
      isUploader: false,
      canRetry: false,
    });

    expect(screen.getByTestId('image-unfinished')).toBeInTheDocument();
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
  });

  it('still counts as uploading while the timer has not run out', () => {
    const started = 1_000;
    presentational(imageSnap({ status: 'uploading' }), {
      now: started + IMAGE_UPLOAD_STALE_MS - 1_000,
    });

    expect(screen.getByTestId('image-uploading')).toBeInTheDocument();
    expect(screen.getByTestId('image-progress-text')).toHaveTextContent('40%');
  });

  it('Remove deletes the object from the doc', () => {
    const doc = new Y.Doc();
    // Started long enough ago that the board already treats it as unfinished.
    const id = docWithImage(doc, Date.now() - IMAGE_UPLOAD_STALE_MS - 1_000);
    mountBoardObject(doc, id);

    expect(screen.getByTestId('image-unfinished')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(snapshotAll(doc).find((o) => o.id === id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TC-23: the stored bytes are gone
// ---------------------------------------------------------------------------
describe('TC-23: a ready image whose asset cannot be loaded', () => {
  it('shows "Image unavailable" instead of an empty box', () => {
    const ready = imageSnap({ status: 'ready', assetKey: ASSET_KEY });
    presentational(ready, { canRetry: false });

    const img = screen.getByTestId('image-content');
    expect(img).toHaveAttribute('src', `/api/assets/${ASSET_KEY}`);

    fireEvent.error(img);

    expect(screen.queryByTestId('image-content')).toBeNull();
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    // The bytes are stored for good, so Retry is not offered; Remove is.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TC-24: retrying
// ---------------------------------------------------------------------------
describe('TC-24: retrying a failed upload', () => {
  function pngFile(): File {
    return new File([pngBytes(8, 6)], 'shot.png', { type: 'image/png' });
  }

  it('sends the same file again while it is still in memory', async () => {
    const doc = new Y.Doc();
    const id = docWithImage(doc, Date.now());

    startUpload({ doc, boardId: BOARD_ID, id, file: pngFile() });
    settleNext({ kind: 'failed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(snapOf(doc, id).status).toBe('failed');
    expect(canRetryImage(id)).toBe(true);

    mountBoardObject(doc, id);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(uploadMock).toHaveBeenCalledTimes(2);
    expect(uploadMock.mock.calls[1]?.[0]).toBe(BOARD_ID);
    expect((uploadMock.mock.calls[1]?.[1] as File).name).toBe('shot.png');
    expect(snapOf(doc, id).status).toBe('uploading');

    // And the second attempt landing makes it a real image for everyone.
    settleNext({ kind: 'ok', assetKey: ASSET_KEY });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapOf(doc, id).status).toBe('ready');
    expect(snapOf(doc, id).assetKey).toBe(ASSET_KEY);

    doc.destroy();
  });

  it('offers no Retry after a reload, when the file is gone', async () => {
    const doc = new Y.Doc();
    const id = docWithImage(doc, Date.now());

    startUpload({ doc, boardId: BOARD_ID, id, file: pngFile() });
    settleNext({ kind: 'failed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(canRetryImage(id)).toBe(true);

    // A reload: the queue is module state and starts empty again.
    resetUploadQueue();
    render(
      <ImageBoardObject
        obj={snapOf(doc, id)}
        doc={doc}
        zoom={1}
        selected
        editing={false}
        readOnly={false}
        onObjectPointerDown={() => undefined}
        onStartEdit={() => undefined}
        onEndEdit={() => undefined}
      />,
    );

    expect(screen.getByTestId('image-failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(retryUpload(doc, BOARD_ID, id)).toBe(false);
    expect(snapOf(doc, id).status).toBe('failed');

    doc.destroy();
  });

  it('a rate limited upload is retryable and explains itself once', async () => {
    const doc = new Y.Doc();
    const id = docWithImage(doc, Date.now());

    startUpload({ doc, boardId: BOARD_ID, id, file: pngFile() });
    settleNext({ kind: 'rate_limited' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(snapOf(doc, id).status).toBe('failed');
    expect(canRetryImage(id)).toBe(true);
    expect(uploadMock).toHaveBeenCalledTimes(1);

    doc.destroy();
  });
});

describe('ready state', () => {
  it('renders the stored image at its size', () => {
    presentational(imageSnap({ status: 'ready', assetKey: ASSET_KEY }), { canRetry: false });
    const img = screen.getByTestId('image-content');
    expect(img).toHaveAttribute('src', `/api/assets/${ASSET_KEY}`);
    expect(img).toHaveAttribute('alt', 'Image');
    expect(img).toHaveAttribute('width', '320');
    expect(img).toHaveAttribute('height', '180');
  });

  it('shows a plain "Uploading…" box without progress to other participants', () => {
    presentational(imageSnap({ status: 'uploading', uploaderId: 'someone-else' }), {
      isUploader: false,
      progress: undefined,
    });
    expect(screen.getByTestId('image-uploading-other')).toBeInTheDocument();
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.queryByTestId('image-progress-bar')).toBeNull();
  });
});
