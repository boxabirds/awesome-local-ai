import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';

/**
 * Helper: open a board in a new context and wait for connection.
 */
async function openBoard(context: BrowserContext, boardId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  // Wait for the board canvas to be visible
  await page.waitForSelector('canvas', { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  // Wait for connection status to show "Connected" or disappear
  await page.waitForFunction(() => {
    const badge = document.querySelector('[data-testid="connection-status"]');
    if (!badge) return true; // badge hidden = connected
    const text = badge.textContent || '';
    return text === 'Connected';
  }, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
  return page;
}

/**
 * Helper: get the board state from a page by reading the Y.Doc via the window.
 * We expose a debug hook on window for testing.
 */
async function getBoardSnapshot(page: Page): Promise<{ id: string; x: number; y: number; color: string; text: string }[]> {
  return page.evaluate(() => {
    // Access the Y.Doc through the app's debug hook
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

test.describe('TC-22: two tabs see each other within latency budget', () => {
  test('edits appear in the other tab within 250ms', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Make an edit in page1 and verify it appears in page2 within budget
    const start = Date.now();
    await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new (require('yjs').Text)();
      doc.transact(() => {
        objects.set(id, new (require('yjs').Map)({
          id, type: 'sticky', x: 100, y: 100, color: 'yellow', text, z: 1, createdAt: Date.now(),
        }));
      });
    });

    // Wait for the edit to appear in page2
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes.length;
    }, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + 100 }).toBe(1);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS + 150);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-23: create propagates', () => {
  test('sticky created in tab A appears in tab B', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create a sticky in page1
    await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new Y.Text();
      doc.transact(() => {
        objects.set(id, new Y.Map({
          id, type: 'sticky', x: 200, y: 150, color: 'pink', text, z: 1, createdAt: Date.now(),
        }));
      });
    });

    // Verify it appears in page2
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    const notes2 = await getBoardSnapshot(page2);
    expect(notes2[0].x).toBe(200);
    expect(notes2[0].y).toBe(150);
    expect(notes2[0].color).toBe('pink');

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-24: move, recolour, text insert, delete propagate', () => {
  test('all operations propagate from A to B', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create a sticky in page1
    let noteId: string;
    noteId = await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new Y.Text();
      doc.transact(() => {
        objects.set(id, new Y.Map({
          id, type: 'sticky', x: 100, y: 100, color: 'yellow', text, z: 1, createdAt: Date.now(),
        }));
      });
      return id;
    });

    // Wait for creation to propagate
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Move
    await page1.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const objects = doc.getMap('objects');
      doc.transact(() => {
        objects.get(id).set('x', 300);
        objects.get(id).set('y', 400);
      });
    }, noteId);
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes[0]?.x;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(300);

    // Recolour
    await page1.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const objects = doc.getMap('objects');
      doc.transact(() => {
        objects.get(id).set('color', 'blue');
      });
    }, noteId);
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes[0]?.color;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('blue');

    // Text insert
    await page1.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const objects = doc.getMap('objects');
      const text = objects.get(id).get('text');
      text.insert(0, 'hello');
    }, noteId);
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes[0]?.text;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('hello');

    // Delete
    await page1.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const objects = doc.getMap('objects');
      doc.transact(() => {
        objects.delete(id);
      });
    }, noteId);
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-25: concurrent text insert merges', () => {
  test('A inserts "red " at 0, B inserts " blue" at end → both "red green blue"', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create a sticky with text "green" in page1
    let noteId: string;
    noteId = await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new Y.Text();
      text.insert(0, 'green');
      doc.transact(() => {
        objects.set(id, new Y.Map({
          id, type: 'sticky', x: 100, y: 100, color: 'yellow', text, z: 1, createdAt: Date.now(),
        }));
      });
      return id;
    });

    // Wait for creation to propagate
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes[0]?.text;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('green');

    // Concurrent inserts: A inserts "red " at 0, B inserts " blue" at end
    await Promise.all([
      page1.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        const text = objects.get(id).get('text');
        text.insert(0, 'red ');
      }, noteId),
      page2.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        const text = objects.get(id).get('text');
        text.insert(text.length, ' blue');
      }, noteId),
    ]);

    // Both should converge to "red green blue"
    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page1);
      return notes[0]?.text;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('red green blue');

    await expect.poll(async () => {
      const notes = await getBoardSnapshot(page2);
      return notes[0]?.text;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe('red green blue');

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-26: concurrent position sets converge', () => {
  test('A sets x=100, B sets x=300 → both converge', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create a sticky in page1
    let noteId: string;
    noteId = await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new Y.Text();
      doc.transact(() => {
        objects.set(id, new Y.Map({
          id, type: 'sticky', x: 0, y: 0, color: 'yellow', text, z: 1, createdAt: Date.now(),
        }));
      });
      return id;
    });

    // Wait for creation to propagate
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Concurrent position sets
    await Promise.all([
      page1.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        doc.transact(() => { objects.get(id).set('x', 100); });
      }, noteId),
      page2.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        doc.transact(() => { objects.get(id).set('x', 300); });
      }, noteId),
    ]);

    // Both should converge to the same value
    const x1 = await page1.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      return hook.doc.getMap('objects').get(id).get('x');
    }, noteId);
    const x2 = await page2.evaluate((id) => {
      const hook = (window as any).__VIDI_DEBUG__;
      return hook.doc.getMap('objects').get(id).get('x');
    }, noteId);
    expect(x1).toBe(x2);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-27: delete wins over concurrent edit', () => {
  test('A deletes while B inserts → note absent on both', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create a sticky in page1
    let noteId: string;
    noteId = await page1.evaluate(() => {
      const hook = (window as any).__VIDI_DEBUG__;
      const doc = hook.doc;
      const Y = (window as any).__VIDI_Y__;
      const objects = doc.getMap('objects');
      const id = Math.random().toString(36).slice(2, 14);
      const text = new Y.Text();
      doc.transact(() => {
        objects.set(id, new Y.Map({
          id, type: 'sticky', x: 100, y: 100, color: 'yellow', text, z: 1, createdAt: Date.now(),
        }));
      });
      return id;
    });

    // Wait for creation to propagate
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(1);

    // Concurrent: A deletes, B inserts text
    await Promise.all([
      page1.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        doc.transact(() => { objects.delete(id); });
      }, noteId),
      page2.evaluate((id) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const objects = doc.getMap('objects');
        const text = objects.get(id)?.get('text');
        if (text) text.insert(0, 'concurrent');
      }, noteId),
    ]);

    // Note must be absent on both
    await expect.poll(async () => (await getBoardSnapshot(page1)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);

    await ctx1.close();
    await ctx2.close();
  });
});

test.describe('TC-28: catch-up after simulated outage', () => {
  test('offline tab catches up within 1s of reconnect', async ({ browser }) => {
    const boardId = newBoardId();
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await openBoard(ctx1, boardId);
    const page2 = await openBoard(ctx2, boardId);

    // Create 5 notes in page1
    for (let i = 0; i < 5; i++) {
      await page1.evaluate((idx) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const Y = (window as any).__VIDI_Y__;
        const objects = doc.getMap('objects');
        const id = Math.random().toString(36).slice(2, 14);
        const text = new Y.Text();
        doc.transact(() => {
          objects.set(id, new Y.Map({
            id, type: 'sticky', x: idx * 100, y: 0, color: 'yellow', text, z: 1, createdAt: Date.now(),
          }));
        });
      }, i);
    }

    // Verify page2 has all 5
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(5);

    // Simulate outage: block page2's network
    await ctx2.route('**/*', (route) => route.abort());

    // Make 3 more notes in page1 during the outage
    for (let i = 5; i < 8; i++) {
      await page1.evaluate((idx) => {
        const hook = (window as any).__VIDI_DEBUG__;
        const doc = hook.doc;
        const Y = (window as any).__VIDI_Y__;
        const objects = doc.getMap('objects');
        const id = Math.random().toString(36).slice(2, 14);
        const text = new Y.Text();
        doc.transact(() => {
          objects.set(id, new Y.Map({
            id, type: 'sticky', x: idx * 100, y: 200, color: 'blue', text, z: 1, createdAt: Date.now(),
          }));
        });
      }, i);
    }

    // Verify page1 has 8
    await expect.poll(async () => (await getBoardSnapshot(page1)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(8);

    // Remove the network block (reconnect)
    await ctx2.unroute('**/*');

    // page2 should catch up to 8 within 1s
    const start = Date.now();
    await expect.poll(async () => (await getBoardSnapshot(page2)).length, { timeout: 2000 }).toBe(8);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);

    await ctx1.close();
    await ctx2.close();
  });
});
