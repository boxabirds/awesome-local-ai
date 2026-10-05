/**
 * One picture, and the five things that can be true about it (TC-21 to TC-24).
 *
 * `ImageObject` is the only component on this board whose job is to draw a *lack*: a note has its words in the
 * document and a shape has its label, but an image has a key and a status, and between the drop and the picture
 * there is a stretch of time in which something has to be said about content that is not there yet. What has to be
 * said depends on who is saying it — which is the whole of what these tests are about.
 *
 *   - TC-21 — the same `failed` record, drawn two ways. The tab that uploaded it is told *Upload failed*, and is
 *     given the two things it can do: try again, and take it off the board. Everybody else is told *Image
 *     unavailable*, because "upload failed" said to a person who never uploaded anything is a sentence about
 *     somebody else's bad luck, and a Retry button in front of them is an offer to upload a file they do not have.
 *   - TC-22 — the state that is not in the document. The record still says *uploading*; the clock says it has said
 *     it for five minutes; what that means is that the tab which was uploading is gone and nobody is coming to
 *     finish it. The boundary is tested on both sides, because a state arrived at a minute early is a board that
 *     gives up on uploads that are merely slow.
 *   - TC-23 — a picture that will not load, found out by the `<img>` and known to nobody. The box stays exactly
 *     the size it was: an object that changes size when it fails is a board that reflows underneath a person who
 *     is looking at the failure.
 *   - TC-24 — Retry, and the one case where it is not offered: after a reload the file is gone and only the board
 *     remembers the image, so the button is not drawn rather than drawn and lying.
 *
 * Every snapshot here is written into a real document by the model and read back, rather than built as an object
 * literal: each one has to survive `isImageSnapshot`, the check the board does before it will draw a record at all,
 * and a hand-made snapshot can pass a test the real board would never have let reach a component.
 *
 * The flows that put these states there are in `useImageInsert.test.tsx`; the ones that need a browser are in
 * `tests/e2e/images.spec.ts`.
 */
import { createElement } from 'react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, type RenderResult } from '@testing-library/react';

import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { deleteObjects, initDoc, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import {
  assetUrl,
  createImagePlaceholders,
  imageSnapshots,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  type ImageSnap,
} from '../../src/shared/objects/image';
import type { ObjectProps } from '../../src/client/objects/objectProps';
import {
  IMAGE_REMOVE_LABEL,
  IMAGE_RETRY_LABEL,
  IMAGE_STATE_MESSAGES,
  ImageBoardObject,
  ImageObject,
  type ImageObjectProps,
} from '../../src/client/objects/ImageObject';

/** A time, so the stale maths has something to be measured against. */
const START = 1_700_000_000_000;

/** A well-formed key, because the component is not the place that gets to assume one. */
const KEY = 'vKd3xQ2mZ8rT7wL1nB4sY6/qW9tR2yU5iO8pA3sD6fG0z';

/** A 3:2 picture, placed at a size of its own. */
const BOX = { x: 120, y: 80, width: 600, height: 400 };

/** The same box, as the component writes it into `style`. */
const EXPECTED_BOX = { left: BOX.x, top: BOX.y, width: BOX.width, height: BOX.height };

function imageDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/**
 * One image, in whichever state the test is about, in a document of its own.
 *
 * A failed image is arrived at the way a failed image is arrived at: it was going to be ready, a key was written,
 * and then the upload did not make it. `markImageFailed` does not invent a key, and the states are drawn from what
 * the document actually holds — which is the difference between an image that failed with a file behind it and one
 * that never had one.
 */
function imageIn(
  doc: Y.Doc,
  state: { status?: 'uploading' | 'ready' | 'failed'; startedAt?: number } = {},
): { id: string; image: ImageSnap } {
  const [id] = createImagePlaceholders(
    doc,
    [{ rect: BOX, naturalWidth: 1200, naturalHeight: 800, contentType: 'image/png' }],
    'uploader-tab',
    state.startedAt ?? START,
  );
  if (id === undefined) throw new Error('the placeholder was not created');
  if (state.status === 'ready' || state.status === 'failed') markImageReady(doc, id, KEY);
  if (state.status === 'failed') markImageFailed(doc, id);
  return { id, image: imageOf(doc) };
}

function imageOf(doc: Y.Doc): ImageSnap {
  const image = imageSnapshots(doc)[0];
  if (image === undefined) throw new Error('the image is not in the document');
  return image;
}

/** Draw one picture, and hand back the render so a test can draw it again at a later time. */
function draw(props: Partial<ImageObjectProps> & Pick<ImageObjectProps, 'image'>): RenderResult {
  return render(
    createElement(ImageObject, {
      isUploader: true,
      canRetry: false,
      now: START,
      onRetry: () => {},
      onRemove: () => {},
      ...props,
    }),
  );
}

function object(): HTMLElement {
  return screen.getByTestId('image-object');
}

function said(): string | null {
  return screen.getByTestId('image-object-message').textContent;
}

/** The box the component is drawn at, as numbers rather than as CSS strings. */
function boxOf(element: HTMLElement): { left: number; top: number; width: number; height: number } {
  return {
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  };
}

describe('a picture that did not arrive (TC-21)', () => {
  it('TC-21: the tab that uploaded it is told it failed, and is given the two things it can do', () => {
    const { image } = imageIn(imageDoc(), { status: 'failed' });

    draw({ image, isUploader: true, canRetry: true });

    expect(said()).toBe(IMAGE_STATE_MESSAGES.failed);
    expect(screen.getByRole('button', { name: IMAGE_RETRY_LABEL })).not.toBeNull();
    expect(screen.getByRole('button', { name: IMAGE_REMOVE_LABEL })).not.toBeNull();
    // Red, and red only for the person who can do something about it.
    expect(object().className).toContain('image-object--failed');
    expect(object().className).toContain('image-object--mine');
    expect(object().getAttribute('data-image-status')).toBe('failed');
    // Still in its own place in the world, at the picture's own size: the failure does not move anything.
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
  });

  it('TC-21: everybody else is told the picture is unavailable, and is not offered somebody else’s retry', () => {
    // The same record, read by a second tab. `status: 'failed'` is in the document and arrived over the wire; the
    // file that would be retried is not, and never will be.
    const { image } = imageIn(imageDoc(), { status: 'failed' });

    draw({ image, isUploader: false, canRetry: false });

    expect(said()).toBe(IMAGE_STATE_MESSAGES.unavailable);
    // No Retry, because there is nothing to retry with: a button that starts nothing is worse than no button.
    expect(screen.queryByRole('button', { name: IMAGE_RETRY_LABEL })).toBeNull();
    // And no Remove either, which is the PRD's line rather than an oversight: the controls on a failed upload are
    // the uploader's to clean up after, and everybody else's way of getting rid of a picture that never arrived is
    // the one they already know for every object on the board — pick it up and delete it. What they are not given
    // is a second way that only works for the person who has the file.
    expect(screen.queryByRole('button', { name: IMAGE_REMOVE_LABEL })).toBeNull();
    expect(object().className).toContain('image-object--unavailable');
    // The red is not: it belongs to the person who has something to fix.
    expect(object().className).not.toContain('image-object--mine');
    expect(object().getAttribute('data-image-status')).toBe('unavailable');
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
  });

  it('TC-21: a board that cannot be written to offers neither button, and says the same thing anyway', () => {
    const { image } = imageIn(imageDoc(), { status: 'failed' });

    draw({ image, isUploader: true, canRetry: true, readOnly: true });

    // The news is still true; only the things that would have failed to do anything about it are gone.
    expect(said()).toBe(IMAGE_STATE_MESSAGES.failed);
    expect(screen.queryByRole('button', { name: IMAGE_RETRY_LABEL })).toBeNull();
    expect(screen.queryByRole('button', { name: IMAGE_REMOVE_LABEL })).toBeNull();
  });

  it('TC-21: the person uploading is told how far it has got, in words as well as in a width', () => {
    const { image } = imageIn(imageDoc());

    draw({ image, isUploader: true, progress: 0.4 });

    expect(said()).toBe(IMAGE_STATE_MESSAGES.uploading);
    expect(screen.getByTestId('image-object-percent').textContent).toBe('40%');
    const bar = screen.getByTestId('image-object-progress');
    expect(bar.getAttribute('role')).toBe('progressbar');
    // A percentage and not a bare number, because that is what a screen reader says out loud.
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(bar.getAttribute('aria-valuetext')).toBe('40%');
    expect(object().getAttribute('data-image-status')).toBe('uploading');
  });

  it('TC-21: a percentage is not shown to a person who cannot know it', () => {
    const { image } = imageIn(imageDoc());

    draw({ image, isUploader: false });

    // They are told a picture is coming, and are not told anything about a network that is not theirs.
    expect(said()).toBe(IMAGE_STATE_MESSAGES.uploading);
    expect(screen.queryByTestId('image-object-progress')).toBeNull();
    expect(screen.queryByTestId('image-object-percent')).toBeNull();
  });
});

describe('an upload nobody is finishing (TC-22)', () => {
  it('TC-22: five minutes is the boundary, and it is crossed a millisecond late rather than a minute early', () => {
    const { image } = imageIn(imageDoc());

    // Still uploading, one millisecond early: a board that concludes too early is a board that gives up on a
    // slow connection and tells people their picture did not come when it was two seconds from arriving.
    const view = draw({ image, isUploader: true, now: START + IMAGE_UPLOAD_STALE_MS - 1 });
    expect(said()).toBe(IMAGE_STATE_MESSAGES.uploading);
    expect(object().getAttribute('data-image-status')).toBe('uploading');

    // The board's clock ticks, and the same record is drawn again at the same place a moment later.
    view.rerender(
      createElement(ImageObject, {
        image,
        isUploader: true,
        canRetry: false,
        now: START + IMAGE_UPLOAD_STALE_MS + 1,
        onRetry: () => {},
        onRemove: () => {},
      }),
    );

    expect(said()).toBe(IMAGE_STATE_MESSAGES.unfinished);
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
  });

  it('TC-22: an unfinished upload has Remove, and Remove takes it off the board', () => {
    const doc = imageDoc();
    const { id, image } = imageIn(doc);
    // Five minutes later for everybody, including the person looking at it.
    const later = START + IMAGE_UPLOAD_STALE_MS + 1;

    draw({
      image,
      isUploader: false,
      now: later,
      onRemove: () => {
        deleteObjects(doc, [id]);
      },
    });

    expect(said()).toBe(IMAGE_STATE_MESSAGES.unfinished);
    // The state is the same for everybody — the uploader's tab is gone, so there is no uploader left to be an
    // exception — and the one control it comes with works for all of them.
    expect(object().getAttribute('data-image-status')).toBe('unfinished');
    expect(snapshot(doc).length).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: IMAGE_REMOVE_LABEL }));

    expect(imageSnapshots(doc).length).toBe(0);
    expect(snapshot(doc).length).toBe(0);
  });

  it('TC-22: an unfinished upload is not red, and is not offered a retry it has no file for', () => {
    const { image } = imageIn(imageDoc());

    draw({ image, isUploader: true, canRetry: true, now: START + IMAGE_UPLOAD_STALE_MS + 1 });

    // Grey, because there is nothing to fix: the file went away with the tab that had it, and a red box is a
    // promise that pressing something would help.
    expect(object().className).not.toContain('image-object--mine');
    expect(screen.queryByRole('button', { name: IMAGE_RETRY_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: IMAGE_REMOVE_LABEL })).not.toBeNull();
  });
});

describe('a picture that will not load (TC-23)', () => {
  it('TC-23: a stored picture is asked for at its own address, and drawn at the object’s own box', () => {
    const { image } = imageIn(imageDoc(), { status: 'ready' });

    draw({ image, isUploader: false });

    const img = screen.getByTestId('image-object-img') as HTMLImageElement;
    // The address the board serves stored images from, with the key in it and nothing else.
    expect(img.src).toContain(assetUrl(KEY));
    expect(img.getAttribute('alt')).toBe('Image');
    // It is a board object and not a picture on a wall: a dragged image would be a file drag over the board, and
    // a copy-out of a picture is not a thing this board offers.
    expect(img.draggable).toBe(false);
    expect(object().getAttribute('data-image-status')).toBe('ready');
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
  });

  it('TC-23: when the fetch fails the box says so, at the same size and in the same place', () => {
    const { image } = imageIn(imageDoc(), { status: 'ready' });

    draw({ image, isUploader: false });
    expect(boxOf(object())).toEqual(EXPECTED_BOX);

    fireEvent.error(screen.getByTestId('image-object-img'));

    // The words, and nothing else about the layout has moved.
    expect(said()).toBe(IMAGE_STATE_MESSAGES.unavailable);
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
    expect(object().getAttribute('data-image-status')).toBe('unavailable');
    expect(object().className).toContain('image-object--unavailable');
    // Still in the stacking order where it always was, and the broken `<img>` is gone rather than left there.
    expect(object().style.zIndex).toBe(String(image.z));
    expect(screen.queryByTestId('image-object-img')).toBeNull();
  });

  it('TC-23: the failure is this browser’s, and is not written anywhere', () => {
    const doc = imageDoc();
    const { image } = imageIn(doc, { status: 'ready' });

    draw({ image, isUploader: false });
    fireEvent.error(screen.getByTestId('image-object-img'));

    // A board cannot write "this failed for me" into a document four other people are reading, because it may
    // not have failed for them. The record is untouched.
    const stored = imageOf(doc);
    expect(stored.status).toBe('ready');
    expect(stored.assetKey).toBe(KEY);
  });

  it('TC-23: a record that says it is a picture and cannot be read as one is drawn as nothing, in its own place', () => {
    // A later build stores a number as a string. The registry component reads the document for what the board
    // could not read, finds nothing that can be drawn, and draws an empty box at the object's position: the
    // object still exists, is still selectable and can still be deleted.
    const doc = imageDoc();
    const { id } = imageIn(doc, { status: 'ready' });
    // The document is given a number that is a word, and the record the board hands the component is given one
    // that is not a number at all: both ways a record can be unreadable, in one test.
    const written = imageOf(doc);
    doc.getMap<Y.Map<unknown>>('objects').get(id)?.set('naturalWidth', 'twelve hundred');
    // The type system says a `naturalWidth` is a number. A document from some other build says otherwise, and the
    // cast is how this test says the same untrue thing that document does.
    const record = { ...written, naturalWidth: Number.NaN } as unknown as ObjectSnapshot;

    render(createElement(ImageBoardObject, boardProps(doc, record)));
    const element = object();
    expect(element.getAttribute('data-image-status')).toBe('unreadable');
    expect(element.style.left).toBe(`${BOX.x}px`);
    expect(element.style.top).toBe(`${BOX.y}px`);
    // It has taken nothing away: the record is still on the board, and still the same record.
    expect(snapshot(doc).length).toBe(1);
    expect(imageSnapshots(doc).length).toBe(0);
  });
});

describe('trying again (TC-24)', () => {
  it('TC-24: Retry uploads the same picture again, and is asked for by name', () => {
    const { image } = imageIn(imageDoc(), { status: 'failed' });
    let retried = 0;

    draw({
      image,
      isUploader: true,
      canRetry: true,
      onRetry: () => {
        retried += 1;
      },
    });

    fireEvent.click(screen.getByRole('button', { name: IMAGE_RETRY_LABEL }));

    expect(retried).toBe(1);
  });

  it('TC-24: pressing the buttons does not reach the board behind them', () => {
    const { image } = imageIn(imageDoc(), { status: 'failed' });
    let pressed = 0;

    draw({
      image,
      isUploader: true,
      canRetry: true,
      onPointerDown: () => {
        pressed += 1;
      },
    });

    // A press on Remove must not also pick the picture up: the pointer starts on a control, and the board behind
    // it has to know the difference.
    fireEvent.pointerDown(screen.getByRole('button', { name: IMAGE_RETRY_LABEL }), {
      button: 0,
      pointerType: 'mouse',
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: IMAGE_REMOVE_LABEL }), {
      button: 0,
      pointerType: 'mouse',
    });
    expect(pressed).toBe(0);
  });

  it('TC-24: after a reload there is nothing to upload again, so Retry is not offered and Remove still is', () => {
    // The tab was reloaded mid-upload. The document still holds a `failed` image with this tab's id on it, and
    // the file it came from is in nobody's memory. `canRetry` is the answer to *do you still have it*, and it is
    // no — so the button is not drawn, rather than drawn and lying.
    const { image } = imageIn(imageDoc(), { status: 'failed' });

    draw({ image, isUploader: true, canRetry: false });

    expect(screen.queryByRole('button', { name: IMAGE_RETRY_LABEL })).toBeNull();
    expect(screen.getByRole('button', { name: IMAGE_REMOVE_LABEL })).not.toBeNull();
    expect(said()).toBe(IMAGE_STATE_MESSAGES.failed);
  });

  it('TC-24: a retried upload is uploading again, at the size it always had', () => {
    const doc = imageDoc();
    const { id, image } = imageIn(doc, { status: 'failed' });

    // What Retry does to the record: the same box, the status back to uploading, and a clock that started again.
    expect(markImageRetrying(doc, id, START + 60_000)).toBe(true);
    const again = imageOf(doc);
    expect(again.status).toBe('uploading');
    // The key the last attempt left behind is still on the record, and nothing fetches it: the state that is drawn
    // is decided by the status, and a new key replaces it the moment one is stored.
    expect(again.assetKey).toBe(KEY);
    expect(again.uploadStartedAt).toBe(START + 60_000);

    draw({ image: again, isUploader: true, canRetry: true, now: START + 60_000 });

    expect(said()).toBe(IMAGE_STATE_MESSAGES.uploading);
    expect(boxOf(object())).toEqual(EXPECTED_BOX);
    expect(image.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD);
  });
});

/**
 * The props the registry hands an object, with nothing on the board but the one object being drawn.
 *
 * Built by hand rather than by mounting a board, because this test is about what one component does with a record
 * it cannot read — and a board around it would only add other people's objects to have to explain away.
 */
function boardProps(doc: Y.Doc, object: ObjectSnapshot): ObjectProps {
  return {
    object,
    doc,
    zoom: 1,
    selected: false,
    selectedCount: 0,
    editing: false,
    readOnly: false,
    interaction: 'idle',
    rects: new Map(),
    onPointerDown: () => {},
    onStartEdit: () => {},
    onEndEdit: () => {},
  };
}
