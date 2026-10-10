/**
 * Story 12 in real browsers: pictures dropped from a file manager, picked from a dialog, and
 * one that came back broken and was sent again (TC-25 to TC-28).
 *
 * These are the only tests in the story where the bytes are real PNG and JPEG bytes, the
 * upload is a real XHR to a real Worker writing to a real bucket, and the picture is an `<img>`
 * a browser has decoded — so they are also the only tests that can say what the story actually
 * claims: that a file in one person's hand becomes a picture on somebody else's screen.
 *
 * As in story 3, delivery times are logged against the live budget and never asserted.
 */
import { expect, test, type Browser } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import {
  boardLink,
  closeParticipants,
  createBoard,
  expectNoErrors,
  logLatency,
  participantOf,
  type Participant,
} from './helpers/participants';
import { settle, waitForCentredBoard } from './helpers/board';
import { clickSpot, dragHandle, waitForSelection } from './helpers/selection';
import {
  boardImages,
  carryImages,
  clickImageAction,
  dropFixture,
  dropHighlightVisible,
  dropImages,
  failUploads,
  imageActions,
  imageRect,
  openImagePicker,
  oversizedJpeg,
  slowUploads,
  toastTexts,
  waitForImageCount,
  waitForImageStatus,
  waitForPictures,
} from './helpers/images';

/**
 * One person on a board the service made, and the link to it, which a test needs when it wants
 * to open the same board in a browser that has never seen it.
 */
async function aloneOn(browser: Browser, name: string): Promise<{ a: Participant; link: string }> {
  const link = boardLink(await createBoard(browser));
  return { a: await open(browser, link, name), link };
}

/** Two people on one board, by the names the story uses. */
async function twoPeople(
  browser: Browser,
  first: string,
  second: string,
): Promise<{ a: Participant; b: Participant; people: Participant[]; link: string }> {
  const link = boardLink(await createBoard(browser));
  const people: Participant[] = [];
  for (const name of [first, second]) {
    people.push(await open(browser, link, name));
  }
  return { a: people[0] as Participant, b: people[1] as Participant, people, link };
}

/** Join a board in a browser of her own, already centred on the middle of it. */
async function open(browser: Browser, link: string, name: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const person = participantOf(name, context, page);
  await page.goto(link);
  await waitForCentredBoard(page);
  return person;
}

/** A file the test hands over as if it had been chosen in the dialog. */
function asChosen(file: { name: string; mime: string; bytes: Uint8Array }): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  return { name: file.name, mimeType: file.mime, buffer: Buffer.from(file.bytes) };
}

/** Where a row of images is dropped: in the board's own quarter of the screen. */
const DROP_AT = { x: 300, y: 200 };

test('TC-25: three dropped pictures arrive on somebody else’s board as well', async ({
  browser,
}) => {
  const { a: alex, b: sam, people } = await twoPeople(browser, 'Alex', 'Sam');
  const page = alex.page;
  try {
    // Hold the uploads open for a moment: a placeholder that lasts as long as a local disk
    // write is a thing no test could see, and "the other person sees the placeholder" is a
    // thing the PRD promises.
    await slowUploads(page, 2_500);
    const files = [
      dropFixture('screenshot-900x600.png'),
      dropFixture('screenshot-1200x800.png'),
      dropFixture('photo-640x480.webp'),
    ];

    // Files being carried over the board are answered by an outline of it (PRD: image.drop).
    await carryImages(page, files, DROP_AT);
    expect(await dropHighlightVisible(page), 'the board outlined itself').toBe(true);

    const droppedAt = Date.now();
    await dropImages(page, files, DROP_AT);

    // Alex sees three placeholders, before any of them can be a picture.
    await expect(page.locator('[data-testid="image-state"][data-status="uploading"]')).toHaveCount(
      3,
    );
    // And so does Sam, from the document alone: he has no copy of these files.
    const samSawPlaceholderAt = Date.now();
    await expect(
      sam.page.locator('[data-testid="image-state"][data-status="uploading"]'),
      'Sam saw the placeholders',
    ).toHaveCount(3, { timeout: 8_000 });
    logLatency({
      op: 'TC-25 drop to a placeholder on another person’s screen',
      latencyMs: Date.now() - droppedAt,
      budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });
    // Nothing of the wait above counts as a picture arriving, so it is only logged.
    void samSawPlaceholderAt;

    const dropped = await waitForImageCount(page, 3);
    const ids = dropped.map((image) => image.id);
    // Every one of them becomes a picture, in both browsers: the browser has decoded the bytes,
    // rather than been told to believe they arrived.
    await waitForPictures(page, ids);
    await waitForPictures(sam.page, ids);
    logLatency({
      op: 'TC-25 drop to a picture on another person’s screen',
      latencyMs: Date.now() - droppedAt,
      budgetMs: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });

    // A row, left to right, tops aligned, gaps of one, each scaled to fit the placement limit.
    // Read left to right, because that is what a row is: the document holds objects by id.
    const images = (await boardImages(page)).sort((left, right) => left.x - right.x);
    expect(images.map((image) => [image.naturalWidth, image.naturalHeight])).toEqual([
      [900, 600],
      [1200, 800],
      [640, 480],
    ]);
    const row = images.map((image) => ({ x: image.x, y: image.y, width: image.width }));
    expect(new Set(row.map((box) => box.y)).size, 'the row shares one top edge').toBe(1);
    expect(row[1].x, 'the second image starts after the first and one gap').toBe(
      row[0].x + row[0].width + IMAGE_LAYOUT_GAP_WORLD,
    );
    expect(row[2].x, 'and so on').toBe(row[1].x + row[1].width + IMAGE_LAYOUT_GAP_WORLD);
    for (const image of images) {
      expect(Math.max(image.width, image.height), `image ${image.id} at its placement size`).toBeLessThanOrEqual(
        IMAGE_MAX_PLACE_SIZE_WORLD,
      );
      expect(image.status).toBe('ready');
      expect(image.assetKey, 'and it is stored somewhere').not.toBeNull();
    }
    // The first image's top-left corner is where the files were let go (screen 300,200 with the
    // board centred, so the world point is 300-640, 200-400).
    const camera = await page.locator('[data-testid="viewport"]').evaluate((viewport) => ({
      x: Number((viewport as HTMLElement).dataset.cameraX),
      y: Number((viewport as HTMLElement).dataset.cameraY),
    }));
    expect(Math.min(...images.map((image) => image.x)), 'the row begins under the pointer').toBeCloseTo(
      DROP_AT.x + camera.x,
      0,
    );

    expectNoErrors(people);
  } finally {
    await closeParticipants(people);
  }
});

test('TC-26: the picker adds one picture, and says why it refused the other two', async ({
  browser,
}) => {
  const { a: alex } = await aloneOn(browser, 'Alex');
  const page = alex.page;
  try {
    const picker = await openImagePicker(page);
    // The dialog only offers the four formats the board can serve back (`image.types`).
    const accept = (await picker.element().evaluate((input) => (input as HTMLInputElement).accept))
      .split(',')
      .map((type) => type.trim())
      .sort();
    expect(accept).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

    await picker.setFiles([
      asChosen(dropFixture('screenshot-1440x900.png')),
      // A PDF with a picture's name, which the browser will happily call image/png.
      { ...asChosen(dropFixture('disguised-pdf.png', 'disguised-pdf.png')), name: 'report.png' },
      // One byte over the line the PRD draws.
      asChosen(oversizedJpeg()),
    ]);

    await expect
      .poll(() => toastTexts(page), { timeout: 15_000 })
      .toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    await expect
      .poll(() => toastTexts(page), { timeout: 15_000 })
      .toContain('Images must be 10 MB or smaller.');

    // The one file it could use is on the board, and nothing else was attempted.
    const [image] = await waitForImageCount(page, 1);
    if (!image) throw new Error('the picked picture never arrived');
    // A 1440x900 screenshot does not fit at one board unit to a pixel, so it arrives at the
    // placement limit with its shape kept (`image.placement_size`).
    expect([image.width, image.height]).toEqual([IMAGE_MAX_PLACE_SIZE_WORLD, 500]);
    expect(image.naturalWidth).toBe(1440);

    // Adding a picture is not a mode: the pointer is still where it was (PRD: image.pick).
    await expect(page.locator('[data-testid="tool-select"]')).toHaveAttribute('aria-pressed', 'true');

    expectNoErrors([alex]);
  } finally {
    await closeParticipants([alex]);
  }
});

test('TC-27: a picture keeps its shape when it is stretched, and survives a reload', async ({
  browser,
}) => {
  const { a: alex, link } = await aloneOn(browser, 'Alex');
  const page = alex.page;
  try {
    // High and to the left, because a 640-wide picture dropped in the middle would put its
    // south-east handle under the zoom controls, and a press on a control is a press on it.
    await dropImages(page, [dropFixture('photo-640x480.webp', 'photo.webp')], { x: 400, y: 160 });
    const [image] = await waitForImageCount(page, 1);
    if (!image) throw new Error('the dropped picture never arrived');
    await waitForPictures(page, [image.id]);

    // Select it, so the handles come up. (An image is selected by clicking its own box, like
    // anything else on the board.)
    const box = await imageRect(page, image.id);
    await clickSpot(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await waitForSelection(page, [image.id]);

    const before = await imageRect(page, image.id);
    const ratio = (rect: { width: number; height: number }): number => rect.width / rect.height;
    // Pull a corner out and sideways: the shape comes with it (PRD: image.resize).
    await dragHandle(page, 'se', { x: 120, y: 90 });
    const grown = await imageRect(page, image.id);
    expect(grown.width, 'the picture got wider').toBeGreaterThan(before.width + 20);
    expect(ratio(grown), 'and kept its proportions').toBeCloseTo(ratio(before), 2);

    // Push the same corner back through the box, as far as the board allows: the shortest side
    // stops at the minimum, and the shape still holds (`image.min_size`).
    await dragHandle(page, 'se', { x: -4_000, y: -4_000 });
    const smallest = await imageRect(page, image.id);
    expect(Math.min(smallest.width, smallest.height), 'it stopped at the minimum size').toBeGreaterThanOrEqual(
      IMAGE_MIN_SIZE_WORLD - 1,
    );
    expect(Math.min(smallest.width, smallest.height), 'and not much past it').toBeLessThanOrEqual(
      IMAGE_MIN_SIZE_WORLD * 1.5,
    );
    expect(ratio(smallest), 'still the same shape').toBeCloseTo(ratio(before), 2);

    // Somebody else, on a page that has never seen this file, gets the same picture.
    const context = await browser.newContext();
    const later = await context.newPage();
    await later.goto(link);
    await waitForCentredBoard(later);
    const still = (await boardImages(later)).find((entry) => entry.id === image.id);
    await context.close();
    if (!still) throw new Error('the picture did not survive the reload');
    expect(still.status).toBe('ready');
    expect(still.width / still.height, 'and its size').toBeCloseTo(image.width / image.height, 4);

    expectNoErrors([alex]);
  } finally {
    await closeParticipants([alex]);
  }
});

test('TC-28: an upload that failed is said so, and sending it again works', async ({
  browser,
}) => {
  const { a: alex, b: sam, people } = await twoPeople(browser, 'Alex', 'Sam');
  const page = alex.page;
  try {
    const serverIsBack = await failUploads(page);
    await dropImages(page, [dropFixture('screenshot-900x600.png')], DROP_AT);
    const [image] = await waitForImageCount(page, 1);
    if (!image) throw new Error('the dropped picture never arrived');

    // Alex is told it failed, and given the two things she can do (PRD: image.upload_failure).
    await waitForImageStatus(page, image.id, 'failed');
    expect(await imageActions(page, image.id)).toEqual(['image-remove', 'image-retry']);
    // Sam is not given a story about an upload he knows nothing about.
    await waitForImageStatus(sam.page, image.id, 'failed');
    expect(await imageActions(sam.page, image.id), 'Sam is offered nothing').toEqual([]);
    // Nothing was stored, so there is nothing to serve.
    expect((await boardImages(page))[0]?.assetKey, 'no address was recorded').toBeNull();

    await serverIsBack();
    await clickImageAction(page, image.id, 'image-retry');

    // The same box goes back to uploading, and then, without a reload or a new drop, becomes a
    // picture: the file was kept, not asked for again.
    await waitForImageStatus(page, image.id, 'ready');
    await waitForPictures(page, [image.id]);
    await waitForPictures(sam.page, [image.id]);
    const stored = (await boardImages(page))[0];
    expect(stored?.status).toBe('ready');
    expect(stored?.assetKey, 'the bytes are in the bucket now').not.toBeNull();

    await settle(page);
    // The browser logs the upload it was not allowed to finish, which is the very thing this
    // test did to the server; everything else in the console is a real complaint.
    expectNoErrors(people, [/Failed to load resource/]);
  } finally {
    await closeParticipants(people);
  }
});
