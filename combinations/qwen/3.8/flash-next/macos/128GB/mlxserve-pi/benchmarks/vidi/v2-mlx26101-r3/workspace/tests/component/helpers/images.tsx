/**
 * The parts a test needs to put pictures on a board that is drawn in jsdom.
 *
 * Three of the things this file stands in for do not exist in jsdom at all - `DataTransfer`,
 * `DragEvent`, `createImageBitmap` - and one of them exists and must not be used: a real
 * `XMLHttpRequest` would try to reach a server, which is the one part of adding an image a
 * component test cannot have opinions about (that one is in `../doubles/uploadImage.ts`). So the
 * doubles below are not a convenience: the suite cannot ask the questions this story is about
 * without them.
 *
 * What is *not* doubled is the part that matters. The document is a real `Y.Doc`; the objects are
 * written by the real board model; the drop point, the row, the sizes, the statuses and the
 * messages are all the real thing. What is faked is the browser's file handling and the network -
 * the two things a browser does that a test about a board has no business waiting for.
 */
import { act, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import { vi } from 'vitest';
import { App } from '../../../src/client/App';
import { screenToWorld } from '../../../src/client/canvas/camera';
import type { Camera, Point } from '../../../src/client/canvas/camera';
import { snapshot, type ObjectSnapshot } from '../../../src/shared/board-model';
import { newBoardId } from '../../../src/shared/board-id';
import { imageSnapshots, type ImageSnapshot } from '../../../src/shared/objects/image';
import { flushFrames, VIEWPORT } from '../helpers';
import { setObservedSize } from '../resizeObserver';
import { theProvider, type FakeWebsocketProvider } from './fake-provider';

/** A board address that is a real one: an asset key is built out of it, so a test cannot make this up. */
export function aBoardId(): string {
  return newBoardId();
}

/* ---------------------------------------------------------------- images without a browser */

/**
 * A file whose pixels are decided by its name: `photo-640x360.png` is 640 by 360.
 *
 * The alternative - real bytes, really decoded - is what the end-to-end suite does with the
 * fixtures on disk. Here the question is never "can this browser decode a PNG" but "what does the
 * board do with a picture of this shape", and a name that says its own size is the shortest way to
 * ask it without a decoder in the test.
 */
export function imageFile(name: string, bytes = 64, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A file that is not a picture at all, whatever its name claims. */
export function otherFile(name: string, bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

/**
 * The decoder, standing in for the browser's.
 *
 * A name matching `NNNxNNN` is a picture of that size; `corrupt` in the name is a picture the
 * browser can make nothing of, which is the case the type message exists for. Everything else is a
 * plain 400x300.
 */
export function installImageBitmapStub(): void {
  vi.stubGlobal('createImageBitmap', (file: Blob) => {
    const name = (file as File).name ?? '';
    if (name.includes('corrupt')) {
      return Promise.reject(new Error(`cannot decode ${name}`));
    }
    const match = /(\d+)x(\d+)/u.exec(name);
    const width = match?.[1] === undefined ? 400 : Number(match[1]);
    const height = match?.[2] === undefined ? 300 : Number(match[2]);
    return Promise.resolve({ width, height, close() {} } as unknown as ImageBitmap);
  });
}

/* ---------------------------------------------------------------- the events a browser sends */

/**
 * Let everything the board is in the middle of doing finish, and let React draw it.
 *
 * A test cannot await what the board never promised: a drop starts an upload with `void`, and the
 * callbacks that follow it are chained several promises deep - decode the file, write the objects,
 * settle the transfer, write the status. Counting microtasks to cover that is counting something that
 * changes whenever the code grows a link in its chain, so this waits for a timer instead, which is the
 * one thing that is guaranteed to be after all of them. Timers are real here (only animation frames
 * are faked - see `setup.ts`), which is what makes this wait mean anything.
 */
export async function settleWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * A drag event, as much as jsdom allows one.
 *
 * jsdom has no `DragEvent` and no `DataTransfer`, so the event is an ordinary one with the two
 * things the board reads bolted onto it: where the pointer was, and what the drag was carrying.
 * That is the whole surface the board is allowed to touch, which is what makes this a fair stand-in
 * - a component that reached for anything else would be reaching for something no browser hands it.
 */
export function dragEvent(
  type: string,
  files: readonly File[],
  point: Point = { x: 100, y: 100 },
): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files: [...files], items: [] },
  });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  return event as unknown as DragEvent;
}

/** A drag carrying something that is not files - a link, a selection of text. */
export function textDragEvent(type: string, types: readonly string[] = ['text/plain']): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [...types], files: [], items: [] },
  });
  Object.defineProperty(event, 'clientX', { value: 10 });
  Object.defineProperty(event, 'clientY', { value: 10 });
  return event as unknown as DragEvent;
}

/**
 * A paste. With files, the clipboard says `Files`; with nothing, it says `text/plain`, because a
 * paste of text has to come to the board too - that is the case the caret rule is about, and a test
 * that only ever pastes files would never have asked it.
 */
export function pasteEvent(files: readonly File[], point: Point = { x: 100, y: 100 }): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value:
      files.length === 0
        ? { types: ['text/plain'], files: [] }
        : { types: ['Files'], files: [...files] },
  });
  Object.defineProperty(event, 'clientX', { value: point.x });
  Object.defineProperty(event, 'clientY', { value: point.y });
  return event as unknown as ClipboardEvent;
}

/* ---------------------------------------------------------------- a board with a connection */

export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardWithPictures {
  readonly view: ReturnType<typeof render>;
  readonly board: HTMLElement;
  readonly doc: Y.Doc;
  readonly boardId: string;
  readonly provider: FakeWebsocketProvider;
  camera(): Camera;
  /** Every image on the board, in draw order. */
  images(): ImageSnapshot[];
  /** The element one image is drawn in. */
  element(id: string): HTMLElement;
  /** Where an image is drawn, read off its element. */
  place(id: string): Placed;
  /** Where a point on the screen is in the world, at the camera the board has now. */
  worldOf(point: Point): Point;
  /** What the toast says, or `null` when it is not saying anything. */
  toast(): string | null;
  /** Press a button the board is showing, and let it do what pressing it does. */
  click(testId: string): Promise<void>;
  /** Press a button inside one object, and let it do what pressing it does. */
  clickIn(objectId: string, testId: string): Promise<void>;
  /** Let the board's promises and effects catch up with what the test just did. */
  settle(): Promise<void>;
  /** Drop files on the board at `point`, and let the board do what it does with them. */
  drop(files: readonly File[], point?: Point): Promise<void>;
  /** Drag files over the board and do not let go yet. */
  dragEnter(files: readonly File[], point?: Point): void;
  dragOver(files: readonly File[], point?: Point): void;
  /** Take the files back out again. */
  dragLeave(files: readonly File[], point?: Point): void;
  /** Paste files, from wherever the keyboard happens to be. */
  paste(files: readonly File[], target?: EventTarget): Promise<void>;
  /** What tool the board area says it is in. */
  tool(): string | null;
  /** The connection falls over, the way it does when nothing arrives. */
  disconnect(): void;
  /** And comes back. */
  reconnect(): void;
}

/** The order a room opens: a socket, then the board. Both are needed for `confirmed`. */
function openConnection(provider: FakeWebsocketProvider): void {
  provider.socketOpens();
  provider.sync(true);
}

/**
 * A board, connected to a room, that can be handed files.
 *
 * The connection is opened for real - through the provider double, in the order a network opens one
 * - because whether a picture may be uploaded is a question about the connection, and a test that
 * pretended about that could not tell a board that was online from a board that was merely mounted.
 */
export async function mountImageBoard(boardId = aBoardId(), doc = new Y.Doc()): Promise<BoardWithPictures> {
  setObservedSize(VIEWPORT);
  const view = render(<App doc={doc} boardId={boardId} />);
  await flushFrames(2);
  const provider = theProvider();
  openConnection(provider);
  await flushFrames(2);
  const board = view.getByTestId('board-viewport');

  const settle = async (): Promise<void> => settleWork();

  const camera = (): Camera => {
    const raw = view.getByTestId('world-layer').getAttribute('data-camera');
    if (raw === null) {
      throw new Error('world layer is missing its camera readout');
    }
    const [x, y, zoom] = raw.split(',').map(Number) as [number, number, number];
    return { x, y, zoom };
  };

  const element = (id: string): HTMLElement => {
    const found = view.container.querySelector<HTMLElement>(
      `[data-object-id="${id}"]:not(.selection-outline)`,
    );
    if (found === null) {
      throw new Error(`no element on the board for object ${id}`);
    }
    return found;
  };

  const fire = (type: string, files: readonly File[], point: Point): void => {
    fireEvent(board, dragEvent(type, files, point));
  };

  return {
    view,
    board,
    doc,
    boardId,
    provider,
    camera,
    images: () => imageSnapshots(doc),
    element,
    place(id: string) {
      const style = element(id).style;
      const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name));
      return { x: read('left'), y: read('top'), width: read('width'), height: read('height') };
    },
    worldOf(point: Point) {
      return screenToWorld(camera(), point);
    },
    toast() {
      const shown = view.queryByTestId('toast');
      if (shown === null || shown.getAttribute('data-visible') !== 'true') {
        return null;
      }
      // The message, and not the whole toast: the toast also carries the button that dismisses it.
      const line = shown.querySelector('[data-testid="toast-message"]');
      if (line === null) {
        throw new Error('a visible toast with no message in it');
      }
      return (line.textContent ?? '').replace(/\s+/gu, ' ').trim();
    },
    async click(testId: string) {
      const button = view.getByTestId(testId);
      await act(async () => {
        (button as HTMLElement).click();
        await Promise.resolve();
      });
    },
    async clickIn(objectId: string, testId: string) {
      const button = element(objectId).querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (button === null) {
        throw new Error(`object ${objectId} is not showing a "${testId}" button`);
      }
      await act(async () => {
        button.click();
        await Promise.resolve();
      });
    },
    settle,
    async drop(files: readonly File[], point: Point = { x: 100, y: 100 }) {
      fire('drop', files, point);
      await settle();
    },
    dragEnter(files: readonly File[], point: Point = { x: 100, y: 100 }) {
      fire('dragenter', files, point);
    },
    dragOver(files: readonly File[], point: Point = { x: 100, y: 100 }) {
      fire('dragover', files, point);
    },
    dragLeave(files: readonly File[], point: Point = { x: 100, y: 100 }) {
      fire('dragleave', files, point);
    },
    async paste(files: readonly File[], target: EventTarget = window) {
      // testing-library will dispatch on anything; `Window` is one of the things it takes.
      fireEvent(target as unknown as Element, pasteEvent(files));
      await settle();
    },
    tool: () => board.getAttribute('data-tool'),
    disconnect() {
      provider.socketFellOver();
    },
    reconnect() {
      openConnection(provider);
    },
  };
}

/** Everything the board holds, whatever type it is. */
export function objectsOf(doc: Y.Doc): readonly ObjectSnapshot[] {
  return snapshot(doc);
}
