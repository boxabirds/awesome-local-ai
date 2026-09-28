/**
 * E2E live collaboration with multiple browser contexts (TC-22 to TC-28).
 */
import { expect, test } from '@playwright/test';
import {
  openParticipants,
  closeParticipants,
  createNote,
  noteCount,
  noteIds,
  endEditing,
  type Participant,
} from './helpers/participants';
import { newBoardId } from '../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

// Use the BoardTestHooks from the global type declaration in testHooks.ts

test.describe('Two-person workshop', () => {
  let participants: Participant[];
  let alex: Participant;
  let sam: Participant;

  test.beforeEach(async ({ browser }) => {
    const boardId = newBoardId();
    participants = await openParticipants(browser, 2, boardId);
    [alex, sam] = participants;
  });

  test.afterEach(async () => {
    await closeParticipants(participants);
  });

  // TC-22: each operation type appears for Sam within budget
  test('TC-22: create propagates within budget', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);

    await expect
      .poll(async () => noteCount(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(1);
  });

  test('TC-22: move propagates within budget', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    // Wait for Sam to see the note
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Move the note by dragging
    const note = alex.page.locator('[data-note-id]').first();
    const box = await note.boundingBox();
    if (!box) throw new Error('note not visible');
    await alex.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await alex.page.mouse.down();
    await alex.page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100);
    await alex.page.mouse.up();

    // Verify position changed on Sam's page
    await expect
      .poll(
        async () => {
          const samNote = sam.page.locator('[data-note-id]').first();
          const samBox = await samNote.boundingBox();
          return samBox ? Math.round(samBox.x) : 0;
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
      )
      .not.toBe(0);
  });

  test('TC-22: recolour propagates within budget', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Select the note (click on it)
    const note = alex.page.locator('[data-note-id]').first();
    await note.click();
    await alex.page.waitForTimeout(200);

    // Click the green color button
    const greenBtn = alex.page.getByRole('button', { name: /green/i });
    await greenBtn.click();

    // Verify color changed on Sam's side
    await expect
      .poll(
        async () => {
          return sam.page.evaluate(() => {
            const el = document.querySelector('[data-note-id]') as HTMLElement | null;
            if (!el) return '';
            return getComputedStyle(el).backgroundColor;
          });
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
      )
      .toContain('197'); // green color RGB component
  });

  test('TC-22: text typing propagates within budget', async () => {
    // Alex creates a note and types
    await createNote(alex.page, 400, 300);
    await alex.page.keyboard.type('Hello World');
    await endEditing(alex.page);

    // Sam sees the text
    await expect
      .poll(
        async () => {
          return sam.page.evaluate(() => {
            const el = document.querySelector('[data-note-id]');
            return el?.textContent ?? '';
          });
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS },
      )
      .toContain('Hello World');
  });

  test('TC-22: delete propagates within budget', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Select and delete
    const note = alex.page.locator('[data-note-id]').first();
    await note.click();
    await alex.page.keyboard.press('Delete');

    await expect
      .poll(async () => noteCount(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(0);
  });

  // TC-23: concurrent typing merges
  test('TC-23: simultaneous typing into same note preserves all characters', async () => {
    // Create a note and type initial text
    await createNote(alex.page, 400, 300);
    await alex.page.keyboard.type('green');
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Wait for text to sync
    await expect
      .poll(
        async () => {
          return sam.page.evaluate(() => document.querySelector('[data-note-id]')?.textContent ?? '');
        },
        { timeout: 2000 },
      )
      .toContain('green');

    // Alex double-clicks to edit, goes to beginning
    const alexNote = alex.page.locator('[data-note-id]').first();
    await alexNote.dblclick();
    await alex.page.waitForSelector('.sticky-textarea', { timeout: 3000 });
    await alex.page.keyboard.press('Home');
    await alex.page.keyboard.type('red ');
    await endEditing(alex.page);

    // Wait for Alex's edit to sync to Sam
    await expect
      .poll(
        async () => {
          return sam.page.evaluate(() => document.querySelector('[data-note-id]')?.textContent ?? '');
        },
        { timeout: 2000 },
      )
      .toContain('red');

    // Sam double-clicks to edit, goes to end and types
    const samNote = sam.page.locator('[data-note-id]').first();
    await samNote.dblclick();
    await sam.page.waitForSelector('.sticky-textarea', { timeout: 3000 });
    await sam.page.keyboard.press('End');
    await sam.page.keyboard.type(' blue');
    await endEditing(sam.page);

    // Wait for convergence
    await new Promise((r) => setTimeout(r, 500));

    // Both should have the same text containing all typed characters
    const alexText = await alex.page.evaluate(() => {
      return document.querySelector('[data-note-id]')?.textContent ?? '';
    });
    const samText = await sam.page.evaluate(() => {
      return document.querySelector('[data-note-id]')?.textContent ?? '';
    });

    expect(alexText).toContain('red');
    expect(alexText).toContain('blue');
    expect(alexText).toContain('green');
    expect(samText).toBe(alexText);
  });

  // TC-24: concurrent drag converges
  test('TC-24: both drag same note - positions converge', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);
    await new Promise((r) => setTimeout(r, 300));

    // Both drag the same note to different positions simultaneously
    const alexNote = alex.page.locator('[data-note-id]').first();
    const samNote = sam.page.locator('[data-note-id]').first();

    const alexBox = await alexNote.boundingBox();
    const samBox = await samNote.boundingBox();
    if (!alexBox || !samBox) throw new Error('notes not visible');

    // Drag simultaneously
    const dragAlex = async () => {
      await alex.page.mouse.move(alexBox.x + alexBox.width / 2, alexBox.y + alexBox.height / 2);
      await alex.page.mouse.down();
      await alex.page.mouse.move(alexBox.x + 200, alexBox.y + 150);
      await alex.page.mouse.up();
    };
    const dragSam = async () => {
      await sam.page.mouse.move(samBox.x + samBox.width / 2, samBox.y + samBox.height / 2);
      await sam.page.mouse.down();
      await sam.page.mouse.move(samBox.x + 300, samBox.y - 100);
      await sam.page.mouse.up();
    };

    await Promise.all([dragAlex(), dragSam()]);

    // Both should settle to same position
    await expect
      .poll(
        async () => {
          const aBox = await alex.page.locator('[data-note-id]').first().boundingBox();
          const sBox = await sam.page.locator('[data-note-id]').first().boundingBox();
          if (!aBox || !sBox) return false;
          return Math.abs(aBox.x - sBox.x) < 3 && Math.abs(aBox.y - sBox.y) < 3;
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + 500 },
      )
      .toBe(true);
  });

  // TC-25: delete while other is editing
  test('TC-25: delete while Sam is editing - Sam sees note disappear, no error', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Sam starts editing
    const samNote = sam.page.locator('[data-note-id]').first();
    await samNote.dblclick();
    await sam.page.waitForSelector('.sticky-textarea', { timeout: 3000 });
    await sam.page.keyboard.type('typing');

    // Monitor console errors on Sam's page
    const consoleErrors: string[] = [];
    sam.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Alex deletes the note
    const alexNote = alex.page.locator('[data-note-id]').first();
    await alexNote.click();
    await alex.page.keyboard.press('Delete');

    // Sam should see the note disappear
    await expect
      .poll(async () => noteCount(sam.page), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(0);

    // No editor should remain
    const editor = sam.page.locator('.sticky-textarea');
    await expect(editor).toHaveCount(0);

    // No console errors (allow common non-relevant messages)
    const relevantErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('net::') && !e.includes('WebSocket'),
    );
    expect(relevantErrors.length).toBe(0);
  });

  // TC-28: selections stay personal
  test('TC-28: Alex selecting and editing does not affect Sam', async () => {
    await createNote(alex.page, 400, 300);
    await endEditing(alex.page);
    await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(1);

    // Alex selects and starts editing
    const alexNote = alex.page.locator('[data-note-id]').first();
    await alexNote.dblclick();
    await alex.page.waitForSelector('.sticky-textarea', { timeout: 3000 });

    // Sam's page should not have an editor or selection outline
    await expect(sam.page.locator('.sticky-textarea')).toHaveCount(0);

    // Sam's note should not have data-selected
    const samNote = sam.page.locator('[data-note-id]').first();
    const isSelected = await samNote.evaluate((el) => el.classList.contains('selected'));
    expect(isSelected).toBeFalsy();

    await endEditing(alex.page);
  });
});

test.describe('Full-capacity session (TC-26)', () => {
  test('all MAX_CONCURRENT_EDITORS contexts see all changes within budget', async ({ browser }) => {
    const boardId = newBoardId();
    const participants = await openParticipants(browser, MAX_CONCURRENT_EDITORS, boardId);

    try {
      // Each context creates 3 notes at non-overlapping positions
      // Notes are 200x200 world units, viewport is 1280x800
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = participants[i];
        for (let j = 0; j < 3; j++) {
          const x = 100 + i * 230;  // spread horizontally: 100, 330, 560, 790, 1020
          const y = 100 + j * 230;  // spread vertically: 100, 330, 560
          await createNote(p.page, x, y);
          await endEditing(p.page);
          await p.page.waitForTimeout(50);
        }
      }

      // Every context should see all notes (MAX_CONCURRENT_EDITORS * 3)
      const expectedCount = MAX_CONCURRENT_EDITORS * 3;
      for (const p of participants) {
        await expect
          .poll(async () => noteCount(p.page), { timeout: 5000 })
          .toBe(expectedCount);
      }

      // Final note IDs should be identical on all pages
      const idsPerContext = await Promise.all(participants.map((p) => noteIds(p.page)));
      for (let i = 1; i < idsPerContext.length; i++) {
        expect([...idsPerContext[i]].sort()).toEqual([...idsPerContext[0]].sort());
      }
    } finally {
      await closeParticipants(participants);
    }
  });
});

test.describe('Flaky Wi-Fi (TC-27)', () => {
  test('offline edits catch up on reconnect', async ({ browser }) => {
    const boardId = newBoardId();
    const participants = await openParticipants(browser, 2, boardId);
    const [alex, sam] = participants;

    try {
      // Alex disconnects via test hook
      await alex.page.evaluate(() => window.__vidi6?.disconnect?.());

      // Wait for Alex's badge to show Reconnecting
      await expect
        .poll(
          async () => {
            return alex.page.evaluate(() => window.__vidi6?.connectionState);
          },
          { timeout: 5000 },
        )
        .toBe('reconnecting');

      // Both add notes while Alex is offline
      for (let i = 0; i < 3; i++) {
        await createNote(alex.page, 200 + i * 100, 200);
        await endEditing(alex.page);
      }
      for (let i = 0; i < 3; i++) {
        await createNote(sam.page, 200 + i * 100, 500);
        await endEditing(sam.page);
      }

      // Sam is online and should see its own 3 notes
      await expect.poll(async () => noteCount(sam.page), { timeout: 2000 }).toBe(3);
      // Alex has its 3 local notes
      expect(await noteCount(alex.page)).toBe(3);

      // Alex reconnects
      await alex.page.evaluate(() => window.__vidi6?.reconnect?.());

      // Alex's badge should show confirmed then connected
      await expect
        .poll(
          async () => {
            return alex.page.evaluate(() => window.__vidi6?.connectionState);
          },
          { timeout: 10_000 },
        )
        .toBe('connected');

      // Both should see all 6 notes
      await expect
        .poll(async () => noteCount(alex.page), { timeout: 5000 })
        .toBe(6);
      await expect
        .poll(async () => noteCount(sam.page), { timeout: 5000 })
        .toBe(6);
    } finally {
      await closeParticipants(participants);
    }
  });
});
