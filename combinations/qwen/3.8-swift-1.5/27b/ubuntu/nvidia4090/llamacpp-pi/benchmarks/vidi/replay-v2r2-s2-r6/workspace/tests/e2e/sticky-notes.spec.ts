import { test, expect } from '@playwright/test';
import { setCamera, getBoardSnapshot, worldTransform } from './helpers/camera';

// Camera helpers (deterministic view for geometry assertions):
//  100%: { x: -640, y: -400, zoom: 1 }   → screen (sx,sy) = world + (640,400)
//  50%:  { x: -800, y: -600, zoom: 0.5 } → screen (sx,sy) = (world + (800,600)) * 0.5
//  200%: { x: -320, y: -200, zoom: 2 }   → screen (sx,sy) = (world + (320,200)) * 2
const CAM100 = { x: -640, y: -400, zoom: 1 };
const CAM50 = { x: -800, y: -600, zoom: 0.5 };
const CAM200 = { x: -320, y: -200, zoom: 2 };

test.describe('sticky notes (e2e)', () => {
  test('TC-30 real dblclick at (400,300) then type "Hello" → note centre at (400,300) ±1px; text Hello', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, CAM100);

    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Hello');

    const box = await page.locator('[data-testid="sticky-note"]').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width / 2).toBeCloseTo(400, 1);
    expect(box!.y + box!.height / 2).toBeCloseTo(300, 1);

    const snap = await getBoardSnapshot(page);
    expect(snap).toHaveLength(1);
    expect(snap[0].text).toBe('Hello');
  });

  test('TC-31 drag by (100,50) screen px at 50% zoom → world x,y +200,+100; grabbed point stays under pointer ±1px', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, CAM50);

    // Note centre at world (0,0) → screen centre (400,300)
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape'); // commit text, note Selected
    const before = (await getBoardSnapshot(page))[0];

    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(500, 350, { steps: 10 });
    await page.mouse.up();

    const after = (await getBoardSnapshot(page))[0];
    expect(after.x).toBe(before.x + 200);
    expect(after.y).toBe(before.y + 100);

    // The grabbed point (note centre) is under the pointer
    const box = await page.locator('[data-testid="sticky-note"]').boundingBox();
    expect(box!.x + box!.width / 2).toBeCloseTo(500, 1);
    expect(box!.y + box!.height / 2).toBeCloseTo(350, 1);
  });

  test('TC-32 drag by (100,50) at 200% zoom → world x,y +50,+25; dragged note drawn above overlapped note', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, CAM200);

    // Note A: screen centre (400,300) → world centre (-120,-50) → top-left (-220,-150)
    await page.mouse.dblclick(400, 300);
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 10); // deselect
    // Note B: screen centre (650,300) → world centre (5,-50) → top-left (-195,-150).
    // The creation point is empty board space, but B's screen rect
    // (250,100)-(650,500) overlaps A's rect (200,100)-(600,500).
    await page.mouse.dblclick(650, 300);
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 10); // deselect

    const [aBefore, bBefore] = await getBoardSnapshot(page);

    // Drag A (screen centre (400,300)) by (100,50)
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(500, 350, { steps: 10 });
    await page.mouse.up();

    const snap = await getBoardSnapshot(page);
    const a = snap.find((n) => n.id === aBefore.id)!;
    const b = snap.find((n) => n.id === bBefore.id)!;
    expect(a.x).toBe(aBefore.x + 50);
    expect(a.y).toBe(aBefore.y + 25);
    expect(b.x).toBe(bBefore.x);
    expect(b.y).toBe(bBefore.y);

    // A was dragged over B: at an overlapped screen point the topmost element
    // must belong to A.
    const topEl = await page.evaluate(() => {
      const els = document.elementsFromPoint(420, 320);
      const note = els.find((el) => el.closest('[data-testid="sticky-note"]'));
      return note?.closest('[data-testid="sticky-note"]')?.getAttribute('data-id') ?? null;
    });
    expect(topEl).toBe(a.id);
  });

  test('TC-33 type one word → font 24px; paste 1,000 chars → font ≥ 10px, clipped with fade', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, CAM100);

    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Hello');

    // One word fits at the maximum size
    let fontSize = await page.locator('[data-testid="sticky-textarea"]').evaluate((el) => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('24px');

    // Paste 1,000 characters
    await page.keyboard.insertText('x'.repeat(1000));
    // Commit (Escape) so the display mode lays out the text
    await page.keyboard.press('Escape');

    const textEl = page.locator('[data-testid="sticky-text"]');
    fontSize = await textEl.evaluate((el) => getComputedStyle(el).fontSize);
    const px = parseFloat(fontSize);
    expect(px).toBeGreaterThanOrEqual(10);
    expect(px).toBeLessThan(24);
    // The text overflows the box and the fade is shown
    const scrollHeight = await textEl.evaluate((el) => el.scrollHeight);
    expect(scrollHeight).toBeGreaterThan(168);
    expect(await page.locator('[data-testid="sticky-fade"]').count()).toBe(1);

    const snap = (await getBoardSnapshot(page))[0];
    expect(snap.text.length).toBe(1000);
  });

  test('TC-34 pan far away, click Sticky note → note visible at centre of screen', async ({ page }) => {
    await page.goto('/');
    // Pan far away from the origin
    await setCamera(page, { x: -50000, y: -50000, zoom: 1 });

    await page.getByRole('button', { name: 'Sticky note' }).click();

    const box = await page.locator('[data-testid="sticky-note"]').boundingBox();
    expect(box).not.toBeNull();
    // Viewport is 1280×800 → centre (640,400)
    expect(box!.x + box!.width / 2).toBeCloseTo(640, 1);
    expect(box!.y + box!.height / 2).toBeCloseTo(400, 1);

    const snap = await getBoardSnapshot(page);
    expect(snap).toHaveLength(1);
    // Centre at world (640-50000, 400-50000) = (-49360,-49600) → top-left
    // (-49460, -49700)
    expect(snap[0].x).toBe(-49460);
    expect(snap[0].y).toBe(-49700);
  });

  test('golden path: create, type, recolour, move at 50%, delete → board ends with the other note untouched', async ({ page }) => {
    await page.goto('/');
    await setCamera(page, CAM50);

    // Note A at screen centre (400,300) → world centre (0,0) → top-left (-100,-100)
    await page.mouse.dblclick(400, 300);
    await page.keyboard.type('Idea one');
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 10); // deselect

    // Note B at screen (550,450) → world centre (300,300) → top-left (200,200)
    await page.mouse.dblclick(550, 450);
    await page.keyboard.type('Idea two');
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 10); // deselect

    // Select A and recolour it pink
    await page.mouse.click(400, 300);
    await page.getByRole('button', { name: 'Pink colour' }).click();

    // Drag A by (100,50) screen px → world (+200,+100) → top-left (100,0)
    await page.mouse.move(400, 300);
    await page.mouse.down();
    await page.mouse.move(500, 350, { steps: 10 });
    await page.mouse.up();

    // A is Selected after the drag: delete it with the bin button
    await page.getByRole('button', { name: 'Delete note' }).click();

    const snap = await getBoardSnapshot(page);
    expect(snap).toHaveLength(1);
    expect(snap[0].text).toBe('Idea two');
    expect(snap[0].x).toBe(200);
    expect(snap[0].y).toBe(200);
    expect(snap[0].color).toBe('yellow');
    // Board camera unchanged throughout
    expect(await worldTransform(page)).toBe('scale(0.5) translate(800px, 600px)');
  });
});
