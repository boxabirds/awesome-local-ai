import { test, expect } from '@playwright/test';
import { createBoardIdForPage, setCamera } from './helpers/board';

/**
 * Story 10 e2e — shape.ui (TC-23, TC-24): real-pointer drag creation at 100%
 * zoom, and click creation at 200% zoom with a wrapping label that stays
 * centred through a handle resize.
 *
 * Viewport: Desktop Chrome 1280x720; the default camera is
 * resetCamera(viewport), so world (0,0) sits at screen (640,360) and
 * screen = world + (640,360) at zoom 1.
 */

async function openBoard(page: import('@playwright/test').Page) {
  const id = await createBoardIdForPage(page);
  await page.goto(`/b/${id}`);
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
}

interface DocObject {
  id: string;
  type: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** Read all objects from the Y.Doc via the test hook. */
async function getObjects(page: import('@playwright/test').Page): Promise<DocObject[]> {
  return page.evaluate(() => {
    const objects = (window as any).__vidi6.doc.getMap('objects');
    return [...objects.keys()].map((key: string) => {
      const o: any = objects.get(key);
      return {
        id: key,
        type: o.get('type'),
        kind: o.get('kind') ?? '',
        x: o.get('x'),
        y: o.get('y'),
        width: o.get('width'),
        height: o.get('height'),
        label: o.get('label')?.toString() ?? '',
      };
    });
  });
}

const shapesOf = (objects: DocObject[]) => objects.filter((o) => o.type === 'shape');

/** Centre of an element's bounding box. */
function centreOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('shape.ui (e2e)', () => {
  test('TC-23: a real drag (100,100)→(300,220) at 100% creates a 200x120 shape at that position (±1 px)', async ({ page }) => {
    await openBoard(page);

    // S activates the Shape tool; drag world (100,100) → (300,220).
    await page.keyboard.press('s');
    await page.mouse.move(640 + 100, 360 + 100);
    await page.mouse.down();
    await page.mouse.move(640 + 300, 360 + 220, { steps: 10 });
    await page.mouse.up();

    const shapes = shapesOf(await getObjects(page));
    expect(shapes).toHaveLength(1);
    const [s] = shapes;
    expect(s.x).toBeGreaterThanOrEqual(99);
    expect(s.x).toBeLessThanOrEqual(101);
    expect(s.y).toBeGreaterThanOrEqual(99);
    expect(s.y).toBeLessThanOrEqual(101);
    expect(s.width).toBeGreaterThanOrEqual(199);
    expect(s.width).toBeLessThanOrEqual(201);
    expect(s.height).toBeGreaterThanOrEqual(119);
    expect(s.height).toBeLessThanOrEqual(121);

    // The created shape is selected and the tool returned to Select.
    expect(page.getByTestId('shape-object')).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('select-tool-button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-24: Diamond click at 200% → 160x160 centred; long label wraps and stays centred through a handle resize', async ({ page }) => {
    await openBoard(page);

    // 200% zoom, world (0,0) at the screen centre.
    await setCamera(page, -320, -180, 2);

    // S, pick the Diamond kind, then a plain click at the centre.
    await page.keyboard.press('s');
    await page.getByTestId('shape-kind-diamond').click();
    await page.mouse.click(640, 360);

    const shapes = shapesOf(await getObjects(page));
    expect(shapes).toHaveLength(1);
    const [s] = shapes;
    expect(s.kind).toBe('diamond');
    expect(s.width).toBe(160);
    expect(s.height).toBe(160);
    // Centred on world (0,0): top-left at (-80,-80).
    expect(s.x).toBe(-80);
    expect(s.y).toBe(-80);

    // Double-click → label editor; type a label longer than the shape's width.
    await page.mouse.dblclick(640, 360);
    await page.getByTestId('shape-label-textarea').waitFor({ timeout: 5000 });
    await page.keyboard.type('This label is deliberately much longer than the shape itself');
    await page.keyboard.press('Escape');
    // The full label is stored (not truncated by the box).
    const afterLabel = shapesOf(await getObjects(page));
    expect(afterLabel[0].label).toBe(
      'This label is deliberately much longer than the shape itself',
    );

    // The label wraps within the shape and is centred in it.
    const assertLabelCentred = async () => {
      const sb = (await page.getByTestId('shape-object').boundingBox())!;
      const lb = (await page.getByTestId('shape-label').boundingBox())!;
      const sc = centreOf(sb);
      const lc = centreOf(lb);
      expect(Math.abs(lc.x - sc.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(lc.y - sc.y)).toBeLessThanOrEqual(2);
      // Wrapped: the label box is at least two lines tall and no wider
      // than the shape.
      expect(lb.width).toBeLessThanOrEqual(sb.width);
      expect(lb.height).toBeGreaterThanOrEqual(2 * 20);
      return sb;
    };
    await assertLabelCentred();

    // Resize via the SE handle: the shape's SE corner is at screen
    // ((80+320)*2, (80+180)*2) = (800,520); drag it +100,+100 px
    // (= +50,+50 world at 200%) → the shape grows to 210x210.
    const handle = page.locator('[data-testid="resize-handle"][data-handle="se"]');
    await handle.boundingBox().then(async (b) => {
      expect(b).not.toBeNull();
      await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
      await page.mouse.down();
      await page.mouse.move(b!.x + b!.width / 2 + 100, b!.y + b!.height / 2 + 100, { steps: 8 });
      await page.mouse.up();
    });

    const after = shapesOf(await getObjects(page));
    expect(after[0].width).toBeGreaterThanOrEqual(209);
    expect(after[0].width).toBeLessThanOrEqual(211);
    expect(after[0].height).toBeGreaterThanOrEqual(209);
    expect(after[0].height).toBeLessThanOrEqual(211);

    // The label re-wraps and stays centred in the resized shape.
    await assertLabelCentred();
  });
});
