import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { largeBoard } from '../fixtures/boards';
import { openBoardSocket } from './helpers/board-socket';
import { startDevServer } from './helpers/wrangler-process';

const t = test.extend<{ server: ReturnType<typeof startDevServer> }>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => use(await startDevServer()),
});

for (const count of [1, 200, 2000]) {
  t(`perf ${count}`, async ({ browser, server }) => {
    const s = await server;
    const boardId = newBoardId();
    await (await import('./helpers/board-socket')).seedBoard(server.roomUrl(boardId), (doc) => largeBoard(doc, count));

    // Socket only: server load + transfer.
    const t0 = Date.now();
    const socket = await openBoardSocket(server.roomUrl(boardId));
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (socket.doc.getMap('objects').size >= count) { clearInterval(check); resolve(); }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 20_000);
    });
    const socketMs = Date.now() - t0;
    await socket.close();

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const t1 = Date.now();
    await page.goto(`${server.url}/b/${boardId}`);
    const curve: string[] = [];
    let last = -1;
    while (Date.now() - t1 < 40_000) {
      const n = await page.locator('[data-testid="sticky-note"]').count();
      if (n !== last) { curve.push(`${String(Date.now() - t1)}:${String(n)}`); last = n; }
      if (n >= count) break;
      await page.waitForTimeout(50);
    }
    const pageMs = Date.now() - t1;
    const perf = await page.evaluate(() => Math.round(performance.now()));
    console.log(`count=${String(count)} socket=${String(socketMs)}ms page=${String(pageMs)}ms perfNow=${String(perf)}ms curve=${curve.slice(0, 8).join(' ')}`);
    await context.close();
  });
}
