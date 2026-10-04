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
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/**
 * Note world positions from seedBoard (createSticky centres):
 *   Note i: centre ((i % 50) * 220, floor(i / 50) * 220)
 *   Stored top-left: ((i % 50) * 220 - 100, floor(i / 50) * 220 - 100), size 200x200.
 *
 * With camera (-640, -400): screen = (world + 640, world + 400) * zoom
 */

function noteWorld(i: number): { x: number; y: number } {
  return { x: (i % 50) * 220 - 100, y: Math.floor(i / 50) * 220 - 100 };
}

async function notePos(page: Page, i: number): Promise<{ x: number; y: number }> {
  return page.locator('[data-vidi6="sticky-note"]').nth(i).evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { x: parseFloat(s.left), y: parseFloat(s.top) };
  });
}

async function noteText(page: Page, i: number): Promise<string> {
  return (
    (await page.locator('[data-vidi6="sticky-note"]').nth(i).locator('.sticky-text-display').textContent())?.trim() ?? ''
  );
}

/**
 * Screen-space centre of the note currently at world x `worldX` (all seeded
 * notes share the same world y). Uses the real bounding box so it is immune to
 * camera rounding and DOM reordering (bring-to-front).
 */
async function noteCenterAtWorldX(
  page: Page,
  worldX: number,
): Promise<{ x: number; y: number } | null> {
  return page
    .locator('[data-vidi6="sticky-note"]')
    .evaluateAll((els, wx) => {
      for (const el of els as HTMLElement[]) {
        if (parseFloat(el.style.left) === wx) {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    }, worldX);
}

async function dragNote(page: Page, i: number, dx: number, dy: number): Promise<void> {
  const c = await noteCenterAtWorldX(page, noteWorld(i).x);
  if (!c) throw new Error(`note at world x ${noteWorld(i).x} not found`);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 8 });
  await page.waitForTimeout(60);
  await page.mouse.up();
}

const EDITOR_SEL = 'textarea[aria-label="Note text"]';

async function typeInNote(page: Page, i: number, text: string): Promise<void> {
  const c = await noteCenterAtWorldX(page, noteWorld(i).x);
  if (!c) throw new Error(`note at world x ${noteWorld(i).x} not found`);
  await page.mouse.dblclick(c.x, c.y);
  await expect(page.locator(EDITOR_SEL)).toBeVisible({ timeout: 5000 });
  // insertText = one input event = one Yjs transaction = one undo step
  await page.keyboard.insertText(text);
  await page.keyboard.press('Escape');
  await expect(page.locator(EDITOR_SEL)).toHaveCount(0, { timeout: 5000 });
}

/** Open a board, seed it, wait for notes, set the camera. */
async function openSeeded(
  browser: Browser,
  baseURL: string,
  boardId: string,
  noteCount: number,
  zoom: number,
): Promise<Participant> {
  const p = await openParticipant(browser, baseURL, boardId);
  await seedBoard(baseURL, boardId, noteCount);
  await expectEventually(async () => {
    return (await p.page.locator('[data-vidi6="sticky-note"]').count()) >= noteCount;
  }, `board has ${noteCount} notes`);
  await setCamera(p.page, { x: -640, y: -400, zoom });
  await settle(p.page);
  return p;
}

test.describe('story 8: undo and redo my own changes without undoing anyone else\'s', () => {
  // TC-22: Recover an accidental delete
  test('TC-22: Mia deletes 8, Raj adds a note, Mia undoes then redoes', async ({ browser, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    const mia = await openSeeded(browser, baseURL!, boardId, 8, 0.5);
    const raj = await openSeeded(browser, baseURL!, boardId, 0, 0.5);

    const page = mia.page;

    // Mia types into note 0 so the restore can be verified with text
    await typeInNote(page, 0, 'hello');
    await expectEventually(async () => (await noteText(raj.page, 0)) === 'hello', 'Raj sees Mia\'s text');

    // Original positions (all 8 notes)
    const original: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i++) original.push(noteWorld(i));

    // Mia box-selects all 8 notes (Shift+drag) and deletes them.
    // At zoom 0.5: note i spans screen x [i*110+270, i*110+370], y [150, 250]
    // Note 0: (270,150)-(370,250), note 7: (1040,150)-(1140,250)
    await page.keyboard.down('Shift');
    await page.mouse.move(265, 145);
    await page.mouse.down();
    await page.mouse.move(1145, 255, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const selected = page.locator('[data-vidi6="sticky-note"][data-selected="true"]');
    await expect(selected).toHaveCount(8);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(0);
    await expectEventually(
      async () => (await raj.page.locator('[data-vidi6="sticky-note"]').count()) === 0,
      'Raj sees 0 notes',
    );

    // Raj adds his own note in an empty area
    await raj.page.mouse.dblclick(1100, 450);
    await expect(raj.page.locator('[data-vidi6="sticky-note"]')).toHaveCount(1);
    await expectEventually(
      async () => (await page.locator('[data-vidi6="sticky-note"]').count()) === 1,
      'Mia sees Raj\'s note',
    );

    // Mia undoes her delete → the 8 notes return on both screens
    await page.keyboard.press('Control+z');
    await expectEventually(
      async () => (await page.locator('[data-vidi6="sticky-note"]').count()) === 9,
      'Mia sees 9 notes after undo',
    );
    await expectEventually(
      async () => (await raj.page.locator('[data-vidi6="sticky-note"]').count()) === 9,
      'Raj sees 9 notes after undo',
    );

    // Text, positions restored on both screens (the 8 seeded notes are the first 8 in DOM order by id? No —
    // DOM order follows the Y.Map key order: seeded notes were inserted first, so they occupy indices 0-7.
    // Raj's note is index 8.)
    // Raj's note sits at world (1460, 400); the 8 restored notes are back at
    // their seeded positions (DOM order is not guaranteed, so match by position)
    await expectEventually(async () => {
      for (const who of [page, raj.page]) {
        const poss = await Promise.all(Array.from({ length: 9 }, (_, i) => notePos(who, i)));
        const rajIdx = poss.findIndex((p) => p.y === 400);
        if (rajIdx === -1) return false; // Raj's note must remain
        const rest = poss.filter((_, i) => i !== rajIdx).sort((a, b) => a.x - b.x);
        for (let i = 0; i < 8; i++) {
          if (rest[i].x !== original[i].x || rest[i].y !== original[i].y) return false;
        }
        const note0Idx = poss.findIndex((p) => p.x === -100 && p.y === -100);
        if ((await noteText(who, note0Idx)) !== 'hello') return false;
      }
      return true;
    }, 'text and positions restored on both screens');

    // Mia redoes via the toolbar button → the 8 disappear again on both screens
    const redoBtn = page.locator('[data-vidi6="undo-buttons"] button[aria-label="Redo"]');
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();
    await expectEventually(
      async () => (await page.locator('[data-vidi6="sticky-note"]').count()) === 1,
      'Mia sees 1 note after redo',
    );
    await expectEventually(
      async () => (await raj.page.locator('[data-vidi6="sticky-note"]').count()) === 1,
      'Raj sees 1 note after redo',
    );

    // The redo stack is exhausted → Redo button disabled. (Undo stays enabled:
    // yjs re-captures the redo's inverse as a new undo step, so Mia can undo the
    // redo. The disabled-when-exhausted state is covered by TC-18 component.)
    await expect(redoBtn).toBeDisabled();
    const undoBtn = page.locator('[data-vidi6="undo-buttons"] button[aria-label="Undo"]');
    await expect(undoBtn).toBeEnabled();

    // Undoing the redo reverts the redo's changes → the 8 come back on both
    await page.keyboard.press('Control+z');
    await expectEventually(
      async () => (await page.locator('[data-vidi6="sticky-note"]').count()) === 9,
      'Mia sees 9 notes after undoing the redo',
    );
    await expectEventually(
      async () => (await raj.page.locator('[data-vidi6="sticky-note"]').count()) === 9,
      'Raj sees 9 notes after undoing the redo',
    );

    await closeParticipants([mia, raj]);
  });

  // TC-23: Colleague deleted my object
  test('TC-23: Mia moves a note, Raj deletes it, Mia undoes without error', async ({ browser, baseURL }) => {
    const pageErrors: string[] = [];
    const boardId = await createBoardViaApi(baseURL!);
    const mia = await openSeeded(browser, baseURL!, boardId, 4, 1);
    const raj = await openSeeded(browser, baseURL!, boardId, 0, 1);
    mia.page.on('pageerror', (err) => pageErrors.push(String(err)));

    const page = mia.page;

    // Mia moves note 1 down, then note 0 right (two undo steps).
    // Note 1 first: after a drag a note is brought to front, so dragging note 0
    // first would make it overlap note 1's grab point.
    await dragNote(page, 1, 0, 250);
    await page.waitForTimeout(700); // > capture timeout: separate undo steps
    await dragNote(page, 0, 300, 0);
    await settle(page);
    console.log('DBG after drags:', JSON.stringify(await Promise.all([0, 1, 2, 3].map((i) => notePos(page, i)))));

    // Raj deletes note 0 (which Mia moved +300px right).
    // DOM order is shuffled by bring-to-front, so locate note 0 by its world
    // position (200, -100) and click its centre.
    const n0Screen = await raj.page.locator('[data-vidi6="sticky-note"]').evaluateAll((els) => {
      for (const el of els as HTMLElement[]) {
        if (parseFloat(el.style.left) === 200 && parseFloat(el.style.top) === -100) {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    if (!n0Screen) throw new Error('Raj cannot find note 0 at its moved position');
    await raj.page.mouse.click(n0Screen.x, n0Screen.y);
    await raj.page.keyboard.press('Delete');
    await expectEventually(
      async () => (await page.locator('[data-vidi6="sticky-note"]').count()) === 3,
      'Mia sees 3 notes after Raj\'s delete',
    );

    // Mia undoes → her move step for the deleted note is a no-op (absorbed)
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-vidi6="sticky-note"]')).toHaveCount(3);
    // Note 0 is absent on both screens
    await expect(raj.page.locator('[data-vidi6="sticky-note"]')).toHaveCount(3);

    // Mia's next undo still works: note 1 moves back.
    // (DOM order is shuffled by bring-to-front, so assert on the position set:
    // the three remaining notes must all be at their original x positions.)
    await page.keyboard.press('Control+z');
    await expectEventually(async () => {
      const xs = (await Promise.all([0, 1, 2].map((i) => notePos(page, i))))
        .map((p) => p.x)
        .sort((a, b) => a - b);
      return xs[0] === 120 && xs[1] === 340 && xs[2] === 560;
    }, 'notes back at original positions');

    expect(pageErrors).toEqual([]);
    await closeParticipants([mia, raj]);
  });

  // TC-24: Everyone undoing at once
  test('TC-24: all editors undo their own changes concurrently', async ({ browser, baseURL }) => {
    const n = MAX_CONCURRENT_EDITORS; // 5
    const totalNotes = n * 4; // 20
    const boardId = await createBoardViaApi(baseURL!);
    await seedBoard(baseURL!, boardId, totalNotes);

    const zoom = 0.25;
    const participants: Participant[] = [];
    for (let i = 0; i < n; i++) {
      participants.push(await openParticipant(browser, baseURL!, boardId));
    }
    for (const p of participants) {
      await expectEventually(async () => {
        return (await p.page.locator('[data-vidi6="sticky-note"]').count()) >= totalNotes;
      }, 'participant sees all notes');
      await setCamera(p.page, { x: -640, y: -400, zoom });
      await settle(p.page);
    }

    // Editor i: move note (4i) right, type into note (4i+1).
    //
    // Edits are made one editor at a time, each in the foreground: drag moves
    // are batched through requestAnimationFrame, which browsers throttle in
    // background tabs — a concurrent background drag would never apply its
    // final position. The story-8 behaviour under test is the *undo* phase
    // below, which runs concurrently (undo is synchronous, not rAF-batched).
    //
    // The 600ms pause keeps the drag and the typing in separate undo steps
    // (> UNDO_CAPTURE_TIMEOUT_MS = 500ms).
    for (let i = 0; i < n; i++) {
      const p = participants[i];
      await p.page.bringToFront();
      await dragNote(p.page, 4 * i, 100, 0);
      await p.page.waitForTimeout(600);
      await typeInNote(p.page, 4 * i + 1, `E${i}`);
    }

    // All changes visible everywhere (set-based: drags reorder the DOM)
    const allTexts = async (page: Page): Promise<string[]> =>
      (await page.locator('[data-vidi6="sticky-text-display"]').allTextContents()).map((t) => t.trim());

    for (const p of participants) {
      await expectEventually(async () => {
        const texts = await allTexts(p.page);
        for (let j = 0; j < n; j++) if (!texts.includes(`E${j}`)) return false;
        return true;
      }, 'editor sees all five texts');
    }

    // Everyone undoes once (in parallel) → every editor's typing is reverted
    // (typing lives in the shared YText, so each owner's undo removes it for
    // everyone). The drags — other editors' changes — must remain applied.
    await Promise.all(participants.map((p) => p.page.keyboard.press('Control+z')));

    for (const p of participants) {
      await expectEventually(async () => {
        const texts = await allTexts(p.page);
        if (texts.some((t) => t !== '')) return false; // all typing reverted
        return true;
      }, 'all typing reverted on this screen');
    }

    // Others' changes intact: each note 4i is still at its moved position
    // (original x + 400 world px = +100 screen px at zoom 0.25; ±2px tolerance
    // for browser mouse-step rounding)
    for (const p of participants) {
      await expectEventually(async () => {
        for (let i = 0; i < n; i++) {
          const poss = await p.page.locator('[data-vidi6="sticky-note"]').evaluateAll((els) =>
            (els as HTMLElement[]).map((el) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) })),
          );
          const want = noteWorld(4 * i);
          const moved = poss.find((q) => Math.abs(q.x - (want.x + 400)) <= 2 && Math.abs(q.y - want.y) <= 2);
          if (!moved) return false;
        }
        return true;
      }, `editor's screen still shows all drags applied`);
    }

    // Everyone undoes again → moves revert; all boards identical to the original seed
    await Promise.all(participants.map((p) => p.page.keyboard.press('Control+z')));
    await new Promise((r) => setTimeout(r, 1500));

    const snapshot = async (page: Page): Promise<string> =>
      page.evaluate(() => {
        const notes = Array.from(document.querySelectorAll('[data-vidi6="sticky-note"]')) as HTMLElement[];
        return notes
          .map((el) => {
            const s = el.style;
            const text = el.querySelector('.sticky-text-display')?.textContent?.trim() ?? '';
            return `${parseFloat(s.left)},${parseFloat(s.top)}|${text}`;
          })
          .sort()
          .join(';');
      });

    const snaps = await Promise.all(participants.map((p) => snapshot(p.page)));
    for (let i = 1; i < n; i++) {
      expect(snaps[i]).toBe(snaps[0]);
    }
    // Every note back at its seeded position, no text anywhere
    const original = Array.from({ length: totalNotes }, (_, i) => {
      const w = noteWorld(i);
      return `${w.x},${w.y}|`;
    }).sort();
    expect(snaps[0].split(';')).toEqual(original);

    await closeParticipants(participants);
  });
});
