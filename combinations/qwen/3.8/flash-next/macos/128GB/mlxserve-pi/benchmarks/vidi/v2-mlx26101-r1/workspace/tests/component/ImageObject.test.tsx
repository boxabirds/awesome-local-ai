// Story 12 — the four things a picture says when it is not a picture yet (image.upload_failure,
// image.upload_stalled, image.unavailable, image.placeholder_other).
//
// Most of this file renders `ImageObject` on its own, on purpose. Which of the five boxes to paint is
// a function of the stored fields, of who is looking, and of whether this tab still holds the file —
// and the difference between "Upload failed" and "Image unavailable" is the one thing in the story
// that is easy to get wrong and impossible to see from a screenshot taken by the person who caused it.
// So the uploader and the other person are both rendered here, from the same fields, in one test.
//
// The parts that are not a renderer's business — Remove deleting an object, Retry sending a file
// again — are tested against the mounted board, because that is the only place those callbacks are
// wired to something real.

import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ImageObject, ImageObjectView, imageViewState } from '../../src/client/objects/ImageObject';
import {
  createImagePlaceholders,
  displayStatus,
  markImageFailed,
  readImage,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { author } from '../../src/client/board/author';
import { boardDoc, clickObject, pointer, renderBoard, selectedObjectIds } from './helpers';
import { resetProviderStub, lastProvider } from './y-websocket-stub';

const MINUTE = 60_000;
const START = 1_700_000_000_000;

/** One call the board made to the upload module, with the test's end of the wire on it. */
interface Wire {
  id: number;
  file: File;
  /** Say "the server has an answer". */
  answer: (result: unknown) => Promise<void>;
}

const wires: Wire[] = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (_boardId: string, file: File, _onProgress: (fraction: number) => void) => {
    const id = wires.length;
    let settle: (result: unknown) => void = () => {};
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    const wire: Wire = {
      id,
      file,
      answer: async (result) => {
        await act(async () => {
          settle(result);
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      },
    };
    wires.push(wire);
    return { promise, abort: () => {} };
  },
}));

/** An image as the document holds it, with every field a renderer looks at filled in. */
function snap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 40,
    y: 60,
    width: 800,
    height: 600,
    naturalWidth: 1600,
    naturalHeight: 1200,
    assetKey: null,
    contentType: 'image/png',
    status: 'uploading',
    uploadStartedAt: START,
    uploaderId: 'me',
    createdBy: 'me',
    z: 3,
    createdAt: START,
    ...overrides,
  };
}

/** The presentational box, as one person sees it. */
function paint(
  image: ImageSnap,
  options: { isUploader?: boolean; canRetry?: boolean; progress?: number; now?: number } = {},
) {
  return render(
    <ImageObject
      image={image}
      zoom={1}
      isUploader={options.isUploader ?? false}
      canRetry={options.canRetry ?? false}
      progress={options.progress}
      now={options.now ?? image.uploadStartedAt}
      onRetry={() => {}}
      onRemove={() => {}}
    />,
  );
}

const box = (id = 'img-1'): HTMLElement => screen.getByTestId(`image-object-${id}`);
const stateOf = (id = 'img-1'): string => screen.getByTestId(`image-state-${id}`).textContent ?? '';
const statusOf = (id = 'img-1'): string | null => box(id).getAttribute('data-image-status');

/** A file the board will accept, and the size the browser will report for it. */
function png(name = 'a.png', width = 1200, height = 900): File {
  vi.stubGlobal('createImageBitmap', async () => ({ width, height, close() {} }));
  return new File([new Uint8Array(64)], name, { type: 'image/png' });
}

/** Say "the room is joined", which is what an upload needs before it is started. */
function connect(): void {
  const provider = lastProvider();
  if (!provider) throw new Error('the board never built a provider');
  act(() => {
    provider.emitSync(true);
  });
}

/** Hand the mounted board a drop of these files. */
function dropOnBoard(files: File[]): void {
  const event = createEvent.drop(screen.getByTestId('board-viewport'), { clientX: 100, clientY: 100 });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files: Object.assign(files, { item: (at: number) => files[at] ?? null }),
      types: ['Files'],
      dropEffect: 'none',
    },
  });
  fireEvent(screen.getByTestId('board-viewport'), event);
}

/** Put a picture on the mounted board through the model, aged by `ageMs` and owned by `owner`. */
function seed(owner: string, ageMs: number): string[] {
  let ids: string[] = [];
  act(() => {
    ids = createImagePlaceholders(
      boardDoc(),
      [{ rect: { x: 0, y: 0, width: 800, height: 600 }, naturalWidth: 1600, naturalHeight: 1200 }],
      owner,
      Date.now() - ageMs,
    );
  });
  return ids;
}

/** Let the board's side of an answered upload run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** What the shared document holds, as one comparable number: it moves when anything was written. */
const written = (): string => Array.from(Y.encodeStateVector(boardDoc())).join(',');

beforeEach(() => {
  resetProviderStub();
  wires.length = 0;
});

describe('a failed upload (TC-21)', () => {
  it('says "Upload failed" to the person who has the file, with a way out', () => {
    paint(snap({ status: 'failed' }), { isUploader: true, canRetry: true });

    expect(stateOf()).toBe('Upload failed');
    expect(statusOf()).toBe('failed');
    expect(screen.getByTestId('image-retry-img-1').textContent).toBe('Retry');
    expect(screen.getByTestId('image-remove-img-1').textContent).toBe('Remove');
  });

  it('says "Image unavailable" to everyone else, with nothing for them to press', () => {
    paint(snap({ status: 'failed' }), { isUploader: false, canRetry: false });

    expect(stateOf()).toBe('Image unavailable');
    expect(statusOf()).toBe('unavailable');
    // There is no Retry to offer someone who never had the file, and no Remove either: the PRD's
    // unavailable box is a grey box and nothing else. Getting rid of it is the board's ordinary way —
    // the box is selectable like any object, and Delete is the button for that (story 7).
    expect(screen.queryByTestId('image-retry-img-1')).toBeNull();
    expect(screen.queryByTestId('image-remove-img-1')).toBeNull();
  });

  it('offers no Retry once this tab has let go of the file, which is what a reload does', () => {
    paint(snap({ status: 'failed' }), { isUploader: true, canRetry: false });

    expect(stateOf()).toBe('Upload failed');
    expect(screen.queryByTestId('image-retry-img-1')).toBeNull();
    expect(screen.getByTestId('image-remove-img-1')).toBeTruthy();
  });

  it('keeps the box the same size and place in every one of its states', () => {
    for (const image of [
      snap({ status: 'uploading' }),
      snap({ status: 'failed' }),
      snap({ status: 'uploading', uploadStartedAt: START - IMAGE_UPLOAD_STALE_MS - 1 }),
      snap({ status: 'ready', assetKey: 'board0000000000/deadbeefcafebabe1234' }),
      snap({ status: 'failed', uploaderId: 'someone-else' }),
    ]) {
      const { unmount } = render(
        <ImageObject
          image={image}
          zoom={2}
          isUploader={image.uploaderId === 'me'}
          canRetry={image.status === 'failed' && image.uploaderId === 'me'}
          now={Date.now()}
          onRetry={() => {}}
          onRemove={() => {}}
        />,
      );
      // A box that changed size as it went from one state to another would move the board under a
      // person's cursor: the layout comes from the stored box and from nothing else.
      expect([box().style.left, box().style.top]).toEqual(['40px', '60px']);
      expect([box().style.width, box().style.height]).toEqual(['800px', '600px']);
      expect(box().style.zIndex).toBe('3');
      // The words and buttons stay the size they are read at, which is the other half of that rule:
      // the box is world-sized, so whatever is drawn inside it for the eye is divided by the zoom.
      const controls = screen.queryByTestId('image-remove-img-1')?.parentElement;
      if (controls) {
        expect(controls.getAttribute('style')).toContain('scale(0.5)');
      } else {
        // The states with no buttons have no buttons at any zoom, which is the same rule seen from
        // the other side.
        expect(screen.queryByTestId('image-retry-img-1')).toBeNull();
      }
      unmount();
    }
  });
});

describe('an upload that never finished (TC-22)', () => {
  it('says it did not finish, to anyone at all, and anyone can remove it', () => {
    const stale = snap({ uploaderId: 'someone-else', uploadStartedAt: START });
    const now = START + IMAGE_UPLOAD_STALE_MS + 1;

    paint(stale, { isUploader: false, now });

    expect(displayStatus(stale, now)).toBe('unfinished');
    expect(stateOf()).toBe("Image upload didn't finish");
    expect(statusOf()).toBe('unfinished');
    expect(screen.queryByTestId('image-retry-img-1')).toBeNull();
    expect(screen.getByTestId('image-remove-img-1')).toBeTruthy();

    // The uploader sees the same box: there is no file left to re-send, because nobody knows which
    // upload this was any more.
    expect(imageViewState(stale, true, now, false)).toBe('unfinished');
  });

  it('is removed for everybody, in one undo step', () => {
    renderBoard();
    const [id] = seed('someone-else', IMAGE_UPLOAD_STALE_MS + MINUTE);
    expect(within(box(id)).getByText("Image upload didn't finish")).toBeTruthy();

    fireEvent.click(screen.getByTestId(`image-remove-${id}`));

    expect(readImage(boardDoc(), id)).toBeUndefined();
    expect(screen.queryByTestId(`image-object-${id}`)).toBeNull();
    // Remove is the board's own delete, so it joins the undo history next to the Delete key that does
    // the same thing.
    fireEvent.click(screen.getByTestId('undo-button'));
    expect(readImage(boardDoc(), id)).toBeTruthy();
  });

  it('can still be selected and moved while it is only a box', () => {
    renderBoard();
    const [id] = seed('someone-else', MINUTE);

    // A placeholder that cannot be selected is a placeholder that cannot be moved, resized or
    // deleted with the keys everybody already knows.
    clickObject(id);
    expect(selectedObjectIds()).toContain(id);

    // And it moves with the pointer, because the gesture belongs to the board and not to the picture:
    // a placeholder that could not be pushed out of the way of the thing it is standing in front of
    // would be the worst possible placeholder to wait behind.
    const before = readImage(boardDoc(), id)!.x;
    act(() => {
      const el = screen.getByTestId(`image-hit-${id}`);
      pointer(el, 'pointerdown', 100, 100);
      pointer(window, 'pointermove', 180, 100);
      pointer(window, 'pointerup', 180, 100);
    });

    // Exactly the 80 px it was dragged, at the board's zoom of 1: the gesture is the shared one.
    expect(readImage(boardDoc(), id)!.x).toBeCloseTo(before + 80, 0);
  });
});

describe('a stored picture that cannot be drawn (TC-23)', () => {
  it('turns into the grey box, where it was, at the size it was', () => {
    const ready = snap({ status: 'ready', assetKey: 'board0000000000/gone-gone-gone-1' });
    paint(ready, { isUploader: true });

    expect(screen.getByTestId('image-img-1').getAttribute('src')).toBe(
      '/api/assets/board0000000000/gone-gone-gone-1',
    );

    // This is what a 404 does to an `<img>`, and what a key that outlived its bucket looks like.
    fireEvent.error(screen.getByTestId('image-img-1'));

    expect(statusOf()).toBe('unavailable');
    expect(stateOf()).toBe('Image unavailable');
    expect(screen.queryByTestId('image-img-1')).toBeNull();
    expect([box().style.width, box().style.height]).toEqual(['800px', '600px']);
    expect([box().style.left, box().style.top]).toEqual(['40px', '60px']);
  });

  it('says it to the other people on the board as well, without a word in the document', () => {
    paint(snap({ status: 'ready', assetKey: 'board0000000000/gone-gone-gone-1' }), {
      isUploader: false,
    });
    const before = written();

    fireEvent.error(screen.getByTestId('image-img-1'));

    expect(stateOf()).toBe('Image unavailable');
    // A broken draw is news about this browser's view of the world, not a fact for everybody's
    // document: nothing was written, so nobody else's board twitched.
    expect(written()).toBe(before);
  });

  it('paints the same box for an object that says a picture exists but cannot say which', () => {
    paint(snap({ status: 'ready', assetKey: null }), { isUploader: true });

    expect(stateOf()).toBe('Image unavailable');
    // There is no key to ask for, so nothing is asked for: no request is made for `/api/assets/null`.
    expect(screen.queryByTestId('image-img-1')).toBeNull();
  });

  it('is remembered per key, so a picture that is asked for again is asked for', () => {
    const broken = snap({ status: 'ready', assetKey: 'board0000000000/gone-gone-gone-1' });
    const { unmount } = paint(broken, { isUploader: true });
    fireEvent.error(screen.getByTestId('image-img-1'));
    expect(screen.queryByTestId('image-img-1')).toBeNull();
    unmount();

    // The same object, a different key: whatever went wrong last time was one object's bad luck and
    // not this picture's, so the browser is asked again.
    paint(snap({ status: 'ready', assetKey: 'board0000000000/other-other-other-2' }));
    expect(screen.getByTestId('image-img-1').getAttribute('src')).toBe(
      '/api/assets/board0000000000/other-other-other-2',
    );
  });
});

describe('retrying an upload (TC-24)', () => {
  it('sends the same file again and starts the clock over', async () => {
    renderBoard();
    connect();
    const file = png('a.png', 1200, 900);
    dropOnBoard([file]);
    await settle();

    const [id] = Object.keys(objectsOnBoard());
    expect(readImage(boardDoc(), id)!.status).toBe('uploading');

    await wires[0].answer({ kind: 'failed', status: 0 });
    expect(readImage(boardDoc(), id)!.status).toBe('failed');
    expect(within(box(id)).getByText('Upload failed')).toBeTruthy();

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    await settle();

    // A second request with the same file in it, on the same object: not a new placeholder beside the
    // old one, and not a new file the person never chose.
    expect(wires.map((w) => w.file)).toEqual([file, file]);
    const after = readImage(boardDoc(), id)!;
    expect(after.status).toBe('uploading');
    // The stale clock is what turns "uploading" into "didn't finish"; a Retry that did not reset it
    // would be a Retry that had already run out before it started.
    expect(Date.now() - after.uploadStartedAt).toBeLessThan(MINUTE);

    await wires[1].answer({
      kind: 'ok',
      assetKey: 'componenttestboard0004/ffffffffffeeeeeeee1234',
      contentType: 'image/png',
    });
    expect(readImage(boardDoc(), id)!.status).toBe('ready');
    expect(screen.getByTestId(`image-${id}`).getAttribute('src')).toBe(
      '/api/assets/componenttestboard0004/ffffffffffeeeeeeee1234',
    );
  });

  it('is not offered after a reload, when there is no file left to send', () => {
    renderBoard();
    // The same person, the same board, the same failed placeholder — and this tab's memory of the
    // file gone, which is exactly what a reload takes away.
    const [id] = seed(author(boardDoc()), 2 * MINUTE);
    act(() => {
      markImageFailed(boardDoc(), id);
    });

    expect(box(id).getAttribute('data-image-uploader')).toBe('self');
    expect(within(box(id)).getByText('Upload failed')).toBeTruthy();
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
    // Remove is still there, because somebody has to be able to tidy the board up.
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
  });

  it('is nobody else\'s button', () => {
    renderBoard();
    const [id] = seed('someone-else', 2 * MINUTE);
    act(() => {
      markImageFailed(boardDoc(), id);
    });

    expect(box(id).getAttribute('data-image-uploader')).toBe('other');
    expect(within(box(id)).getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
  });
});

describe('the box on a board with nothing to say (regression guards)', () => {
  it('still reads correctly with no image controls around it', () => {
    // The registry's component, rendered bare: no document, no clock, no idea who is asking. This
    // happens for any image drawn by a board that did not open the picture doors, and it must not be
    // a crash and must not be a lie.
    render(
      <ImageObjectView
        obj={snap({ status: 'failed' })}
        doc={new Y.Doc()}
        zoom={1}
        selected={false}
        sole={false}
        editing={false}
        canEdit={true}
        onObjectPointerDown={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        onColor={() => {}}
        onDelete={() => {}}
      />,
    );

    // Someone else's failed upload, as seen by a board that cannot know that: the safe answer.
    expect(stateOf()).toBe('Image unavailable');
    // The thing to press is still there, because a picture you cannot press is not on the board.
    expect(screen.getByTestId('image-hit-img-1')).toBeTruthy();
  });
});

/** The images on the mounted board, by id. */
function objectsOnBoard(): Record<string, ImageSnap> {
  const found: Record<string, ImageSnap> = {};
  for (const [id] of boardDoc().getMap<Y.Map<unknown>>('objects')) {
    const image = readImage(boardDoc(), id);
    if (image) found[id] = image;
  }
  return found;
}
