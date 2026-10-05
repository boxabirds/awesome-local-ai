/**
 * e2e tests for pictures dropped onto the board (story 12, TC-25 to TC-28).
 *
 * These four are here because the story is about bytes arriving. Everything that can be decided from a document —
 * that a file of the wrong kind is refused, that three files become a row of three, that an upload that never came
 * back says so after five minutes — is decided in a unit or component test against a model, where it is decided once
 * and cheaply. What cannot be decided there is whether a picture that was dragged out of a page into a Worker and
 * stored in an object store comes back as the same picture, drawn by a browser that was never the one that read the
 * file: the four formats, the upload's progress, the address the bytes are stored under and the `<img>` at the end of
 * it are the thing, and they only exist between a page and a server.
 *
 * So the files here are real. Three of them are committed in `tests/fixtures/images` — a JPEG, a GIF and a WebP, in
 * the formats nobody can write out by hand — and the rest are made there from a PNG encoder, at the sizes each test
 * is about. They are carried into the page as files in a `DataTransfer` and dropped, or handed to the file window the
 * board opens, which is also how the board's `i` key and its toolbar button get tested: both are expected to open a
 * window, and Playwright is the one that answers it.
 *
 * Positions are asserted in two currencies. What is stored is in board units and is compared exactly, because it is
 * arithmetic; what is painted is in screen pixels and is compared through the page's own camera, to within
 * `TOLERANCE_PX`, because it is a browser laying out a box.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import type { ImageSnap } from '../../src/shared/objects/image';
import { board, expectPixels, screenToWorld, settled, worldToScreen } from './helpers/board';
import type { Point } from './helpers/board';
import {
  aimCamera,
  closeParticipants,
  openParticipant,
  openParticipants,
  who,
} from './helpers/participants';
import type { Participant } from './helpers/participants';
import { resizeSelected } from './helpers/shapes';
import {
  GIF,
  PHOTO,
  PORTRAIT,
  RENAMED_PDF,
  SCREENSHOT,
  SMALL,
  TOO_BIG,
  WEBP,
} from '../fixtures/images';
import {
  assetResponse,
  carryAwayFromBoard,
  carryOverBoard,
  dropIsOffered,
  dropPictures,
  dropPicturesAndAwait,
  expectFileWindow,
  expectPaintedMatches,
  imageElement,
  imageElements,
  imageMessage,
  imageMessages,
  imageOnPage,
  imagePercent,
  imagesOnPage,
  paintedBox,
  paintedRatio,
  toastTexts,
  waitForImageCount,
  waitForImageStatus,
  waitForPictureDrawn,
} from './helpers/images';

/** The board's own upload address, as a route pattern. One door, and TC-28 is about closing it. */
const UPLOAD_ROUTE = '**/api/boards/*/assets';

/**
 * How long TC-25 holds an upload open.
 *
 * A placeholder exists for as long as the bytes are travelling, and these files travel a few hundred kilobytes
 * across a loopback interface, which is to say instantaneously. Without a hold there is no window in which to see
 * the state the whole feature is there to explain, and the test would pass by arriving late and calling it a
 * picture. Three seconds is long enough to read three boxes and say what is in them, and short enough that nobody
 * waiting for the end of the test notices.
 */
const UPLOAD_HOLD_MS = 3_000;

/** Where TC-25 releases its files, in board units, with the camera at the origin and 100%. */
const DROP_AT: Point = { x: 60, y: 120 };

/** Where TC-27 drops a photograph it intends to resize: fully on screen, with room to grow into. */
const PHOTO_AT: Point = { x: 120, y: 100 };

/**
 * What a page's console is allowed to say when a test is deliberately breaking something.
 *
 * A refused upload is a failed request, and a failed request is something a browser complains about in the console
 * — along with the board's own line about the upload having failed, which is the reason the status on the wire is
 * logged as well as the status on the board. Neither is a board that does not work; anything else in there is.
 */
const EXPECTED_COMPLAINT = /net::ERR_|Failed to load resource|image upload failed/;

function unexplained(participant: Participant): string[] {
  return participant.errors.filter((line) => !EXPECTED_COMPLAINT.test(line));
}

/** The middle of what this page is showing, in board units — which is where a picture with no position goes. */
async function viewCentreOf(page: Page): Promise<Point> {
  const camera = await settled(page);
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  return screenToWorld(camera, { x: size.width / 2, y: size.height / 2 });
}

/** Point at the middle of a picture with the Select tool, which is how it gets picked up. */
async function selectPicture(page: Page, image: ImageSnap): Promise<void> {
  const camera = await settled(page);
  const centre = worldToScreen(camera, { x: image.x + image.width / 2, y: image.y + image.height / 2 });
  await page.mouse.click(centre.x, centre.y);
  await expect(page.locator('[data-testid="resize-handle-se"]')).toBeVisible();
}

test('TC-25: three files dropped on the board are three pictures, and everybody sees all of them', async ({
  browser,
}) => {
  const [alex, sam] = await openParticipants(browser, 2);
  try {
    await Promise.all([aimCamera(alex, { x: 0, y: 0, zoom: 1 }), aimCamera(sam, { x: 0, y: 0, zoom: 1 })]);

    // Hold the door the bytes go through open for a moment, so that the state in between can be looked at.
    await alex.page.route(UPLOAD_ROUTE, async (route) => {
      await new Promise((resolveWait) => setTimeout(resolveWait, UPLOAD_HOLD_MS));
      await route.continue().catch(() => undefined);
    });

    const since = Date.now();

    // Carried over the board first, and then taken away again, without ever being let go. The board is expected to
    // answer a carry with an offer — a highlight that says files may be released here — and to take the offer back
    // when they are not. This is the drag in a real browser, with a real `DataTransfer` in a real `DragEvent`.
    await carryOverBoard(alex.page, [SCREENSHOT]);
    expect(await dropIsOffered(alex.page), 'carrying files over the board offers to take them').toBe(true);
    expect(await imagesOnPage(alex.page), 'and offers create nothing on the board').toEqual([]);
    await carryAwayFromBoard(alex.page);
    expect(await dropIsOffered(alex.page), 'carrying them away takes the offer back').toBe(false);

    await dropPictures(alex.page, DROP_AT, [SCREENSHOT, PORTRAIT, GIF]);
    expect(await dropIsOffered(alex.page), 'the offer ends when the files are let go').toBe(false);

    // Three boxes on the page that dropped them, and three on the other person's page. The boxes are there before
    // the bytes are: the board is telling everybody that three pictures are on their way, and the person who
    // dropped them is not the only one who gets to know.
    await expect(imageElements(alex.page)).toHaveCount(3);
    await expect(imageElements(sam.page)).toHaveCount(3);
    const ids = await waitForImageCount(alex.page, 3);
    const [screenshotId, , gifId] = ids as [string, string, string];

    // Every box says it is uploading, on both pages, in the same words.
    for (const id of ids) {
      expect(await imageElement(alex.page, id).getAttribute('data-image-status'), 'the dropper’s own boxes').toBe(
        'uploading',
      );
      expect(await imageElement(sam.page, id).getAttribute('data-image-status'), 'the same boxes on the other board').toBe(
        'uploading',
      );
    }
    expect(await imageMessages(sam.page), 'every box says what it is doing').toEqual([
      'Uploading…',
      'Uploading…',
      'Uploading…',
    ]);

    // How far along is only known by the tab that has the file. The other person is told a picture is coming, and
    // is not told a percentage the board has no way of knowing.
    expect(await imagePercent(sam.page, screenshotId), 'a percentage belongs to the tab that is uploading').toBeNull();
    expect(
      await sam.page.locator('[data-testid="image-object-progress"]').count(),
      'and so does its progress bar',
    ).toBe(0);

    // Where they went: a row, tops in a line, starting at the point the files were released, each picture at the
    // size its own pixels and the board's largest-placeable-size allow. These are arithmetic, so they are compared
    // exactly.
    const [screenshot, portrait, gif] = await Promise.all(ids.map((id) => imageOnPage(alex.page, id)));
    expect(screenshot.y, 'one row').toBe(portrait.y);
    expect(portrait.y).toBe(gif.y);
    expect(screenshot.y, 'starting where the files were let go').toBeCloseTo(DROP_AT.y, 6);
    expect(screenshot.x, 'starting where the files were let go').toBeCloseTo(DROP_AT.x, 6);

    expect(screenshot.naturalWidth, 'the file’s own pixels').toBe(1440);
    expect(screenshot.naturalHeight).toBe(900);
    expectPixels(screenshot.width, IMAGE_MAX_PLACE_SIZE_WORLD, 'a picture bigger than the limit is placed at the limit');
    expectPixels(
      screenshot.height,
      (900 / 1440) * IMAGE_MAX_PLACE_SIZE_WORLD,
      'and the other side follows the picture’s own proportions',
    );

    expectPixels(portrait.width, (600 / 900) * IMAGE_MAX_PLACE_SIZE_WORLD, 'a portrait is capped by its tallest side');
    expectPixels(portrait.height, IMAGE_MAX_PLACE_SIZE_WORLD, 'which here is the height');
    expectPixels(gif.width, 320, 'a picture smaller than the limit is placed at its own size');
    expectPixels(gif.height, 200, 'at both sizes');

    // What a placeholder is while the bytes are held back: the kind the browser said, the picture's own size, and no
    // address, because nothing has been stored yet.
    expect(screenshot).toMatchObject({ type: 'image', status: 'uploading', contentType: 'image/png', naturalWidth: 1440, naturalHeight: 900 });
    expect(screenshot.assetKey, 'nothing is stored while the bytes are still going').toBeNull();

    expectPixels(
      portrait.x - (screenshot.x + screenshot.width),
      IMAGE_LAYOUT_GAP_WORLD,
      'the gap between the first picture and the second is one grid cell',
    );
    expectPixels(gif.x - (portrait.x + portrait.width), IMAGE_LAYOUT_GAP_WORLD, 'and the same gap again');

    // Sam's copy of the first box is painted where Sam's camera says that box is: the same board units, on a
    // different screen.
    await expectPaintedMatches(sam.page, screenshot, 1.5, 'a placeholder is painted where the picture will be');

    // Now let the bytes through, and wait for each of the three to say it has arrived on the *other* person's
    // board. The elapsed time is written into the run against nothing at all: this machine is running the browser,
    // the Worker, the object store and both documents, and a slow machine is not a slow board.
    for (const id of ids) {
      await waitForImageStatus(sam.page, id, 'ready', { since });
    }

    // The record: three pictures, every one of them stored, under an address of this board's, with the dimensions
    // the files came with and the type the bytes turned out to be.
    const settledImages = await imagesOnPage(sam.page);
    expect(
      settledImages.map((image) => ({
        status: image.status,
        contentType: image.contentType,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
      'all three arrived',
    ).toEqual([
      { status: 'ready', contentType: 'image/png', naturalWidth: 1440, naturalHeight: 900 },
      { status: 'ready', contentType: 'image/png', naturalWidth: 600, naturalHeight: 900 },
      { status: 'ready', contentType: 'image/gif', naturalWidth: 320, naturalHeight: 200 },
    ]);
    for (const image of settledImages) {
      expect(image.assetKey, 'every picture is stored under an address of this board').toMatch(ASSET_KEY_PATTERN);
      expect(
        image.assetKey?.startsWith(`${alex.boardId}/`),
        'and the address begins with the board it belongs to, which is what keeps two boards apart',
      ).toBe(true);
    }

    // The strongest thing here, and the reason the files are real: a browser that has never seen these bytes
    // before is sent to an address and draws a picture out of what comes back. The width is the file's own pixel
    // width, so the bytes came through whole and are a GIF and not a description of one.
    const drawn = await waitForPictureDrawn(sam.page, gifId);
    expect(drawn.naturalWidth, 'the GIF Sam is shown is 320 pixels of GIF').toBe(320);
    expect(drawn.naturalHeight).toBe(200);
    expect(drawn.src, 'the picture is fetched from this board’s own address').toBe(
      `/api/assets/${settledImages[2]?.assetKey}`,
    );

    // What the board said when those bytes were asked for. A stored picture is never rewritten — the key is made
    // when the upload is accepted and nothing after that changes what sits under it — so the answer is allowed to
    // say it may be kept for a year without being asked again, which is what a browser should do with a picture
    // that stays on the board for the rest of the board's life.
    const served = await assetResponse(sam.page, settledImages[2]?.assetKey as string);
    expect(served.status, 'the address of a picture that is drawn answers with the picture').toBe(200);
    expect(served.contentType, 'and says what kind of picture it is, from what was stored').toBe('image/gif');
    expect(served.cacheControl, 'the bytes may be kept without asking again').toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );

    // Two pages, one board: the pictures agree, field by field.
    expect(await imagesOnPage(sam.page), 'both people hold the same pictures').toEqual(await imagesOnPage(alex.page));

    // A board that took three pictures has taken nothing else: no half-uploads left behind, and no message about
    // any of it beyond what is in the boxes.
    expect((await imagesOnPage(alex.page)).length, 'three pictures, and no extras').toBe(3);
    for (const participant of [alex, sam]) {
      expect(unexplained(participant), `${who(participant)}’s console said nothing bad`).toEqual([]);
    }
  } finally {
    await closeParticipants([alex, sam]);
  }
});

test('TC-26: the file window takes what the board takes and refuses the rest, saying each thing once', async ({
  browser,
}) => {
  const [alex] = await openParticipants(browser, 1);
  try {
    await aimCamera(alex, { x: 0, y: 0, zoom: 1 });
    const since = Date.now();

    // `i` asks for a picture. It does not arm a tool — a picture is not a mode you draw in — and what it does
    // instead is open a file window, which is the only thing a browser is allowed to open in answer to a key.
    // The key is pressed on the board itself rather than at the page: a picture is asked for while the board has
    // the keyboard, which is also how a person does it, and a key sent to a page that is not looking is a key that
    // goes nowhere.
    const window = expectFileWindow(alex.page, 'the i key');
    await board(alex.page).press('i');
    await window.answer([SMALL, RENAMED_PDF, TOO_BIG]);

    const ids = await waitForImageCount(alex.page, 1, 15_000);
    const [smallId] = ids as [string];
    await waitForImageStatus(alex.page, smallId, 'ready', { since });

    const small = await imageOnPage(alex.page, smallId);
    expect(small.contentType, 'the one file the board took was the PNG').toBe('image/png');
    expectPixels(small.width, 320, 'and it is 320x200, placed at its own size');
    expectPixels(small.height, 200);

    // A picture chosen from a window has no position to be dropped at, so it is put where the person is looking.
    const middle = await viewCentreOf(alex.page);
    expectPixels(
      small.x + small.width / 2,
      middle.x,
      'the middle of the chosen picture is the middle of the part of the board being looked at',
    );
    expectPixels(small.y + small.height / 2, middle.y, 'in both directions');

    // The other two files were refused, and each refusal is said once. The order is the order the board learns
    // things: the size is known before the file is so much as opened, and the wrong kind only becomes known when
    // the decoder is handed bytes that are not a picture whatever the window called it.
    const said = await toastTexts(alex.page);
    expect(said, 'both refusals, and nothing else').toEqual([
      REJECTION_MESSAGES.size,
      REJECTION_MESSAGES.type,
    ]);

    // The toolbar offers the same window as the key does — the same input, the same files.
    const anotherWindow = expectFileWindow(alex.page, 'the toolbar button');
    await alex.page.getByTestId('add-image').click();
    await anotherWindow.answer([WEBP]);
    const both = await waitForImageCount(alex.page, 2, 15_000);
    const webpId = both[1] as string;
    await waitForImageStatus(alex.page, webpId, 'ready', { since });

    const webp = await imageOnPage(alex.page, webpId);
    expect(webp.contentType, 'the board takes WebP, which is one of the four it says it takes').toBe('image/webp');
    expect(webp.naturalWidth, 'the file’s own 640 pixels').toBe(640);
    expect(webp.assetKey, 'stored where the board keeps its pictures').toMatch(ASSET_KEY_PATTERN);

    const drawnWebp = await waitForPictureDrawn(alex.page, webpId);
    expect(drawnWebp.naturalWidth, 'and drawn: a browser decoded the WebP that came back').toBe(640);

    // Nothing is left half-done: two pictures, both arrived, and the board's console quiet.
    expect(
      (await imagesOnPage(alex.page)).map((image) => image.status),
      'every picture on the board finished',
    ).toEqual(['ready', 'ready']);
    expect(await paintedRatio(alex.page, webpId), 'placed at the file’s own proportions').toBeCloseTo(640 / 480, 4);
    expect(unexplained(alex), `${who(alex)}’s console said nothing bad`).toEqual([]);
  } finally {
    await closeParticipants([alex]);
  }
});

test('TC-27: a picture resized by its corner keeps its proportions, stops at the smallest the board allows, and is still there when the board is opened again', async ({
  browser,
}) => {
  const [alex] = await openParticipants(browser, 1);
  try {
    await aimCamera(alex, { x: 0, y: 0, zoom: 1 });
    const { ids } = await dropPicturesAndAwait(alex.page, PHOTO_AT, [PHOTO]);
    const id = ids[0] as string;
    const placed = await imageOnPage(alex.page, id);
    expectPixels(placed.width, 800, 'a 1600x900 photograph is placed 800 units wide');
    expectPixels(placed.height, 450, 'and 450 units tall');

    const proportion = placed.width / placed.height;
    expect(proportion, 'the box starts at the photograph’s own proportions').toBeCloseTo(1600 / 900, 4);

    await selectPicture(alex.page, placed);

    // Grow it by the bottom-right corner. The pointer travels further sideways than downwards, which is the axis
    // the drag is aiming along, and the other side follows it: an image is not a rectangle that can be squashed.
    await resizeSelected(alex.page, 'se', { x: 120, y: 30 });

    const grown = await imageOnPage(alex.page, id);
    expectPixels(grown.width, placed.width + 120, 'the box grew by what the handle was dragged');
    expect(
      await paintedRatio(alex.page, id),
      'and the picture on the screen is still the same shape it has always been',
    ).toBeCloseTo(proportion, 2);
    expect(grown.width / grown.height, 'the stored box as well as the painted one').toBeCloseTo(proportion, 4);

    // Shrink it again, comfortably above the floor.
    await resizeSelected(alex.page, 'se', { x: -220, y: -60 });
    const shrunk = await imageOnPage(alex.page, id);
    expect(shrunk.width, 'smaller than it was').toBeLessThan(grown.width);
    expect(
      await paintedRatio(alex.page, id),
      'still the same shape, on the way down as well as on the way up',
    ).toBeCloseTo(proportion, 2);

    // Now drag it far past the floor the board gives a picture. The box stops there — a box of no width cannot be
    // drawn, hit or resized, and one two units across is not much better. Which axis reaches the floor first is
    // the board's clamp and not the picture's business; the picture's own proportions are in the file, unchanged,
    // and that is what the next resize will be measured against again.
    await resizeSelected(alex.page, 'se', { x: -4_000, y: -4_000 });
    const floor = await imageOnPage(alex.page, id);
    expect(
      floor.width,
      `the box stops at the smallest the board allows (${IMAGE_MIN_SIZE_WORLD} units) and does not go past it`,
    ).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(floor.height, 'in both directions').toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(
      { width: floor.naturalWidth, height: floor.naturalHeight },
      'the picture itself is untouched by having been squeezed',
    ).toEqual({ width: 1600, height: 900 });

    // Close the board and open it again from another browser. The picture is on the board because it is in the
    // board: the box it was left in travels with it, and the bytes come back out of the object store.
    const grace = await openParticipant(browser, alex.boardId, 'Grace');
    try {
      await aimCamera(grace, { x: 0, y: 0, zoom: 1 });
      await expect(imageElements(grace.page)).toHaveCount(1);
      const reopened = await imageOnPage(grace.page, id);
      expect(reopened.status, 'the picture is there, arrived, for somebody who was not here for any of it').toBe(
        'ready',
      );
      expect({ width: reopened.width, height: reopened.height }, 'in the box it was left in').toEqual({
        width: floor.width,
        height: floor.height,
      });
      await expectPaintedMatches(grace.page, reopened, 1.5, 'and it is painted in that box');
      const drawn = await waitForPictureDrawn(grace.page, id);
      expect(drawn.naturalWidth, 'with the photograph itself behind it, whole').toBe(1600);
      expect(drawn.naturalHeight).toBe(900);
      expect(unexplained(grace), `${who(grace)}’s console said nothing bad`).toEqual([]);
    } finally {
      await grace.context.close();
    }

    expect(unexplained(alex), `${who(alex)}’s console said nothing bad`).toEqual([]);
  } finally {
    await closeParticipants([alex]);
  }
});

test('TC-28: an upload that cannot get out is said, retried, and finishes; the other person is told it is unavailable rather than left guessing', async ({
  browser,
}) => {
  const [alex, sam] = await openParticipants(browser, 2);
  try {
    await Promise.all([aimCamera(alex, { x: 0, y: 0, zoom: 1 }), aimCamera(sam, { x: 0, y: 0, zoom: 1 })]);

    // Cut the one road the bytes travel, at the page: the request does not reach the Worker at all. This is not
    // the board refusing a file and not the object store failing on the way in — both of those have their own
    // tests — this is a laptop on a train.
    await alex.page.route(UPLOAD_ROUTE, (route) => route.abort('failed'));

    await dropPictures(alex.page, { x: 80, y: 80 }, [GIF]);
    const [id] = await waitForImageCount(alex.page, 1, 15_000);

    // The box says what happened, in the words the board uses for it, and offers the one thing that can still
    // work: try again.
    await expect(imageElement(alex.page, id as string)).toHaveAttribute('data-image-status', 'failed');
    expect(await imageMessage(alex.page, id as string), 'the box says it failed, not that it is uploading').toBe(
      'Upload failed',
    );
    const retry = alex.page.getByRole('button', { name: 'Retry' });
    await expect(retry, 'the person who has the file is offered another go').toBeVisible();

    // The other person sees a picture that is not there. Not a progress bar, because nothing is on its way; not
    // "failed", because it is not their upload and there is no retry in their tab that could do anything — the
    // file was never in it. They are told the picture is unavailable, and if they want it off the board they take
    // it off the way they take anything else off.
    await expect(imageElement(sam.page, id as string)).toHaveAttribute('data-image-status', 'unavailable');
    expect(await imageMessage(sam.page, id as string), 'the words on the other board').toBe('Image unavailable');
    expect(
      await sam.page.locator(`[data-image-id="${id}"]`).getByRole('button').count(),
      'no Retry, and no Remove on somebody else’s failed upload',
    ).toBe(0);

    // Nothing was stored by the attempt that failed: the picture has no address yet.
    const abandoned = await imageOnPage(alex.page, id as string);
    expect(abandoned.assetKey, 'a picture whose bytes never arrived has nowhere they are kept').toBeNull();

    // Mend the road and press Retry. The same file is used — the one this tab has been holding since the drop —
    // so the picture keeps its place, its size and its position in the stack, and only its state changes.
    await alex.page.unroute(UPLOAD_ROUTE);
    // Slow enough this time to be seen starting: a retry that goes from failed to ready in the time it takes to
    // read the page would prove the file came back but not that anyone was told it was on its way again.
    await alex.page.route(UPLOAD_ROUTE, async (route) => {
      await new Promise((resolveWait) => setTimeout(resolveWait, UPLOAD_HOLD_MS / 2));
      await route.continue().catch(() => undefined);
    });
    await retry.click();

    await expect(imageElement(alex.page, id as string), 'the box goes back to saying it is uploading').toHaveAttribute(
      'data-image-status',
      'uploading',
    );
    expect(await imageOnPage(alex.page, id as string), 'the same picture, not a second one').toMatchObject({
      x: abandoned.x,
      y: abandoned.y,
      width: abandoned.width,
      height: abandoned.height,
      z: abandoned.z,
    });

    await waitForImageStatus(alex.page, id as string, 'ready', { timeoutMs: 20_000 });
    await expect(imageElement(sam.page, id as string)).toHaveAttribute('data-image-status', 'ready', {
      timeout: 20_000,
    });

    const recovered = await imageOnPage(alex.page, id as string);
    expect(recovered.assetKey, 'the retried upload stored its bytes under an address of this board').toMatch(
      ASSET_KEY_PATTERN,
    );
    expect(recovered.assetKey, 'and it is the same board').toContain(`${alex.boardId}/`);
    expect(await imagesOnPage(alex.page).then((images) => images.length), 'one picture, not two').toBe(1);

    // On the other person's screen the photograph is drawn, which is the whole point of the retry: not a state
    // that changed, a picture that arrived.
    const drawn = await waitForPictureDrawn(sam.page, id as string);
    expect(drawn.naturalWidth, 'Sam is looking at 320 pixels of GIF').toBe(320);
    expect(drawn.naturalHeight).toBe(200);
    const box = await paintedBox(sam.page, id as string);
    expectPixels(box.width, recovered.width, 'in the box it was put in at the start');
    expectPixels(box.height, recovered.height);

    // The only things in either console are the failures this test asked for.
    expect(unexplained(alex), 'the refused upload was reported, and nothing else went wrong').toEqual(
      [],
    );
    expect(unexplained(sam), `${who(sam)}’s console said nothing bad`).toEqual([]);
  } finally {
    await closeParticipants([alex, sam]);
  }
});
