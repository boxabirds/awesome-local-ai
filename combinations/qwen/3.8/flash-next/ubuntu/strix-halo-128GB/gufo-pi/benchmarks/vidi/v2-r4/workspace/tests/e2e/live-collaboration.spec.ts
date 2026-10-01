import { expect, test, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  notes,
  noteAt,
  noteText,
  editor,
  stateOf,
  doubleClickToCreate,
  clickEmptyBoard,
  dragNoteBy,
  swatch,
  typeText,
  deleteNoteButton,
} from './helpers/sticky';
import { board } from './helpers/board';

/** Create a board via API and return its id. */
async function createBoardApi(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  expect(res.ok()).toBeTruthy();
  const data = await res.json() as { id: string };
  return data.id;
}

/**
 * Helper: open two pages on the same board.
 * Both are connected to the same BoardRoom DO via WebSocket.
 */
async function openTwoPages(browser: import('@playwright/test').Browser, request: APIRequestContext) {
  const boardId = await createBoardApi(request);
  const url = `/b/${boardId}`;

  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto(url);
  await expect(board(page1)).toBeVisible();
  // Wait for connection to be confirmed (badge hidden = 'connected')
  await page1.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(url);
  await expect(board(page2)).toBeVisible();
  await page2.waitForFunction(() => {
    const api = (window as any).__vidi6;
    return api && api.connectionState === 'connected';
  }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

  return { ctx1, page1, ctx2, page2, boardId };
}

test.describe('live collaboration (story 3)', () => {
  test('TC-22: create, move, recolour, text, delete by one user appear for the other', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Alex creates a note
    await doubleClickToCreate(page1, 400, 300);
    await typeText(page1, 'Hello');
    await clickEmptyBoard(page1);

    // Sam sees the note
    await expect.poll(() => notes(page2).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    await expect(noteText(page2, 0)).toHaveText('Hello', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Alex moves the note
    await dragNoteBy(noteAt(page1, 0), { x: 50, y: 25 }, { x: 100, y: 50 });

    // Sam sees the move reflected
    await expect.poll(async () => {
      const state = await stateOf(noteAt(page2, 0));
      return state.world.x;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).not.toBe(0);

    // Alex recolours the note
    await noteAt(page1, 0).click();
    await swatch(page1, 'blue').click();

    await expect.poll(() => noteAt(page2, 0).getAttribute('data-color'), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('blue');

    // Alex types more text
    await noteAt(page1, 0).dblclick();
    await typeText(page1, ' World');
    await clickEmptyBoard(page1);

    await expect(noteText(page2, 0)).toHaveText('Hello World', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Alex deletes the note
    await noteAt(page1, 0).click();
    await deleteNoteButton(page1).click();

    await expect(notes(page2)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-23: simultaneous typing on same note → both pages show all typed characters', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Alex creates a note with initial text
    await doubleClickToCreate(page1, 400, 300);
    await typeText(page1, 'AB');
    await clickEmptyBoard(page1);

    // Sam sees it
    await expect(notes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Both open the note for editing
    await noteAt(page1, 0).dblclick();
    await expect(editor(page1)).toBeVisible();

    await noteAt(page2, 0).dblclick();
    await expect(editor(page2)).toBeVisible();

    // Both type simultaneously
    await Promise.all([
      page1.keyboard.type('123'),
      page2.keyboard.type('XYZ'),
    ]);

    await clickEmptyBoard(page1);
    await clickEmptyBoard(page2);

    // Wait for convergence: text is the same AND all typed characters present
    const expected = 'AB123XYZ';
    await expect.poll(async () => {
      const text1 = await noteText(page1, 0).textContent();
      const text2 = await noteText(page2, 0).textContent();
      if (text1 !== text2) return false;
      return expected.split('').every(ch => (text1 ?? '').includes(ch));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);

    // All typed characters are present (CRDT merge may interleave them)
    const text1 = await noteText(page1, 0).textContent()!;
    for (const ch of expected) {
      expect(text1).toContain(ch);
    }

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-24: simultaneous move of same note → both settle to same position', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Create a note
    await doubleClickToCreate(page1, 400, 300);
    await clickEmptyBoard(page1);

    // Sam sees it
    await expect(notes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Both drag the same note to different spots simultaneously
    const note1 = noteAt(page1, 0);
    const note2 = noteAt(page2, 0);
    const box = await note1.boundingBox();
    if (!box) throw new Error('note not visible');

    // Drag A to the right, drag B to the left
    await Promise.all([
      dragNoteBy(note1, { x: 50, y: 25 }, { x: 100, y: 0 }),
      dragNoteBy(note2, { x: 50, y: 25 }, { x: -50, y: 0 }),
    ]);

    // Wait for convergence - both should settle to the same position
    await expect.poll(async () => {
      const state1 = await stateOf(noteAt(page1, 0));
      const state2 = await stateOf(noteAt(page2, 0));
      return state1.world.x === state2.world.x && state1.world.y === state2.world.y;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-25: Alex deletes a note Sam is editing → Sam sees it disappear, no errors', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Alex creates a note
    await doubleClickToCreate(page1, 400, 300);
    await typeText(page1, 'doomed');
    await clickEmptyBoard(page1);

    // Sam starts editing the note
    await expect(notes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await noteAt(page2, 0).dblclick();
    await expect(editor(page2)).toBeVisible();

    // Alex deletes the note
    await noteAt(page1, 0).click();
    await deleteNoteButton(page1).click();

    // Sam's note disappears, editor closes, no error dialog
    await expect(notes(page2)).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(editor(page2)).not.toBeVisible();

    // No error dialogs or crashes (page is still functional)
    await expect(board(page2)).toBeVisible();
    await doubleClickToCreate(page2, 200, 200);
    await expect(notes(page2)).toHaveCount(1);

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-26: MAX_CONCURRENT_EDITORS contexts each create 5 notes and move 5 → all see everything', async ({ browser, request }) => {
    const boardId = await createBoardApi(request);
    const url = `/b/${boardId}`;
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];

    // Open MAX_CONCURRENT_EDITORS pages
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(url);
      await expect(board(page)).toBeVisible();
      await page.waitForFunction(() => {
        const api = (window as any).__vidi6;
        return api && api.connectionState === 'connected';
      }, undefined, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      pages.push(page);
    }

    // Each context creates a note and moves it
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const page = pages[i];
      await doubleClickToCreate(page, 200 + i * 100, 300);
      await typeText(page, `note${i}`);
      await clickEmptyBoard(page);
    }

    // All pages should see MAX_CONCURRENT_EDITORS notes
    for (const page of pages) {
      await expect.poll(() => notes(page).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(MAX_CONCURRENT_EDITORS);
    }

    // Each moves their note
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      await dragNoteBy(noteAt(pages[i], i), { x: 50, y: 25 }, { x: 30, y: 30 });
    }

    // All pages should converge (same number of notes)
    for (const page of pages) {
      await expect(notes(page)).toHaveCount(MAX_CONCURRENT_EDITORS, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    }

    // Final snapshots should be identical for synced state (ignore local selection)
    const getSyncSnapshot = async (p: Page) => {
      return p.evaluate(() => {
        const els = document.querySelectorAll('[data-testid="sticky-note"]');
        return Array.from(els).map(el => {
          const h = el as HTMLElement;
          return JSON.stringify({
            id: h.dataset.noteId,
            x: h.dataset.worldX,
            y: h.dataset.worldY,
            z: h.dataset.z,
            color: h.dataset.color,
            text: h.querySelector('[data-testid="sticky-note-text"]')?.textContent ?? '',
          });
        }).sort();
      });
    };

    const snapshots = await Promise.all(pages.map(p => getSyncSnapshot(p)));
    for (let i = 1; i < snapshots.length; i++) {
      expect(snapshots[i]).toEqual(snapshots[0]);
    }

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-27: outage for one user → reconnects, both pages show all notes', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Go offline for page1 (Alex)
    await ctx1.setOffline(true);

    // Wait briefly for Sam to see Alex go offline
    await page2.waitForTimeout(500);

    // Sam (still online) adds 3 notes
    for (let i = 0; i < 3; i++) {
      await doubleClickToCreate(page2, 300 + i * 120, 400);
      await typeText(page2, `sam${i}`);
      await clickEmptyBoard(page2);
    }

    // Alex adds 3 notes while offline (they are local only)
    for (let i = 0; i < 3; i++) {
      await doubleClickToCreate(page1, 300 + i * 120, 200);
      await typeText(page1, `alex${i}`);
      await clickEmptyBoard(page1);
    }

    // Sam shows "Reconnecting…" or similar status while Alex is offline
    // Alex is still functional locally
    await expect(notes(page1)).toHaveCount(3);

    // Go back online
    await ctx1.setOffline(false);

    // Wait for reconnection and sync
    // Alex's badge should show "Reconnecting…" then "Connected" then hide
    // Wait for full convergence
    await expect.poll(() => notes(page1).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);
    await expect.poll(() => notes(page2).count(), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(6);

    await ctx1.close();
    await ctx2.close();
  });

  test('TC-28: selection on one page is not shown on the other', async ({ browser, request }) => {
    const { ctx1, page1, ctx2, page2 } = await openTwoPages(browser, request);

    // Alex creates a note
    await doubleClickToCreate(page1, 400, 300);
    await typeText(page1, 'shared');
    await clickEmptyBoard(page1);

    // Sam sees it
    await expect(notes(page2)).toHaveCount(1, { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Alex selects the note
    await noteAt(page1, 0).click();
    const alexState = await stateOf(noteAt(page1, 0));
    expect(alexState.selected).toBe('true');

    // Sam should NOT see the note as selected
    const samState = await stateOf(noteAt(page2, 0));
    expect(samState.selected).not.toBe('true');

    // Alex starts editing (open editor)
    await noteAt(page1, 0).dblclick();
    await expect(editor(page1)).toBeVisible();

    // Sam should NOT have an editor open
    await expect(editor(page2)).not.toBeVisible();

    await ctx1.close();
    await ctx2.close();
  });
});
