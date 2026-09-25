/**
 * Story 12 image.insert component tests (TC-17 to TC-20, TC-29): the whole app on a real
 * Y.Doc with a mocked `uploadImage` (controllable progress and results) and a stubbed
 * `createImageBitmap`.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { screenToWorld } from '../../src/client/canvas/camera';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { editor, viewportEl } from './boardHelpers';
import { readCamera } from './helpers';
import { fakeProviders } from './fakeProvider';
import { key, renderApp, toolButton } from './shapeHelpers';
import {
  dropFiles,
  imageFile,
  images,
  pasteFiles,
  pickFiles,
  settle,
  stubCreateImageBitmap,
  toastText,
  type PendingUpload,
} from './imageHelpers';

const uploads = vi.hoisted(() => [] as PendingUpload[]);
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: PendingUpload['resolve'];
    const promise = new Promise<Parameters<PendingUpload['resolve']>[0]>((r) => {
      resolve = r;
    });
    const pending: PendingUpload = { boardId, file, onProgress, resolve, aborted: false };
    uploads.push(pending);
    return {
      promise,
      abort: () => {
        pending.aborted = true;
        resolve({ kind: 'failed' });
      },
    };
  }),
}));

const KEY = (n: number) => `AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBB${n}`;
let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  uploads.length = 0;
  stubCreateImageBitmap();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function progressTexts(): string[] {
  return screen.queryAllByTestId('image-progress').map((el) => el.textContent ?? '');
}

describe('image.insert', () => {
  it('TC-17 drop 3 files: 3 placeholders in a row from the drop point, progress updates, ready after resolve', async () => {
    renderApp(doc);
    const at = { x: 300, y: 200 };
    const world = screenToWorld(readCamera(), at);
    await dropFiles(viewportEl(), [imageFile('shot-a.png'), imageFile('shot-b.png'), imageFile('shot-c.png')], at);

    const placed = images(doc).sort((a, b) => a.x - b.x);
    expect(placed).toHaveLength(3);
    expect(placed.map((i) => [i.width, i.height])).toEqual([
      [400, 300],
      [800, 600],
      [75, 800],
    ]);
    expect(placed.every((i) => i.y === world.y && i.status === 'uploading')).toBe(true);
    expect(placed[0]!.x).toBe(world.x);
    expect(placed[1]!.x).toBe(world.x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed[2]!.x).toBe(world.x + 1200 + 2 * IMAGE_LAYOUT_GAP_WORLD);
    expect(uploads.map((u) => u.file.name)).toEqual(['shot-a.png', 'shot-b.png', 'shot-c.png']);
    expect(progressTexts()).toEqual(['0%', '0%', '0%']);

    act(() => uploads[0]!.onProgress(0.5));
    act(() => uploads[2]!.onProgress(0.25));
    expect(progressTexts().sort()).toEqual(['0%', '25%', '50%']);
    const first = placed[0]!;
    expect(within(document.querySelector<HTMLElement>(`[data-id="${first.id}"]`)!).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');

    const byName = new Map(uploads.map((u, i) => [u, i]));
    for (const u of uploads) await settle(u, { kind: 'ok', assetKey: KEY(byName.get(u)!) });
    expect(images(doc).every((i) => i.status === 'ready' && i.assetKey !== null)).toBe(true);
    const imgs = screen.getAllByRole('img', { name: 'Image' });
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.getAttribute('src')).sort()).toEqual([0, 1, 2].map((n) => `/api/assets/${KEY(n)}`).sort());
    expect(screen.queryAllByTestId('image-progress')).toHaveLength(0);

    // One add action is one undo step; completion added none.
    fireEvent.click(toolButton('Undo'));
    expect(images(doc)).toHaveLength(0);
  });

  it('TC-17 the drop highlight shows only while files are dragged over the board', () => {
    renderApp(doc);
    const files = { files: [], types: ['Files'] };
    fireEvent.dragEnter(viewportEl(), { dataTransfer: files });
    fireEvent.dragOver(viewportEl(), { dataTransfer: files });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();
    fireEvent.dragLeave(viewportEl(), { dataTransfer: files });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    // Dragging text (not files) shows nothing.
    fireEvent.dragEnter(viewportEl(), { dataTransfer: { files: [], types: ['text/plain'] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('TC-18 paste while editing sticky text adds no image; paste with the board focused adds it centred in view', async () => {
    renderApp(doc);
    fireEvent.click(toolButton('Sticky note'));
    const textarea = editor();
    expect(textarea).not.toBeNull();
    textarea!.focus();
    const ignored = await pasteFiles(textarea!, [imageFile('clip.png')]);
    expect(ignored.defaultPrevented).toBe(false);
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);

    fireEvent.keyDown(textarea!, { key: 'Escape' });
    await waitFor(() => expect(editor()).toBeNull());
    (document.activeElement as HTMLElement | null)?.blur();
    const pasted = await pasteFiles(document.body, [imageFile('clip.png')]);
    expect(pasted.defaultPrevented).toBe(true);
    const [img] = images(doc);
    expect(img).toBeDefined();
    const centre = screenToWorld(readCamera(), { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(img!.x + img!.width / 2).toBeCloseTo(centre.x, 6);
    expect(img!.y + img!.height / 2).toBeCloseTo(centre.y, 6);
    expect([img!.width, img!.height]).toEqual([200, 100]);
    expect(uploads).toHaveLength(1);

    // Clipboard content without images is left alone.
    const text = await pasteFiles(document.body, []);
    expect(text.defaultPrevented).toBe(false);
    expect(images(doc)).toHaveLength(1);
  });

  it('TC-19 reconnecting, then a drop: offline message, no objects, no upload (negative)', async () => {
    const fp = fakeProviders();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<App boardId="AAAAAAAAAAAAAAAAAAAAAA" doc={doc} createProvider={fp.createProvider} />);
    fp.provider().open();
    fp.provider().drop();
    await dropFiles(viewportEl(), [imageFile('shot-a.png')], { x: 100, y: 100 });
    expect(toastText()).toBe(REJECTION_MESSAGES.offline);
    expect(screen.getByTestId('toast')).toHaveAttribute('role', 'status');
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);

    // The picker does not open either.
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    key('i');
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();

    // Back online: images can be added again.
    fp.provider().open();
    await dropFiles(viewportEl(), [imageFile('shot-a.png')], { x: 100, y: 100 });
    expect(images(doc)).toHaveLength(1);
    expect(uploads[0]!.boardId).toBe('AAAAAAAAAAAAAAAAAAAAAA');
  });

  it('TC-20 I opens the picker (Select stays active); a rate-limited upload fails the image and shows the rate message', async () => {
    renderApp(doc);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    key('i');
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(toolButton('Image (I)'));
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
    const input = document.querySelector<HTMLInputElement>('input[data-testid="image-picker"]')!;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    expect(
      within(screen.getByRole('toolbar', { name: 'Tools' }))
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Select (V)']);

    await pickFiles([imageFile('photo.jpg')]);
    expect(images(doc)).toHaveLength(1);
    await settle(uploads[0]!, { kind: 'rate_limited' });
    expect(images(doc)[0]!.status).toBe('failed');
    expect(toastText()).toBe(REJECTION_MESSAGES.rate);
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
  });

  it('TC-20 mixed picker batch: the PNG is added; type and size messages are shown together', async () => {
    renderApp(doc);
    const big = imageFile('photo.jpg', 'image/jpeg', 1);
    Object.defineProperty(big, 'size', { value: IMAGE_MAX_BYTES + 1 });
    await pickFiles([imageFile('shot-a.png'), new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' }), big]);
    expect(images(doc)).toHaveLength(1);
    expect(screen.getByTestId('toast')).toHaveTextContent(REJECTION_MESSAGES.type);
    expect(screen.getByTestId('toast')).toHaveTextContent(REJECTION_MESSAGES.size);
  });

  it('TC-29 createImageBitmap rejects for a corrupt file: type message, no placeholder (error path)', async () => {
    renderApp(doc);
    await dropFiles(viewportEl(), [imageFile('corrupt.png')], { x: 50, y: 50 });
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(toastText()).toBe(REJECTION_MESSAGES.type);

    // A corrupt file next to a good one: the good one is still added.
    await dropFiles(viewportEl(), [imageFile('corrupt.png'), imageFile('shot-a.png')], { x: 50, y: 50 });
    expect(images(doc)).toHaveLength(1);
    expect(toastText()).toBe(REJECTION_MESSAGES.type);
  });
});
