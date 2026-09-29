// Story 12 — drop images onto the board. Playwright e2e (TC-25 to TC-28), for the workflows
// "Moodboard with a colleague", "Mixed picker batch", "Resize and revisit", "Flaky upload" and the
// PRD's "a board with a flaky connection".
//
// These are the cases only a real browser and a real server can answer: that a file dragged onto
// the board becomes bytes in storage and a picture on somebody else's screen inside the second the
// board promises; that a PDF wearing a PNG's name is refused in the browser as well as at the
// server, and the good files in the same batch still arrive; that the picture a colleague resized
// kept its shape and is still there in a browser that has never seen it, fetched from storage; and
// that an upload which did not happen leaves a box that can be sent again, by the only person who
// can.
//
// Two things are faked, and both are things a test is not allowed to do for real: the operating
// system's file dialogue (see helpers/drop-files.ts), and the state of the network, which
// `page.route` delays or aborts and `context.setOffline` turns off outright.

import { test, expect, type Page } from '@playwright/test';
import {
  connectionState,
  openBoard,
  openSharedBoard,
  restoreConnection,
  simulateDrop,
} from './helpers/board.ts';
import {
  chooseFiles,
  clickImage,
  dropFiles,
  imageBoxes,
  pickerInput,
  toastTexts,
  watchPickerClicks,
} from './helpers/drop-files.ts';
import { currentZoom, dragTo } from '../fixtures/checkout-flow.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { imageBytes, jpegOfExactSize } from '../fixtures/images/files.ts';
import {
  ASSET_CACHE_MAX_AGE_S,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config.ts';

/** The address the bytes are sent to — the only thing these tests ever intercept. */
const UPLOAD_PATH = '**/api/boards/*/assets';

const TYPE_MESSAGE = 'Only PNG, JPEG, GIF and WebP images can be added.';
const SIZE_MESSAGE = 'Images must be 10 MB or smaller.';
const OFFLINE_MESSAGE = "You're offline — images can be added when you reconnect.";
/** A byte over the limit is over it; a whole extra megabyte is a photograph nobody can post. */
const OVER_LIMIT = IMAGE_MAX_BYTES + 1024 * 1024;

const screenshot = () => ({
  name: 'holiday.png',
  type: 'image/png',
  bytes: imageBytes('png-1440x900'),
});
const photograph = () => ({
  name: 'sunset.jpg',
  type: 'image/jpeg',
  bytes: imageBytes('jpeg-4032x3024'),
});
const painting = () => ({
  name: 'bay.webp',
  type: 'image/webp',
  bytes: imageBytes('webp-640x480'),
});

/** How many pictures this screen has actually decoded and drawn. */
async function drawnImages(page: Page): Promise<number> {
  return (await imageBoxes(page)).filter((box) => box.drawn).length;
}

/** What the boxes on this screen say, left to right. */
async function labels(page: Page): Promise<string[]> {
  return (await imageBoxes(page)).map((box) => box.label);
}

const statuses = (page: Page) => imageBoxes(page).then((boxes) => boxes.map((box) => box.status));

/** The picture's own box on the screen, in screen pixels. */
async function boxOnScreen(page: Page, id: string) {
  const box = await page.locator(`[data-image-id="${id}"][data-image-status]`).boundingBox();
  if (!box) throw new Error(`no picture ${id} on the screen`);
  return box;
}

/** The corner handle of the selection, in screen pixels. */
async function cornerOnScreen(page: Page) {
  const box = await page.locator('[data-handle="se"]').boundingBox();
  if (!box) throw new Error('no corner handle on the screen: is the picture selected?');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('TC-25 three screenshots dropped by one person are pictures on the other', async ({
  context,
}) => {
  const boardId = newBoardId();
  const leo = await context.newPage();
  await openSharedBoard(leo, boardId);
  const sam = await context.newPage();
  await openSharedBoard(sam, boardId);
  expect(await currentZoom(leo)).toBe(1);

  // A photograph is not a sentence: it takes a moment to go up. That moment is held open here on
  // purpose, because the interesting state is the one in the middle of it — the one Sam is told
  // about — and a server on this machine would be too quick for anyone to see it.
  const SLOW_UPLOAD_MS = 1500;
  await leo.route(UPLOAD_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, SLOW_UPLOAD_MS));
    await route.continue();
  });

  await dropFiles(leo, [screenshot(), photograph(), painting()], { x: 420, y: 260 });

  // Leo's board has three boxes, on their way, in a row beginning where he dropped them.
  await expect(leo.locator('[data-image-status="uploading"]')).toHaveCount(3);
  const boxes = await imageBoxes(leo);
  expect(boxes.map((box) => box.status)).toEqual(['uploading', 'uploading', 'uploading']);
  // A row, left to right, level along the top, the gap the board names between them — and each
  // already the size its own picture will be, in that picture's own proportion.
  expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
  expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
  expect(boxes[1]!.y).toBe(boxes[0]!.y);
  expect(boxes[2]!.y).toBe(boxes[0]!.y);
  expect(boxes[1]!.x - (boxes[0]!.x + boxes[0]!.w)).toBeCloseTo(IMAGE_LAYOUT_GAP_WORLD, 0);
  expect(boxes[2]!.x - (boxes[1]!.x + boxes[1]!.w)).toBeCloseTo(IMAGE_LAYOUT_GAP_WORLD, 0);
  expect(boxes[0]!.w / boxes[0]!.h).toBeCloseTo(1440 / 900, 1);
  expect(boxes[1]!.w / boxes[1]!.h).toBeCloseTo(4032 / 3024, 1);
  expect(boxes[2]!.w / boxes[2]!.h).toBeCloseTo(640 / 480, 1);

  // Sam is told the same thing, in the words that are true for him: he is not the one sending
  // them, so he is given no percentage and nothing to click.
  await expect(sam.locator('[data-image-status="uploading"]')).toHaveCount(3);
  expect(await labels(sam)).toEqual(['Uploading…', 'Uploading…', 'Uploading…']);
  const whileUploading = await imageBoxes(sam);
  expect(whileUploading.every((box) => !box.hasRetry)).toBe(true);
  // And nothing is fetched while there is nothing to fetch: no address, no image element, so no
  // colleague's browser is sent four requests for bytes that are still on the way up.
  expect(whileUploading.every((box) => box.src === null)).toBe(true);

  // The bytes arrive, the board says so, and Sam sees that it says so inside the second a change
  // is promised to take.
  await expect
    .poll(() => statuses(leo), { timeout: 20_000 })
    .toEqual(['ready', 'ready', 'ready']);
  // The clock starts where the board's promise starts: the moment the change is on the board, not
  // the moment the bytes started their journey up.
  const made = Date.now();
  await expect
    .poll(() => statuses(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
    .toEqual(['ready', 'ready', 'ready']);
  expect(Date.now() - made).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

  // And they are pictures on his board too — decoded pixels, not a box with a hopeful address in
  // it. Fetching and drawing three files from storage is the board's work and not the collaboration
  // protocol's, so it is given its own leave rather than charged to the same second.
  await expect(sam.locator('[data-image-status="ready"]')).toHaveCount(3);
  await expect.poll(() => drawnImages(sam), { timeout: 20_000 }).toBe(3);
  const his = await imageBoxes(sam);
  const hers = await imageBoxes(leo);
  expect(his.every((box) => box.naturalWidth > 0)).toBe(true);

  // The same three pictures, in the same places, on both screens — and each fetched from the
  // address its own bytes were stored under, which is an address belonging to the board rather
  // than to the object, to the object's id rather than to a name somebody typed.
  expect(his.map((box) => box.id).sort()).toEqual(hers.map((box) => box.id).sort());
  for (const box of his) {
    expect(box.src).toMatch(new RegExp(`^/api/assets/${boardId}/[A-Za-z0-9_-]{22}$`));
    expect(hers.find((other) => other.id === box.id)!.src).toBe(box.src);
    expect(box.x).toBeCloseTo(hers.find((other) => other.id === box.id)!.x, 0);
    expect(box.w).toBeCloseTo(hers.find((other) => other.id === box.id)!.w, 0);
  }
  // Two pictures are two files: no two boxes on the board point at the same bytes, because a
  // second copy of a picture is minted a new name rather than reusing one.
  expect(new Set(his.map((box) => box.src)).size).toBe(3);

  // A picture that will never change is announced as one, in the server's own words: immutable,
  // for a year, with the type the bytes turned out to be and the browser forbidden to guess
  // otherwise. A cached copy is only safe because a name can never be pointed at new bytes.
  const address = new URL(his[0]!.src!, sam.url());
  const served = await sam.request.get(address.toString());
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
  expect(served.headers()['cache-control']).toBe(
    `public, max-age=${ASSET_CACHE_MAX_AGE_S}, immutable`,
  );
  expect(served.headers()['x-content-type-options']).toBe('nosniff');
  expect(served.headers()['content-security-policy']).toBe("default-src 'none'");

  // Undo takes the row back — all three at once, because adding them was one thing a person did.
  await leo.keyboard.press('Control+z');
  await expect(leo.locator('[data-image-status]')).toHaveCount(0);
  await expect
    .poll(() => imageBoxes(sam).then((boxes) => boxes.length), {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    })
    .toBe(0);
  // The bytes stay where they were put: undo moves the board back, it does not un-store a file,
  // and a picture some other board is still pointing at must not vanish because this one changed
  // its mind.
  expect((await sam.request.get(address.toString())).status()).toBe(200);
});

test('TC-26 a batch chosen with I: the good one arrives, and each refusal says why', async ({
  page,
}) => {
  await openBoard(page);
  const pickerClicks = await watchPickerClicks(page);

  // `I` asks for the file picker. The dialogue is the operating system's and out of a test's reach,
  // so what is measured is the click the board puts on its own input — all a page can do to open a
  // picker, and the very thing a person's mouse is answered by.
  await page.keyboard.press('i');
  await expect.poll(pickerClicks).toBe(1);
  // And it is the picker that takes exactly the four kinds, more than one at a time.
  await expect(pickerInput(page)).toHaveAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp');
  await expect(pickerInput(page)).toHaveAttribute('multiple', '');

  // A screenshot; a PDF wearing a PNG's name, whose name the browser is happy to repeat to us; and
  // a photograph one megabyte past the limit.
  await chooseFiles(page, [
    screenshot(),
    { name: 'scan.png', type: 'application/pdf', bytes: imageBytes('pdf') },
    { name: 'panorama.jpg', type: 'image/jpeg', bytes: jpegOfExactSize(OVER_LIMIT) },
  ]);

  // One picture, which arrived — and it was not held up by the two that were refused.
  await expect(page.locator('[data-image-status="ready"]')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => drawnImages(page)).toBe(1);

  // Two sentences, for the two things wrong with the batch, said together.
  const said = await toastTexts(page);
  expect(said).toContain(TYPE_MESSAGE);
  expect(said).toContain(SIZE_MESSAGE);

  // Neither refusal was written down anywhere. There is one object on the board and it is the
  // picture: the others were refused before there was a box to put a state in, which is why undoing
  // this add undoes a picture and not a rejection.
  const boxes = await imageBoxes(page);
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.label).toBe('Image');
  expect(boxes[0]!.naturalWidth).toBe(1440);

  // The board did not pretend to have a problem it did not have, either.
  expect(said).toHaveLength(2);
});

test('TC-27 a picture chosen, resized, and found again by somebody who was not there', async ({
  page,
  browser,
}) => {
  const boardId = await openBoard(page);

  // The picker, which is how most people most often put a picture on a board — and the way a
  // screenshot that has been in and out of a photo app arrives.
  await chooseFiles(page, [screenshot()]);
  await expect(page.locator('[data-image-status="ready"]')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => drawnImages(page)).toBe(1);

  const before = (await imageBoxes(page))[0]!;
  const id = before.id;
  const natural = before.w / before.h;
  expect(natural).toBeCloseTo(1440 / 900, 1);

  // Selected the way every object is: a click on it. The picture itself is not a target — a click
  // anywhere on it must reach the object, not the image inside it.
  const rect = await boxOnScreen(page, id);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(page.locator('[data-handle="se"]')).toHaveCount(1);

  // A corner pulled out: bigger, and the same shape. Of all the objects on this board the picture
  // is the one that arrived with a shape of its own, and a resize that squashed it would be a
  // picture ruined rather than resized.
  const out = await cornerOnScreen(page);
  await dragTo(page, out, { x: out.x + 150, y: out.y + 94 });
  await expect
    .poll(async () => (await imageBoxes(page))[0]!.w)
    .toBeGreaterThan(before.w);
  const grown = (await imageBoxes(page))[0]!;
  expect(grown.w / grown.h).toBeCloseTo(natural, 2);

  // The same corner shoved a long way inside the picture: it stops at the floor the board names,
  // and stops there in proportion. A photograph shrunk to a point is a thing nobody can look at.
  const inwards = await cornerOnScreen(page);
  await dragTo(page, inwards, { x: inwards.x - 3000, y: inwards.y - 3000 });
  await expect
    .poll(async () => Math.min(...(await imageBoxes(page)).map((box) => Math.min(box.w, box.h))))
    .toBeLessThanOrEqual(IMAGE_MIN_SIZE_WORLD + 1);
  const small = (await imageBoxes(page))[0]!;
  expect(Math.min(small.w, small.h)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
  expect(small.w / small.h).toBeCloseTo(natural, 1);

  // A second browser, which has never seen these bytes and holds nothing in its cache, opens the
  // board: the picture comes out of storage. That is the whole point of storing it somewhere other
  // than this tab — and the only proof that the picture a colleague sees is not a memory of a
  // window they were never in.
  const later = await browser.newContext();
  const visitor = await later.newPage();
  await openSharedBoard(visitor, boardId);
  await expect(visitor.locator('[data-image-status="ready"]')).toHaveCount(1);
  await expect.poll(() => drawnImages(visitor)).toBe(1);
  const found = (await imageBoxes(visitor))[0]!;
  expect(found.id).toBe(id);
  expect(found.w).toBeCloseTo(small.w, 0);
  expect(found.naturalWidth).toBe(1440);

  await later.close();
});

test('TC-28 an upload that did not happen says so, and sends itself again', async ({
  context,
  browser,
}) => {
  const boardId = newBoardId();
  const leo = await context.newPage();
  await openSharedBoard(leo, boardId);
  const other = await browser.newContext();
  const sam = await other.newPage();
  await openSharedBoard(sam, boardId);

  // The network fails on the way up, and only on the way up: everything already on the board still
  // works, which is why a board that cannot take a new picture is not a board that has lost the
  // pictures it has.
  await leo.route(UPLOAD_PATH, (route) => route.abort());
  await dropFiles(leo, [screenshot()], { x: 400, y: 300 });

  // The tab that was sending it is told, and is given the only thing that can help: the file is
  // still in this tab's memory.
  await expect(leo.locator('[data-image-status="failed"]')).toHaveCount(1);
  expect(await labels(leo)).toEqual(['Upload failed']);
  await expect(leo.locator('[data-testid^="image-retry-"]')).toHaveCount(1);
  await expect(leo.locator('[data-testid^="image-remove-"]')).toHaveCount(1);

  // Sam is looking at the same record and is told something different, correctly: he is not the tab
  // that holds the file, so there is nothing for him to send, and a button offering to would be a
  // lie.
  await expect(sam.locator('[data-image-status="failed"]')).toHaveCount(1);
  expect(await labels(sam)).toEqual(['Image unavailable']);
  expect((await imageBoxes(sam))[0]!.hasRetry).toBe(false);

  // The board has not lost its head over one failed upload: it is still connected — a failed POST
  // is not a dropped collaboration link — and the box is still an object that can be deleted like
  // any other.
  expect(await connectionState(leo)).toBe('connected');

  // And the box is an object like any other: pressed somewhere plain, it is selected, and selected,
  // it can be deleted. A picture that cannot be pressed is a picture nobody can move, resize or
  // clear away — the board's layer hands its clicks through to the objects standing on it, and a box
  // that never takes one is a box that is only a picture of an object.
  const failedId = (await imageBoxes(leo))[0]!.id;
  await clickImage(leo, failedId, { dx: 30, dy: 30 });
  await expect(leo.locator('[data-handle]')).toHaveCount(8);
  await leo.keyboard.press('Delete');
  await expect(leo.locator('[data-image-status]')).toHaveCount(0);
  await expect
    .poll(() => imageBoxes(sam).then((boxes) => boxes.length), {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    })
    .toBe(0);

  // The network comes back and both pictures are added; the second one fails.
  await leo.unroute(UPLOAD_PATH);
  await dropFiles(leo, [screenshot(), photograph()], { x: 400, y: 300 });
  await expect(leo.locator('[data-image-status="ready"]')).toHaveCount(2, { timeout: 20_000 });

  const ids = (await imageBoxes(leo)).map((box) => box.id);
  expect(ids).not.toContain(failedId);
  await leo.route(UPLOAD_PATH, (route) => route.abort());
  await dropFiles(leo, [painting()], { x: 400, y: 300 });
  await expect(leo.locator('[data-image-status="failed"]')).toHaveCount(1);
  const failed = (await imageBoxes(leo)).find((box) => box.status === 'failed')!;
  expect(ids).not.toContain(failed.id);

  // Retry: the same box, the same object, the same place on the board. Not a second picture added
  // beside the first, which is what an implementation that re-runs the whole add would do — and
  // which would leave the board holding a box for bytes nobody is sending.
  await leo.unroute(UPLOAD_PATH);
  // Pressed on its own button, which is the one place in a failed box that is not the object: a
  // click there sends the file again rather than selecting the box.
  await leo.locator(`[data-testid="image-retry-${failed.id}"]`).click();
  await expect(leo.locator('[data-handle]')).toHaveCount(0);
  await expect(leo.locator('[data-image-status="ready"]')).toHaveCount(3, { timeout: 20_000 });
  await expect.poll(() => drawnImages(leo), { timeout: 20_000 }).toBe(3);
  const after = await imageBoxes(leo);
  expect(after.map((box) => box.id).sort()).toEqual([...ids, failed.id].sort());
  expect(after.find((box) => box.id === failed.id)!.label).toBe('Image');

  // And Sam, who was told there was no picture, gets the picture. A Retry is not a private
  // arrangement between one tab and a server: the board is the same board everywhere.
  await expect.poll(() => drawnImages(sam), { timeout: 20_000 }).toBe(3);
  expect((await imageBoxes(sam)).map((box) => box.id).sort()).toEqual(
    [...ids, failed.id].sort(),
  );

  await other.close();
});

test("TC-28b a board this tab cannot reach refuses pictures, says why, and does not remember it", async ({
  page,
}) => {
  await openBoard(page);
  await expect.poll(() => connectionState(page)).toBe('connected');

  // The outage is put where an outage actually happens — on the wire, by closing the real
  // collaboration socket rather than by telling the board it is offline. A picture dropped in that
  // state could only ever be uploaded by this tab, and this tab cannot reach the board: so nothing
  // is added, and the one sentence that explains it is said out loud.
  await simulateDrop(page);
  await expect.poll(() => connectionState(page)).toBe('reconnecting');

  await dropFiles(page, [screenshot()], { x: 400, y: 300 });
  await expect(page.locator('[data-testid="toast"]')).toContainText(OFFLINE_MESSAGE);
  // Not one object: a box created now would be an upload abandoned five minutes from now, on every
  // screen, for a file this browser cannot send.
  expect(await imageBoxes(page)).toEqual([]);

  // The refusal is one sentence, not a sentence per attempt: the board said it once and has
  // nothing to add.
  expect(await toastTexts(page)).toEqual([OFFLINE_MESSAGE]);

  // The wire comes back and nothing has to be forgiven or retried: the same drop, a moment later,
  // is a picture.
  await restoreConnection(page);
  await expect.poll(() => connectionState(page)).toBe('connected');
  await dropFiles(page, [screenshot()], { x: 400, y: 300 });
  await expect(page.locator('[data-image-status="ready"]')).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(() => drawnImages(page)).toBe(1);
});
