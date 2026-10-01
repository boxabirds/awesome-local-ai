// Story 12, end to end: dropping pictures onto the board.
//
// TC-25 is the story's promise in one line - one person drops files, another person sees them -
// and it is timed, because "in sync" has a number next to it. TC-26 is the file picker's mixed
// bag: one file that will do and two that will not, and whether the board says so in the words the
// design chose. TC-27 is what a picture is made of under a resize: the box changes, the
// proportions do not, and both come back on the next visit. TC-28 is an upload that fails and
// then, on the same page that never reloaded, succeeds.
//
// Everything here goes through real files: each one is drawn by the browser under test and handed
// back, so what the board is given is a file that browser itself agreed to write. What a picture
// is *in* is read from the shared document (through the test hook) as well as from the paint,
// because a promise about another person's screen is a promise about the document. Delivery times
// are written into the log and never asserted, the way story 3 agreed to it.

import { expect, test, type Page } from '@playwright/test';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { pdfBytes } from '../fixtures/image-bytes';
import type { Point } from './helpers/board';
import { createBoard } from './helpers/board';
import { openBoard } from './helpers/live';
import {
  aFile,
  anAcceptedPicture,
  answerPicker,
  assetUrl,
  BOARD_POINT,
  dropHighlight,
  dropPictures,
  dragPicturesOver,
  imageToolButton,
  picture,
  pictureBoxes,
  pictureCards,
  pictureDifference,
  pictureIsSelected,
  pictureStates,
  pictureWords,
  retryButton,
  theOnly,
  toastLines,
  waitForPictures,
  waitForPicturesMatch,
  waitForPictureStatus,
  waitForUploadable,
  watchPicturePickers,
  slowTheWayToTheBytes,
  type Picture,
  type PictureState,
} from './helpers/images';

/**
 * Whether a picture is drawn as a picture: an image on screen, filling the box the document says
 * it has, at the proportions its own file has.
 */
async function drawnAsPicture(page: Page, image: PictureState): Promise<boolean> {
  const card = page.locator(`[data-testid="image-object"][data-image-id="${image.id}"]`);
  const frame = card.getByTestId('image-picture');
  if (!(await frame.isVisible())) return false;
  const painted = await frame.boundingBox();
  const box = await card.boundingBox();
  if (painted === null || box === null) return false;
  return (
    Math.abs(painted.width - image.width) <= 1 &&
    Math.abs(painted.height - image.height) <= 1 &&
    Math.abs(painted.width / painted.height - image.width / image.height) <= 0.01
  );
}

interface Served {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  sniffing: string | null;
}

/** The bytes behind a picture, as the board's own file service answers for them. */
async function servedAs(page: Page, image: PictureState): Promise<Served> {
  if (image.assetKey === null) throw new Error(`picture ${image.id} has no bytes to serve`);
  const response = await page.request.get(assetUrl(image.assetKey));
  const headers = response.headers();
  return {
    status: response.status(),
    contentType: headers['content-type'] ?? null,
    cacheControl: headers['cache-control'] ?? null,
    sniffing: headers['x-content-type-options'] ?? null,
  };
}

/** Drag a picture's resize handle by a screen delta, the way a mouse does it. */
async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
  if (box === null) throw new Error(`the ${handle} handle is not on screen`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 8 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
}

/** A file pushed past a size limit by padding it out with more bytes of its own. */
function oversized(bytes: Uint8Array, total: number): Uint8Array {
  const padded = new Uint8Array(total);
  padded.set(bytes, 0);
  return padded;
}

test.describe('dropping pictures', () => {
  test('TC-25 a moodboard two people can see: three screenshots dropped, and the other screen fills in', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const leo = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    // The files can only be handed over once the board is holding onto its room.
    await waitForUploadable(leo);
    // The bytes are slowed rather than the board: the row of boxes waiting for pictures is what
    // this test is about, and on a loopback connection it would otherwise be gone by the time
    // anything asked.
    await slowTheWayToTheBytes(leo);

    // Three files, of three sizes and three formats, so that a board which got one of them wrong
    // cannot pass by having got the others right. The third format is whichever one this browser
    // can really write a file in (WebKit writes PNGs when asked for WebPs): what is being asked of
    // the board is the same either way, and Chromium and Firefox cover WebP end to end.
    const files: Picture[] = [
      await picture(leo, 'png', 900, 600, 'design.png'),
      await picture(leo, 'jpeg', 640, 480, 'whiteboard.jpg'),
      await anAcceptedPicture(leo, 400, 400),
    ];
    expect(new Set(files.map((file) => file.mimeType)).size, 'three files, three formats').toBe(3);

    // Files carried over the board hold the board out to them; let go and the board takes them.
    await dragPicturesOver(leo, BOARD_POINT, files);
    await expect(dropHighlight(leo)).toBeVisible();
    const droppedAt = Date.now();
    await dropPictures(leo, BOARD_POINT, files);
    await expect(dropHighlight(leo)).toBeHidden();

    // The drop is accepted before a single byte has arrived: three boxes, in a row, waiting for
    // their pictures, and the row is where the file was let go.
    const waiting = await waitForPictureStatus(leo, 'uploading', 3);
    expect(waiting).toHaveLength(3);
    expect(await pictureCards(leo)).toHaveCount(3);

    // On the other screen the same three boxes appear out of nowhere, each already knowing how
    // big its picture will be - which is the only thing a person there can be told meanwhile.
    const appearing = await waitForPictures(sam, 3);
    const latency = Date.now() - droppedAt;
    console.log(
      `[latency] TC-25 drop to three pictures on a second screen: ${latency}ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms; reported, not asserted)`,
    );
    for (const image of appearing) {
      expect(image.naturalWidth).toBeGreaterThan(0);
      expect(image.naturalHeight).toBeGreaterThan(0);
    }

    // Then the bytes land, on both screens, and the boxes become pictures.
    const ready = await waitForPictureStatus(leo, 'ready', 3);
    await waitForPicturesMatch(leo, sam);
    const onSam = await pictureStates(sam);
    expect(onSam).toHaveLength(3);

    for (const image of onSam) {
      const file = files.find((candidate) => candidate.mimeType === image.contentType);
      if (file === undefined) throw new Error(`a picture arrived as ${image.contentType}`);
      // The file's own measurements, on the far screen, from bytes nobody there ever saw.
      expect(image.naturalWidth).toBe(file.width);
      expect(image.naturalHeight).toBe(file.height);
      // Drawn in the box the document gives it, and at the file's proportions.
      expect(await drawnAsPicture(sam, image)).toBe(true);
    }

    // The row is the same row: same places, same sizes, in the order the files came.
    expect(onSam.map((image) => [image.x, image.y])).toEqual(
      (await pictureStates(leo)).map((image) => [image.x, image.y]),
    );
    expect(onSam.map((image) => image.status)).toEqual(['ready', 'ready', 'ready']);

    // And the bytes behind them: handed out under the type they came as, marked as never changing,
    // and never second-guessed into a different type by the browser that fetches them.
    for (const image of ready) {
      const served = await servedAs(sam, image);
      expect(served.status).toBe(200);
      expect(served.contentType).toBe(image.contentType);
      expect(served.cacheControl).toContain(`max-age=${ASSET_CACHE_MAX_AGE_SECONDS}`);
      expect(served.cacheControl).toContain('immutable');
      expect(served.sniffing).toBe('nosniff');
    }

    await leo.close();
    await sam.close();
  });

  test('TC-26 the picker takes one file and turns down two, in the words the board chose', async ({
    page,
    request,
  }) => {
    const boardId = await createBoard(request);
    // Listening for the dialog before the page is even opened: see `watchPicturePickers`.
    watchPicturePickers(page);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForUploadable(page);

    const good = await anAcceptedPicture(page, 500, 250);
    // A PDF wearing a picture's name, and a photograph too big for a board to take in.
    const renamed = aFile('invoice.png', 'application/pdf', pdfBytes());
    const tooBig = aFile(
      'holiday.jpg',
      'image/jpeg',
      oversized(good.bytes, IMAGE_MAX_BYTES + 1_000_000),
    );

    // `i` opens the picker, the way a person hunting for a way in would expect, and the chooser
    // is answered with all three at once.
    await answerPicker(page, () => page.keyboard.press('i'), [renamed, good, tooBig]);

    // One picture in, from the middle of the view, and the tool back where the pointer is useful.
    // Waited for as a picture rather than as a box: what is being looked at is the paint, and the
    // paint only becomes a picture once the bytes have arrived.
    const added = theOnly(await waitForPictureStatus(page, 'ready', 1));
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    expect(await pictureCards(page)).toHaveCount(1);
    expect(await drawnAsPicture(page, added)).toBe(true);

    // Both refusals are said, in the board's own words, and each one once.
    const said = await toastLines(page);
    expect(said.filter((line) => line === REJECTION_MESSAGES.type)).toHaveLength(1);
    expect(said.filter((line) => line === REJECTION_MESSAGES.size)).toHaveLength(1);

    // The refusals are about two files rather than about the batch: the good file came through as
    // itself, and nothing of the other two ever reached the board.
    const only = theOnly(await waitForPictureStatus(page, 'ready', 1));
    expect(only.contentType).toBe(good.mimeType);
    expect(only.naturalWidth).toBe(500);
    expect(only.naturalHeight).toBe(250);

    // The toolbar's own door does the same thing, and thinking better of it changes nothing.
    await answerPicker(page, () => imageToolButton(page).click(), []);
    expect(await pictureCards(page)).toHaveCount(1);
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-27 a picture squeezed and stretched keeps its proportions and its place', async ({
    page,
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await waitForUploadable(page);

    // Proportions that are awkward on purpose: 3 to 2 can be hit by accident, 10 to 3 cannot.
    const file = await picture(page, 'png', 1000, 300, 'panorama.png');
    // Dropped where the whole box and its bottom-right corner are inside the window. A mouse that
    // is pointed at a handle which is off the edge of the screen is pointing at nothing.
    const CORNER_OF_VIEW: Point = { x: 300, y: 200 };
    await dropPictures(page, CORNER_OF_VIEW, [file]);
    const placed = theOnly(await waitForPictures(page, 1));
    const natural = placed.naturalWidth / placed.naturalHeight;
    expect(natural).toBeCloseTo(10 / 3, 3);
    // A drop is placed inside the biggest box a drop is allowed to make.
    expect(placed.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD + 1);
    expect(placed.width / placed.height).toBeCloseTo(natural, 3);

    // A picture is resized by whoever is looking at it, and looking at it starts with pointing at
    // it - once it is a picture on the screen, which is not the moment the box first appears.
    // The board gives a picture's box the eight handles of a box, corners along with sides,
    // because what is being held is a picture and not a paragraph.
    theOnly(await waitForPictureStatus(page, 'ready', 1));
    const [paint] = await pictureBoxes(page);
    if (paint === undefined) throw new Error('the picture is not painted');
    await page.mouse.click(paint.x + paint.width / 2, paint.y + paint.height / 2);
    // The press reached the picture, rather than going through it to the board behind.
    expect(await pictureIsSelected(page, placed.id)).toBe(true);
    await expect(page.getByTestId('resize-handle-se')).toBeVisible();

    // Squeezed from the bottom-right corner, a long way past anything a board holds. The pointer
    // stops short of the window's top-left for the same reason it started inside the window.
    await dragHandle(page, 'se', -800, -300);
    const squeezed = theOnly(await pictureStates(page));
    expect(
      squeezed.width / squeezed.height,
      `squeezing moved the picture off its proportions (${squeezed.width}x${squeezed.height})`,
    ).toBeCloseTo(natural, 2);
    const shorter = Math.min(squeezed.width, squeezed.height);
    expect(shorter, 'the squeeze did not have to stop anywhere').toBeLessThanOrEqual(
      IMAGE_MIN_SIZE_WORLD + 1,
    );
    expect(shorter).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
    // The corner that was not grabbed held still.
    expect(squeezed.x).toBeCloseTo(placed.x, 1);
    expect(squeezed.y).toBeCloseTo(placed.y, 1);

    // And stretched back out: far enough that the difference between a picture and a squash is
    // obvious, near enough that the handle stays under the pointer the whole way.
    await dragHandle(page, 'se', 400, 120);
    const stretched = theOnly(await pictureStates(page));
    expect(stretched.width / stretched.height).toBeCloseTo(natural, 2);
    expect(stretched.width).toBeGreaterThan(squeezed.width);
    expect(stretched.height).toBeGreaterThan(squeezed.height);

    // The picture as painted agrees with the picture as written down.
    const [box] = await pictureBoxes(page);
    if (box === undefined) throw new Error('the picture is not painted');
    expect(box.width).toBeCloseTo(stretched.width, 1);
    expect(box.height).toBeCloseTo(stretched.height, 1);

    // A second visit, in a browser that has never seen this board: the picture is still there,
    // still the size it was left at, with its bytes still behind it.
    const visitor = await openBoard(browser, boardId);
    const remembered = theOnly(await waitForPictures(visitor, 1));
    expect(remembered.id).toBe(placed.id);
    expect(remembered.width).toBeCloseTo(stretched.width, 1);
    expect(remembered.height).toBeCloseTo(stretched.height, 1);
    expect(remembered.width / remembered.height).toBeCloseTo(natural, 2);
    expect((await servedAs(visitor, remembered)).status).toBe(200);
    await expect(visitor.getByTestId('image-picture')).toBeVisible();

    await visitor.close();
  });

  test('TC-28 an upload that fails says so, and the Retry beside it brings the picture in', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const leo = await openBoard(browser, boardId);
    const sam = await openBoard(browser, boardId);
    await waitForUploadable(leo);

    // The way is blocked before the file is even held up, so that what fails is the network and
    // nothing the file did.
    await leo.route('**/api/boards/*/assets', (route) => route.abort());
    const file = await picture(leo, 'png', 700, 500, 'moodboard.png');
    await dropPictures(leo, { x: 500, y: 380 }, [file]);

    const stuck = theOnly(await waitForPictureStatus(leo, 'failed', 1));
    expect(stuck.assetKey).toBeNull();
    await expect(leo.getByTestId('image-failed')).toBeVisible();
    expect(await pictureWords(leo, 0)).toBe('Upload failed');
    await expect(retryButton(leo, 0)).toBeVisible();

    // The other screen knows a picture was asked for, and does not pretend it has one. A person
    // there is not offered a retry, because it is not their upload to retry.
    const onSam = theOnly(await waitForPictures(sam, 1));
    expect(onSam.id).toBe(stuck.id);
    expect(pictureDifference([stuck], [onSam])).toBe('');
    await expect(sam.getByTestId('image-retry')).toHaveCount(0);

    // The way opens, and the person who dropped the file asks for it to go again.
    await leo.unroute('**/api/boards/*/assets');
    await retryButton(leo, 0).click();
    await waitForPictureStatus(leo, 'ready', 1);

    // And it arrives on both screens, with bytes behind it - on a page that never reloaded, on a
    // board that was never recreated.
    await waitForPicturesMatch(leo, sam);
    const arrived = theOnly(await pictureStates(sam));
    expect(arrived.assetKey).not.toBeNull();
    expect((await servedAs(sam, arrived)).status).toBe(200);
    await expect(sam.getByTestId('image-picture')).toBeVisible();
    // A picture that arrived says nothing about having once failed to arrive.
    await expect(sam.getByTestId('image-failed')).toHaveCount(0);

    await leo.close();
    await sam.close();
  });
});
