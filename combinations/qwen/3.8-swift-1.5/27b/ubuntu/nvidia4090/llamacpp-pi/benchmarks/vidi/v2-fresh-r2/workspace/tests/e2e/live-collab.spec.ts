/**
 * E2E live collaboration (story 3): real browsers, real `wrangler dev` server,
 * real y-websocket sync. TC-22 to TC-28.
 *
 * Latency is logged (via expectEventually), never asserted.
 */
import { test, expect, type Browser } from '@playwright/test';
import {
  openParticipants,
  expectEventually,
  createNote,
  moveNote,
  recolorNote,
  deleteNote,
  noteCount,
  noteText,
  boardSnapshot,
  connectionState,
  connectionStateLog,
  disconnectPage,
  type Participant,
} from './helpers/participants';
import { setCamera } from './helpers/board';
import { MAX_CONCURRENT_EDITORS, CATCH_UP_TEST_OUTAGE_MS } from '../../src/shared/config';

async function closeAll(parts: Participant[]): Promise<void> {
  await Promise.all(parts.map((p) => p.close()));
}

/** Both participants report the same (order-independent) board snapshot. */
async function snapshotsMatch(a: Participant, b: Participant): Promise<boolean> {
  return (await boardSnapshot(a.page)) === (await boardSnapshot(b.page));
}

test.describe('live collaboration', () => {
  test('TC-22: Alex creates, moves, recolours, types, deletes — each change appears for Sam', async ({
    browser,
  }: { browser: Browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      // create + type
      await createNote(alex.page, 400, 300, 'Hello');
      await expectEventually(async () => (await noteCount(sam.page)) === 1, 'Sam sees Alex\'s note');
      await expectEventually(async () => (await noteText(sam.page, 0)) === 'Hello', 'Sam sees the text');

      // move
      await moveNote(alex.page, 0, 100, 50);
      await expectEventually(() => snapshotsMatch(alex, sam), 'Sam\'s note follows the move');

      // recolour
      await recolorNote(alex.page, 0, 'swatch-blue');
      await expectEventually(() => snapshotsMatch(alex, sam), 'Sam\'s note follows the recolour');

      // delete
      await deleteNote(alex.page, 0);
      await expectEventually(async () => (await noteCount(sam.page)) === 0, 'Sam sees the deletion');
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-23: both type into one note → identical text containing every typed character', async ({
    browser,
  }: { browser: Browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await createNote(alex.page, 400, 300, 'Hello ');
      await expectEventually(async () => (await noteCount(sam.page)) === 1, 'Sam sees the note');

      // Sam opens the same note for editing and appends.
      await sam.page.locator('[data-testid="sticky-note"]').nth(0).dblclick();
      const ta = sam.page.locator('[data-testid="sticky-textarea"]');
      await ta.waitFor();
      await ta.click();
      await sam.page.keyboard.press('End');
      await sam.page.keyboard.type('World');
      await sam.page.keyboard.press('Escape');

      // Both converge on text containing every typed character.
      await expectEventually(
        async () => {
          const a = await noteText(alex.page, 0);
          const s = await noteText(sam.page, 0);
          return a === s && a.includes('Hello') && a.includes('World');
        },
        'both notes read "Hello World"',
      );
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-24: both drag the same note → identical settled position on both', async ({
    browser,
  }: { browser: Browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await createNote(alex.page, 400, 300, 'Drag me');
      await expectEventually(async () => (await noteCount(sam.page)) === 1, 'Sam sees the note');

      await moveNote(alex.page, 0, 80, 40);
      await expectEventually(() => snapshotsMatch(alex, sam), 'converge after Alex drag');

      await moveNote(sam.page, 0, -60, 30);
      await expectEventually(() => snapshotsMatch(alex, sam), 'converge after Sam drag');
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-25: Sam editing, Alex deletes → Sam\'s note and editor disappear, no console errors', async ({
    browser,
  }: { browser: Browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      const errors: string[] = [];
      sam.page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      sam.page.on('pageerror', (err) => errors.push(String(err)));

      await createNote(alex.page, 400, 300, 'Doomed');
      await expectEventually(async () => (await noteCount(sam.page)) === 1, 'Sam sees the note');

      // Sam begins editing the note.
      await sam.page.locator('[data-testid="sticky-note"]').nth(0).dblclick();
      await sam.page.locator('[data-testid="sticky-textarea"]').waitFor();

      // Alex deletes it while Sam is editing.
      await deleteNote(alex.page, 0);

      await expectEventually(async () => (await noteCount(sam.page)) === 0, 'Sam\'s note disappears');
      expect(await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test(`TC-26: full capacity — ${MAX_CONCURRENT_EDITORS} contexts each create 5 & move 5; final snapshots identical`, async ({
    browser,
  }: { browser: Browser }) => {
    const n = MAX_CONCURRENT_EDITORS;
    const parts = await openParticipants(browser, n);
    try {
      // Zoom out so 25 notes (200 world units each) fit a non-overlapping grid
      // inside the viewport — dblclick only creates on empty space.
      for (const p of parts) {
        await setCamera(p.page, { x: -640, y: -400, zoom: 0.5 });
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 5; j++) {
          await createNote(parts[i].page, 240 + i * 110 + j * 22, 160 + j * 110, `p${i}n${j}`);
        }
      }
      for (const p of parts) {
        await expectEventually(
          async () => (await noteCount(p.page)) === n * 5,
          `${p.name} sees ${n * 5} notes`,
        );
      }
      // Each participant moves 5 notes.
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 5; j++) {
          await moveNote(parts[i].page, j, 24 + i, 18 + j);
        }
      }
      const ref = await boardSnapshot(parts[0].page);
      for (const p of parts) {
        await expectEventually(
          async () => (await boardSnapshot(p.page)) === ref,
          `${p.name} final snapshot matches`,
        );
      }
    } finally {
      await closeAll(parts);
    }
  });

  test('TC-27: flaky wifi — Alex offline, both add 3 notes, catch up on reconnect (badge Reconnecting → Connected)', async ({
    browser,
  }: { browser: Browser }) => {
    test.setTimeout(180_000);
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      // Drop Alex's network. Close the live WebSocket first (while online,
      // so the `close` event fires and the provider reports `disconnected`),
      // then go offline immediately so the ~200ms reconnect attempt fails and
      // the provider stays disconnected for the outage window. (Chromium's
      // setOffline alone does not sever an established WebSocket.)
      await disconnectPage(alex.page);
      await alex.context.setOffline(true);

      // Badge shows Reconnecting while the socket is down.
      await expectEventually(
        async () => (await connectionState(alex.page)) === 'reconnecting',
        'Alex badge shows Reconnecting',
      );

      // Let the page settle after the socket drop before driving the UI.
      await alex.page.waitForTimeout(500);

      // Both add 3 notes while Alex is offline (Alex's are queued locally).
      // Notes are 200 world units wide, so space them >200px apart so each
      // dblclick lands on empty space, not a neighbour.
      for (let i = 0; i < 3; i++) {
        await createNote(alex.page, 160 + i * 220, 200, `alex${i}`);
        await createNote(sam.page, 160 + i * 220, 420, `sam${i}`);
      }

      // Hold the outage for the named duration.
      await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);
      await alex.context.setOffline(false);

      // Badge returns to Connected and the log shows a reconnect.
      await expectEventually(
        async () => (await connectionState(alex.page)) === 'connected',
        'Alex is connected again',
      );
      const log = await connectionStateLog(alex.page);
      expect(log).toContain('reconnecting');

      // Both converge on 6 notes.
      await expectEventually(async () => (await noteCount(alex.page)) === 6, 'Alex sees 6 notes');
      await expectEventually(async () => (await noteCount(sam.page)) === 6, 'Sam sees 6 notes');
    } finally {
      await closeAll([alex, sam]);
    }
  });

  test('TC-28: Alex selects & edits a note → Sam sees no selection outline or editor', async ({
    browser,
  }: { browser: Browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      await createNote(alex.page, 400, 300, 'Local selection');
      await expectEventually(async () => (await noteCount(sam.page)) === 1, 'Sam sees the note');

      // Alex selects and enters edit mode.
      await alex.page.locator('[data-testid="sticky-note"]').nth(0).click();
      await alex.page.locator('[data-testid="sticky-note"]').nth(0).dblclick();
      await alex.page.locator('[data-testid="sticky-textarea"]').waitFor();

      // Sam sees the note but no editor and no selection outline.
      expect(await sam.page.locator('[data-testid="sticky-textarea"]').count()).toBe(0);
      expect(await sam.page.locator('[data-selected]').count()).toBe(0);
    } finally {
      await closeAll([alex, sam]);
    }
  });
});
