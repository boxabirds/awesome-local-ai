import { expect, test, type Page } from "@playwright/test";
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES, STICKY_COLORS, type StickyColor } from "../../src/shared/config";
import { RETRO_ITEMS, largeBoard } from "../fixtures/boards";
import { createBoard } from "./helpers/api";
import * as board from "./helpers/board";
import * as notes from "./helpers/notes";
import { openParticipant, waitUntilConnected, type Participant } from "./helpers/participants";
import { readBoardNoteCount, seedBoard } from "./helpers/sync-client";
import { newPersistDir, removePersistDir, restartWrangler, startWrangler } from "./helpers/wrangler-process";

/**
 * Story 4, task 6 — persistence in a real browser against a real server process:
 * TC-19 (overnight return), TC-20 (leave immediately) and TC-21 (big board open).
 *
 * Each test owns its `wrangler dev` process and its own `--persist-to` directory
 * (`npm run test:e2e:persistence`, `playwright.persistence.config.ts`), and
 * "restart" here means the OS process is gone and a new one is started over the
 * same storage directory — nothing in the room's memory survives it.
 */

const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

/** A note as the browser shows it: identity, content and stacking. */
interface BoardFact {
  id: string;
  text: string;
  /** Computed background colour, which is what a person actually sees. */
  colour: string;
  z: number;
  /** Board coordinates, so a different camera cannot hide a difference. */
  x: number;
  y: number;
}

async function boardFacts(page: Page): Promise<BoardFact[]> {
  const rendered = await notes.notes(page);
  const area = await board.boardBox(page);
  const camera = await board.renderedCamera(page);
  const colours = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']")).map(
      (node) => getComputedStyle(node).backgroundColor,
    ),
  );

  return rendered
    .map((note, index) => ({
      id: note.id,
      text: note.text,
      colour: colours[index] ?? "",
      z: note.z,
      x: Math.round(((note.box.x - area.x) / camera.zoom + camera.x) * 10) / 10,
      y: Math.round(((note.box.y - area.y) / camera.zoom + camera.y) * 10) / 10,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function waitForNoteCount(page: Page, expected: number, timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(() => notes.noteCount(page), { timeout: timeoutMs, intervals: [100, 250, 500] })
    .toBe(expected);
}

/**
 * Creates one note through the real gestures: double-click at `at`, type the
 * text, leave editing (which leaves the note selected), pick a colour swatch.
 */
async function createNote(page: Page, at: { x: number; y: number }, text: string, colour: StickyColor): Promise<void> {
  await notes.createNoteByDoubleClick(page, at);
  await page.keyboard.type(text);
  await notes.endEditing(page);
  await expect(page.getByTestId("note-toolbar")).toBeVisible();
  await page.getByTestId(`swatch-${colour}`).click();
  await notes.settle(page);
}

async function openBoard(browser: Parameters<typeof openParticipant>[0], name: string, boardId: string): Promise<Participant> {
  const participant = await openParticipant(browser, name, boardId);
  await waitUntilConnected(participant);
  return participant;
}

/** Every note's text, in one pass over the rendered board. */
async function renderedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']")).map(
      (node) => node.textContent ?? "",
    ),
  );
}

test.describe("story 4 persistence across process restarts", () => {
  test.describe.configure({ mode: "serial" });

  test("TC-19 overnight return: 25 notes are exactly as they were left", async ({ browser }) => {
    test.setTimeout(420_000);
    const persistTo = newPersistDir();
    let handle = await startWrangler({ persistTo });
    const boardId = await createBoard(handle.port);

    try {
      const author = await openBoard(browser, "author", boardId);

      // A zoomed-out view fits a 5×5 grid of notes whose board positions
      // overlap, so stacking order is part of what has to come back.
      await board.setCamera(author.page, { ...(await board.readCamera(author.page)), zoom: 0.5 });

      for (let index = 0; index < 25; index += 1) {
        const at = { x: 250 + (index % 5) * 90, y: 230 + Math.floor(index / 5) * 90 };
        await createNote(author.page, at, RETRO_ITEMS[index]!, COLOURS[index % COLOURS.length]!);
      }

      // Stacking that is *not* creation order: three notes raised, in this order.
      for (const id of [3, 11, 19]) {
        const list = await notes.notes(author.page);
        const target = list.find((note) => note.index === id)!;
        await author.page.mouse.click(target.box.x + 10, target.box.y + 10);
        await notes.settle(author.page);
      }

      const before = await boardFacts(author.page);
      expect(before).toHaveLength(25);
      expect(new Set(before.map((fact) => fact.id)).size).toBe(25);
      expect(new Set(before.map((fact) => fact.z)).size).toBe(25);
      expect(author.problems).toEqual([]);

      // A colleague opening the same link is the product's own signal that
      // everything the author did has reached the room — and the room stores a
      // change before it shows it to anyone, so what this peer can see is what
      // is on storage. Without this gate the test would be racing the room's
      // writes instead of testing them.
      const colleague = await openBoard(browser, "colleague", boardId);
      const expected = JSON.stringify(before);
      await expect
        .poll(async () => JSON.stringify(await boardFacts(colleague.page)), {
          timeout: 60_000,
          intervals: [250, 500, 1_000],
        })
        .toBe(expected);
      expect(colleague.problems).toEqual([]);

      await author.context.close();
      await colleague.context.close();

      // "Overnight": the server process is stopped and another one is started
      // over the same storage directory.
      handle = await restartWrangler(handle);

      const returning = await openBoard(browser, "returning", boardId);
      await waitForNoteCount(returning.page, 25);
      const after = await boardFacts(returning.page);

      expect(after).toEqual(before);
      expect(returning.problems).toEqual([]);
      await returning.context.close();
    } finally {
      await handle.stop();
      removePersistDir(persistTo);
    }
  });

  test("TC-20 leave immediately: a note left straight away is still there", async ({ browser }) => {
    test.setTimeout(300_000);
    const persistTo = newPersistDir();
    let handle = await startWrangler({ persistTo });
    const boardId = await createBoard(handle.port);
    const text = "Written, then the tab was closed at once";

    try {
      const alex = await openBoard(browser, "Alex", boardId);
      const sam = await openBoard(browser, "Sam", boardId);

      await notes.createNoteByDoubleClick(alex.page, { x: 500, y: 400 });
      await alex.page.keyboard.type(text);
      await notes.endEditing(alex.page);

      // Poll until the change — note and text — is visible to Sam. The room
      // stores before it broadcasts, so this is also the moment the note is
      // provably on storage.
      await expect
        .poll(async () => (await notes.notes(sam.page))[0]?.text ?? null, {
          timeout: 30_000,
          intervals: [50, 100, 250],
        })
        .toBe(text);
      const visibleAt = Date.now();

      // Within a second of that visibility both contexts are closed and the
      // server process is killed.
      await alex.context.close();
      await sam.context.close();
      const stoppedAt = Date.now();
      await handle.stop();
      console.log(`TC-20 visibility -> process stopped: ${stoppedAt - visibleAt} ms`);

      handle = await restartWrangler(handle);

      const returning = await openBoard(browser, "returning", boardId);
      await waitForNoteCount(returning.page, 1);
      const [note] = await notes.notes(returning.page);
      expect(note!.text).toBe(text);
      expect(returning.problems).toEqual([]);
      await returning.context.close();
    } finally {
      await handle.stop();
      removePersistDir(persistTo);
    }
  });

  test("TC-21 big board open: every note of a PERSIST_TESTED_NOTES board is rendered", async ({ browser }) => {
    test.setTimeout(600_000);
    const persistTo = newPersistDir();
    const handle = await startWrangler({ persistTo });
    const boardId = await createBoard(handle.port);

    try {
      // The board is written through the sync protocol (one frame per note, as a
      // person's edits arrive) because 2,000 pointer gestures would take longer
      // than the behaviour being tested.
      const fixture = largeBoard();
      const seededAt = Date.now();
      await seedBoard(handle.port, boardId, fixture.updates);
      const inRoom = await readBoardNoteCount(handle.port, boardId, PERSIST_TESTED_NOTES, 120_000);
      console.log(`TC-21 seeded ${inRoom} notes in ${Date.now() - seededAt} ms`);
      expect(inRoom).toBe(PERSIST_TESTED_NOTES);

      const page = await browser.newPage();
      const navigationStartedAt = Date.now();
      await page.goto(`/b/${boardId}`);
      await expect(page.getByTestId("board-viewport")).toBeVisible();

      // Where the time actually goes: the board starts painting, then every note
      // of it is on screen.
      await expect
        .poll(() => notes.noteCount(page), { timeout: 60_000, intervals: [50, 100, 250] })
        .toBeGreaterThanOrEqual(1);
      const firstNoteAt = Date.now() - navigationStartedAt;

      await waitForNoteCount(page, PERSIST_TESTED_NOTES, 180_000);
      const elapsedMs = Date.now() - navigationStartedAt;

      console.log(
        `TC-21 board load: first note rendered after ${firstNoteAt} ms, all ${PERSIST_TESTED_NOTES} rendered after ${elapsedMs} ms ` +
          `(budget BOARD_LOAD_BUDGET_MS = ${BOARD_LOAD_BUDGET_MS} ms, ${elapsedMs <= BOARD_LOAD_BUDGET_MS ? "within" : "over"} budget — recorded, not asserted)`,
      );

      expect(await notes.noteCount(page)).toBe(PERSIST_TESTED_NOTES);
      const texts = await renderedTexts(page);
      expect(texts).toHaveLength(PERSIST_TESTED_NOTES);
      expect(texts.filter((text) => text.trim().length > 0)).toHaveLength(PERSIST_TESTED_NOTES);
      await page.close();
    } finally {
      await handle.stop();
      removePersistDir(persistTo);
    }
  });
});
