/**
 * Story 12, task 8: what an image looks like in each of the states it can be in, and what the
 * two buttons next to it do (TC-21, TC-22, TC-23, TC-24).
 *
 * The states are read from the board the way a person sees them: through the real document and
 * the real registry, with the board's own identity, because every one of these boxes says
 * something different depending on whether you are the person who asked for the picture.
 *
 * One thing cannot be waited for in jsdom and is not pretended about: the browser deciding a
 * picture's bytes will not load. That is dispatched by hand in TC-23, and only that.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  IMAGE_UNAVAILABLE_LABEL,
  UPLOAD_FAILED_LABEL,
  UPLOAD_UNFINISHED_LABEL,
  ImageObject,
} from '../../src/client/objects/ImageObject';
import { readImage } from '../../src/shared/objects/image';
import type { ImageSnap } from '../../src/shared/objects/image';
import { boardDoc, renderBoard } from './fixtures/board';
import { resetUploads, uploads } from './fixtures/upload-stub';
import {
  clearImageDecodeStub,
  connected,
  dropFiles,
  failImageLoad,
  imageFile,
  imageBox,
  imageButton,
  clickImageButton,
  imagesInDoc,
  seedImage,
  storedKey,
  stubImageDecode,
} from './fixtures/images';

vi.mock('../../src/client/images/uploadImage', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/images/uploadImage')>(
    '../../src/client/images/uploadImage',
  );
  const { uploadImageStub } = await import('./fixtures/upload-stub');
  return { ...actual, uploadImage: uploadImageStub };
});

/**
 * The component on its own, which is the only way to hold the one thing a reloaded board knows
 * and a live one does not: that the file is no longer in memory.
 */
function renderImageObject(
  image: ImageSnap,
  props: { canRetry: boolean; onRemove(): void; onRetry?: () => void },
) {
  return render(
    <ImageObject
      image={image}
      isUploader
      canRetry={props.canRetry}
      now={Date.now()}
      onRetry={props.onRetry ?? (() => undefined)}
      onRemove={props.onRemove}
    />,
  );
}

/** Wait for the board to draw an image in the state its document says it is in. */
async function waitForState(id: string, status: string): Promise<void> {
  await vi.waitFor(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-note-id="${id}"][data-status="${status}"]`,
    );
    if (!element) {
      const drawn = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image-state"]'))
        .map((box) => box.dataset.status)
        .join(', ');
      throw new Error(`image ${id} is not drawn as ${status}; on screen: ${drawn || 'nothing'}`);
    }
  });
}

function labelOf(id: string): string | null {
  return document.querySelector(`[data-note-id="${id}"] .vidi6-image-label`)?.textContent ?? null;
}

beforeEach(() => {
  resetUploads();
});

afterEach(() => {
  resetUploads();
  clearImageDecodeStub();
});

/** Ask the board for a picture, and have the server refuse it. */
async function uploadThatFailed(): Promise<string> {
  stubImageDecode({ 'shot.png': { width: 200, height: 100 } });
  dropFiles([imageFile('shot.png')], { x: 100, y: 100 });
  await vi.waitFor(() => {
    if (imagesInDoc().length !== 1) throw new Error('no placeholder yet');
  });
  const id = imagesInDoc()[0].id;
  await uploads()[0].failed(500);
  return id;
}

describe('an upload that failed (TC-21)', () => {
  it('tells the person who asked for the picture, and hands them two things to do', async () => {
    await renderBoard();
    await connected();
    const id = await uploadThatFailed();

    await waitForState(id, 'failed');
    expect(labelOf(id)).toBe(UPLOAD_FAILED_LABEL);
    expect(imageButton('image-retry')).not.toBeNull();
    expect(imageButton('image-remove')).not.toBeNull();
  });

  it('tells everybody else only that the image is not there', async () => {
    await renderBoard();
    await connected();
    const id = seedImage({ status: 'failed', uploaderId: 'someone-else' });

    await waitForState(id, 'failed');
    expect(labelOf(id)).toBe(IMAGE_UNAVAILABLE_LABEL);
    // They are not told it failed, because they are not the ones who could fix it (PRD:
    // "SHALL show the uploader ... and SHALL show others Image unavailable").
    expect(imageButton('image-retry')).toBeNull();
    expect(imageButton('image-remove')).toBeNull();
  });
});

describe('an upload nobody finished (TC-22)', () => {
  it('says so after five minutes, to anyone looking, and Remove takes the box away', async () => {
    await renderBoard();
    await connected();
    // Somebody else's upload, started long enough ago that this viewer's clock calls it off.
    const id = seedImage({
      uploaderId: 'someone-else',
      startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1,
    });

    await waitForState(id, 'unavailable');
    expect(labelOf(id)).toBe(UPLOAD_UNFINISHED_LABEL);
    // This is the one state whose explanation is worth giving a stranger, because the thing to
    // do about it — delete the hole — is something anyone can do.
    expect(imageButton('image-remove')).not.toBeNull();

    clickImageButton('image-remove');
    await vi.waitFor(() => {
      if (readImage(boardDoc(), id) !== null) throw new Error('the box is still there');
    });
  });
});

describe('a picture whose bytes will not load (TC-23)', () => {
  it('becomes the same hole in the same place, with no explanation beyond the words', async () => {
    await renderBoard();
    await connected();
    const id = seedImage({ status: 'ready', uploaderId: 'someone-else' });
    await waitForState(id, 'ready').catch(() => {
      /* a ready image is drawn as a picture, which carries no data-status */
    });
    const before = imageBox(id);
    expect(document.querySelector(`[data-note-id="${id}"][data-testid="image-object"]`)).toBeTruthy();

    failImageLoad(id);

    await waitForState(id, 'unavailable');
    expect(labelOf(id)).toBe(IMAGE_UNAVAILABLE_LABEL);
    // The box does not move or resize: a broken picture leaves the board's shape alone, or one
    // person's bad afternoon rearranges everybody's board.
    expect(imageBox(id)).toEqual(before);
    // And the rest of the board is still there to be used.
    expect(document.querySelector('[data-testid="viewport"]')).toBeTruthy();
  });
});

describe('retrying an upload (TC-24)', () => {
  it('sends the same file again and puts the box back to uploading', async () => {
    await renderBoard();
    await connected();
    const id = await uploadThatFailed();
    await waitForState(id, 'failed');

    clickImageButton('image-retry');

    await vi.waitFor(() => {
      if (uploads().length !== 2) throw new Error('the file was not sent again');
    });
    expect(uploads()[1].file.name).toBe('shot.png');
    expect(readImage(boardDoc(), id)?.status).toBe('uploading');
    await waitForState(id, 'uploading');
    // The second attempt can still be given up on.
    await uploads()[1].ok(storedKey());
    await vi.waitFor(() => {
      if (readImage(boardDoc(), id)?.status !== 'ready') throw new Error('never became ready');
    });
  });

  it('offers Remove and not Retry once this browser has forgotten the file', () => {
    // After a reload the placeholder is still there and the bytes are not, so the one button
    // that still does something is the one that deletes the box.
    const onRemove = vi.fn();
    const image: ImageSnap = {
      id: 'gone',
      type: 'image',
      x: 0,
      y: 0,
      z: 1,
      width: 200,
      height: 100,
      known: true,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200,
      naturalHeight: 100,
      status: 'failed',
      uploadStartedAt: 0,
      uploaderId: 'me',
    };
    renderImageObject(image, { canRetry: false, onRemove });
    // Nothing was kept, so nothing can be re-sent: Retry is not offered, and saying it would be
    // a button that does nothing.
    expect(document.querySelector('[data-testid="image-retry"]')).toBeNull();
    expect(document.querySelector('[data-testid="image-remove"]')).toBeTruthy();
    clickImageButton('image-remove');
    expect(onRemove).toHaveBeenCalled();
  });
});
