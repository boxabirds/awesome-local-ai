import { test, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { LOAD_RETRY_MIN_INTERVAL_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { noteSeeds, type NoteSeed } from '../fixtures/boards';
import { RoomClient, seedBoard } from './helpers/room-client';
import { badge, boardJson, openBoardAt, waitConnected } from './helpers/participants';
import {
  createStickyButton,
  doubleClickBoard,
  noteId,
  notes,
  stopEditing,
  textAt,
  typeInNote,
} from './helpers/sticky';

/**
 * Story 4, TC-24: a board that cannot be read says so, and comes back on its own when it can.
 *
 * This is the one test in the suite that breaks a board's storage on purpose, and it is where the
 * story is joined up in front of a person: a row in the room's own SQLite table holds bytes that are
 * not a board; the room reads it and cannot; the client is told with a close code of its own; the
 * page shows one red sentence and refuses to let anybody edit what it cannot vouch for; the row is
 * put back; and the board arrives by itself, with nobody reloading anything.
 *
 * Two things about how it is done are worth seeing:
 *
 * - The damage is done to stored bytes, through the test switches in `src/worker/test-hooks.ts`, and
 *   nothing between the storage and the person is mocked. The room reads the damaged row for real,
 *   yjs fails on it for real, the close frame is a real close frame, and the client's own reconnect
 *   timer is what brings the board back.
 * - The page is never reloaded, from the moment the damage is seen until the moment the board
 *   returns. A marker is left on the page's own `window` in between and read back afterwards: had the
 *   page been reloaded the marker would be gone, and a recovery that needed a reload would be a
 *   different feature from the one the story promises.
 *
 * The board is made through the room's sync path rather than by clicking, for the reason TC-21 found:
 * twenty-five notes made one drag and one keystroke at a time cost about half a minute, and the
 * waiting would be a measurement of this machine rather than of the story. What the board is comes
 * from the room's own answer (see `seedBoard`), and the board the page draws is compared against the
 * same room's readout from before the damage - `boardJson`, which every other test here uses.
 */

/** The sentence a board that cannot be read shows, in the words the product uses. */
const CANNOT_LOAD = "This board couldn't be loaded. Retrying…";

/** `#7f1d1d`, the red that sentence is written in, as a browser spells a colour back. */
const RED = 'rgb(127, 29, 29)';

/** A switch the suite can ask a room to run on its own storage; see `src/worker/test-hooks.ts`. */
type TestSwitch = 'compact' | 'corrupt-snapshot' | 'repair-snapshot' | 'read-again';

/** The room's own door for a board, on whatever server the page came from. */
function roomOf(origin: string, boardId: string): string {
  return `${origin.replace(/^http/, 'ws')}/api/rooms/${boardId}`;
}

/**
 * Ask the room to run a switch on its own storage, and report what it answered.
 *
 * A switch that was refused answers 409 with the reason in the body rather than failing quietly: a
 * test that went on from a refused switch would be watching a recovery from damage that was never
 * done.
 */
async function runSwitch(
  request: APIRequestContext,
  boardId: string,
  step: TestSwitch,
): Promise<{ ok: boolean; [key: string]: unknown }> {
  const response = await request.post(`/__test/boards/${boardId}/${step}`);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...body, ok: body['ok'] === true && response.status() < 400 };
}

/** What the room says its lifecycle is, once it has read its board again. */
async function stateAfterReadingAgain(
  request: APIRequestContext,
  boardId: string,
): Promise<string> {
  const answered = await runSwitch(request, boardId, 'read-again');
  return typeof answered['state'] === 'string'
    ? answered['state']
    : `refused: ${String(answered['error'] ?? 'no reason given')}`;
}

/**
 * The server the suite is running against.
 *
 * Taken from the project rather than written out here, because the port belongs to
 * `playwright.config.ts` and this file is not the place a port gets changed.
 */
function originOf(testInfo: TestInfo): string {
  return testInfo.project.use.baseURL ?? 'http://127.0.0.1:23614';
}

test.describe('a board that could not be read', () => {
  test('workflow: broken board - honest failure, no editing, recovery without a reload (TC-24)', async ({
    browser,
    request,
  }, testInfo) => {
    test.setTimeout(300_000);
    const boardId = newBoardId();
    const origin = originOf(testInfo);

    // A board, and the room's own answer about what it holds: twenty-five notes with text on them.
    const written = await seedBoard(roomOf(origin, boardId), noteSeeds());
    expect(written).toHaveLength(noteSeeds().length);

    // Somebody opens it, and it is a board. This is the state that has to come back, so it is
    // written down while it is still here.
    const before = await browser.newContext();
    const opening = await before.newPage();
    await openBoardAt(opening, boardId);
    await waitConnected(opening);
    await expect(notes(opening)).toHaveCount(written.length);
    const left = await boardJson(opening);
    expect(JSON.parse(left)).toHaveLength(written.length);

    // The log is folded into a snapshot, because what is about to be damaged is a snapshot. A board
    // of twenty-five notes gets one only after the room has folded it up by itself, which happens
    // after hundreds of changes; a person is not going to make hundreds of changes while a test
    // watches, and the fold-up the switch runs is the room's own.
    const folded = await runSwitch(request, boardId, 'compact');
    expect(folded.ok).toBe(true);
    expect(Number(folded['chunks'])).toBeGreaterThan(0);

    // The damage: the first chunk of that snapshot now holds a sentence about not being a yjs
    // update, and the room has no idea yet.
    const damaged = await runSwitch(request, boardId, 'corrupt-snapshot');
    expect(damaged.ok).toBe(true);
    expect(Number(damaged['bytes'])).toBeGreaterThan(0);

    // The person leaves, and the room reads its board again, which is what a wake is. It refuses
    // while anybody is still connected - a room being woken is a room nobody is looking at - so
    // asking until it accepts is also the wait for that socket to have gone.
    await before.close();
    await expect
      .poll(() => stateAfterReadingAgain(request, boardId), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the room should read its board again and find it unreadable',
      })
      .toBe('load-failed');

    // A person arrives. There is no board to show them.
    const after = await browser.newContext();
    const page = await after.newPage();
    await openBoardAt(page, boardId);

    // One sentence. It is the message the story asks for, it is written in red, and it carries the
    // role that makes a screen reader say it (`role=status` is a live region, so it is announced
    // when it appears and again when it goes away, which is what the person is told: not "the board
    // is empty", which would be a lie, but "this board could not be read, and we are trying again").
    await expect(badge(page)).toHaveText(CANNOT_LOAD);
    await expect(badge(page)).toBeVisible();
    await expect(badge(page)).toHaveAttribute('role', 'status');
    await expect
      .poll(() => messageColour(page), { timeout: 5_000, message: 'the message is written in red' })
      .toBe(RED);

    // Nothing that pretends to be the board: no notes, and no empty board being passed off as one
    // that happens to be empty.
    await expect(notes(page)).toHaveCount(0);

    // And nothing to edit with. Not "editing is disabled somewhere in the code": both ways a person
    // makes a note, tried with the mouse, and no note appears.
    await expect(createStickyButton(page)).toBeDisabled();
    await clickTheMiddleOf(page, createStickyButton(page));
    await expect(notes(page)).toHaveCount(0);
    // The board's own way of making a note is a double-click on the empty canvas. It is done here
    // with the mouse rather than with `doubleClickBoard`, because that helper waits for an editor to
    // open - and no editor opening is the whole of what is being asserted.
    await page.mouse.dblclick(640, 400);
    await expect(notes(page)).toHaveCount(0);
    // What the board answers to the keyboard is the same story: the keys it listens for are for a
    // note that is selected, and nothing can be selected on a board that is not there.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);

    // The marker, left on the page's own `window`. Nothing from here on reloads this page, and this
    // is how the test knows that instead of assuming it.
    await page.evaluate(() => {
      (window as unknown as { __same_page_as_before__: boolean }).__same_page_as_before__ = true;
    });

    // The row goes back. Everything after this is the room and the page, on their own: the page's
    // connection keeps retrying, and the room reads the board again once LOAD_RETRY_MIN_INTERVAL_MS
    // has passed since the attempt it already made.
    const repaired = await runSwitch(request, boardId, 'repair-snapshot');
    expect(repaired.ok).toBe(true);
    expect(repaired['repaired']).toBe(true);

    const waitingSince = Date.now();
    await expect
      .poll(() => notes(page).count(), {
        timeout: LOAD_RETRY_MIN_INTERVAL_MS + E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [100, 250],
        message: 'the board should come back by itself',
      })
      .toBe(written.length);
    console.log(
      `[broken board] TC-24: the board was back ${String(Date.now() - waitingSince)}ms after the ` +
        `row was put back, of which the first ${String(LOAD_RETRY_MIN_INTERVAL_MS)}ms is the room ` +
        'waiting before it reads a board it has just failed to read',
    );

    // The sentence goes away by itself, because it was true and now it is not.
    await expect(page.getByTestId('connection-status')).toHaveCount(0);

    // The board that came back is the board that went away, note for note and id for id: the same
    // readout as before the damage, from the same page.
    await expect.poll(() => boardJson(page)).toBe(left);

    // The page is the page it was.
    expect(
      await page.evaluate(
        () => (window as unknown as { __same_page_as_before__?: boolean }).__same_page_as_before__,
      ),
    ).toBe(true);

    // And the person can work again: a note made, with its text on it, next to the twenty-five that
    // came back.
    await expect(createStickyButton(page)).toBeEnabled();
    await doubleClickBoard(page, { x: 640, y: 620 });
    await typeInNote(page, 'Made after the board came back');
    await stopEditing(page);
    await expect(notes(page)).toHaveCount(written.length + 1);
    await expect(textAt(page, written.length)).toHaveText('Made after the board came back');
    expect(await noteId(page, written.length)).toBeTruthy();

    await after.close();
  });

  test('the switches are refused when they have nothing to work on (negative)', async ({
    request,
  }, testInfo) => {
    // A switch that cannot do its job says so, with a reason. The test above reads these answers as
    // facts, so they have to be able to say no: if a corrupt that damaged nothing reported success,
    // the failure being watched for afterwards would be about something else entirely.
    const boardId = newBoardId();

    // A board with notes on it and no snapshot, which is where every board of this size starts: the
    // story's own sync path writes two notes, the room appends two rows, and nobody has folded
    // anything up.
    const writer = await RoomClient.connect(roomOf(originOf(testInfo), boardId));
    await writer.writeNotes(twoNotes());
    writer.close();

    // There is nothing to damage, and saying so is the whole of the honesty: a test that went on
    // from here would be watching a board that was never damaged fail to load.
    const corrupt = await runSwitch(request, boardId, 'corrupt-snapshot');
    expect(corrupt['ok']).toBe(false);
    expect(String(corrupt['error'])).toContain('no snapshot');

    // Nothing was taken out, so nothing can be put back.
    const repair = await runSwitch(request, boardId, 'repair-snapshot');
    expect(repair['ok']).toBe(false);
    expect(repair['repaired']).toBe(false);

    // The fold-up is the one switch that does have something to work on, and it says how many chunks
    // the board is now in - which is the fact the test above relies on.
    const compact = await runSwitch(request, boardId, 'compact');
    expect(compact['ok']).toBe(true);
    expect(Number(compact['chunks'])).toBeGreaterThan(0);
    // And now there is something to damage, which is what changed.
    expect((await runSwitch(request, boardId, 'corrupt-snapshot'))['ok']).toBe(true);

    // An id that could not be a board id never reaches a room at all - the same rule as for a
    // connection, and for the same reason.
    expect((await request.post('/__test/boards/not-a-board-id/compact')).status()).toBe(400);

    // A path that is not one of these switches is not a route. A GET to it is answered by the app,
    // the way it is in a deployment, whether or not the switches are on; a POST is answered by the
    // asset router, which serves no method but GET and HEAD - which is also what a POST to a switch
    // this Worker does not have gets, so the answer is the same as for any other path it does not
    // claim rather than a hint about what is behind it.
    const unknownStep = await request.get(`/__test/boards/${boardId}/delete-everything`);
    expect(unknownStep.status()).toBe(200);
    expect(unknownStep.headers()['content-type'] ?? '').toContain('text/html');
    expect((await request.post(`/__test/boards/${boardId}/delete-everything`)).status()).toBe(405);

    // And a known switch asked for over GET is refused by the Worker itself, before the board is
    // touched: these switches write, so they are POST only.
    const wrongMethod = await request.get(`/__test/boards/${boardId}/compact`);
    expect(wrongMethod.status()).toBe(405);
  });
});

/** Two notes, for a board that has to hold something without being folded up. */
function twoNotes(): NoteSeed[] {
  return [
    { text: 'A note', x: 120, y: 120, color: 'yellow' },
    { text: 'Another note', x: 320, y: 200, color: 'pink' },
  ];
}

/**
 * Click the middle of an element with the mouse, and nothing else.
 *
 * Not `locator.click()`, which first checks that the element is enabled and waits - correctly - for
 * one that is disabled to become clickable. What is being asked here is the opposite question: what
 * does the browser do when a person clicks something that will not answer? Only the mouse can be
 * asked that.
 */
async function clickTheMiddleOf(
  page: Page,
  target: ReturnType<typeof createStickyButton>,
): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error('the button is not on the screen to be clicked');
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The colour the message is written in, as the browser resolved it, or nothing if it is not shown. */
async function messageColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="connection-status"]');
    return element === null ? '' : getComputedStyle(element).color;
  });
}
