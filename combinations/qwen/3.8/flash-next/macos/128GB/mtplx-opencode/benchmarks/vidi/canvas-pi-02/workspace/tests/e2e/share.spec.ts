import { expect, test as base, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { boardPath, createBoard, visitor } from './helpers/boards';

/**
 * Sharing a board with a link (story 5, tasks 7: TC-26 to TC-31 in the browser).
 *
 * These are the cases that only exist end to end. The router, the existence
 * check and the clipboard fallback all *depend on the gap between two programs*
 * — a page and a Worker, a button and a browser's clipboard policy — and a jsdom
 * test can only assert that something "did not throw".
 *
 * The thing every case here shares is that a wrong address must be *obvious*
 * rather than quiet. A truncated link that opens an empty board is the failure
 * this story exists to kill: it looks like the person's own work, and the board
 * they meant to open keeps existing next door (`live.no_fork`).
 *
 * TC-31 (a board written before this story existed, with content but no creation
 * marker) is not here, and is not skipped to make it look covered. It cannot be
 * arranged from a browser without giving the harness a way to write board storage
 * over HTTP, which is a hole in the product kept open for the tests. It is
 * covered in `tests/integration/board-api.test.ts`, where the same state can be
 * put into a real board's storage directly.
 */

type ShareFixtures = {
  /** The client address this test's page asks the service with. */
  address: string;
};

const test = base.extend<ShareFixtures>({
  // One visitor per test. Board creation is limited per visitor, and the whole
  // machine is one visitor to the Worker, so a suite that makes a hundred and
  // twenty boards spends a ten-a-minute allowance before it notices, and then
  // fails a test that has nothing to do with rate limiting.
  //
  // The address comes from the test's title *and* its browser and worker slot:
  // three projects run this file at once, and while one browser's tests never
  // overlap in a process, two browsers do.
  address: async ({}, use, testInfo) => {
    await use(
      visitor(testInfo.title, `${testInfo.project.name}:${testInfo.parallelIndex}`),
    );
  },

  page: async ({ page, address }, use) => {
    await page.setExtraHTTPHeaders({ 'CF-Connecting-IP': address });
    await use(page);
  },
});

/** Every socket the page tried to open, for the "nothing connected" cases. */
function sockets(page: Page): string[] {
  const opened: string[] = [];
  page.on('websocket', (socket) => opened.push(socket.url()));
  return opened;
}

/** The note texts a page's live document holds, lowest z first. */
const noteTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.__vidi6?.getNotes().map((note) => note.text) ?? []);

/** Wait for a page's board to have a live room, then hand it back. */
async function connected(page: Page): Promise<Page> {
  await expect(page.getByTestId('board-page')).toBeVisible();
  await page.waitForFunction(() => window.__vidi6?.getConnectionState() === 'connected');
  return page;
}

/**
 * Record what the page tried to put on the clipboard.
 *
 * The clipboard is a browser *privilege*, not an app feature: `clipboard-read`
 * is a Chromium permission, and Firefox and WebKit in this harness do not
 * implement it at all, so a check that reads the clipboard back can only ever
 * run on one of the three browsers. Recording the write works everywhere and
 * still fails when the panel copies the wrong thing, which is the bug worth
 * catching. The real clipboard is checked separately, on Chromium, below.
 */
async function watchClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const written: string[] = [];
    (window as unknown as { __clipboard: string[] }).__clipboard = written;
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
  });
}

const copied = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __clipboard?: string[] }).__clipboard ?? []);

test('TC-26 the home page creates a board, and the button is the only way in', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();

  await page.getByTestId('create-board').click();

  // The create budget is two seconds, and the page that follows is a board, not
  // a spinner that never resolves.
  await expect(page.getByTestId('board-page')).toBeVisible({ timeout: 5_000 });
  expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('share-trigger')).toBeVisible();
});

test('TC-26 the link is the board: create, copy, and join as a second person', async ({
  page,
  context,
  browserName,
}) => {
  // The golden path, with the link actually *traveling*: it leaves Maya's board
  // through the clipboard and is pasted as an address in a browser that has no
  // memory of ever having been here. That is the story's unit of work — not "a
  // second page can load a URL", but "what Maya copied is what Sam needs".
  test.skip(
    browserName !== 'chromium',
    'reads the clipboard back, which only Chromium lets a test do here; the copy path itself is checked on all three browsers in the next test',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  // Maya: create a board and put something on it.
  await page.goto('/');
  await page.getByTestId('create-board').click();
  await connected(page);
  await page.evaluate(() => {
    window.__vidi6?.seedNote({ x: 0, y: 0, text: 'quarterly goals' });
  });

  // Maya: Share, Copy link.
  await page.getByTestId('share-trigger').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toHaveText('Link copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());

  // The clipboard holds a complete address, because a link that lost its last
  // three characters is the bug this whole story is about.
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:5178\/b\/[A-Za-z0-9_-]{22}$/);
  expect(link).toBe(page.url());

  // Sam: a fresh context, which is a different *person* rather than a second
  // tab — no shared storage, no shared sockets, nothing remembered.
  const samContext = await context.browser()!.newContext();
  await samContext.setExtraHTTPHeaders({ 'CF-Connecting-IP': '203.0.199.7' });
  const sam = await samContext.newPage();
  await sam.goto(link);
  await connected(sam);

  // Sam is on the same board, not a copy of it: Maya's note arrived as data.
  await expect.poll(() => noteTexts(sam), { timeout: 15_000 }).toContain('quarterly goals');
  expect(await sam.evaluate(() => window.__vidi6?.getBoardId())).toBe(
    await page.evaluate(() => window.__vidi6?.getBoardId()),
  );

  // Sam adds a note, and Maya's board changes without anyone touching it. This
  // is the half that proves they are in one room: the link did not open a
  // private copy for the second person.
  await sam.evaluate(() => {
    window.__vidi6?.seedNote({ x: 220, y: 0, text: 'Sam was here' });
  });
  await expect
    .poll(() => noteTexts(page), { timeout: 15_000 })
    .toContain('Sam was here');

  await samContext.close();
});

test('TC-26 the link the panel copies is this board, in every browser', async ({ page }) => {
  await watchClipboard(page);
  const boardId = await createBoard(page.request, 'TC-26 copy');
  await page.goto(boardPath(boardId));
  await expect(page.getByTestId('board-page')).toBeVisible();

  await page.getByTestId('share-trigger').click();
  await expect(page.getByTestId('share-panel')).toBeVisible();
  const link = `http://127.0.0.1:5178/b/${boardId}`;
  await expect(page.getByTestId('share-link')).toHaveValue(link);

  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('share-copy')).toHaveText('Link copied');
  // Exactly one write, and it is this board's address: not the path, not the id
  // on its own, not the board that was open a minute ago.
  await expect.poll(() => copied(page)).toEqual([link]);

  // The note is always there: a link is only worth sharing with the caveat
  // attached to it.
  await expect(page.getByTestId('share-note')).toHaveText(
    'Anyone with this link can view and edit this board.',
  );
});

test('TC-27 a paste that lost characters is a dead end you can see', async ({ page }) => {
  const boardId = await createBoard(page.request, 'TC-27 truncated');
  const truncated = boardId.slice(0, 19);
  const opened = sockets(page);

  await page.goto(boardPath(truncated));

  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await expect(page.getByTestId('not-found-advice')).toHaveText(
    'Check the link, or ask the person who shared it to send it again.',
  );
  // The address that was tried is shown back: that is how a person spots the
  // three characters Slack ate.
  await expect(page.getByTestId('share-link')).toHaveValue(
    `http://127.0.0.1:5178/b/${truncated}`,
  );

  await page.waitForTimeout(1_500);
  expect(opened).toEqual([]);

  // The board that was meant to be opened is still itself, and the truncated
  // address never became a second one: `live.no_fork`, checked on the server
  // rather than in the pixels.
  expect((await page.request.get(`/api/boards/${boardId}`)).status()).toBe(200);
  expect((await page.request.get(`/api/boards/${truncated}`)).status()).toBe(404);
});

test('TC-27 a wrong link offers a way to get on with it', async ({ page }) => {
  // Someone with no board of their own, holding a link that goes nowhere: the
  // page has to leave them somewhere useful, which is either the home page or a
  // board they made from right here.
  await page.goto(boardPath('AbCdEfGhIjKlMnOpQrStU0'));
  await expect(page.getByTestId('not-found-page')).toBeVisible();

  await page.getByTestId('create-board').click();
  await expect(page.getByTestId('board-page')).toBeVisible({ timeout: 5_000 });
  expect(page.url()).toMatch(/\/b\/[A-Za-z0-9_-]{22}$/);

  // And the room they landed in is the board they just made, not the one the
  // address named.
  expect(await page.evaluate(() => window.__vidi6?.getBoardId())).not.toBe(
    'AbCdEfGhIjKlMnOpQrStU0',
  );
});

test('TC-27 the back link returns to the home page', async ({ page }) => {
  await page.goto(boardPath('AbCdEfGhIjKlMnOpQrStUv'));
  await expect(page.getByTestId('not-found-page')).toBeVisible();
  await page.getByTestId('home-link').click();
  await expect(page.getByTestId('home-page')).toBeVisible();
  expect(page.url()).toMatch(/\/$/);
});

test('TC-27 the legacy /board/ address still opens a real board', async ({ page }) => {
  // Stories 3 and 4 wrote bookmarks and screenshots with `/board/` in them; a
  // person following one of those is not doing anything wrong, and must not be
  // told the board is missing.
  const boardId = await createBoard(page.request, 'TC-27 legacy path');
  await page.goto(`/board/${boardId}`);
  await connected(page);
  expect(await page.evaluate(() => window.__vidi6?.getBoardId())).toBe(boardId);
});

test('TC-28 an unreachable service says so, and comes back without a reload', async ({
  page,
  request,
}) => {
  const boardId = await createBoard(request, 'TC-28');

  // Cut the check off, so the page has to live with "I could not ask".
  await page.route('**/api/boards/**', (route) => void route.abort());
  await page.goto(boardPath(boardId));

  // It says the service is unreachable rather than claiming the board is gone:
  // the second would tell someone their work has been deleted, and it would be
  // untrue the moment the network comes back.
  await expect(page.getByTestId('board-loading-text')).toHaveText(
    "Couldn't reach vidi6. Retrying\u2026",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('not-found-page')).toHaveCount(0);

  // Let the service answer again, and the board arrives on its own — nobody has
  // to reload anything.
  await page.unroute('**/api/boards/**');
  await connected(page);
});

test('TC-29 a denied clipboard still leaves the link one keystroke away', async ({
  page,
}) => {
  // No clipboard at all, which is what a non-secure context (someone opening a
  // link over plain http from another machine) or a denied permission looks like
  // from the page's side.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    });
  });
  const boardId = await createBoard(page.request, 'TC-29');
  await page.goto(boardPath(boardId));
  await expect(page.getByTestId('board-page')).toBeVisible();

  await page.getByTestId('share-trigger').click();
  await page.getByTestId('share-copy').click();

  await expect(page.getByTestId('share-manual')).toHaveText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );
  // The link is selected, so Ctrl+C really does copy it — the message is not a
  // taunt.
  expect(
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('[data-testid="share-link"]');
      return field?.value.slice(0, field.selectionEnd - field.selectionStart);
    }),
  ).toBe(`http://127.0.0.1:5178/b/${boardId}`);
});

test('TC-30 a rate-limited create says so, and does not pretend to work', async ({
  page,
  request,
  address,
}) => {
  // Spend this visitor's allowance first, through the API, rather than by
  // clicking Create ten times. What is under test is the *page's* reaction to a
  // 429 — the message, and the fact that it does not navigate — not the
  // limiter's arithmetic, which the integration suite checks against the real
  // binding. Clicking ten times made this test depend on how loaded the machine
  // was, which is not a thing a test may quietly depend on.
  let limited = false;
  for (let attempt = 0; attempt < 25 && !limited; attempt += 1) {
    const response = await request.post('/api/boards', {
      headers: { 'CF-Connecting-IP': address },
    });
    limited = response.status() === 429;
  }
  expect(limited).toBe(true);

  // Same visitor, now out of budget, clicking the button.
  await page.goto('/');
  await page.getByTestId('create-board').click();

  await expect(page.getByTestId('create-limited')).toHaveText(
    "You're creating boards too quickly. Wait a minute and try again.",
  );
  // No navigation: no board was made, and the page does not look as if one was.
  expect(page.url()).toMatch(/\/$/);
  await expect(page.getByTestId('board-page')).toHaveCount(0);
});

test('TC-30 a create that fails outright leaves the button working', async ({ page }) => {
  await page.route('**/api/boards', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  await page.getByTestId('create-board').click();

  await expect(page.getByTestId('create-failed')).toHaveText(
    "Couldn't create a board. Please try again.",
  );
  await expect(page.getByTestId('create-board')).toBeEnabled();

  // The same button, with the service back, makes a board: the failure was a
  // message, not a dead end.
  await page.unroute('**/api/boards');
  await page.getByTestId('create-board').click();
  await expect(page.getByTestId('board-page')).toBeVisible({ timeout: 5_000 });
});

test('back and forward between home and a board land on the right page', async ({ page }) => {
  // What this pins is the round trip, not the router's history subscription.
  // Crossing back from `/b/<id>` to `/` is a cross-document history navigation,
  // so the browser loads home again and the listener is not what makes it work —
  // verified by removing the listener and watching this test stay green. It is
  // worth having anyway: it is the only place that checks a person can leave a
  // board and come back to a *working* one, which catches a page restored from
  // cache with its socket gone — the failure a same-origin reload would hide.
  await page.goto('/');
  await page.getByTestId('create-board').click();
  await connected(page);
  const boardId = await page.evaluate(() => window.__vidi6?.getBoardId());
  expect(boardId).toBeTruthy();

  await page.goBack();
  await expect(page.getByTestId('home-page')).toBeVisible();
  await expect(page.getByTestId('board-page')).toHaveCount(0);
  // Home came back as itself, not as a frozen picture of itself: the button is
  // there, named, and armed.
  await expect(page.getByTestId('create-board')).toHaveText('Create a board');

  // Forward has to give the board back *with a room behind it*. A page that
  // redraws the canvas and never reconnects would satisfy a screenshot and fail
  // a person, so the check is the connection, not the pixels.
  await page.goForward();
  await connected(page);
  expect(await page.evaluate(() => window.__vidi6?.getBoardId())).toBe(boardId);
});

test('the dead end offers a way home that leads somewhere still working', async ({ page }) => {
  // The other exit from a board that is not there. Checked because it is a plain
  // link: pointing it at anything that is not the home page is invisible in a
  // screenshot, and this is the page a person reaches when everything else has
  // failed, so it is the worst place to run out of ways out. Verified live by
  // aiming it at `/board/`, which fails here and nowhere else.
  const guess = newBoardId();
  await page.goto(boardPath(guess));
  await expect(page.getByTestId('not-found-page')).toBeVisible();

  await page.getByTestId('home-link').click();
  await expect(page.getByTestId('home-page')).toBeVisible();

  // And home really is reachable, not rendered-and-stuck: the button still makes
  // a board, from here, into a room that answers.
  await page.getByTestId('create-board').click();
  await connected(page);
  expect(page.url()).not.toContain(guess);
});
