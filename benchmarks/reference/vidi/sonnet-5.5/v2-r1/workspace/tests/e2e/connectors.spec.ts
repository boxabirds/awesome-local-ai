import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { setCamera, createBoardId } from './helpers/board';
import { closeAll, expectEventually, openParticipants } from './helpers/participants';
import type { Participant } from './helpers/participants';

const shapes = (page: Page) => page.locator('[data-shape-object]');
const arrows = (page: Page) => page.locator('[data-connector-object]');

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
}

/** Draws a rectangle covering the screen rect (camera at origin, 100%) and returns to Select. */
async function draw(page: Page, from: [number, number], to: [number, number]) {
  await page.keyboard.press('s');
  await drag(page, from, to);
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
}

async function line(page: Page): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  return arrows(page).first().locator('[data-testid="connector-hit"]').evaluate((el) => ({
    x1: parseFloat(el.getAttribute('x1') ?? 'NaN'),
    y1: parseFloat(el.getAttribute('y1') ?? 'NaN'),
    x2: parseFloat(el.getAttribute('x2') ?? 'NaN'),
    y2: parseFloat(el.getAttribute('y2') ?? 'NaN'),
  }));
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1.5;

async function connectAB(dana: Participant) {
  const page = dana.page;
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  await draw(page, [400, 200], [560, 300]); // A
  await draw(page, [800, 200], [960, 300]); // B
  await page.keyboard.press('l');
  await drag(page, [480, 250], [880, 250]);
  await expect(arrows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
}

async function bothSee(people: Participant[], label: string, check: (page: Page) => Promise<boolean>) {
  const started = Date.now();
  for (const p of people) await expectEventually(`${label} (${p.name})`, () => check(p.page), started);
}

test.describe('connectors', () => {
  test('TC-25 an arrow follows a moved shape and switches sides, on both screens', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    try {
      await connectAB(dana);
      // Sam has the same camera; wait for the arrow, A's right side (560) to B's left side (800).
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
      await bothSee([dana, sam], 'arrow A to B', async (p) => {
        const l = await line(p).catch(() => null);
        return !!l && close(l.x1, 560) && close(l.x2, 800) && close(l.y1, 250) && close(l.y2, 250);
      });

      // Dana drags B across A and to its left: the arrow should leave A's left side and reach B's right side.
      const started = Date.now();
      await drag(dana.page, [880, 270], [100, 270]);
      for (const p of [dana, sam]) {
        await expectEventually(
          `arrow switched side (${p.name})`,
          async () => {
            const l = await line(p.page);
            // A's left side is x = 400; B now spans 20..180, so its right side is x = 180.
            return close(l.x1, 400) && close(l.x2, 180) && close(l.y1, 250);
          },
          started,
        );
      }
    } finally {
      await closeAll([dana, sam]);
    }
  });

  test('TC-26 when Sam deletes B the arrow stays, its end free where B’s side was, on both screens', async ({ browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    try {
      await connectAB(dana);
      await setCamera(sam.page, { x: 0, y: 0, zoom: 1 });
      await bothSee([dana, sam], 'arrow present', async (p) => (await arrows(p).count()) === 1);
      await sam.page.mouse.click(880, 220); // select B (the arrow is at y 250)
      await sam.page.keyboard.press('Delete');
      await bothSee([dana, sam], 'B deleted', async (p) => (await shapes(p).count()) === 1);
      for (const p of [dana, sam]) {
        await expect(arrows(p.page)).toHaveCount(1);
        const l = await line(p.page);
        expect(close(l.x1, 560)).toBe(true);
        expect(close(l.x2, 800)).toBe(true);
        expect(close(l.y2, 250)).toBe(true);
      }
    } finally {
      await closeAll([dana, sam]);
    }
  });

  test('TC-27 an arrow drawn to a shape deleted at the same moment is still shown, with no errors', async ({ browser }) => {
    const boardId = await createBoardId();
    const [dana] = await openParticipants(browser, 1, boardId);
    const sam = await openDelayed(browser, boardId);
    try {
      await setCamera(dana.page, { x: 0, y: 0, zoom: 1 });
      await draw(dana.page, [400, 200], [560, 300]); // A
      await draw(dana.page, [800, 200], [960, 300]); // B
      await setCamera(sam.person.page, { x: 0, y: 0, zoom: 1 });
      await expect(shapes(sam.person.page)).toHaveCount(2);

      // Sam's changes now take 3 s to reach the server: Dana attaches to B before Sam's delete arrives.
      sam.setDelay(3000);
      await sam.person.page.mouse.click(880, 220);
      await sam.person.page.keyboard.press('Delete');
      await expect(shapes(sam.person.page)).toHaveCount(1);
      await expect(shapes(dana.page)).toHaveCount(2);
      await dana.page.keyboard.press('l');
      await drag(dana.page, [480, 250], [880, 250]);
      await expect(arrows(dana.page)).toHaveCount(1);

      for (const p of [dana, sam.person]) {
        await expectEventually(`B gone (${p.name})`, async () => (await shapes(p.page).count()) === 1);
        await expect(arrows(p.page)).toHaveCount(1);
        const l = await line(p.page);
        expect(close(l.x1, 560)).toBe(true);
        expect(close(l.x2, 800)).toBe(true);
        expect(p.errors).toEqual([]);
      }
    } finally {
      await closeAll([dana, sam.person]);
    }
  });
});

/** A participant whose outgoing socket traffic can be delayed, to force overlapping edits. */
async function openDelayed(browser: Browser, boardId: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: 'http://localhost:8787' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/WebSocket|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push(m.text());
  });
  let delay = 0;
  await page.routeWebSocket(/\/api\/rooms\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      if (delay > 0) setTimeout(() => server.send(m), delay);
      else server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor();
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected');
  const person: Participant = { name: 'Sam', context, page, errors };
  return { person, setDelay: (ms: number) => void (delay = ms) };
}
