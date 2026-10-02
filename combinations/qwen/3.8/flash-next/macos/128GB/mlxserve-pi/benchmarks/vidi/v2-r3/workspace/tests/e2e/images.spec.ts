// Story 12, e2e: pictures on a board, in real browsers on a real room.
//
// What only a browser can show, for a picture:
//
//   - that the bytes a person dropped come back out of the store and are *decoded*.
//     `naturalWidth` is the browser's own answer about the bytes it was handed, so bytes
//     that came back as text, or as the wrong format, or as nothing at all, fail here and
//     nowhere else;
//   - that all four formats do that, from a real drop: what the sniffer believes about a
//     JPEG's first three bytes and what a browser believes about a whole JPEG are two
//     different opinions, and only the second one is what a person looks at;
//   - that a picture survives reloading the page — and that the tab which reloaded, the
//     one which has since lost the file and could not upload it again, is not the tab
//     being asked to press Retry, and does not pretend its picture never finished;
//   - that a corner dragged outwards keeps the picture's shape, and a corner dragged far
//     inwards stops at the smallest box rather than crushing one side of it;
//   - that an upload which fails comes back when its own button is pressed;
//   - and that while the room is down the Image button opens no dialogue at all.
//
// Nothing asserts wall-clock time: a change is waited for, and how long it took is
// printed against the latency budget, as in stories 3, 8 and 10.
import { expect, test, type Page } from '@playwright/test';
import {
  connectionStateOf,
  expectBoardAgreedAgain,
  expectEventually,
  expectNoProblems,
  joinBoard,
  leaveAll,
  loseTheBoard,
  newBoard,
  reportLatency,
} from './helpers/participants';
import { screenOf } from './helpers/shapes';
import { settle } from './helpers/board';
import {
  assetsRoute,
  dropImage,
  dropImageAt,
  expectNoFileChooser,
  expectSamePictures,
  FIXTURE_SIZE,
  imageButton,
  imageInput,
  imageOf,
  type ImageFormat,
  type ImageOnBoard,
  openImagePicker,
  pasteImage,
  payload,
  pickImages,
  toastTexts,
  waitForImageCount,
  waitForPicturePainted,
  waitForToast,
} from './helpers/images';
import { IMAGE_ALT_TEXT, IMAGE_MIN_SIZE_WORLD, IMAGE_STATUS_TEXT } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import type { Rect } from '../../src/shared/geometry';

const FORMATS: ImageFormat[] = ['png', 'jpg', 'gif', 'webp'];

/**
 * The box a 40x30 picture is drawn in when it is dropped at this board point. The drop
 * point is the picture's top-left corner, not its middle: that is where the design puts
 * it (`layoutRow(sizes, dropPoint, 'top-left')`), and a picture whose corner is under the
 * cursor is a picture whose corner is under the cursor for everybody.
 */
function boxOfDrop(at: { x: number; y: number }): Rect {
  return { x: at.x, y: at.y, width: FIXTURE_SIZE.width, height: FIXTURE_SIZE.height };
}

/** The address a picture of this board's is kept under, as this page was told it: the
 * same key pattern the store itself accepts, on this board's own id. */
function expectAddressOfThisBoard(src: string, boardId: string): void {
  const prefix = '/api/assets/';
  expect(src.startsWith(prefix)).toBe(true);
  const key = src.slice(prefix.length);
  expect(ASSET_KEY_PATTERN.test(key)).toBe(true);
  expect(key.startsWith(`${boardId}/`)).toBe(true);
}

test('a picture dropped on the board is on everybody\'s board, in all four formats', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);
  const omar = await joinBoard(browser, 'Omar', boardId);

  // Four files, four formats, four places on the board.
  const corners = [
    { x: -260, y: -180 },
    { x: 20, y: -180 },
    { x: -260, y: 20 },
    { x: 20, y: 20 },
  ];
  const seen: { format: ImageFormat; id: string; box: Rect }[] = [];
  for (let i = 0; i < FORMATS.length; i++) {
    const format = FORMATS[i]!;
    const corner = corners[i]!;
    const before = new Set(await waitForImageCount(maya.page, i));
    await dropImageAt(maya.page, format, corner);
    const ids = await waitForImageCount(maya.page, i + 1);
    const id = ids.find((id) => !before.has(id));
    if (id === undefined) throw new Error(`the ${format} that was dropped did not arrive on the board`);
    seen.push({ format, id, box: boxOfDrop(corner) });
  }

  const addresses = new Set<string>();
  for (const { id, box } of seen) {
    const picture = await waitForPicturePainted(maya.page, id);
    // Decoded, at the size the file arrived with, and called what a person who cannot see
    // it is told it is.
    expect(picture.decodedWidth).toBe(FIXTURE_SIZE.width);
    expect(picture.decodedHeight).toBe(FIXTURE_SIZE.height);
    expect(picture.naturalWidth).toBe(FIXTURE_SIZE.width);
    expect(picture.naturalHeight).toBe(FIXTURE_SIZE.height);
    expect(picture.alt).toBe(IMAGE_ALT_TEXT);
    // The address the bytes are kept under is the board's own making, one per picture.
    expectAddressOfThisBoard(picture.src, boardId);
    addresses.add(picture.src);
    // Where it was laid is where it is, at its own size: 40x30 pixels are 40x30 board
    // units at this zoom, because enlarging a picture nobody asked for is not the board's
    // business, and neither is shrinking one that already fits.
    expect(picture.width).toBeCloseTo(box.width, 1);
    expect(picture.height).toBeCloseTo(box.height, 1);
    expect(picture.x).toBeCloseTo(box.x, 0);
    expect(picture.y).toBeCloseTo(box.y, 0);
    // Finished, and quiet about it: no words standing over a picture that is simply there.
    expect(picture.status).toBe('ready');
    expect(picture.display).toBe('ready');
    expect(picture.words).toBe('');
    expect(picture.retry).toBe(false);
  }
  // Four files of four formats, four addresses: nothing was written over anything,
  // whatever the four files were called.
  expect(addresses.size).toBe(4);

  // Nobody is told what the files were called. A filename is text the board was handed and
  // cannot check, so it is written nowhere a person can read it.
  await expect(maya.page.getByText(/holiday/)).toHaveCount(0);

  // Omar's screen comes to hold the same four pictures, in the same boxes, at the same
  // addresses — and his browser decodes the same bytes out of the store.
  await expectSamePictures([maya, omar], 'four pictures dropped');
  for (const { id } of seen) {
    const painted = await waitForPicturePainted(omar.page, id);
    expect(painted.src).toBe((await imageOf(maya.page, id)).src);
    // He is not watching somebody else's progress bar, and is not offered anybody's
    // upload: to him the picture appears, and then it is there.
    expect(painted.retry).toBe(false);
  }

  expectNoProblems([maya, omar]);
  await leaveAll([maya, omar]);
});

test('a board reloaded keeps its pictures, and does not ask for an upload it lost', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);

  await dropImageAt(maya.page, 'png', { x: -40, y: -60 });
  const [first] = await waitForImageCount(maya.page, 1);
  const before = await waitForPicturePainted(maya.page, first!);

  await maya.page.reload();
  await settle(maya.page);
  const after = await waitForPicturePainted(maya.page, first!);

  // Same picture, same box, same address. It was never kept in the page, so the page
  // going away and coming back is nothing that happens to it.
  expect(after.status).toBe('ready');
  expect(after.src).toBe(before.src);
  expect(after.x).toBeCloseTo(before.x, 1);
  expect(after.y).toBeCloseTo(before.y, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.height).toBeCloseTo(before.height, 1);

  // The file has been out of this tab's hands since the page went away — that is the whole
  // point of putting the bytes on the board first — and nothing on the screen pretends
  // otherwise, or offers to do the impossible.
  expect(after.retry).toBe(false);
  expect(after.display).toBe('ready');
  expect(after.words).toBe('');
  await expect(maya.page.getByTestId('image-retry')).toHaveCount(0);
  await expect(maya.page.getByText(IMAGE_STATUS_TEXT.unfinished)).toHaveCount(0);

  // One Ctrl+Z after a reload undoes nothing. The board opens with an empty undo stack,
  // and a picture that was already here when the page arrived did not only "just happen"
  // because it is the one thing on the screen.
  await maya.page.keyboard.press('Control+z');
  await maya.page.waitForTimeout(400);
  await expect(maya.page.getByTestId('image-object')).toHaveCount(1);

  // This tab still remembers how to upload: a second picture, dropped after the reload,
  // arrives and is painted.
  await dropImageAt(maya.page, 'gif', { x: 160, y: 60 });
  const ids = await waitForImageCount(maya.page, 2);
  const second = ids.find((id) => id !== first);
  if (second === undefined) throw new Error('the picture dropped after the reload is not on the board');
  await waitForPicturePainted(maya.page, second);

  // Somebody who joins now gets both pictures, bytes and all.
  const omar = await joinBoard(browser, 'Omar', boardId);
  await waitForPicturePainted(omar.page, first!);
  await expectSamePictures([maya, omar], 'the board after a reload');

  expectNoProblems([maya, omar]);
  await leaveAll([maya, omar]);
});

test('a picture dragged by its corner keeps its shape, and stops at the smallest box', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);
  const omar = await joinBoard(browser, 'Omar', boardId);
  const page = maya.page;

  const corner = { x: -60, y: -40 };
  await dropImageAt(page, 'png', corner);
  const [id] = await waitForImageCount(page, 1);
  await waitForPicturePainted(page, id!);
  const original = await imageOf(page, id!);
  const ratio = FIXTURE_SIZE.width / FIXTURE_SIZE.height;

  // Select it, and the corner a person would drag is there to drag. The click goes in the
  // middle of the picture, which is where a hand aiming at a picture aims.
  const at = await screenOf(page, {
    x: corner.x + FIXTURE_SIZE.width / 2,
    y: corner.y + FIXTURE_SIZE.height / 2,
  });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('resize-handle-se')).toBeVisible();

  // Outwards: both axes grow, and the shape is the one the file arrived with.
  const grown = await resizeByCorner(page, id!, 90, 20);
  expect(grown.width).toBeGreaterThan(original.width);
  expect(grown.height).toBeGreaterThan(original.height);
  expect(grown.width / grown.height).toBeCloseTo(ratio, 3);
  // The corner that was dragged is the corner that moved and the opposite one stayed
  // where it was — so it is the shape that was kept, not the box that was slid about.
  expect(grown.x).toBeCloseTo(original.x, 1);
  expect(grown.y).toBeCloseTo(original.y, 1);
  // Still the same picture: the same bytes, at the same address.
  expect(grown.src).toBe(original.src);

  // Far inwards, past anything a person could want: the box stops at the smallest size it
  // is allowed on *both* axes rather than crushing the short side down to nothing, and it
  // is still a 4:3 box on the way down. The short side is what binds — 16 units is
  // further up 30 units than it is up 40 — so the width stops with room to spare above the
  // minimum, which is the price of keeping the shape and the right price to pay.
  const smallest = await resizeByCorner(page, id!, -600, -600);
  expect(smallest.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
  expect(smallest.height).toBeLessThan(original.height);
  expect(smallest.width).toBeGreaterThanOrEqual(smallest.height);
  expect(smallest.width / smallest.height).toBeCloseTo(ratio, 3);

  // The other person is watching the same picture become the same smaller box.
  await expectSamePictures([maya, omar], 'the picture resized');

  // One undo takes the last resize off the board: the whole gesture at once, not half of
  // it, and not the drop along with it.
  await page.keyboard.press('Control+z');
  await expectEventually('undo of a resize', async () => (await imageOf(page, id!)).width, grown.width);

  expectNoProblems([maya, omar]);
  await leaveAll([maya, omar]);
});

/**
 * Drag the bottom-right handle of the selected picture by a distance in screen pixels,
 * then read its box back. The handle is fetched again each time, because the box it sits
 * on has moved since it was last looked at.
 */
async function resizeByCorner(page: Page, id: string, dx: number, dy: number): Promise<ImageOnBoard> {
  const corner = page.getByTestId('resize-handle-se');
  await expect(corner).toBeVisible();
  const box = await corner.boundingBox();
  if (box === null) throw new Error(`picture ${id} has no corner to drag`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
  return imageOf(page, id);
}

test('an upload that fails comes back when its button is pressed', async ({ browser, request }) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);
  const omar = await joinBoard(browser, 'Omar', boardId);
  const page = maya.page;

  // The store is unreachable — not the room, which stays up the whole time.
  let broken = true;
  await page.route(assetsRoute(boardId), (route) => (broken ? void route.abort() : void route.continue()));

  const corner = { x: 40, y: -20 };
  await dropImageAt(page, 'png', corner);
  // The placeholder is on the board even though nothing can be stored: what the board is
  // told about the picture comes first, and the bytes are the second thing.
  const [id] = await waitForImageCount(page, 1);
  const failed = page.getByTestId('image-failed');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText(IMAGE_STATUS_TEXT.failed);
  const said = await imageOf(page, id!);
  expect(said.status).toBe('failed');
  expect(said.display).toBe('failed');
  // Its box is the box the finished picture will be, in the place it was dropped, so
  // nothing on the board has to move when the bytes turn up: the size the file's own ratio
  // made is already here.
  expect(said.x).toBeCloseTo(corner.x, 0);
  expect(said.y).toBeCloseTo(corner.y, 0);
  expect(said.width).toBeCloseTo(boxOfDrop(corner).width, 1);
  expect(said.height).toBeCloseTo(boxOfDrop(corner).height, 1);

  // The person who did not drop it is told the picture is not there, and is not handed a
  // button that could not possibly work: the file is in nobody's hands but Maya's.
  await expectEventually(
    'the failure seen by the other person',
    async () => (await imageOf(omar.page, id!)).words,
    IMAGE_STATUS_TEXT.unavailable,
  );
  const forOmar = await imageOf(omar.page, id!);
  expect(forOmar.retry).toBe(false);
  // Taking it off the board is something he can still do, and does not depend on bytes.
  expect(forOmar.remove).toBe(true);

  // The file is still in this tab's hands. The route is mended, and the button pressed.
  broken = false;
  const retry = page.getByTestId('image-retry');
  await expect(retry).toBeVisible();
  await retry.click();
  await waitForPicturePainted(page, id!);

  const painted = await imageOf(page, id!);
  expect(painted.status).toBe('ready');
  expect(painted.words).toBe('');
  expect(painted.retry).toBe(false);
  expectAddressOfThisBoard(painted.src, boardId);
  // Neither moved nor resized while its upload was retried: the box was made at the
  // picture's own shape, and the retry only filled it in.
  expect(painted.width).toBeCloseTo(said.width, 1);
  expect(painted.height).toBeCloseTo(said.height, 1);
  reportLatency('story 12: the retry');

  // The bytes really are in the store now: the other person's browser fetches them and
  // decodes them without being asked to.
  const forOmarNow = await waitForPicturePainted(omar.page, id!);
  expect(forOmarNow.src).toBe(painted.src);

  // Nothing went wrong on the way except the one request this test broke on purpose.
  // The page does complain about that request — a resource that comes back as
  // net::ERR_FAILED is the aborted upload, seen from the other side of the same fact —
  // so the complaint is the test working, and everything else is a problem.
  const fromTheBrokenUpload = (problem: string): boolean =>
    problem.includes('/assets') || /net::ERR_(FAILED|ABORTED)|Load failed/i.test(problem);
  expect(maya.problems.filter((problem) => !fromTheBrokenUpload(problem))).toEqual([]);
  expectNoProblems([omar]);
  await leaveAll([maya, omar]);
});

test('while the room is down no picture can be added, by either door', async ({ browser, request }) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);
  const omar = await joinBoard(browser, 'Omar', boardId);
  const page = maya.page;

  // While the room is up, both doors work: a paste, and a file chosen through the
  // dialogue the Image button opens.
  await pasteImage(page, 'jpg');
  const [pasted] = await waitForImageCount(page, 1);
  await waitForPicturePainted(page, pasted!);

  const opened = await openImagePicker(page);
  expect(opened.isMultiple()).toBe(true);
  await opened.setFiles([payload('webp')]);
  const chosen = await waitForImageCount(page, 2);
  const second = chosen.find((id) => id !== pasted);
  if (second === undefined) throw new Error('the picture chosen from the dialogue is not on the board');
  await waitForPicturePainted(page, second);
  await expectSamePictures([maya, omar], 'a pasted and a chosen picture');

  // The picker is offered as the four formats, which is the list the story was written
  // with and not a shorter one somebody typed twice.
  const accept = (await imageInput(page).getAttribute('accept')) ?? '';
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    expect(accept).toContain(type);
  }

  // The room goes down. The Image button opens no dialogue at all — a file chosen through
  // a dialogue that could not then be uploaded would be a promise the board cannot keep —
  // and it says why, in words that say what to do about it.
  await loseTheBoard(maya, 6_000);
  // Until the page itself knows the board is out of reach, the test is not testing the
  // outage: it would be pressing a button in a second that has not yet been noticed.
  await expectEventually('the board out of reach', () => connectionStateOf(maya.page), 'reconnecting');
  await imageButton(page).click();
  await expectNoFileChooser(page);
  await waitForToast(page, REJECTION_MESSAGES.offline);

  // A drop says the same thing, once rather than twice, and puts nothing on the board to
  // fail in front of everybody later.
  await dropImage(page, 'png', await screenOf(page, { x: 200, y: 120 }));
  await expectEventually(
    'a refusal that does not repeat itself',
    async () => (await toastTexts(page)).filter((words) => words === REJECTION_MESSAGES.offline).length,
    1,
  );
  await expect(page.getByTestId('image-object')).toHaveCount(2);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('image-object')).toHaveCount(2);

  // Back up, and the very same button works again.
  await expectBoardAgreedAgain(maya, 'the room, and the door with it');
  await pickImages(page, ['gif']);
  const after = await waitForImageCount(page, 3);
  const added = after.find((id) => !chosen.includes(id));
  if (added === undefined) throw new Error('the picture chosen after reconnecting is not on the board');
  await waitForPicturePainted(page, added);
  await expectSamePictures([maya, omar], 'the picture chosen after reconnecting');

  // The words it was given while the room was down are not still on the screen.
  await expectEventually('the refusal gone', async () => (await toastTexts(page)).length, 0);
  reportLatency('story 12: both doors, open and shut');

  expectNoProblems([maya, omar]);
  await leaveAll([maya, omar]);
});

test('a file which is not one of the four formats is refused, with the formats named', async ({
  browser,
  request,
}) => {
  const boardId = await newBoard(request);
  const maya = await joinBoard(browser, 'Maya', boardId);
  const page = maya.page;

  // A PDF, and an SVG — the second a drawing, but not a picture this board can keep. Both
  // are laid on the board the way a real file is, so what decides them is their bytes and
  // not what they were called.
  await dropTextFile(page, 'notes.pdf', 'application/pdf', '%PDF-1.7\n');
  await waitForToast(page, REJECTION_MESSAGES.type);
  await dropTextFile(page, 'logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');

  // The same refusal is not said twice over, and neither file left anything behind: no
  // placeholder, no progress bar, nothing to delete. Two files refused for the same reason
  // are one sentence and an board that looks exactly as it did.
  await expectEventually(
    'a refusal that does not repeat itself',
    async () => (await toastTexts(page)).filter((words) => words === REJECTION_MESSAGES.type).length,
    1,
  );
  await expect(page.getByTestId('image-object')).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('image-object')).toHaveCount(0);

  // And the board still works: a real picture, dropped after the refusals, goes up as ever.
  await dropImageAt(page, 'png', { x: 0, y: 0 });
  const [id] = await waitForImageCount(page, 1);
  await waitForPicturePainted(page, id!);

  expectNoProblems([maya]);
  await leaveAll([maya]);
});

/** A file that is not a picture, laid on the board with the same ceremony as a real one. */
async function dropTextFile(page: Page, name: string, type: string, text: string): Promise<void> {
  const at = await screenOf(page, { x: 0, y: 100 });
  await page.evaluate(
    ({ name, type, text, at }: { name: string; type: string; text: string; at: { x: number; y: number } }) => {
      const surface = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
      const data = new DataTransfer();
      data.items.add(new File([text], name, { type }));
      surface.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: at.x,
          clientY: at.y,
        }),
      );
    },
    { name, type, text, at },
  );
}
