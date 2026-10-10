import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LOCAL_ORIGIN, objectSnapshots, snapshot } from '../../src/shared/board-model';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { readImage, type ImageSnap } from '../../src/shared/objects/image';
import { clientId } from '../../src/client/useClientId';
import {
  COMPONENT_BOARD_ID,
  boardElement,
  createNote,
  doubleClickElement,
  editorElement,
  editingId,
  flushFrame,
  noteElement,
  renderBoard,
  worldOf,
} from './harness';
import { FakeBoardProvider } from '../fixtures/fakeProvider';
import { uploads } from '../fixtures/fakeUpload';
import { embeddedImage as fixture } from '../fixtures/embeddedImages';

/**
 * Adding images from the board (`image.insert`), in jsdom, against a real Y.Doc.
 *
 * TC-17, TC-18, TC-19 and TC-29: a drop, a paste, a board that is not connected and
 * a file that only looks like an image.
 *
 * Two browser APIs are replaced, both for the same reason - a test that waited for a
 * real upload or a real decoder would be a test of the network and of a codec:
 *
 * - `uploadImage` becomes a queue the test drives by hand (`fixtures/fakeUpload`): it
 *   decides how far a file has got, and whether it arrived;
 * - `createImageBitmap` becomes a table of dimensions, so a placeholder's size is
 *   something the test chose rather than something a decoder happened to report.
 *
 * Everything else is the real thing: the document, the board, the toolbar, the drop
 * event and the messages the board shows.
 */

vi.mock('../../src/client/images/uploadImage', async () => {
  const fake = await import('../fixtures/fakeUpload');
  return { uploadImage: fake.uploadImage, uploadUrlFor: fake.uploadUrlFor };
});

/* -------------------------------------------------------------------------- */
/* Files, and what they decode to                                             */
/* -------------------------------------------------------------------------- */

/** The natural pixel sizes `createImageBitmap` is made to report, per file name. */
const DECODED: Record<string, { width: number; height: number }> = {
  'photo.png': { width: 400, height: 300 },
  'photo.jpg': { width: 200, height: 200 },
  'photo.webp': { width: 300, height: 1_200 },
  'animated.gif': { width: 120, height: 90 },
};

const fileNamed = (name: string, bytes: Uint8Array): File =>
  // Copied rather than aliased: a `File` owns its bytes, and a fixture is shared.
  new File([new Uint8Array(bytes)], name, { type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });

const photo = (): File => fileNamed('photo.png', fixture('photo.png'));
const photoJpg = (): File => fileNamed('photo.jpg', fixture('photo.jpg'));
const photoWebp = (): File => fileNamed('photo.webp', fixture('photo.webp'));
const gif = (): File => fileNamed('animated.gif', fixture('animated.gif'));
const documentFile = (): File => fileNamed('notes.png', fixture('not-an-image.png'));

/**
 * Real PNG magic with its pixels cut off: the front of the file says PNG, so the
 * sniff lets it through, and no decoder can make a bitmap out of the rest.
 */
const undecodable = (): File => fileNamed('broken.png', fixture('truncated.png'));

/**
 * jsdom has no `DragEvent`, no `DataTransfer` and no `createImageBitmap`. A drop and a
 * paste are built as plain cancelable events with the one property each handler reads
 * attached to them - the shape a browser presents, and the only part of it this app
 * looks at.
 */
function fakeTransfer(files: readonly File[]): DataTransfer {
  return {
    types: files.length > 0 ? ['Files'] : [],
    files,
    items: [],
    dropEffect: 'copy',
    effectAllowed: 'copy',
  } as unknown as DataTransfer;
}

function dispatchDrop(files: readonly File[], at: { x: number; y: number }): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: fakeTransfer(files) });
  Object.defineProperty(event, 'clientX', { value: at.x });
  Object.defineProperty(event, 'clientY', { value: at.y });
  act(() => {
    boardElement().dispatchEvent(event);
  });
}

function dispatchPaste(files: readonly File[], target: EventTarget = window): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: fakeTransfer(files) });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** Let the promise chain one add runs through - sniff, decode, upload - reach its end. */
async function settle(rounds = 5): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

function imagesIn(doc: Y.Doc): ImageSnap[] {
  return objectSnapshots(doc).filter((entry) => entry.type === 'image') as ImageSnap[];
}

function toastText(reason: string): string | null {
  const element = screen.queryByTestId(`image-toast-${reason}`);
  if (element === null) {
    return null;
  }
  return element.querySelector('.image-toast__message')?.textContent ?? '';
}

/** The middle of the visible board, in world units, at the camera on screen. */
/** Put files into a file input the way an operating system's file list would. */
function setFiles(input: HTMLInputElement, files: readonly File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function viewCentre(): { x: number; y: number } {
  return worldOf({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

beforeAll(() => {
  vi.stubGlobal('createImageBitmap', (source: unknown) => {
    const name = (source as { name?: string }).name ?? '';
    const size = DECODED[name];
    if (size === undefined) {
      return Promise.reject(new Error(`no decoder for ${name}`));
    }
    return Promise.resolve({
      width: size.width,
      height: size.height,
      close(): void {
        // A real one holds a decoding surface; this one holds nothing.
      },
    });
  });
});

afterEach(() => {
  // Unmount first: leaving a board stops the files it was sending, and a test should
  // not be told about an upload the test before it left behind.
  cleanup();
  uploads.reset();
});

/* -------------------------------------------------------------------------- */

describe('image.insert - files dropped onto the board (TC-17)', () => {
  it('TC-17: three dropped files become three placeholders in a row at the drop point', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    // The history is opened before the drop, because an undo stack only knows about
    // what happened after it started listening.
    const undo = new Y.UndoManager(doc.getMap('objects'), {
      trackedOrigins: new Set<unknown>([LOCAL_ORIGIN]),
    });

    const before = objectSnapshots(doc).length;
    const where = { x: 240, y: 180 };
    dispatchDrop([photo(), photoJpg(), gif()], where);
    await settle();

    const placed = imagesIn(doc);
    expect(placed.length).toBe(3);
    expect(objectSnapshots(doc).length).toBe(before + 3);

    // The row starts where the file was released and runs to the right, one gap
    // between neighbours (`image.drop`).
    const at = worldOf(where);
    expect(placed[0]!.x).toBeCloseTo(at.x, 1);
    expect(placed[0]!.y).toBeCloseTo(at.y, 1);
    expect(placed[1]!.x - (placed[0]!.x + placed[0]!.width)).toBeCloseTo(IMAGE_LAYOUT_GAP_WORLD, 1);
    expect(placed[2]!.x - (placed[1]!.x + placed[1]!.width)).toBeCloseTo(IMAGE_LAYOUT_GAP_WORLD, 1);
    for (const image of placed) {
      expect(image.y).toBeCloseTo(at.y, 1);
      expect(image.status).toBe('uploading');
      expect(image.uploaderId).toBe(clientId());
    }
    expect(placed[0]!.width).toBeCloseTo(DECODED['photo.png']!.width, 1);
    expect(placed[0]!.height).toBeCloseTo(DECODED['photo.png']!.height, 1);
    expect(placed[2]!.width).toBeCloseTo(DECODED['animated.gif']!.width, 1);

    // One add is one undo step, whatever it placed (`image.insert`).
    undo.undo();
    expect(imagesIn(doc).length).toBe(0);
    undo.destroy();
  });

  it('TC-17: the uploader sees a percentage, and the image appears when it is ready', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    dispatchDrop([photo()], { x: 100, y: 100 });
    await settle();

    const image = imagesIn(doc)[0]!;
    // An upload in progress that has reported nothing is still "Uploading…".
    expect(screen.getByTestId(`image-uploading-${image.id}`).textContent).toContain('Uploading');
    expect(screen.queryByTestId(`image-progress-${image.id}`)).toBeNull();

    // XHR progress, fed in by hand, is shown as a whole percentage to the person who
    // dropped the file (`image.progress`).
    act(() => {
      uploads.calls[0]?.onProgress(0.42);
    });
    expect(screen.getByTestId(`image-progress-${image.id}`).textContent).toBe('42%');
    act(() => {
      uploads.calls[0]?.onProgress(0.421);
    });
    expect(screen.getByTestId(`image-progress-${image.id}`).textContent).toBe('42%');

    uploads.calls[0]?.ok(`${COMPONENT_BOARD_ID}/asset00000000000000000000`, 'image/png');
    await settle();

    const ready = readImage(doc, image.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.assetKey).toBe(`${COMPONENT_BOARD_ID}/asset00000000000000000000`);
    expect(ready?.contentType).toBe('image/png');
    expect(ready?.naturalWidth).toBe(400);
    expect(screen.queryByTestId(`image-progress-${image.id}`)).toBeNull();

    const img = screen.getByTestId(`image-${image.id}`) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      `/api/assets/${COMPONENT_BOARD_ID}/asset00000000000000000000`,
    );
    expect(img.getAttribute('alt')).toBe('Image');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    // The asset key is served through the asset route, not kept as a URL.
    expect(img.getAttribute('src')).not.toContain('http://localhost');
  });

  it('TC-17: leaving the board stops a file that was still on its way', async () => {
    const doc = new Y.Doc();
    const view = renderBoard({ doc, connect: false });
    await flushFrame();

    dispatchDrop([photo()], { x: 100, y: 100 });
    await settle();
    expect(uploads.calls.length).toBe(1);

    view.unmount();
    expect(uploads.aborts).toEqual(['photo.png']);
  });

  it('the toolbar button and the I key both open a file list limited to the four formats', () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });

    // One hidden input, reused for every pick (`image.pick`).
    const input = screen.getByTestId('image-picker-input') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    for (const type of IMAGE_ACCEPTED_TYPES) {
      expect(input.accept).toContain(type);
    }
    expect(input.accept).not.toContain('svg');

    const opened = vi.spyOn(input, 'click');

    fireEvent.click(screen.getByTestId('image-tool'));
    expect(opened).toHaveBeenCalledTimes(1);

    // The shortcut opens the same list (`tool.shortcuts`).
    fireEvent.keyDown(window, { key: 'i' });
    expect(opened).toHaveBeenCalledTimes(2);

    // And it is still the one input it was, not a stack of them.
    expect(screen.getAllByTestId('image-picker-input')).toHaveLength(1);
  });

  it('files chosen in the picker are laid out in a row in the middle of the view', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    fireEvent.click(screen.getByTestId('image-tool'));
    const input = screen.getByTestId('image-picker-input') as HTMLInputElement;
    setFiles(input, [photo(), photoJpg()]);
    fireEvent.change(input);
    await settle();

    const placed = imagesIn(doc);
    expect(placed.length).toBe(2);
    expect(placed[1]!.x - (placed[0]!.x + placed[0]!.width)).toBeCloseTo(IMAGE_LAYOUT_GAP_WORLD, 1);
    const centre = viewCentre();
    expect((placed[0]!.x + placed[1]!.x + placed[1]!.width) / 2).toBeCloseTo(centre.x, 1);
    expect(placed[0]!.y).toBeCloseTo(placed[1]!.y, 1);
    // The chosen files were taken and the choice was cleared, so choosing the same
    // files again is a second add rather than nothing (`image.pick`).
    expect(input.value).toBe('');
  });
});

describe('image.insert - pasting (TC-18)', () => {
  it('TC-18: a paste while a note is being typed into belongs to the note', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const noteId = createNote(doc, { x: 40, y: 40 });
    await flushFrame();
    doubleClickElement(noteElement(noteId));
    await flushFrame();
    expect(editingId()).toBe(noteId);
    expect(editorElement()).toBeTruthy();

    dispatchPaste([photo()]);
    await settle();

    expect(imagesIn(doc).length).toBe(0);
    expect(uploads.calls.length).toBe(0);
    // The note is still being edited, and nothing was added to the board.
    expect(editingId()).toBe(noteId);
    expect(snapshot(doc).find((note) => note.id === noteId)?.text).toBe('');
  });

  it('TC-18: a paste onto a focused board lands in the middle of the view', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    dispatchPaste([photo()]);
    await settle();

    const placed = imagesIn(doc);
    expect(placed.length).toBe(1);
    const centre = viewCentre();
    expect(placed[0]!.x + placed[0]!.width / 2).toBeCloseTo(centre.x, 1);
    expect(placed[0]!.y + placed[0]!.height / 2).toBeCloseTo(centre.y, 1);

    // A paste with no files in it is not an add at all: pasting text stays text
    // (`image.paste`) - no object, no upload, no message.
    dispatchPaste([]);
    await settle();
    expect(imagesIn(doc).length).toBe(1);
    expect(uploads.calls).toHaveLength(1); // the one the image paste started
    expect(screen.queryByTestId('image-toast')).toBeNull();
  });

  it('TC-18: a paste of an image and a document adds the image and says about the rest', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    dispatchPaste([documentFile(), photo()]);
    await settle();

    expect(imagesIn(doc).length).toBe(1);
    expect(toastText('type')).toBe(REJECTION_MESSAGES.type);
  });
});

describe('image.insert - a board that is not connected (TC-19)', () => {
  it('TC-19: a drop while reconnecting adds nothing, uploads nothing and says why', async () => {
    const doc = new Y.Doc();
    let provider: FakeBoardProvider | null = null;
    renderBoard({
      doc,
      connect: true,
      providerFactory: () => {
        provider = new FakeBoardProvider();
        return provider;
      },
    });
    await flushFrame();

    // A link that worked, and then stopped working: `reconnecting`, not `connecting`.
    act(() => {
      provider?.serves();
    });
    await flushFrame();
    expect(screen.getByTestId('connection-status').dataset.connectionState).toBe('connected');

    // The board still works, images do not (`image.offline`).
    act(() => {
      provider?.drops();
    });
    await flushFrame();
    expect(screen.getByTestId('connection-status').dataset.connectionState).toBe('reconnecting');

    dispatchDrop([photo(), photoJpg()], { x: 120, y: 120 });
    await settle();

    expect(imagesIn(doc).length).toBe(0);
    expect(uploads.calls.length).toBe(0);
    expect(toastText('offline')).toBe(REJECTION_MESSAGES.offline);
  });

  it('TC-19: the Image button and the I key answer the same way when the room is gone', async () => {
    const doc = new Y.Doc();
    let provider: FakeBoardProvider | null = null;
    renderBoard({
      doc,
      connect: true,
      providerFactory: () => {
        provider = new FakeBoardProvider();
        return provider;
      },
    });
    await flushFrame();
    act(() => {
      provider?.serves();
    });
    await flushFrame();
    act(() => {
      provider?.drops();
    });
    await flushFrame();
    expect(screen.getByTestId('connection-status').dataset.connectionState).toBe('reconnecting');

    // The board does not ask somebody to choose files it would then refuse to take:
    // the answer comes before the file list would open (`image.offline`).
    const input = screen.getByTestId('image-picker-input') as HTMLInputElement;
    const opened = vi.spyOn(input, 'click');

    fireEvent.click(screen.getByTestId('image-tool'));
    fireEvent.keyDown(window, { key: 'i' });
    await settle(1);

    expect(opened).not.toHaveBeenCalled();
    expect(imagesIn(doc).length).toBe(0);
    expect(uploads.calls).toHaveLength(0);
    // Two attempts, two messages: one per add, worded by the reason (`image.toast`).
    const offlineToasts = screen.getAllByTestId('image-toast-offline');
    expect(offlineToasts).toHaveLength(2);
    for (const node of offlineToasts) {
      expect(node.querySelector('.image-toast__message')?.textContent).toBe(REJECTION_MESSAGES.offline);
    }
  });
});

describe('image.insert - a file that is not an image (TC-29)', () => {
  it('TC-29: a file that will not decode is not added, not uploaded and is named', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    // Real PNG magic, so the sniff lets it in, and no decoder can make anything of the
    // rest - which is what `createImageBitmap` is here for.
    dispatchDrop([undecodable()], { x: 100, y: 100 });
    await settle();

    expect(imagesIn(doc).length).toBe(0);
    expect(uploads.calls.length).toBe(0);
    expect(toastText('type')).toBe(REJECTION_MESSAGES.type);
    // Nothing half-added is left on the board to be cleaned up.
    expect(screen.queryAllByTestId(/^image-object-/u)).toHaveLength(0);
  });

  it('TC-29: a batch of good files and one bad one adds the good ones and names the bad one', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    dispatchDrop([photo(), undecodable(), photoWebp()], { x: 60, y: 60 });
    await settle();

    const placed = imagesIn(doc);
    expect(placed.length).toBe(2);
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['photo.png', 'photo.webp']);
    expect(toastText('type')).toBe(REJECTION_MESSAGES.type);
    // A portrait file keeps its proportions, its longest side capped at the maximum.
    const portrait = placed.find((image) => image.height > image.width);
    expect(portrait?.height).toBeCloseTo(IMAGE_MAX_PLACE_SIZE_WORLD, 1);
    expect(portrait?.width).toBeCloseTo(IMAGE_MAX_PLACE_SIZE_WORLD / 4, 1);
  });
});
