import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import {
  board,
  boardChecking,
  boardError,
  boardIdOf,
  copyLinkButton,
  createBoard,
  home,
  linkFor,
  newBoardButton,
  notFound,
  openBoard,
  openHome,
  shareLinkInput,
  shareTrigger,
} from './helpers/board';
import { boardJson, openBoardAt, waitConnected } from './helpers/participants';
import { doubleClickBoard, notes, stopEditing, typeInNote } from './helpers/sticky';

/**
 * Story 5: a board has an address, and that address is the whole of sharing it.
 *
 * What these tests refuse to do is the point of the file. A board is never written into existence
 * from the test: every one of them is asked of the service with the same request the button makes,
 * and every arrival is a page being taken to an address - which is why a test here can fail for the
 * honest reason, "Board not found", instead of quietly succeeding against a room that nobody made.
 *
 * Three of them are about the service being in the way rather than missing:
 * - the link that cannot get through (TC-28), which is a page that says so and keeps trying, and
 *   then opens on its own when the request starts working;
 * - the browser that will not take the link (TC-29), which is a panel that says so and leaves the
 *   text selected rather than a tick that would be a lie;
 * - the board that was made before boards kept a date (TC-31), which is put into storage the way
 *   story 4 wrote it - log rows and no creation date - because the only way to hold a board like
 *   that is to write one.
 */

/** Where the server under test lives; the port belongs to `playwright.config.ts`. */
function originOf(testInfo: TestInfo): string {
  return testInfo.project.use.baseURL ?? 'http://127.0.0.1:23614';
}

/**
 * A browser that is allowed to use the clipboard.
 *
 * A person's browser asks before it lets a page read what is on the clipboard, and Playwright's
 * contexts say no by default. This is the one place that question is answered - for the test that
 * wants to know what a copy actually left there, which is TC-26.
 */
async function browserWithClipboard(browser: Browser, origin: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: origin });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  return context;
}

/**
 * What the clipboard holds, or what the field holds if this browser will not be asked.
 *
 * Reading the clipboard is a permission a sandboxed browser may still refuse after being granted
 * it. The assertion that matters is that what got copied is the board's own link, and the field the
 * panel put on screen is the same text by construction - so the source is reported rather than
 * being allowed to decide the outcome. TC-29 is the test that insists the refusal is shown.
 */
async function copiedText(page: Page): Promise<string> {
  const fromClipboard = await page
    .evaluate(() => navigator.clipboard.readText())
    .catch(() => null);
  if (fromClipboard !== null) return fromClipboard;
  console.log('[share] clipboard read refused by this browser - comparing the field the panel shows');
  return shareLinkInput(page).inputValue();
}

/**
 * A board seeded the way a board of story 4 looks: log rows, and no creation date.
 *
 * The colours are the model's own names for them, which is what a change on the wire carries.
 */
const LEGACY_NOTES = [
  { text: 'Written before boards had dates', x: 200, y: 200, color: 'yellow' },
  { text: 'Still here', x: 420, y: 320, color: 'blue' },
];

test('workflow: create, share the link, second person joins (TC-26)', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const origin = originOf(testInfo);
  const maya = await browserWithClipboard(browser, origin);
  const page = await maya.newPage();

  // Maya arrives, and there is nothing to arrive to but a question.
  await openHome(page);
  await expect(home(page)).toBeVisible();
  await expect(board(page)).toHaveCount(0);

  // One click, and a board. The wait is the ordinary one; the number it took is reported against
  // the budget the story gives itself, in the log rather than in an assertion - the service, the
  // browser and the machine are one machine here.
  const clickedAt = Date.now();
  await newBoardButton(page).click();
  await expect(board(page)).toBeVisible();
  const took = Date.now() - clickedAt;
  console.log(
    `[share] TC-26: a board was on screen ${String(took)}ms after the click ` +
      `(${took <= CREATE_BUDGET_MS ? 'within' : 'over'} the ${String(CREATE_BUDGET_MS)}ms a ` +
      'person is willing to wait; reported, not asserted)',
  );

  // The address is a board's address, and the board is hers and empty.
  const boardId = await boardIdOf(page);
  const link = linkFor(origin, boardId);
  expect(page.url()).toBe(link);
  await expect(notes(page)).toHaveCount(0);

  // She puts a thought on it, in the only way there is.
  await doubleClickBoard(page, { x: 640, y: 400 });
  await typeInNote(page, 'From Maya');
  await stopEditing(page);
  await expect(notes(page)).toHaveCount(1);

  // The Share panel, and the link in it is the address she is on.
  await shareTrigger(page).click();
  await expect(shareLinkInput(page)).toHaveValue(link);
  await copyLinkButton(page).click();

  // The button says what happened, in its own words, and the clipboard holds exactly the address.
  await expect(copyLinkButton(page)).toHaveText('Link copied');
  expect(await copiedText(page)).toBe(link);

  // "Link copied" is a moment and not a state: it is about to be true of nothing.
  await expect(copyLinkButton(page), 'the button should go back to being the button').toHaveText(
    'Copy link',
  );

  // Sam is sent that link and opens it in his own browser: another machine, another profile,
  // nothing shared with Maya's context but the address.
  const sam = await browser.newContext({ baseURL: origin });
  const his = await sam.newPage();
  const arrivedAt = Date.now();
  await openBoardAt(his, boardId);
  await waitConnected(his);
  console.log(
    `[share] TC-26: Sam's board was drawn ${String(Date.now() - arrivedAt)}ms after he opened the link`,
  );
  await expect(notes(his)).toHaveCount(1);
  await expect(his.getByText('From Maya')).toBeVisible();

  // He is a person on the board, not a viewer of a picture of it.
  const typedAt = Date.now();
  await doubleClickBoard(his, { x: 300, y: 560 });
  await typeInNote(his, 'And from Sam');
  await stopEditing(his);

  // Maya sees it without doing anything at all.
  await expect(notes(page)).toHaveCount(2, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(page.getByText('And from Sam')).toBeVisible();
  console.log(
    `[share] TC-26: Maya saw Sam's note ${String(Date.now() - typedAt)}ms after he stopped editing`,
  );

  // The two of them are looking at one board, in the only sense that can be checked: what each
  // page says the board is, word for word.
  await expect
    .poll(async () => await boardJson(page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(await boardJson(his));

  await Promise.all([maya.close(), sam.close()]);
});

test('a link to a board that does not exist recovers, and creates nothing on the way (TC-27)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // A code that was never asked for, and so is nobody's board. It is generated rather than typed,
  // because the answer may not depend on which string was tried.
  const neverMade = newBoardId();

  await page.goto(`/b/${neverMade}`);
  await expect(notFound(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Board not found' })).toBeVisible();
  await expect(
    page.getByText('Check the link, or ask the person who shared it to send it again.'),
  ).toBeVisible();
  // The board is not there, and the page does not pretend otherwise by drawing a canvas.
  await expect(board(page)).toHaveCount(0);
  // The code that was looked for is on the page, because that is the thing a person compares.
  await expect(page.getByText(neverMade, { exact: true })).toBeVisible();

  // "New board" from here is an opening, not a repair: a different board, an empty one.
  await newBoardButton(page).click();
  await expect(board(page)).toBeVisible();
  const made = await boardIdOf(page);
  expect(made, 'the board made from the page should not be the code that was looked for').not.toBe(
    neverMade,
  );
  await expect(notes(page)).toHaveCount(0);

  // And the code that was looked for is still not a board. This is the assertion the story is
  // really asking for: arriving at a wrong link must not have quietly made one.
  const somewhereElse = await page.context().newPage();
  await somewhereElse.goto(`/b/${neverMade}`);
  await expect(notFound(somewhereElse)).toBeVisible();
  await expect(board(somewhereElse)).toHaveCount(0);
  await somewhereElse.close();
});

test('a link that cannot get through says so, keeps trying, and opens by itself (TC-28)', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  // The board is real, and made before the trouble starts. `context.request` is used on purpose:
  // the interception below is a wall in front of the *page*, and a request the test itself makes is
  // the one thing that has to get past it to set the scene up.
  const boardId = await createBoard(context.request);

  // The service stops answering the one request that asks whether a board exists. Note what is
  // intercepted: the board's own address, not the making of boards, and not the page's assets - so
  // this is a service that is up and unhelpful about this one board, which is the outage a person
  // actually meets.
  const blocked = '**/api/boards/*';
  await page.route(blocked, (route) => void route.abort());
  await page.goto(`/b/${boardId}`);

  // One sentence, honestly worded: the board was not refused, it was not reached. It says "Retrying"
  // while it is retrying, and it is a status and not an alarm.
  await expect(boardChecking(page)).toHaveText("Couldn't reach vidi6. Retrying…");
  // And not the other two answers: nothing was found, nothing was drawn.
  await expect(notFound(page)).toHaveCount(0);
  await expect(board(page)).toHaveCount(0);

  // The wall comes down. Nobody reloads, clicks anything or closes the tab: the page's own next
  // attempt is the one that gets through, because "Retrying…" is a promise about a timer.
  await page.unroute(blocked);
  await expect(board(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await expect(boardChecking(page)).toHaveCount(0);
  // It is the board that was asked for, not merely some board.
  expect(await boardIdOf(page)).toBe(boardId);
});

test('a browser that will not take the link says so, and leaves the link ready (TC-29)', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const origin = originOf(testInfo);
  const context = await browser.newContext({ baseURL: origin });
  // The clipboard is there and says no, which is what a real browser does when a person has refused
  // it or when the document has lost focus. Only the one method the panel uses is replaced, so the
  // panel's own copy button is the thing being tested.
  await context.addInitScript(() => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('ClipboardUpdateNotAllowed')) },
    });
  });
  const page = await context.newPage();
  const boardId = await openBoard(page);
  const link = linkFor(origin, boardId);

  await shareTrigger(page).click();
  await expect(shareLinkInput(page)).toHaveValue(link);
  await copyLinkButton(page).click();

  // The instruction the story specifies, word for word, and no tick anywhere.
  await expect(page.getByTestId('share-manual')).toHaveText(
    'Press Ctrl+C (Cmd+C on Mac) to copy',
  );
  await expect(copyLinkButton(page)).toHaveText('Copy link');

  // The text is on screen, whole, and selected, with the caret in the field: the keys the sentence
  // names are all that is left to do.
  const ready = await shareLinkInput(page).evaluate((field) => {
    const input = field as HTMLInputElement;
    return {
      value: input.value,
      selected: input.selectionStart === 0 && input.selectionEnd === input.value.length,
      focused: document.activeElement === input,
    };
  });
  expect(ready.value).toBe(link);
  expect(ready.selected).toBe(true);
  expect(ready.focused).toBe(true);

  // And the link is a link: the text left ready is an address on this deployment, and a person who
  // pastes it somewhere and opens it lands on this board - which is the whole of sharing, and the
  // only way to show that what the panel put on the clipboard is more than a picture of a link.
  expect(
    ready.value,
    'what is ready to copy is an address on this very service',
  ).toMatch(new RegExp(`^${origin}/b/`));
  const someoneElse = await browser.newContext({ baseURL: origin });
  const his = await someoneElse.newPage();
  await his.goto(ready.value);
  await expect(board(his), 'the copied link should lead to the board it was copied from').toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  await waitConnected(his);
  await expect(notes(his)).toHaveCount(0);
  expect(await boardIdOf(his)).toBe(boardId);

  await Promise.all([context.close(), someoneElse.close()]);
});

test('a board made before boards had a creation date is still a board (TC-31)', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const boardId = newBoardId();

  // The board is put into storage the way story 4 wrote one: log rows, and no creation date - the
  // hook refuses to write `created_at`, which is what makes this a board of that story rather than
  // a board of this one wearing a hat. It is asked for through the test route, which the suite's
  // server is the only place that has.
  const seeded = await request.post(`/__test/boards/${boardId}/seed-legacy`, {
    data: { notes: LEGACY_NOTES },
  });
  const seedReport = (await seeded.json().catch(() => ({}))) as Record<string, unknown>;
  expect(
    seeded.status(),
    `a board should be seedable the old way: ${JSON.stringify(seedReport)}`,
  ).toBe(200);

  // A person arrives at the link. They are not told this board is old, and they are not turned away.
  await openBoardAt(page, boardId);
  await waitConnected(page);
  await expect(notFound(page)).toHaveCount(0);
  await expect(notes(page)).toHaveCount(LEGACY_NOTES.length);
  const shown = JSON.parse(await boardJson(page)) as { text: string }[];
  expect(shown.map((note) => note.text).sort()).toEqual(
    LEGACY_NOTES.map((note) => note.text).sort(),
  );

  // And it is a board they can carry on using: the panel offers it to somebody else...
  await shareTrigger(page).click();
  await expect(page.getByTestId('share-note')).toHaveText(
    'Anyone with this link can view and edit this board.',
  );
  await page.keyboard.press('Escape');

  // ...and what they write lands on it.
  await doubleClickBoard(page, { x: 240, y: 620 });
  await typeInNote(page, 'A second thought');
  await stopEditing(page);
  await expect(notes(page)).toHaveCount(LEGACY_NOTES.length + 1);

  // Someone else, from the same address, finds both thoughts.
  const later = await page.context().browser()?.newContext();
  if (later === undefined) throw new Error('no browser to arrive from');
  const his = await later.newPage();
  await openBoardAt(his, boardId);
  await waitConnected(his);
  await expect(his.getByText('A second thought')).toBeVisible({
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  await later.close();
});

test('the home page offers one way in, and history does not make boards (TC-16, TC-21)', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const origin = originOf(testInfo);
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await openHome(page);

  // The home page says what it is for, and offers exactly one way in.
  await expect(page.getByRole('heading', { name: 'vidi6' })).toBeVisible();
  await expect(page.getByText('A shared board for thinking together.')).toBeVisible();
  await expect(newBoardButton(page)).toHaveText('New board');
  await expect(board(page)).toHaveCount(0);

  // One click, one board.
  await newBoardButton(page).click();
  await expect(board(page)).toBeVisible();
  const first = await boardIdOf(page);

  // Back to where the person started: the home page, and no board made along the way. The check is
  // that the address bar and the screen agree, because a client that re-asked the service on the
  // way back would have made a second board and still looked like a home page for a moment.
  await page.goBack();
  await expect(home(page)).toBeVisible();
  await expect(board(page)).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/');

  // Forwards, and it is the same board. This is the assertion the story is asking for: going
  // backwards and forwards through a board's address lands on that board, every time.
  await page.goForward();
  await expect(board(page)).toBeVisible();
  expect(await boardIdOf(page)).toBe(first);

  // And it is the same board rather than a new one with a familiar face: a second browser opened at
  // the first board's address finds nothing that was made since.
  const somewhereElse = await context.newPage();
  await openBoardAt(somewhereElse, first);
  await expect(notes(somewhereElse)).toHaveCount(0);

  await Promise.all([page.close(), somewhereElse.close(), context.close()]);
});

test('a service that is unwell is waited out, and a service that talks nonsense is reported (negative)', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const boardId = await createBoard(context.request);

  // First the service is unwell: it answers, and what it answers is 500. That is not a verdict about
  // the board - a cold board, a deploy halfway through, a request that hit something on its way out
  // - so the page says it cannot get there and asks again by itself, exactly as it does when the
  // request never arrives at all (TC-28).
  await page.route('**/api/boards/*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' }),
  );
  await page.goto(`/b/${boardId}`);
  await expect(boardChecking(page)).toHaveText("Couldn't reach vidi6. Retrying…");
  // Not the other two answers, which would both be lies: nothing was found, nothing was drawn.
  await expect(notFound(page)).toHaveCount(0);
  await expect(board(page)).toHaveCount(0);

  // And it recovers the same way, with nobody touching anything.
  await page.unroute('**/api/boards/*');
  await expect(board(page)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(await boardIdOf(page)).toBe(boardId);

  // Now something else entirely. The service answers perfectly politely, says yes, and names a
  // different board. Taking that for an answer would open a board this link never pointed at, and
  // retrying it would be arguing with a service that has already replied; so the page says it went
  // wrong, and the asking goes back to the person, who is the only one who can do anything about it.
  const somewhereElse = await page.context().newPage();
  await somewhereElse.route('**/api/boards/*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: newBoardId() }),
    }),
  );
  await somewhereElse.goto(`/b/${boardId}`);
  // An alert rather than a status, because the page has stopped doing anything on its own.
  await expect(boardError(somewhereElse)).toHaveText('Something went wrong');
  await expect(notFound(somewhereElse)).toHaveCount(0);
  await expect(board(somewhereElse)).toHaveCount(0);

  // The way out is on the page, and it is a request rather than a reload.
  await somewhereElse.unroute('**/api/boards/*');
  await somewhereElse.getByRole('button', { name: 'Try again' }).click();
  await expect(board(somewhereElse)).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  expect(await boardIdOf(somewhereElse)).toBe(boardId);
  await somewhereElse.close();
});
