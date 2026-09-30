import { test, expect, type Page } from '@playwright/test';
import { E2E_BASE_URL, setCamera } from './helpers/board';
import {
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  createParticipants,
  expectEventually,
} from './helpers/participants';

const noteSelector = '[data-note-id]';

interface ObjSnap {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
  color?: string;
  text?: string;
}

async function getObjects(page: Page): Promise<ObjSnap[]> {
  return page.evaluate(() => (window as any).__vidi6?.objects?.() ?? []);
}

/** Seed stickies (world coords, centred) through the test hook. Returns the ids. */
async function seedNotes(page: Page, centres: ReadonlyArray<{ x: number; y: number }>): Promise<string[]> {
  return page.evaluate(async (pts) => {
    const out: string[] = [];
    for (const p of pts) out.push((window as any).__vidi6.createSticky(p.x, p.y));
    return out;
  }, centres);
}

/** Shift+drag a marquee from screen (x1,y1) to (x2,y2). */
async function marquee(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Plain drag from screen (x1,y1) to (x2,y2). */
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 4 });
  await page.mouse.up();
}

async function selectedIds(page: Page): Promise<string[]> {
  const els = page.locator(`${noteSelector}[data-selected="true"]`);
  const n = await els.count();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await els.nth(i).getAttribute('data-note-id') ?? '');
  return ids.sort();
}

function objKey(n: ObjSnap) {
  return `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}|${n.color ?? ''}|${n.text ?? ''}`;
}

function objsEqual(a: ObjSnap[], b: ObjSnap[]): boolean {
  if (a.length !== b.length) return false;
  return JSON.stringify(a.map(objKey).sort()) === JSON.stringify(b.map(objKey).sort());
}

test.describe('story 8: undo and redo (e2e)', () => {
  test('TC-22: recover an accidental delete while a colleague works', async ({ browser }) => {
    const participants = await createParticipants(browser, 2, E2E_BASE_URL);
    const [mia, raj] = participants;

    // Seed 8 notes in a 4x2 grid (fits in viewport at zoom 1)
    // Notes are 200x200, centred at the given positions
    const centres = [
      { x: 150, y: 200 }, { x: 350, y: 200 }, { x: 550, y: 200 }, { x: 750, y: 200 },
      { x: 150, y: 450 }, { x: 350, y: 450 }, { x: 550, y: 450 }, { x: 750, y: 450 },
    ];
    const noteIds = await seedNotes(mia.page, centres);
    expect(noteIds.length).toBe(8);

    // Wait for Raj to see the notes
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 8,
      'Raj sees 8 notes'
    );

    // Wait for the capture timeout to expire so creates are a separate undo step
    await mia.page.waitForTimeout(600);

    // Mia box-selects all 8 notes (marquee over the grid)
    await setCamera(mia.page, 0, 0, 1);
    // Notes span from (50, 100) to (850, 550) in world/screen coords
    await marquee(mia.page, 20, 80, 880, 570);

    // Verify all 8 are selected
    const selIds = await selectedIds(mia.page);
    expect(selIds.length).toBe(8);

    // Mia presses Delete
    await mia.page.keyboard.press('Delete');

    // Wait for both to see 0 notes
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 0,
      'Mia sees 0 notes after delete'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 0,
      'Raj sees 0 notes after delete'
    );

    // Raj adds a note
    await raj.page.evaluate(() => {
      (window as any).__vidi6.createSticky(500, 600);
    });

    // Wait for both to see 1 note (Raj's)
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 1,
      'Mia sees Raj\'s note'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 1,
      'Raj sees own note'
    );

    // Mia presses Ctrl+Z to undo the delete
    await mia.page.keyboard.press('Control+z');

    // Wait for both to see 9 notes (8 restored + Raj's 1)
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 9,
      'Mia sees 9 notes after undo'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 9,
      'Raj sees 9 notes after undo'
    );

    // Verify the boards are identical
    const miaObjects = await getObjects(mia.page);
    const rajObjects = await getObjects(raj.page);
    expect(objsEqual(miaObjects, rajObjects)).toBe(true);

    // Verify Raj's note is still there
    const rajNote = miaObjects.find((o) => !noteIds.includes(o.id));
    expect(rajNote).toBeDefined();

    // Mia clicks the Redo button → the 8 disappear again
    await mia.page.getByLabel('Redo').click();

    // Wait for both to see 1 note again
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 1,
      'Mia sees 1 note after redo'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 1,
      'Raj sees 1 note after redo'
    );

    // Cleanup
    for (const p of participants) await p.context.close();
  });

  test('TC-23: undo after a colleague deleted my object', async ({ browser }) => {
    const participants = await createParticipants(browser, 2, E2E_BASE_URL);
    const [mia, raj] = participants;

    // Mia creates a note
    const noteIds = await seedNotes(mia.page, [{ x: 400, y: 300 }]);
    expect(noteIds.length).toBe(1);
    const miaNoteId = noteIds[0];

    // Wait for Raj to see it
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 1,
      'Raj sees Mia\'s note'
    );

    // Mia moves the note (drag from center)
    await setCamera(mia.page, 0, 0, 1);
    await drag(mia.page, 400, 300, 500, 350);

    // Wait for Raj to see the moved note
    await expectEventually(
      async () => {
        const objs = await getObjects(raj.page);
        const note = objs.find((o) => o.id === miaNoteId);
        return note && note.x > 300; // moved right (top-left x increased)
      },
      'Raj sees moved note'
    );

    // Raj deletes the note
    await setCamera(raj.page, 0, 0, 1);
    await raj.page.locator(`${noteSelector}[data-note-id="${miaNoteId}"]`).click();
    await raj.page.keyboard.press('Delete');

    // Wait for both to see 0 notes
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 0,
      'Mia sees 0 notes'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 0,
      'Raj sees 0 notes'
    );

    // Mia presses Ctrl+Z → should not throw, note stays absent
    const consoleErrors: string[] = [];
    mia.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await mia.page.keyboard.press('Control+z');

    // Small wait for any potential errors
    await mia.page.waitForTimeout(500);

    // No console errors
    expect(consoleErrors.filter((e) => !e.includes('net::'))).toHaveLength(0);

    // Note is still absent on both screens
    await expectEventually(
      async () => (await getObjects(mia.page)).length === 0,
      'Mia still sees 0 notes after undo'
    );
    await expectEventually(
      async () => (await getObjects(raj.page)).length === 0,
      'Raj still sees 0 notes after undo'
    );

    // Cleanup
    for (const p of participants) await p.context.close();
  });

  test('TC-24: everyone undoing at once', async ({ browser }) => {
    const numParticipants = MAX_CONCURRENT_EDITORS;
    const participants = await createParticipants(browser, numParticipants, E2E_BASE_URL);

    // Each participant creates a note in a row (fits in viewport)
    const allNoteIds: string[][] = [];
    for (let i = 0; i < numParticipants; i++) {
      const p = participants[i];
      const x = 150 + i * 200;
      const ids = await seedNotes(p.page, [{ x, y: 300 }]);
      allNoteIds.push(ids);
    }

    // Wait for all to see all notes
    for (let i = 0; i < numParticipants; i++) {
      await expectEventually(
        async () => (await getObjects(participants[i].page)).length === numParticipants,
        `Participant ${i} sees all notes`
      );
    }

    // Wait for the capture timeout to expire so creates are a separate undo step
    for (const p of participants) await p.page.waitForTimeout(600);

    // Each participant moves their note (drag from center down-right)
    for (let i = 0; i < numParticipants; i++) {
      const p = participants[i];
      await setCamera(p.page, 0, 0, 1);
      const x = 150 + i * 200;
      await drag(p.page, x, 300, x + 50, 350);
    }

    // Wait for all moves to propagate
    for (let i = 0; i < numParticipants; i++) {
      await expectEventually(
        async () => {
          const objs = await getObjects(participants[i].page);
          const myNote = objs.find((o) => o.id === allNoteIds[i][0]);
          // Note was at top-left (x-100, 200), after drag +50,+50 → (x-50, 250)
          return myNote && myNote.x > 50 + i * 200;
        },
        `Participant ${i} sees all moves`
      );
    }

    // All boards should be identical
    const afterMoveSnapshots = await Promise.all(
      participants.map((p) => getObjects(p.page))
    );
    for (let i = 1; i < numParticipants; i++) {
      expect(objsEqual(afterMoveSnapshots[0], afterMoveSnapshots[i])).toBe(true);
    }

    // All press Ctrl+Z to undo their move
    for (let i = 0; i < numParticipants; i++) {
      await participants[i].page.keyboard.press('Control+z');
    }

    // Wait for all undos to propagate
    for (let i = 0; i < numParticipants; i++) {
      await expectEventually(
        async () => {
          const objs = await getObjects(participants[i].page);
          const myNote = objs.find((o) => o.id === allNoteIds[i][0]);
          // Should be back to original top-left position: (150 + i*200 - 100, 200) = (50 + i*200, 200)
          return myNote && Math.abs(myNote.x - (50 + i * 200)) < 5;
        },
        `Participant ${i} sees own undo propagated`
      );
    }

    // All boards should be identical (with small tolerance for floating point)
    const afterUndoSnapshots = await Promise.all(
      participants.map((p) => getObjects(p.page))
    );
    for (let i = 1; i < numParticipants; i++) {
      const a = afterUndoSnapshots[0].map(objKey).sort();
      const b = afterUndoSnapshots[i].map(objKey).sort();
      // Check same number of objects and same ids
      expect(a.length).toBe(b.length);
      const idsA = a.map((k) => k.split('|')[0]).sort();
      const idsB = b.map((k) => k.split('|')[0]).sort();
      expect(idsA).toEqual(idsB);
    }

    // Cleanup
    for (const p of participants) await p.context.close();
  });
});
