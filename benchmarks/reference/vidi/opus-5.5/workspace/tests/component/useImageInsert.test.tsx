/**
 * image.insert (story 12) on the real board with a real Y.Doc: TC-17 to TC-20 and TC-29, plus
 * the Image button / I shortcut and the drop highlight. uploadImage is mocked with controllable
 * progress; createImageBitmap is stubbed (jsdom cannot decode images).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenToWorld } from '../../src/client/canvas/camera';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { assetKeyFor } from '../../src/shared/image-format';
import {
  dropFiles,
  imageEl,
  imageFile,
  images,
  pasteFiles,
  renderConnectedBoard,
  stubDecoder,
  toastText,
  uploads,
} from './imageHelpers';
import { board, camera, doubleClickBoard, editor } from './stickyHelpers';
import { TEST_VIEWPORT } from './setup';
import { pressKey } from './textHelpers';

vi.mock('../../src/client/images/uploadImage', async () => {
  const { mockUpload: upload } = await import('./uploadMock');
  return { uploadImage: vi.fn(upload) };
});

const HALF = 2;
const SIZES = {
  'a.png': { width: 400, height: 300 },
  'b.png': { width: 1600, height: 1200 },
  'c.png': { width: 100, height: 50 },
};
const DROP_AT = { x: 300, y: 200 };
const KEY = () => assetKeyFor(newBoardId(), newBoardId());

beforeEach(() => {
  uploads.length = 0;
  stubDecoder(SIZES);
});

describe('TC-17 drop', () => {
  it('3 files → 3 placeholders in a row from the drop point; progress shows; ready after upload', async () => {
    renderConnectedBoard();
    dropFiles(board(), [imageFile('a.png'), imageFile('b.png'), imageFile('c.png')], DROP_AT);
    await waitFor(() => expect(images()).toHaveLength(3));
    const world = screenToWorld(camera(), DROP_AT);
    const placed = [...images()].sort((p, q) => p.x - q.x);
    expect(placed.map((i) => [i.width, i.height])).toEqual([
      [400, 300],
      [800, 600],
      [100, 50],
    ]);
    expect(placed[0]!.x).toBeCloseTo(world.x);
    for (const img of placed) expect(img.y).toBeCloseTo(world.y);
    expect(placed[1]!.x).toBeCloseTo(placed[0]!.x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed[2]!.x).toBeCloseTo(placed[1]!.x + 800 + IMAGE_LAYOUT_GAP_WORLD);
    for (const img of placed) expect(img.status).toBe('uploading');

    expect(uploads.map((u) => u.file.name)).toEqual(['a.png', 'b.png', 'c.png']);
    const first = placed[0]!;
    // The uploader sees progress as a percentage.
    expect(imageEl(first.id).textContent).toContain('0%');
    uploads[0]!.progress(0.42);
    expect(imageEl(first.id).textContent).toContain('42%');
    expect(imageEl(first.id).querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42');

    const key = KEY();
    await uploads[0]!.resolve({ kind: 'ok', assetKey: key });
    const ready = images().find((i) => i.id === first.id)!;
    expect(ready).toMatchObject({ status: 'ready', assetKey: key });
    const img = imageEl(first.id).querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/assets/${key}`);
    expect(img.getAttribute('alt')).toBe('Image');
  });

  it('shows the drop highlight while files are dragged over the board, not for other drags', () => {
    renderConnectedBoard();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireEvent.dragOver(board(), { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fireEvent.dragEnter(board(), { dataTransfer: { types: ['Files'], files: [] } });
    fireEvent.dragOver(board(), { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    fireEvent.dragLeave(board(), { dataTransfer: { types: ['Files'], files: [] }, relatedTarget: null });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('adding images is one undo step', async () => {
    renderConnectedBoard();
    dropFiles(board(), [imageFile('a.png'), imageFile('c.png')], DROP_AT);
    await waitFor(() => expect(images()).toHaveLength(2));
    await uploads[0]!.resolve({ kind: 'ok', assetKey: KEY() });
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(images()).toHaveLength(0);
  });

  it('unsupported and too-large files in the same drop are refused with both messages; the rest is added', async () => {
    renderConnectedBoard();
    const files = [
      imageFile('a.png'),
      imageFile('doc.pdf', 'application/pdf'),
      imageFile('big.png', 'image/png', IMAGE_MAX_BYTES + 1),
    ];
    dropFiles(board(), files, DROP_AT);
    await waitFor(() => expect(images()).toHaveLength(1));
    expect(toastText()).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(toastText()).toContain('Images must be 10 MB or smaller.');
    expect(uploads).toHaveLength(1);
  });
});

describe('TC-18 paste', () => {
  it('while editing a sticky note: no image; with the board focused: one image centred in view', async () => {
    renderConnectedBoard();
    doubleClickBoard(600, 400);
    const textarea = editor();
    expect(textarea).not.toBeNull();
    pasteFiles(textarea!, [imageFile('a.png')]);
    // Give any (wrong) async insert a chance to happen.
    await new Promise((r) => setTimeout(r, 0));
    expect(images()).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    fireEvent.keyDown(textarea!, { key: 'Escape' });

    pasteFiles(document.body, [imageFile('a.png')]);
    await waitFor(() => expect(images()).toHaveLength(1));
    const centre = screenToWorld(camera(), { x: TEST_VIEWPORT.width / HALF, y: TEST_VIEWPORT.height / HALF });
    const img = images()[0]!;
    expect(img.x + img.width / HALF).toBeCloseTo(centre.x);
    expect(img.y + img.height / HALF).toBeCloseTo(centre.y);
  });

  it('clipboard content without image files is ignored', async () => {
    renderConnectedBoard();
    pasteFiles(document.body, [imageFile('notes.txt', 'text/plain')]);
    await new Promise((r) => setTimeout(r, 0));
    expect(images()).toHaveLength(0);
    expect(toastText()).toBe('');
  });
});

describe('TC-19 offline', () => {
  it('reconnecting then drop → offline message; no objects; upload not called', async () => {
    const provider = renderConnectedBoard();
    provider.drop();
    dropFiles(board(), [imageFile('a.png')], DROP_AT);
    await waitFor(() => expect(toastText()).toBe("You're offline — images can be added when you reconnect."));
    expect(images()).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('before the first sync the picker does not open either', () => {
    renderConnectedBoard(false);
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    pressKey('i');
    expect(click).not.toHaveBeenCalled();
    expect(toastText()).toBe("You're offline — images can be added when you reconnect.");
  });
});

describe('TC-20 picker', () => {
  it('the Image button and I open the file picker (then the tool is Select)', () => {
    renderConnectedBoard();
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(click).toHaveBeenCalledTimes(1);
    pressKey('p');
    pressKey('i');
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('upload rate-limited → the object is failed and the rate message shows', async () => {
    renderConnectedBoard();
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [imageFile('a.png'), imageFile('c.png')] } });
    await waitFor(() => expect(images()).toHaveLength(2));
    // Picked files are centred in view as a row.
    const centre = screenToWorld(camera(), { x: TEST_VIEWPORT.width / HALF, y: TEST_VIEWPORT.height / HALF });
    const row = [...images()].sort((p, q) => p.x - q.x);
    const left = row[0]!.x;
    const right = row[1]!.x + row[1]!.width;
    expect((left + right) / HALF).toBeCloseTo(centre.x);

    await uploads[0]!.resolve({ kind: 'rate_limited' });
    const failed = images().find((i) => i.id === row.find((r) => r.naturalWidth === 400)!.id)!;
    expect(failed.status).toBe('failed');
    expect(toastText()).toBe("You're adding images too quickly. Wait a minute and try again.");
  });
});

describe('TC-29 decode failure', () => {
  it('createImageBitmap rejects for a corrupt file → type message, no placeholder, no upload', async () => {
    renderConnectedBoard();
    dropFiles(board(), [imageFile('corrupt.png')], DROP_AT);
    await waitFor(() => expect(toastText()).toBe('Only PNG, JPEG, GIF and WebP images can be added.'));
    expect(images()).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});
