import { expect, test } from '@playwright/test';
import {
  STICKY_FONT_MAX_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { THOUSAND_CHARS } from '../fixtures/texts';
import { gotoBoard } from './helpers/board';
import {
  cameraCenteringOrigin,
  COLOR_RGB,
  counterFor,
  createByDblClick,
  createByToolbar,
  dragNote,
  editorBox,
  endEditing,
  fadeFor,
  noteBackground,
  noteSelected,
  noteTextContent,
  noteWorldPos,
  setCamera,
  stickyIds,
  typeText,
  viewportCenter,
} from './helpers/sticky';

function editorValueLength(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector('textarea[aria-label="Sticky note text"]') as
        | HTMLTextAreaElement
        | null)?.value.length ?? -1,
  );
}

function editorFontSize(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(
      'textarea[aria-label="Sticky note text"]',
    ) as HTMLElement | null;
    return el ? parseFloat(getComputedStyle(el).fontSize) : -1;
  });
}

test.describe('sticky workflow: create, type, rearrange', () => {
  test('TC-39 create, type and rearrange; two double-clicks make two notes', async ({
    page,
  }) => {
    await gotoBoard(page);
    const c = viewportCenter(page);

    const a = await createByDblClick(page, c.x - 200, c.y);
    await typeText(page, 'Retro item');
    await endEditing(page);
    expect(await noteTextContent(page, a)).toBe('Retro item');

    // A separate double-click creates a second, distinct note.
    const b = await createByDblClick(page, c.x + 200, c.y);
    expect(b).not.toBe(a);
    expect((await stickyIds(page)).length).toBe(2);

    await endEditing(page); // finish editing b

    const before = await noteWorldPos(page, a);
    const bBefore = await noteWorldPos(page, b);
    await dragNote(page, a, 60, 40); // screen delta at zoom 1 == world delta
    const after = await noteWorldPos(page, a);
    const bAfter = await noteWorldPos(page, b);

    expect(Math.abs(after.x - (before.x + 60))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - (before.y + 40))).toBeLessThanOrEqual(1);
    expect(bAfter).toEqual(bBefore); // the other note did not move
    expect(await noteTextContent(page, a)).toBe('Retro item');
  });

  test('TC-40 dragging a note at 200% moves it by delta/zoom in world space', async ({
    page,
  }) => {
    await gotoBoard(page);
    const zoom = 2;
    await setCamera(page, cameraCenteringOrigin(page, zoom));
    const c = viewportCenter(page);

    const id = await createByDblClick(page, c.x, c.y);
    await endEditing(page);

    const before = await noteWorldPos(page, id);
    await dragNote(page, id, 100, 0); // screen delta
    const after = await noteWorldPos(page, id);

    // World delta = screen delta / zoom == 50.
    expect(Math.abs(after.x - (before.x + 100 / zoom))).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  });
});

test.describe('sticky workflow: recolour and delete', () => {
  test('TC-41 recolouring from the note toolbar sets the note colour', async ({
    page,
  }) => {
    await gotoBoard(page);
    const id = await createByToolbar(page);
    await endEditing(page);
    expect(await noteSelected(page, id)).toBe(true);

    await page.getByRole('button', { name: 'Blue colour' }).click();

    expect(await noteBackground(page, id)).toBe(COLOR_RGB.blue);
  });

  test('TC-42 the bin button deletes the selected note', async ({ page }) => {
    await gotoBoard(page);
    const id = await createByToolbar(page);
    await endEditing(page);
    expect((await stickyIds(page)).length).toBe(1);

    await page.getByRole('button', { name: 'Delete note' }).click();

    await expect
      .poll(async () => (await stickyIds(page)).includes(id))
      .toBe(false);
  });

  test('TC-42b Escape then Delete removes a just-created note', async ({
    page,
  }) => {
    await gotoBoard(page);
    const id = await createByToolbar(page); // starts editing
    await page.keyboard.press('Escape'); // ends editing, keeps selected
    expect(await noteSelected(page, id)).toBe(true);

    await page.keyboard.press('Delete');

    await expect
      .poll(async () => (await stickyIds(page)).length)
      .toBe(0);
  });
});

test.describe('sticky workflow: long text', () => {
  test('TC-43 a full note shows a fade, a 1000/1000 counter and a smaller font', async ({
    page,
  }) => {
    await gotoBoard(page);
    await createByToolbar(page);
    await typeText(page, THOUSAND_CHARS);

    await expect(counterFor(page)).toHaveText('1000/1000');
    await expect(fadeFor(page)).toHaveCount(1);
    const font = await editorFontSize(page);
    expect(font).toBeGreaterThan(0);
    expect(font).toBeLessThan(STICKY_FONT_MAX_PX);
  });

  test('TC-44 typing past the limit is clamped; one backspace frees a character', async ({
    page,
  }) => {
    await gotoBoard(page);
    await createByToolbar(page);
    await typeText(page, THOUSAND_CHARS);
    await expect(counterFor(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    // One more character is refused: still at the limit.
    await typeText(page, 'x');
    expect(await editorValueLength(page)).toBe(STICKY_TEXT_MAX_CHARS);
    await expect(counterFor(page)).toHaveText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);

    // Deleting one character frees one from the limit.
    await editorBox(page).focus();
    await page.keyboard.press('Backspace');
    expect(await editorValueLength(page)).toBe(STICKY_TEXT_MAX_CHARS - 1);
    await expect(counterFor(page)).toHaveText(
      `${STICKY_TEXT_MAX_CHARS - 1}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });
});
