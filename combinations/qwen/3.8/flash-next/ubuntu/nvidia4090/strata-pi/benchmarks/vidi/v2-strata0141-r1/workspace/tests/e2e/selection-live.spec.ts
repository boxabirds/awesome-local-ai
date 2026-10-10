import { expect, test, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { getNotes } from './helpers/sticky';
import { joinBoard, newLiveBoardId, trackErrors, waitForNote } from './helpers/live';
import { FIXTURE_NOTES } from '../fixtures/selection-board';
import {
  createNotesAt,
  marqueeSelect,
  selectionBarText,
  selectedIds,
  setZoomCamera,
  waitForSelectionBarText,
  waitForSelectedIds,
} from './helpers/selection';

/** The story 7 fixture: a 20-note retro board in two clusters. */
const FIXTURE_CENTRES = FIXTURE_NOTES;
const FIXTURE_SIZE = FIXTURE_NOTES.length;

/**
 * Story 7, task 5 - "Colleague deletes while I select" (TC-35): selection pruning
 * over the real sync path, with two browser contexts and the real `wrangler dev`.
 */
test.describe('story 7: selection survives the other person deleting things', () => {
  test('TC-35: a remotely deleted note leaves the local selection correct', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const boardId = newLiveBoardId();
    const leeContext = await browser.newContext();
    const samContext = await browser.newContext();
    try {
      const lee = await joinBoard(leeContext, boardId);
      const sam = await joinBoard(samContext, boardId);
      const leeErrors = trackErrors(lee);
      const samErrors = trackErrors(sam);

      // Lee seeds the 20-note fixture and zooms out so the whole grid is on screen.
      await setZoomCamera(lee, 0.5);
      const ids = await createNotesAt(lee, FIXTURE_CENTRES);
      await waitForSelectedIds(lee, []); // nothing selected yet
      await expect
        .poll(async () => (await getNotes(sam)).length, { timeout: 15_000 })
        .toBe(FIXTURE_SIZE);

      // Lee box-selects four notes.
      await marqueeSelect(lee, { x: 340, y: 340 }, { x: 860, y: 860 });
      const selected = [
        ids[6]!, // column 1, row 1
        ids[7]!, // column 2, row 1
        ids[11]!, // column 1, row 2
        ids[12]!, // column 2, row 2
      ];
      await waitForSelectedIds(lee, selected);
      await waitForSelectionBarText(lee, '4 selected');

      // Sam, on the same board, selects one of Lee's notes and deletes it.
      const doomed = selected[0]!;
      await setZoomCamera(sam, 0.5);
      const doomedWorld = FIXTURE_NOTES[6]!; // column 1, row 1
      const doomedCentreOnSam = { x: doomedWorld.x * 0.5, y: doomedWorld.y * 0.5 };
      await sam.mouse.click(doomedCentreOnSam.x, doomedCentreOnSam.y);
      await sam.waitForTimeout(120);
      expect(await selectedIds(sam)).toEqual([doomed]);

      const started = Date.now();
      await sam.keyboard.press('Delete');
      await waitForNote(lee, doomed, false);
      const ms = Date.now() - started;
      console.log(
        `TC-35 prune latency: ${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms; ` +
          `worse than the budget by more than 3x is a failure)`,
      );
      expect(ms).toBeLessThanOrEqual(3 * LIVE_UPDATE_LATENCY_BUDGET_MS);

      // Lee's selection lost exactly that one, and the bar followed it.
      const remaining = selected.slice(1);
      await waitForSelectedIds(lee, remaining);
      await waitForSelectionBarText(lee, '3 selected');
      expect(await selectionBarText(lee)).toBe('3 selected');
      for (const id of remaining) {
        expect(await noteSelected(lee, id)).toBe(true);
      }

      // Lee's Delete now removes exactly those three, and nothing else.
      await lee.keyboard.press('Delete');
      await lee.waitForTimeout(150);
      await waitForNoteCount(lee, FIXTURE_SIZE - selected.length);
      const left = await getNotes(lee);
      expect(left).toHaveLength(FIXTURE_SIZE - selected.length);
      expect(left.some((note) => remaining.includes(note.id))).toBe(false);
      expect(await selectedIds(lee)).toEqual([]);
      expect(await selectionBarText(lee)).toBeNull();

      await waitForNoteCount(sam, FIXTURE_SIZE - selected.length);
      expect(leeErrors).toEqual([]);
      expect(samErrors).toEqual([]);
    } finally {
      await leeContext.close();
      await samContext.close();
    }
  });
});

/** Is this object drawn as selected on this page? */
async function noteSelected(page: Page, id: string): Promise<boolean> {
  return (await page
    .locator(`[data-testid="sticky-note-${id}"]`)
    .getAttribute('data-selected')) === 'true';
}

/** Wait until this page's board holds exactly `count` notes. */
async function waitForNoteCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await getNotes(page)).length, { timeout: 15_000 })
    .toBe(count);
}
