/**
 * What a picture looks like while it is not a picture yet (story 12, TC-21 … TC-24).
 *
 * The component under test has five states and one rule that decides between four of them: *who is looking*.
 * The person who dropped the file is the only person in the world holding its bytes, so they are the only
 * person a Retry can be offered and the only person a percentage means anything to. Everybody else is
 * watching a box that a stranger is filling, which is why one document draws two different boxes. Those two
 * sentences are most of this file, and they are the reason the component is rendered with an explicit
 * `isUploader` rather than being left to work it out for itself: a state a component invents for itself is a
 * state nobody can put on the table and ask about.
 *
 * The objects handed to it are the ones the model produces. Each test puts a placeholder on a real document
 * with `createImagePlaceholders` and reads it back, then moves it along with `markImageReady` /
 * `markImageFailed`, so what gets drawn here is a document's own object and not a hand-typed likeness of one
 * — a fixture that drifted from the schema would be a test of the fixture.
 *
 * Two things are fabricated, and both are things jsdom cannot do rather than things it was easier to skip:
 * jsdom fetches nothing, so an `<img>` that fails to load is an `error` event sent by the test; and jsdom has
 * no layout, so "the same box, the same size" is read out of the element's inline style, which is the only
 * place its size is written at all.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import * as Y from 'yjs';

import { deleteObject, initDoc, snapshot } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_STALE_TICK_MS, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  createImagePlaceholders,
  displayStatus,
  isImageSnapshot,
  markImageFailed,
  markImageReady,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { boardIdentity, IDENTITY_STORAGE_KEY, resetBoardIdentity } from '../../src/client/board/identity';
import { assetUrl } from '../../src/client/images/uploadImage';
import {
  IMAGE_ALT,
  IMAGE_UNAVAILABLE_LABEL,
  ImageObject,
  ImageObjectView,
  ImageRuntimeContext,
  imageObjectType,
  REMOVE_LABEL,
  RETRY_LABEL,
  UPLOADING_LABEL,
  UPLOAD_FAILED_LABEL,
  UPLOAD_UNFINISHED_LABEL,
  type ImageRuntime,
} from '../../src/client/objects/ImageObject';
import type { ObjectProps } from '../../src/client/objects/registry';

/** The instant every test asks the clock about, so that "five minutes later" is a number and not a wait. */
const NOW = 1_700_000_000_000;

/** The board these pictures are on, for the keys the ready ones are addressed by. */
const BOARD_ID = newBoardId();

/** The key a ready picture is stored under, of the shape the worker hands back. */
const ASSET_KEY = `${BOARD_ID}/${'a'.repeat(22)}`;

/** Whose browser these tests are, by default. */
const ME = 'Anna';

/** Says who this tab is, and forgets whatever the last test remembered. */
function asIdentity(name: string): void {
  sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify({ name, color: '#00838F' }));
  resetBoardIdentity();
}

/** The one picture on the document, read back as the object it is. */
function readOne(doc: Y.Doc, id: string): ImageSnap {
  const found = snapshot(doc).find(isImageSnapshot);
  if (found === undefined || found.id !== id) throw new Error(`the board holds no picture called ${id}`);
  return found;
}

/**
 * A document holding one picture, in the state asked for.
 *
 * The box is 640 × 480 at (200, 120) out of a 1280 × 960 file, so it is half-size — which is what a dropped
 * screenshot of anything bigger than the maximum looks like, and what makes the sizes below worth asserting.
 */
function seeded(
  state: 'uploading' | 'ready' | 'failed',
  options: { uploaderId?: string; startedAt?: number } = {},
): { doc: Y.Doc; image: ImageSnap } {
  const doc = new Y.Doc();
  initDoc(doc);
  const [id] = createImagePlaceholders(
    doc,
    [
      {
        rect: { x: 200, y: 120, width: 640, height: 480 },
        naturalWidth: 1280,
        naturalHeight: 960,
        contentType: 'image/png',
      },
    ],
    options.uploaderId ?? ME,
    // Dropped *now*, by the clock the components under test read for themselves. The tests that ask about a
    // moment in time say so with an explicit `now` prop or an explicit `startedAt`; the rest get a picture
    // whose upload is still young, which is what a placeholder is when it first appears.
    options.startedAt ?? Date.now(),
  );
  const created = readOne(doc, id as string);
  // These are the model's own two writes, called the way the hook calls them — each its own transaction,
  // each with the upload's origin, so nothing here is an undo step by accident.
  if (state === 'ready') markImageReady(doc, created.id, ASSET_KEY);
  if (state === 'failed') markImageFailed(doc, created.id);
  return { doc, image: readOne(doc, created.id) };
}

/**
 * A place on the page for one render.
 *
 * Testing Library's per-render queries are bound to the container it was given, or to the whole document when
 * it was given none — and several tests here draw the same object twice, once as its uploader and once as
 * somebody else, which is a comparison that only means anything if each render can see its own box.
 */
function scratch(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

/** What a test asked the component to draw, and the two verbs the board was offered. */
interface Rendered {
  readonly view: RenderResult;
  readonly retry: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
}

/** Draws one picture with the props the board would give it, plus the two things a person can ask for. */
function draw(
  image: ImageSnap,
  props: Partial<{
    isUploader: boolean;
    progress: number;
    canRetry: boolean;
    now: number;
    selected: boolean;
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  }> = {},
): Rendered {
  const retry = vi.fn();
  const remove = vi.fn();
  const view = render(
    <ImageObject
      image={image}
      isUploader={props.isUploader ?? true}
      canRetry={props.canRetry ?? false}
      now={props.now ?? NOW}
      onRetry={retry}
      onRemove={remove}
      {...(props.progress === undefined ? {} : { progress: props.progress })}
      {...(props.selected === undefined ? {} : { selected: props.selected })}
      {...(props.onPointerDown === undefined ? {} : { onPointerDown: props.onPointerDown })}
    />,
    { container: scratch() },
  );
  return { view, retry, remove };
}

/**
 * The box one render drew.
 *
 * Queried through the render rather than through the document, because several tests here draw the same
 * object twice — as its uploader and as somebody else — and a comparison between the two is the whole point.
 */
const box = (view: RenderResult): HTMLElement => view.getByTestId('image-object');

/** The size and place the box is drawn at — the only place jsdom, which lays nothing out, keeps such a fact. */
function measureOf(element: HTMLElement): { left: string; top: string; width: string; height: string } {
  return {
    left: element.style.left,
    top: element.style.top,
    width: element.style.width,
    height: element.style.height,
  };
}

/** The measure of a render's box, which is what "the same size, the same place" is compared as. */
const measure = (view: RenderResult): ReturnType<typeof measureOf> => measureOf(box(view));

beforeEach(() => {
  asIdentity(ME);
});

describe('a failed upload, in the browser that still has the file (TC-21)', () => {
  it('says it failed, and offers the two things this person can do about it', () => {
    const { image } = seeded('failed');
    const { view } = draw(image, { isUploader: true, canRetry: true, now: NOW + 1_000 });

    expect(view.getByText(UPLOAD_FAILED_LABEL).textContent).toBeTruthy();
    expect(view.getByTestId('image-retry').textContent).toBe(RETRY_LABEL);
    expect(view.getByTestId('image-remove').textContent).toBe(REMOVE_LABEL);
    expect(box(view).dataset.status).toBe('failed');
    // The box is the size the picture would have been, because that is the size the space is.
    expect(measure(view)).toEqual({ left: '200px', top: '120px', width: '640px', height: '480px' });
  });

  it('asks for the same file to be sent again when Retry is pressed', () => {
    const { image } = seeded('failed');
    const { view, retry, remove } = draw(image, { isUploader: true, canRetry: true });

    fireEvent.click(view.getByTestId('image-retry'));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('asks for the box to be taken away when Remove is pressed', () => {
    const { image } = seeded('failed');
    const { view, remove } = draw(image, { isUploader: true, canRetry: true });

    fireEvent.click(view.getByTestId('image-remove'));

    expect(remove).toHaveBeenCalledTimes(1);
    // The box is still drawn, because the document still says what it says: this component draws the state it
    // is given and the board is the one that takes it away, in the same write anybody else's delete is.
    expect(box(view).dataset.status).toBe('failed');
  });

  it('presses the control and does not also drag the picture out from under the pointer', () => {
    const { image } = seeded('failed');
    const pressed = vi.fn();
    const { view } = draw(image, { isUploader: true, canRetry: true, onPointerDown: pressed });

    // A press on Retry is a press on Retry. Handed on as well, the board would read it as a press on the
    // picture and start a move that the person meant to be a click.
    fireEvent.pointerDown(view.getByTestId('image-retry'));
    fireEvent.pointerDown(view.getByTestId('image-remove'));
    expect(pressed).not.toHaveBeenCalled();

    // A press on the box itself is the board's business, and reaches it exactly once.
    fireEvent.pointerDown(box(view));
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});

describe('the same failure, for everybody else (TC-21)', () => {
  it('says the picture is not there, which is the truth from where they are standing', () => {
    const { image } = seeded('failed');
    const { view } = draw(image, { isUploader: false, canRetry: false, now: NOW + 60_000 });

    expect(view.getByText(IMAGE_UNAVAILABLE_LABEL).textContent).toBeTruthy();
    expect(view.queryByTestId('image-retry')).toBeNull();
    expect(box(view).dataset.status).toBe('unavailable');
    // Not this person's upload, so not this person's retry: the bytes are not in this browser, and a button
    // that could only fail would be an accusation that the board is broken.
    expect(view.queryByTestId('image-remove')).toBeNull();
  });

  it('gives the stranger a box of the same size and place, with a name to be read out', () => {
    const { image } = seeded('failed');
    const uploader = draw(image, { isUploader: true, canRetry: true });
    const other = draw(image, { isUploader: false });

    expect(measure(other.view)).toEqual(measure(uploader.view));
    expect(box(other.view).getAttribute('aria-label')).toBe(IMAGE_UNAVAILABLE_LABEL);
    // The uploader's box is a report with controls in it and this one is a picture that is missing; both are
    // the same hole in the same place, which is what keeps the board from reflowing around bad news.
    expect(box(uploader.view).dataset.status).toBe('failed');
  });

  it('keeps saying it however long ago the upload gave up, because the failure is in the document', () => {
    const { image } = seeded('failed');
    const { view } = draw(image, { isUploader: false, now: NOW + IMAGE_UPLOAD_STALE_MS * 3 });

    expect(view.getByText(IMAGE_UNAVAILABLE_LABEL).textContent).toBeTruthy();
    expect(box(view).dataset.status).toBe('unavailable');
  });
});

describe('an upload nobody is going to finish (TC-22)', () => {
  /** A placeholder left uploading for five minutes and a second: the uploader reloaded, or closed the tab. */
  const abandoned = (uploaderId = ME): ImageSnap =>
    seeded('uploading', { uploaderId, startedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1_000 }).image;

  it('says it did not finish, to the person who left, and lets them clear it away', () => {
    const { view } = draw(abandoned(), { isUploader: true, canRetry: false, now: NOW });

    expect(view.getByText(UPLOAD_UNFINISHED_LABEL).textContent).toBeTruthy();
    expect(view.getByTestId('image-remove').textContent).toBe(REMOVE_LABEL);
    expect(box(view).dataset.status).toBe('unfinished');
    // Nothing to retry: the file went away with the tab that dropped it, and this state is reached by people
    // who never had the file as much as by the one who did.
    expect(view.queryByTestId('image-retry')).toBeNull();
  });

  it('says it to a stranger too, because a box that will never fill is everybody’s problem', () => {
    const { view } = draw(abandoned('Ben'), { isUploader: false, now: NOW });

    expect(view.getByText(UPLOAD_UNFINISHED_LABEL).textContent).toBeTruthy();
    expect(view.getByTestId('image-remove').textContent).toBe(REMOVE_LABEL);
    expect(box(view).dataset.status).toBe('unfinished');
    // The one state whose controls do not depend on who is looking: whoever is in front of a hole in the
    // board is allowed to fill it in by taking it out.
    expect(view.queryByTestId('image-retry')).toBeNull();
  });

  it('clears the box away when Remove is pressed, with the same write anybody else’s delete is', () => {
    const { doc, image } = seeded('uploading', { startedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1_000 });
    const { view, remove } = draw(image, { isUploader: false, now: NOW });

    fireEvent.click(view.getByTestId('image-remove'));

    expect(remove).toHaveBeenCalledTimes(1);
    // What the board does with that call is delete the object — here, through the model, the same function
    // the selection's own delete key reaches for, and the undo step it writes is story 8's.
    deleteObject(doc, image.id);
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('still calls it uploading four minutes and fifty-nine minutes of seconds before that, and stopped after', () => {
    const startedAt = NOW - IMAGE_UPLOAD_STALE_MS;
    const { image } = seeded('uploading', { startedAt });

    // The line is "more than five minutes": four minutes and fifty-nine seconds and change is still a
    // transfer somebody might be watching, and one millisecond past it is not. Asked at the moment the
    // upload is exactly five minutes old, it is still the old one, because the setting is a span and not an
    // instant at which something becomes false.
    expect(displayStatus(image, startedAt + IMAGE_UPLOAD_STALE_MS - 1)).toBe('uploading');
    expect(displayStatus(image, startedAt + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');

    const { view } = draw(image, { isUploader: true, now: startedAt + IMAGE_UPLOAD_STALE_MS - 1 });
    expect(view.getByText(UPLOADING_LABEL).textContent).toBeTruthy();
    expect(box(view).dataset.status).toBe('uploading');
  });
});

describe('a picture that will not load (TC-23)', () => {
  it('turns into an unavailable box the same size in the same place', () => {
    const { image } = seeded('ready');
    const { view } = draw(image, { isUploader: false });

    const before = measure(view);
    expect(box(view).dataset.status).toBe('ready');
    const img = box(view).querySelector('img');
    expect(img?.getAttribute('alt')).toBe(IMAGE_ALT);

    // jsdom asks nothing for an image and so never fails one: the error a browser raises when the bytes do not
    // arrive is sent here, which is the one thing a test can do about a network that is not there.
    fireEvent.error(img as HTMLImageElement);

    expect(box(view).dataset.status).toBe('unavailable');
    expect(view.getByText(IMAGE_UNAVAILABLE_LABEL).textContent).toBeTruthy();
    expect(box(view).querySelector('img')).toBeNull();
    // The box did not move and did not resize. A placeholder that grew to fit its own bad news would push
    // the rest of the board out of place to report one missing file.
    expect(measure(view)).toEqual(before);
  });

  it('keeps the size of a box that was resized before it broke', () => {
    const { image } = seeded('ready');
    // A picture somebody dragged to a third of its size: the proportion is the file's, the box is this
    // person's, and the message has to fit the box rather than the other way round.
    const { view } = draw({ ...image, width: 300, height: 225 }, { isUploader: false });
    const before = measure(view);

    fireEvent.error(box(view).querySelector('img') as HTMLImageElement);

    expect(before.width).toBe('300px');
    expect(measure(view)).toEqual(before);
  });

  it('gives the next picture at that address a chance to load', () => {
    const { doc, image } = seeded('ready');
    const { view } = draw(image, { isUploader: false });

    fireEvent.error(box(view).querySelector('img') as HTMLImageElement);
    expect(view.getByText(IMAGE_UNAVAILABLE_LABEL).textContent).toBeTruthy();

    // A new key is a different picture at the same place, and the memory that this address failed is about
    // the old one. A component that remembered failure per *position* would report a replaced picture as
    // missing for as long as it was there.
    const replacementKey = `${BOARD_ID}/${'b'.repeat(22)}`;
    markImageReady(doc, image.id, replacementKey);
    view.rerender(
      <ImageObject
        image={readOne(doc, image.id)}
        isUploader={false}
        canRetry={false}
        now={NOW + 10_000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(box(view).querySelector('img')?.getAttribute('src')).toBe(assetUrl(replacementKey));
    expect(box(view).dataset.status).toBe('ready');
  });

  it('addresses the picture by its key, and calls it Image to a screen reader', () => {
    const { image } = seeded('ready');
    const { view } = draw(image, { isUploader: false });

    expect(box(view).querySelector('img')?.getAttribute('src')).toBe(assetUrl(ASSET_KEY));
    expect(box(view).getAttribute('aria-label')).toBe(IMAGE_ALT);
    expect(box(view).getAttribute('role')).toBe('img');
  });
});

describe('the percentage, which only one person can see (TC-21)', () => {
  it('shows the uploader a number, as a bar and as words', () => {
    const { image } = seeded('uploading');
    const { view } = draw(image, { isUploader: true, progress: 0.4, now: NOW + 2_000 });

    expect(view.getByTestId('image-progress-text').textContent).toBe(`${UPLOADING_LABEL} 40%`);
    const bar = view.getByTestId('image-progress-bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    expect(box(view).dataset.status).toBe('uploading');
  });

  it('says only the words before the first progress event arrives', () => {
    const { image } = seeded('uploading');
    const { view } = draw(image, { isUploader: true, now: NOW + 500 });

    // A transfer that has reported nothing has no percentage, and "0 %" is a claim about bytes rather than
    // the absence of one.
    expect(view.queryByTestId('image-progress-bar')).toBeNull();
    expect(view.getByText(UPLOADING_LABEL).textContent).toBeTruthy();
  });

  it('says "Uploading…" to everybody else, with no number at all', () => {
    const { image } = seeded('uploading', { uploaderId: 'Ben' });
    const { view } = draw(image, { isUploader: false, now: NOW + 500 });

    expect(view.getByText(UPLOADING_LABEL).textContent).toBeTruthy();
    expect(view.queryByTestId('image-progress-bar')).toBeNull();
    expect(view.queryByTestId('image-progress-text')).toBeNull();
    // The progress of a transfer happening in another person's browser is not a thing this screen could show
    // even if it were told, so it is not shown: a box, and four words.
    expect(box(view).dataset.status).toBe('uploading-other');
  });

  it('keeps the box at the size the picture will arrive at while it fills', () => {
    const { image } = seeded('uploading');
    const { view } = draw(image, { isUploader: true, progress: 0.02, now: NOW });

    // The placeholder is drawn at the size the picture will be, so the board around it never moves when the
    // bytes land — including for the person watching two per cent of it arrive.
    expect(measure(view)).toEqual({ left: '200px', top: '120px', width: '640px', height: '480px' });
  });
});

/** The props every object is handed, of which a picture uses four. */
function objectProps(image: ImageSnap, overrides: Partial<ObjectProps<ImageSnap>> = {}): ObjectProps<ImageSnap> {
  return {
    obj: image,
    doc: new Y.Doc(),
    zoom: 1,
    selected: false,
    soleSelected: false,
    pressed: false,
    dragging: false,
    editing: false,
    editable: true,
    onSelect: () => {},
    onStartEdit: () => {},
    onEndEdit: () => {},
    onDeleted: () => {},
    onObjectPointerDown: () => {},
    ...overrides,
  };
}

/** A runtime that answers whatever the test says, and remembers what it was asked to do. */
function runtime(answers: Partial<ImageRuntime> = {}): ImageRuntime & { removed: string[]; retried: string[] } {
  const removed: string[] = [];
  const retried: string[] = [];
  return {
    progressOf: () => undefined,
    canRetry: () => false,
    retry: (id) => {
      retried.push(id);
      return true;
    },
    remove: (id) => {
      removed.push(id);
    },
    ...answers,
    removed,
    retried,
  };
}

/** Puts a view inside a board that has (or has not got) an upload runtime, and draws it. */
function inBoard(children: ReactNode, provider: ImageRuntime | null): RenderResult {
  return render(
    <ImageRuntimeContext.Provider value={provider}>
      <div>{children}</div>
    </ImageRuntimeContext.Provider>,
    { container: scratch() },
  );
}

describe('what the board hands the picture (the registered view)', () => {
  it('decides who is looking by comparing the object against this tab’s name', () => {
    // The same object, the same document, the same runtime: the only thing that changes is the name this tab
    // is called by, which is where "was this mine?" comes from on a board with no accounts.
    const mine = seeded('failed', { uploaderId: ME }).image;
    expect(mine.uploaderId).toBe(boardIdentity().name);
    const asUploader = inBoard(<ImageObjectView {...objectProps(mine)} />, runtime({ canRetry: () => true }));
    expect(asUploader.getByTestId('image-retry').textContent).toBe(RETRY_LABEL);

    const theirs = seeded('failed', { uploaderId: 'Ben' }).image;
    const asStranger = inBoard(<ImageObjectView {...objectProps(theirs)} />, runtime({ canRetry: () => true }));
    expect(asStranger.queryByTestId('image-retry')).toBeNull();
    expect(asStranger.getByText(IMAGE_UNAVAILABLE_LABEL).textContent).toBeTruthy();
  });

  it('takes the percentage from the board rather than keeping one of its own', () => {
    const { image } = seeded('uploading');
    const view = inBoard(<ImageObjectView {...objectProps(image)} />, runtime({ progressOf: () => 0.75 }));

    expect(view.getByTestId('image-progress-text').textContent).toBe(`${UPLOADING_LABEL} 75%`);
  });

  it('still draws the picture when the board offers no runtime at all', () => {
    const { image } = seeded('uploading');
    const view = inBoard(<ImageObjectView {...objectProps(image)} />, null);

    // A picture with no upload hook behind it is a picture whose state is only what the document says: the
    // box and the words are still right, and the one thing missing is the number nobody has reported.
    expect(view.getByText(UPLOADING_LABEL).textContent).toBeTruthy();
    expect(view.queryByTestId('image-progress-bar')).toBeNull();

    const broken = seeded('failed').image;
    const failed = inBoard(<ImageObjectView {...objectProps(broken)} />, null);
    // No runtime means no file in memory, which is exactly why Retry is not offered: the question "is the
    // file still here?" is answered "no" by the same absence that answers "how far did it get?".
    expect(failed.queryByTestId('image-retry')).toBeNull();
    expect(failed.getByTestId('image-remove').textContent).toBe(REMOVE_LABEL);
  });

  it('asks the board to retry the file it was given, and to delete the box it was told to remove', () => {
    const { image } = seeded('failed');
    const provider = runtime({ canRetry: () => true });
    const view = inBoard(<ImageObjectView {...objectProps(image)} />, provider);

    fireEvent.click(view.getByTestId('image-retry'));
    fireEvent.click(view.getByTestId('image-remove'));

    expect(provider.retried).toEqual([image.id]);
    expect(provider.removed).toEqual([image.id]);
  });

  it('falls back to the board’s own delete when there is no runtime to ask', () => {
    const { image } = seeded('uploading', { startedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1_000 });
    const deleted = vi.fn();
    const view = inBoard(<ImageObjectView {...objectProps(image, { onDeleted: deleted })} />, null);

    fireEvent.click(view.getByTestId('image-remove'));

    expect(deleted).toHaveBeenCalledWith(image.id);
  });

  it('hands a press on the picture to the board, and once only', () => {
    const { image } = seeded('ready');
    const pressed = vi.fn();
    const seenByBoard = vi.fn();
    const view = render(
      <ImageRuntimeContext.Provider value={null}>
        <div onPointerDown={seenByBoard}>
          <ImageObjectView {...objectProps(image, { onObjectPointerDown: pressed })} />
        </div>
      </ImageRuntimeContext.Provider>,
      { container: scratch() },
    );

    fireEvent.pointerDown(box(view), { button: 0 });

    // The board is told once, and the press stops there: a press on a picture is not also a press on the air
    // above the board, which would pan the board and drop the selection at the same moment.
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(pressed.mock.calls[0]?.[1]).toBe(image.id);
    expect(seenByBoard).not.toHaveBeenCalled();
  });

  it('takes no notice of a press that was not the left button', () => {
    const { image } = seeded('ready');
    const pressed = vi.fn();
    const view = inBoard(<ImageObjectView {...objectProps(image, { onObjectPointerDown: pressed })} />, null);

    fireEvent.pointerDown(box(view), { button: 2 });

    expect(pressed).not.toHaveBeenCalled();
  });

  it('says which object it drew, so the board and the selection can find it again', () => {
    const { image } = seeded('ready');
    const view = inBoard(<ImageObjectView {...objectProps(image, { selected: true })} />, null);

    expect(box(view).dataset.objectId).toBe(image.id);
    expect(box(view).getAttribute('data-selected')).toBe('true');
    expect(box(view).getAttribute('data-width')).toBe('640');
  });

  it('is registered as an object that keeps its proportion and stops shrinking at sixteen', () => {
    // The gesture and the handles read these off the registry, so the four words that make an image an image
    // are asserted where they are written rather than through six drags that would each test one of them.
    expect(imageObjectType.resizable).toBe(true);
    expect(imageObjectType.aspectLocked).toBe(true);
    expect(imageObjectType.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(imageObjectType.editableText).toBe(false);
  });

  it('re-asks the clock while a picture is waiting, so that unfinished arrives by itself', () => {
    // Nobody re-renders this object and nothing is written to the document: the box changes state because it
    // asked the clock again on the board's own tick, which is the only thing that can turn "still going" into
    // "didn't finish" for an upload whose browser has stopped existing. The timers are faked, and the clock
    // goes with them, so five minutes of waiting costs nothing.
    vi.useFakeTimers();
    try {
      const { image } = seeded('uploading', { startedAt: Date.now() });
      const view = inBoard(<ImageObjectView {...objectProps(image)} />, null);
      expect(view.getByText(UPLOADING_LABEL).textContent).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + IMAGE_STALE_TICK_MS);
      });

      expect(box(view).dataset.status).toBe('unfinished');
      expect(view.getByText(UPLOAD_UNFINISHED_LABEL).textContent).toBeTruthy();
      // A box that has stopped being an upload has stopped being a thing to watch, and offers what it now is.
      expect(view.queryByTestId('image-progress-bar')).toBeNull();
      expect(view.getByTestId('image-remove').textContent).toBe(REMOVE_LABEL);
    } finally {
      vi.useRealTimers();
    }
  });
});
