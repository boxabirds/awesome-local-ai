import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  createNoteAt,
  deleteNote,
  expectSameBoard,
  findNote,
  logLatency,
  moveNote,
  noteCount,
  openBoard,
  readColor,
  readText,
  recolorNote,
  setCamera,
  snapshotNotes,
  typeText,
} from './helpers';

/** A valid 128-bit board id (16 bytes base64url). */
function newBoardId(): string {
  return randomBytes(16).toString('base64url');
}

interface Participant {
  context: BrowserContext;
  page: Page;
}

async function join(browser: Browser, boardId: string): Promise<Participant> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openBoard(page, boardId);
  return { context, page };
}

async function two(browser: Browser): Promise<{ a: Participant; b: Participant; board: string }> {
  const board = newBoardId();
  const a = await join(browser, board);
  const b = await join(browser, board);
  return { a, b, board };
}

/** Close every participant and its context. */
async function closeAll(...ps: Participant[]): Promise<void> {
  await Promise.all(
    ps.map(async (p) => {
      await p.page.close().catch(() => undefined);
      await p.context.close().catch(() => undefined);
    }),
  );
}

// Screen anchor points, well separated (notes are 200px, zoom 1).
const P1 = { x: 400, y: 250 };
const P2 = { x: 880, y: 250 };
const P3 = { x: 400, y: 550 };
const P4 = { x: 880, y: 550 };

test.describe('live collaboration (real browsers + wrangler dev)', () => {
  test('TC-22: every change type Alex makes appears for Sam', async ({ browser }) => {
    const { a, b } = await two(browser);
    const alex = a.page;
    const sam = b.page;
    try {
      // create
      const t0 = Date.now();
      await createNoteAt(alex, P1.x, P1.y);
      await logLatency('create', t0, async () => (await noteCount(sam)) === 1);

      // text
      const t1 = Date.now();
      await typeText(alex, P1.x, P1.y, 'hello sam');
      await logLatency('text', t1, async () => (await readText(sam, P1.x, P1.y)) === 'hello sam');

      // move
      const dest = { x: P2.x, y: P2.y };
      const t2 = Date.now();
      await moveNote(alex, P1, dest);
      await logLatency('move', t2, async () => (await findNote(sam, dest.x, dest.y)) !== undefined);

      // recolour
      const t3 = Date.now();
      await recolorNote(alex, dest.x, dest.y, 'blue');
      await logLatency('recolour', t3, async () => {
        const c = await readColor(sam, dest.x, dest.y);
        return c === 'rgb(144, 202, 249)'; // STICKY_COLORS.blue
      });

      // delete
      const t4 = Date.now();
      await deleteNote(alex, dest.x, dest.y);
      await logLatency('delete', t4, async () => (await noteCount(sam)) === 0);
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-23: simultaneous typing on the same note keeps every character', async ({ browser }) => {
    const { a, b } = await two(browser);
    const alex = a.page;
    const sam = b.page;
    try {
      await createNoteAt(alex, P1.x, P1.y);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      const alexText = 'alpha';
      const samText = 'omega';
      await Promise.all([
        typeText(alex, P1.x, P1.y, alexText),
        typeText(sam, P1.x, P1.y, samText),
      ]);

      // both pages converge to a text containing every typed character
      const merged = (s: string) =>
        [...alexText].every((ch) => s.includes(ch)) && [...samText].every((ch) => s.includes(ch));
      await expect
        .poll(async () => merged(await readText(alex, P1.x, P1.y)), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      await expect
        .poll(async () => merged(await readText(sam, P1.x, P1.y)), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      // identical on both
      await expectSameBoard(alex, sam);
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-24: dragging the same note to different places settles identically', async ({ browser }) => {
    const { a, b } = await two(browser);
    const alex = a.page;
    const sam = b.page;
    try {
      await createNoteAt(alex, P1.x, P1.y);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      const t0 = Date.now();
      await Promise.all([
        moveNote(alex, P1, { x: 300, y: 300 }),
        moveNote(sam, P1, { x: 950, y: 500 }),
      ]);
      await expectSameBoard(alex, sam);
      const settle = Date.now() - t0;
      console.log(`[latency] settle after concurrent drag: ${settle}ms`);
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-25: deleting a note someone is editing removes it cleanly', async ({ browser }) => {
    const { a, b } = await two(browser);
    const alex = a.page;
    const sam = b.page;
    const consoleErrors: string[] = [];
    sam.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    try {
      await createNoteAt(alex, P1.x, P1.y);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      // Sam starts editing the note; Alex deletes it.
      await Promise.all([
        (async () => {
          await sam.mouse.dblclick(P1.x, P1.y); // enter edit mode
          await sam.getByLabel('Note text').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
        })(),
        (async () => {
          await expect.poll(() => noteCount(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
          // createNoteAt left the note in edit mode; end it (stays selected).
          await alex.keyboard.press('Escape');
          await alex.getByRole('button', { name: 'Delete note' }).click();
        })(),
      ]);

      // Sam's note is gone and the editor closed
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
      await expect(sam.getByLabel('Note text')).toHaveCount(0);
      // no uncaught console errors on Sam's page
      expect(
        consoleErrors.filter((e) => !/favicon|404/i.test(e)),
      ).toEqual([]);
    } finally {
      await closeAll(a, b);
    }
  });

  test('TC-26: full capacity — every change from each editor reaches all others', async ({ browser }) => {
    const board = newBoardId();
    const ps: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) ps.push(await join(browser, board));
    try {
      // Zoom out so each note (200 world units) is 100px on screen; a 5x5
      // grid of well-separated anchors then fits the viewport with no
      // overlapping double-click targets.
      for (const p of ps) await setCamera(p.page, -640, -400, 0.5);
      const cellX = (c: number) => 140 + c * 220;
      const rowY = (i: number) => 140 + i * 120;
      // editor i owns row i: 5 notes across the 5 columns
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        for (let c = 0; c < 5; c++) {
          await createNoteAt(ps[i].page, cellX(c), rowY(i));
        }
        // leave edit mode so the moves below drag the note body, not a textarea
        await ps[i].page.keyboard.press('Escape');
      }
      // move each editor's 5 notes to a fresh offset
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        for (let c = 0; c < 5; c++) {
          const from = { x: cellX(c), y: rowY(i) };
          await moveNote(ps[i].page, from, { x: from.x + 30, y: from.y + 30 });
        }
      }
      // everyone ends on the identical board
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        await expectSameBoard(ps[0].page, ps[i].page);
      }
      const count = await noteCount(ps[0].page);
      expect(count).toBe(MAX_CONCURRENT_EDITORS * 5);
    } finally {
      await closeAll(...ps);
    }
  });

  test('TC-27: offline catch-up — badge Reconnecting then Connected, both see all notes', async ({ browser }) => {
    const board = newBoardId();
    const alexP = await join(browser, board);
    const samP = await join(browser, board);
    const alex = alexP.page;
    const sam = samP.page;
    try {
      // Alex goes offline. Under offline emulation the browser does not fire
      // the WebSocket close, so the provider's no-message watchdog
      // (messageReconnectTimeout = 30 s) is what detects the outage — that is
      // already longer than CATCH_UP_TEST_OUTAGE_MS, so detection and the
      // offline edits overlap.
      await alexP.context.setOffline(true);
      const outageStart = Date.now();

      // each adds 3 notes while Alex is offline (Alex's stay local); notes are
      // spaced 220px apart so each double-click hits empty space, not a neighbour
      for (let i = 0; i < 3; i++) {
        const y = 130 + i * 220;
        await createNoteAt(alex, P1.x, y);
        await createNoteAt(sam, P2.x, y);
      }

      // Sam already sees his own 3; Alex sees his own 3 locally (offline)
      await expect.poll(() => noteCount(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(3);

      // badge flips to Reconnecting once the watchdog fires
      await expect
        .poll(async () => (await alex.evaluate(() => window.__vidi6?.connectionState)), {
          timeout: 45_000,
        })
        .toBe('reconnecting');
      await expect(alex.getByText('Reconnecting…')).toBeVisible();

      // hold the outage for at least the named catch-up duration
      const elapsed = Date.now() - outageStart;
      if (elapsed < CATCH_UP_TEST_OUTAGE_MS) {
        await alex.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS - elapsed);
      }

      // back online
      await alexP.context.setOffline(false);
      await expect
        .poll(async () => (await alex.evaluate(() => window.__vidi6?.connectionState)), {
          timeout: 30_000,
        })
        .toBe('confirmed');
      await expect(alex.getByText('Connected')).toBeVisible();

      // both converge to all 6
      await expect.poll(() => noteCount(alex), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);
      await expectSameBoard(alex, sam);
    } finally {
      await closeAll(alexP, samP);
    }
  }, 180_000);

  test('TC-28: selection and the text editor are local only', async ({ browser }) => {
    const { a, b } = await two(browser);
    const alex = a.page;
    const sam = b.page;
    try {
      await createNoteAt(alex, P1.x, P1.y);
      await expect.poll(() => noteCount(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

      // Alex selects and starts editing the note
      await alex.mouse.click(P1.x, P1.y);
      await expect(alex.getByRole('group', { name: 'Sticky note' }).first()).toHaveAttribute('data-selected', 'true');
      await alex.mouse.dblclick(P1.x, P1.y);
      await alex.getByLabel('Note text').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // give propagation a moment, then assert Sam has neither selection nor editor
      await new Promise((r) => setTimeout(r, 400));
      await expect(sam.getByRole('group', { name: 'Sticky note' }).first()).not.toHaveAttribute(
        'data-selected',
      );
      await expect(sam.getByLabel('Note text')).toHaveCount(0);
      const samSnapshot = await snapshotNotes(sam);
      expect(samSnapshot).toHaveLength(1);
    } finally {
      await closeAll(a, b);
    }
  });
});
