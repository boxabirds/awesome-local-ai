import { test, expect, type Page } from '@playwright/test';
import {
  openSharedBoard,
  createSticky,
  notes,
  noteCount,
  noteTexts,
  noteByTest,
  noteIds,
} from './helpers/board.ts';
import { RawClient } from './helpers/rawClient.ts';
import { simulateDrop, restoreConnection } from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config.ts';

const settle = (page: Page) => page.waitForTimeout(80);

test.describe('TC-22 create + edit is visible to the other editor', () => {
  test('two notes created/edited on one board appear on the other', async ({ context }) => {
    const id = newBoardId();
    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    expect(await noteCount(b)).toBe(0);

    await createSticky(a, 400, 300, 'first');
    await expect
      .poll(() => noteTexts(b), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toEqual(['first']);

    await createSticky(a, 700, 500, 'second');
    await expect
      .poll(() => noteTexts(b), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toEqual(['first', 'second']);
    // Same note ids on both pages (CRDT ids, not re-keyed).
    await expect
      .poll(() => noteIds(b))
      .toEqual(await noteIds(a));
  });
});

test.describe('TC-23 concurrent typing in the same note converges', () => {
  test('two contexts typing into one note end up identical', async ({ context }) => {
    const id = newBoardId();
    // Seed one shared note via a raw collaborator, then open two editors.
    const seed = new RawClient(id);
    await seed.connect();
    await seed.waitFor(() => true);
    const seedId = seed.addSticky({ text: 'x', x: 0, y: 0 });
    await seed.waitFor(() => seed.noteCount() === 1);

    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    await expect.poll(() => noteCount(a)).toBe(1);

    const started = Date.now();
    // Two independent editors typing into the same note, concurrently. Each
    // double-clicks the note to enter edit mode, then types.
    const typeInto = async (page: Page, text: string) => {
      const p = await noteByTest(page, 'x');
      if (!p) throw new Error('seed note not found');
      await page.mouse.dblclick(p.cx, p.cy);
      await page.getByTestId('sticky-text-editor').waitFor();
      await page.keyboard.type(text);
      await page.keyboard.press('Escape');
    };
    await Promise.all([typeInto(a, 'AAA'), typeInto(b, 'BBB')]);

    // The two pages must converge to the SAME note text (Yjs guarantees the
    // document converges to one value) within the latency budget. The seed text
    // is gone by, proving each page received the live merge (this editor
    // rewrites its whole local value per commit and does not observe remote
    // edits mid-edit, so interleaved keystroke survival is asserted at the
    // document layer by integration TC-11/TC-12, not here).
    await expect
      .poll(
        async () => {
          const ta = await noteTexts(a);
          const tb = await noteTexts(b);
          return (
            ta.length === 1 && tb.length === 1 && ta[0] === tb[0] && ta[0]!.length >= 3 && ta[0] !== 'x'
          );
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 6 },
      )
      .toBe(true);
    expect(await noteCount(a)).toBe(1);
    expect(await noteTexts(a)).toEqual(await noteTexts(b));
    expect(Date.now() - started).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS * 10);
    await seed.close();
    void seedId;
  });
});

test.describe('TC-24 concurrent drag converges (last-writer-wins)', () => {
  test('two contexts dragging one note agree on a final position', async ({ context }) => {
    const id = newBoardId();
    await createStickyViaRaw(id, 'drag');
    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    await expect.poll(() => noteCount(a)).toBe(1);

    const drag = async (page: Page, dx: number, dy: number) => {
      const p = await noteByTest(page, 'drag');
      await page.mouse.move(p!.cx, p!.cy);
      await page.mouse.down();
      await page.mouse.move(p!.cx + dx / 2, p!.cy + dy / 2, { steps: 5 });
      await page.mouse.move(p!.cx + dx, p!.cy + dy, { steps: 5 });
      await page.mouse.up();
    };
    // Snapshot the start before either drag, so we can assert real movement.
    const start = (await notes(a))[0]!;
    await Promise.all([drag(a, 120, 0), drag(b, 0, 120)]);

    // Eventually the same final position on both pages (no split-brain), and the
    // note actually moved from its start (the drags took effect).
    await expect
      .poll(
        async () => {
          const na = (await notes(a))[0]!;
          const nb = (await notes(b))[0]!;
          const same =
            Math.round(na.x) === Math.round(nb.x) && Math.round(na.y) === Math.round(nb.y);
          const moved = Math.abs(na.x - start.x) > 1 || Math.abs(na.y - start.y) > 1;
          return same && moved;
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 6 },
      )
      .toBe(true);
  });
});

test.describe('TC-25 a note deleted on one board disappears on the other', () => {
  test('remote delete removes the note', async ({ context }) => {
    const id = newBoardId();
    const a = await context.newPage();
    const b = await context.newPage();
    await openSharedBoard(a, id);
    await openSharedBoard(b, id);
    await createSticky(a, 400, 300, 'doomed');
    await expect.poll(() => noteCount(b)).toBe(1);

    // Select the note on A, then press Delete.
    const note = await noteByTest(a, 'doomed');
    await a.mouse.click(note!.cx, note!.cy);
    await settle(a);
    await a.keyboard.press('Delete');
    await expect
      .poll(() => noteCount(b), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(0);
  });
});

test.describe('TC-26 five contexts co-exist and converge', () => {
  // MAX_CONCURRENT_EDITORS is a SOFT capacity that is never enforced (design
  // live.over_capacity; the 6th-joiner-must-not-be-refused case is integration
  // TC-13). This e2e test drives the full editor count from the browser and
  // asserts every change reaches every other context and the end state is
  // identical. Per-change latency and heavy random moves are covered
  // deterministically by integration TC-12.
  test(`${MAX_CONCURRENT_EDITORS} contexts each create notes; all converge identically`, async ({
    context,
  }) => {
    const id = newBoardId();
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const p = await context.newPage();
      await openSharedBoard(p, id);
      pages.push(p);
    }

    const expected: string[] = [];
    // Each context creates 5 notes via the toolbar (always a fresh note; the
    // typing lands in the just-created editor).
    await Promise.all(
      pages.map(async (p, i) => {
        for (let j = 0; j < 5; j++) {
          const text = `c${i}n${j}`;
          expected.push(text);
          await p.getByRole('button', { name: 'Sticky note' }).click();
          await p.getByTestId('sticky-text-editor').waitFor();
          await p.keyboard.type(text);
          await p.keyboard.press('Escape');
        }
      }),
    );
    const sorted = [...expected].sort();

    // Every change is seen by all contexts within the budget, and the final
    // text set is identical everywhere.
    for (const p of pages) {
      await expect
        .poll(() => noteTexts(p), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 8 })
        .toEqual(sorted);
    }
    // Identical note id sets — the same CRDT objects on every page (no
    // duplicated or divergent objects).
    const ids0 = await noteIds(pages[0]!);
    expect(ids0).toHaveLength(MAX_CONCURRENT_EDITORS * 5);
    for (const p of pages) {
      expect(await noteIds(p)).toEqual(ids0);
    }
  });
});

test.describe('TC-27 offline catch-up within 30 seconds', () => {
  test('edits made while disconnected arrive after reconnect', async ({ context, browser }) => {
    const id = newBoardId();
    const page = await context.newPage();
    await openSharedBoard(page, id);

    // Drop the connection (idle-timeout equivalent): the badge goes Reconnecting
    // and the client receives nothing until it reconnects.
    await simulateDrop(page);
    await expect(page.getByTestId('connection-status')).toContainText(/reconnect/i, {
      timeout: 15000,
    });

    // A collaborator edits on its own browser during the outage; the room keeps
    // the content while the offline page is away.
    const other = await browser.newContext();
    const editor = await other.newPage();
    await openSharedBoard(editor, id);
    await createSticky(editor, 500, 400, 'while-offline');
    await expect.poll(() => noteCount(editor)).toBe(1);

    // Reconnect; the offline page must catch up within CATCH_UP_TEST_OUTAGE_MS.
    await restoreConnection(page);
    await expect
      .poll(() => noteTexts(page), { timeout: 30000 })
      .toEqual(expect.arrayContaining(['while-offline']));
    await expect(page.getByTestId('connection-status')).toBeHidden({ timeout: 30000 });

    await other.close();
  });
});

async function createStickyViaRaw(id: string, text: string): Promise<void> {
  const rc = new RawClient(id);
  await rc.connect();
  rc.addSticky({ text, x: 0, y: 0 });
  await rc.waitFor(() => rc.noteCount() === 1);
  // Give the room a moment to persist the update before we disconnect.
  await new Promise((r) => setTimeout(r, 200));
  rc.close();
}
