import { test, expect, type Page } from '@playwright/test';
import { openBoard, setCamera } from './helpers/board.ts';
import { LONG_TEXT_1000 } from '../fixtures/texts.ts';
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config.ts';

interface NoteInfo {
  id: string;
  x: number; // world left
  y: number; // world top
  z: number;
  cx: number; // screen centre x
  cy: number;
  w: number;
  h: number;
}

async function notes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll('[role="group"][aria-label="Sticky note"]'),
    ) as HTMLElement[];
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.noteId ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        z: parseFloat(el.style.zIndex),
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        w: r.width,
        h: r.height,
      };
    });
  });
}

const settle = (page: Page) => page.waitForTimeout(60);

async function createByDblClick(page: Page, x: number, y: number, text: string) {
  await page.mouse.dblclick(x, y);
  await settle(page);
  await page.keyboard.type(text);
  await settle(page);
}

async function dragNote(page: Page, sx: number, sy: number, dx: number, dy: number) {
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(20);
  await page.mouse.move(sx + dx / 4, sy + dy / 4, { steps: 6 });
  await page.waitForTimeout(20);
  await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 6 });
  await page.waitForTimeout(20);
  await page.mouse.move(sx + (dx * 3) / 4, sy + (dy * 3) / 4, { steps: 6 });
  await page.waitForTimeout(20);
  await page.mouse.move(sx + dx, sy + dy, { steps: 6 });
  await page.waitForTimeout(20);
  await page.mouse.up();
  await settle(page);
}

test.describe('sticky notes', () => {
  test('TC-30 double-click creates a centred, editable note', async ({ page }) => {
    await openBoard(page);
    await createByDblClick(page, 400, 300, 'Hello');
    const ns = await notes(page);
    expect(ns).toHaveLength(1);
    await expect(page.getByTestId('sticky-text-editor')).toHaveValue('Hello');
    expect(Math.abs(ns[0]!.cx - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(ns[0]!.cy - 300)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sticky-text')).toHaveText('Hello');
  });

  test('TC-31 at 50% zoom a drag keeps the grabbed point under the pointer', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 0.5 });
    await createByDblClick(page, 500, 400, 'Idea');
    await page.keyboard.press('Escape');
    await settle(page);
    const before = (await notes(page))[0]!;
    await dragNote(page, before.cx, before.cy, 100, 50);
    const after = (await notes(page))[0]!;
    // world delta = screen / zoom = (100 / 0.5, 50 / 0.5) = (200, 100)
    expect(after.x - before.x).toBeCloseTo(200, 0);
    expect(after.y - before.y).toBeCloseTo(100, 0);
    // the whole note moved by exactly (100, 50) on screen → grabbed point follows
    expect(Math.abs(after.cx - (before.cx + 100))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.cy - (before.cy + 50))).toBeLessThanOrEqual(1);
  });

  test('TC-32 at 200% zoom a drag raises the note above an overlap', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 2 });
    // At 200% zoom a note is 400px on screen. A centres at (300,300) → box
    // x∈[100,500] y∈[100,500]; B centres at (560,560) → box x∈[360,760]
    // y∈[360,760]. The two boxes overlap in x∈[360,500] y∈[360,500].
    await createByDblClick(page, 300, 300, 'A');
    await page.keyboard.press('Escape');
    await createByDblClick(page, 560, 560, 'B');
    await page.keyboard.press('Escape');
    await settle(page);
    let ns = await notes(page);
    expect(ns).toHaveLength(2);
    // Ascending z: A created first (lower z), B second (higher z).
    const A = ns.find((n) => n.cx < 400)!;
    const B = ns.find((n) => n.cx >= 400)!;
    expect(A.z).toBeLessThan(B.z);
    // Grab (200,200): inside A only (not the overlap), then drag the pointer by
    // exactly (100,50) per the spec's TC-32.
    await dragNote(page, 200, 200, 100, 50);
    ns = await notes(page);
    const a2 = ns.find((n) => n.id === A.id)!;
    const b2 = ns.find((n) => n.id === B.id)!;
    // world delta = screen / zoom = (100 / 2, 50 / 2) = (50, 25)
    expect(a2.x - A.x).toBeCloseTo(50, 0);
    expect(a2.y - A.y).toBeCloseTo(25, 0);
    expect(a2.z).toBeGreaterThan(b2.z); // drawn above the overlapped note
    // and after the move their screen boxes still overlap
    expect(Math.abs(a2.cx - b2.cx)).toBeLessThan(a2.w / 2 + b2.w / 2);
    expect(Math.abs(a2.cy - b2.cy)).toBeLessThan(a2.h / 2 + b2.h / 2);
  });

  test('TC-33 text auto-fits from max down and clips with a fade', async ({ page }) => {
    await openBoard(page);
    await createByDblClick(page, 400, 400, 'Idea');
    const editor = page.getByTestId('sticky-text-editor');
    const big = parseFloat(await editor.evaluate((el) => getComputedStyle(el).fontSize));
    expect(big).toBeCloseTo(STICKY_FONT_MAX_PX, 0);
    // Paste 1,000 chars of prose through the editor (clamped to the limit).
    await page.evaluate((t) => {
      document.execCommand('insertText', false, t);
    }, LONG_TEXT_1000);
    await settle(page);
    const small = parseFloat(await editor.evaluate((el) => getComputedStyle(el).fontSize));
    expect(small).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX - 0.001);
    expect(small).toBeLessThan(big);
    await expect(page.getByTestId('note-fade')).toHaveCount(1);
    await expect(page.getByTestId('sticky-counter')).toHaveText(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  test('TC-34 the toolbar always creates a note at the screen centre', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 50000, y: 50000, zoom: 1 });
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await settle(page);
    await expect(page.getByTestId('sticky-text-editor')).toBeVisible();
    const ns = await notes(page);
    expect(ns).toHaveLength(1);
    expect(Math.abs(ns[0]!.cx - 640)).toBeLessThanOrEqual(2);
    expect(Math.abs(ns[0]!.cy - 400)).toBeLessThanOrEqual(2);
  });

  test('golden path: create, recolour, delete', async ({ page }) => {
    await openBoard(page);
    await createByDblClick(page, 400, 300, 'Faster onboarding');
    await page.keyboard.press('Escape'); // select -> note toolbar appears
    await settle(page);
    await page.getByRole('button', { name: 'Green colour' }).click();
    await settle(page);
    const green = await page
      .getByRole('group', { name: 'Sticky note' })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(green).toBe('rgb(197, 225, 165)'); // STICKY_COLORS.green

    // Add a duplicate idea at the centre and delete the first note instead.
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await page.keyboard.type('Other');
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await notes(page)).toHaveLength(2);
    // Click the green note to select it, then press Delete.
    await page.mouse.click(400, 300);
    await settle(page);
    await page.keyboard.press('Delete');
    await settle(page);
    const remaining = await notes(page);
    expect(remaining).toHaveLength(1);
    await expect(page.getByTestId('sticky-text')).toHaveText('Other');
  });
});
