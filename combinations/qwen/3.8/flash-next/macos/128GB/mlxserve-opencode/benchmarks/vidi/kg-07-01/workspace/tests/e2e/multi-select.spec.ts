import { expect, test, type Page } from '@playwright/test';
import { openBoard, settle } from './helpers/board';
import { centreOf, createByDoubleClick, notes } from './helpers/notes';
import {
  closeAll,
  expectWithin,
  openParticipants,
} from './helpers/participants';
import {
  pressKey,
  resizeByHandle,
  selectAll,
  selection,
} from './helpers/selection';
import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';

/**
 * Creates `count` notes at evenly-spaced screen positions within the viewport.
 * Uses the default camera so screen positions remain stable.
 */
async function createNotes(page: Page, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = 150 + (i % 4) * 250;
    const y = 150 + Math.floor(i / 4) * 250;
    const id = await createByDoubleClick(page, { x, y });
    await page.keyboard.press('Escape');
    await settle(page);
    ids.push(id);
  }
  return ids;
}

test.describe('TC-32 marquee selects only fully enclosed objects', () => {
  test('A inside, B half inside, C outside → only A selected', async ({ page }) => {
    await openBoard(page);

    // Create 3 notes at well-separated screen positions.
    // Note A: screen centre (200, 200) → bounds ~[100, 100, 300, 300] on screen.
    const idA = await createByDoubleClick(page, { x: 200, y: 200 });
    await page.keyboard.press('Escape');
    await settle(page);

    // Note B: screen centre (350, 350) → bounds ~[250, 250, 450, 450]. Half inside rect below.
    const idB = await createByDoubleClick(page, { x: 350, y: 350 });
    await page.keyboard.press('Escape');
    await settle(page);

    // Note C: screen centre (700, 600) → bounds ~[600, 500, 800, 700]. Outside rect below.
    const idC = await createByDoubleClick(page, { x: 700, y: 600 });
    await page.keyboard.press('Escape');
    await settle(page);

    // Clear any selection first, then marquee.
    await page.mouse.click(1100, 700);
    await settle(page);

    // Marquee: drag from (50, 50) to (310, 310). Fully encloses A but not B, not C.
    await page.keyboard.down('Shift');
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(310, 310, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);

    const sel = await selection(page);
    expect(sel).toContain(idA);
    expect(sel).not.toContain(idB);
    expect(sel).not.toContain(idC);
  });
});

test.describe('TC-33 group move and resize', () => {
  test('6 notes move together and corner resize scales them', async ({ page }) => {
    await openBoard(page);

    // Create 6 notes in a tighter grid so the SE handle stays on-screen after move.
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const x = 150 + (i % 3) * 220;
      const y = 150 + Math.floor(i / 3) * 220;
      const id = await createByDoubleClick(page, { x, y });
      await page.keyboard.press('Escape');
      await settle(page);
      ids.push(id);
    }

    // Select all with Ctrl+A.
    const sel = await selectAll(page);
    expect(sel).toHaveLength(6);

    // Read current positions, then drag note 0 by (200, 100) on screen.
    const before = await notes(page);
    const posBefore = new Map(before.map((n) => [n.id, { x: n.x, y: n.y }]));

    const noteCentre = await centreOf(page, ids[0]);
    await page.mouse.move(noteCentre.x, noteCentre.y);
    await page.mouse.down();
    await page.mouse.move(noteCentre.x + 100, noteCentre.y + 50, { steps: 5 });
    await page.mouse.move(noteCentre.x + 200, noteCentre.y + 100, { steps: 5 });
    await page.mouse.up();
    await settle(page);

    const afterMove = await notes(page);
    for (const id of ids) {
      const b = posBefore.get(id)!;
      const a = afterMove.find((n) => n.id === id)!;
      expect(Math.abs(a.x - b.x - 200), `id=${id} x delta`).toBeLessThanOrEqual(2);
      expect(Math.abs(a.y - b.y - 100), `id=${id} y delta`).toBeLessThanOrEqual(2);
    }

    // Selection should still be all 6 after the group move.
    const selAfterMove = await selection(page);
    expect(selAfterMove).toHaveLength(6);

    // Now resize: drag SE handle outward.
    await resizeByHandle(page, 'se', 100, 100);

    // Selection should still be all 6 after resize.
    const selAfterResize = await selection(page);
    expect(selAfterResize).toHaveLength(6);

    const afterResize = await notes(page);
    // All notes should have grown (aspect locked to 1:1 for sticky).
    for (const id of ids) {
      const a = afterResize.find((n) => n.id === id)!;
      expect(a.width, `id=${id} width defined`).toBeDefined();
      expect(a.width!, `id=${id} width`).toBeGreaterThan(STICKY_SIZE_WORLD);
      expect(a.height!, `id=${id} height`).toBeGreaterThan(STICKY_SIZE_WORLD);
    }
  });
});

test.describe('TC-34 keyboard nudge and delete', () => {
  test('arrows move selection without page scroll; Delete removes all', async ({ page }) => {
    await openBoard(page);

    const ids = await createNotes(page, 3);

    // Select all.
    await selectAll(page);

    // Nudge right with arrow.
    const before = await notes(page);
    await pressKey(page, 'ArrowRight');

    const afterNudge = await notes(page);
    for (const id of ids) {
      const b = before.find((n) => n.id === id)!;
      const a = afterNudge.find((n) => n.id === id)!;
      expect(Math.abs(a.x - b.x - NUDGE_STEP_WORLD)).toBeLessThanOrEqual(1);
    }

    // Nudge down with Shift (large step).
    const before2 = await notes(page);
    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);

    const afterNudge2 = await notes(page);
    for (const id of ids) {
      const b = before2.find((n) => n.id === id)!;
      const a = afterNudge2.find((n) => n.id === id)!;
      expect(Math.abs(a.y - b.y - NUDGE_LARGE_STEP_WORLD)).toBeLessThanOrEqual(1);
    }

    // Delete removes all selected.
    await pressKey(page, 'Delete');
    const remaining = await notes(page);
    expect(remaining).toHaveLength(0);
  });
});

test.describe('TC-35 colleague deletes while I select (selection pruning)', () => {
  test('remote delete removes note from my selection and count drops', async ({ browser }) => {
    const { people } = await openParticipants(browser, ['Lee', 'Sam']);
    const [lee, sam] = people;

    // Lee creates 4 notes and selects them all with Ctrl+A.
    const ids = await createNotes(lee.page, 4);
    await selectAll(lee.page);

    let sel = await selection(lee.page);
    expect(sel).toHaveLength(4);

    // Wait for Sam to see all 4 notes.
    await expectWithin(async () => (await notes(sam.page)).length).toBe(4);

    // Sam clicks one of Lee's notes to select it, then presses Delete.
    const noteBox = await sam.page.locator(`[data-note-id="${ids[0]}"]`).boundingBox();
    if (!noteBox) throw new Error('note not visible to Sam');
    await sam.page.mouse.click(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2);
    await settle(sam.page);
    await sam.page.keyboard.press('Delete');
    await settle(sam.page);

    // Wait for Lee's selection to prune: count drops from 4 to 3.
    await expectWithin(async () => (await selection(lee.page)).length).toBe(3);
    const pruned = await selection(lee.page);
    expect(pruned).not.toContain(ids[0]);

    // Verify the note is gone from Lee's notes.
    await expectWithin(async () => (await notes(lee.page)).length).toBe(3);

    // Lee presses Delete to remove remaining 3.
    await lee.page.keyboard.press('Delete');
    await settle(lee.page);
    await expectWithin(async () => (await notes(lee.page)).length).toBe(0);

    await closeAll(people);
  });
});

test.describe('TC-36 multiple editors move different selections', () => {
  test('editors move different notes and converge', async ({ browser }) => {
    // Use 3 editors to test convergence without overwhelming CI.
    const names = Array.from({ length: Math.min(MAX_CONCURRENT_EDITORS, 3) }, (_, i) => `Editor${i}`);
    const { people } = await openParticipants(browser, names);

    // First editor creates notes (one per editor).
    const ids = await createNotes(people[0].page, names.length);

    // Wait for all editors to see all notes.
    for (const p of people.slice(1)) {
      await expectWithin(async () => (await notes(p.page)).length).toBe(ids.length);
    }

    // Each editor moves its own note by (50, 50).
    const moves = people.map(async (p, i) => {
      const c = await centreOf(p.page, ids[i]);
      await p.page.mouse.click(c.x, c.y);
      await settle(p.page);
      const centre = await centreOf(p.page, ids[i]);
      await p.page.mouse.move(centre.x, centre.y);
      await p.page.mouse.down();
      await p.page.mouse.move(centre.x + 25, centre.y + 25, { steps: 3 });
      await p.page.mouse.move(centre.x + 50, centre.y + 50, { steps: 3 });
      await p.page.mouse.up();
      await settle(p.page);
    });
    await Promise.all(moves);

    // Wait for convergence: all people should see the same x position for each note.
    for (const id of ids) {
      await expectWithin(async () => {
        const snaps = await Promise.all(
          people.map(async (p) => (await notes(p.page)).find((n) => n.id === id)?.x),
        );
        return new Set(snaps).size;
      }).toBe(1);
    }

    await closeAll(people);
  });
});
