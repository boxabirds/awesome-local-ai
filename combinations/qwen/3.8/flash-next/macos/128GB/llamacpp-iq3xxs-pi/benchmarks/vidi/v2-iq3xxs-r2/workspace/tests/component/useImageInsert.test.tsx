/**
 * Story 12, task 8: the three ways an image gets added, in the board they are wired into
 * (TC-17, TC-18, TC-19, TC-29).
 *
 * These run against the real board — the real viewport, the real toolbar, the real document,
 * the real messages — with two things held back: `createImageBitmap`, because jsdom cannot
 * decode anything, and `uploadImage`, because a test that cares what a failed upload looks
 * like has to be the one that fails it.
 *
 * What is worth asserting here is the part that only exists once things are wired: which
 * point in the *board* a drop in the *window* turns into, that a paste means different things
 * depending on where the caret was, and that a board which cannot upload leaves nothing
 * behind to explain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD } from '../../src/shared/config';
import { VIEWPORT_FIXTURE } from './fixtures/board';
import {
  createNoteViaButton,
  flushFrames,
  readCamera,
  renderBoard,
  selectNote,
  startEditingNote,
} from './fixtures/board';
import {
  clearImageDecodeStub,
  connected,
  dropFiles,
  imageFile,
  imagesInDoc,
  hasImageElement,
  pasteFiles,
  reconnected,
  stubImageDecode,
  storedKey,
} from './fixtures/images';
import { resetUploads, uploads } from './fixtures/upload-stub';

// The upload never happens; the test decides when it worked, and how far it had got before
// that. `assetUrl` and the rest of the module stay real, because the components under test use
// them to name the address an image would be served from.
vi.mock('../../src/client/images/uploadImage', async () => {
  const actual = await vi.importActual<typeof import('../../src/client/images/uploadImage')>(
    '../../src/client/images/uploadImage',
  );
  const { uploadImageStub } = await import('./fixtures/upload-stub');
  return { ...actual, uploadImage: uploadImageStub };
});

/** What the board has to say, in the order it said it. */
function toasts(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="toast"]')).map((element) =>
    element.textContent ?? '',
  );
}

async function waitForImages(count: number): Promise<void> {
  await vi.waitFor(() => {
    if (imagesInDoc().length !== count) {
      throw new Error(`expected ${count} image objects, got ${imagesInDoc().length}`);
    }
  });
}

async function waitForToast(message: string): Promise<void> {
  await vi.waitFor(() => {
    if (!toasts().includes(message)) throw new Error(`no toast ${message}: ${toasts().join(' | ')}`);
  });
}

beforeEach(() => {
  resetUploads();
});

afterEach(() => {
  clearImageDecodeStub();
  resetUploads();
});

describe('dropping images on the board (TC-17)', () => {
  it('adds a drop as a row of placeholders, shows the uploader a percentage, and draws the pictures when they land', async () => {
    await renderBoard();
    await connected();
    const camera = readCamera();
    stubImageDecode({
      'a.png': { width: 200, height: 100 },
      'b.png': { width: 200, height: 100 },
      'c.png': { width: 100, height: 100 },
    });

    // The drop point is in the window; the first image's top-left corner must land on the
    // same point in the board (PRD: "its top-left corner starting at the drop point").
    const screen = { x: 100, y: 200 };
    dropFiles([imageFile('a.png'), imageFile('b.png'), imageFile('c.png')], screen);
    await waitForImages(3);

    const world = { x: screen.x + camera.x, y: screen.y + camera.y };
    const images = imagesInDoc();
    expect(images.map((image) => [image.x, image.y, image.width, image.height])).toEqual([
      [world.x, world.y, 200, 100],
      [world.x + 200 + IMAGE_LAYOUT_GAP_WORLD, world.y, 200, 100],
      [world.x + 2 * (200 + IMAGE_LAYOUT_GAP_WORLD), world.y, 100, 100],
    ]);
    // They are placeholders, not pictures: the bytes have not been asked for yet.
    for (const image of images) expect(image.status).toBe('uploading');
    expect(hasImageElement()).toBe(false);

    // One upload per image, and every one of them to this board.
    expect(uploads().length).toBe(3);
    expect(uploads().map((upload) => upload.file.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(uploads()[0].boardId.length).toBe(22);

    // The uploader sees a percentage that moves (`image.uploading`).
    uploads()[0].progress(0.5);
    await vi.waitFor(() => {
      const labels = Array.from(document.querySelectorAll('[data-testid="image-uploading"]')).map(
        (element) => element.textContent ?? '',
      );
      if (!labels.some((label) => label.includes('50%'))) {
        throw new Error(`no 50% placeholder: ${labels.join(' | ')}`);
      }
    });

    // When the bytes land, the placeholder becomes a picture in the very same box.
    for (const upload of uploads()) await upload.ok(storedKey());
    await vi.waitFor(() => {
      if (imagesInDoc().some((image) => image.status !== 'ready')) throw new Error('not ready yet');
    });
    expect(document.querySelectorAll('[data-testid="image-object"]')).toHaveLength(3);
    const src = document
      .querySelector<HTMLImageElement>('[data-testid="image-object"]')
      ?.getAttribute('src');
    expect(src).toMatch(/^\/api\/assets\/[\w-]{22}\/[\w-]{22}$/);
  });

  it('places a picture that is bigger than the board likes at the size the board likes', async () => {
    // `image.placement_size`, and the one thing the row layout cannot get wrong on its own:
    // the box is the scaled size, while the picture's own size travels with it for the ratio a
    // resize has to keep.
    await renderBoard();
    await connected();
    stubImageDecode({ 'wide.png': { width: 1440, height: 900 } });

    dropFiles([imageFile('wide.png')], { x: 100, y: 200 });
    await waitForImages(1);

    const [image] = imagesInDoc();
    if (!image) throw new Error('the picture was never placed');
    expect([image.width, image.height]).toEqual([IMAGE_MAX_PLACE_SIZE_WORLD, 500]);
    expect([image.naturalWidth, image.naturalHeight]).toEqual([1440, 900]);
  });

  it('leaves nothing behind when the board cannot upload (TC-19)', async () => {
    await renderBoard();
    await connected();
    stubImageDecode({ 'a.png': { width: 200, height: 100 } });
    await reconnected();

    dropFiles([imageFile('a.png')], { x: 100, y: 200 });

    await waitForToast("You're offline — images can be added when you reconnect.");
    expect(imagesInDoc()).toHaveLength(0);
    // Nothing was added, so nothing was uploaded either: a queued upload would be an image
    // whose bytes nobody is carrying.
    expect(uploads()).toHaveLength(0);
  });

  it('refuses a file that is a picture in name only, and adds the one that is (TC-29)', async () => {
    await renderBoard();
    await connected();
    stubImageDecode({ 'real.png': { width: 120, height: 80 } }, ['renamed.pdf.png']);

    dropFiles([imageFile('renamed.pdf.png'), imageFile('real.png')], { x: 40, y: 60 });

    await waitForToast('Only PNG, JPEG, GIF and WebP images can be added.');
    await waitForImages(1);
    const [image] = imagesInDoc();
    expect([image.width, image.height]).toEqual([120, 80]);
    // Only the file that decoded is carried towards the server.
    expect(uploads().map((upload) => upload.file.name)).toEqual(['real.png']);
  });
});

describe('pasting an image (TC-18)', () => {
  it('adds an image to the middle of what this person can see', async () => {
    await renderBoard();
    await connected();
    const camera = readCamera();
    stubImageDecode({ 'shot.png': { width: 200, height: 100 } });

    pasteFiles([imageFile('shot.png')]);
    await waitForImages(1);

    // A paste has no point in the board that was aimed at, so the row is centred on the middle
    // of the screen (`image.paste`): the centre of the screen is the world origin here, and the
    // image's own box straddles it.
    const centre = { x: VIEWPORT_FIXTURE.width / 2 + camera.x, y: VIEWPORT_FIXTURE.height / 2 + camera.y };
    const image = imagesInDoc()[0];
    expect([image.x, image.y, image.width, image.height]).toEqual([
      centre.x - 100,
      centre.y - 50,
      200,
      100,
    ]);
  });

  it('leaves the paste to the note that is being typed into', async () => {
    await renderBoard();
    await connected();
    stubImageDecode({ 'shot.png': { width: 200, height: 100 } });
    const id = await createNoteViaButton();
    await selectNote(id);
    await startEditingNote(id);

    pasteFiles([imageFile('shot.png')], document.querySelector('[data-testid="sticky-editor"]')!);
    await flushFrames();

    // The caret is the authority on whose paste this is (PRD: "IF text is being edited THEN
    // THE SYSTEM SHALL NOT add an image").
    expect(imagesInDoc()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
  });
});
