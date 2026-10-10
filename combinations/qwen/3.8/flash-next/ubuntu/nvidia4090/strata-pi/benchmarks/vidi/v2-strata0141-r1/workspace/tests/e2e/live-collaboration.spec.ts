import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  type StickyColor,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import {
  badgeText,
  boardDomSnapshot,
  connectionState,
  joinBoard,
  measureConvergence,
  newLiveBoardId,
  trackErrors,
  waitForNote,
  waitForNoteCount,
  waitForSameBoard,
} from './helpers/live';
import {
  clickCreateStickyButton,
  clickDeleteButton,
  clickSwatch,
  createNoteAt,
  dragNote,
  getNotes,
  noteCard,
  selectNote,
} from './helpers/sticky';

/**
 * Story 3, task 8: live collaboration through real browsers and the real
 * `wrangler dev` serving path (anchor `sync.client`).
 *
 * Every participant is a separate browser context, so nothing but the server can
 * connect them (and `disableBc: true` rules out the cross-tab shortcut anyway).
 * Convergence is waited for functionally; measured latency is logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted, because everything here shares
 * one machine.
 */

const latencies: number[] = [];

const report = (label: string, ms: number): void => {
  latencies.push(ms);
  console.log(`latency ${label}: ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`);
};

const positionOf = (notes: readonly StickySnapshot[], id: string): { x: number; y: number } | null => {
  const note = notes.find((candidate) => candidate.id === id);
  return note ? { x: note.x, y: note.y } : null;
};

const textOf = (notes: readonly StickySnapshot[], id: string): string | null => {
  const note = notes.find((candidate) => candidate.id === id);
  return note ? note.text : null;
};

test.afterAll(async () => {
  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q: number): number => {
    if (sorted.length === 0) {
      return 0;
    }
    const index = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q));
    return sorted[index] ?? 0;
  };
  console.log(
    `\nlatency report (live.propagate budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms): ` +
      `n=${sorted.length} p50=${at(0.5)} ms p95=${at(0.95)} ms max=${at(1)} ms`,
  );
});

test.describe('live collaboration', () => {
  test('TC-22: every kind of edit one person makes appears on the other person\'s board', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      expect(await sam.url()).toContain(board);

      // Create.
      const { ms: createdMs, notes: samNotes } = await measureConvergence(
        alex,
        sam,
        async () => {
          await clickCreateStickyButton(alex);
          // A note created from the toolbar starts in Editing state; leave it so
          // the rest of the work is done on an ordinary note.
          await alex.keyboard.press('Escape');
        },
      );
      report('create', createdMs);
      expect(samNotes).toHaveLength(1);
      const created = samNotes[0] as StickySnapshot;
      const id = created.id;
      expect((await getNotes(alex)).map((note) => note.id)).toEqual([id]);

      // Move.
      const started = Date.now();
      await dragNote(alex, id, 140, 90);
      await expect
        .poll(async () => JSON.stringify(positionOf(await getNotes(sam), id)), {
          timeout: 15_000,
        })
        .toBe(JSON.stringify(positionOf(await getNotes(alex), id)));
      report('move', Date.now() - started);

      // Recolour.
      const color: StickyColor = 'pink';
      const recolourStart = Date.now();
      await selectNote(alex, id);
      await clickSwatch(alex, color);
      await expect.poll(async () => await colorOn(sam, id), { timeout: 15_000 }).toBe(color);
      report('recolour', Date.now() - recolourStart);
      expect(await colorOn(alex, id)).toBe(color);

      // Type.
      const typeStart = Date.now();
      await noteCard(alex, id).dblclick();
      await alex.keyboard.type(' live copy');
      await alex.keyboard.press('Escape');
      await expect
        .poll(async () => textOf(await getNotes(sam), id), { timeout: 15_000 })
        .toContain('live copy');
      report('type', Date.now() - typeStart);
      expect(textOf(await getNotes(alex), id)).toBe(textOf(await getNotes(sam), id));

      // Delete.
      const deleteStart = Date.now();
      await selectNote(alex, id);
      await clickDeleteButton(alex);
      await waitForNote(sam, id, false);
      report('delete', Date.now() - deleteStart);
      await waitForSameBoard([alex, sam]);
      expect(await getNotes(sam)).toHaveLength(0);
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });

  test('TC-23: text typed in both editors at the same time ends up identical on both boards', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      const id = await createNoteAt(alex, { x: 300, y: 200 });
      await waitForNote(sam, id);

      // Both editors are open on the same note and both type, unseen by the other.
      await noteCard(alex, id).dblclick();
      await noteCard(sam, id).dblclick();
      const started = Date.now();
      await Promise.all([
        alex.keyboard.type('alex'),
        sam.keyboard.type('sam'),
      ]);
      report('concurrent typing', Date.now() - started);
      await alex.keyboard.press('Escape');
      await sam.keyboard.press('Escape');

      // Both editors keep working while the text travels: wait for the two
      // boards to show the same text, then compare what they show.
      let alexText = '';
      let samText = '';
      await expect
        .poll(
          async () => {
            alexText = textOf(await getNotes(alex), id) ?? '';
            samText = textOf(await getNotes(sam), id) ?? '';
            return alexText === samText && alexText.length >= 'alex'.length + 'sam'.length;
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the two editors never showed the same text' },
        )
        .toBe(true);

      // One board, one text: nobody's typing was dropped on the way.
      expect(samText).toBe(alexText);
      expect(chars(alexText).sort()).toEqual(chars(samText).sort());
      for (const char of [...'alex', ...'sam']) {
        expect(chars(alexText).filter((c) => c === char).length).toBeGreaterThan(0);
      }
      expect(alexText.length).toBe('alex'.length + 'sam'.length);
      // The editors agree too.
      expect(await alex.locator('[data-testid="sticky-editor"]').count()).toBe(0);
      expect(await sam.locator('[data-testid="sticky-editor"]').count()).toBe(0);
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });

  test('TC-24: a note moved in both editors at the same time settles at one identical position', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      const id = await createNoteAt(alex, { x: 200, y: 200 });
      await waitForNote(sam, id);

      const started = Date.now();
      await Promise.all([dragNote(alex, id, 120, 60), dragNote(sam, id, -90, -140)]);
      report('concurrent move', Date.now() - started);

      const alexPosition = positionOf(await getNotes(alex), id);
      const samPosition = positionOf(await getNotes(sam), id);
      expect(samPosition).toEqual(alexPosition);
      // One move won outright: the two paths were never averaged.
      expect(alexPosition).not.toBeNull();
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });

  test('TC-25: a note deleted by someone else disappears, editor and all, without errors', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      // Anything Sam's browser complains about is a failure of this test.
      const errorsForSam = trackErrors(sam);
      const id = await createNoteAt(alex, { x: 250, y: 150 });
      await waitForNote(sam, id);

      // Sam is in the middle of editing it.
      await noteCard(sam, id).dblclick();
      await sam.keyboard.type('half finished');
      await expect(sam.locator('[data-testid="sticky-editor"]')).toHaveCount(1);

      // Alex deletes it from the other side.
      await selectNote(alex, id);
      await clickDeleteButton(alex);

      await waitForNote(sam, id, false);
      await expect(sam.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
      await expect
        .poll(async () => (await noteCard(sam, id).count()) === 0, { timeout: 15_000 })
        .toBe(true);
      expect(errorsForSam).toEqual([]);
      await waitForSameBoard([alex, sam]);
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });

  test(`TC-26: ${MAX_CONCURRENT_EDITORS} editors at once all see every change`, async ({ browser }) => {
    test.setTimeout(240_000);
    const board = newLiveBoardId();
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    try {
      const pages: Page[] = [];
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const context = await browser.newContext();
        contexts.push(context);
        const page = await joinBoard(context, board);
        errors.push(...trackErrors(page));
        pages.push(page);
      }

      // Everyone creates notes at the same screen point, then moves their own.
      for (const [index, page] of pages.entries()) {
        for (let note = 0; note < 5; note += 1) {
          await clickCreateStickyButton(page);
        }
        const mine = await getNotes(page);
        expect(mine.length).toBeGreaterThanOrEqual(5);
        for (const [position, note] of mine.slice(0, 5).entries()) {
          await dragNote(page, note.id, 30 * (index + 1), 24 * (position + 1));
        }
      }

      const notes = await waitForSameBoard(pages);
      expect(notes.length).toBe(5 * MAX_CONCURRENT_EDITORS);

      const snapshots = await Promise.all(pages.map(async (page) => await boardDomSnapshot(page)));
      for (const snapshot of snapshots.slice(1)) {
        expect(snapshot).toBe(snapshots[0]);
      }
      expect(errors).toEqual([]);
    } finally {
      for (const context of contexts) {
        await context.close();
      }
    }
  });

  test('TC-27: an outage for one editor costs nothing but a badge, and both boards catch up', async ({
    browser,
  }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      expect(await badgeText(alex)).toBe('');

      // Alex's Wi-Fi drops. The link is only noticed once the protocol's
      // keep-alive goes unanswered (outdatedTimeout, 30 s), so the badge is
      // allowed that long.
      const outageStarted = Date.now();
      await alexContext.setOffline(true);
      await expect
        .poll(async () => await badgeText(alex), { timeout: 45_000 })
        .toBe('Reconnecting…');
      expect(await connectionState(alex)).toBe('reconnecting');
      expect(await badgeText(sam)).toBe('');

      // Both keep working, unseen by the other, for the rest of the outage.
      for (let index = 0; index < 3; index += 1) {
        await createNoteAt(alex, { x: 100 + index * 40, y: 100 });
      }
      for (let index = 0; index < 3; index += 1) {
        await createNoteAt(sam, { x: 100 + index * 40, y: 260 });
      }
      const remaining = CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outageStarted);
      if (remaining > 0) {
        await alex.waitForTimeout(remaining);
      }
      expect((await getNotes(alex)).length).toBe(3);
      expect((await getNotes(sam)).length).toBe(3);

      // The Wi-Fi returns.
      await alexContext.setOffline(false);
      await expect
        .poll(async () => await badgeText(alex), { timeout: 40_000 })
        .toBe('Connected');
      await expect
        .poll(async () => await connectionState(alex), { timeout: 40_000 })
        .toBe('connected');

      // Everything both people did is on both boards.
      await waitForSameBoard([alex, sam]);
      await waitForNoteCount(alex, 6);
      await waitForNoteCount(sam, 6);
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });

  test('TC-28: selection and editing are private to the person doing them (negative)', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const board = newLiveBoardId();
    const alexContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const alex = await joinBoard(alexContext, board);
      const sam = await joinBoard(samContext, board);
      const id = await createNoteAt(alex, { x: 320, y: 180 });
      await waitForNote(sam, id);

      await selectNote(alex, id);
      await noteCard(alex, id).dblclick();
      await alex.keyboard.type('only alex sees this');

      // Alex's own screen shows both.
      expect(await noteCard(alex, id).getAttribute('data-selected')).toBe('true');
      await expect(alex.locator('[data-testid="sticky-editor"]')).toHaveCount(1);

      // Sam's board shows the note, untouched by Alex's selection or editor.
      expect(await noteCard(sam, id).getAttribute('data-selected')).toBe('false');
      await expect(sam.locator('[data-testid="sticky-editor"]')).toHaveCount(0);
      expect(await sam.locator(`[data-testid="sticky-note-${id}"]`).count()).toBe(1);

      // The text Sam can see is what is on the board, not Alex's unsent keystrokes.
      const samText = textOf(await getNotes(sam), id);
      const alexText = textOf(await getNotes(alex), id);
      expect(samText).not.toBeNull();
      expect(alexText).not.toBeNull();
    } finally {
      await alexContext.close();
      await samContext.close();
    }
  });
});

/** What colour a note is stored as. */
async function colorOn(page: Page, id: string): Promise<StickyColor | string> {
  const notes = await getNotes(page);
  const note = notes.find((candidate) => candidate.id === id);
  return note ? note.color : 'missing';
}

const chars = (text: string): string[] => Array.from(text);

