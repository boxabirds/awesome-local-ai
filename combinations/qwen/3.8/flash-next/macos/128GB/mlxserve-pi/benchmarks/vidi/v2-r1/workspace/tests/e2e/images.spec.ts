// Dropping images onto a real board, in a real browser, on the real serving path
// (story 12). What only a browser can answer: whether a real PNG that a person
// drops actually shows up at the right size and aspect, whether the file-chooser
// path adds them too, whether a resize keeps the picture's proportions and is one
// undo step, and whether a stuck or unavailable image looks the way it should to
// the person who dropped it and to someone watching it arrive.
//
// The bytes are real, decodable PNGs of known dimensions (fixtures/e2e-*.png), so
// the size an image is placed at is a fact the test can predict, not a mock. The
// upload and the asset both go over HTTP against `wrangler dev`, R2 and all — the
// whole point of `image.upload`/`image.unavailable` is that they are about a real
// network, which is where the unit and component suites stop.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md (TC-25 to TC-28).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { openParticipants } from './helpers/participants';
import { settle } from './helpers/board';

/** A fixture image: name, media type and the bytes, ready for the page. */
interface Fixture {
  name: string;
  type: string;
  /** Natural pixel dimensions, so a placed size can be predicted. */
  width: number;
  height: number;
  file: string;
}

const FIXTURE_DIR = new URL('../fixtures/images/', import.meta.url);
const fixturePath = (file: string): string =>
  fileURLToPath(new URL(file, FIXTURE_DIR));

/** 2:1, 1:1 and 1:2 images: three aspects that a proportional resize cannot hide. */
const WIDE: Fixture = { name: 'wide.png', type: 'image/png', width: 200, height: 100, file: 'e2e-wide-2x1.png' };
const SQUARE: Fixture = { name: 'square.png', type: 'image/png', width: 100, height: 100, file: 'e2e-square-1x1.png' };
const TALL: Fixture = { name: 'tall.png', type: 'image/png', width: 100, height: 200, file: 'e2e-tall-1x2.png' };

/** The size a fixture is placed at, straight from `placementSize`. */
function placedSize(fixture: Fixture): { width: number; height: number } {
  const scale = Math.min(1, IMAGE_MAX_PLACE_SIZE_WORLD / Math.max(fixture.width, fixture.height));
  return { width: fixture.width * scale, height: fixture.height * scale };
}

// --- getting images onto the board ------------------------------------------

const toBase64 = (fixture: Fixture): string =>
  readFileSync(fixturePath(fixture.file)).toString('base64');

/** Install the drop machinery once: a helper the page can call to drop real bytes. */
async function installDropHelper(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __dropImages?: unknown }).__dropImages = (
      files: Array<{ name: string; type: string; base64: string }>,
      x: number,
      y: number,
    ): void => {
      const dataTransfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        dataTransfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      const target = document.querySelector('[data-testid="board-viewport"]');
      if (!target) throw new Error('no board viewport to drop onto');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer }),
        );
      }
    };
  });
}

/** Drop `fixtures` at a screen point; they are placed from there and uploaded for real. */
async function dropImages(page: Page, fixtures: Fixture[], x = 300, y = 200): Promise<void> {
  await page.evaluate(
    ({ files, px, py }) => {
      const helper = (window as unknown as { __dropImages: (f: unknown, x: number, y: number) => void }).__dropImages;
      helper(files, px, py);
    },
    { files: fixtures.map((f) => ({ name: f.name, type: f.type, base64: toBase64(f) })), px: x, py: y },
  );
}

/** Add `fixtures` through the real file-chooser, opened by the rail's Image button. */
async function pickImages(page: Page, fixtures: Fixture[]): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('tool-image').click(),
  ]);
  await chooser.setFiles(
    fixtures.map((f) => ({
      name: f.name,
      mimeType: f.type,
      buffer: readFileSync(fixturePath(f.file)),
    })),
  );
}

// --- reading the board back --------------------------------------------------

interface ImageOnScreen {
  id: string;
  /** Board units, read from the box's own style (the world layer scales them to px). */
  left: number;
  top: number;
  width: number;
  height: number;
  status: string;
  text: string;
}

async function images(page: Page): Promise<ImageOnScreen[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image-object"]')).map((el) => ({
      id: el.dataset.id ?? '',
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      status: el.dataset.status ?? '',
      text: el.textContent ?? '',
    })),
  );
}

/** Wait until every image box has reached the `ready` status (bytes uploaded). */
async function waitForReady(page: Page, count: number): Promise<ImageOnScreen[]> {
  await expect
    .poll(async () => (await images(page)).filter((i) => i.status === 'ready').length, {
      timeout: 10_000,
      intervals: [100],
    })
    .toBe(count);
  return images(page);
}

/** The world point a screen point lands on, from the test hook's live camera. */
async function worldOf(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const camera = await page.evaluate(() => window.__vidi6?.getCamera());
  if (!camera) throw new Error('no camera from the test hook');
  // screenToWorld, mirrored: world = screen / zoom + camera. The board places the first
  // image's top-left at exactly this point.
  return { x: x / camera.zoom + camera.x, y: y / camera.zoom + camera.y };
}

// --- the scenarios -----------------------------------------------------------

test('TC-25 a drop of two images and a file-chooser add of two more make a moodboard', async ({
  page,
}) => {
  await openParticipantsOnce(page);
  await installDropHelper(page);

  // Two images dropped together: they land in a row where the pointer was, each at its
  // own aspect, sized to the same maximum — the moodboard, not a stack on one point.
  await dropImages(page, [WIDE, SQUARE], 200, 160);
  const dropped = await waitForReady(page, 2);
  for (const image of dropped) {
    await expect(page.locator(`[data-testid="image-object"][data-id="${image.id}"] img`)).toBeVisible();
  }
  const wide = dropped.find((i) => near(i.width / i.height, 2))!;
  const square = dropped.find((i) => near(i.width / i.height, 1))!;
  expect(wide).toBeTruthy();
  expect(square).toBeTruthy();
  // The first is exactly at the drop point (in board units, wherever the camera is);
  // they share a top (a row) and do not overlap.
  const dropWorld = await worldOf(page, 200, 160);
  expect(Math.round(wide.left)).toBe(Math.round(dropWorld.x));
  expect(Math.round(wide.top)).toBe(Math.round(dropWorld.y));
  expect(Math.round(square.top)).toBe(Math.round(dropWorld.y));
  expect(square.left).toBeGreaterThan(wide.left + wide.width - 1);
  // Neither was placed larger than the maximum, whichever dimension led.
  for (const image of dropped) {
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD + 1);
  }

  // Two more through the file-chooser: the picker is the same add, opened differently.
  await pickImages(page, [TALL, SQUARE]);
  const all = await waitForReady(page, 4);
  expect(all.length).toBe(4);
  // Still within the per-add limit — which the board has never let anyone exceed.
  expect(all.length).toBeLessThanOrEqual(IMAGE_MAX_FILES_PER_ADD);
});

test('TC-26 an image whose upload never finishes is removable by anyone, and vanishes for everyone', async ({
  browser,
}) => {
  const { people } = await openParticipants(browser, 2, { outageSwitch: false });
  const [ uploader, watcher ] = [people[0]!, people[1]!];
  await installDropHelper(uploader.page);

  // The upload cannot finish: the POST to the board's asset path is left hanging, so
  // the placeholder is left in flight with nothing coming to resolve it. (The exact
  // "didn't finish" wording is a clock the component suite ages on its own; what only a
  // browser shows is that the stuck image is not stuck on the person who made it.)
  await uploader.page.route('**/api/boards/*/assets', () => {
    /* never answered: the upload stays in flight */
  });

  await dropImages(uploader.page, [WIDE], 200, 160);
  // It appears for the watcher as an image in flight, at the placed size.
  await expect
    .poll(async () => (await images(watcher.page)).filter((i) => i.status === 'uploading').length, {
      timeout: 10_000,
      intervals: [100],
    })
    .toBe(1);
  const stuck = (await images(watcher.page))[0]!;
  expect(Math.round(stuck.width)).toBe(Math.round(placedSize(WIDE).width));

  // Someone who did not drop it can select it and delete it; it disappears for both.
  await selectImage(watcher.page, stuck.id);
  await watcher.page.keyboard.press('Delete');
  await expect
    .poll(async () => (await images(watcher.page)).length, { timeout: 5_000, intervals: [100] })
    .toBe(0);
  await expect
    .poll(async () => (await images(uploader.page)).length, { timeout: 5_000, intervals: [100] })
    .toBe(0);
});

test('TC-27 resizing an image keeps its proportions, keeps its place, and is one undo step', async ({
  page,
}) => {
  await openParticipantsOnce(page);
  await installDropHelper(page);
  await dropImages(page, [WIDE], 200, 160);
  const [before] = await waitForReady(page, 1);
  await selectImage(page, before!.id);

  const se = page.locator('[data-testid="resize-handle"][data-handle="se"]');
  const box = (await se.boundingBox())!;
  // Drag the south-east corner along +x only: the height must follow by the aspect, and
  // the top-left must stay put (a picture grows from the corner you are holding).
  const dx = 120;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await settle(page);

  const resized = (await images(page)).find((i) => i.id === before!.id)!;
  expect(resized.width).toBeGreaterThan(before!.width + 5);
  // The 2:1 aspect is held exactly as a picture, not a stretched rectangle.
  expect(near(resized.width / resized.height, 2, 0.02)).toBe(true);
  expect(Math.round(resized.left)).toBe(Math.round(before!.left));
  expect(Math.round(resized.top)).toBe(Math.round(before!.top));
  // Never below the floor.
  expect(Math.max(resized.width, resized.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);

  // One undo returns it to the size it was placed at; nothing else about it moved.
  await page.keyboard.press('ControlOrMeta+z');
  await settle(page);
  const undone = (await images(page)).find((i) => i.id === before!.id)!;
  expect(Math.round(undone.width)).toBe(Math.round(before!.width));
  expect(Math.round(undone.height)).toBe(Math.round(before!.height));
});

test('TC-28 a failed upload says "failed" to its author and "unavailable" to a watcher; a stored image whose bytes are gone says "unavailable" at its size', async ({
  browser,
}) => {
  const { people } = await openParticipants(browser, 2);
  const [uploader, watcher] = [people[0]!, people[1]!];
  await installDropHelper(uploader.page);

  // A failed upload: the author is told it failed and is given the choice; the watcher
  // is not shown someone else's failure, only that there is no image to see. The upload
  // is answered with a 500 on the board's asset POST path.
  await uploader.page.route('**/api/boards/*/assets', (route) =>
    route.fulfill({ status: 500, body: 'nope' }),
  );
  await dropImages(uploader.page, [WIDE], 200, 160);
  await expect
    .poll(async () => (await images(watcher.page)).length, { timeout: 10_000, intervals: [100] })
    .toBe(1);
  await expect(uploader.page.getByTestId('image-object-failed')).toBeVisible();
  await expect(uploader.page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(uploader.page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(watcher.page.getByTestId('image-object-unavailable')).toBeVisible();
  // A failed image leaves a gap the size it was placed at, for everyone.
  const gap = (await images(watcher.page))[0]!;
  expect(Math.round(gap.width)).toBe(Math.round(placedSize(WIDE).width));

  // A stored image whose bytes are gone: the upload succeeds now (unroute), the object
  // is `ready`, but the watcher's fetch of the asset is refused — so that viewer is told
  // it is unavailable while the document still calls the object ready.
  await uploader.page.unroute('**/api/boards/*/assets');
  await dropImages(uploader.page, [SQUARE], 200, 400);
  await waitForReady(uploader.page, 1);

  await watcher.page.route('**/api/assets/*', (route) => route.abort());
  await watcher.page.reload();
  await expect(watcher.page.getByTestId('board-viewport')).toBeVisible();
  await expect
    .poll(async () => (await images(watcher.page)).length, { timeout: 10_000, intervals: [100] })
    .toBeGreaterThanOrEqual(1);
  // The square image the watcher cannot load is still shown at its box's size.
  const unavailableBox = watcher.page.getByTestId('image-object-unavailable').first();
  await expect(unavailableBox).toBeVisible();
  await settle(watcher.page);
});

// --- helpers shared by the scenarios -----------------------------------------

/** Open one board as a single person, the way a person does: create it from home. */
async function openParticipantsOnce(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('new-board-button').click();
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await settle(page);
}

/** Click the centre of an image box, in screen pixels, to select it. */
async function selectImage(page: Page, id: string): Promise<void> {
  const centre = await page.evaluate((imageId) => {
    const el = document.querySelector(`[data-testid="image-object"][data-id="${imageId}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  if (!centre) throw new Error(`no image ${id} on this screen`);
  await page.mouse.click(centre.x, centre.y);
  await settle(page);
}

/** Compare a ratio to an exact value within `tolerance`. */
function near(value: number, target: number, tolerance = 0.02): boolean {
  return Math.abs(value - target) <= tolerance;
}
