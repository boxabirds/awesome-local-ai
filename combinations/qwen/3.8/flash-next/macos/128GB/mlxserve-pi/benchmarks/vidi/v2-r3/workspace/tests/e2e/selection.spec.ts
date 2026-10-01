import { test, expect } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import {
  joinBoard,
  leaveAll,
  newBoard,
  expectSameBoard,
  expectEventually,
  type Person,
  measurements,
  reportLatency,
} from './helpers/participants';
import {
  clickNote,
  createNoteAt,
  dragNote,
  editor,
  expectCentreAt,
  expectWorldAt,
  noteBox,
  noteCentre,
  noteIds,
  noteLocator,
  noteState,
  noteSelected,
  noteWorldPos,
  waitForNoteCount,
  onlyNoteId,
  cameraOf,
  type ScreenPoint,
} from './helpers/stickies';

test.describe('multi-selection collaboration', () => {
  test('TC-35: colleague deletes one of my selected notes → my selection excludes only that one', async ({
    page,
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Seed 3 notes on my page (space them apart to avoid double-click conflicts)
    const id1 = await createNoteAt(me.page, { x: 300, y: 200 }, 'one');
    const id2 = await createNoteAt(me.page, { x: 600, y: 200 }, 'two');
    const id3 = await createNoteAt(me.page, { x: 900, y: 200 }, 'three');

    await waitForNoteCount(me.page, 3);
    await waitForNoteCount(colleague.page, 3);

    // Select all on my page
    await me.page.keyboard.press('Control+a');
    await expect(me.page.getByTestId('selection-count')).toHaveText('3 selected', { timeout: 2000 });

    // Colleague deletes id2
    await clickNote(colleague.page, id2);
    await colleague.page.keyboard.press('Backspace');

    // My page should see the note gone and selection pruned to 2
    await waitForNoteCount(me.page, 2);
    await expect(me.page.getByTestId('selection-count')).toHaveText('2 selected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Verify my selection still has id1 and id3 (both still rendered and selected)
    await expect(me.page.locator(`[data-note-id="${id1}"][data-selected="true"]`)).toBeVisible();
    await expect(me.page.locator(`[data-note-id="${id3}"][data-selected="true"]`)).toBeVisible();

    expect(await noteLocator(me.page, id2).count()).toBe(0);

    await leaveAll([me, colleague]);
  });

  test('TC-36: delete is collaborative → every page sees all selected notes gone', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Seed 4 notes with wide spacing
    await createNoteAt(me.page, { x: 200, y: 200 }, 'a');
    await createNoteAt(me.page, { x: 500, y: 200 }, 'b');
    await createNoteAt(me.page, { x: 800, y: 200 }, 'c');
    await createNoteAt(me.page, { x: 200, y: 500 }, 'd');

    await waitForNoteCount(me.page, 4);
    await waitForNoteCount(colleague.page, 4);

    // Select all and delete
    await me.page.keyboard.press('Control+a');
    await me.page.keyboard.press('Delete');

    // Both pages see zero notes
    await waitForNoteCount(me.page, 0);
    await waitForNoteCount(colleague.page, 0);
    await expectSameBoard([me, colleague], 'TC-36 delete all');

    await leaveAll([me, colleague]);
  });

  test('TC-38: my selected note is deleted remotely → selection empties', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Seed a note
    const id = await createNoteAt(me.page, { x: 500, y: 400 }, 'gone soon');
    await waitForNoteCount(me.page, 1);
    await waitForNoteCount(colleague.page, 1);

    // Select it on my page
    await clickNote(me.page, id);
    await expect(noteLocator(me.page, id).first()).toHaveAttribute('data-selected', 'true');
    // NoteToolbar should be showing
    await expect(me.page.getByRole('toolbar', { name: 'Sticky note toolbar' })).toBeVisible();

    // Colleague deletes it
    await clickNote(colleague.page, id);
    await colleague.page.keyboard.press('Delete');

    // My page: note gone, selection empty, no toolbar
    await waitForNoteCount(me.page, 0);
    await expect(me.page.getByRole('toolbar', { name: 'Sticky note toolbar' })).toHaveCount(0, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    await leaveAll([me, colleague]);
  });

  test('TC-39: group move is eventual → same world positions on other page', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Seed 3 notes at well-spaced positions
    await createNoteAt(me.page, { x: 300, y: 200 }, 'a');
    await createNoteAt(me.page, { x: 600, y: 200 }, 'b');
    await createNoteAt(me.page, { x: 300, y: 500 }, 'c');

    await waitForNoteCount(me.page, 3);
    await waitForNoteCount(colleague.page, 3);

    // Select all
    await me.page.keyboard.press('Control+a');

    // Drag one note (all selected should move)
    const ids = await noteIds(me.page);
    const id = ids[0]!;
    await dragNote(me.page, id, 50, 30);

    // My page: get all positions after the move
    const myPositions: Record<string, { x: number; y: number }> = {};
    for (const nid of ids) {
      myPositions[nid] = await noteWorldPos(me.page, nid);
    }

    // Colleague should see same positions
    for (const nid of ids) {
      const pos = myPositions[nid]!;
      await expectWorldAt(colleague.page, nid, pos.x, pos.y);
    }

    await expectSameBoard([me, colleague], 'TC-39 group move');

    await leaveAll([me, colleague]);
  });

  test('TC-40: group nudge moves every selected note by the same amount on both pages', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Seed notes
    await createNoteAt(me.page, { x: 300, y: 200 }, 'a');
    await createNoteAt(me.page, { x: 600, y: 200 }, 'b');
    await waitForNoteCount(me.page, 2);
    await waitForNoteCount(colleague.page, 2);

    // Select all on my page
    await me.page.keyboard.press('Control+a');

    const ids = await noteIds(me.page);
    const before = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));

    // Nudge right
    await me.page.keyboard.press('ArrowRight');

    // Verify positions changed
    const after = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));
    for (let i = 0; i < ids.length; i++) {
      expect(after[i]!.x).toBe(before[i]!.x + NUDGE_STEP_WORLD);
    }

    // Colleague sees the same final positions
    for (let i = 0; i < ids.length; i++) {
      await expectWorldAt(colleague.page, ids[i]!, after[i]!.x, after[i]!.y);
    }

    await leaveAll([me, colleague]);
  });

  test('TC-41: select, marquee-add, group move and delete on a real two-browsers board', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);
    const colleague = await joinBoard(browser, 'colleague', boardId);

    // Create 4 notes with wide spacing
    const id1 = await createNoteAt(me.page, { x: 300, y: 200 }, 'one');
    const id2 = await createNoteAt(me.page, { x: 600, y: 200 }, 'two');
    const id3 = await createNoteAt(me.page, { x: 900, y: 200 }, 'three');
    const id4 = await createNoteAt(me.page, { x: 300, y: 500 }, 'four');

    await waitForNoteCount(me.page, 4);
    await waitForNoteCount(colleague.page, 4);

    // Click note 1 to select it
    await clickNote(me.page, id1);

    // Shift+drag on empty space to marquee-select notes 2 and 3
    const box2 = await noteBox(me.page, id2);
    const box3 = await noteBox(me.page, id3);
    await me.page.keyboard.down('Shift');
    await me.page.mouse.move(box2.x - 10, box2.y - 10);
    await me.page.mouse.down();
    await me.page.mouse.move(box3.x + box3.width + 10, box3.y + box3.height + 10, { steps: 5 });
    await me.page.mouse.up();
    await me.page.keyboard.up('Shift');

    // Notes 1, 2, 3 should be selected; note 4 should not
    await expect(me.page.getByTestId('selection-count')).toHaveText('3 selected', { timeout: 2000 });
    await expect(noteLocator(me.page, id4)).toHaveAttribute('data-selected', 'false');

    // Group move: drag note 1
    const before = await noteWorldPos(me.page, id2);
    await dragNote(me.page, id1, 40, 20);

    // Note 2 should have moved too (it was part of the group)
    const after = await noteWorldPos(me.page, id2);
    expect(after.x).not.toBe(before.x);

    // Delete all selected (Ctrl+A first to get everything)
    await me.page.keyboard.press('Control+a');
    await me.page.keyboard.press('Delete');

    // All notes gone
    await waitForNoteCount(me.page, 0);
    await waitForNoteCount(colleague.page, 0);

    await leaveAll([me, colleague]);
  });

  test('TC-32: marquee selects only fully-inside notes', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);

    // Seed 3 notes with different positions
    await me.page.evaluate(() => window.__vidi6!.seedNotes(3));
    await waitForNoteCount(me.page, 3);

    const ids = await noteIds(me.page);
    const idA = ids[0]!;
    const idB = ids[1]!;
    const idC = ids[2]!;

    // Get actual screen positions
    const boxA = await noteBox(me.page, idA);
    const boxB = await noteBox(me.page, idB);

    // Shift+drag a marquee that fully contains note A but not B
    // Start just outside A's top-left, end just after A's bottom-right
    // (but before B's bottom-right)
    await me.page.keyboard.down('Shift');
    await me.page.mouse.move(boxA.x - 10, boxA.y - 10);
    await me.page.mouse.down();
    // End at A's bottom-right + margin, but before B's right/bottom
    await me.page.mouse.move(boxA.x + boxA.width + 5, boxA.y + boxA.height + 5, { steps: 5 });
    await me.page.mouse.up();
    await me.page.keyboard.up('Shift');

    // Only A should be selected
    await expect(me.page.locator(`[data-note-id="${idA}"]`)).toHaveAttribute('data-selected', 'true');
    // B and C should not be (assuming the marquee doesn't cover them fully)
    // Note: with seedNotes stride=260 and size=200, notes are 60 apart.
    // The marquee around A (width=200+5+10=215) should fully contain A
    // but the next note starts 60 world units later.
    await expect(me.page.locator(`[data-note-id="${idB}"]`)).toHaveAttribute('data-selected', 'false');
    await expect(me.page.locator(`[data-note-id="${idC}"]`)).toHaveAttribute('data-selected', 'false');

    await leaveAll([me]);
  });

  test('TC-33: group move moves all selected notes; resize handle scales proportionally', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);

    // Seed 6 notes in a grid layout
    // Grid with stride 260. Use page.evaluate to seed them at known positions.
    await me.page.evaluate(() => window.__vidi6!.seedNotes(6));
    await waitForNoteCount(me.page, 6);

    const ids = await noteIds(me.page);

    // Select all 6
    await me.page.keyboard.press('Control+a');
    await expect(me.page.getByTestId('selection-count')).toHaveText('6 selected', { timeout: 2000 });

    // Record initial positions
    const before = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));

    // Drag the first note by 300 world units (screen = world at zoom 1)
    await dragNote(me.page, ids[0]!, 300, 0);

    // All notes should have moved by 300
    const afterMove = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));
    for (let i = 0; i < 6; i++) {
      expect(Math.round(afterMove[i]!.x - before[i]!.x)).toBe(300);
    }

    // Now test resize: select all and use the SE handle to grow/shrink.
    // After the move, re-select all
    await me.page.keyboard.press('Control+a');

    // Get the bounding box position for handle interaction
    // We'll shrink using the SE handle. The selection overlay renders it.
    const seHandle = me.page.locator('[aria-label="Resize bottom-right"]');
    await expect(seHandle).toBeVisible();

    // Drag SE handle inward (shrink)
    const handleBox = await seHandle.boundingBox();
    expect(handleBox).not.toBeNull();
    // Drag inward by 200 screen px (world px at zoom=1)
    await me.page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await me.page.mouse.down();
    await me.page.mouse.move(handleBox!.x - 100, handleBox!.y - 100, { steps: 10 });
    await me.page.mouse.up();

    // All notes should still be square (aspect locked stickies)
    // Notes have explicit width/height now
    const dims = await me.page.evaluate((ids: string[]) => {
      return ids.map((id) => {
        const el = document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
        return { w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
      });
    }, ids);

    // Each sticky should be roughly square (aspect locked)
    for (const d of dims) {
      expect(Math.abs(d.w - d.h)).toBeLessThan(2); // square within rounding
      expect(d.w).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD - 1);
    }

    await leaveAll([me]);
  });

  test('TC-34: keyboard nudge and delete work without camera movement', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const me = await joinBoard(browser, 'me', boardId);

    // Seed 3 notes
    await me.page.evaluate(() => window.__vidi6!.seedNotes(3));
    await waitForNoteCount(me.page, 3);

    const ids = await noteIds(me.page);

    // Select all
    await me.page.keyboard.press('Control+a');
    const camBefore = await cameraOf(me.page);
    const scrollBefore = await me.page.evaluate(() => window.scrollY);

    const before = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));

    // ArrowRight 3 times
    await me.page.keyboard.press('ArrowRight');
    await me.page.keyboard.press('ArrowRight');
    await me.page.keyboard.press('ArrowRight');

    const afterArrows = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));
    for (let i = 0; i < ids.length; i++) {
      expect(afterArrows[i]!.x).toBe(before[i]!.x + 3 * NUDGE_STEP_WORLD);
    }

    // Shift+ArrowRight (large step)
    await me.page.keyboard.press('Shift+ArrowRight');
    const afterShift = await Promise.all(ids.map((id) => noteWorldPos(me.page, id)));
    for (let i = 0; i < ids.length; i++) {
      expect(afterShift[i]!.x).toBe(afterArrows[i]!.x + NUDGE_LARGE_STEP_WORLD);
    }

    // Camera unchanged
    const camAfter = await cameraOf(me.page);
    expect(camAfter.x).toBe(camBefore.x);
    expect(camAfter.y).toBe(camBefore.y);
    expect(camAfter.zoom).toBe(camBefore.zoom);

    // window.scrollY unchanged
    const scrollAfter = await me.page.evaluate(() => window.scrollY);
    expect(scrollAfter).toBe(scrollBefore);

    // Delete removes all selected
    await me.page.keyboard.press('Delete');
    await waitForNoteCount(me.page, 0);

    await leaveAll([me]);
  });

  test('TC-36: multiple editors move different selections simultaneously → converge', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const people: Person[] = [];

    // Seed notes via first person
    const first = await joinBoard(browser, 'p0', boardId);
    people.push(first);

    // Seed 5 notes
    await first.page.evaluate(() => window.__vidi6!.seedNotes(5));
    await waitForNoteCount(first.page, 5);

    // Join remaining people
    for (let i = 1; i < 5; i++) {
      const p = await joinBoard(browser, `p${i}`, boardId);
      people.push(p);
    }

    // Each person selects a different note and moves it
    const ids = await noteIds(first.page);
    for (let i = 0; i < people.length; i++) {
      const p = people[i]!;
      const id = ids[i]!;
      await clickNote(p.page, id);
      // Move it by a unique amount
      await dragNote(p.page, id, (i + 1) * 10, (i + 1) * 5);
    }

    // All pages converge to the same final positions
    await expectSameBoard(people, 'TC-36 concurrent moves');

    await leaveAll(people);
  });
});
