/**
 * persist.room (story 4) — the browser tests in which the server is killed.
 *
 * Everything in `tests/integration/persistent-room.test.ts` happens inside one
 * process, where "the process forgot the board" has to be simulated. These three
 * are the real thing: `wrangler dev` is started for each test, with its own
 * SQLite state directory, and stopped — politely in one, without warning in
 * another — and a browser is then pointed at the restarted server. The seed
 * happens in the browser too, through the client's own board model, so the notes
 * a test expects to find again left a client as real Yjs updates and went
 * through the room the way any change does.
 *
 * The tests are named by test id, then told as sentences. TC-19 to TC-21.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
} from "../../src/shared/config";
import type { SeedNote } from "../../src/client/testSeed";
import { newBoardId } from "../../src/shared/board-id";
import { largeBoard, retroBoard, type PlacedNote } from "../fixtures/boards";
import { notes as noteElements, noteTexts, readNotes } from "./helpers/notes";
import {
  centreOf,
  createNote,
  dragNoteTo,
  EMPTY_CORNER,
  openBoard,
  selectNote,
  startTyping,
  stopEditing,
  zoomOutTo,
} from "./helpers/live";
import type { Point } from "./helpers/board";
import { WranglerProcess } from "./helpers/wrangler-process";

const PORT = Number(process.env.E2E_PERSIST_PORT ?? 28404);
const INSPECTOR_PORT = Number(process.env.E2E_PERSIST_INSPECTOR_PORT ?? 28405);

/** How long the 2,000-note board gets to be on screen (measured, see TC-21). */
const RENDER_TIMEOUT_MS = Math.max(E2E_EVENTUAL_TIMEOUT_MS, 120_000);

let server: WranglerProcess;

test.beforeEach(async () => {
  server = new WranglerProcess({ port: PORT, inspectorPort: INSPECTOR_PORT });
  await server.start();
});

test.afterEach(async ({}, testInfo) => {
  await server.stop("crash");
  // A persistence test that failed because of what the server did needs the
  // server's own words in the failure, not only the browser's.
  if (testInfo.status !== testInfo.expectedStatus) console.log(server.logTail(60));
  server.dispose();
});

/**
 * Everything a returning client can be asked about: the notes with their
 * coordinates, stacking order and colour, and their text. `selected` is left
 * out — coming back is not the same visit, and nobody's cursor is expected to
 * survive a restart.
 */
interface BoardSnapshot {
  readonly notes: {
    id: string;
    x: number;
    y: number;
    z: number;
    color: string;
  }[];
  readonly texts: string[];
}

async function snapshotOf(page: Page): Promise<BoardSnapshot> {
  return {
    notes: (await readNotes(page)).map(
      ({ selected: _selected, ...note }) => note,
    ),
    texts: await noteTexts(page),
  };
}

/**
 * Where note `index` of the fixture gets drawn: a loose grid of screen points,
 * far enough apart that a double-click never lands on a note that is already
 * there — a double-click on a note edits it, and only empty board accepts a new
 * one. Stacking happens afterwards, by dragging (see TC-19), because that is
 * also how a person stacks notes.
 */
function cellFor(index: number): Point {
  return { x: 140 + (index % 5) * 200, y: 140 + Math.floor(index / 5) * 140 };
}

/**
 * Type, colour and place a board the way a person would: one note at a time,
 * with the fixture's text and colour. Answers with the note ids, in order.
 */
async function drawBoard(
  page: Page,
  fixture: readonly PlacedNote[],
): Promise<string[]> {
  const drawn: string[] = [];
  for (const [index, note] of fixture.entries()) {
    const id = await createNote(page, cellFor(index));
    drawn.push(id);
    await startTyping(page, id);
    await page.keyboard.insertText(note.text);
    await stopEditing(page);
    await selectNote(page, id);
    await page.getByTestId(`swatch-${note.color}`).click();
    // Nothing stands in the empty corner at this zoom, so this only deselects.
    await page.mouse.click(EMPTY_CORNER.x, EMPTY_CORNER.y);
  }
  return drawn;
}

test("TC-19 @persistence: the board that was closed, restarted, and opened again is the same board", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const boardId = newBoardId();
  // The same 25-note fixture the storage tests use: mixed colours, multi-line
  // texts, realistic sentences.
  const fixture = retroBoard().notes;
  expect(fixture).toHaveLength(25);

  const alex = await openBoard(browser, boardId, "Alex");
  // Zoomed out far enough that 25 notes are on one screen and can be drawn.
  await zoomOutTo(alex.page, 0.35);
  const drawn = await drawBoard(alex.page, fixture);

  // Two of them are then dragged, because "as it was left" is also about where
  // the last person put a note down: one lands on top of another, so the board
  // has a stack whose stacking order has to survive the restart; one goes
  // somewhere else entirely.
  const [bottom, onTop, elsewhere] = drawn;
  if (!bottom || !onTop || !elsewhere)
    server.failWithLog("the 25 drawn notes disappeared while drawing them");
  await dragNoteTo(alex.page, onTop, await centreOf(alex.page, bottom));
  await dragNoteTo(alex.page, elsewhere, { x: 1130, y: 660 });

  const before = await snapshotOf(alex.page);
  await alex.context.close();

  // A deploy that lets the request finish.
  await server.restart("shutdown");

  const back = await openBoard(browser, boardId, "Alex");
  await expect(noteElements(back.page)).toHaveCount(25, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  const after = await snapshotOf(back.page);

  // Note for note, in the same stacking order, with the same text and colours
  // and at the same coordinates — and no new errors in the browser.
  expect(
    after.notes.map((note) => [note.x, note.y, note.z, note.color]),
  ).toEqual(before.notes.map((note) => [note.x, note.y, note.z, note.color]));
  expect(after.texts).toEqual(before.texts);
  expect(after.notes.map((note) => note.id)).toEqual(
    before.notes.map((note) => note.id),
  );
  expect(back.problems).toEqual([]);
  console.log(
    `TC-19: 25 notes came back after a restart; local state on disk: ${server.storageBytes()} bytes`,
  );
});

test("TC-20 @persistence: a change that was on the other screen was already in the file", async ({
  browser,
}) => {
  const boardId = newBoardId();
  const alex = await openBoard(browser, boardId, "Alex");
  const sam = await openBoard(browser, boardId, "Sam");

  const text =
    "The coffee ran out twice and nobody complained, which everyone agreed was the sign";
  const created = Date.now();
  const id = await createNote(alex.page, { x: 420, y: 360 });
  await startTyping(alex.page, id);
  await alex.page.keyboard.insertText(text);
  await stopEditing(alex.page);
  await selectNote(alex.page, id);
  await alex.page.getByTestId("swatch-violet").click();

  await expect
    .poll(async () => (await noteTexts(sam.page)).includes(text), {
      message: "the other screen never got the note",
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(true);
  const seenOnOtherScreen = Date.now();

  // Within a second of it being on Sam's screen, both browsers close and the
  // process is killed. That is the whole point: the guarantee is about a change
  // this fast, not about a board that had time to settle.
  await sam.context.close();
  await alex.context.close();
  await server.restart("crash");
  const killed = Date.now();
  expect(
    killed - seenOnOtherScreen,
    "the process was supposed to go within a second of the note appearing on the other screen",
  ).toBeLessThanOrEqual(1_000);

  const late = await openBoard(browser, boardId, "Sam");
  await expect(noteElements(late.page)).toHaveCount(1, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
  const [note] = await readNotes(late.page);
  const texts = await noteTexts(late.page);
  expect(texts[0]).toBe(text);
  expect(note?.color).toBe("violet");
  console.log(
    `TC-20: ${seenOnOtherScreen - created}ms from typing to the other screen; ` +
      `killed ${killed - seenOnOtherScreen}ms after that; the note is still there`,
  );
});

test("TC-21 @persistence: the big board opens in a client that has never seen it, and the time it took is written down", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const boardId = newBoardId();
  // The 2,000-note fixture, in the same shape the storage tests use it (one
  // transaction, one update and one row per note), drawn through the client.
  const fixture = largeBoard(PERSIST_TESTED_NOTES, 7, 240);
  const seeds: SeedNote[] = fixture.notes.map(({ x, y, text, color }) => ({
    x,
    y,
    text,
    color,
  }));

  const seeder = await openBoard(browser, boardId, "Seeder");
  const seedingStarted = Date.now();
  for (const batch of chunks(seeds, 50)) {
    // The client's own board model creates them: nothing is pasted into storage.
    await seeder.page.evaluate(
      (batch) => window.__vidi6Board?.seed(batch) ?? [],
      batch,
    );
  }
  await expect(noteElements(seeder.page)).toHaveCount(PERSIST_TESTED_NOTES, {
    timeout: RENDER_TIMEOUT_MS,
  });
  const seeded = Date.now();

  // A second client has to see the whole board before the process is stopped.
  // The seeder's own screen cannot prove the room has every change; another
  // client being told about it can.
  const watcher = await openBoard(browser, boardId, "Watcher");
  await expect(noteElements(watcher.page)).toHaveCount(PERSIST_TESTED_NOTES, {
    timeout: RENDER_TIMEOUT_MS,
  });
  await watcher.context.close();
  await seeder.context.close();

  // The restart is what makes this a storage measurement: without it, the room
  // that answers is still the one with the notes in memory.
  await server.restart("shutdown");

  const openedAt = Date.now();
  const late = await openBoard(browser, boardId, "Late");
  await expect(noteElements(late.page)).toHaveCount(PERSIST_TESTED_NOTES, {
    timeout: RENDER_TIMEOUT_MS,
  });
  const loadMs = Date.now() - openedAt;

  // The budget is the number this measurement is reported against. It is not
  // asserted: what is measured here ends with 2,000 note elements on screen in
  // Chromium, which is a browser fact and not the board's load — the board's own
  // load is timed at integration scale, where it can be. Written down before the
  // checks below, so a test that fails on content still reports the time.
  console.log(
    `TC-21: seeded ${PERSIST_TESTED_NOTES} notes in ${seeded - seedingStarted}ms; ` +
      `opened from scratch in ${loadMs}ms ` +
      `(reported against BOARD_LOAD_BUDGET_MS = ${BOARD_LOAD_BUDGET_MS}ms, not asserted); ` +
      `${((loadMs * 1000) / PERSIST_TESTED_NOTES).toFixed(1)}µs per note; ` +
      `local state on disk: ${server.storageBytes()} bytes`,
  );

  // Everything is where the fixture put it, and says what it said.
  const after = await snapshotOf(late.page);
  expect(after.texts.slice().sort()).toEqual(
    fixture.notes.map((note) => note.text).sort(),
  );
  expect(
    after.notes.map((note) => `${note.x},${note.y},${note.color}`).sort(),
  ).toEqual(
    fixture.notes.map((note) => `${note.x},${note.y},${note.color}`).sort(),
  );
  expect(late.problems).toEqual([]);
});

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}
