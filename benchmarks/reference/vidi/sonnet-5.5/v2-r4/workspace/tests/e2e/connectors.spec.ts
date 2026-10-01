import { expect, test, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../src/shared/config';
import { buildCheckoutFlow } from '../fixtures/checkout-flow';
import { setCamera } from './helpers/board';
import { closeAll, expectEventually, openParticipants, waitConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';

const BASE = 'http://localhost:8791';
const toScreen = (wx: number, wy: number) => ({ x: 640 + wx, y: 400 + wy });

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

/** Drawn ends of every arrow, as "x1,y1>x2,y2" in board units, sorted. */
async function arrows(page: Page): Promise<string[]> {
  const r = await page.locator('[data-connector-id]').evaluateAll((els) =>
    els.map((el) => `${el.getAttribute('data-from')}>${el.getAttribute('data-to')}`),
  );
  return r.map((s) => s.replace(/-?\d+\.?\d*/g, (n) => String(Math.round(parseFloat(n))))).sort();
}

test.describe('collaborative rearrange', () => {
  test('TC-25 / TC-26 arrows follow a remote move and switch sides; a remote delete keeps them with a free end', async ({ browser }) => {
    const { people } = await openParticipants(browser, 2);
    const [dana, sam] = people;
    await Promise.all([setCamera(dana.page, -640, -400, 1), setCamera(sam.page, -640, -400, 1)]);

    // Dana draws A, B and connects them.
    await dana.page.keyboard.press('s');
    await drag(dana.page, toScreen(-300, -50), toScreen(-140, 50));
    await dana.page.keyboard.press('s');
    await drag(dana.page, toScreen(140, -50), toScreen(300, 50));
    await dana.page.keyboard.press('l');
    await dana.page.mouse.move(toScreen(-220, 0).x, toScreen(-220, 0).y);
    await expect(dana.page.getByTestId('connection-dot-top')).toBeVisible();
    await drag(dana.page, toScreen(-220, 0), toScreen(220, 0));
    await expectEventually('arrow created on Sam', () => arrows(sam.page), ['-140,0>140,0']);
    expect(await arrows(dana.page)).toEqual(['-140,0>140,0']);

    // Dana moves B across A: the arrow now leaves A's left side and reaches B's right side.
    await dana.page.keyboard.press('v');
    await drag(dana.page, toScreen(220, 0), toScreen(-420, 0));
    const moved = ['-300,0>-340,0'];
    await expectEventually('arrow follows on Dana', () => arrows(dana.page), moved);
    await expectEventually('arrow follows on Sam', () => arrows(sam.page), moved);

    // Sam deletes B: the arrow stays, its end fixed where B's side was.
    await sam.page.mouse.click(toScreen(-420, 0).x, toScreen(-420, 0).y);
    await sam.page.keyboard.press('Delete');
    await expectEventually('shape gone on Dana', () => dana.page.locator('[data-shape-id]').count(), 1);
    expect(await arrows(sam.page)).toEqual(moved);
    expect(await arrows(dana.page)).toEqual(moved);
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await closeAll(people);
  });

  test('TC-26 deleting the diamond of the checkout flow frees both arrow ends where its sides were', async ({ browser }) => {
    const boardId = newBoardId();
    const flow = buildCheckoutFlow();
    await seedBoard(BASE, boardId, flow.doc);
    const { people } = await openParticipants(browser, 2, boardId);
    const [dana, sam] = people;
    await Promise.all([setCamera(dana.page, -640, -400, 1), setCamera(sam.page, -640, -400, 1)]);
    await expect(sam.page.locator('[data-connector-id]')).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const before = await arrows(sam.page);
    expect(before).toContain('-340,-150>-200,-150');
    expect(before).toContain('-40,-150>100,-150');

    await sam.page.mouse.click(toScreen(-120, -150).x, toScreen(-120, -150).y);
    await sam.page.keyboard.press('Delete');
    for (const p of [sam, dana]) {
      await expectEventually(`flow after delete (${p.name})`, () => p.page.locator('[data-shape-id]').count(), 3);
      const after = await arrows(p.page);
      expect(after).toHaveLength(4);
      expect(after).toContain('-340,-150>-200,-150'); // cart → (free end where the diamond's left side was)
      expect(after).toContain('-40,-150>100,-150'); // (free end at the diamond's right side) → ship
    }
    await closeAll(people);
  });
});

test.describe('delete race', () => {
  test('TC-27 an arrow drawn to a shape that another person deleted at the same time is drawn at its fallback', async ({ browser }) => {
    const boardId = newBoardId();
    const flow = buildCheckoutFlow();
    await seedBoard(BASE, boardId, flow.doc);
    const { people } = await openParticipants(browser, 2, boardId);
    const [dana, sam] = people;

    // Sam's outgoing socket traffic is held back so Dana still sees the shape while Sam has already deleted it.
    let delayMs = 0;
    await sam.page.routeWebSocket(/\/api\/rooms\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => {
        if (delayMs > 0) setTimeout(() => server.send(m), delayMs);
        else server.send(m);
      });
      server.onMessage((m) => ws.send(m));
    });
    await sam.page.reload();
    await sam.page.getByTestId('board-viewport').waitFor();
    await waitConnected(sam.page);
    await Promise.all([setCamera(dana.page, -640, -400, 1), setCamera(sam.page, -640, -400, 1)]);
    await expect(sam.page.locator('[data-shape-id]')).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    await expect(dana.page.locator('[data-shape-id]')).toHaveCount(4, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    dana.consoleErrors.length = 0;

    delayMs = 5000;
    await sam.page.mouse.click(toScreen(480, -150).x, toScreen(480, -150).y); // "Done"
    await sam.page.keyboard.press('Delete');
    await expect(sam.page.locator('[data-shape-id]')).toHaveCount(3);
    await expect(dana.page.locator('[data-shape-id]')).toHaveCount(4); // not delivered yet

    await dana.page.keyboard.press('l');
    await drag(dana.page, toScreen(180, -150), toScreen(480, -150)); // Ship → Done
    await expect(dana.page.locator('[data-connector-id]')).toHaveCount(5);

    await expect(dana.page.locator('[data-shape-id]')).toHaveCount(3, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    const list = await arrows(dana.page);
    expect(list).toHaveLength(5);
    expect(list.filter((a) => a.endsWith('>400,-150')).length).toBeGreaterThanOrEqual(1); // the new arrow's end at its fallback
    expect(dana.consoleErrors).toEqual([]);
    await closeAll(people);
  });
});
