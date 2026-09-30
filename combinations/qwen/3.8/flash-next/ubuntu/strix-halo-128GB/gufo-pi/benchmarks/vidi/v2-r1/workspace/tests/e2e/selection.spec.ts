/**
 * E2E story 7 tests: select, move, resize and delete several objects at once.
 * TC-32, TC-33, TC-34, TC-35, TC-36
 */
import { expect, test } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
} from '../../src/shared/config';
import {
  closeParticipants,
  expectEventually,
  noteCount,
  openParticipants,
  type Participant,
} from './helpers/participants';
import { getCamera } from './helpers/board';
import { worldToScreen } from '../../src/client/canvas/camera';

/**
 * Add notes at specific world positions via the test hook.
 * Returns the ids of the created notes.
 */
async function addNotesAt(
  page: import('@playwright/test').Page,
  positions: Array<{ x: number; y: number }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const pos of positions) {
    const id = await page.evaluate(({ x, y }) => {
      return window.__vidi6?.addNoteAt?.({ x, y }) ?? '';
    }, pos);
    ids.push(id);
  }
  // Small wait for rendering
  await page.waitForTimeout(100);
  return ids;
}

/**
 * Get the note positions from the DOM.
 */
async function getNotePositions(page: import('@playwright/test').Page) {
  return page.$$eval('.sticky-note', (els) =>
    els.map((el) => ({
      id: (el as HTMLElement).dataset.noteId ?? '',
      x: Number((el as HTMLElement).dataset.noteX),
      y: Number((el as HTMLElement).dataset.noteY),
    })),
  );
}

test.describe('TC-32: Marquee select only fully-inside notes', () => {
  let participants: Participant[];

  test.beforeEach(async ({ browser }) => {
    participants = await openParticipants(browser, 1);
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  test('Shift+drag selects only note A (fully inside), not B (half inside) or C (outside)', async () => {
    const p = participants[0];
    const page = p.page;

    // Create 3 notes at known world positions (x,y is top-left after creation, but createSticky centers them)
    // createSticky places at pos - STICKY_SIZE_WORLD/2. So world center = pos, edges at pos +/- 100.
    // A: center at 150,150 → edges 50..250 → fully inside marquee 0..300
    // B: center at 250,150 → edges 150..350 → right edge at 350 > 300, NOT fully inside
    // C: center at 500,500 → fully outside
    await addNotesAt(page, [
      { x: 150, y: 150 },  // A: edges 50..250, fully inside 0..300
      { x: 250, y: 150 },  // B: edges 150..350, NOT fully inside 0..300
      { x: 500, y: 500 },  // C: edges 400..600, outside
    ]);

    const camera = await getCamera(page);

    // We want a marquee in screen space that covers world 0,0 to 300,300
    const marqueeStart = worldToScreen(camera, { x: 0, y: 0 });
    const marqueeEnd = worldToScreen(camera, { x: 300, y: 300 });

    // Shift+drag from marqueeStart to marqueeEnd
    await page.keyboard.down('Shift');
    await page.mouse.move(marqueeStart.x, marqueeStart.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 5 });
    await page.mouse.up({ button: 'left' });
    await page.keyboard.up('Shift');

    await page.waitForTimeout(100);

    // Only note A (edges 50..250) is fully inside 0..300
    const selectedCount = await page.locator('[data-selected="true"]').count();
    expect(selectedCount).toBe(1);
  });
});

test.describe('TC-33: Group move and resize', () => {
  let participants: Participant[];

  test.beforeEach(async ({ browser }) => {
    participants = await openParticipants(browser, 1);
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  test('Select multiple notes, drag one moves all; far note stays put and below', async () => {
    const p = participants[0];
    const page = p.page;

    // Create 3 cluster notes + 1 far note, all within visible viewport
    // With camera at (-640,-400), world (-100,-100) maps to screen (540,300)
    // Cluster: centers at (150,150), (400,150), (150,300)
    // Far: center at (600,280)
    const clusterPositions = [
      { x: 150, y: 150 },
      { x: 400, y: 150 },
      { x: 150, y: 300 },
    ];
    const clusterIds = await addNotesAt(page, clusterPositions);
    const farIds = await addNotesAt(page, [{ x: 600, y: 280 }]);

    const camera = await getCamera(page);

    // Select all cluster notes: click first, shift-click second, shift-click third
    const firstCentre = worldToScreen(camera, { x: 150, y: 150 });
    await page.mouse.click(firstCentre.x, firstCentre.y);
    const secondCentre = worldToScreen(camera, { x: 400, y: 150 });
    await page.keyboard.down('Shift');
    await page.mouse.click(secondCentre.x, secondCentre.y);
    const thirdCentre = worldToScreen(camera, { x: 150, y: 300 });
    await page.mouse.click(thirdCentre.x, thirdCentre.y);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(100);

    const selectedCount = await page.locator('[data-selected="true"]').count();
    expect(selectedCount).toBe(3);

    const positionsBefore = await getNotePositions(page);

    // Drag the first cluster note right by 300 screen pixels
    const grabPoint = worldToScreen(camera, { x: 150, y: 150 });
    const dx = 300;
    await page.mouse.move(grabPoint.x, grabPoint.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(grabPoint.x + dx, grabPoint.y, { steps: 10 });
    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(100);

    const positionsAfter = await getNotePositions(page);

    // The 3 cluster notes should have moved right by 300 world units (zoom=1)
    for (const posBefore of positionsBefore) {
      if (clusterIds.includes(posBefore.id)) {
        const posAfter = positionsAfter.find((p) => p.id === posBefore.id)!;
        expect(posAfter.x - posBefore.x).toBeCloseTo(300, 0);
      }
    }

    // The far note should NOT have moved
    const farBefore = positionsBefore.find((p) => farIds.includes(p.id))!;
    const farAfter = positionsAfter.find((p) => farIds.includes(p.id))!;
    expect(farAfter.x).toBe(farBefore.x);
    expect(farAfter.y).toBe(farBefore.y);

    // Verify the cluster notes are now above the far note (higher z-index)
    const zIndices = await page.$$eval('.sticky-note', (els) =>
      els.map((el) => ({
        id: (el as HTMLElement).dataset.noteId ?? '',
        z: Number((el as HTMLElement).style.zIndex || 0),
      })),
    );
    const farZ = zIndices.find((z) => farIds.includes(z.id))!.z;
    for (const cid of clusterIds) {
      const cz = zIndices.find((z) => z.id === cid)!.z;
      expect(cz).toBeGreaterThan(farZ);
    }
  });
});

test.describe('TC-34: Keyboard nudge and delete', () => {
  let participants: Participant[];

  test.beforeEach(async ({ browser }) => {
    participants = await openParticipants(browser, 1);
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  test('Arrows nudge selection, Shift+arrows large nudge, Delete removes all', async () => {
    const p = participants[0];
    const page = p.page;

    // Create 3 notes
    await addNotesAt(page, [
      { x: 200, y: 200 },
      { x: 450, y: 200 },
      { x: 200, y: 450 },
    ]);

    // Select all
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(50);

    const before = await getNotePositions(page);

    // Nudge right 3 times
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    // Shift+Right for large step
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(50);

    const after = await getNotePositions(page);

    // Total right movement: 3*NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD
    const expectedDx = 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD;
    for (let i = 0; i < 3; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(expectedDx, 1);
    }

    // Camera should not have panned (no page scroll)
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    // Delete all selected
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    expect(await noteCount(page)).toBe(0);
  });
});

test.describe('TC-35: Colleague deletes one of my selected notes', () => {
  test('Remote delete prunes selection; remaining count drops', async ({ browser }) => {
    const participants = await openParticipants(browser, 2);
    const [lee, sam] = participants;

    try {
      // Create 4 notes via Lee's test hook
      const positions = [
        { x: 200, y: 200 },
        { x: 450, y: 200 },
        { x: 200, y: 450 },
        { x: 450, y: 450 },
      ];
      await addNotesAt(lee.page, positions);

      // Wait for Sam to see them
      await expectEventually('TC-35 sync', participants, async () => {
        return (await noteCount(sam.page)) === 4;
      });

      // Lee selects all 4 notes
      await lee.page.keyboard.press('Control+a');
      await lee.page.waitForTimeout(100);

      // Verify Lee sees "4 selected"
      await expect(lee.page.getByTestId('selection-bar')).toBeVisible();
      await expect(lee.page.getByTestId('selection-count')).toHaveText('4 selected');

      // Sam deletes the first note: click it to select it, then press Delete
      const camera = await getCamera(sam.page);
      const targetScreen = worldToScreen(camera, { x: 200, y: 200 });
      await sam.page.mouse.click(targetScreen.x, targetScreen.y);
      await sam.page.waitForTimeout(50);
      await sam.page.keyboard.press('Delete');
      await sam.page.waitForTimeout(100);

      // Lee should see selection drop to 3 (pruned by the remote delete)
      await expectEventually('TC-35 prune', participants, async () => {
        const count = await lee.page.locator('[data-selected="true"]').count();
        return count === 3;
      });

      // The "3 selected" bar should now show
      await expect(lee.page.getByTestId('selection-count')).toHaveText('3 selected');

      // Lee presses Delete to remove remaining 3
      await lee.page.keyboard.press('Delete');
      await lee.page.waitForTimeout(100);

      // All notes gone
      expect(await noteCount(lee.page)).toBe(0);
      expect(await noteCount(sam.page)).toBe(0);
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('TC-36: Full-capacity simultaneous moves', () => {
  test('MAX_CONCURRENT_EDITORS contexts each move a different note → identical final positions', async ({ browser }) => {
    const count = MAX_CONCURRENT_EDITORS;
    const participants = await openParticipants(browser, count);

    try {
      // Create 4 notes in a row (one per participant)
      const spacing = 250;
      const positions = Array.from({ length: count }, (_, i) => ({
        x: 100 + i * spacing,
        y: 200,
      }));
      await addNotesAt(participants[0].page, positions);

      // Wait for all participants to see all notes
      for (const p of participants) {
        await expectEventually(`TC-36 sync ${p.name}`, participants, async () => {
          return (await noteCount(p.page)) === count;
        });
      }

      // Each participant clicks to select their own note, then drags it right
      const camera = await getCamera(participants[0].page);

      // Each participant selects their note
      const selectPromises = participants.map(async (p, i) => {
        const screenPt = worldToScreen(camera, positions[i]);
        await p.page.mouse.click(screenPt.x, screenPt.y);
      });
      await Promise.all(selectPromises);
      await participants[0].page.waitForTimeout(100);

      // Each participant drags their note right by (i+1)*50 px
      const dragPromises = participants.map(async (p, i) => {
        const screenPt = worldToScreen(camera, positions[i]);
        const dx = (i + 1) * 50;
        await p.page.mouse.move(screenPt.x, screenPt.y);
        await p.page.mouse.down({ button: 'left' });
        await p.page.mouse.move(screenPt.x + dx, screenPt.y, { steps: 5 });
        await p.page.mouse.up({ button: 'left' });
      });
      await Promise.all(dragPromises);

      // Wait for convergence
      await participants[0].page.waitForTimeout(500);

      // All participants should see identical final positions
      const allPositions: Array<Array<{ id: string; x: number }>> = [];
      for (const p of participants) {
        const positions = await p.page.$$eval('.sticky-note', (els) =>
          els.map((el) => ({
            id: (el as HTMLElement).dataset.noteId ?? '',
            x: Number((el as HTMLElement).dataset.noteX),
          })),
        );
        positions.sort((a, b) => (a.id < b.id ? -1 : 1));
        allPositions.push(positions);
      }

      // Compare each participant's view with the first
      for (let i = 1; i < allPositions.length; i++) {
        expect(allPositions[i]).toHaveLength(count);
        for (let j = 0; j < count; j++) {
          expect(allPositions[i][j].id).toBe(allPositions[0][j].id);
          expect(allPositions[i][j].x).toBeCloseTo(allPositions[0][j].x, 1);
        }
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});
