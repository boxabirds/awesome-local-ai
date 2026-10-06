/**
 * TC-24: a board that could not be loaded says so, and becomes a board again without
 * anybody reloading the page (persist.client_status).
 *
 * The other tests in this file family ask the board to survive; this one asks the room
 * to be honest when it cannot be read. The damage is done to the storage on disk - the
 * snapshot's first chunk is overwritten with bytes no decoder will take, which is what
 * a corrupt file, a bad restore, or a bug that wrote half a board would amount to - and
 * then the server is restarted over it. The pages that were already open stay open:
 * their sockets die with the process, they reconnect, and the room that wakes up
 * cannot open the board. That is the moment the story is about, and the client's answer
 * to it has three parts, all of them asserted:
 *
 *   1. it says what happened, in red, in a live region, in the room's words and not its
 *      own guess ("Reconnecting…" would be a promise that patience is rewarded);
 *   2. it stops offering edits, because a note typed into a board that is not there has
 *      nowhere to go - and the board it can still show them is not erased;
 *   3. when the bytes are put back, it is a board again on its own: no reload, no click
 *      on a "retry" anything. The client's reconnect and the room's once-per-interval
 *      re-read do it, which is what choosing a close code outside y-websocket's
 *      never-retry band bought.
 *
 * A page that was never there is opened too, onto the broken board: it is the one that
 * proves the client asked for the board and was refused, rather than merely noticing
 * that a connection went away.
 */

import { expect, type Page } from '@playwright/test';

import { test } from './fixtures.js';
import {
  badge,
  closeParticipants,
  connectionState,
  openParticipants,
  waitForLoadFailure,
  type Participant,
} from './helpers/participants.js';
import {
  binButton,
  boardIdOf,
  colorSwatch,
  createNote,
  dragNote,
  noteById,
  noteCentre,
  notes,
  openEditor,
  stickyToolbarButton,
  typeIntoOpenEditor,
  waitForNoteCount,
} from './helpers/sticky.js';
import {
  drawnNotes,
  expectVariedBoard,
  fillBoard,
  noteIds,
  type Left,
} from './helpers/board-content.js';
import { startWrangler, type WranglerProcess } from './helpers/wrangler-process.js';
import { describeDifference, RETRO_BOARD_NOTES } from '../fixtures/boards.js';
import {
  LOAD_RETRY_MIN_INTERVAL_MS,
  RECONNECT_MAX_BACKOFF_MS,
  STICKY_COLOR_NAMES,
} from '../../src/shared/config.js';
import type { Point } from '../../src/client/canvas/camera.js';

/*
 * Its own server, on 24216 - past the suite's dev server (24212) and past the
 * persistence specs' pair (24214/24215). See NOTES.md for the port map; the helper moves
 * to the next free pair if this one is held, and refuses to restart on a different port
 * than it started on, because pages this test leaves open reconnect to the address they
 * were loaded from.
 */
const PORT = Number(process.env.E2E_BROKEN_BOARD_PORT ?? 24216);

/**
 * The sentence, written out rather than imported. It is the story's wording
 * (`persist.client_status`), and a browser that shows a different sentence should fail
 * this test; importing the constant the component uses would let the wording drift and
 * both suites go on approving it.
 */
const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

/** What the two ways of making a note say when the board will not take one. */
const STICKY_LOCKED_TOOLTIP = 'Sticky note – this board could not be loaded';
const DELETE_LOCKED_TOOLTIP = 'Delete note – this board could not be loaded';

/**
 * A point of the board that is not covered by a note: somewhere a double-click would
 * make a note if the board would take one. Searched for rather than fixed, because
 * whether a point is empty depends on where the notes ended up after being dragged, and
 * a test that double-clicked the toolbar instead would "pass" while testing the wrong
 * thing. The element under the point has to be the board surface itself.
 */
async function emptyBoardPoint(page: Page): Promise<Point> {
  for (let y = 80; y <= 720; y += 40) {
    for (let x = 200; x <= 1220; x += 40) {
      const hit = await page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        if (element === null) return null;
        return {
          board: element.closest('[data-testid="board-viewport"]') !== null,
          note: element.closest('[data-note-id]') !== null,
        };
      }, { x, y });
      if (hit !== null && hit.board && !hit.note) return { x, y };
    }
  }
  throw new Error('no bare board to double-click: every point tried is under a note or a control');
}

/** The badge's background as the browser painted it. */
async function badgeColour(page: Page): Promise<{ r: number; g: number; b: number; raw: string }> {
  const raw = await badge(page).evaluate(
    (element) => window.getComputedStyle(element).backgroundColor,
  );
  const parts = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(raw);
  if (parts === null) throw new Error(`the badge reports its colour as ${JSON.stringify(raw)}`);
  return { r: Number(parts[1]), g: Number(parts[2]), b: Number(parts[3]), raw };
}

/** Nothing was written to this page's board: same notes, same everything, no editor open. */
async function expectNothingHappened(page: Page, left: Left, gesture: string): Promise<void> {
  expect(describeDifference(await drawnNotes(page), left), `${gesture} changed the board`).toBe('');
  await expect(notes(page)).toHaveCount(left.length);
  await expect(openEditor(page), `${gesture} opened a typing box on a locked board`).toHaveCount(0);
}

/** The whole edit surface of a locked board, gesture by gesture. */
async function expectLocked(alex: Participant, left: Left): Promise<void> {
  const page = alex.page;

  // The button that makes a note: not hidden - the tool is there and it is the board
  // that cannot take a note - and its tooltip is where the reason goes.
  const button = stickyToolbarButton(page);
  await expect(button).toBeDisabled();
  expect(await button.getAttribute('title')).toBe(STICKY_LOCKED_TOOLTIP);
  // `force` is not a shortcut taken to make this pass. The user's click lands on a
  // disabled control, and a browser does not hand the page a click for one - which is
  // the first half of the answer. The second half is that nothing happens even when the
  // click is delivered, so the note cannot be made through a path the interface is not
  // using.
  await button.click({ force: true });
  await expectNothingHappened(page, left, 'clicking the Sticky note button');

  await page.keyboard.press('n');
  await expectNothingHappened(page, left, "the 'n' shortcut");

  const empty = await emptyBoardPoint(page);
  await page.mouse.dblclick(empty.x, empty.y);
  await expectNothingHappened(page, left, 'double-clicking the bare board');

  // A note of its own: double-clicking a note normally opens it for typing, and an
  // editor that cannot save what is typed in it is worse than no editor.
  const on = await noteCentre(page, 0);
  await page.mouse.dblclick(on.x, on.y);
  await expectNothingHappened(page, left, 'double-clicking a note');

  // A note can still be looked at and selected: which note someone is reading is not
  // board content, and a page that refused selection would be hiding the board rather
  // than locking it. Its own controls are the locked ones.
  await page.mouse.click(on.x, on.y);
  await expect(page.getByTestId('note-toolbar')).toBeVisible();
  const bin = binButton(page);
  await expect(bin).toBeDisabled();
  expect(await bin.getAttribute('title')).toBe(DELETE_LOCKED_TOOLTIP);
  const swatch = colorSwatch(page, STICKY_COLOR_NAMES[0]!);
  await expect(swatch).toBeDisabled();
  await swatch.click({ force: true });
  await expectNothingHappened(page, left, 'a colour swatch');

  await page.keyboard.press('Delete');
  await expectNothingHappened(page, left, 'the Delete key');

  // And a drag moves nothing. This one is worth doing with a real mouse rather than
  // trusting the disabled buttons: a drag is the longest path from a pointer to a write
  // in this app - pointerdown, capture, moves, a write of x and y on release - and the
  // one most likely to have been left out of a lock that was done control by control.
  const from = await noteCentre(page, 0);
  await dragNote(page, from, { x: from.x + 140, y: from.y + 90 });
  await expectNothingHappened(page, left, 'dragging a note');

  // The board is still there under all that. A failure that cleared the screen would
  // look more decisive and would destroy the one thing the user might still want.
  await expect(notes(page).first()).toBeVisible();
  const first = left[0];
  if (first === undefined) throw new Error('the board is empty, so there is nothing to read');
  await expect(notes(page).first()).toContainText(first.text.split('\n')[0]!);
}

test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'this test corrupts storage and restarts a server of its own; once is enough (chromium)',
  );
});

test('TC-24 a board that could not be loaded says so in red, and is a board again without a reload', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const server: WranglerProcess = await startWrangler({ port: PORT });
  try {
    const path = await server.newBoardPath();
    const people = await openParticipants(browser, ['Alex', 'Sam'], server.urlFor(path));
    const [alex, sam] = people as [Participant, Participant];

    const left = await fillBoard(alex.page, RETRO_BOARD_NOTES);
    await expectVariedBoard(alex.page, RETRO_BOARD_NOTES);
    // Both of them are looking at all of it, so that "the board is still there" is a
    // statement about two pages and not about one page's memory.
    await waitForNoteCount(sam.page, RETRO_BOARD_NOTES);
    const ids = await noteIds(alex.page);
    const boardId = await boardIdOf(alex.page);

    // The damage is aimed at a snapshot, so the board has to have one. Folding the log
    // is what the room does by itself once a board has enough changes on it; asking for
    // it here is about the target, not about the board.
    const compacted = await server.hook(boardId, 'compact');
    expect(compacted.status).toBe(200);
    const chunks = Number(compacted.json['chunkRows']);
    expect(chunks).toBeGreaterThan(0);
    expect(Number(compacted.json['updateRows'])).toBe(0);

    // Overwrite the snapshot's first chunk, keeping what was in it. This is the beginning
    // of the board: with it unreadable there is no partial board to salvage, and the
    // room's only honest answer is that it could not open this.
    const damaged = await server.hook(boardId, 'corrupt-snapshot');
    expect(damaged.status).toBe(200);
    expect(damaged.json).toMatchObject({ ok: true, chunks, damaged: 0 });

    // The server dies with the damage in its file, and comes back over the same
    // directory. The pages are not touched: their sockets go with the process, they
    // reconnect to the room as they always do, and this time the room says no.
    await server.restart();

    for (const person of people) await waitForLoadFailure(person);

    // What the room says about itself, from outside it. The pages are not the only ones
    // in on this: the room did not serve a half board and did not pretend to have read
    // the file.
    const broken = await server.hook(boardId, 'state');
    expect(broken.status).toBe(200);
    expect(broken.json).toMatchObject({
      state: 'load-failed',
      hasDocument: false,
      updateRows: 0,
    });

    for (const person of people) {
      // The exact words, in a live region, in the class that is the red one, and red as
      // the browser painted it. The badge has been a pill of white text on a coloured
      // background since story 1 - amber to wait, green for a moment - so "red" is about
      // the pill, and `connection-status--load_failed` with no rule behind it would be a
      // red that exists only in the source.
      await expect(badge(person.page)).toHaveText(LOAD_FAILED_TEXT);
      expect(await badge(person.page).getAttribute('role')).toBe('status');
      expect(await badge(person.page).getAttribute('class')).toContain(
        'connection-status--load_failed',
      );
      const colour = await badgeColour(person.page);
      expect(
        colour.r > colour.g + 40 && colour.r > colour.b + 40,
        `${colour.raw} is not a red, and this is the one state that has to be one`,
      ).toBe(true);
      expect(
        await badge(person.page).evaluate((element) => window.getComputedStyle(element).color),
      ).toBe('rgb(255, 255, 255)');
      // The board is still there, note for note, in the page that could not load it.
      expect(describeDifference(await drawnNotes(person.page), left)).toBe('');
    }

    // The gestures, on the page that had the board and lost it.
    await expectLocked(alex, left);

    // A page that never saw the board. It asked for it and was refused, which is the
    // case a client cannot tell apart from a server that is merely down - except that
    // this one was told. It gets nothing to look at, which is the truth, and it is
    // locked too, so there is nowhere for the notes it might be tempted to make.
    const riley = (await openParticipants(browser, ['Riley'], server.urlFor(path), {
      expect: 'load_failed',
    }))[0] as Participant;
    // Every assertion after this point is about all three pages: the two that had the
    // board and lost it, and the one that never had it.
    const everyone = people.concat([riley]);
    await expect(notes(riley.page)).toHaveCount(0);
    expect(await connectionState(riley.page)).toBe('load_failed');
    await expect(stickyToolbarButton(riley.page)).toBeDisabled();
    const rileyEmpty = await emptyBoardPoint(riley.page);
    await riley.page.mouse.dblclick(rileyEmpty.x, rileyEmpty.y);
    await expectNothingHappened(
      riley.page,
      [],
      'a double-click on a board that was never loaded',
    );

    // Put the bytes back. Everything from here happens without a reload and without a
    // click: the client's own reconnect, and the room re-reading the storage once per
    // LOAD_RETRY_MIN_INTERVAL_MS.
    const repaired = await server.hook(boardId, 'repair');
    expect(repaired.status).toBe(200);
    expect(repaired.json).toMatchObject({ ok: true, restored: chunks });

    const startedWaiting = Date.now();
    // The wait has its own ceiling, made of the two intervals that are in charge here:
    // up to one client backoff (10 s at the cap) plus up to one room retry interval
    // (5 s), with room. `E2E_EVENTUAL_TIMEOUT_MS` is the wait for a change that has
    // already been made; this is a wait for a socket that is on a timer, and using the
    // shorter timeout would make this test fail on a machine that was merely slow.
    const reconnectWithinMs = RECONNECT_MAX_BACKOFF_MS + LOAD_RETRY_MIN_INTERVAL_MS + 20_000;
    for (const person of everyone) {
      await expect
        .poll(() => connectionState(person.page), {
          message: `${person.name} was never given the board again`,
          timeout: reconnectWithinMs,
        })
        .toBe('connected');
      await waitForNoteCount(person.page, RETRO_BOARD_NOTES);
    }
    console.log(
      `[e2e] TC-24 the board was a board again ${Date.now() - startedWaiting} ms after the ` +
        `storage was repaired, on ${everyone.length} pages that were never reloaded ` +
        `(client backoff up to ${RECONNECT_MAX_BACKOFF_MS} ms, room re-reads at most once per ` +
        `${LOAD_RETRY_MIN_INTERVAL_MS} ms)`,
    );

    // It is the same board, not a board like it: the same notes, the same ids, in the
    // same drawing order, on a page that had never seen any of it.
    for (const person of everyone) {
      expect(describeDifference(await drawnNotes(person.page), left)).toBe('');
    }
    expect(await noteIds(sam.page)).toEqual(ids);
    // And the badge is gone, not green: nothing announces the recovery, because the red
    // message going away is the announcement. A green "Connected" on top of it would be
    // a second way of saying the same thing, in a place where the user was just being
    // told something was wrong.
    for (const person of everyone) await expect(badge(person.page)).toHaveCount(0);

    const ready = await server.hook(boardId, 'state');
    expect(ready.json).toMatchObject({ state: 'ready', hasDocument: true });

    // Editing works again, and is stored again: a note made now reaches the other page
    // and the log, which is the difference between the lock having been lifted and the
    // badge having been hidden.
    const rowsBefore = Number(ready.json['updateRows']);
    await createNote(alex.page);
    const made = 'a note made after the board came back';
    await typeIntoOpenEditor(alex.page, made);
    for (const person of everyone) {
      await waitForNoteCount(person.page, RETRO_BOARD_NOTES + 1);
    }
    const afterRepair = await server.hook(boardId, 'state');
    expect(Number(afterRepair.json['updateRows'])).toBeGreaterThan(rowsBefore);
    expect(
      (await drawnNotes(sam.page)).some((note) => note.text === made),
      'the note made after the recovery never reached Sam',
    ).toBe(true);

    // The notes' own controls are unlocked too, which the toolbar button on its own
    // would not show: recolour a note and see it change on another page. By id, not by
    // "some note is this colour": a third of the notes on this board are already
    // coloured, so that check would have been true before the click.
    const target = (await drawnNotes(alex.page))[0]!;
    const other = STICKY_COLOR_NAMES.find((name) => name !== target.color)!;
    const centre = await noteCentre(alex.page, 0);
    await alex.page.mouse.click(centre.x, centre.y);
    await expect(alex.page.getByTestId('note-toolbar')).toBeVisible();
    await colorSwatch(alex.page, other).click();
    await expect
      .poll(() => noteById(sam.page, target.id).then((note) => note.color), {
        message: `recolouring note ${target.id} after the recovery did not reach Sam`,
      })
      .toBe(other);

    // Nothing of this is a board that quietly lost its content, and nothing of it is a
    // page that threw an error while finding out.
    for (const person of everyone) {
      expect(person.dialogs, `${person.name} was given a dialog`).toEqual([]);
      expect(person.consoleErrors, `${person.name}: ${person.consoleErrors.join('\n')}`).toEqual(
        [],
      );
    }
    console.log(
      `[e2e] TC-24 transport noise: ${everyone
        .map((person) => `${person.name} ${person.transportErrors.length}`)
        .join(', ')}`,
    );

    await closeParticipants(everyone);
  } finally {
    await server.dispose();
  }
});
