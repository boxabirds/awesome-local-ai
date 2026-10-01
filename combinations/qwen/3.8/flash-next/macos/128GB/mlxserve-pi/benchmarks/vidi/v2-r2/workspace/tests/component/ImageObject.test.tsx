// image.object (ui-component): what a picture's box says about itself, in every state a picture
// can be in.
//
// A picture is the first object on this board that arrives in two halves. The box - its place,
// its size, its proportions - is written the moment a file is chosen; the bytes follow a second
// later, a minute later, or never. So most of this file is about the words and marks a box wears
// while it is not yet a picture, and about the one thing a box must never do while it waits:
// pretend to be something it is not. A percentage copied from another person's upload, a Remove
// button on a board that cannot be deleted from, a Retry with no file left to retry with - each
// is a box saying something untrue, and each is a test below.
//
// The two halves are tested the way they happen. The states that come out of a shared document
// (uploading, ready, unfinished, read-only) are rendered through the real board, so the props they
// get are the props the board gives them. The states that depend on what *this* browser is doing -
// the upload it is watching, the file it still holds - are rendered on their own, with the props
// the board would give them, because a component test's board has no address to upload to.
//
// The lock itself is geometry and is tested in tests/unit/geometry.test.ts; what is tested here is
// that the image asks for it, and that asking for it changes what a drag on the board does.

import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  TYPE_IMAGE,
  TYPE_SHAPE,
  TYPE_STICKY,
} from '../../src/shared/config';
import { initDoc, type ObjectSnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { assetKeyFor } from '../../src/shared/image-format';
import {
  createImagePlaceholders,
  imageSnapshots,
  markImageFailed,
  markImageReady,
  type ImageSnapshot,
} from '../../src/shared/objects/image';
import { getObjectType, handlesFor } from '../../src/client/objects/registry';
import { ImageObject, type ImageObjectProps } from '../../src/client/objects/ImageObject';
import {
  clickOn,
  doubleClickOn,
  dragHandle,
  flushFrames,
  forceConnectionState,
  handlesShown,
  imageAt,
  imageBox,
  imageCount,
  imageIsUploader,
  imageNaturalOf,
  imagePicture,
  imageProgressOf,
  imageRemoveButton,
  imageRetryButton,
  imageSelected,
  imageSnapshotOf,
  imageSrcOf,
  imageStatusOf,
  imageWords,
  newImage,
  noteCount,
  pressKey,
  readCamera,
  renderBoard,
  screenOf,
  snapshotImages,
  useBoardTestLifecycle,
} from './helpers';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

interface Fixture {
  doc: Y.Doc;
  id: string;
  /** The newest state of the picture, as plain JSON: what a render would be handed. */
  note(): ImageSnapshot;
  rerender(props?: Partial<ImageObjectProps>): RenderResult;
}

/**
 * A document holding one picture, and no board rendered over it. For the states that are about
 * what *this* browser is doing - the upload it is watching, the file it still holds in memory -
 * which is the half the board's own render cannot produce: a component test's board has no address
 * to upload to.
 */
function picture(
  options: {
    status?: 'uploading' | 'ready' | 'failed';
    uploaderId?: string;
    startedAt?: number;
    at?: Point;
    size?: Size;
    natural?: Size;
  } = {},
): Fixture {
  const doc = new Y.Doc();
  initDoc(doc);
  const size = options.size ?? { width: 400, height: 300 };
  const at = options.at ?? { x: 0, y: 0 };
  const natural = options.natural ?? size;
  const status = options.status ?? 'uploading';
  const startedAt =
    options.startedAt ??
    (status === 'uploading' ? Date.now() : Date.now() - IMAGE_UPLOAD_STALE_MS - 60_000);

  const [id] = createImagePlaceholders(
    doc,
    [
      {
        rect: { x: at.x, y: at.y, width: size.width, height: size.height },
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        contentType: 'image/png',
      },
    ],
    options.uploaderId ?? 'client-test',
    startedAt,
  );
  if (id === undefined) throw new Error('picture: the model refused the placeholder');
  if (status === 'ready') markImageReady(doc, id, assetKeyFor(newBoardId(), newBoardId()));
  if (status === 'failed') markImageFailed(doc, id);

  const fixture: Fixture = {
    doc,
    id,
    note(): ImageSnapshot {
      const found = imageSnapshots(doc).find((image) => image.id === id);
      if (found === undefined) throw new Error('picture: the document holds no such image');
      return found;
    },
    rerender: () => renderBox(fixture),
  };
  return fixture;
}

function renderBox(fixture: Fixture, props?: Partial<ImageObjectProps>): RenderResult {
  return render(
    <ImageObject
      note={fixture.note()}
      doc={fixture.doc}
      zoom={1}
      selected={false}
      editable={true}
      onSelect={() => {}}
      {...props}
    />,
  );
}

describe('a waiting picture', () => {
  useBoardTestLifecycle();

  it('TC-21 shows the words of an upload in flight, and no percentage that is not its own', () => {
    const { doc } = renderBoard();
    // Somebody else's upload: this browser is watching it, not sending it.
    newImage(doc, {
      uploaderId: 'someone-else',
      at: { x: 120, y: 80 },
      size: { width: 320, height: 240 },
    });

    expect(imageCount()).toBe(1);
    expect(imageStatusOf(0)).toBe('uploading');
    expect(imageWords(0)).toBe('Uploading…');
    // The number belongs to the machine sending the bytes. A percentage copied from another
    // person's screen would be a guess about a connection this one cannot see.
    expect(imageProgressOf(0)).toBeNull();
    expect(imageIsUploader(0)).toBe(false);
    // Not a picture yet, and no broken-image icon pretending to be one.
    expect(imagePicture(0)).toBeNull();
    // The box is already the size the picture will be: proportions from the bytes, place and size
    // from where the file was dropped.
    expect(imageBox(0)).toEqual({ x: 120, y: 80, width: 320, height: 240 });
    expect(imageNaturalOf(0)).toEqual({ width: 320, height: 240 });
  });

  it('TC-21 shows this browser a percentage of its own upload', () => {
    const box = picture({ uploaderId: 'client-test' });
    // The board hands a box the progress of the upload it is itself running, and nothing else.
    renderBox(box, { isUploader: true, progress: 0.42 });

    expect(imageProgressOf(0)).toBe(42);
    expect(imageWords(0)).toBe('42%');
    // An upload that is climbing is not a failure: no warning colour, and no buttons, because
    // there is nothing a person could do about an upload that is going.
    expect(imageStatusOf(0)).toBe('uploading');
    expect(imageRetryButton(0)).toBeNull();
    expect(imageRemoveButton(0)).toBeNull();
  });

  it('TC-21 keeps the proportions the bytes had, so a box never squashes a panorama', () => {
    const { doc } = renderBoard();
    // A 4:1 panorama dropped onto the board: the box is built out of the bytes' own measurements,
    // so it is 4:1 from its first frame and never has to be corrected afterwards.
    newImage(doc, { size: { width: 800, height: 200 }, natural: { width: 2000, height: 500 } });

    expect(imageBox(0)).toEqual({ x: 0, y: 0, width: 800, height: 200 });
    expect(imageBox(0).width / imageBox(0).height).toBe(
      imageNaturalOf(0).width / imageNaturalOf(0).height,
    );
  });

  it('TC-19 calls an upload nobody is watching unfinished, and offers to clear it', () => {
    const { doc } = renderBoard();
    // The document still says `uploading`: a tab that was closed cannot fail an upload it never
    // finished, so nothing is ever written for it. What the box calls it is the board's business.
    newImage(doc, { startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1_000 });
    expect(imageSnapshots(doc)[0]?.status).toBe('uploading');

    expect(imageCount()).toBe(1);
    expect(imageStatusOf(0)).toBe('unfinished');
    expect(imageWords(0)).toBe("Image upload didn't finish");
    expect(imagePicture(0)).toBeNull();
    // The box is still an object, and the one person who could have finished that upload is the
    // one person who can get rid of it.
    expect(imageRemoveButton(0)).not.toBeNull();
  });

  it('TC-19 is still uploading at the boundary and unfinished one past it', () => {
    const started = Date.now() - IMAGE_UPLOAD_STALE_MS;
    const box = picture({ startedAt: started });
    const first = renderBox(box, { now: started + IMAGE_UPLOAD_STALE_MS });

    // The boundary is strict: at exactly the stale time an upload is still an upload.
    expect(imageStatusOf(0)).toBe('uploading');

    first.unmount();
    const later = picture({ startedAt: started });
    renderBox(later, { now: started + IMAGE_UPLOAD_STALE_MS + 1 });
    expect(imageStatusOf(0)).toBe('unfinished');
  });

  it('TC-19 removes an unfinished placeholder, and only it', () => {
    const { doc } = renderBoard();
    const doomed = newImage(doc, { startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1_000 });
    const kept = newImage(doc, { status: 'ready', at: { x: 500, y: 0 } });
    flushFrames();

    // The order the boxes are drawn in is the order the snapshots come out in - which is the
    // order they were created by, and not the order this test happened to write them.
    const index = snapshotImages(doc).findIndex((image) => image.id === doomed);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(imageStatusOf(index)).toBe('unfinished');

    fireEvent.click(imageRemoveButton(index)!);
    flushFrames();

    expect(imageCount()).toBe(1);
    expect(imageSnapshotOf(doc, doomed)).toBeNull();
    expect(imageSnapshotOf(doc, kept)).not.toBeNull();
    expect(snapshotImages(doc).map((image) => image.id)).toEqual([kept]);
  });

  it('TC-24 hides a Remove that has nowhere to write', () => {
    const { doc } = renderBoard();
    newImage(doc, { startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1_000 });
    forceConnectionState('load_failed');
    flushFrames();

    // A Remove that writes into a document the room will never read is a button that unappears at
    // the next reload, so it is not shown at all. The news itself is still there to read.
    expect(imageRemoveButton(0)).toBeNull();
    expect(imageWords(0)).toBe("Image upload didn't finish");
    expect(imageCount()).toBe(1);
    expect(imageSnapshots(doc)).toHaveLength(1);
  });

  it('TC-19 makes the removal one undo step, so the box comes back', () => {
    const { doc } = renderBoard();
    const id = newImage(doc, { startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1_000 });
    fireEvent.click(imageRemoveButton(0)!);
    flushFrames();
    expect(imageCount()).toBe(0);

    pressKey('z', { metaKey: true });
    flushFrames();

    // Undoing the removal undoes the removal - and not the upload that made a picture of it,
    // which was never an undo step at all (see `UPLOAD_ORIGIN`).
    expect(imageCount()).toBe(1);
    expect(imageSnapshotOf(doc, id)).not.toBeNull();
  });
});

describe('a picture that arrived', () => {
  useBoardTestLifecycle();

  it('TC-21 draws the bytes into the box, and names itself to anybody who cannot see it', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });

    const img = imagePicture(0);
    expect(img).not.toBeNull();
    // The key is a bucket location and the src is that location with the route in front of it -
    // same-origin, so there is no cross-origin rule to work around and nothing to leak.
    expect(imageSrcOf(0)).toBe(`/api/assets/${snapshotImages(doc)[0]?.assetKey}`);
    expect(img?.getAttribute('alt')).toBe('Image');
    expect(img?.getAttribute('draggable')).toBe('false');
    expect(img?.getAttribute('decoding')).toBe('async');
    expect(img?.getAttribute('loading')).toBe('lazy');
    // Drawn at the size of its box, which is the size of its own ratio.
    expect(imageBox(0)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(img?.style.width).toBe('400px');
    expect(img?.style.height).toBe('300px');
    // A box with a picture in it has nothing to report.
    expect(imageWords(0)).toBe('');
  });

  it('TC-21 turns into a picture the moment the bytes land, with no reload', () => {
    const { doc } = renderBoard();
    const id = newImage(doc, { status: 'uploading' });
    expect(imagePicture(0)).toBeNull();

    // The upload finishing is a document change like any other: whoever is watching sees the
    // picture as soon as they see the update.
    act(() => markImageReady(doc, id, assetKeyFor(newBoardId(), newBoardId())));
    flushFrames();

    expect(imageCount()).toBe(1);
    expect(imagePicture(0)).not.toBeNull();
    expect(imageStatusOf(0)).toBe('ready');
  });

  it('TC-22 shows a picture that will not decode as the hole it left', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });

    // The bytes are stored and are not a picture this browser can read - a truncated upload, a
    // file that was corrupt before it was ever chosen. The status in the document stays `ready`,
    // because only the browser loading the bytes knows: which is why this is a rendered state
    // rather than a sixth stored status.
    fireEvent.error(imagePicture(0)!);
    flushFrames();

    expect(imageStatusOf(0)).toBe('unavailable');
    expect(imageWords(0)).toBe('Image unavailable');
    expect(imagePicture(0)).toBeNull();
    // The box keeps its place and its proportions: what a person needs from a missing picture is
    // to know how big a hole it left, and where.
    expect(imageBox(0)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    // and it is still an object, so it can still be selected like one
    clickOn(imageAt(0));
    flushFrames();
    expect(imageSelected(0)).toBe(true);
  });

  it('TC-22 offers no retry for a picture that arrived, and deletes nothing', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready' });
    fireEvent.error(imagePicture(0)!);
    flushFrames();

    // There is no file in hand to send again - the bytes are on a server - so a Retry would ask
    // for nothing to be re-sent. And a picture that will not load here stays on the board:
    // another browser may read the very same bytes perfectly well.
    expect(imageRetryButton(0)).toBeNull();
    expect(imageRemoveButton(0)).toBeNull();
    expect(imageSnapshots(doc)).toHaveLength(1);
  });

  it('TC-24 shows a broken picture on a read-only board with nothing to press', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready' });
    fireEvent.error(imagePicture(0)!);
    flushFrames();
    forceConnectionState('load_failed');
    flushFrames();

    expect(imageStatusOf(0)).toBe('unavailable');
    expect(imageRemoveButton(0)).toBeNull();
    expect(imageSnapshots(doc)).toHaveLength(1);
  });
});

describe('a picture keeps its proportions', () => {
  useBoardTestLifecycle();

  it('TC-23 gives a selected picture eight handles, like a note or a shape', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });
    clickOn(imageAt(0));
    flushFrames();

    expect(imageSelected(0)).toBe(true);
    expect(handlesShown()).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  });

  it('TC-23 lets the axis that moved furthest decide, and the other one follow', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });
    const id = snapshotImages(doc)[0]?.id ?? '';
    clickOn(imageAt(0));
    flushFrames();
    // The camera the board ends up with, which on the first frame is not yet what it measured:
    // every screen figure below is divided by the zoom that was actually in force.
    const zoom = readCamera().zoom;

    const before = imageBox(0);
    // A corner drag of +200 by +100 screen pixels asks for a ratio the picture never had: 1.5
    // wide against 1.333 tall. The furthest-moving axis wins, whichever of the two it is.
    dragHandle('se', 200, 100);

    const after = imageBox(0);
    const asked = Math.max(
      (before.width + 200 / zoom) / before.width,
      (before.height + 100 / zoom) / before.height,
    );
    expect(after.width).toBeCloseTo(before.width * asked, 6);
    expect(after.height).toBeCloseTo(before.height * asked, 6);
    expect(after.width / after.height).toBeCloseTo(400 / 300, 6);
    // The corner that was grabbed moved and the one opposite it did not: a resize is anchored,
    // not centred.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // What changed is the box, not what the bytes measured.
    expect(imageSnapshotOf(doc, id)?.naturalWidth).toBe(400);
  });

  it('TC-23 stops a shrink at the picture own minimum, ratio and all', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });
    clickOn(imageAt(0));
    flushFrames();

    // The same shove inwards, over and over: the minimum is a floor rather than a value the box
    // is clamped to once and then walked away from. The shorter axis reaches it first and the
    // ratio carries the other one with it - which is the alternative to breaking the ratio in the
    // one place the story says it must not be broken.
    for (let attempt = 0; attempt < 8; attempt += 1) dragHandle('se', -300, -300);

    const after = imageBox(0);
    expect(after.height).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 6);
    expect(after.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(after.width / after.height).toBeCloseTo(400 / 300, 6);
  });

  it('TC-23 leaves an edge handle alone: an edge exists to change one axis', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', size: { width: 400, height: 300 } });
    clickOn(imageAt(0));
    flushFrames();

    const before = imageBox(0);
    dragHandle('e', 120, 0);

    const after = imageBox(0);
    expect(after.width).toBeCloseTo(before.width + 120 / readCamera().zoom, 6);
    expect(after.height).toBe(before.height);
    // The lock binds corners only, so a box dragged sideways is deliberately out of proportion -
    // and the picture is drawn as the box draws it, which is the outcome the person who reached
    // for an edge handle asked for.
    expect(imagePicture(0)?.style.height).toBe('300px');
  });

  it('TC-23 is grabbed and moved like any other object, ratio untouched', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready', at: { x: 100, y: 100 }, size: { width: 400, height: 300 } });
    clickOn(imageAt(0));
    flushFrames();

    const before = imageBox(0);
    const start = screenOf({ x: 200, y: 200 });
    dragPictureBox(start, 60, 40);

    const after = imageBox(0);
    const zoom = readCamera().zoom;
    expect(after.x).toBeCloseTo(before.x + 60 / zoom, 6);
    expect(after.y).toBeCloseTo(before.y + 40 / zoom, 6);
    // A move moves: it is not a resize in disguise.
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it('TC-23 is deleted by the keyboard like any other object', () => {
    const { doc } = renderBoard();
    const id = newImage(doc, { status: 'ready' });
    clickOn(imageAt(0));
    flushFrames();

    pressKey('Delete');
    flushFrames();

    expect(imageCount()).toBe(0);
    expect(imageSnapshotOf(doc, id)).toBeNull();
  });

  it('TC-23 does not drop a sticky note on top of a picture', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready' });
    const notes = noteCount();

    // A double-click on empty board makes a note where the board was clicked. A double-click on a
    // picture belongs to the picture, and the board never sees it - the same rule every other
    // object has, on the object a person is most likely to double-click by accident.
    doubleClickOn(imageAt(0), 20, 20);
    flushFrames();

    expect(noteCount()).toBe(notes);
    expect(imageCount()).toBe(1);
  });

  it('TC-24 shows the picture and switches off everything the board cannot do', () => {
    const { doc } = renderBoard();
    newImage(doc, { status: 'ready' });
    forceConnectionState('load_failed');
    flushFrames();

    // The bytes were stored with the board and are fetchable, so the picture is shown: a board the
    // room could not read is a board to read, and this is the one thing on it worth reading.
    expect(imagePicture(0)).not.toBeNull();
    expect(imageRemoveButton(0)).toBeNull();
    expect(imageRetryButton(0)).toBeNull();

    const before = imageBox(0);
    // Nothing to resize with, nothing to select with, and nothing to delete: a board the room
    // could not read shows its pictures and does nothing else.
    expect(handlesShown()).toEqual([]);
    dragPictureBox(screenOf({ x: 200, y: 150 }), 100, 100);
    expect(imageBox(0)).toEqual(before);

    pressKey('a', { metaKey: true });
    pressKey('Delete');
    flushFrames();
    expect(imageSnapshots(doc)).toHaveLength(1);
  });
});

describe("a picture's own buttons", () => {
  useBoardTestLifecycle();

  it('TC-20 offers Retry only with a file to retry with, and Remove always', () => {
    // This browser uploaded the picture and still holds the file: both buttons.
    const box = picture({ status: 'failed' });
    const onRetry = vi.fn();
    renderBox(box, { isUploader: true, canRetry: true, onRetry });

    expect(imageWords(0)).toBe('Upload failed');
    expect(imageRetryButton(0)).not.toBeNull();
    expect(imageRemoveButton(0)).not.toBeNull();

    fireEvent.click(imageRetryButton(0)!);
    expect(onRetry).toHaveBeenCalledWith(box.id);
  });

  it('TC-20 gives a failed upload with no file left the bin and no lie', () => {
    // The file is gone - this tab reloaded since, say. A Retry with nothing to send would be a
    // button that fails again in the time it takes to click it.
    const box = picture({ status: 'failed' });
    renderBox(box, { isUploader: true, canRetry: false });

    expect(imageRetryButton(0)).toBeNull();
    expect(imageRemoveButton(0)).not.toBeNull();
  });

  it('TC-20 tells a reader that the picture is unavailable, and hands them nothing to press', () => {
    // Whose upload it was, and that it was the one that failed, is nothing a person who is not the
    // uploader can do anything about: the fact, and not the story.
    const box = picture({ status: 'failed', uploaderId: 'someone-else' });
    renderBox(box, { isUploader: false, canRetry: false });

    expect(imageWords(0)).toBe('Image unavailable');
    expect(imageRetryButton(0)).toBeNull();
    expect(imageRemoveButton(0)).toBeNull();
  });

  it('TC-20 gives its buttons their own clicks, so a press on Retry is not a drag', () => {
    const box = picture({ status: 'failed' });
    const onRetry = vi.fn();
    const onGesture = vi.fn();
    renderBox(box, { isUploader: true, canRetry: true, onRetry, onGesturePointerDown: onGesture });

    const retry = imageRetryButton(0)!;
    // A press inside the box's own controls never reaches the gesture: the buttons belong to the
    // box, and the box is draggable.
    fireEvent.pointerDown(retry, { pointerId: 3, pointerType: 'mouse', button: 0, buttons: 1 });
    expect(onGesture).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('TC-20 clears a failed placeholder through the board when it has no remover of its own', () => {
    // Rendered on its own, with no `onRemove`: the box still clears itself, and does it through
    // the board model - the same delete the bin makes, undo boundary and all - rather than by
    // falling off the screen and leaving the object behind.
    const box = picture({ status: 'failed' });
    renderBox(box, { isUploader: true });
    fireEvent.click(imageRemoveButton(0)!);

    // The document is what a board renders from; this render has no board in front of it, so the
    // box in it stays on screen until something re-renders it. What is being tested is that the
    // delete went through the model, which is where the next render reads from.
    expect(imageSnapshots(box.doc)).toHaveLength(0);
  });

  it('TC-24 hides the buttons of a box on a board that takes no changes', () => {
    // What the board says about a box is `editable={false}`; the box is the one that has to act on
    // it, since it is the box with the buttons.
    const box = picture({ status: 'failed' });
    renderBox(box, { isUploader: true, canRetry: true, editable: false });

    expect(imageRemoveButton(0)).toBeNull();
    expect(imageRetryButton(0)).toBeNull();
    expect(imageWords(0)).toBe('Upload failed');
    expect(imageSnapshots(box.doc)).toHaveLength(1);
  });
});

describe('the registry and a picture', () => {
  it('TC-23 registers a picture as an object that keeps its ratio', () => {
    const spec = getObjectType(TYPE_IMAGE);
    expect(spec).toBeDefined();
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    // Eight handles, like a note and a shape: the lock binds the corners, and an edge still means
    // what an edge means everywhere else on this board.
    expect(handlesFor([anObject(TYPE_IMAGE)])).toHaveLength(8);
  });

  it('TC-23 keeps the ratio only when everything in the selection can keep it', () => {
    // A sticky is square by nature and a picture keeps its own ratio, so a group of the two is
    // locked and one scale serves both. A picture and a shape are not: a shape has no ratio to
    // keep, and one scale is applied to every object in a group, so the group is unlocked - whose
    // ratio it would have been is not a question a group resize can answer.
    expect(getObjectType(TYPE_STICKY)?.aspectLocked).toBe(true);
    expect(getObjectType(TYPE_SHAPE)?.aspectLocked).toBe(false);
    expect([TYPE_IMAGE, TYPE_STICKY].every((type) => getObjectType(type)?.aspectLocked === true)).toBe(true);
    expect([TYPE_IMAGE, TYPE_SHAPE].every((type) => getObjectType(type)?.aspectLocked === true)).toBe(false);
    // Both groups still get the handles to drag: which rule the drag follows is the gesture's
    // question, and the registry only answers what each object would keep if it were alone.
    expect(handlesFor([anObject(TYPE_IMAGE), anObject(TYPE_SHAPE)])).toHaveLength(8);
  });
});

// --------------------------------------------------------------------------------
// The two helpers of this file's own.
// --------------------------------------------------------------------------------

/** An object of one type, as far as the registry is concerned: it reads the type and nothing else. */
function anObject(type: string): ObjectSnapshot {
  return { type } as ObjectSnapshot;
}

/** A drag of a picture's box: press its middle, move, release. */
function dragPictureBox(from: Point, dx: number, dy: number): void {
  const el = imageAt(0);
  fireEvent.pointerDown(el, {
    pointerId: 5,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  for (const step of [1, 2, 3, 4]) {
    fireEvent.pointerMove(window, {
      pointerId: 5,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + (dx * step) / 4,
      clientY: from.y + (dy * step) / 4,
    });
    flushFrames();
  }
  fireEvent.pointerUp(window, {
    pointerId: 5,
    pointerType: 'mouse',
    clientX: from.x + dx,
    clientY: from.y + dy,
  });
  flushFrames();
}

export {};
