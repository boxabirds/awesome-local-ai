// useImageInsert component tests (spec: image.insert, TC-17 to TC-20, TC-29).
//
// Full app at the 1280x800 fixture, HOME camera (world (0,0) at screen
// (640,400)). uploadImage is mocked with controllable progress/results
// (the flows under test, not network); measureImage is mocked because
// jsdom neither decodes bitmaps nor loads <img>, and the natural size is
// fixture-controlled. Files are created with the real File API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { act } from '@testing-library/react';

import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { measureImage } from '../../src/client/images/measureImage';
import { uploadImage, type UploadResult } from '../../src/client/images/uploadImage';
import {
  dispatch,
  installResizeObserverMock,
  renderApp,
  viewportEl,
  windowKey,
} from './helpers';
import { liveNotes, noteAt, noteEls } from './story7-helpers';

const mockedMeasure = vi.mocked(measureImage);
const mockedUpload = vi.mocked(uploadImage);

vi.mock('../../src/client/images/measureImage', () => ({
  measureImage: vi.fn(),
}));
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

/** Pending uploads with controllable progress and resolution. */
const pending: { resolve(result: UploadResult): void; progress(f: number): void }[] = [];

function file(name: string, type = 'image/png', size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** A drag-drop of files onto the viewport at screen (x, y). */
function dropFiles(files: File[], x = 640, y = 400): void {
  const el = viewportEl(document.body);
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'] },
  });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** A clipboard paste with files, targeted at `target`. */
function pasteFiles(target: EventTarget, files: File[]): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files } });
  act(() => {
    (target as unknown as HTMLElement).dispatchEvent(event);
  });
}

/** Open the picker (I key) and hand the created input a file list. */
async function pickerFiles(files: File[]): Promise<void> {
  const created: HTMLInputElement[] = [];
  const clickSpy = vi
    .spyOn(HTMLInputElement.prototype, 'click')
    .mockImplementation(function (this: HTMLInputElement) {
      created.push(this);
    });
  await act(async () => {
    windowKey('i');
  });
  clickSpy.mockRestore();
  const input = created[0];
  if (input === undefined) throw new Error('picker input not created');
  Object.defineProperty(input, 'files', { value: files });
  await act(async () => {
    input.dispatchEvent(new Event('change'));
  });
}

/** Flush microtasks (measurement → placeholder → upload start). */
async function flush(): Promise<void> {
  await act(async () => {});
}

/** Flip the (mocked) websocket to connected — the app boots 'connecting'. */
function connect(): void {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook missing');
  act(() => {
    hook.setConnectionState('connected');
  });
}

function imageEls(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image-object"]'));
}

function toasts(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="toast"]')).map(
    (el) => el.textContent ?? '',
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
  pending.length = 0;
  mockedMeasure.mockReset();
  mockedUpload.mockReset();
  mockedMeasure.mockImplementation(async (f: File) => ({
    width: 100,
    height: 50,
    contentType: f.type || 'image/png',
  }));
  mockedUpload.mockImplementation((_boardId, _file, onProgress) => {
    let resolver: (r: UploadResult) => void = () => {};
    const promise = new Promise<UploadResult>((resolve) => {
      resolver = resolve;
    });
    pending.push({ resolve: (r) => resolver(r), progress: (f) => onProgress(f) });
    return { promise, abort: vi.fn() };
  });
});

afterEach(() => cleanup());

describe('useImageInsert (image.insert)', () => {
  it('TC-17: dropping 3 files creates 3 placeholders in a row; progress updates; ready after resolve', async () => {
    await renderApp();
    connect();
    dropFiles([file('a.png'), file('b.png'), file('c.png')], 200, 100);
    await flush();

    const els = imageEls();
    expect(els).toHaveLength(3);
    for (const el of els) expect(el.dataset.status).toBe('uploading');
    // Layout: a row left-to-right from the drop point, 24 world-unit gaps.
    const notes = liveNotes()
      .filter((n) => n.type === 'image')
      .sort((a, b) => a.x - b.x);
    const [first, second, third] = notes;
    expect(second!.x - first!.x).toBeCloseTo(124, 5); // width 100 + gap 24
    expect(third!.x - second!.x).toBeCloseTo(124, 5);
    expect(new Set(notes.map((n) => n.y))).toEqual(new Set([first!.y]));

    // Uploader progress renders as a percentage.
    const progressEl = document.querySelector<HTMLElement>('[data-testid="image-progress"]');
    expect(progressEl).not.toBeNull();
    pending[0]!.progress(0.5);
    await flush();
    expect(progressEl!.textContent).toBe('50%');

    pending[0]!.resolve({ kind: 'ok', assetKey: 'b/a1', contentType: 'image/png' });
    pending[1]!.resolve({ kind: 'ok', assetKey: 'b/a2', contentType: 'image/png' });
    pending[2]!.resolve({ kind: 'ok', assetKey: 'b/a3', contentType: 'image/png' });
    await flush();
    for (const el of imageEls()) expect(el.dataset.status).toBe('ready');
    expect(document.querySelectorAll<HTMLElement>('[data-testid="image-img"]')).toHaveLength(3);
    expect(
      document.querySelector<HTMLElement>('[data-testid="image-img"]')!.getAttribute('src'),
    ).toBe('/api/assets/b/a1');
  });

  it('TC-18: paste while editing sticky text is ignored; paste with the board focused is centred in view', async () => {
    await renderApp();
    connect();
    // Create a sticky, start editing it (double-click), and paste into it:
    // the text editor's own paste runs; no image is inserted.
    noteAt(0, 0);
    await flush();
    const sticky = noteEls(document.body)[0];
    if (sticky === undefined) throw new Error('sticky not rendered');
    dispatch(sticky, new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await flush();
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(textarea).not.toBeNull();
    pasteFiles(textarea!, [file('clip.png')]);
    await flush();
    expect(imageEls()).toHaveLength(0);

    // Board focused (no editable target): paste creates a centred image.
    act(() => {
      textarea!.blur();
    });
    pasteFiles(document.body, [file('clip.png')]);
    await flush();
    const notes = liveNotes().filter((n) => n.type === 'image');
    expect(notes).toHaveLength(1);
    // Centre of the 1280x800 view under the HOME camera is world (0, 0);
    // a 100x50 image centred there starts at (-50, 0).
    expect(notes[0]!.x).toBeCloseTo(-50, 5);
    expect(notes[0]!.y).toBeCloseTo(0, 5);
  });

  it('TC-19: offline drop → offline toast, no objects, upload not called', async () => {
    await renderApp();
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('test hook missing');
    hook.setConnectionState('reconnecting');
    dropFiles([file('a.png')]);
    await flush();
    expect(imageEls()).toHaveLength(0);
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(toasts()).toContain(REJECTION_MESSAGES.offline);
  });

  it('TC-20: picker upload 429 → failed object + rate toast', async () => {
    await renderApp();
    connect();
    await pickerFiles([file('a.png')]);
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    pending[0]!.resolve({ kind: 'rate_limited' });
    await flush();
    const els = imageEls();
    expect(els).toHaveLength(1);
    expect(els[0]!.dataset.status).toBe('failed');
    expect(toasts()).toContain(REJECTION_MESSAGES.rate);
  });

  it('TC-29: a file that fails to decode → type toast, no placeholder', async () => {
    await renderApp();
    connect();
    mockedMeasure.mockImplementation(async (f: File) => {
      if (f.name === 'corrupt.png') throw new Error('decode failed');
      return { width: 100, height: 50, contentType: 'image/png' };
    });
    dropFiles([file('corrupt.png'), file('good.png')]);
    await flush();
    const notes = liveNotes().filter((n) => n.type === 'image');
    expect(notes).toHaveLength(1); // only the good one
    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(toasts()).toContain(REJECTION_MESSAGES.type);
  });
});
