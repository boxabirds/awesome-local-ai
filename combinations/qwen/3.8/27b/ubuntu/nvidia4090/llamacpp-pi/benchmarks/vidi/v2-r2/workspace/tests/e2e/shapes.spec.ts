/**
 * Story 10 e2e — shapes (design TC-23, TC-24).
 *
 * Real Chromium against the real Worker, one participant driving the real UI
 * (keyboard shortcuts + mouse drags) and observing through the test-only
 * window.__vidi6 hooks. The default camera renders the world origin at
 * screen (640,400) at zoom 1, so screen = world + (640,400).
 */
import { expect, test } from '@playwright/test';
import { createBoard, Participant, sharedServerUrl } from './helpers/participants';
import { expectWithinPx, setCamera } from './helpers/board';
import { type FlowObject } from './helpers/flow-objects';

test('TC-23: a Shape-tool drag at 100% zoom creates a 200x120 rect exactly at the dragged rect', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const dana = await Participant.join(ctx, boardId);
  try {
    await dana.page.keyboard.press('s');
    // World (100,100) → screen (740,500); world (300,220) → screen (940,620).
    await dana.page.mouse.move(740, 500);
    await dana.page.mouse.down();
    await dana.page.mouse.move(940, 620, { steps: 10 });
    await dana.page.mouse.up();

    const all = await dana.waitFor(
      (objs) => objs.some((o) => (o as unknown as FlowObject).kind !== undefined),
      'the created shape',
    );
    const shape = (all as unknown as FlowObject[]).find((o) => o.kind !== undefined)!;
    expect(shape.kind).toBe('rect');
    expectWithinPx(shape.x, 100, 'shape x');
    expectWithinPx(shape.y, 100, 'shape y');
    expectWithinPx(shape.width ?? -1, 200, 'shape width');
    expectWithinPx(shape.height ?? -1, 120, 'shape height');

    // tools.return_to_select: the new shape is selected (its toolbar shows).
    await dana.page.getByTestId('shape-toolbar').waitFor({ timeout: 5_000 });
    expect(dana.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('TC-24: a Diamond click at 200% creates the 160x160 default centred on the click; a long label wraps and stays centred after a corner resize', async ({ browser }) => {
  const boardId = await createBoard(sharedServerUrl());
  const ctx = await browser.newContext();
  const dana = await Participant.join(ctx, boardId);
  const page = dana.page;
  try {
    // 200% zoom with the world origin at the screen centre.
    await setCamera(page, { x: -320, y: -200, zoom: 2 });

    await page.keyboard.press('s');
    await page.getByTestId('shape-kind-diamond').click();
    // Click at the screen centre = world (0,0).
    await page.mouse.click(640, 400);

    const all = await dana.waitFor(
      (objs) => objs.some((o) => (o as unknown as FlowObject).kind === 'diamond'),
      'the created diamond',
    );
    const shape = (all as unknown as FlowObject[]).find((o) => o.kind === 'diamond')!;
    expectWithinPx(shape.x, -80, 'default x');
    expectWithinPx(shape.y, -80, 'default y');
    expectWithinPx(shape.width ?? -1, 160, 'default width');
    expectWithinPx(shape.height ?? -1, 160, 'default height');

    // A label longer than the shape width: double-click opens the editor.
    await page.mouse.dblclick(640, 400);
    await page.getByTestId('shape-label-textarea').waitFor({ timeout: 5_000 });
    await page.keyboard.type('The payment gateway retries three times before failing the request');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelector('[data-testid="shape-label-textarea"]') === null,
      undefined,
      { timeout: 5_000, polling: 50 },
    );

    const all2 = await dana.waitFor(
      (objs) =>
        objs.some((o) =>
          (o as unknown as FlowObject).label === 'The payment gateway retries three times before failing the request',
        ),
      'the label text',
    );
    const labelled = (all2 as unknown as FlowObject[]).find((o) => o.kind === 'diamond')!;
    expect(labelled.label).toContain('retries three times');

    // The display label wraps: its rendered height is well over one line
    // (one line is 16 world px * 1.3 * zoom 2 = 42 screen px).
    const labelBox = await page.getByTestId('shape-label').boundingBox();
    expect(labelBox, 'label should render').not.toBeNull();
    expect(labelBox!.height, 'label should wrap to multiple lines').toBeGreaterThan(60);

    // The shape is still selected after Escape: drag the SE corner
    // (screen (800,560)) by +100,+60 = world +50,+30.
    const se = await page.locator('[data-testid="resize-handle"][data-handle="se"]').boundingBox();
    expect(se, 'SE handle should render').not.toBeNull();
    await page.mouse.move(se!.x + se!.width / 2, se!.y + se!.height / 2);
    await page.mouse.down();
    await page.mouse.move(se!.x + se!.width / 2 + 100, se!.y + se!.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    const all3 = await dana.waitFor((objs) => {
      const s = (objs as unknown as FlowObject[]).find((o) => o.kind === 'diamond');
      return s !== undefined && (s.width ?? 0) > 165;
    }, 'the diamond to grow');
    const grown = (all3 as unknown as FlowObject[]).find((o) => o.kind === 'diamond')!;
    expectWithinPx(grown.x, -80, 'left edge stays', 2);
    expectWithinPx(grown.y, -80, 'top edge stays', 2);
    expectWithinPx(grown.width ?? -1, 210, 'resized width', 2);
    expectWithinPx(grown.height ?? -1, 190, 'resized height', 2);

    // The wrapped label is still centred on the (now larger) shape.
    const shapeBox = await page.locator(`[data-shape-object="${shape.id}"]`).boundingBox();
    const labelBox2 = await page.getByTestId('shape-label').boundingBox();
    expect(shapeBox, 'shape should render').not.toBeNull();
    expect(labelBox2, 'label should render').not.toBeNull();
    const cx = (b: { x: number; width: number }): number => b.x + b.width / 2;
    const cy = (b: { y: number; height: number }): number => b.y + b.height / 2;
    expect(Math.abs(cx(labelBox2!) - cx(shapeBox!))).toBeLessThanOrEqual(2);
    expect(Math.abs(cy(labelBox2!) - cy(shapeBox!))).toBeLessThanOrEqual(2);

    if (dana.hasErrors()) {
      console.log('CONSOLE ERRORS:', dana.errorDetails());
    }
    expect(dana.hasErrors()).toBe(false);
  } finally {
    await ctx.close();
  }
});
