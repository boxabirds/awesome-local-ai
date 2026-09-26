import { test, expect } from '@playwright/test';
import {
  newBoardId,
  openBoard,
  closeAll,
  isSelected,
  getNotes,
  type Participant,
} from './participants';
import { seedNotes, getSelection, marquee, screenOf, type SeedNote } from './helpers/selection';

/**
 * Story 7 TC-32 (sel.marquee_ui + sel.interaction): a Shift+drag rectangle
 * selects exactly the objects FULLY inside it — A inside, B half inside,
 * C outside -> only A selected. Runs in every configured browser.
 *
 * Layout (200x200 stickies, initial camera, zoom 1):
 *   A top-left (-500,-250) -> screen (140,110)-(340,310)
 *   B top-left (-250,-250) -> screen (390,110)-(590,310)
 *   C top-left (   0,-250) -> screen (640,110)-(840,310)
 * Marquee screen (130,100) -> (480,320) = world (-510,-260) -> (-160,-40):
 *   A: fully inside; B: 90 of its 200 width inside (partial); C: outside.
 */
test.describe('Story 7 marquee selection (all browsers)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('TC-32: marquee selects only fully-inside notes (A in, B half, C out)', async ({ browser }) => {
    const boardId = newBoardId();
    const p: Participant = await openBoard(browser, boardId);
    try {
      const a = crypto.randomUUID();
      const b = crypto.randomUUID();
      const c = crypto.randomUUID();
      const layout: SeedNote[] = [
        { id: a, x: -500, y: -250, z: 0 },
        { id: b, x: -250, y: -250, z: 1 },
        { id: c, x: 0, y: -250, z: 2 },
      ];
      await seedNotes(p.page, layout);

      // Marquee: world (-510,-260) -> (-160,-40).
      await marquee(
        p.page,
        screenOf({ x: -510, y: -260 }),
        screenOf({ x: -160, y: -40 }),
      );

      // The marquee rectangle is gone once the drag ends.
      await expect(p.page.locator('[data-testid="marquee"]')).toHaveCount(0);

      // Only A is selected.
      await expect
        .poll(async () => getSelection(p.page), { timeout: 5000 })
        .toEqual([a]);
      expect(await isSelected(p.page, a)).toBe(true);
      expect(await isSelected(p.page, b)).toBe(false);
      expect(await isSelected(p.page, c)).toBe(false);

      // Single sticky -> the story 2 toolbar, not the multi-select bar.
      await expect(p.page.locator('[data-testid="note-toolbar"]')).toBeVisible();
      await expect(p.page.locator('[data-testid="selection-bar"]')).toHaveCount(0);

      // Nothing was moved or created.
      const notes = await getNotes(p.page);
      expect(notes).toHaveLength(3);
      const na = notes.find((n) => n.id === a)!;
      expect(na.x).toBe(-500);
      expect(na.y).toBe(-250);
    } finally {
      await closeAll(p);
    }
  });
});
