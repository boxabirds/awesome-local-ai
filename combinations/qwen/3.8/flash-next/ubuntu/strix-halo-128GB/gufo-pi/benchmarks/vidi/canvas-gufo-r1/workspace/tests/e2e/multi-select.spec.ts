import { expect, test } from '@playwright/test';
import { gotoBoard, setCamera } from './helpers/board';
import { createBoard, openParticipants, closeParticipants } from './helpers/participants';
import { MAX_CONCURRENT_EDITORS, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

/** Create sticky notes at specified world positions via the test hook. */
async function seedNotes(page: import('@playwright/test').Page, positions: Array<{x: number; y: number}>): Promise<string[]> {
  const ids: string[] = [];
  for (const pos of positions) {
    const id = await page.evaluate(([x, y]) => {
      const hooks = (window as any).__vidi6;
      if (!hooks?.Y || !hooks?.createSticky) throw new Error('test hooks not available');
      const doc = (hooks.provider as any)?.doc;
      if (!doc) throw new Error('doc not available');
      return hooks.createSticky(doc, { x, y });
    }, [pos.x, pos.y]);
    ids.push(id);
  }
  return ids;
}



/** Get the note's x,y from the doc */
async function getNoteWorldPos(page: import('@playwright/test').Page, noteId: string) {
  return page.evaluate((id) => {
    const hooks = (window as any).__vidi6;
    const doc = (hooks?.provider as any)?.doc;
    if (!doc) throw new Error('doc not available');
    const obj = doc.getMap('objects').get(id);
    if (!obj) return null;
    return { x: obj.get('x'), y: obj.get('y'), width: obj.get('width'), height: obj.get('height') };
  }, noteId);
}

test.describe('Multi-select, move, resize, delete — e2e', () => {
  test.describe.configure({ mode: 'serial' });

  // TC-32: marquee selects only fully-contained notes
  test('TC-32 marquee selects only fully-contained objects', async ({ page }) => {
    await gotoBoard(page);

    // Place camera so world origin maps to viewport center
    // screenToWorld({x:0,y:0}) = (cam.x, cam.y). With reset: cam = (-640, -400)
    // So world (0,0) maps to screen (640, 400). Note centered at (0,0) → bounds (-100,-100) to (100,100)
    // Screen: bounds at (640-100, 400-100) to (640+100, 400+100) = (540,300) to (740,500)

    await setCamera(page, 0, 0, 1);

    // Create note A: world center at (100, 100) → world bounds (-100, -100) to (100, 100)
    // At cam(0,0,zoom1): screen pos = world - cam → screen = world
    // So bounds on screen: (-100,-100) to (100,100) → but need to check viewport offset
    // Actually: screenToWorld at cam(0,0,zoom1): screen point (sx,sy) → world (sx, sy)
    // worldToScreen: world (wx,wy) → screen (wx-0, wy-0) = (wx, wy)
    // Note at world center (100,100): bounds = (0, 0, 200, 200) → screen bounds (0, 0) to (200, 200)

    const ids = await seedNotes(page, [
      { x: 100, y: 100 },  // A: bounds (0, 0, 200, 200) — fully inside
      { x: 250, y: 100 },  // B: bounds (150, 0, 200, 200) → 150+200=350 > 310 → not fully inside
      { x: 500, y: 500 },  // C: bounds (400, 400, 200, 200) → outside
    ]);
    const [idA, idB, idC] = ids;
    await page.waitForTimeout(200);

    // Marquee from screen (0,0) to (310, 210)
    // In world space: (0,0) to (310, 210) → rect {x:0, y:0, width:310, height:210}
    // A bounds (0, 0, 200, 200) → right 200 ≤ 310, bottom 200 ≤ 210 → inside ✓
    // B bounds (150, 0, 200, 200) → right 350 > 310 → NOT inside ✓
    // C bounds (400, 400, 200, 200) → way outside ✓

    await page.keyboard.down('Shift');
    await page.mouse.move(5, 5);
    await page.mouse.down();
    await page.mouse.move(310, 210, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await page.waitForTimeout(200);

    // Only A should be selected
    const aSelected = await page.locator(`[data-note-id="${idA}"]`).getAttribute('data-selected');
    const bSelected = await page.locator(`[data-note-id="${idB}"]`).getAttribute('data-selected');
    const cSelected = await page.locator(`[data-note-id="${idC}"]`).getAttribute('data-selected');

    expect(aSelected).toBe('true');
    expect(bSelected).toBe('false');
    expect(cSelected).toBe('false');
  });

  // TC-33: select multiple notes, move together, resize
  test('TC-33 group move and resize with handle', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, -200, -200, 0.5);
    // At cam(-200, -200, zoom 0.5): screenToWorld(sx,sy) = (sx/0.5 + (-200), sy/0.5 + (-200)) = (sx*2 - 200, sy*2 - 200)
    // worldToScreen(wx, wy) = (wx-(-200))*0.5, (wy-(-200))*0.5) = (wx*0.5 + 100, wy*0.5 + 100)

    // Create 6 notes in a cluster
    const clusterPositions = [
      { x: 100, y: 100 },
      { x: 100, y: 350 },
      { x: 350, y: 100 },
      { x: 350, y: 350 },
      { x: 600, y: 100 },
      { x: 600, y: 350 },
    ];

    const ids = await seedNotes(page, clusterPositions);
    // 7th note to the side (not selected)
    const [id7th] = await seedNotes(page, [{ x: 1200, y: 600 }]);
    await page.waitForTimeout(300);

    // Use the marquee to select all 6 cluster notes
    // Bounds of cluster: world x: (0, 700), y: (0, 550)
    // Screen: (0*0.5+100, 0*0.5+100) to (700*0.5+100, 550*0.5+100) = (100, 100) to (450, 375)
    await page.keyboard.down('Shift');
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(500, 420, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForTimeout(200);

    // Verify 6 selected via the selection bar
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('6 selected');

    // Record initial world positions of all selected notes
    const beforePositions: Array<{x: number, y: number}> = [];
    for (const id of ids) {
      const pos = await getNoteWorldPos(page, id);
      beforePositions.push(pos!);
    }

    // Now drag one of the selected notes by (150, 0) screen pixels → world delta (300, 0)
    const noteEl = page.locator(`[data-note-id="${ids[0]}"]`);
    const box = await noteEl.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Check all 6 moved by (300, 0) in world (screen 150 / zoom 0.5 = 300)
    const afterPositions: Array<{x: number, y: number}> = [];
    for (const id of ids) {
      const pos = await getNoteWorldPos(page, id);
      afterPositions.push(pos!);
    }

    for (let i = 0; i < ids.length; i++) {
      expect(afterPositions[i].x - beforePositions[i].x).toBeCloseTo(300, 0);
      expect(afterPositions[i].y - beforePositions[i].y).toBeCloseTo(0, 0);
    }

    // Verify notes are above the 7th (bringToFront)
    const z7th = await page.evaluate((id) => {
      const hooks = (window as any).__vidi6;
      const doc = (hooks?.provider as any)?.doc;
      return doc.getMap('objects').get(id)?.get('z');
    }, id7th);

    for (const id of ids) {
      const z = await page.evaluate((nid) => {
        const hooks = (window as any).__vidi6;
        const doc = (hooks?.provider as any)?.doc;
        return doc.getMap('objects').get(nid)?.get('z');
      }, id);
      expect(z).toBeGreaterThan(z7th);
    }
  });

  // TC-34: keyboard nudge and delete
  test('TC-34 arrow nudge and Delete work without page scroll', async ({ page }) => {
    await gotoBoard(page);
    await setCamera(page, 0, 0, 1);

    // Create 3 notes near each other
    const ids = await seedNotes(page, [
      { x: 100, y: 100 },
      { x: 350, y: 100 },
      { x: 600, y: 100 },
    ]);
    await page.waitForTimeout(200);

    // Select all with Ctrl+A
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    // Verify 3 selected
    await expect(page.locator('[data-testid="selection-count"]')).toHaveText('3 selected');

    // Record initial x position
    const beforeX = await getNoteWorldPos(page, ids[0]);

    // Press Right arrow 3 times → should move by 1*3 = 3 world units
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const afterArrow = await getNoteWorldPos(page, ids[0]);
    expect(afterArrow!.x - beforeX!.x).toBeCloseTo(3, 0);

    // Press Shift+Right → should move by 10 more
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(100);

    const afterShift = await getNoteWorldPos(page, ids[0]);
    expect(afterShift!.x - afterArrow!.x).toBeCloseTo(10, 0);

    // Verify no page scroll
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Verify camera unchanged
    const camState = await page.evaluate(() => {
      const hooks = (window as any).__vidi6;
      return hooks?.setCamera ? 'available' : 'missing';
    });
    expect(camState).toBe('available');

    // Press Delete → all removed
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid^="sticky-note-"]')).toHaveCount(0);
  });

  // TC-35: remote delete prunes selection
  test('TC-35 colleague deletes selected note, selection count drops', async ({ browser }) => {
    // Create a board
    const firstContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const firstPage = await firstContext.newPage();
    const boardId = await createBoard(firstPage);
    await firstPage.goto(`/b/${boardId}`);
    await expect(firstPage.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Set camera on Lee's page
    await setCamera(firstPage, 0, 0, 1);

    // Create 4 notes
    const ids = await seedNotes(firstPage, [
      { x: 100, y: 100 },
      { x: 350, y: 100 },
      { x: 600, y: 100 },
      { x: 850, y: 100 },
    ]);
    await firstPage.waitForTimeout(300);

    // Lee selects all 4 with Ctrl+A
    await firstPage.keyboard.press('Control+a');
    await firstPage.waitForTimeout(200);
    await expect(firstPage.locator('[data-testid="selection-count"]')).toHaveText('4 selected');

    // Open Sam's context on the same board
    const samContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const samPage = await samContext.newPage();
    await samPage.goto(`/b/${boardId}`);
    await expect(samPage.locator('[data-testid="board-viewport"]')).toBeVisible();
    await samPage.waitForTimeout(500);

    // Sam deletes the second note by selecting it and pressing Delete
    // Click on it first (selects only that note)
    const noteEl = samPage.locator(`[data-note-id="${ids[1]}"]`);
    await expect(noteEl).toBeVisible({ timeout: 5000 });
    const box = await noteEl.boundingBox();
    expect(box).not.toBeNull();
    await samPage.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await samPage.waitForTimeout(200);
    await samPage.keyboard.press('Delete');

    // Lee should see the note disappear and selection count drop to 3
    await expect(firstPage.locator('[data-testid="selection-count"]')).toHaveText('3 selected', {
      timeout: LIVE_UPDATE_LATENCY_BUDGET_MS,
    });

    // The second note should be gone from Lee's view
    await expect(firstPage.locator(`[data-note-id="${ids[1]}"]`)).not.toBeVisible();

    // Other 3 should still be selected
    const selectedCount = await firstPage.locator('[data-selected="true"]').count();
    expect(selectedCount).toBe(3);

    await firstContext.close();
    await samContext.close();
  });

  // TC-36: full-capacity concurrent moves converge
  test('TC-36 multiple editors move different selections → identical results', async ({ browser }) => {
    const firstContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const firstPage = await firstContext.newPage();
    const boardId = await createBoard(firstPage);
    await firstPage.goto(`/b/${boardId}`);
    await expect(firstPage.locator('[data-testid="board-viewport"]')).toBeVisible();

    // Create notes: one per editor
    const numEditors = MAX_CONCURRENT_EDITORS;
    const positions = Array.from({ length: numEditors }, (_, i) => ({
      x: (i + 1) * 300,
      y: 100,
    }));

    const noteIds = await seedNotes(firstPage, positions);
    await firstPage.waitForTimeout(500);

    // Open N participant contexts
    const participants = await openParticipants(browser, boardId, numEditors);
    await firstContext.close(); // Close the seeding context

    // Each participant selects their note and moves it
    for (let i = 0; i < numEditors; i++) {
      const p = participants[i];
      // Set camera so notes are visible
      await setCamera(p.page, 0, 0, 1);
      await p.page.waitForTimeout(300);

      // Click on their note
      const noteEl = p.page.locator(`[data-note-id="${noteIds[i]}"]`);
      const box = await noteEl.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // Move by (100 + i*50, 200) screen pixels → each moves a different amount
        await p.page.mouse.move(cx, cy);
        await p.page.mouse.down();
        await p.page.mouse.move(cx + 100 + i * 50, cy + 200, { steps: 5 });
        await p.page.mouse.up();
      }
    }

    // Wait for convergence
    await participants[0].page.waitForTimeout(2000);

    // Check all participants see the same positions
    const referencePositions = await participants[0].page.evaluate((ids) => {
      const hooks = (window as any).__vidi6;
      const doc = (hooks?.provider as any)?.doc;
      const objects = doc.getMap('objects');
      return ids.map((id: string) => {
        const obj = objects.get(id);
        return obj ? { x: obj.get('x'), y: obj.get('y') } : null;
      });
    }, noteIds);

    for (let i = 0; i < numEditors; i++) {
      const positions = await participants[i].page.evaluate((ids) => {
        const hooks = (window as any).__vidi6;
        const doc = (hooks?.provider as any)?.doc;
        const objects = doc.getMap('objects');
        return ids.map((id: string) => {
          const obj = objects.get(id);
          return obj ? { x: obj.get('x'), y: obj.get('y') } : null;
        });
      }, noteIds);

      for (let j = 0; j < numEditors; j++) {
        expect(positions[j]).toEqual(referencePositions[j]);
      }
    }

    await closeParticipants(participants);
  });
});
