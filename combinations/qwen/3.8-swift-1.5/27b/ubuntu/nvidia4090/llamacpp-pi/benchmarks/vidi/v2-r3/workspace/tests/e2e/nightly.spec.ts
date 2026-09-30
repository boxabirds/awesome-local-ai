import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Helper: open a board in a new context and wait for connection.
 */
async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => {
    const badge = document.querySelector('[data-testid="connection-status"]');
    if (!badge) return true;
    const text = badge.textContent || '';
    return text === 'Connected';
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  return page;
}

/**
 * Helper: get the board snapshot from a page.
 */
async function getBoardSnapshot(page: Page): Promise<{ id: string; x: number; y: number; color: string; text: string }[]> {
  return page.evaluate(() => {
    const hook = (window as any).__VIDI_DEBUG__;
    if (!hook) throw new Error('Debug hook not available');
    const doc = hook.doc;
    const objects = doc.getMap('objects');
    const notes: { id: string; x: number; y: number; color: string; text: string }[] = [];
    objects.forEach((obj: any) => {
      if (obj.get('type') === 'sticky') {
        notes.push({
          id: obj.get('id'),
          x: obj.get('x'),
          y: obj.get('y'),
          color: obj.get('color'),
          text: obj.get('text')?.toString() || '',
        });
      }
    });
    return notes;
  });
}

/**
 * Seeded PRNG for reproducibility.
 */
function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test.describe('@nightly TC-29: 50 clients converge', () => {
  test('50 clients × 100 random ops → all converge', async ({ browser }) => {
    test.setTimeout(300000); // 5 minute timeout for nightly
    const boardId = newBoardId();
    const numClients = 50;
    const opsPerClient = 100;
    const seed = 42;

    // Create contexts and pages
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    for (let i = 0; i < numClients; i++) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      pages.push(await openBoard(ctx, boardId));
    }

    // Each client performs 100 random operations
    const words = ['hello', 'world', 'test', 'foo', 'bar'];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink'];

    for (let op = 0; op < opsPerClient; op++) {
      const rng = createRng(seed + op);
      const promises = pages.map(async (page, clientIdx) => {
        return page.evaluate(({ opIdx, clientId, word, color, x, y, action }) => {
          const hook = (window as any).__VIDI_DEBUG__;
          if (!hook) return;
          const doc = hook.doc;
          const Y = (window as any).__VIDI_Y__;
          const objects = doc.getMap('objects');
          const notes: any[] = [];
          objects.forEach((obj: any) => { if (obj.get('type') === 'sticky') notes.push(obj); });

          if (action === 'create' && notes.length < 20) {
            const id = `c${clientId}-o${opIdx}`;
            const text = new Y.Text();
            doc.transact(() => {
              objects.set(id, new Y.Map({ id, type: 'sticky', x, y, color: 'yellow', text, z: 1, createdAt: Date.now() }));
            });
          } else if (notes.length === 0) {
            // Ensure at least one note exists
            const id = `init-${clientId}`;
            const text = new Y.Text();
            doc.transact(() => {
              objects.set(id, new Y.Map({ id, type: 'sticky', x: 0, y: 0, color: 'yellow', text, z: 1, createdAt: Date.now() }));
            });
          } else if (action === 'text') {
            const note = notes[opIdx % notes.length];
            note.get('text').insert(note.get('text').length, word);
          } else if (action === 'move') {
            const note = notes[opIdx % notes.length];
            doc.transact(() => { note.set('x', x); note.set('y', y); });
          } else if (action === 'color') {
            const note = notes[opIdx % notes.length];
            doc.transact(() => { note.set('color', color); });
          } else if (action === 'delete' && notes.length > 5) {
            const note = notes[opIdx % notes.length];
            doc.transact(() => { objects.delete(note.get('id')); });
          }
        }, {
          opIdx: op,
          clientId: clientIdx,
          word: words[Math.floor(rng() * words.length)],
          color: colors[Math.floor(rng() * colors.length)],
          x: rng() * 1000,
          y: rng() * 1000,
          action: ['text', 'move', 'color', 'create', 'delete'][Math.floor(rng() * 5)],
        });
      });
      await Promise.all(promises);
    }

    // All clients must converge to the same state
    const snap0 = (await getBoardSnapshot(pages[0])).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 1; i < numClients; i++) {
      const snapI = (await getBoardSnapshot(pages[i])).sort((a, b) => a.id.localeCompare(b.id));
      expect(snapI).toEqual(snap0);
    }

    // Cleanup
    for (const ctx of contexts) {
      await ctx.close();
    }
  });
});

test.describe('@nightly TC-30: 1000-note board loads', () => {
  test('1000-note board loads and renders in a fresh tab', async ({ browser }) => {
    test.setTimeout(120000); // 2 minute timeout
    const boardId = newBoardId();

    // First, create a context and populate the board with 1000 notes
    const setupCtx = await browser.newContext();
    const setupPage = await openBoard(setupCtx, boardId);

    // Create 1000 notes in batches
    for (let batch = 0; batch < 10; batch++) {
      await setupPage.evaluate((startIdx) => {
        const hook = (window as any).__VIDI_DEBUG__;
        if (!hook) return;
        const doc = hook.doc;
        const Y = (window as any).__VIDI_Y__;
        const objects = doc.getMap('objects');
        doc.transact(() => {
          for (let i = startIdx; i < startIdx + 100; i++) {
            const id = `note-${i}`;
            const text = new Y.Text();
            text.insert(0, `Note ${i}`);
            objects.set(id, new Y.Map({
              id, type: 'sticky',
              x: (i % 20) * 60,
              y: Math.floor(i / 20) * 40,
              color: 'yellow',
              text, z: 1, createdAt: Date.now(),
            }));
          }
        });
      }, batch * 100);
    }

    // Verify the setup page has 1000 notes
    await expect.poll(async () => (await getBoardSnapshot(setupPage)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1000);

    // Now open a fresh tab and verify it loads all 1000 notes
    const freshCtx = await browser.newContext();
    const freshPage = await openBoard(freshCtx, boardId);

    await expect.poll(async () => (await getBoardSnapshot(freshPage)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1000);

    // Cleanup
    await setupCtx.close();
    await freshCtx.close();
  });
});
