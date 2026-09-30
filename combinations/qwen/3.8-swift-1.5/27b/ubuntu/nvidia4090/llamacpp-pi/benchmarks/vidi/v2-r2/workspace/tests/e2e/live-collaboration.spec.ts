import { test, expect, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const noteSelector = '[data-note-id]';
const editorSelector = '[data-testid="sticky-editor"]';

/** Gets the board snapshot from a page. */
async function getSnapshot(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    return (window as any).__vidi6?.snapshot?.() ?? [];
  });
}

/** Compares two snapshots for structural equality. */
function snapsEqual(
  a: { id: string; x: number; y: number; color: string; text: string }[],
  b: { id: string; x: number; y: number; color: string; text: string }[]
): boolean {
  if (a.length !== b.length) return false;
  const key = (n: { id: string; x: number; y: number; color: string; text: string }) =>
    `${n.id}|${n.x.toFixed(1)}|${n.y.toFixed(1)}|${n.color}|${n.text}`;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
}

/** Creates a note on a page by double-clicking at a position. */
async function createNoteAt(page: import('@playwright/test').Page, x: number, y: number) {
  await page.mouse.dblclick(x, y);
  await page.keyboard.press('Escape');
}

test.describe('Story 3: Live collaboration (TC-22 to TC-28)', () => {
  test.describe.configure({ mode: 'serial' });

  test('TC-22: Alex creates, moves, recolours, types, deletes → each change appears for Sam', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);

    // Wait for both to be connected
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // TC-22a: Alex creates a note → Sam sees it
    await createNoteAt(pageA, 400, 300);
    await expect.poll(async () => {
      return (await pageB.locator(noteSelector).count());
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);
    console.log('  [latency] create: ✓');

    // TC-22b: Alex types text → Sam sees it
    await pageA.locator(noteSelector).dblclick();
    await pageA.keyboard.type('Pricing');
    await pageA.keyboard.press('Escape');
    await expect.poll(async () => {
      const snap = await getSnapshot(pageB);
      return snap[0]?.text === 'Pricing';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();
    console.log('  [latency] text: ✓');

    // TC-22c: Alex moves the note → Sam sees it
    const snapBefore = await getSnapshot(pageA);
    const noteId = snapBefore[0].id;
    // Use the test hook to move
    await pageA.evaluate((id: string) => {
      const doc = (window as any).__vidi6?.doc;
      const objects = doc.getMap('objects');
      const obj = objects.get(id);
      if (obj) {
        doc.transact(() => {
          obj.set('x', obj.get('x') + 200);
          obj.set('y', obj.get('y') + 100);
        });
      }
    }, noteId);
    await expect.poll(async () => {
      const snap: { id: string; x: number; y: number }[] = await getSnapshot(pageB);
      const note = snap.find((n: { id: string; x: number; y: number }) => n.id === noteId);
      return note && Math.abs(note.x - (snapBefore[0].x + 200)) < 1;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();
    console.log('  [latency] move: ✓');

    // TC-22d: Alex recolours → Sam sees it
    await pageA.locator(noteSelector).click();
    await pageA.getByLabel('Blue colour').click();
    await expect.poll(async () => {
      const snap = await getSnapshot(pageB);
      const note = snap.find((n: { id: string; color: string }) => n.id === noteId);
      return note?.color === 'blue';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();
    console.log('  [latency] recolour: ✓');

    // TC-22e: Alex deletes → Sam sees deletion
    await pageA.locator(noteSelector).click();
    await pageA.keyboard.press('Delete');
    await expect.poll(async () => {
      return (await pageB.locator(noteSelector).count());
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    console.log('  [latency] delete: ✓');

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-23: both type simultaneously → identical text containing every character', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create a note
    await createNoteAt(pageA, 400, 300);
    await expect.poll(async () => (await pageB.locator(noteSelector).count()), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Both type into the same note simultaneously
    await pageA.locator(noteSelector).dblclick();
    await pageB.locator(noteSelector).dblclick();

    // Type simultaneously
    await Promise.all([
      pageA.keyboard.type('red ', { delay: 50 }),
      pageB.keyboard.type('blue', { delay: 50 }),
    ]);

    // Both should see text containing both contributions
    await expect.poll(async () => {
      const textA = await pageA.locator(editorSelector).inputValue();
      const textB = await pageB.locator(editorSelector).inputValue();
      return textA.includes('red') && textA.includes('blue') && textB.includes('red') && textB.includes('blue');
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();

    // Both pages show identical text
    const textA = await pageA.locator(editorSelector).inputValue();
    const textB = await pageB.locator(editorSelector).inputValue();
    expect(textA).toBe(textB);

    await pageA.keyboard.press('Escape');
    await pageB.keyboard.press('Escape');
    await ctxA.close();
    await ctxB.close();
  });

  test('TC-24: both drag same note → identical settled position', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create a note
    await createNoteAt(pageA, 400, 300);
    await expect.poll(async () => (await pageB.locator(noteSelector).count()), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Both drag the note to different positions simultaneously
    const boxA = await pageA.locator(noteSelector).boundingBox();
    const boxB = await pageB.locator(noteSelector).boundingBox();
    expect(boxA).not.toBeNull();
    expect(boxB).not.toBeNull();

    // Drag A to the right, B to the left (simultaneously)
    await Promise.all([
      (async () => {
        await pageA.mouse.move(boxA!.x + boxA!.width / 2, boxA!.y + boxA!.height / 2);
        await pageA.mouse.down();
        await pageA.mouse.move(boxA!.x + boxA!.width / 2 + 100, boxA!.y + boxA!.height / 2, { steps: 5 });
        await pageA.mouse.up();
      })(),
      (async () => {
        await pageB.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2);
        await pageB.mouse.down();
        await pageB.mouse.move(boxB!.x + boxB!.width / 2 - 100, boxB!.y + boxB!.height / 2, { steps: 5 });
        await pageB.mouse.up();
      })(),
    ]);

    // Wait for convergence
    await expect.poll(async () => {
      const snapA = await getSnapshot(pageA);
      const snapB = await getSnapshot(pageB);
      if (snapA.length !== 1 || snapB.length !== 1) return false;
      return Math.abs(snapA[0].x - snapB[0].x) < 1 && Math.abs(snapA[0].y - snapB[0].y) < 1;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();

    console.log('  [latency] drag convergence: ✓');
    await ctxA.close();
    await ctxB.close();
  });

  test('TC-25: Sam editing note, Alex deletes → Sam\'s note and editor disappear, no errors', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const consoleErrors: string[] = [];
    pageB.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create a note
    await createNoteAt(pageA, 400, 300);
    await expect.poll(async () => (await pageB.locator(noteSelector).count()), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Sam (B) starts editing the note
    await pageB.locator(noteSelector).dblclick();
    await expect(pageB.locator(editorSelector)).toBeVisible();

    // Alex (A) deletes the note
    await pageA.locator(noteSelector).click();
    await pageA.keyboard.press('Delete');

    // Sam's note should disappear and editor should be gone
    await expect.poll(async () => (await pageB.locator(noteSelector).count()), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    await expect(pageB.locator(editorSelector)).not.toBeVisible();

    // No console errors
    expect(consoleErrors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-26: MAX_CONCURRENT_EDITORS contexts each create 5 and move 5 notes → final snapshots identical', async ({ browser }) => {
    const boardId = newBoardId();
    const contexts: BrowserContext[] = [];
    const pages: import('@playwright/test').Page[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/b/${boardId}`);
      await page.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
      contexts.push(ctx);
      pages.push(page);
    }

    // Each context creates 5 notes and moves 5 notes
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const page = pages[i];
      // Create 5 notes at different positions
      for (let j = 0; j < 5; j++) {
        await createNoteAt(page, 200 + i * 50 + j * 30, 200 + j * 30);
      }
      // Move 5 notes using the doc
      await page.evaluate((idx) => {
        const doc = (window as any).__vidi6?.doc;
        const snap = (window as any).__vidi6?.snapshot?.() ?? [];
        for (let j = 0; j < 5 && j < snap.length; j++) {
          const obj = doc.getMap('objects').get(snap[j].id);
          if (obj) {
            doc.transact(() => {
              obj.set('x', obj.get('x') + idx * 10);
              obj.set('y', obj.get('y') + idx * 10);
            });
          }
        }
      }, i);
    }

    // Wait for convergence
    await expect.poll(async () => {
      const snaps = await Promise.all(pages.map(p => getSnapshot(p)));
      if (snaps.some(s => s.length === 0)) return false;
      const first = snaps[0];
      return snaps.every(s => snapsEqual(s, first));
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBeTruthy();

    // Final snapshots are identical
    const finalSnaps = await Promise.all(pages.map(p => getSnapshot(p)));
    for (let i = 1; i < finalSnaps.length; i++) {
      expect(snapsEqual(finalSnaps[i], finalSnaps[0])).toBe(true);
    }

    console.log(`  [latency] TC-26: ${MAX_CONCURRENT_EDITORS} participants converged`);

    for (const ctx of contexts) await ctx.close();
  });

  test('TC-27: Flaky Wi-Fi - Alex offline, both add notes, reconnect → 6 notes total', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Take Alex offline
    await ctxA.setOffline(true);

    // Wait for Alex to show "Reconnecting…"
    await expect.poll(async () => {
      const state = await pageA.evaluate(() => (window as any).__vidi6?.connectionState);
      return state === 'reconnecting';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBeTruthy();

    // Both add 3 notes while Alex is offline
    for (let i = 0; i < 3; i++) {
      await createNoteAt(pageA, 100 + i * 50, 100);
    }
    for (let i = 0; i < 3; i++) {
      await createNoteAt(pageB, 100 + i * 50, 300);
    }

    // Bring Alex back online
    await ctxA.setOffline(false);

    // Wait for reconnection and catch-up
    await expect.poll(async () => {
      const state = await pageA.evaluate(() => (window as any).__vidi6?.connectionState);
      return state === 'connected' || state === 'confirmed';
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBeTruthy();

    // Both should see 6 notes
    await expect.poll(async () => {
      const countA = await pageA.locator(noteSelector).count();
      const countB = await pageB.locator(noteSelector).count();
      return countA === 6 && countB === 6;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS * 2 }).toBeTruthy();

    console.log('  [latency] TC-27: catch-up complete, both see 6 notes');

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-28: Alex selects and edits → Sam sees no selection outline or editor', async ({ browser }) => {
    const boardId = newBoardId();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await pageA.goto(`/b/${boardId}`);
    await pageB.goto(`/b/${boardId}`);
    await pageA.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await pageB.waitForFunction(() => (window as any).__vidi6?.connectionState === 'connected', { timeout: E2E_EVENTUAL_TIMEOUT_MS });

    // Create a note
    await createNoteAt(pageA, 400, 300);
    await expect.poll(async () => (await pageB.locator(noteSelector).count()), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Alex selects and starts editing
    await pageA.locator(noteSelector).dblclick();
    await expect(pageA.locator(editorSelector)).toBeVisible();

    // Sam should NOT see a selection outline or editor
    await expect(pageB.locator(editorSelector)).not.toBeVisible();
    // No selection class on Sam's note
    const samNoteClasses = await pageB.locator(noteSelector).getAttribute('class');
    expect(samNoteClasses ?? '').not.toContain('selected');

    await ctxA.close();
    await ctxB.close();
  });
});
