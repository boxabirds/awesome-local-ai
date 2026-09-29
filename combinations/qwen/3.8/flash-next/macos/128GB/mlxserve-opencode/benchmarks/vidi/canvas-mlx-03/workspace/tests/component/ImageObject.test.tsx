// Story 12 task 8 — what a box says about the picture inside it (TC-21 to TC-24).
//
// The states come out of one function, `displayStatus(image, now)`, and what these tests hold is
// that the box is drawn from that and from nothing else: the same record is 'Upload failed' with a
// Retry on the screen that is holding the file, and 'Image unavailable' on the screen that is not,
// and a box that is five minutes old says "Image upload didn't finish" on every screen at once.
//
// The records are made by the real image model on a real document, then handed to the component,
// because a hand-written object would let a test pass on a shape the board never produces. Where a
// test is about which button does what to the document rather than what is drawn, it mounts the
// board itself.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  IMAGE_STATE_LABELS,
  IMAGE_UNAVAILABLE_LABEL,
  ImageObject,
  ImageObjectView,
  progressLabel,
} from '../../src/client/objects/ImageObject.tsx';
import { initDoc, type ObjectSnapshot } from '../../src/shared/board-model.ts';
import {
  asImageSnapshot,
  createImagePlaceholders,
  imageSnapshots,
  markImageFailed,
  markImageReady,
} from '../../src/shared/objects/image.ts';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import BoardApp from '../../src/client/board/BoardApp.tsx';

const T0 = 1_700_000_000_000;
/** The tab that has the file, and somebody else looking at the same board. */
const UPLOADER = 'tab-aaaaaaaa';
const OTHER = 'tab-bbbbbbbbbb';

let doc: Y.Doc;
let boardId: string;

/** One picture on the board, in the state asked for, at a known place and size. */
function place(
  state: 'uploading' | 'ready' | 'failed',
  at: { x: number; y: number; width: number; height: number } = {
    x: 400,
    y: 300,
    width: 800,
    height: 500,
  },
  startedAt = T0,
): string {
  const ids = createImagePlaceholders(
    doc,
    [
      {
        rect: at,
        naturalWidth: 1440,
        naturalHeight: 900,
        contentType: 'image/png',
      },
    ],
    UPLOADER,
    startedAt,
  );
  const id = ids[0]!;
  if (state === 'ready') markImageReady(doc, id, `${boardId}/0123456789abcdef`);
  if (state === 'failed') markImageFailed(doc, id);
  return id;
}

function snapshotOf(id: string): ObjectSnapshot {
  const found = imageSnapshots(doc).find((obj) => obj.id === id);
  if (!found) throw new Error('the board has no such picture');
  return found;
}

function renderImage(
  id: string,
  opts: { as?: string; progress?: number; canRetry?: boolean; now?: number; retry?: () => void; remove?: () => void } = {},
) {
  const image = asImageSnapshot(snapshotOf(id))!;
  return render(
    <ImageObject
      image={image}
      isUploader={(opts.as ?? UPLOADER) === image.uploaderId}
      progress={opts.progress}
      canRetry={opts.canRetry ?? true}
      now={opts.now ?? T0 + 1000}
      onRetry={opts.retry ?? (() => {})}
      onRemove={opts.remove ?? (() => {})}
    />,
  );
}

beforeEach(() => {
  boardId = newBoardId();
  doc = new Y.Doc();
  initDoc(doc);
});

afterEach(() => {
  cleanup();
});

describe('a failed upload (TC-21)', () => {
  it('offers Retry and Remove to the tab that is holding the file', () => {
    const id = place('failed');
    renderImage(id, { as: UPLOADER });

    expect(screen.getByTestId('image-unavailable').getAttribute('data-image-status')).toBe('failed');
    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_STATE_LABELS.failed);
    expect(screen.getByTestId('image-state-label').textContent).toBe('Upload failed');
    expect(screen.getByTestId(`image-retry-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
  });

  it('says only that there is no picture to everybody else', () => {
    const id = place('failed');
    renderImage(id, { as: OTHER });

    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_UNAVAILABLE_LABEL);
    // They are not offered a Retry: the file is not on their machine, and a button that cannot
    // do the thing it says is worse than no button.
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(screen.queryByTestId(`image-remove-${id}`)).toBeNull();
  });

  it('still gives a record it cannot read as a picture a box that can be deleted', () => {
    const id = place('ready');
    // A record written by a build whose idea of a picture this one cannot follow. It is still an
    // object on the board, and a board that drew nothing for it would hold something nobody can
    // select, move or delete.
    const unreadable = { ...snapshotOf(id), status: undefined } as unknown as ObjectSnapshot;
    const down: string[] = [];
    render(
      <ImageObjectView
        obj={unreadable}
        doc={doc}
        zoom={1}
        camera={{ x: 0, y: 0, zoom: 1 }}
        selected={false}
        editing={false}
        canEdit
        onObjectPointerDown={(_e, objectId) => down.push(objectId)}
        onObjectDoubleClick={() => {}}
        onStartEdit={() => {}}
        onEndEdit={() => {}}
        imageIdentityId={UPLOADER}
        imageNow={T0}
      />,
    );
    const box = screen.getByTestId('image-unavailable');
    expect(box.textContent).toContain(IMAGE_UNAVAILABLE_LABEL);
    fireEvent.pointerDown(box);
    expect(down).toEqual([id]);
  });
});

describe('an upload that never came back (TC-22)', () => {
  it('says it did not finish, to anybody, and offers Remove', () => {
    const id = place('uploading', undefined, T0);
    renderImage(id, { as: OTHER, now: T0 + IMAGE_UPLOAD_STALE_MS + 1 });

    expect(screen.getByTestId('image-unavailable').getAttribute('data-image-status')).toBe(
      'unfinished',
    );
    expect(screen.getByTestId('image-state-label').textContent).toBe(
      IMAGE_STATE_LABELS.unfinished,
    );
    expect(screen.getByTestId('image-state-label').textContent).toBe(
      "Image upload didn't finish",
    );
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
    // Remove is the only thing anybody can do; nobody is sending these bytes again.
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
  });

  it('says the same to the tab that was doing the uploading', () => {
    const id = place('uploading', undefined, T0);
    renderImage(id, { as: UPLOADER, now: T0 + IMAGE_UPLOAD_STALE_MS + 1 });
    expect(screen.getByTestId('image-state-label').textContent).toBe(
      IMAGE_STATE_LABELS.unfinished,
    );
  });

  it('is taken off the board by Remove, which is one undo step', () => {
    const id = place('uploading', undefined, T0);
    // The board itself, so the button is tested against the document and not against a spy.
    render(<BoardApp doc={doc} boardId={boardId} connection="connected" />);

    fireEvent.click(screen.getByTestId(`image-remove-${id}`));

    expect(imageSnapshots(doc)).toHaveLength(0);
  });

  it('is not older than the timeout while the clock has not got that far', () => {
    const id = place('uploading', undefined, T0);
    renderImage(id, { as: OTHER, now: T0 + IMAGE_UPLOAD_STALE_MS - 1 });
    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_STATE_LABELS.uploading);
  });
});

describe('a picture that will not load (TC-23)', () => {
  it('keeps the box the same size and says what this screen found', () => {
    const id = place('ready');
    renderImage(id, { as: OTHER });
    const before = snapshotOf(id);
    const img = screen.getByTestId('image-element') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/assets/${boardId}/0123456789abcdef`);

    fireEvent.error(img);

    const box = screen.getByTestId('image-unavailable');
    expect(box.textContent).toContain(IMAGE_UNAVAILABLE_LABEL);
    // The box is the size of the picture, before and after: a picture that will not load does not
    // move the board around it, and does not collapse to a line of text.
    expect(box.getAttribute('style')).toContain(`width: ${before.width}px`);
    expect(box.getAttribute('style')).toContain(`height: ${before.height}px`);
    expect(box.getAttribute('style')).toContain(`left: ${before.x}px`);
    // What the board holds is untouched: another screen may be looking at the same picture fine.
    expect(snapshotOf(id).status).toBe('ready');
    expect(snapshotOf(id).assetKey).toBe(`${boardId}/0123456789abcdef`);
  });

  it('asks again when the record is given a new address', () => {
    const id = place('ready');
    const view = renderImage(id, { as: OTHER });
    fireEvent.error(screen.getByTestId('image-element'));
    expect(screen.getByTestId('image-unavailable').textContent).toContain(IMAGE_UNAVAILABLE_LABEL);

    // Somebody re-added the same picture, and it is at a new address now.
    markImageReady(doc, id, `${boardId}/fedcba9876543210`);
    view.rerender(
      <ImageObject
        image={asImageSnapshot(snapshotOf(id))!}
        isUploader={false}
        canRetry={false}
        now={T0 + 1000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-element')).toBeTruthy();
  });

  it('says there is no picture when the record says ready and holds no address', () => {
    const id = place('uploading');
    const broken = { ...snapshotOf(id), status: 'ready' as const, assetKey: null as string | null };
    render(
      <ImageObject
        image={asImageSnapshot(broken)!}
        isUploader={false}
        canRetry={false}
        now={T0}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_UNAVAILABLE_LABEL);
  });
});

describe('sending the same file again (TC-24)', () => {
  it('asks for the retry the tab holding the file presses', () => {
    const id = place('failed');
    const calls: string[] = [];
    renderImage(id, { as: UPLOADER, canRetry: true, retry: () => calls.push('retry') });

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    expect(calls).toEqual(['retry']);
  });

  it('offers only Remove once the file is gone from this tab', () => {
    const id = place('failed');
    // The same board after a reload: the record still says it failed, and no tab is holding the
    // file any more.
    renderImage(id, { as: UPLOADER, canRetry: false });

    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_STATE_LABELS.failed);
  });

  it('does not let the pointer working a button also move the picture it stands on', () => {
    const id = place('failed');
    const down: string[] = [];
    const image = asImageSnapshot(snapshotOf(id))!;
    render(
      <ImageObject
        image={image}
        isUploader
        canRetry
        now={T0}
        onRetry={() => {}}
        onRemove={() => {}}
        onObjectPointerDown={(_e, objectId) => down.push(objectId)}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId(`image-remove-${id}`), { bubbles: true });
    expect(down).toEqual([]);
    fireEvent.pointerDown(screen.getByTestId('image-unavailable'), { bubbles: true });
    expect(down).toEqual([id]);
  });
});

describe('a picture on its way (image.uploading)', () => {
  it('shows the tab doing the sending how far it has got', () => {
    const id = place('uploading');
    renderImage(id, { as: UPLOADER, progress: 0.41 });

    expect(screen.getByTestId('image-state-label').textContent).toBe('41%');
    const bar = screen.getByTestId('image-progress-bar');
    expect(bar.getAttribute('data-progress')).toBe('0.41');
    expect(screen.getByTestId('image-uploading').getAttribute('data-image-status')).toBe(
      'uploading',
    );
  });

  it('shows everybody else only that it is on its way', () => {
    const id = place('uploading');
    renderImage(id, { as: OTHER });

    expect(screen.getByTestId('image-state-label').textContent).toBe(IMAGE_STATE_LABELS.uploading);
    expect(screen.getByTestId('image-state-label').textContent).toBe('Uploading…');
    // This screen is not sending the file and cannot know how far it has got.
    expect(screen.queryByTestId('image-progress')).toBeNull();
  });

  it('is a box the size the picture will be, so nothing moves when it arrives', () => {
    const id = place('uploading');
    renderImage(id, { as: UPLOADER });
    const box = screen.getByTestId('image-uploading');
    expect(box.getAttribute('style')).toContain('width: 800px');
    expect(box.getAttribute('style')).toContain('height: 500px');
  });

  it('rounds a fraction once and shows nothing to send when there is no fraction', () => {
    expect(progressLabel(0.414)).toBe('41%');
    expect(progressLabel(0.4151)).toBe('42%');
    expect(progressLabel(0)).toBe('0%');
    expect(progressLabel(1)).toBe('100%');
    expect(progressLabel(undefined)).toBe(IMAGE_STATE_LABELS.uploading);
    expect(progressLabel(Number.NaN)).toBe(IMAGE_STATE_LABELS.uploading);
  });
});

describe('a picture that has arrived (image.ready)', () => {
  it('is drawn from the address the server gave it, at the size the board holds', () => {
    const id = place('ready');
    renderImage(id, { as: UPLOADER });
    const img = screen.getByTestId('image-element') as HTMLImageElement;
    const obj = snapshotOf(id);

    expect(img.getAttribute('src')).toBe(`/api/assets/${obj.assetKey}`);
    expect(img.alt).toBe('Image');
    expect(img.getAttribute('width')).toBe(String(obj.width));
    expect(img.getAttribute('height')).toBe(String(obj.height));
    // Not the browser's own draggable picture: a board that moves its objects is the board's.
    expect(img.getAttribute('draggable')).toBe('false');
    // No `loading` attribute, which means eager: this board is panned by moving a layer rather
    // than by scrolling a document, so the browser's idea of a picture that is "not needed yet"
    // is a picture that stays unloaded no matter how far the person pans to it. See TC-25, where
    // this difference is visible in one browser and not in another.
    expect(img.getAttribute('loading')).toBe(null);
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('is drawn by the registry entry, proportionally resizable down to the minimum size', async () => {
    const { getObjectType } = await import('../../src/client/objects/registry.tsx');
    // The registration is what story 7's resize gesture reads; `aspectLocked` is the whole of
    // image.aspect_resize and `minSize` is what stops a photograph shrinking to a dot.
    const spec = getObjectType('image');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
    expect(spec!.hitTest).toBeTypeOf('function');
  });

  it('answers a click with the object it is, so it can be moved and deleted', () => {
    const id = place('ready');
    const down: string[] = [];
    render(
      <ImageObject
        image={asImageSnapshot(snapshotOf(id))!}
        isUploader
        canRetry={false}
        now={T0}
        onRetry={() => {}}
        onRemove={() => {}}
        onObjectPointerDown={(_e, objectId) => down.push(objectId)}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId('image-object'));
    expect(down).toEqual([id]);
  });
});

describe('a box the pointer can reach', () => {
  // The layer every object lives on is transparent to the pointer — that is what lets a person
  // drag an empty part of the board to pan it — so each object has to ask for its own clicks back.
  // An object that forgets is not broken in jsdom, where nothing enforces the layering: it is
  // broken in a browser, where the picture cannot be selected, moved, resized or retried because
  // every press goes straight through it to the board behind. This is asserted for each state
  // because a box in the middle of an upload is exactly the box a person reaches for.
  it.each([
    ['ready', 'image-object'],
    ['uploading', 'image-uploading'],
    ['failed', 'image-unavailable'],
  ] as const)('%s', (state, testid) => {
    const id = place(state);
    renderImage(id, { as: UPLOADER });
    expect(screen.getByTestId(testid).style.pointerEvents).toBe('auto');
  });
});
