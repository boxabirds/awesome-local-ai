import { expect, test, type Page } from '@playwright/test';
import {
  dragBy,
  getNotes,
  noteLocator,
  setCamera,
  typeIntoEditor,
  worldToViewport,
  type ViewportPoint
} from './helpers/board';
import { PROSE_1000 } from '../fixtures/texts';

const CENTRE: ViewportPoint = { x: 640, y: 400 };

async function createNoteByDoubleClick(page: Page, at: ViewportPoint): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();
  const notes = await getNotes(page);
  if (notes.length === 0) throw new Error('note was not created');
  return notes[notes.length - 1].id;
}

function near(actual: number, expected: number, tolerance = 1): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

test.describe('sticky note workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board-viewport')).toBeVisible();
  });

  test('TC-30 double-click creates a centred note, type, recolour, delete', async ({
    page
  }) => {
    const id = await createNoteByDoubleClick(page, { x: 400, y: 300 });
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id, text: 'Hello' });
    // Creation point (400,300) with the default camera: world centre (400-640, 300-400).
    expect(near(notes[0].x, -240 - 100)).toBe(true);
    expect(near(notes[0].y, -100 - 100)).toBe(true);

    const box = await noteLocator(page, id).boundingBox();
    expect(box).not.toBeNull();
    expect(near(box!.x + box!.width / 2, 400)).toBe(true);
    expect(near(box!.y + box!.height / 2, 300)).toBe(true);

    await page.getByRole('button', { name: 'Pink colour' }).click();
    expect((await getNotes(page))[0].color).toBe('pink');

    // Click the note to make sure it is selected, then delete via the key.
    await page.mouse.click(400, 300);
    await page.keyboard.press('Delete');
    expect(await getNotes(page)).toHaveLength(0);
  });

  test('TC-31 at 50% zoom a drag keeps the grabbed point under the pointer (+200,+100 world)', async ({
    page
  }) => {
    const cam = { x: -1280, y: -800, zoom: 0.5 };
    await setCamera(page, cam);
    const id = await createNoteByDoubleClick(page, CENTRE);
    await page.keyboard.press('Escape');
    // Escape leaves it selected; clear first, then grab the note centre.
    await page.mouse.click(50, 700);

    await dragBy(page, CENTRE, 100, 50);
    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    expect(near(notes[0].x, -100 + 200)).toBe(true);
    expect(near(notes[0].y, -100 + 100)).toBe(true);

    const box = await noteLocator(page, id).boundingBox();
    expect(box).not.toBeNull();
    expect(near(box!.x + box!.width / 2, CENTRE.x + 100)).toBe(true);
    expect(near(box!.y + box!.height / 2, CENTRE.y + 50)).toBe(true);

    await page.getByRole('button', { name: 'Blue colour' }).click();
    expect((await getNotes(page))[0].color).toBe('blue');

    await page.keyboard.press('Delete');
    expect(await getNotes(page)).toHaveLength(0);
  });

  test('TC-32 at 200% zoom a drag moves +50,+25 world and brings the note above an overlap', async ({
    page
  }) => {
    const cam = { x: -320, y: -200, zoom: 2 };
    await setCamera(page, cam);
    const aId = await createNoteByDoubleClick(page, CENTRE);
    await page.keyboard.press('Escape');
    // Created on empty screen space but overlapping note A in world space.
    const bId = await createNoteByDoubleClick(page, { x: 900, y: 550 });
    await page.keyboard.press('Escape');
    await page.mouse.click(50, 700);

    // Drag the lower note A over B; bringToFront must raise it.
    await dragBy(page, CENTRE, 100, 50);
    const notes = await getNotes(page);
    const a = notes.find((n) => n.id === aId)!;
    const b = notes.find((n) => n.id === bId)!;
    expect(near(a.x, -100 + 50)).toBe(true);
    expect(near(a.y, -100 + 25)).toBe(true);
    expect(near(b.x, 30)).toBe(true);
    expect(near(b.y, -25)).toBe(true);
    expect(a.z).toBeGreaterThan(b.z);

    // A point inside both notes must hit the dragged note's DOM.
    const grab = worldToViewport(cam, { x: 100, y: 0 });
    const hitId = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid="sticky-note"]')?.getAttribute('data-id') ?? null;
      },
      [grab.x, grab.y]
    );
    expect(hitId).toBe(aId);
  });

  test('TC-33 one word uses the max font size; 1,000-char prose shrinks with overflow fade', async ({
    page
  }) => {
    const id = await createNoteByDoubleClick(page, CENTRE);
    await page.keyboard.type('Idea');
    await page.keyboard.press('Escape');
    const note = noteLocator(page, id);
    const inner = note.locator('.sticky-note-text-inner');
    await expect(inner).toHaveCSS('font-size', '24px');

    await page.mouse.dblclick(CENTRE.x, CENTRE.y);
    await typeIntoEditor(page, PROSE_1000);
    await page.keyboard.press('Escape');

    const fontPx = await inner.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontPx).toBeGreaterThanOrEqual(10);
    expect(fontPx).toBeLessThan(24);
    await expect(note).toHaveClass(/sticky-note--overflow/);
    const fade = await note.evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
    expect(fade).toContain('linear-gradient');

    // Nothing renders outside the note box: the clipped container covers the
    // note exactly and hides any overflow, so the fade (above) is the only cue.
    const noteBox = (await note.boundingBox())!;
    const clipBox = (await note.locator('.sticky-note-text').boundingBox())!;
    expect(Math.abs(clipBox.x - noteBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(clipBox.y - noteBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(clipBox.width - noteBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(clipBox.height - noteBox.height)).toBeLessThanOrEqual(1);
    const clip = await note.locator('.sticky-note-text').evaluate((el) => {
      const s = getComputedStyle(el);
      return { overflow: s.overflowX + '/' + s.overflowY, scrolled: el.scrollHeight };
    });
    expect(clip.overflow).toBe('hidden/hidden');
  });

  test('TC-34 after panning far away, the Sticky note button places a note at the screen centre', async ({
    page
  }) => {
    const cam = { x: -50000, y: -30000, zoom: 1 };
    await setCamera(page, cam);
    await page.getByRole('button', { name: 'Sticky note' }).click();
    await expect(page.locator('[data-testid="sticky-textarea"]')).toBeVisible();

    const notes = await getNotes(page);
    expect(notes).toHaveLength(1);
    // World centre = screen centre in world space = (640 + x, 400 + y).
    expect(notes[0].x).toBeCloseTo(640 + cam.x - 100, 1);
    expect(notes[0].y).toBeCloseTo(400 + cam.y - 100, 1);

    const box = await noteLocator(page, notes[0].id).boundingBox();
    expect(box).not.toBeNull();
    expect(near(box!.x + box!.width / 2, 640)).toBe(true);
    expect(near(box!.y + box!.height / 2, 400)).toBe(true);
  });
});
