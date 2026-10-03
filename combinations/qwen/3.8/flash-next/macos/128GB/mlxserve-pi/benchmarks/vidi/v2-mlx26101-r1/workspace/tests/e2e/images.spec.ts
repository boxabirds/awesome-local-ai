// Story 12 e2e: pictures on a board, in a real browser, with a real bucket behind them.
//
// The unit tests decide what a PNG is; the component tests decide what the doors do to a document and
// what the five states say. What only a browser can prove is the whole of the promise at once: that a
// file dragged onto a board becomes a picture on *someone else's* screen, having been written to
// storage and read back — that the address in the document is an address that answers, with the bytes
// it was given and a `Cache-Control` that says they will never change — and that while any of that is
// happening the board is still a board: the picture can be selected, resized, removed, and it is still
// there after a reload.
//
// Uploads are held open by the tests rather than left to chance. An upload that finishes in four
// milliseconds is a state nobody can observe, and a test that raced it would be a test that fails on a
// fast machine. The holds are gates the test opens, and the time it then takes for a picture to appear
// on the other person's screen is *logged* against the story's latency budget rather than asserted —
// a slow CI machine is not a broken board (see stories 3 and 11 for the same argument).

import { expect, test, type Page, type Route } from '@playwright/test';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  IMAGE_UPLOAD_STALE_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { createBoard, setCamera } from './helpers/board';
import {
  createParticipants,
  expectEventually,
  openParticipant,
} from './helpers/participants';
import {
  bytesOfBase64,
  dragFilesAway,
  dragFilesOver,
  dropFiles,
  fixtureFile,
  oversizeFile,
  pickerFiles,
  sameBytes,
  type FileToDrop,
} from './helpers/drop-files';
import {
  clickImage,
  drawnCount,
  imageOf,
  imagesOn,
  imageSrc,
  paintedOf,
  paintedProgress,
  progressBarOn,
  toastsOn,
  waitForDrawnCount,
  waitForImageCount,
  waitForPainted,
  waitForToast,
} from './helpers/image';
import { dragHandle, resizeHandle } from './helpers/sticky';
import { boardIdOfAssetKey, isAssetKey, sniffImageType } from '../../src/shared/image-format';

/**
 * Fetch a path in a real browser and give back its bytes as base64.
 *
 * The test's own HTTP client hands back a `Buffer`, and in a project that also types for Workers the
 * global `Buffer` belongs to the Workers runtime and does not know how to be an encoding. Asking the
 * page is both type-clean and better evidence: it is the board asking for its own picture.
 */
async function servedBase64(page: Page, path: string): Promise<string> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, path);
}

/** The upload endpoint, and only the upload endpoint: reading a picture back is never held up. */
function isUpload(url: URL): boolean {
  return /\/api\/boards\/[^/]+\/assets$/.test(url.pathname);
}

/** A promise a test can open later, so an upload waits for the test and not the other way round. */
function gate(): { wait: Promise<void>; open(): void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

/**
 * Hold every upload on this screen for as long as the test's gate is shut. While it is shut the board
 * is showing an upload in progress, which is the only way a test can read a progress bar.
 */
async function holdUploads(page: Page, until: Promise<void>): Promise<void> {
  await page.route(isUpload, async (route: Route) => {
    await until;
    await route.continue();
  });
}

/** A camera that puts the whole world in the window, so a row of pictures is a row a test can see. */
const FIT = { x: 0, y: 0, zoom: 0.4 };

/**
 * The point a drop is made at with `FIT`: far enough into the board to be board, and high and left
 * enough that the row a drop lays out still fits on the screen — three 800-unit boxes at 40% is a
 * little under the window's width, and a box that is off screen is a box whose picture a lazy loader
 * never asks for.
 */
const DROP_AT = { x: 150, y: 500 };

/** The fixtures of this story, in the order they are dropped. */
const SCREENSHOTS = ['screenshot-1440x900.png', 'diagram-1000x400.png', 'picture.webp'] as const;

/**
 * TC-25 (image.drop, image.uploading, image.placeholder_other, assets.api): Leo drops three
 * screenshots onto a board Sam is looking at. Before any of them has finished, Sam's board already
 * holds three placeholders of the right size, saying only "Uploading…" — because Sam has no file to
 * upload and no business being shown a percentage. When the uploads are let go, all three become
 * pictures on both screens, from the same address each time, and that address answers with the bytes
 * that were given and a year of cache on it.
 */
test('TC-25 three screenshots dropped on a board become pictures on the other person\'s screen', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const [leo, sam] = await createParticipants(browser, boardId, ['Leo', 'Sam']);
  for (const person of [leo, sam]) await setCamera(person.page, FIT);

  const held = gate();
  await holdUploads(leo.page, held.wait);

  const files = SCREENSHOTS.map((name) => fixtureFile(name));
  await dropFiles(leo.page, files, DROP_AT);

  // The frame that promised "drop them here" is gone with the drop, like a door that closes.
  await expect(leo.page.getByTestId('drop-highlight')).toHaveCount(0);

  const placed = await waitForImageCount(leo.page, 3);
  expect(placed.map((image) => image.status)).toEqual(['uploading', 'uploading', 'uploading']);

  // They arrive as a row: same top line, each one starting a gap after the last, each box the size its
  // own picture will be shown at and no bigger than the biggest box the story allows. Left to right by
  // where they landed, because the order the document keeps them in is nobody's promise.
  const [first, second, third] = [...placed].sort((a, b) => a.x - b.x);
  expect(second!.x - first!.x, 'a gap of 24 that belongs to neither picture').toBe(
    first!.width + IMAGE_LAYOUT_GAP_WORLD,
  );
  expect(third!.x - second!.x).toBe(second!.width + IMAGE_LAYOUT_GAP_WORLD);
  expect(new Set(placed.map((image) => image.y)).size, 'one row, so one top line').toBe(1);
  for (const image of placed) {
    expect(Math.max(image.width, image.height), 'no box is bigger than the biggest box').toBeLessThanOrEqual(
      IMAGE_MAX_PLACE_SIZE_WORLD + 0.5,
    );
    expect(
      image.width / image.height / (image.naturalWidth / image.naturalHeight),
      'a box is its picture\'s shape, so a picture is never stretched',
    ).toBeCloseTo(1, 2);
    expect(image.uploaderId, 'the box knows whose file this is').toBeTruthy();
  }

  // Sam's board has the same three boxes already, and says less about each of them.
  const onSam = await waitForImageCount(sam.page, 3);
  expect(onSam.map((image) => image.id), 'the same objects, not a copy of them').toEqual(
    placed.map((image) => image.id),
  );
  for (const image of onSam) {
    const box = await waitForPainted(sam.page, image.id, 'uploading');
    expect(box.stateText).toBe('Uploading…');
    expect(box.uploader, 'this is not Sam\'s picture').toBe('other');
    expect(box.retry, 'Sam has no file to upload').toBe(false);
    expect(await paintedProgress(sam.page, image.id), 'Sam is told it is coming, no more').toBe(
      'Uploading…',
    );
    expect(await progressBarOn(sam.page, image.id), 'a percentage would be a lie').toBeNull();
  }

  // The uploader is told it is going. Whether a number is on it yet depends on how much of the file
  // the browser has handed to the network at the moment the test looked, so the number is not asserted
  // — the component tests own that, with a transfer they can drive byte by byte. What is asserted here
  // is the other person's screen: same box, same words, no bar at all.
  const mine = await paintedProgress(leo.page, first!.id);
  expect(mine, 'the person waiting is told there is something to wait for').toMatch(
    /^Uploading( \d+%)?…?$/,
  );

  // Let go of the uploads. What happens next is the story: bytes to storage, an address into the
  // shared document, and a picture on two screens.
  held.open();

  const { ms } = await expectEventually(
    () => drawnCount(sam.page),
    (count) => count === 3,
    E2E_EVENTUAL_TIMEOUT_MS,
    'the pictures never arrived on the watcher\'s screen',
  );
  // Logged, not asserted: how long a picture takes to reach the other person is a fact about the
  // machine this runs on, and only ever a fact about it (story 3).
  console.log(
    `[story 12] upload released to three pictures on another screen: ${ms} ms ` +
      `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
  );
  await waitForDrawnCount(leo.page, 3, E2E_EVENTUAL_TIMEOUT_MS);

  const ready = await imagesOn(sam.page);
  const keys = ready.map((image) => image.assetKey);
  expect(new Set(keys).size, 'three pictures, three addresses').toBe(3);
  for (const image of ready) {
    expect(image.status).toBe('ready');
    // The address is this board's, and it is the stored key and nothing else.
    expect(image.assetKey !== null && isAssetKey(image.assetKey), 'a key, as the Worker spells one').toBe(
      true,
    );
    expect(boardIdOfAssetKey(image.assetKey!), 'and it is this board\'s').toBe(boardId);
    expect(await imageSrc(sam.page, image.id)).toBe(`/api/assets/${image.assetKey}`);
    expect(await imageSrc(sam.page, image.id)).toBe(await imageSrc(leo.page, image.id));
  }

  // And the addresses are good: each stored picture comes back as the type its own bytes are, with a
  // cache header that says they will never be different, and is byte for byte one of the three that
  // went up.
  //
  // Matched by content rather than by position. The document's order is a statement about stacking
  // (`z`, then id) and nobody promised it was the order the files were dropped in — a test that read
  // `placed[i]` against `files[i]` was quietly asserting a coincidence, and it failed the day the
  // coincidence stopped. What is asserted instead is the promise the board does make: whatever came
  // back is one of the things that went up, is served as what it is, and came back unchanged.
  const servedByPicture = new Map<string, Uint8Array>();
  for (const image of ready) {
    const response = await request.get(`/api/assets/${image.assetKey}`);
    expect(response.status(), 'the picture is where the board said it was').toBe(200);
    // Read back through a real browser rather than through the test's own HTTP client: the thing a
    // picture has to survive is being fetched by the board, same origin, with the document's address.
    const served = bytesOfBase64(await servedBase64(sam.page, `/api/assets/${image.assetKey}`));
    servedByPicture.set(image.assetKey!, served);
    // The same question the Worker asked before it stored anything, asked of what it handed back.
    const type = sniffImageType(served);
    expect(
      response.headers()['content-type'],
      'named by its bytes, not by its name',
    ).toBe(type ?? 'unknown');
    expect(response.headers()['cache-control']).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-security-policy']).toBe("default-src 'none'");
    const source = files.find((file) => sameBytes(served, file.bytes));
    expect(source !== undefined, 'every stored picture is one of the ones that went up').toBe(true);
    expect(type, 'and the board calls it what the file did').toBe(source!.type);
  }

  expect(
    [...servedByPicture.values()]
      .map((bytes) => files.findIndex((file) => sameBytes(bytes, file.bytes)))
      .sort((a, b) => a - b),
    'three files went up, three different pictures came back',
  ).toEqual([0, 1, 2]);
  expect(new Set(ready.map((image) => image.assetKey)).size, 'each under its own key').toBe(3);

  expect(leo.pageErrors, `page errors: ${leo.pageErrors.join('; ')}`).toEqual([]);
  expect(sam.pageErrors, `page errors: ${sam.pageErrors.join('; ')}`).toEqual([]);

  await leo.close();
  await sam.close();
});

/**
 * TC-26 (image.picker, image.types, image.size, image.count): Nadia presses I and picks three things
 * out of her files: a screenshot, a PDF wearing a PNG's name, and a JPEG eleven megabytes across. One
 * picture lands on the board. The other two are refused, in words she can read, in the toast that says
 * each thing once — and nothing was uploaded, so nothing is waiting in her undo history for a picture
 * that was never going to arrive.
 */
test('TC-26 a mixed batch out of the file picker: one picture, two reasons', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const nadia = await openParticipant(browser, boardId, 'Nadia');
  const page = nadia.page;
  await setCamera(page, FIT);

  // The picker the operating system is shown is filtered to the four kinds the board takes, so the
  // person is not offered a file that will only be refused.
  const accept = await page.getByTestId('image-file-input').getAttribute('accept');
  for (const kind of ['.png', '.jpg', '.jpeg', '.gif', '.webp', 'image/png', 'image/jpeg']) {
    expect(accept, `the picker offers ${kind}`).toContain(kind);
  }

  const tooBig = oversizeFile(); // Eleven-ish megabytes, on a real disk, because that is the rule.
  const claimant = fixtureFile('renamed-pdf.png');
  const screenshot = fixtureFile('screenshot-1440x900.png');

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.keyboard.press('i'),
  ]);
  expect(chooser, 'pressing I opened the file picker').toBeTruthy();
  await chooser!.setFiles(pickerFiles([screenshot, claimant, tooBig]));

  await waitForToast(page, 'Only PNG, JPEG, GIF and WebP images can be added.');
  await waitForToast(page, 'Images must be 10 MB or smaller.');
  const words = await toastsOn(page);
  expect(words, 'each thing that went wrong is said once, in the words the story chose').toHaveLength(2);

  // A person can get on with the board without waiting for the complaints to fade.
  await page.getByTestId('toast-dismiss').first().click();
  expect(await toastsOn(page), 'one complaint dismissed, the other still standing').toHaveLength(1);

  const placed = await waitForImageCount(page, 1);
  const [image] = placed;
  // A 28 KB file over a loopback connection is often uploaded before the test can read anything, and
  // that is a fact about the machine and not about the story: what matters is that the one file that
  // was accepted became exactly one object. TC-25 holds its uploads open to look at the waiting.
  expect(['uploading', 'ready']).toContain(image!.status);
  // The oversized file and the file that lied about what it is never became objects at all: no
  // placeholder, and so nothing sitting in the undo history for a picture that never came.
  expect(placed.map((i) => i.id)).toHaveLength(1);

  await waitForDrawnCount(page, 1, E2E_EVENTUAL_TIMEOUT_MS);
  const after = await imageOf(page, image!.id);
  expect(after.status).toBe('ready');
  expect(after.width, 'the one picture that arrived is the screenshot').toBeLessThanOrEqual(
    IMAGE_MAX_PLACE_SIZE_WORLD,
  );

  expect(await imagesOn(page)).toHaveLength(1);
  expect(nadia.pageErrors, `page errors: ${nadia.pageErrors.join('; ')}`).toEqual([]);

  await nadia.close();
});

/**
 * TC-27 (image.object, image.consistent, image.persist): a picture is an object. Ana drops one, drags
 * its corner and it grows in proportion, because a picture that squashes is a picture that was
 * destroyed to fit a box; drags the same corner back through the board and it stops at the smallest
 * size the story allows instead of vanishing; and Ben, who arrives afterwards on a browser that has
 * never seen this board, gets the same picture at the same size.
 */
test('TC-27 resize a picture in proportion, push it to the floor, and find it there after a reload', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const ana = await openParticipant(browser, boardId, 'Ana');
  await setCamera(ana.page, FIT);

  await dropFiles(ana.page, [fixtureFile('diagram-1000x400.png')], DROP_AT);
  const [dropped] = await waitForImageCount(ana.page, 1);
  const id = dropped!.id;
  const ratio = dropped!.naturalWidth / dropped!.naturalHeight;
  expect(ratio, 'the fixture is a wide drawing').toBeCloseTo(2.5, 1);

  // A press on the picture selects it, and a selected picture has the same handles as everything else.
  await clickImage(ana.page, id);
  await expect(resizeHandle(ana.page, 'se')).toBeVisible();

  const before = await imageOf(ana.page, id);
  await dragHandle(ana.page, 'se', 120, 60);
  const grown = await imageOf(ana.page, id);
  expect(grown.width, 'the corner drag grew the picture').toBeGreaterThan(before.width);
  expect(grown.width / grown.height / ratio, 'in proportion, never stretched').toBeCloseTo(1, 2);
  expect(
    (await paintedOf(ana.page, id)).box!.width,
    'and it is painted as big as the box the drag made',
  ).toBeCloseTo(grown.width * FIT.zoom, 0);

  // Drag the same corner back through the board and past the edge of the world: it stops.
  await dragHandle(ana.page, 'se', -6000, -6000);
  const floor = await imageOf(ana.page, id);
  expect(Math.min(floor.width, floor.height), 'a picture has a smallest it can be').toBeLessThanOrEqual(
    IMAGE_MIN_SIZE_WORLD + 1,
  );
  expect(Math.min(floor.width, floor.height), 'and it stops there, not through the floor').toBe(
    IMAGE_MIN_SIZE_WORLD,
  );
  expect(floor.width, 'neither side goes under').toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
  expect(
    floor.width / floor.height / ratio,
    // The height runs out of room first on a picture this wide, so the height is what stops the drag —
    // and the width comes with it, which is the difference between stopping and being squashed.
    'even at the floor it is still the picture\'s own shape',
  ).toBeCloseTo(1, 2);
  expect(floor.status, 'resizing a picture is not uploading it again').toBe('ready');
  expect(await imageSrc(ana.page, id), 'the same address, still').toBeTruthy();

  // Ben comes along later, in a browser that has never seen this board.
  const ben = await openParticipant(browser, boardId, 'Ben');
  await setCamera(ben.page, FIT);
  const [seen] = await waitForImageCount(ben.page, 1);
  expect(seen!.id).toBe(id);
  expect(seen!.assetKey).toBe(await (await imageOf(ana.page, id)).assetKey);
  expect([seen!.width, seen!.height]).toEqual([floor.width, floor.height]);
  await waitForDrawnCount(ben.page, 1, E2E_EVENTUAL_TIMEOUT_MS);

  expect(ana.pageErrors, `page errors: ${ana.pageErrors.join('; ')}`).toEqual([]);
  expect(ben.pageErrors, `page errors: ${ben.pageErrors.join('; ')}`).toEqual([]);
  await ana.close();
  await ben.close();
});

/**
 * TC-28 (image.upload_failure, image.placeholder_other): an upload that does not work. Rosa drops a
 * file and the request for the bucket dies on the way. Her box turns red and says "Upload failed" with
 * two ways out; Kai, who never had the file, sees a grey box that says "Image unavailable" and offers
 * nothing, because there is nothing he can do. Then the network stops being broken, Rosa presses
 * Retry, and the picture appears on both their screens — the same object, the same place on the board,
 * with a second try behind it and no second box.
 */
test('TC-28 an upload that dies, and the Retry that finishes it, on both screens', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const [rosa, kai] = await createParticipants(browser, boardId, ['Rosa', 'Kai']);
  for (const person of [rosa, kai]) await setCamera(person.page, FIT);

  await rosa.page.route(isUpload, (route: Route) => void route.abort());

  await dropFiles(rosa.page, [fixtureFile('screenshot-1440x900.png')], DROP_AT);
  const [dropped] = await waitForImageCount(rosa.page, 1);
  const id = dropped!.id;

  const hers = await waitForPainted(rosa.page, id, 'failed');
  expect(hers.stateText).toBe('Upload failed');
  expect(hers.retry, 'the person who has the file is offered another go').toBe(true);
  expect(hers.remove, 'and a way to take it back').toBe(true);

  const his = await waitForPainted(kai.page, id, 'unavailable');
  expect(his.stateText).toBe('Image unavailable');
  expect(his.retry, 'Kai has no file to send').toBe(false);
  expect(his.remove, 'and a grey box is not his to tidy up').toBe(false);
  expect(
    (await imageOf(kai.page, id)).status,
    'the failure is in the document, which is how he knows',
  ).toBe('failed');

  // The network mends. Retry sends the same file again — the same object, not a new box beside it.
  await rosa.page.unroute(isUpload);
  await rosa.page.getByTestId(`image-retry-${id}`).click();
  // However far it has got when the test next looks, it is the same object trying again: not a new box
  // beside the old one, and not the old one left behind.
  expect(['uploading', 'ready']).toContain((await imageOf(rosa.page, id)).status);
  expect(await imagesOn(kai.page)).toHaveLength(1);

  await expect
    .poll(async () => (await imagesOn(rosa.page))[0]!.status, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('ready');
  const finished = await imageOf(rosa.page, id);
  expect(finished.id, 'the same object it always was').toBe(id);
  expect([finished.x, finished.y], 'in the same place it was left').toEqual([dropped!.x, dropped!.y]);

  for (const person of [rosa, kai]) {
    const box = await waitForPainted(person.page, id, 'ready');
    expect(box.src).toBe(`/api/assets/${finished.assetKey}`);
    // The document says ready before the picture has finished arriving, which is the correct order for
    // a board: waiting for the bytes is the screen's job, not the document's lie.
    await waitForDrawnCount(person.page, 1, E2E_EVENTUAL_TIMEOUT_MS);
  }

  // A refused request is news the board reports, not an exception it throws.
  expect(rosa.pageErrors, `page errors: ${rosa.pageErrors.join('; ')}`).toEqual([]);
  expect(kai.pageErrors, `page errors: ${kai.pageErrors.join('; ')}`).toEqual([]);

  await rosa.close();
  await kai.close();
});

/**
 * TC-28b (image.upload_stalled): an upload that never answers. The person who dropped the file is
 * still told it is going, because as far as they know it is. Somebody looking at the same board five
 * minutes later is told the truth instead: "Image upload didn't finish", with a Remove button, because
 * a box that has been empty for five minutes is not a promise any more, it is litter — and the litter
 * can be swept up by whoever is standing there, which puts it out of both boards at once.
 */
test('TC-28b an upload that never finishes says so, to everybody but the person waiting', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const [mia, noor] = await createParticipants(browser, boardId, ['Mia', 'Noor']);
  for (const person of [mia, noor]) await setCamera(person.page, FIT);

  // An upload that is never answered: no failure, no answer, nothing.
  await mia.page.route(isUpload, () => {});
  await dropFiles(mia.page, [fixtureFile('swatch-100x100.png')], DROP_AT);
  const [dropped] = await waitForImageCount(mia.page, 1);
  const id = dropped!.id;

  expect((await waitForPainted(noor.page, id, 'uploading')).stateText).toBe('Uploading…');

  // Five minutes and a second, on Noor's clock only. Nobody knows what time it is on anybody else's
  // machine; what a placeholder's box says is judged against the clock of the person looking.
  await noor.page.clock.install();
  await noor.page.clock.runFor(IMAGE_UPLOAD_STALE_MS + 1_000);
  await noor.page.clock.resume();

  const stale = await waitForPainted(noor.page, id, 'unfinished');
  expect(stale.stateText).toBe("Image upload didn't finish");
  expect(stale.retry, 'nobody knows which upload this was, so there is nothing to send again').toBe(
    false,
  );
  expect(stale.remove, 'somebody can clear the board').toBe(true);

  // Mia, five minutes younger, is still waiting politely: the box on her screen is the one that is
  // allowed to keep saying "uploading", because on her board it is.
  expect((await paintedOf(mia.page, id)).status, 'her box still says it is going').toBe('uploading');

  // And Noor can take it back: one press, and it is out of both documents.
  await noor.page.getByTestId(`image-remove-${id}`).click();
  await expect
    .poll(async () => (await imagesOn(noor.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(0);
  await expect
    .poll(async () => (await imagesOn(mia.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(0);

  expect(noor.pageErrors, `page errors: ${noor.pageErrors.join('; ')}`).toEqual([]);
  await mia.close();
  await noor.close();
});

/**
 * The drop highlight and the pointer's shape (image.drop): the frame appears when files come over the
 * window, says "let go and something will happen" while they are over it, and goes away when they
 * leave — without anything ever being dropped, uploaded or created.
 */
test('TC-25b a board says "drop them here" while the files are over it, and stops when they are not', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const mia = await openParticipant(browser, boardId, 'Mia');
  await setCamera(mia.page, FIT);

  const frame = mia.page.getByTestId('drop-highlight');
  await expect(frame, 'nothing is over the board yet').toHaveCount(0);

  const files: FileToDrop[] = [fixtureFile('swatch-100x100.png')];
  await dragFilesOver(mia.page, files, DROP_AT);

  await expect(frame).toBeVisible();
  // A frame and not a fill: the pictures have to stay visible behind the frame aimed at them.
  expect(await frame.evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
  // And the pointer is told what will happen, which is the browser's own way of saying "copy".
  expect(
    await mia.page.evaluate((point) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(8)], 'x.png', { type: 'image/png' }));
      const event = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        dataTransfer: transfer,
      });
      document.elementFromPoint(point.x, point.y)?.dispatchEvent(event);
      return event.defaultPrevented ? 'allowed' : 'not allowed';
    }, DROP_AT),
    'a drop the board did not accept would be a browser search for the file',
  ).toBe('allowed');

  await dragFilesAway(mia.page);
  await expect(frame, 'the files went away, and so did the frame').toHaveCount(0);

  // Nothing was dropped, so nothing was made.
  expect(await imagesOn(mia.page)).toEqual([]);
  expect(mia.pageErrors, `page errors: ${mia.pageErrors.join('; ')}`).toEqual([]);

  await mia.close();
});
