/**
 * Dropping pictures on a board, in a browser, with real files.
 *
 * Four things can only be settled in a browser, and they are the four tests below.
 *
 * **A file drag is a browser thing.** The board's drop area reads `DataTransfer.files`, which is a real
 * `FileList` of real files in a real browser and a hand-made object everywhere else; whether the drop point
 * becomes the top-left corner of the first of three pictures, and whether the pictures stand in a row twenty-
 * four units apart, is a question about what a browser hands over and what the board does with it. That is
 * TC-25, which also watches a second person: a placeholder is an ordinary object in the shared document, so
 * the colleague has to be looking at a box of exactly the right size, in exactly the right place, saying
 * "Uploading…" — and then at the picture that replaces it without the box moving.
 *
 * **A file chooser is a browser thing.** `I`, the Image button, the operating system's dialog filtered to the
 * four formats, and a batch in which one file is fine, one is a PDF wearing a `.png` name and one is fifteen
 * megabytes. TC-26 is that batch: one picture arrives, centred in the view, and the line at the bottom of the
 * screen says both of the true things about the files that did not.
 *
 * **A resize is a browser thing.** An aspect ratio is kept by a gesture, not by a formula: TC-27 drags the
 * bottom-right handle of a picture out and back in, checks the proportion is the proportion the file came
 * with, checks the box stops at the smallest it is allowed to be instead of being dragged through the floor,
 * and then opens the same board in a browser that has never seen it, where the picture is still there — which
 * is the only proof in this file that the bytes went somewhere that outlives the tab that uploaded them.
 *
 * **A failure is a browser thing.** TC-28 makes an upload fail at the network layer, which is the only place
 * a real failure can come from: the board's own error handling is unit-tested, but "the person who pressed
 * retry sees a picture and the person who was waiting for it sees the same picture" is a claim about a request
 * that failed and then one that did not.
 *
 * The uploads are made slow or made to fail with the browser's own network layer — a bandwidth dial in
 * TC-25, a refused request in TC-28 — because an upload of a screenshot to a server on the same machine is
 * over in a millisecond, and a state that lasts a millisecond is a state no test can look at. Nothing there
 * changes what the board does or what the server decides; it only stretches the time in which the board's own
 * states are true. Where a browser has no bandwidth dial (Firefox, WebKit), the test holds the response
 * instead, says so in the assertion it skips, and asserts the rest — see {@link slowUploads}.
 *
 * Design matrix: TC-25 (drop a row of three, shared placeholders, immutable cache headers), TC-26 (picker,
 * mixed batch, both refusal messages, centred placement), TC-27 (proportional resize, minimum size, survives
 * a reload in a second browser), TC-28 (failed upload, retry, arrives everywhere).
 */
import { expect, test, type Page } from '@playwright/test';

import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_ACCEPTED_TYPES,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  closeParticipants,
  expectEventually,
  expectNoConsoleErrors,
  logLatency,
  newBoard,
  openBoardAt,
  openParticipant,
  openPersonPage,
  writeLatencyReport,
} from './helpers/participants';
import {
  dragFromPoint,
  handleScreen,
  objectOf,
  objectWorld,
  readCamera,
  screenOfWorld,
  setCamera,
  waitForObjectAtRest,
} from './helpers/board';
import { expectTool } from './helpers/shapes';
import {
  dragFilesTo,
  dropFiles,
  dropHighlight,
  expectToast,
  fileOfBytes,
  imageFixture,
  imageFixtures,
  openPickerWithButton,
  openPickerWithKey,
  pickerFilter,
} from './helpers/drop-files';
import {
  decodedSize,
  expectImageCount,
  failUploads,
  imageIds,
  imageObject,
  imageProgressText,
  imageRemoveButton,
  imageRetryButton,
  imageStatus,
  imageText,
  imagesOnScreen,
  letUploadsThrough,
  picturesVisible,
  pictureSource,
  slowUploads,
  watchPictureRequests,
} from './helpers/images';

/**
 * The words inside a picture's box. They live in `src/client/objects/ImageObject.tsx` as named constants and
 * are pinned word for word there by `tests/component/ImageObject.test.tsx`; they are written out again here
 * because an end-to-end test that imports its strings from the component under test has, in the one place
 * where wording matters most, stopped saying what it expects to see. The component test is the thing that
 * keeps the two honest.
 */
const UPLOADING = 'Uploading…';
const UPLOAD_FAILED = 'Upload failed';
const UNAVAILABLE = 'Image unavailable';

/** How long a picture is given to arrive in TC-25: the link in that test is set to three kilobytes a second. */
const UPLOAD_TIMEOUT = 60_000;

/** The row the three fixtures in TC-25 are placed at: three formats, three natural sizes, one row. */
const SCREENSHOT = { name: 'screenshot.png', width: 800, height: 500 } as const;
const PHOTO = { name: 'photo.jpg', width: 800, height: 500 } as const;
const WEBP = { name: 'picture.webp', width: 320, height: 240 } as const;

/** The world point a screen point falls on, for the camera a page is looking through. */
async function worldOfPoint(page: Page, point: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const camera = await readCamera(page);
  return {
    x: point.x / camera.zoom + camera.x,
    y: point.y / camera.zoom + camera.y,
  };
}

/**
 * The one picture a test is following.
 *
 * Every caller has just asserted how many pictures the board has, so this is not a check the test needed — it
 * is the compiler's `string | undefined` on an array element being turned into a `string` without an `as`,
 * and it says what it thinks rather than pretending when the count it was promised did not happen.
 */
function only(ids: readonly string[], which = 0): string {
  const id = ids[which];
  if (id === undefined) throw new Error(`the board has no picture number ${which + 1} to follow`);
  return id;
}

test.describe('dropping images onto the board', () => {
  // TC-25: one person drops three screenshots; the other person sees three placeholders of the same size in
  // the same places, then three pictures; the row is a row; and the pictures arrive with headers that say
  // they will never change.
  test('three screenshots dropped on a board are pictures on a colleague’s board', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const boardId = newBoard();
    const leo = await openPersonPage(browser, 'Leo');
    await openBoardAt(leo.page, boardId);

    // Slow the uploader's own line down before anything is dropped, so that "uploading" is a state the other
    // person can be looking at rather than one the test has to hope it caught.
    const line = await slowUploads(leo.page);
    const sam = await openParticipant(browser, 'Sam', boardId);
    // Her own responses, watched from before there was anything to watch: a test that started listening after
    // the pictures had arrived would pass on an empty list.
    const watched = watchPictureRequests(sam.page);

    // Three formats, so the row proves the server kept three different content types and the browser decoded
    // three different codecs: two that are too big for this board and are brought down, one that is not.
    const files = await imageFixtures(SCREENSHOT.name, PHOTO.name, WEBP.name);

    // Zoomed out, because three pictures placed at their own size are a row nearly two thousand board units
    // wide — wider than this window at 100 %, and a picture that this browser would have to scroll to is a
    // picture `<img loading="lazy">` is allowed not to have fetched yet. Nothing about the placement depends
    // on the zoom: the assertions below are made in world units, which is what the document stores.
    await setCamera(leo.page, { zoom: 0.5 });
    const dropPoint = { x: 150, y: 240 };
    const dropped = await worldOfPoint(leo.page, dropPoint);

    // The board answers a file in the hand before it is let go: the outline over the whole board is the
    // board's way of saying that a drop here would land here.
    const drag = await dragFilesTo(leo.page, files, dropPoint);
    await expect(dropHighlight(leo.page)).toBeVisible();
    await drag.drop();
    // Let go, and the outline is gone: a frame left standing over a board that has just been given three
    // pictures is a lie about what is still in the hand.
    await expect(dropHighlight(leo.page)).toHaveCount(0);

    const ids = await expectImageCount(leo.page, 3);
    expect(ids).toHaveLength(3);
    const boxes = [];
    for (const id of ids) boxes.push(await objectWorld(leo.page, id));

    // The first picture's top-left corner is where the file was let go, and the rest follow to the right of
    // it with a gap of one file-manager spacing between them, tops level with each other.
    expect(boxes[0]?.x, 'the first picture starts where the drop was').toBeCloseTo(dropped.x, 1);
    expect(boxes[0]?.y).toBeCloseTo(dropped.y, 1);
    expect(boxes[1]?.x).toBeCloseTo((boxes[0]?.x ?? 0) + (boxes[0]?.width ?? 0) + IMAGE_LAYOUT_GAP_WORLD, 1);
    expect(boxes[2]?.x).toBeCloseTo((boxes[1]?.x ?? 0) + (boxes[1]?.width ?? 0) + IMAGE_LAYOUT_GAP_WORLD, 1);
    for (const box of boxes) expect(box.y, 'a row has its tops level').toBeCloseTo(dropped.y, 1);

    // Each box is already its own picture's size: the two big files have been brought down to the largest
    // placement this board allows, in proportion, and the small one has been left exactly as it is — a 320 × 240
    // file is placed at 320 × 240, because a board that enlarged your picture before you had asked would be a
    // board that had decided something about your picture that only the picture knows.
    const biggest: [number, number] = [IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD / (1440 / 900)];
    expect([boxes[0]?.width, boxes[0]?.height], 'a 1440 × 900 screenshot is placed at the largest allowed size').toEqual(
      biggest,
    );
    expect([boxes[1]?.width, boxes[1]?.height], 'and so is a 1440 × 900 photograph').toEqual(biggest);
    expect([boxes[2]?.width, boxes[2]?.height], 'a small file is placed at its own size').toEqual([320, 240]);

    // While the upload is still going, the uploader sees a transfer and everybody else sees a box of the same
    // size with the words "Uploading…" in it, and no percentage — there is no transfer for the board to
    // report a percentage of, and a progress bar borrowed from somebody else's request would be a bar
    // pointing at a number that had nothing to do with this browser.
    const waiting = await expectEventually(
      sam,
      'the three uploads Leo started',
      async () => (await imagesOnScreen(sam.page)).length === 3,
    );
    for (const id of ids) {
      expect(await imageText(sam.page, id), 'the other person is told a picture is coming').toContain(
        UPLOADING,
      );
      expect(await imageProgressText(sam.page, id).count(), 'and only the uploader sees the transfer').toBe(0);
    }
    // The same boxes, the same places, on a screen that never touched the files: a placeholder is an ordinary
    // object in the shared document, which is the entire reason a second person sees a picture coming rather
    // than a board that quietly grew one.
    const samBoxes = [];
    for (const id of ids) samBoxes.push(await objectWorld(sam.page, id));
    expect(samBoxes.map((box) => [box.x, box.y, box.width, box.height])).toEqual(
      boxes.map((box) => [box.x, box.y, box.width, box.height]),
    );

    if (line.reportsProgress) {
      // The uploader's own percentage, from a request that is really taking this long: a number out of a real
      // `XMLHttpRequest` progress event, on a real socket, against a real server.
      const first = await imageProgressText(leo.page, only(ids)).textContent();
      expect(first, 'the uploader is shown how far the upload has got').toMatch(/^Uploading… \d{1,3}%$/);
      await expect(imageObject(leo.page, only(ids)).getByRole('progressbar')).toBeVisible();
      // And it is going somewhere: two looks a third of a second apart on an upload that will take the better
      // part of a second, and the second is not behind the first.
      await leo.page.waitForTimeout(300);
      const later = await imageProgressText(leo.page, only(ids)).textContent();
      expect(Number(/(\d{1,3})%/.exec(later ?? '')?.[1] ?? 0)).toBeGreaterThanOrEqual(
        Number(/(\d{1,3})%/.exec(first ?? '')?.[1] ?? 0),
      );
    } else {
      // This browser has no bandwidth dial, so the request was held instead of slowed — and a request that has
      // been intercepted has not been sent, which is the one thing a percentage is a measurement of. What is
      // asserted here is the uploader's own state on a request that is outstanding; the percentage itself is
      // asserted from the callback in `tests/component/useImageInsert.test.tsx`.
      const own = await imagesOnScreen(leo.page);
      expect(own.map((box) => box.status)).toEqual(['uploading', 'uploading', 'uploading']);
      for (const id of ids) {
        expect(await imageText(leo.page, id)).toContain(UPLOADING);
      }
    }

    // The pictures, on both screens. For Sam this is the whole story of the second half of the feature: her
    // board said "picture coming" and then it has the picture, in the same box, without anything moving.
    //
    // Both waits are Playwright's own polling assertion rather than the suite's `expectEventually`, and that
    // is a thing the latency report needs rather than a thing the assertion needs: `expectEventually` records
    // how long each change took, and the report at the end of a run is there to say something about the live
    // update line — which the time it takes a deliberately crippled link to carry thirty kilobytes says
    // nothing about. The number in the report below is therefore the drop reaching her board as placeholders,
    // which is the part that is the board's work; the timeout here is the one this throttle makes necessary.
    await expect.poll(() => picturesVisible(sam.page), { timeout: UPLOAD_TIMEOUT }).toBe(3);
    await expect.poll(() => picturesVisible(leo.page), { timeout: UPLOAD_TIMEOUT }).toBe(3);
    for (const id of ids) {
      expect(await imageStatus(leo.page, id)).toBe('ready');
      expect(await imageStatus(sam.page, id)).toBe('ready');
    }
    await line.restore();

    // Each picture is the file it came from: the browser decoded it at the file's own pixel size, which is
    // nothing the document stores and nothing but the file's own bytes could have produced.
    expect(await decodedSize(sam.page, only(ids))).toEqual({ width: 1440, height: 900 });
    expect(await decodedSize(sam.page, only(ids, 2))).toEqual({ width: 320, height: 240 });

    // The addresses: three different pictures, under this board's own prefix, and served as things that will
    // never change — which is the only reason a board with forty screenshots on it loads in one visit.
    const keys = [];
    for (const id of ids) {
      const src = await pictureSource(sam.page, id);
      expect(src).not.toBeNull();
      keys.push((src ?? '').replace(/^\/api\/assets\//, '').replace(/http.*\/api\/assets\//, ''));
    }
    expect(new Set(keys).size, 'three files became three different pictures').toBe(3);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/);

    const responses = watched.responses().filter((response) => response.status === 200);
    expect(responses.length, 'her browser fetched the pictures').toBeGreaterThanOrEqual(3);
    const types = new Set(responses.map((response) => response.contentType));
    expect(types, 'the server answered each picture with the type the file really is').toEqual(
      new Set(['image/png', 'image/jpeg', 'image/webp']),
    );
    for (const response of responses) {
      expect(response.cacheControl).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
      expect(response.contentTypeOptions).toBe('nosniff');
      expect(response.contentSecurityPolicy).toBe("default-src 'none'");
      expect(response.etag, 'a picture has a fingerprint of its own').not.toBe('');
    }

    // What it measured, in the report at the end of the run. The number is the drop reaching a second person's
    // board as a placeholder, which is the live update line doing its usual work with a bigger payload than a
    // sticky note carries. It is expected to land inside the board's usual live-update budget and is not
    // asserted to, because the machine running this is not a machine anybody can promise timing to; the time an
    // upload of a whole file takes is not measured at all, because this test deliberately cripples the network
    // it would be measured on.
    logLatency(testInfo, [waiting]);
    await writeLatencyReport(testInfo, 'drop to picture');
    expectNoConsoleErrors([leo, sam]);
    await closeParticipants([leo, sam]);
  });

  // TC-26: the file picker, a batch of three files of which one is acceptable, and the two sentences the
  // board says about the other two.
  test('the Image button takes the picture it can and says what it refused', async ({ page }) => {
    test.setTimeout(180_000);
    const boardId = newBoard();
    await openBoardAt(page, boardId);

    const good = await imageFixture('screenshot.png');
    // A PDF, named `.png` and declared as `image/png`. It passes the type check, because the type check is a
    // question about a name; it is refused by the decoder, which is the only thing in this board that ever
    // opened the file.
    const disguised = await imageFixture('fake-image.png');
    // Fifteen megabytes with a JPEG's first four bytes: legal in every way except its length, which is the
    // only reason this board will not take it. Made rather than stored, because a file whose whole content is
    // "more than ten megabytes" does not belong in a repository.
    const enormous = fileOfBytes('holiday.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 5_000_000);

    // The pointer is in Select before, and in Select after: the Image tool is the toolbar's name for a file
    // dialog, not a mode the board enters.
    await expectTool(page, 'select');
    const chooser = await openPickerWithKey(page);
    // The dialog itself is filtered to the four formats — which is a courtesy to the person choosing, and not
    // a check: the same files are looked at again the moment they come back.
    expect(await pickerFilter(page)).toBe(IMAGE_ACCEPTED_TYPES.join(','));
    await chooser.choose([good, disguised, enormous]);

    // The refused files did not stop the one that was fine. It went in the middle of what this person was
    // looking at, because a file chosen from a dialog has no drop point — there was never a place on the
    // screen where the mouse was.
    const id = only(await expectImageCount(page, 1));
    await expect.poll(() => imageStatus(page, id), { timeout: 30_000 }).toBe('ready');
    const box = await objectWorld(page, id);
    const centre = await worldOfPoint(page, { x: 640, y: 400 });
    expect(box.x + box.width / 2, 'a picked picture lands in the middle of the view').toBeCloseTo(centre.x, 0);
    expect(box.y + box.height / 2).toBeCloseTo(centre.y, 0);
    expect(box.width).toBeCloseTo(800, 0);
    expect(box.height).toBeCloseTo(500, 0);
    // The picture is *fetched*, which is a second thing from the picture being *ready*: the document says
    // ready the moment the server accepts the file, and the `<img>` underneath that word has still to go and
    // get it. A test that read the screen between those two moments would see a box with no picture in it and
    // would be right to, so this waits — and it is the same distinction `tests/component/ImageObject.test.tsx`
    // makes from the other side, where the document is ready and the image has not loaded yet.
    await expect.poll(() => picturesVisible(page), { timeout: 30_000 }).toBe(1);
    expect(await decodedSize(page, id)).toEqual({ width: 1440, height: 900 });

    // Both refusals, in one line: the size was known as soon as the list was walked, and the type only when
    // the bytes were opened — and the line the person is left with says both, because both are true of the
    // batch they just chose.
    const said = await expectToast(page, REJECTION_MESSAGES.type);
    expect(said).toContain(REJECTION_MESSAGES.size);
    expect(said).toContain(REJECTION_MESSAGES.type);
    // Said once: the toast is the board's one remark about this batch, not a list of them.
    expect(await page.getByTestId('toast').count()).toBe(1);

    // And nothing else arrived: one file in, one picture on the board, the pointer still where it was.
    expect(await imageIds(page)).toHaveLength(1);
    await expectTool(page, 'select');

    // The same again from the toolbar button, which opens the same dialog: the keyboard is a shortcut to the
    // button, and the button is a shortcut to the same twelve lines of code.
    const second = await openPickerWithButton(page);
    await second.choose([await imageFixture('blue.png')]);
    await expectImageCount(page, 2);
    // The new picture is a different object, at the same size as before — a file chooser with no drop point
    // puts its row where the middle of the screen is, which is where this one already was.
    const [shot, blue] = await imageIds(page);
    expect(blue).not.toBe(shot);
    await expect.poll(() => picturesVisible(page), { timeout: 30_000 }).toBe(2);
    expect((await objectWorld(page, blue ?? '')).width).toBeCloseTo(640, 0);
  });

  // TC-27: proportion, the floor a box is not allowed through, and the picture being there for a browser that
  // was never there when it was dropped.
  test('a picture resizes in proportion, stops at the smallest it is allowed to be, and is there next time', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const boardId = newBoard();
    const robin = await openPersonPage(browser, 'Robin');
    await openBoardAt(robin.page, boardId);

    await dropFiles(robin.page, [await imageFixture('photo.jpg')], { x: 300, y: 200 });
    const id = only(await expectImageCount(robin.page, 1));
    await expect.poll(() => picturesVisible(robin.page), { timeout: 30_000 }).toBe(1);

    const before = await objectWorld(robin.page, id);
    expect(before.width).toBeCloseTo(800, 0);
    expect(before.height).toBeCloseTo(500, 0);

    // Out to half size, before anything is dragged. This is not decoration: a 1440 × 900 photograph is placed
    // at the largest box this board allows, which is 800 × 500 world units, and at a 100 % camera on a
    // 1280 × 800 window that box runs off the bottom-right of the screen — and a resize handle that is not on
    // the screen is a handle a mouse cannot reach. Playwright will happily report the bounding box of an
    // element that is off the end of the window and then dispatch a click to coordinates that deliver nothing
    // to anybody, so the test would have been dragging a handle that was not there. Zoomed out, the whole
    // picture and all eight of its handles are inside the window, and one screen pixel is two world units.
    await setCamera(robin.page, { zoom: 0.5 });

    // Selected, like anything else on this board: the picture does not decide what a click on it means, the
    // board does, and it means "this one".
    await objectOf(robin.page, id).click();
    await expect(objectOf(robin.page, id)).toHaveAttribute('data-selected', 'true');

    // The far corner pulled out by a hundred screen pixels each way, which at this camera is two hundred
    // world units each way.
    const corner = await handleScreen(robin.page, 'se');
    await dragFromPoint(robin.page, corner, 100, 100);
    const grown = await waitForObjectAtRest(robin.page, id);

    // Wider, and taller — by the proportion the file came with, not by the proportion the pointer moved in.
    // The pointer went two hundred units right and two hundred down, which is not the shape of a 16:10
    // picture: the dominant axis is the one that moved furthest *relative to the object*, and the other side
    // is derived from it. That is the whole difference between resizing a picture and resizing a rectangle, so
    // it is worth the arithmetic in the test: 1.4 on both sides, not 1.25 and 1.4.
    const ratio = before.width / before.height;
    expect(grown.width, 'the drag was outwards').toBeGreaterThan(before.width);
    expect(grown.height).toBeGreaterThan(before.height);
    expect(grown.width / grown.height, 'an image keeps the proportions it arrived with').toBeCloseTo(ratio, 2);
    expect(grown.width / before.width).toBeCloseTo(grown.height / before.height, 6);
    expect(grown.width / before.width, 'the scale the pointer asked for').toBeCloseTo(1.4, 1);
    // The near corner did not move: a corner is dragged *from* the opposite corner.
    expect(grown.x).toBeCloseTo(before.x, 0);
    expect(grown.y).toBeCloseTo(before.y, 0);

    // Now the same handle driven back over the picture and past its far corner, which is how an object gets
    // asked to become smaller than it is allowed to be. The pointer ends up somewhere it is impossible for the
    // box to follow, and what comes back has to be the answer the board decided rather than the answer the
    // mouse asked for.
    const beyond = await screenOfWorld(robin.page, { x: grown.x - 100, y: grown.y - 100 });
    const stillCorner = await handleScreen(robin.page, 'se');
    await dragFromPoint(robin.page, stillCorner, beyond.x - stillCorner.x, beyond.y - stillCorner.y);
    const smallest = await waitForObjectAtRest(robin.page, id);

    // It stopped at the floor, and it kept its shape on the way down. The two are reconciled by one number:
    // the scale that is allowed is the one that cannot put the object through its own minimum, so the short
    // side lands exactly on the minimum and the long side is whatever the proportion says it has to be. A
    // drag that was asking for a box of negative size gets a box of twenty-six by sixteen instead.
    expect(Math.min(smallest.width, smallest.height), 'the floor holds').toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 1);
    expect(Math.max(smallest.width, smallest.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD * ratio, 1);
    expect(smallest.width / smallest.height).toBeCloseTo(ratio, 2);
    expect(smallest.x).toBeCloseTo(before.x, 0);
    expect(smallest.y).toBeCloseTo(before.y, 0);

    // The same board, in a browser that has never been to it: the picture is here, in the box the drag left it
    // in, with its bytes fetched from the bucket rather than remembered from anywhere. This is the end of the
    // claim that a picture on a board is a fact about the board.
    const dana = await openPersonPage(browser, 'Dana');
    await openBoardAt(dana.page, boardId);
    const kept = only(await expectImageCount(dana.page, 1));
    expect(kept, 'the same object, not a new one').toBe(id);
    const found = await objectWorld(dana.page, kept);
    expect(found.width).toBeCloseTo(smallest.width, 1);
    expect(found.height).toBeCloseTo(smallest.height, 1);
    expect(found.x).toBeCloseTo(smallest.x, 1);
    expect(await imageStatus(dana.page, kept)).toBe('ready');
    await expectEventually(dana, 'the picture, from the bucket', () =>
      picturesVisible(dana.page).then((seen) => seen === 1),
    );
    // The bytes came from the asset endpoint, not from anywhere in this browser's memory of the drop.
    expect(await pictureSource(dana.page, kept)).toContain('/api/assets/');

    expectNoConsoleErrors([robin, dana]);
    await writeLatencyReport(testInfo, 'resize and revisit');
    await closeParticipants([robin, dana]);
  });

  // TC-28: an upload that fails at the network, the two different things the two people are told about it,
  // and a retry that arrives everywhere.
  test('an upload that fails is a box the uploader can retry and a box everyone else can only read', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const boardId = newBoard();
    const leo = await openPersonPage(browser, 'Leo');
    await openBoardAt(leo.page, boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    // The network refuses the upload before it gets here. Nothing the board does can be blamed on this: the
    // failure is the browser's, and what is under test is what the board says afterwards.
    await failUploads(leo.page);
    await dropFiles(leo.page, [await imageFixture('blue.png')], { x: 420, y: 260 });
    const id = only(await expectImageCount(leo.page, 1));
    // The box the file was dropped into, before anything has gone wrong with it. Every assertion below about
    // the failure being "the same box" is a comparison with this one.
    const placeholder = await objectWorld(leo.page, id);

    await expect.poll(() => imageStatus(leo.page, id), { timeout: 30_000 }).toBe('failed');
    await expect(imageRetryButton(leo.page, id)).toBeVisible();
    await expect(imageRemoveButton(leo.page, id)).toBeVisible();
    expect(await imageText(leo.page, id)).toContain(UPLOAD_FAILED);

    // The other person sees the same box and a different sentence. She cannot retry it: the file is not in her
    // browser, was never in her browser, and no button on her screen can make it be. She can see that there
    // was meant to be a picture here, and she can remove it.
    await expectEventually(sam, 'the upload that did not arrive', () =>
      imageStatus(sam.page, id).then((state) => state === 'unavailable'),
    );
    const herBox = await objectWorld(sam.page, id);
    expect([herBox.x, herBox.y, herBox.width, herBox.height]).toEqual([
      placeholder.x,
      placeholder.y,
      placeholder.width,
      placeholder.height,
    ]);
    expect(await imageText(sam.page, id)).toContain(UNAVAILABLE);
    expect(await imageRetryButton(sam.page, id).count()).toBe(0);
    expect(await imageRemoveButton(sam.page, id).count()).toBe(0);

    // The network comes back, and the retry is a second real upload of the file this browser still holds — the
    // one thing the board keeps in memory rather than in the document, and the reason a retry survives nothing
    // but a page reload.
    await letUploadsThrough(leo.page);
    await imageRetryButton(leo.page, id).click();
    await expect.poll(() => imageStatus(leo.page, id), { timeout: 30_000 }).toBe('ready');
    await expect.poll(() => picturesVisible(leo.page), { timeout: 30_000 }).toBe(1);
    await expectEventually(sam, 'the picture Leo sent on the second try', () =>
      picturesVisible(sam.page).then((seen) => seen === 1),
    );

    // The same object throughout: the same id, the same place, the same size, and now a picture inside it. The
    // failure was a fact about one object's status field, changed by a transaction nobody can undo, rather than
    // a new object replacing an old one.
    expect(await imageIds(leo.page)).toEqual([id]);
    const retried = await objectWorld(leo.page, id);
    expect([retried.x, retried.y, retried.width, retried.height]).toEqual([
      placeholder.x,
      placeholder.y,
      placeholder.width,
      placeholder.height,
    ]);
    expect(await imageStatus(leo.page, id)).toBe('ready');
    expect(await imageStatus(sam.page, id)).toBe('ready');
    expect(await decodedSize(sam.page, id)).toEqual({ width: 640, height: 480 });

    // Undo is still what it was: the upload was never an undo step, and a person who presses undo after a
    // picture arrives has dropped the picture off the board, which is the only thing they could have meant.
    await leo.page.keyboard.press('Meta+Z');
    await expectEventually(sam, 'the picture going away', () => imageIds(leo.page).then((ids) => ids.length === 0));
    expect(await imageIds(sam.page)).toEqual([]);

    // The aborted upload is this test's own doing, and the browser complains about it: the request failed,
    // which is the premise rather than the result.
    // The aborted upload is this test's own doing, and the browser complains about it in exactly one line:
    // `Failed to load resource: net::ERR_FAILED`, which is what a request the test told the browser to abort
    // sounds like from the console. Anything else this page says is still a failure.
    expectNoConsoleErrors([leo, sam], [/net::ERR_FAILED/]);
    await writeLatencyReport(testInfo, 'failed upload and retry');
    await closeParticipants([leo, sam]);
  });
});
