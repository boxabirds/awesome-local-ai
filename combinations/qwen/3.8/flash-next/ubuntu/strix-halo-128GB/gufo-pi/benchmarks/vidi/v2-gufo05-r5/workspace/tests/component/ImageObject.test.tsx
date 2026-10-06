/**
 * story 12 `image.object` component tests (TC-21 to TC-24).
 *
 * Every state an image can be in is rendered from a snapshot, with a clock the test chooses, so the
 * state that nobody stored - an upload that stopped coming - is exercised without waiting five minutes
 * for it. The presentational component is rendered directly for what it says; the registry's component
 * is rendered with a real `Y.Doc` and a real insert context for what it *does*, which is the half a
 * placeholder is for: Retry sending the same bytes again, Remove taking the object off the board.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { fireEvent } from '@testing-library/dom';
import * as Y from 'yjs';
import { describe, expect, test, vi } from 'vitest';
import { ImageObject, ImageBoardObject, ImageInsertContext, type ImageBoardObjectProps } from '../../src/client/objects/ImageObject';
import type { ImageInsertActions } from '../../src/client/images/useImageInsert';
import {
  createImagePlaceholders,
  deleteObjects,
  initDoc,
  markImageRetrying,
  snapshot,
  type ImageSnapshot,
} from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { renderBoard, runFrames } from './helpers';
import { FakeSocket, fakeWebSocket } from './fakeSocket';

/** The one id of a one-image insert, without an index that might not be there. */
function only(ids: string[]): string {
  const id = ids[0];
  if (!id) throw new Error('no placeholder was created');
  return id;
}

const NOW = 1_700_000_000_000;
const ASSET_KEY = 'abcdefghijklmnopqrstuv/0123456789abcdefghijklmnopqr';

function snap(overrides: Partial<ImageSnapshot> = {}): ImageSnapshot {
  return {
    id: 'image-1',
    type: 'image',
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    z: 1,
    createdAt: NOW - 1000,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: NOW - 2000,
    uploaderId: 'me',
    ...overrides,
  };
}

const noop = (): void => {};

/** The presentational component, as the design's contract hands it its inputs. */
function renderState(props: Partial<Parameters<typeof ImageObject>[0]> = {}): void {
  const { image, ...rest } = props;
  renderAtScreen(
    <ImageObject
      image={image ?? snap()}
      isUploader={false}
      canRetry={false}
      now={NOW}
      onRetry={noop}
      onRemove={noop}
      {...rest}
    />,
  );
}

function renderAtScreen(element: ReactElement): void {
  render(element);
}

describe('image.object.failed', () => {
  // TC-21: the person who was sending it is told it failed and offered the two ways out. Everyone
  // else is told there is no picture, which is the truth from where they are sitting.
  test('TC-21 a failed upload shows the uploader Retry and Remove', () => {
    renderState({ image: snap({ status: 'failed' }), isUploader: true, canRetry: true });

    expect(screen.getByTestId('image-failed')).toHaveTextContent('Upload failed');
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
    expect(screen.queryByTestId('image-unavailable')).toBeNull();
  });

  // TC-21, the other half: nobody else has the file, so nobody else is offered a retry of it.
  test('TC-21 anyone else sees an unavailable image, with no Retry', () => {
    renderState({ image: snap({ status: 'failed' }), isUploader: false, canRetry: false });

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent('Image unavailable');
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });
});

describe('image.object.unfinished', () => {
  // TC-22: five minutes of silence from an upload is an upload that is not coming back, and the box
  // says so to everyone - with the one action that is still possible.
  test('TC-22 an upload older than IMAGE_UPLOAD_STALE_MS says it did not finish', () => {
    renderState({
      image: snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1 }),
      now: NOW,
      isUploader: false,
    });

    expect(screen.getByTestId('image-unfinished')).toHaveTextContent("Image upload didn't finish");
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
    expect(screen.queryByTestId('image-uploading')).toBeNull();
    // there is nothing to retry: the bytes left with the screen that had them
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });

  // One millisecond short of the line, it is still an upload in progress, and the person waiting is
  // still waiting for a picture rather than clearing one away.
  test('TC-22 one millisecond before the line it still reads as uploading', () => {
    renderState({ image: snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS + 1 }), now: NOW });
    expect(screen.getByTestId('image-uploading')).toHaveTextContent('Uploading…');
  });

  // TC-22's second half, through the board's own wiring: Remove deletes the object.
  test('TC-22 Remove deletes the object from the board', () => {
    const doc = new Y.Doc();
    const id = only(createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'someone-else',
      NOW - IMAGE_UPLOAD_STALE_MS - 10,
    ));

    renderOnBoard(doc, id, { identityId: 'me', canRetry: () => false, retry: () => false, remove: (target) => deleteObjects(doc, [target]) });

    expect(screen.getByTestId('image-unfinished')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('image-remove'));

    expect(snapshot(doc).find((object) => object.id === id)).toBeUndefined();
  });
});

describe('image.object.uploading', () => {
  test('the uploader sees a percentage and a bar; everyone else sees the word', () => {
    renderState({ image: snap(), isUploader: true, progress: 0.25 });
    expect(screen.getByTestId('image-progress')).toHaveTextContent('25%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  test('someone else has no progress to show, because they are not sending anything', () => {
    renderState({ image: snap(), isUploader: false, progress: 0.25 });
    expect(screen.getByTestId('image-uploading')).toHaveTextContent('Uploading…');
    expect(screen.queryByTestId('image-progress')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('image.object.unavailable', () => {
  // TC-23: bytes that will not load are a fact about this screen's afternoon, not about the image, so
  // the answer is local - the same box, at the same size, with the picture missing.
  test('TC-23 an image that will not load becomes an unavailable box at its own size', () => {
    const doc = new Y.Doc();
    const id = only(createImagePlaceholders(
      doc,
      [{ rect: { x: 10, y: 20, width: 640, height: 360 }, naturalWidth: 1280, naturalHeight: 720, contentType: 'image/png' }],
      'me',
      NOW,
    ));
    // the placeholder is filled in the way an upload would fill it
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    doc.transact(() => {
      record.set('status', 'ready');
      record.set('assetKey', ASSET_KEY);
    });

    renderOnBoard(doc, id, { identityId: 'me', canRetry: () => false, retry: () => false, remove: (target) => deleteObjects(doc, [target]) });

    const box = screen.getByTestId('image-object');
    expect(screen.getByTestId('image-picture')).toHaveAttribute('src', `/api/assets/${ASSET_KEY}`);
    expect(box).toHaveStyle({ width: '640px', height: '360px' });

    act(() => {
      fireEvent.error(screen.getByTestId('image-picture'));
    });

    expect(screen.getByTestId('image-unavailable')).toHaveTextContent('Image unavailable');
    expect(screen.queryByTestId('image-picture')).toBeNull();
    // the box did not move or shrink: the message is drawn where the picture was
    expect(box).toHaveStyle({ width: '640px', height: '360px' });
    expect(box.querySelector('.image-object__inner')).toHaveAttribute('data-image-state', 'unavailable');
  });
});

describe('image.object.retry', () => {
  // TC-24: while the file is still in this screen's memory, Retry is a button; after a reload it is
  // not, and the only thing left to do is clear the box away.
  test('TC-24 Retry sends the same image again and puts it back to uploading', () => {
    const doc = new Y.Doc();
    const id = only(createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'me',
      NOW,
    ));
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    doc.transact(() => record.set('status', 'failed'));

    // what `useImageInsert.retry` does: restart the clock, then send the same file again
    const retry = vi.fn(() => markImageRetrying(doc, id, Date.now()));
    renderOnBoard(doc, id, { identityId: 'me', canRetry: () => true, retry, remove: noop });

    expect(screen.getByTestId('image-failed')).toHaveTextContent('Upload failed');
    fireEvent.click(screen.getByTestId('image-retry'));

    expect(retry).toHaveBeenCalledWith(id);
    expect(record.get('status')).toBe('uploading');
    expect(screen.getByTestId('image-uploading')).toBeInTheDocument();
  });

  // TC-24, after a reload: the bytes are gone, so there is no Retry to offer - and Remove still works,
  // because clearing an empty box is always possible.
  test('TC-24 after a reload only Remove is offered', () => {
    const doc = new Y.Doc();
    const id = only(createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'me',
      NOW,
    ));
    const record = doc.getMap<Y.Map<unknown>>('objects').get(id)!;
    doc.transact(() => record.set('status', 'failed'));

    renderOnBoard(doc, id, { identityId: 'me', canRetry: () => false, retry: () => false, remove: noop });

    expect(screen.getByTestId('image-failed')).toHaveTextContent('Upload failed');
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  // A board that cannot be written cannot have an object deleted from it, so the button that would
  // pretend otherwise is not shown as live: Remove does nothing while the room cannot load the board.
  test('Remove does nothing on a board that cannot be edited', () => {
    const doc = new Y.Doc();
    const id = only(createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'me',
      NOW - IMAGE_UPLOAD_STALE_MS - 10,
    ));
    const remove = vi.fn();
    renderOnBoard(doc, id, { identityId: 'me', canRetry: () => false, retry: () => false, remove }, { canEdit: false });

    fireEvent.click(screen.getByTestId('image-remove'));
    expect(remove).not.toHaveBeenCalled();
  });
});

/**
 * Renders the registry's component for one object of a real document, with an insert context wired to
 * `doc` the way `Board` wires it.
 */
function renderOnBoard(
  doc: Y.Doc,
  id: string,
  actions: Pick<ImageInsertActions, 'identityId' | 'canRetry' | 'retry' | 'remove'>,
  overrides: Partial<ImageBoardObjectProps> = {},
): void {
  const object = snapshot(doc).find((candidate) => candidate.id === id);
  if (!object || object.type !== 'image') throw new Error(`${id} is not an image on this board`);
  const props: ImageBoardObjectProps = {
    note: object,
    doc,
    zoom: 1,
    selected: false,
    editing: false,
    dragging: false,
    canEdit: true,
    onSelect: noop,
    onToggle: noop,
    onStartEdit: noop,
    onEndEdit: noop,
    onObjectPointerDown: noop,
    ...overrides,
  };
  const value: ImageInsertActions = { progress: new Map(), ...actions };
  const { rerender } = render(
    <ImageInsertContext.Provider value={value}>
      <ImageBoardObject {...props} />
    </ImageInsertContext.Provider>,
  );
  // keep the object in step with the document, as the board does
  doc.getMap('objects').observeDeep(() => {
    const current = snapshot(doc).find((candidate) => candidate.id === id);
    if (!current || current.type !== 'image') return;
    rerender(
      <ImageInsertContext.Provider value={value}>
        <ImageBoardObject {...props} note={current} />
      </ImageInsertContext.Provider>,
    );
  });
}

describe('image.object.resize', () => {
  // TC-29: a picture is resized from its corners in proportion - a photo stretched sideways is not
  // the same photo - and it cannot be dragged away to nothing.
  test('TC-29 resizing an image keeps its proportions and stops at the minimum size', async () => {
    const room = new Y.Doc();
    initDoc(room);
    vi.stubGlobal('WebSocket', fakeWebSocket);
    renderBoard();
    act(() => {
      FakeSocket.latest.open();
      FakeSocket.latest.syncWith(room);
    });
    await waitFor(() => {
      const state = window.__vidi6?.connectionState();
      expect(state === 'connected' || state === 'confirmed').toBe(true);
    });

    let id = '';
    await act(() => {
      id = only(createImagePlaceholders(
        window.__vidi6!.getDoc(),
        [{ rect: { x: 100, y: 100, width: 400, height: 300 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' }],
        'me',
        Date.now(),
      ));
    });
    await runFrames();

    const box = document.querySelector<HTMLElement>(`[data-image-id="${id}"]`);
    if (!box) throw new Error('the image was not rendered');
    fireEvent.pointerDown(box, pointer(200, 200));
    fireEvent.pointerUp(window, pointer(200, 200));
    await runFrames();

    // the corner handle, dragged out: wider and taller, in the same proportion
    await dragHandle('se', 120, 40);
    let placed = image(id);
    expect(placed.width / placed.height).toBeCloseTo(400 / 300, 4);
    expect(placed.width).toBeGreaterThan(400);

    // and dragged hard back in: it stops at the smallest image the board allows, still square-on
    await dragHandle('se', -5000, -5000);
    placed = image(id);
    expect(Math.min(placed.width, placed.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.001);
    expect(placed.width / placed.height).toBeCloseTo(400 / 300, 3);

    // the bytes on the board are the picture's own size, untouched by any of this
    expect(placed.naturalWidth).toBe(800);
    expect(placed.naturalHeight).toBe(600);
  });
});

function pointer(clientX: number, clientY: number): Record<string, unknown> {
  return { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX, clientY };
}

/** Where a selection handle sits on screen. The camera starts at the origin at zoom 1. */
function handlePoint(handle: string): { x: number; y: number } {
  const element = document.querySelector<HTMLElement>(`.selection-handle[data-handle="${handle}"]`);
  if (!element) throw new Error(`handle ${handle} is not rendered`);
  return { x: Number.parseFloat(element.style.left) + 6, y: Number.parseFloat(element.style.top) + 6 };
}

async function dragHandle(handle: string, dx: number, dy: number): Promise<void> {
  const from = handlePoint(handle);
  const element = document.querySelector<HTMLElement>(`.selection-handle[data-handle="${handle}"]`)!;
  fireEvent.pointerDown(element, pointer(from.x, from.y));
  await runFrames();
  fireEvent.pointerMove(window, pointer(from.x + dx, from.y + dy));
  await runFrames();
  fireEvent.pointerUp(window, pointer(from.x + dx, from.y + dy));
  await runFrames();
}

function image(id: string): ImageSnapshot {
  const found = window.__vidi6?.getObjects().find((candidate) => candidate.id === id);
  if (!found || found.type !== 'image') throw new Error(`${id} is no longer an image on this board`);
  return found;
}
