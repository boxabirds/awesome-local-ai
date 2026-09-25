/**
 * Story 4 persistence across real process restarts (persist.room, TC-19 to TC-21). Each test
 * runs its own `wrangler dev --persist-to <tmp>` (helpers/wrangler-process.ts), kills it with
 * SIGKILL and starts it again on the same state directory, so only what was durably
 * written to the Durable Object's SQLite storage can survive.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { BOARD_LOAD_BUDGET_MS, PERSIST_TESTED_NOTES } from '../../src/shared/config';
import { buildLargeBoard } from '../fixtures/boards';
import {
  centreOf,
  closeAll,
  createNoteAt,
  dragBy,
  expectWithin,
  note,
  noteState,
  notes,
  openParticipant,
  type Participant,
} from './helpers/participants';
import { compactBoard, seedBoard } from './helpers/seed';
import { startWrangler, type WranglerServer } from './helpers/wrangler-process';

const PORT_BASE = Number(process.env.E2E_PERSIST_PORT_BASE ?? 8810);
const TEST_TIMEOUT_MS = 180_000;
const REOPEN_TIMEOUT_MS = 20_000;
const NOTES_TO_CREATE = 25;
const GRID_COLUMNS = 5;
const GRID_PITCH_PX = 120;
const GRID_ORIGIN = { x: 260, y: 130 };
const ZOOM_OUT_STEPS = 3;
const COLOURS = ['Orange', 'Green', 'Blue', 'Pink', 'Violet'];

let server: WranglerServer | null = null;
let people: Participant[] = [];

test.describe.configure({ timeout: TEST_TIMEOUT_MS });

test.beforeEach(async ({ browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'process-restart scenarios run in chromium');
  server = await startWrangler(PORT_BASE + testInfo.parallelIndex);
});

test.afterEach(async () => {
  await closeAll(people);
  people = [];
  await server?.dispose();
  server = null;
});

interface SavedNote {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** Every note as rendered: text, colour, world position and stacking (z-index). */
async function boardState(page: Page): Promise<SavedNote[]> {
  return notes(page).evaluateAll((els) =>
    els
      .map((el) => {
        const h = el as HTMLElement;
        return {
          id: h.dataset.id ?? '',
          x: parseFloat(h.style.left),
          y: parseFloat(h.style.top),
          z: Number(h.style.zIndex),
          color: h.dataset.color ?? '',
          text: h.querySelector('.sticky-text-content')?.textContent ?? '',
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

let browserRef: Browser | null = null;
test.beforeEach(({ browser }) => {
  browserRef = browser;
});

async function open(boardId: string, name: string): Promise<Participant> {
  const p = await openParticipant(browserRef!, boardId, name, server!.baseURL);
  people.push(p);
  return p;
}

async function leave(p: Participant): Promise<void> {
  await p.context.close();
  people = people.filter((x) => x !== p);
}

test('TC-19 overnight return: 25 varied notes survive everyone leaving and a process restart', async () => {
  const boardId = newBoardId();
  const alex = await open(boardId, 'Alex');
  const page = alex.page;
  for (let i = 0; i < ZOOM_OUT_STEPS; i++) await page.getByRole('button', { name: 'Zoom out' }).click();

  const ids: string[] = [];
  for (let i = 0; i < NOTES_TO_CREATE; i++) {
    const at = {
      x: GRID_ORIGIN.x + (i % GRID_COLUMNS) * GRID_PITCH_PX,
      y: GRID_ORIGIN.y + Math.floor(i / GRID_COLUMNS) * GRID_PITCH_PX,
    };
    const text = i % 4 === 0 ? `Idea ${i + 1}\nsecond line` : `Idea ${i + 1}`;
    const id = await createNoteAt(page, at, text);
    ids.push(id);
    if (i % 3 === 1) {
      // Still selected after Escape: recolour through the note toolbar.
      await page.getByRole('button', { name: `${COLOURS[i % COLOURS.length]} colour` }).click();
    }
  }
  // Overlaps and restacking: drag a few notes partly onto their neighbours.
  for (const i of [0, 7, 13, 21]) {
    await dragBy(page, await centreOf(note(page, ids[i]!)), 70, 45);
  }
  await expect(notes(page)).toHaveCount(NOTES_TO_CREATE);
  const before = await boardState(page);
  expect(new Set(before.map((n) => n.color)).size).toBeGreaterThan(3);
  expect(before.some((n) => n.text.includes('\n'))).toBe(true);

  await leave(alex);
  await server!.restart();

  const priya = await open(boardId, 'Priya');
  await expect(notes(priya.page)).toHaveCount(NOTES_TO_CREATE, { timeout: REOPEN_TIMEOUT_MS });
  expect(await boardState(priya.page)).toEqual(before);
});

test('TC-20 leave immediately: a change another person saw survives an instant exit and kill', async () => {
  const boardId = newBoardId();
  const alex = await open(boardId, 'Alex');
  const sam = await open(boardId, 'Sam');
  const id = await createNoteAt(alex.page, { x: 640, y: 400 }, 'Seen by Sam');
  await expectWithin(async () => (await noteState(sam.page, id))?.text, 'Sam sees the note').toBe('Seen by Sam');

  const started = Date.now();
  await Promise.all([leave(alex), leave(sam), server!.kill()]);
  const exitMs = Date.now() - started;
  console.log(`TC-20 closed both browsers and killed the process within ${exitMs} ms`);

  await server!.restart();
  const priya = await open(boardId, 'Priya');
  await expect.poll(async () => (await noteState(priya.page, id))?.text, { timeout: REOPEN_TIMEOUT_MS }).toBe('Seen by Sam');
});

test(`TC-21 big board: ${PERSIST_TESTED_NOTES} saved notes open within BOARD_LOAD_BUDGET_MS`, async ({ browser }) => {
  const boardId = newBoardId();
  const doc = new Y.Doc();
  buildLargeBoard(doc);
  await seedBoard(server!.baseURL, boardId, doc);
  expect(await compactBoard(server!.baseURL, boardId)).toBe(true);
  await server!.restart(); // cold start: the room loads from the snapshot

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: server!.baseURL });
  try {
    const page = await context.newPage();
    // Warm the static assets and the process (not the board) so the measurement is the board open.
    await page.goto('/');
    await page.goto(`/b/${boardId}`);
    await page.waitForFunction(
      (n) => document.querySelectorAll('[role="group"][aria-label="Sticky note"]').length === n,
      PERSIST_TESTED_NOTES,
      { timeout: REOPEN_TIMEOUT_MS, polling: 'raf' },
    );
    // performance.now() counts from this navigation's start.
    const elapsed = await page.evaluate(() => performance.now());
    console.log(`TC-21 ${PERSIST_TESTED_NOTES} notes rendered ${Math.round(elapsed)} ms after navigation start (budget ${BOARD_LOAD_BUDGET_MS} ms)`);
    expect(elapsed).toBeLessThanOrEqual(BOARD_LOAD_BUDGET_MS);
    // Zoomed right out, the notes are really on screen.
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    while (await zoomOut.isEnabled()) await zoomOut.click();
    await expect(page.getByRole('group', { name: 'Sticky note' }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
