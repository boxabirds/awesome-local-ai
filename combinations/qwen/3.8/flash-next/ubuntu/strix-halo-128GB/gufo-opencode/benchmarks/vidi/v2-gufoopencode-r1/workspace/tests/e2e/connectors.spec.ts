import { expect, test } from '@playwright/test';
import { createBoard, settle } from './helpers/board';
import { eventually, expectEventually, openParticipant } from './helpers/participants';
import { centerOf, connectorEnds, seedFlow } from './helpers/shapes';

const key = (e: { fx: number; fy: number; tx: number; ty: number }): string =>
  `${e.fx.toFixed(1)},${e.fy.toFixed(1)}->${e.tx.toFixed(1)},${e.ty.toFixed(1)}`;

test.describe('workflow: collaborative rearrange', () => {
  test('TC-25 an attached arrow follows a remote drag and switches side', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const dana = await openParticipant(browser, 'Dana', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const ids = await seedFlow(dana.page);
    const conn = ids.connectors[0]!;
    const b = ids.shapes[1]!;
    await eventually(() => sam.page.locator(`[data-testid="connector-${conn}"]`).count(), 'Sam sees the arrow').toBeGreaterThan(0);
    await settle(sam.page);

    const before = await connectorEnds(sam.page, conn);
    const centerA = await centerOf(dana.page, `shape-${ids.shapes[0]}`);
    const centerB = await centerOf(dana.page, `shape-${b}`);

    // Dana drags B to the far side of A.
    await dana.page.mouse.move(centerB.x, centerB.y);
    await dana.page.mouse.down();
    await dana.page.mouse.move(centerA.x - 120, centerB.y, { steps: 10 });
    await dana.page.mouse.up();
    await settle(dana.page);

    await expectEventually('TC-25 arrow follows', async () => {
      await eventually(
        async () => (await connectorEnds(sam.page, conn)).tx !== before.tx || (await connectorEnds(sam.page, conn)).ty !== before.ty,
        'Sam sees the arrow endpoint move'
      ).toBe(true);
    });
    await expectEventually('TC-25 converge', async () => {
      await eventually(
        async () => key(await connectorEnds(sam.page, conn)) === key(await connectorEnds(dana.page, conn)),
        'both screens agree on the arrow'
      ).toBe(true);
    });
    await expect(sam.page.locator(`[data-testid="connector-${conn}"]`)).toBeVisible();
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await dana.context.close();
    await sam.context.close();
  });

  test('TC-26 deleting an attached shape leaves a free-ended arrow on both screens', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const dana = await openParticipant(browser, 'Dana', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const ids = await seedFlow(dana.page);
    const conn = ids.connectors[0]!;
    const b = ids.shapes[1]!;
    await eventually(() => sam.page.locator(`[data-testid^="connector-"]`).count(), 'Sam sees connectors').toBeGreaterThanOrEqual(4);
    await settle(sam.page);

    // Sam deletes B; the arrow must survive with a free end, on both screens.
    await sam.page.getByTestId(`shape-${b}`).click();
    await sam.page.keyboard.press('Delete');
    await settle(sam.page);

    await expectEventually('TC-26 arrow survives delete', async () => {
      await eventually(
        () => dana.page.locator(`[data-testid="connector-${conn}"]`).count(),
        'Dana still shows the arrow'
      ).toBe(1);
    });
    await expect(sam.page.locator(`[data-testid="connector-${conn}"]`)).toBeVisible();
    await expect(sam.page.locator(`[data-testid="shape-${b}"]`)).toHaveCount(0);
    const ends = await connectorEnds(dana.page, conn);
    expect(Number.isFinite(ends.tx)).toBe(true);
    expect(Number.isFinite(ends.ty)).toBe(true);
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await dana.context.close();
    await sam.context.close();
  });

  test('TC-27 re-attacking an arrow to a shape being deleted leaves it visible with no errors', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const dana = await openParticipant(browser, 'Dana', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);
    const ids = await seedFlow(dana.page);
    const conn = ids.connectors[0]!;
    const b = ids.shapes[1]!;
    await eventually(() => sam.page.locator(`[data-testid="connector-${conn}"]`).count(), 'Sam sees the arrow').toBeGreaterThan(0);
    await settle(sam.page);

    // Dana grabs the arrow's end handle and drags it onto B while Sam deletes B.
    await dana.page.getByTestId(`connector-${conn}`).click();
    const handle = dana.page.getByTestId(`connector-handle-to-${conn}`);
    await expect(handle).toBeVisible();
    const hb = await handle.boundingBox();
    if (hb === null) throw new Error('handle not visible');
    const target = await centerOf(dana.page, `shape-${b}`);

    await Promise.all([
      (async () => {
        await dana.page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await dana.page.mouse.down();
        for (let i = 1; i <= 8; i += 1) {
          await dana.page.mouse.move(
            hb.x + ((target.x - hb.x) * i) / 8,
            hb.y + ((target.y - hb.y) * i) / 8,
            { steps: 2 }
          );
          await dana.page.waitForTimeout(40);
        }
        await dana.page.mouse.up();
      })(),
      (async () => {
        await sam.page.waitForTimeout(160);
        await sam.page.getByTestId(`shape-${b}`).click();
        await sam.page.keyboard.press('Delete');
      })()
    ]);
    await settle(dana.page);
    await settle(sam.page);

    await expectEventually('TC-27 arrow stays visible', async () => {
      await eventually(() => dana.page.locator(`[data-testid="connector-${conn}"]`).count(), 'Dana keeps the arrow').toBe(1);
    });
    const ends = await connectorEnds(dana.page, conn);
    expect(Number.isFinite(ends.tx)).toBe(true);
    expect(Number.isFinite(ends.fy)).toBe(true);
    expect(dana.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    await dana.context.close();
    await sam.context.close();
  });
});
