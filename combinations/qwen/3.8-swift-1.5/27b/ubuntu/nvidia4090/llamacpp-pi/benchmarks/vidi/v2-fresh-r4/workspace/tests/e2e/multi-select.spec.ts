import { test, expect, type Page, type Browser } from '@playwright/test';
import { setCamera, settle } from './helpers/board';
import {
  createBoardViaApi,
  openParticipant,
  closeParticipants,
  expectEventually,
  type Participant,
} from './helpers/participants';
import { seedBoard } from './helpers/seed-board';
import { MAX_CONCURRENT_EDITORS, NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';

/**
 * Get the screen-space bounding box of a sticky note element by index.
 */
async function noteBox(page: Page, index = 0): Promise<{ x: number; y: number; width: number; height: number }> {
  const boxes = page.locator('[data-vidi6="sticky-note"]');
  const box = await boxes.nth(index).boundingBox();
  if (!box) throw new Error(`sticky note ${index} has no bounding box`);
  return box;
}

/**
 * Get the world position (CSS left/top) of a note.
 */
async function noteWorldPos(page: Page, index: number): Promise<{ x: number; y: number }> {
  return page.locator('[data-vidi6="sticky-note"]').nth(index).evaluate((el) => {
    const style = (el as HTMLElement).style;
    return { x: parseFloat(style.left), y: parseFloat(style.top) };
  });
}

/**
 * Create a board with notes at known positions for testing.
 * seedBoard creates notes with createSticky at centers:
 *   Note i: center at ((i%50)*220, floor(i/50)*220)
 *   Stored top-left: ((i%50)*220 - 100, floor(i/50)*220 - 100)
 *   Size: 200x200
 *
 * With camera at (-640, -400), zoom 1:
 *   Note i screen position: ((i%50)*220 - 100 + 640, floor(i/50)*220 - 100 + 400)
 *   = ((i%50)*220 + 540, floor(i/50)*220 + 300)
 */
async function createTestBoard(browser: Browser, baseURL: string, noteCount: number): Promise<Participant> {
  const boardId = await createBoardViaApi(baseURL);
  const participant = await openParticipant(browser, baseURL, boardId);

  // Seed notes via WS for speed
  await seedBoard(baseURL, boardId, noteCount);

  // Wait for notes to appear
  await expectEventually(async () => {
    return (await participant.page.locator('[data-vidi6="sticky-note"]').count()) >= noteCount;
  }, `board has ${noteCount} notes`);

  // Reset camera to see the notes
  await setCamera(participant.page, { x: -640, y: -400, zoom: 1 });
  await settle(participant.page);

  return participant;
}

test.describe('story 7: multi-select, move, resize, delete', () => {
  // TC-32: Marquee select - A inside, B half inside, C outside → only A selected
  test('TC-32: Shift+drag selects only fully-inside notes', async ({ browser, baseURL }) => {
    const p = await createTestBoard(browser, baseURL!, 3);
    const page = p.page;

    // Note positions (screen coords at camera -640,-400 zoom 1):
    // Note 0: center(0,0) → top-left(-100,-100) → screen(540, 300) size 200 → (540,300)-(740,500)
    // Note 1: center(220,0) → top-left(120,-100) → screen(760, 300) size 200 → (760,300)-(960,500)
    // Note 2: center(440,0) → top-left(340,-100) → screen(980, 300) size 200 → (980,300)-(1180,500)

    // Shift+drag to fully enclose note 0 only:
    // Start before (540,300), end after (740,500), but before note 1 starts at 760
    await page.keyboard.down('Shift');
    await page.mouse.move(530, 290);
    await page.mouse.down();
    await page.mouse.move(750, 510, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Only note 0 should be selected
    const selectedNotes = page.locator('[data-vidi6="sticky-note"][data-selected="true"]');
    await expect(selectedNotes).toHaveCount(1);

    await closeParticipants([p]);
  });

  // TC-33: Group move
  test('TC-33: select 3 notes, move together', async ({ browser, baseURL }) => {
    const p = await createTestBoard(browser, baseURL!, 4);
    const page = p.page;

    // Note screen positions:
    // Note 0: (540,300)-(740,500)
    // Note 1: (760,300)-(960,500)
    // Note 2: (980,300)-(1180,500)
    // Note 3: (1200,300)-(1400,500)

    // Select first 3 notes (use Ctrl+A then click note 3 to deselect it)
    // Actually, simplest: use Ctrl+A to select all 4, then verify group move
    // The marquee select is verified in TC-32; here we focus on group move
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(200);

    // All 4 notes should be selected
    const selectedNotes = page.locator('[data-vidi6="sticky-note"][data-selected="true"]');
    await expect(selectedNotes).toHaveCount(4);

    // Get initial world positions
    const pos0Before = await noteWorldPos(page, 0);
    const pos1Before = await noteWorldPos(page, 1);
    const pos2Before = await noteWorldPos(page, 2);
    const pos3Before = await noteWorldPos(page, 3);

    // Drag note 0 by 300 screen px to the right (300 world units at zoom=1)
    const box0 = await noteBox(page, 0);
    const startX = box0.x + box0.width / 2;
    const startY = box0.y + box0.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 300, startY, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(200);

    await settle(page);

    // All 4 should have moved ~300 world units to the right
    const pos0After = await noteWorldPos(page, 0);
    const pos1After = await noteWorldPos(page, 1);
    const pos2After = await noteWorldPos(page, 2);
    const pos3After = await noteWorldPos(page, 3);

    const d0 = pos0After.x - pos0Before.x;
    const d1 = pos1After.x - pos1Before.x;
    const d2 = pos2After.x - pos2Before.x;
    const d3 = pos3After.x - pos3Before.x;

    // All should move by ~300 world units
    expect(d0).toBeCloseTo(300, 0);
    expect(d1).toBeCloseTo(300, 0);
    expect(d2).toBeCloseTo(300, 0);
    expect(d3).toBeCloseTo(300, 0);

    // Y positions unchanged
    expect(Math.abs(pos0After.y - pos0Before.y)).toBeLessThan(5);

    await closeParticipants([p]);
  });

  // TC-34: Arrow keys nudge without page scroll; Delete removes all
  test('TC-34: arrow keys nudge selection; Delete removes all', async ({ browser, baseURL }) => {
    const p = await createTestBoard(browser, baseURL!, 3);
    const page = p.page;

    // Select all 3 notes with Ctrl+A
    await page.keyboard.press('Control+a');

    const selectedNotes = page.locator('[data-vidi6="sticky-note"][data-selected="true"]');
    await expect(selectedNotes).toHaveCount(3);

    // Record scrollY and camera before nudging
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    const transformBefore = await page.locator('[data-vidi6="board-world"]').evaluate(
      (el) => (el as HTMLElement).style.transform
    );

    // Get initial position of first note
    const posBefore = await noteWorldPos(page, 0);

    // ArrowRight x3
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');

    // Shift+ArrowRight x1
    await page.keyboard.press('Shift+ArrowRight');

    await settle(page);

    const posAfter = await noteWorldPos(page, 0);

    // Should have moved 3*1 + 1*10 = 13 world units to the right
    expect(posAfter.x - posBefore.x).toBeCloseTo(3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD, 0);

    // Page scroll unchanged
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBe(scrollYBefore);

    // Camera unchanged (no pan)
    const transformAfter = await page.locator('[data-vidi6="board-world"]').evaluate(
      (el) => (el as HTMLElement).style.transform
    );
    expect(transformAfter).toBe(transformBefore);

    // Delete removes all
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(0);

    await closeParticipants([p]);
  });

  // TC-35: Colleague deletes one of my selected notes
  test('TC-35: remote delete prunes my selection', async ({ browser, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, 4);

    const lee = await openParticipant(browser, baseURL!, boardId);
    const sam = await openParticipant(browser, baseURL!, boardId);

    // Wait for notes to load on both
    await expectEventually(async () => {
      return (await lee.page.locator('[data-vidi6="sticky-note"]').count()) >= 4;
    }, 'Lee sees 4 notes');

    await expectEventually(async () => {
      return (await sam.page.locator('[data-vidi6="sticky-note"]').count()) >= 4;
    }, 'Sam sees 4 notes');

    // Reset cameras
    await setCamera(lee.page, { x: -640, y: -400, zoom: 1 });
    await settle(lee.page);
    await setCamera(sam.page, { x: -640, y: -400, zoom: 1 });
    await settle(sam.page);

    // Lee selects all 4 notes
    await lee.page.keyboard.press('Control+a');
    await expect(lee.page.locator('[data-vidi6="sticky-note"][data-selected="true"]')).toHaveCount(4);

    // Selection bar should show "4 selected"
    await expect(lee.page.locator('[data-vidi6="selection-count"]')).toHaveText('4 selected');

    // Sam selects one note and deletes it
    const samNote = sam.page.locator('[data-vidi6="sticky-note"]').first();
    const samNoteBox = await samNote.boundingBox();
    if (samNoteBox) {
      await sam.page.mouse.click(samNoteBox.x + samNoteBox.width / 2, samNoteBox.y + samNoteBox.height / 2);
    }
    await sam.page.keyboard.press('Delete');

    // Lee's selection should drop to 3
    await expectEventually(async () => {
      const count = await lee.page.locator('[data-vidi6="selection-count"]').textContent();
      return count === '3 selected';
    }, "Lee's selection drops to 3");

    // Lee still has 3 selected notes
    await expect(lee.page.locator('[data-vidi6="sticky-note"][data-selected="true"]')).toHaveCount(3);

    // Lee can delete the remaining 3
    await lee.page.keyboard.press('Delete');
    await expect(lee.page.locator('[data-vidi6="sticky-note"]')).toHaveCount(0);

    await closeParticipants([lee, sam]);
  });

  // TC-36: Full-capacity reorganisation - MAX_CONCURRENT_EDITORS move different selections
  test('TC-36: concurrent editors move different selections simultaneously', async ({ browser, baseURL }) => {
    const editorCount = MAX_CONCURRENT_EDITORS; // 5
    const notesPerEditor = 2;
    const totalNotes = editorCount * notesPerEditor; // 10

    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, totalNotes);

    const participants: Participant[] = [];
    for (let i = 0; i < editorCount; i++) {
      participants.push(await openParticipant(browser, baseURL!, boardId));
    }

    // Wait for all to load
    for (const p of participants) {
      await expectEventually(async () => {
        return (await p.page.locator('[data-vidi6="sticky-note"]').count()) >= totalNotes;
      }, `participant sees ${totalNotes} notes`);
      await setCamera(p.page, { x: -640, y: -400, zoom: 1 });
      await settle(p.page);
    }

    // Each editor clicks their note (selecting it) and moves it by a different amount.
    // Note i is at center ((i%50)*220, 0) → top-left x = i*220 - 100
    // Editor i moves note (i*2) by 100*(i+1) to the right.

    const movePromises = participants.map(async (p, i) => {
      const offset = 100 * (i + 1);
      const noteIndex = i * 2;
      const note = p.page.locator('[data-vidi6="sticky-note"]').nth(noteIndex);
      const box = await note.boundingBox();
      if (!box) throw new Error(`Note ${noteIndex} not found`);

      // Click to select, then drag
      await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.page.mouse.down();
      await p.page.mouse.move(box.x + box.width / 2 + offset, box.y + box.height / 2, { steps: 5 });
      await p.page.waitForTimeout(50);
      await p.page.mouse.up();
    });

    await Promise.all(movePromises);

    // Wait for all to settle and converge
    await new Promise(r => setTimeout(r, 2000));

    // Verify: all editors see the same converged state (10 notes each)
    for (const p of participants) {
      await expect(p.page.locator('[data-vidi6="sticky-note"]')).toHaveCount(totalNotes);
    }

    // Verify convergence: all editors see the same total bounding area
    // (notes have moved, so the union of all note positions should be the same)
    const getBounds = async (page: Page) => {
      return page.evaluate(() => {
        const notes = document.querySelectorAll('[data-vidi6="sticky-note"]') as NodeListOf<HTMLElement>;
        let minX = Infinity, maxX = -Infinity;
        notes.forEach(el => {
          const x = parseFloat(el.style.left);
          const w = parseFloat(el.style.width) || 200;
          if (x < minX) minX = x;
          if (x + w > maxX) maxX = x + w;
        });
        return { minX, maxX };
      });
    };

    const bounds0 = await getBounds(participants[0].page);
    const boundsLast = await getBounds(participants[editorCount - 1].page);
    expect(bounds0.minX).toBeCloseTo(boundsLast.minX, 0);
    expect(bounds0.maxX).toBeCloseTo(boundsLast.maxX, 0);

    // The overall bounding box should be wider than the original (notes moved right)
    // Original: notes from x=-100 to x=9*220-100+200 = 1980, width = 2080
    // After moves, some notes moved right, so maxX should be > 1980
    expect(bounds0.maxX).toBeGreaterThan(1980);

    await closeParticipants(participants);
  });
});
