/**
 * What an image shows, from the moment it is a promise to the moment it is a picture or is not.
 *
 * The states are the story's whole second half: an image is a box before it has any bytes, and everything
 * a person sees between the drop and the picture is one of five answers to "where are my pixels?" -
 * uploading, uploaded, failed, gave-up, unavailable. They are drawn here out of a document that was written
 * by the real model, at sizes the model decided, so what is checked is the pair of things that has to agree:
 * the state the document is in and the state the board says it is in.
 *
 * Two of those answers differ between two people looking at the same object, and that difference is the
 * reason this file exists at all: the person who dropped the files has a file, so they get a percentage and
 * a Retry; everybody else has only the board, so they get the truth about the picture and no buttons that
 * would do nothing. Everything else - the box, its size, its place, its ratio - is the same for both, and
 * said so here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageObject } from '../../src/client/objects/ImageObject';
import {
  IMAGE_FAILED_TEXT,
  IMAGE_UNAVAILABLE_TEXT,
  IMAGE_UNFINISHED_TEXT,
  IMAGE_UPLOADING_TEXT,
} from '../../src/client/objects/ImageObject';
import {
  createImagePlaceholders,
  displayStatus,
  imageSnapshots,
  markImageFailed,
  markImageReady,
  type ImagePlacement,
  type ImageSnapshot,
} from '../../src/shared/objects/image';
import { IMAGE_TYPE } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import {
  centreOnScreen,
  clickAt,
  clickUndo,
  moveTo,
  mountSticky,
  press,
  pressKey,
  release,
  type MountedSticky,
} from './helpers/sticky';
import { flushFrames } from './helpers';

/** A board holding one image, put there by the model and by nothing else. */
interface OneImage {
  readonly doc: Y.Doc;
  readonly boardId: string;
  readonly id: string;
  readonly uploader: string;
  image(): ImageSnapshot;
}

/**
 * Put one picture on a board, in the state asked for, through the functions the app itself uses.
 *
 * Nothing here writes a Y.Map by hand: a fixture that set `status` directly would be a fixture that could
 * disagree with the model about what "failed" means, and the test would be checking the fixture.
 */
function oneImage(
  status: 'uploading' | 'ready' | 'failed',
  size: { width: number; height: number } = { width: 400, height: 300 },
): OneImage {
  const doc = new Y.Doc();
  const boardId = newBoardId();
  const uploader = String(doc.clientID);
  const placement: ImagePlacement = {
    rect: { x: 100, y: 60, width: size.width, height: size.height },
    naturalWidth: size.width,
    naturalHeight: size.height,
    contentType: 'image/png',
  };
  const [id] = createImagePlaceholders(doc, [placement], uploader, 1_000);
  if (id === undefined) {
    throw new Error('the board would not take the image');
  }
  if (status === 'ready') {
    markImageReady(doc, id, assetKeyFor(boardId, newBoardId()));
  }
  if (status === 'failed') {
    markImageFailed(doc, id);
  }
  return {
    doc,
    boardId,
    id,
    uploader,
    image: () => {
      const image = imageSnapshots(doc)[0];
      if (image === undefined) {
        throw new Error('the image is not on the board');
      }
      return image;
    },
  };
}

/** Draw one image's box, with the props the board would hand it. */
/**
 * Draw one image's box on its own, with the props the board would hand it - including who is looking,
 * which is the one prop that changes the answer and the only one a test has to decide for itself.
 */
function show(
  image: ImageSnapshot,
  options: {
    isUploader?: boolean;
    progress?: number;
    canRetry?: boolean;
    canRemove?: boolean;
    now?: number;
  } = {},
): void {
  render(
    <div style={{ position: 'relative', width: '800px', height: '600px' }}>
      <ImageObject
        image={image}
        isUploader={options.isUploader === true}
        progress={options.progress}
        canRetry={options.canRetry === true}
        canRemove={options.canRemove}
        now={options.now ?? 1_000}
        retry={() => {
          retries.push(image.id);
        }}
        remove={() => {
          removals.push(image.id);
        }}
      />
    </div>,
  );
}

const retries: string[] = [];
const removals: string[] = [];

beforeEach(() => {
  retries.length = 0;
  removals.length = 0;
});

describe('an image that is still on its way', () => {
  let fixture: OneImage;

  beforeEach(() => {
    fixture = oneImage('uploading');
  });

  /** TC-21's quieter half: the person who is sending it is told how far it has got. */
  it('says how far it has got, in numbers, to the person who is sending it', () => {
    show(fixture.image(), { isUploader: true, progress: 0.42, now: 1_000 });

    expect(screen.getByTestId('image-progress')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    // The bar is the same number drawn as a length, because a bar that disagreed with its own label would
    // be worse than no bar at all.
    const bar = screen.getByTestId('image-progress-bar').firstElementChild as HTMLElement;
    expect(bar.style.width).toBe('42%');
    // Nothing else about it: no buttons, no message. The transfer is going.
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByText(IMAGE_UPLOADING_TEXT)).toBeNull();
  });

  it('starts at nothing, and does not make up a number it was not given', () => {
    show(fixture.image(), { isUploader: true, now: 1_000 });

    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('says it is uploading, in words, to everybody else', () => {
    show(fixture.image(), { isUploader: false, now: 1_000 });

    expect(screen.getByText(IMAGE_UPLOADING_TEXT)).toBeTruthy();
    // Not a percentage: they have no upload to measure, and a `0%` that never moved would be a lie about
    // somebody else's transfer.
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByTestId('image-progress')).toBeNull();
  });

  /** TC-22: an upload that stopped being anybody's business. */
  it('says the upload did not finish, once it is clear that it has not', () => {
    const started = fixture.image().uploadStartedAt;
    show(fixture.image(), {
      isUploader: false,
      now: started + IMAGE_UPLOAD_STALE_MS + 1,
    });

    expect(screen.getByText(IMAGE_UNFINISHED_TEXT)).toBeTruthy();
    expect(screen.queryByText(IMAGE_UPLOADING_TEXT)).toBeNull();
    // And it can be cleared away by the person standing in front of it, who is not the person who started it.
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('says the same thing to the person who started it', () => {
    const started = fixture.image().uploadStartedAt;
    show(fixture.image(), {
      isUploader: true,
      progress: 0.2,
      now: started + IMAGE_UPLOAD_STALE_MS + 1,
    });

    // Their progress bar is no longer news: five minutes have gone by. What is left to say is that it
    // stopped, and the one thing left to do is to take it off the board.
    expect(screen.getByText(IMAGE_UNFINISHED_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('image-progress-bar')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('is patient right up to the moment it is not', () => {
    const started = fixture.image().uploadStartedAt;
    show(fixture.image(), {
      isUploader: false,
      now: started + IMAGE_UPLOAD_STALE_MS,
    });

    // Exactly the limit is not past it: the wording is still the waiting one. A board that gave up on an
    // upload a moment early would be a board that told people about a failure that was about to arrive.
    expect(displayStatus(fixture.image(), started + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(screen.getByText(IMAGE_UPLOADING_TEXT)).toBeTruthy();
    expect(screen.queryByText(IMAGE_UNFINISHED_TEXT)).toBeNull();
  });

  it('removes an abandoned upload when it is asked to', () => {
    const started = fixture.image().uploadStartedAt;
    show(fixture.image(), { isUploader: false, now: started + IMAGE_UPLOAD_STALE_MS + 1 });

    fireEvent.click(screen.getByTestId('image-remove'));

    expect(removals).toEqual([fixture.id]);
  });
});

describe('an image that did not arrive', () => {
  let fixture: OneImage;

  beforeEach(() => {
    fixture = oneImage('failed');
  });

  /** TC-21: the two versions of the same bad news, one per person. */
  it('tells the person who sent it that it failed, and offers to send it again', () => {
    show(fixture.image(), { isUploader: true, canRetry: true, now: 1_000 });

    expect(screen.getByTestId('image-failed').textContent).toContain(IMAGE_FAILED_TEXT);
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();

    fireEvent.click(screen.getByTestId('image-retry'));
    expect(retries).toEqual([fixture.id]);
  });

  it('offers no second attempt when there is nothing left to send', () => {
    show(fixture.image(), { isUploader: true, canRetry: false, now: 1_000 });

    // The message is still theirs, and so is the box; only the offer is gone, because the file is not in
    // this browser's memory any more. This is the state a page reload leaves behind.
    expect(screen.getByText(IMAGE_FAILED_TEXT)).toBeTruthy();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('tells everybody else only what it knows about the picture', () => {
    show(fixture.image(), { isUploader: false, canRetry: true, now: 1_000 });

    // Not "Upload failed": whose upload failed? Not theirs, and they cannot do anything about it. The
    // sentence about the picture is the true one, and the Retry would do nothing in their hands - the
    // file was never in their browser to begin with.
    expect(screen.getByText(IMAGE_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(screen.queryByText(IMAGE_FAILED_TEXT)).toBeNull();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    // They may still clear it off the board.
    expect(screen.getByTestId('image-remove')).toBeTruthy();
  });

  it('says nothing about removing it on a board that cannot be written', () => {
    show(fixture.image(), { isUploader: true, canRetry: true, canRemove: false, now: 1_000 });

    expect(screen.queryByTestId('image-remove')).toBeNull();
    // The offer to send it again stays: that is not writing to the board, that is sending a file.
    expect(screen.getByTestId('image-retry')).toBeTruthy();
  });
});

describe('a picture the browser could not draw', () => {
  let board: MountedSticky;
  let fixture: OneImage;

  beforeEach(async () => {
    fixture = oneImage('ready');
    board = await mountSticky(fixture.doc);
  });

  /** TC-23: the box stays when the pixels do not turn up. */
  it('draws the picture at the size the object says it is', () => {
    const place = board.place(fixture.id);
    expect(place).toMatchObject({ x: 100, y: 60, width: 400, height: 300 });

    const picture = board.element(fixture.id).querySelector('img');
    expect(picture).not.toBeNull();
    expect(picture?.getAttribute('src')).toBe(`/api/assets/${fixture.image().assetKey}`);
  });

  it('says the picture is not there, in the same space it would have taken up', () => {
    const before = board.place(fixture.id);
    const picture = board.element(fixture.id).querySelector('img');
    if (picture === null) {
      throw new Error('the picture was never drawn');
    }

    // The browser's own bad news: the address answered, or did not, and nothing was drawn.
    fireEvent.error(picture);

    const box = board.element(fixture.id);
    expect(box.textContent).toContain(IMAGE_UNAVAILABLE_TEXT);
    // The size the object was given is the size it keeps: a box that collapsed when its picture failed
    // would move the rest of the board's contents around, which is a second thing wrong with an accident
    // that needed only one.
    expect(board.place(fixture.id)).toEqual(before);
    // And the selection still finds it, because the object is still on the board.
    expect(board.outlineCount()).toBe(0);
    clickAt(box, centreOnScreen(board, board.object(fixture.id)));
    expect(board.outlineCount()).toBe(1);
  });
});

describe('an image that keeps its shape (TC-24)', () => {
  let board: MountedSticky;
  let fixture: OneImage;

  beforeEach(async () => {
    fixture = oneImage('ready', { width: 400, height: 300 });
    board = await mountSticky(fixture.doc);
  });

  /** Select the picture, the way a click does. */
  async function picked(): Promise<void> {
    clickAt(board.element(fixture.id), centreOnScreen(board, board.object(fixture.id)));
    await flushFrames();
  }

  /** Where a point of the board is on the screen, at the camera this board has. */
  function at(point: { x: number; y: number }): { x: number; y: number } {
    return board.screenOf(point);
  }

  /** Drag a corner from where it is drawn to where it is dropped. */
  async function dragCorner(to: { x: number; y: number }): Promise<void> {
    const object = board.object(fixture.id);
    const from = at({ x: object.x + object.width, y: object.y + object.height });
    press(board.handle('se'), from);
    moveTo(window, { x: from.x + 20, y: from.y + 15 });
    await flushFrames();
    moveTo(window, to);
    await flushFrames();
    release(window, to);
    await flushFrames();
  }

  it('is resizable, and says so with eight handles', async () => {
    await picked();

    expect(board.handleList().map((handle) => handle.dataset.handle)).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
  });

  it('stays the same shape when it is made bigger', async () => {
    await picked();
    const before = board.object(fixture.id);
    const ratio = before.width / before.height;

    const corner = at({ x: before.x + before.width, y: before.y + before.height });
    await dragCorner({ x: corner.x + 200, y: corner.y + 20 });

    const after = board.object(fixture.id);
    // The pointer went mostly sideways and barely down, and the picture came out wider by the same ratio
    // it went in with: 4 to 3 in, 4 to 3 out. Not the box the pointer described, which is a rectangle of
    // a shape the picture does not have.
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.width / after.height).toBeCloseTo(ratio, 4);
    // It grew from the corner that was held: the opposite corner did not move.
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
  });

  it('refuses to be squashed into nothing', async () => {
    await picked();
    const before = board.object(fixture.id);

    const corner = at({ x: before.x + before.width, y: before.y + before.height });
    // Driven far past the top-left corner: whatever the gesture's arithmetic says about the size, it is
    // not a size a person can aim at, so it stops at the smallest one there is.
    await dragCorner({ x: corner.x - 3_000, y: corner.y - 3_000 });

    const after = board.object(fixture.id);
    expect(after.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(after.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 4);
    expect(after.id).toBe(before.id);
    expect(after.type).toBe(IMAGE_TYPE);
  });

  it('keeps its status while it is being resized', async () => {
    await picked();
    const before = board.object(fixture.id);
    const corner = at({ x: before.x + before.width, y: before.y + before.height });
    await dragCorner({ x: corner.x + 100, y: corner.y + 75 });

    // A resize is a change of box and nothing else: the picture is the same picture, at the same address,
    // in the same state it was in before the handle was touched.
    const image = fixture.image();
    expect(image.status).toBe('ready');
    expect(board.element(fixture.id).dataset.status).toBe('ready');
    expect(image.assetKey).not.toBeNull();
  });
});

describe('an image taken off the board', () => {
  it('goes when the board is asked to forget it, and comes back with one undo', async () => {
    const fixture = oneImage('ready');
    const board = await mountSticky(fixture.doc);
    clickAt(board.element(fixture.id), centreOnScreen(board, board.object(fixture.id)));
    await flushFrames();

    // A picture on its own gets no toolbar of its own. A shape gets its two colours and a piece of text
    // gets its four sizes, because those carry their appearance on their face; a picture carries its
    // picture, and the one thing there is to do to it is to take it away - which is what the key is for,
    // and, when it has failed, what the button on the box itself is for.
    expect(board.barOrNull()).toBeNull();

    pressKey('Delete');
    await flushFrames();
    expect(imageSnapshots(fixture.doc)).toEqual([]);

    clickUndo(board);
    await flushFrames();

    // One step back, and the picture is back with its state and its size intact: a placeholder was made
    // in one transaction, so undoing is all or nothing, which is the only sensible meaning of "undo the
    // pictures I dropped".
    const back = imageSnapshots(fixture.doc);
    expect(back).toHaveLength(1);
    expect(back[0]!.status).toBe('ready');
    expect(back[0]!.width).toBe(400);
  });

  it('goes when its own Remove is pressed, and comes back with one undo', async () => {
    // The other way out of a box, for the states that draw a button: the same single step, because both
    // roads go through the same `deleteObjects` and the same undo boundaries.
    const fixture = oneImage('failed');
    const board = await mountSticky(fixture.doc);
    const button = board.element(fixture.id).querySelector<HTMLElement>('[data-testid="image-remove"]');
    if (button === null) {
      throw new Error('a failed picture with no Remove on it');
    }
    fireEvent.click(button);
    await flushFrames();
    expect(imageSnapshots(fixture.doc)).toEqual([]);

    clickUndo(board);
    await flushFrames();
    const back = imageSnapshots(fixture.doc);
    expect(back).toHaveLength(1);
    expect(back[0]!.status).toBe('failed');
  });
});
