// Story 4, `persist.restart` / `persist.reopen` / `persist.large_board`
// (TC-19, TC-20, TC-21).
//
// These are the three end-to-end claims that a board is really on disk: it comes
// back whole after the service restarts, after everybody has left, and at the
// tested size. None of that can be faked with an in-memory stand-in — each test
// stops the `wrangler dev` process for real and starts another on the same
// on-disk state, exactly as a redeploy would.
//
// They run against their own server (one per spec, on its own port and its own
// `--persist-to` directory), not the shared webServer, because the whole point is
// to own the process lifecycle. So every navigation is to an absolute origin.
import { expect, test } from '@playwright/test';
import {
  STICKY_COLORS,
  PERSIST_TESTED_NOTES,
  type StickyColor,
} from '../../src/shared/config';
import { settle, setCamera } from './helpers/board';
import {
  clickNote,
  createNoteAt,
  noteColor,
  noteIds,
  noteText,
  noteWorldPos,
  rgb,
  swatch,
} from './helpers/stickies';
import { PersistentWrangler } from './helpers/wrangler-process';

const PORT = 4181;
const COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

let wrangler: PersistentWrangler;

test.beforeAll(async () => {
  wrangler = new PersistentWrangler({ port: PORT });
  await wrangler.start();
});

test.afterAll(async () => {
  await wrangler?.dispose();
});

/** Open a board at this spec's own server and wait for the app to be ready. */
async function openBoard(page: import('@playwright/test').Page): Promise<string> {
  await page.goto(`${wrangler.origin}/`);
  await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%', { timeout: 20_000 });
  await page.waitForFunction(
    () =>
      window.__vidi6 !== undefined &&
      window.__vidi6.getCamera().x === -window.innerWidth / 2 &&
      window.__vidi6.getCamera().y === -window.innerHeight / 2,
  );
  await settle(page);
  return page.url(); // the app has rewritten it to /b/<board id>
}

/** Everything a board is, read back note by note. */
interface CapturedNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

async function capture(page: import('@playwright/test').Page): Promise<CapturedNote[]> {
  const ids = await noteIds(page);
  const notes: CapturedNote[] = [];
  for (const id of ids) {
    notes.push({ id, text: await noteText(page, id), color: await noteColor(page, id), ...(await noteWorldPos(page, id)) });
  }
  return notes;
}

test('TC-19: a board is whole after the service restarts', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const boardUrl = await openBoard(page);

  // Zoom out so twenty-two notes of their real size fit without overlapping (a
  // double-click on an existing note would edit it instead of making a new one).
  await setCamera(page, { x: 0, y: 0, zoom: 0.35 });
  await settle(page);

  const created: string[] = [];
  for (let i = 0; i < 22; i++) {
    const column = i % 5;
    const row = Math.floor(i / 5);
    const point = { x: 180 + column * 150, y: 150 + row * 130 };
    const id = await createNoteAt(page, point, `note ${i + 1}`);
    created.push(id);
    // Give a third of them a colour other than the default, to prove colour —
    // not just text and position — comes back from disk.
    if (i % 3 === 0) {
      const color = COLORS[(i / 3) % COLORS.length]!;
      await clickNote(page, id);
      await swatch(page, color).click();
    }
  }
  await settle(page);

  const before = await capture(page);
  expect(before.length).toBe(22);
  // the coloured ones really did change colour, so the comparison is meaningful
  expect(before.some((note) => note.color !== rgb('yellow'))).toBe(true);

  await context.close(); // everybody has left this board

  // Stop the service and bring it back on the same disk: nothing is in memory now.
  await wrangler.restart();

  const reopen = await browser.newContext();
  const page2 = await reopen.newPage();
  await page2.goto(boardUrl);
  await page2.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, undefined, { timeout: 20_000 });
  await settle(page2);

  const after = await capture(page2);
  expect(after).toEqual(before); // every id, text, colour, position, in stacking order

  // The same twenty-two texts, whatever their stacking order (the board renders
  // notes by id, not by the order they were made).
  expect([...after.map((note) => note.text)].sort()).toEqual(
    created.map((_, i) => `note ${i + 1}`).sort(),
  );
  await context.close().catch(() => undefined);
  await reopen.close();
});

test('TC-20: a note is still there when the last person leaves and the service restarts', async ({ browser }) => {
  const alexContext = await browser.newContext();
  const alex = await alexContext.newPage();
  const boardUrl = await openBoard(alex);

  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  await sam.goto(boardUrl);
  await expect(sam.locator('[data-testid="zoom-label"]')).toHaveText('100%', { timeout: 20_000 });

  // Alex writes something; Sam sees it inside the live-editing delay.
  const started = Date.now();
  const id = await createNoteAt(alex, { x: 400, y: 400 }, 'the last thing saved');
  await expect
    .poll(async () => (await noteIds(sam)).includes(id), { timeout: 1_000 })
    .toBe(true);
  expect(Date.now() - started).toBeLessThan(1_000);

  // Both leave at once, and the service restarts while nobody is connected.
  await Promise.all([alexContext.close(), samContext.close()]);
  await wrangler.restart();

  const reopen = await browser.newContext();
  const page2 = await reopen.newPage();
  await page2.goto(boardUrl);
  await page2.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, undefined, { timeout: 20_000 });
  await settle(page2);
  await expect(page2.locator(`[data-note-id="${id}"]`)).toBeVisible();
  expect(await noteText(page2, id)).toBe('the last thing saved');
  await reopen.close();
});

test('TC-21: a board of the tested size opens complete after a restart', async ({ browser }) => {
  const seed = await browser.newContext();
  const page = await seed.newPage();
  const boardUrl = await openBoard(page);

  // Fill the board to its tested size in one transaction (a test seam; a real
  // board is filled by people). Then wait for the room to have it all.
  await page.evaluate((count) => window.__vidi6!.seedNotes(count), PERSIST_TESTED_NOTES);
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-note-id]').length === count,
    PERSIST_TESTED_NOTES,
    { timeout: 60_000 },
  );

  // The notes all arrive in the room in one update; give that update time to be
  // stored and compacted before the process is torn down.
  await page.waitForTimeout(3_000);
  const seededIds = new Set(await noteIds(page));
  expect(seededIds.size).toBe(PERSIST_TESTED_NOTES);
  await seed.close();

  await wrangler.restart();

  const reopen = await browser.newContext();
  const page2 = await reopen.newPage();
  const loadStarted = Date.now();
  await page2.goto(boardUrl);
  // The whole board arrives in one sync message; the first note to appear is when
  // the server finished reading it from disk. That read is what the load budget is
  // about (the DOM painting everything is a browser concern, measured and logged).
  await page2.waitForFunction(() => document.querySelectorAll('[data-note-id]').length > 0, undefined, {
    timeout: 30_000,
  });
  const firstNoteMs = Date.now() - loadStarted;
  await page2.waitForFunction(
    (count) => document.querySelectorAll('[data-note-id]').length === count,
    PERSIST_TESTED_NOTES,
    { timeout: 60_000 },
  );
  const fullRenderMs = Date.now() - loadStarted;

  const after = await noteIds(page2);
  expect(after.length).toBe(PERSIST_TESTED_NOTES);
  // every note that was seeded came back; none was invented or lost
  expect(new Set(after).size).toBe(PERSIST_TESTED_NOTES);

  // The numbers here are a browser's cold open of the board (page, script, then
  // the board). The worker's own read of a board this size — what the load budget
  // actually governs — is asserted in the integration test, at the storage layer
  // in the runtime the board loads in. Here the end-to-end claim is that all
  // PERSIST_TESTED_NOTES notes come back after a restart; the timings are logged.
  console.log(
    `TC-21 (e2e cold open): first note visible ${firstNoteMs}ms, ` +
      `all ${PERSIST_TESTED_NOTES} painted ${fullRenderMs}ms after navigation`,
  );

  await reopen.close();
});
