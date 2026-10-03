// Story 12 · Drop images onto the board — what one image says about itself.
//
// An image spends most of its life as something that is *not a picture yet*: bytes on their way
// to a bucket, a colleague's upload that never came back, a key that answers 404. The document
// holds three statuses and the clock turns one of them into a fourth, and the difference between
// "Upload failed" and "Image unavailable" is the difference between what this person can do
// something about and what they cannot — Retry appears for one and not the other. So these tests
// read the words and the buttons, which is exactly what a person reads.
//
// TC-21 failed: uploader sees "Upload failed" with Retry and Remove; another identity sees
//       "Image unavailable" with nothing to click
// TC-22 uploading for longer than the stale window: "Image upload didn't finish" and a Remove
//       that takes the object out of the document
// TC-23 a `ready` image whose URL errors: the unavailable box, in the same rectangle
// TC-24 Retry while this tab still has the file; after a reload it is gone, and so is the button
//
// The uploading wording is here too, because it is the other half of the same decision: the
// percentage is this tab's XHR, and everybody else gets "Uploading…" with no number.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';

import { deleteObjects, initDoc, objectSnapshots } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders,
  IMAGE_TYPE,
  markImageFailed,
  markImageRetrying,
  type ImageSnapshot,
} from '../../src/shared/objects/image';
import {
  BoardImageObject,
  ImageObject,
  ImageRuntimeProvider,
  type ImageRuntimeSource,
} from '../../src/client/objects/ImageObject';
import type { ObjectProps } from '../../src/client/objects/registry';

const ME = 'me';
const START = 1_000_000;
/** A key in the shape the Worker stores them in: two 22-character base64url ids. */
const ASSET_KEY = `${'a'.repeat(22)}/${'b'.repeat(22)}`;

/** A snapshot in the state under test, with everything else left ordinary. */
function image(over: Partial<ImageSnapshot> = {}): ImageSnapshot {
  return {
    id: 'img1',
    type: IMAGE_TYPE,
    x: 40,
    y: 60,
    width: 400,
    height: 300,
    z: 1,
    createdAt: START,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 800,
    naturalHeight: 600,
    status: 'uploading',
    // A placeholder made just now: the board's own clock is the real one, so a fixture that
    // claims to be uploading has to be recent or the stale window has passed by itself.
    uploadStartedAt: Date.now(),
    uploaderId: ME,
    ...over,
  };
}

/** Render the state renderer on its own — no board, no document, no camera. */
function renderState(over: Partial<ImageSnapshot> = {}, props: Partial<ImageObjectArgs> = {}) {
  const args: ImageObjectArgs = {
    image: image(over),
    isUploader: true,
    canRetry: true,
    now: START + 1000,
    onRetry: () => {},
    onRemove: () => {},
    ...props,
  };
  return render(<ImageObject {...args} />);
}

type ImageObjectArgs = Parameters<typeof ImageObject>[0];

describe('ImageObject: a failed upload (story 12 · TC-21)', () => {
  it('tells the person who uploaded it, and offers them the two things they can do', () => {
    renderState({ status: 'failed' });

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByTestId('image-retry')).toHaveTextContent('Retry');
    expect(screen.getByTestId('image-remove')).toHaveTextContent('Remove');
    // Not a picture: there is nothing to show, and the box says so rather than showing a hole.
    expect(screen.queryByTestId('image-picture')).toBeNull();
  });

  it('tells everybody else only that the image is unavailable, with nothing to press (negative)', () => {
    renderState({ status: 'failed' }, { isUploader: false });

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    // "Somebody else's failed upload" is not this person's to retry, and saying so with a dead
    // button would be worse than saying nothing.
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });

  it('hides Retry when this tab no longer has the file, and keeps Remove (TC-24, reload)', () => {
    // A reload is honest about what it lost: the bytes were in memory, and they are gone.
    renderState({ status: 'failed' }, { canRetry: false });

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('presses Retry and Remove reach the board', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    renderState({ status: 'failed' }, { onRetry, onRemove });

    fireEvent.click(screen.getByTestId('image-retry'));
    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('ImageObject: an upload that did not finish (story 12 · TC-22)', () => {
  it('says "didn\'t finish" once the stale window has passed, for anybody looking', () => {
    // The boundary itself is TC-06's business; here it is comfortably past it.
    renderState(
      { uploadStartedAt: START },
      { now: START + IMAGE_UPLOAD_STALE_MS + 1000, isUploader: true },
    );

    expect(screen.getByText(/Image upload didn/)).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
    // Nobody gets Retry here: whoever had the file may still have it, on another tab or a
    // laptop that has gone to sleep, and this one does not.
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });

  it('shows it to a person who was never the uploader, with the same words and the same Remove', () => {
    renderState(
      { uploadStartedAt: START, uploaderId: 'somebody-else' },
      { now: START + IMAGE_UPLOAD_STALE_MS + 1000, isUploader: false },
    );

    expect(screen.getByText(/Image upload didn/)).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('Remove takes the object out of the document', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 10, y: 20, width: 320, height: 240 },
          naturalWidth: 320,
          naturalHeight: 240,
          contentType: 'image/png',
        },
      ],
      ME,
      Date.now() - IMAGE_UPLOAD_STALE_MS - 5000,
    );
    expect(id).toBeDefined();

    const removed: string[] = [];
    renderInBoard(doc, {
      remove: (objectId) => {
        removed.push(objectId);
        deleteObjects(doc, [objectId]);
      },
    });

    fireEvent.click(screen.getByTestId('image-remove'));
    expect(removed).toEqual([id]);
    expect(objectSnapshots(doc)).toHaveLength(0);
  });
});

describe('ImageObject: uploading (story 12)', () => {
  it('gives the uploader the percentage, and everybody else the same news without it', () => {
    const { rerender } = renderState({}, { isUploader: true, progress: 0.42 });
    expect(screen.getByText('Uploading 42%')).toBeInTheDocument();

    rerender(<ImageObject {...imageArgs({}, { isUploader: false, progress: 0.42 })} />);
    expect(screen.getByText('Uploading\u2026')).toBeInTheDocument();
    expect(screen.queryByText(/42%/)).toBeNull();
  });

  it('shows no percentage when there is no upload of this tab\'s to report', () => {
    // Another tab's upload of my object (or my own after a reload): the placeholder is real,
    // the number is not, and "Uploading…" is the truth.
    renderState({}, { isUploader: true, progress: undefined });
    expect(screen.getByText('Uploading\u2026')).toBeInTheDocument();
  });
});

describe('ImageObject: a picture that will not load (story 12 · TC-23)', () => {
  it('turns the broken frame into "Image unavailable"', () => {
    const ready = image({ status: 'ready', assetKey: ASSET_KEY });
    renderState(ready);

    const picture = screen.getByTestId('image-picture');
    expect(picture).toHaveAttribute('src', `/api/assets/${ASSET_KEY}`);

    // The document says the bytes are there. The bucket says otherwise, and this screen is the
    // only place that gets to find that out.
    fireEvent.error(picture);

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-picture')).toBeNull();
  });

  it('keeps the rectangle it had, so the board around it does not move', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 300, y: 400, width: 640, height: 480 },
          naturalWidth: 640,
          naturalHeight: 480,
          contentType: 'image/png',
        },
      ],
      ME,
      Date.now(),
    );
    // The upload finished: the document is sure the picture exists.
    const before = snapshotImage(doc, id!);
    const ready: ImageSnapshot = { ...before, status: 'ready', assetKey: ASSET_KEY };
    const source = runtimeSource();
    const props: ObjectProps = {
      obj: ready,
      doc,
      zoom: 1,
      selected: false,
      editing: false,
      canEdit: true,
      onObjectPointerDown: () => {},
      onFocusSelect: () => {},
      onStartEdit: () => {},
      onEndEdit: () => {},
    };
    render(
      <ImageRuntimeProvider runtime={() => source} hasUploading={false}>
        <BoardImageObject {...props} />
      </ImageRuntimeProvider>,
    );

    const object = screen.getByTestId('image-object');
    expect(object).toHaveStyle({ width: '640px', height: '480px' });
    fireEvent.error(screen.getByTestId('image-picture'));

    expect(within(object).getByText('Image unavailable')).toBeInTheDocument();
    // Still the same box: a picture that went missing does not take the layout with it.
    expect(object).toHaveStyle({ left: '300px', top: '400px', width: '640px', height: '480px' });
    expect(object).toHaveAttribute('data-image-status', 'ready');
  });

  it('refuses to show a broken frame for a `ready` object with no key at all', () => {
    // Defensive: a document written by a newer client could say `ready` with nothing stored.
    renderState({ status: 'ready', assetKey: null });
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-picture')).toBeNull();
  });
});

describe('BoardImageObject: the object the board draws (story 12)', () => {
  it('occupies the rectangle the document holds, at its status', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderInBoard(doc, { remove: () => {} }, { x: 111, y: 222, width: 321, height: 241 });

    const object = screen.getByTestId('image-object');
    expect(object).toHaveStyle({ left: '111px', top: '222px', width: '321px', height: '241px' });
    expect(object).toHaveAttribute('data-image-status', 'uploading');
    expect(object).toHaveAttribute('data-image-uploader', ME);
    // The minimum the registry will let a resize go down to is the one the model was given.
    expect(IMAGE_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });

  it('a press on the picture selects it and starts a move, and does not reach the board', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const onObjectPointerDown = vi.fn();
    const props: ObjectProps = {
      obj: image(),
      doc,
      zoom: 1,
      selected: true,
      editing: false,
      canEdit: true,
      onObjectPointerDown,
      onFocusSelect: () => {},
      onStartEdit: () => {},
      onEndEdit: () => {},
    };

    const bubbled = vi.fn();
    render(
      <div onPointerDown={bubbled}>
        <ImageRuntimeProvider runtime={runtimeSource} hasUploading={false}>
          <BoardImageObject {...props} />
        </ImageRuntimeProvider>
      </div>,
    );

    fireEvent.pointerDown(screen.getByTestId('image-object'), {
      button: 0,
      pointerId: 1,
      clientX: 120,
      clientY: 130,
    });
    expect(onObjectPointerDown).toHaveBeenCalledTimes(1);
    expect(onObjectPointerDown.mock.calls[0]?.[1]).toBe('img1');
    // The gesture stopped here: the board behind it must not start a pan or a marquee.
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('leaves a press on its own buttons to the buttons, so that Retry is pressable', () => {
    // The e2e suite found this one: the move gesture captures the pointer, and a captured
    // pointer takes the `click` away from the button that was pressed and hands it to the box
    // that captured it. Every other object on the board keeps its controls outside itself; an
    // image carries its Retry and Remove inside the picture (`image.upload_failure`).
    const doc = new Y.Doc();
    initDoc(doc);
    const onObjectPointerDown = vi.fn();
    const retry = vi.fn();
    const bubbled = vi.fn();
    const source: ImageRuntimeSource = { ...runtimeSource(), canRetry: () => true, retry };
    const props: ObjectProps = {
      obj: image({ status: 'failed' }),
      doc,
      zoom: 1,
      selected: false,
      editing: false,
      canEdit: true,
      onObjectPointerDown,
      onFocusSelect: () => {},
      onStartEdit: () => {},
      onEndEdit: () => {},
    };
    render(
      <div onPointerDown={bubbled}>
        <ImageRuntimeProvider runtime={() => source} hasUploading={false}>
          <BoardImageObject {...props} />
        </ImageRuntimeProvider>
      </div>,
    );

    const button = screen.getByTestId('image-retry');
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    // Neither the gesture nor the board behind it: the button owns this press.
    expect(onObjectPointerDown).not.toHaveBeenCalled();
    expect(bubbled).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('marks itself selected, for the outline and for the tests', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderInBoard(doc, { remove: () => {} });
    expect(screen.getByTestId('image-object')).toHaveAttribute('data-selected', 'true');
  });
});

describe('ImageObject through the model: the states a document can be in', () => {
  it('Retry puts a failed object back to uploading and asks the board for it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [
        {
          rect: { x: 0, y: 0, width: 200, height: 150 },
          naturalWidth: 200,
          naturalHeight: 150,
          contentType: 'image/png',
        },
      ],
      ME,
      Date.now(),
    );
    markImageFailed(doc, id!);
    expect(snapshotImage(doc, id!).status).toBe('failed');

    const retried: string[] = [];
    renderInBoard(doc, {
      canRetry: () => true,
      retry: (objectId) => {
        retried.push(objectId);
        markImageRetrying(doc, objectId, Date.now());
      },
    });

    fireEvent.click(screen.getByTestId('image-retry'));
    expect(retried).toEqual([id]);
    expect(snapshotImage(doc, id!).status).toBe('uploading');
  });
});

/** The snapshot of one object, read back out of the document. */
function snapshotImage(doc: Y.Doc, id: string): ImageSnapshot {
  const found = objectSnapshots(doc).find((object) => object.id === id);
  expect(found?.type).toBe(IMAGE_TYPE);
  return found as ImageSnapshot;
}

const runtimeSource = (): ImageRuntimeSource => ({
  identityId: ME,
  progressOf: () => undefined,
  canRetry: () => false,
  retry: () => {},
  remove: () => {},
});

/**
 * Render one object the way the board does: inside the runtime, with the document's snapshot.
 *
 * The rectangle in `over` exists so a test can assert the box the document describes rather
 * than the box a fixture happened to pick.
 */
function renderInBoard(
  doc: Y.Doc,
  runtime: Partial<ImageRuntimeSource>,
  over: { x: number; y: number; width: number; height: number } = {
    x: 10,
    y: 20,
    width: 320,
    height: 240,
  },
) {
  const source = runtimeSource();
  const merged: ImageRuntimeSource = { ...source, ...runtime };
  const inDocument = objectSnapshots(doc).find((object) => object.type === IMAGE_TYPE);
  const objectProps: ObjectProps = {
    // The document's own snapshot when there is one: what the board draws is what is stored.
    obj: (inDocument ?? image(over)) as ImageSnapshot,
    doc,
    zoom: 1,
    selected: true,
    editing: false,
    canEdit: true,
    onObjectPointerDown: () => {},
    onFocusSelect: () => {},
    onStartEdit: () => {},
    onEndEdit: () => {},
  };
  return render(
    <ImageRuntimeProvider runtime={() => merged} hasUploading={false}>
      <BoardImageObject {...objectProps} />
    </ImageRuntimeProvider>,
  );
}

/** The args for a re-render of the state renderer. */
function imageArgs(
  over: Partial<ImageSnapshot>,
  props: Partial<ImageObjectArgs>,
): ImageObjectArgs {
  return {
    image: image(over),
    isUploader: true,
    canRetry: true,
    now: START + 1000,
    onRetry: () => {},
    onRemove: () => {},
    ...props,
  };
}
