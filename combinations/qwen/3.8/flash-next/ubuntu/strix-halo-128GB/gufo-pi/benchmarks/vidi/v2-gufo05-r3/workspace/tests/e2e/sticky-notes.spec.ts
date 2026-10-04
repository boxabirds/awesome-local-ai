import { expect, test } from '@playwright/test';
import {
  DRAG_THRESHOLD_PX,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_OVERFLOW_BAND_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { LONG_NOTE_1000, ONE_WORD, PASTE_1200, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';
import {
  gotoBoard,
  markerCenter,
  setCamera,
  worldTranslate,
  zoomLabelValue,
} from './helpers/board';
import {
  boxOf,
  centredCamera,
  createStickyByButton,
  dragBy,
  editor,
  editorCaret,
  getBoard,
  note,
  noteToolbar,
  notes,
  stopEditing,
} from './helpers/sticky-notes';

const CENTER = { x: 640, y: 400 };

async function waitForCentered(page: Parameters<typeof gotoBoard>[0]): Promise<void> {
  await expect
    .poll(async () => {
      const c = await markerCenter(page);
      return Math.abs(c.x - CENTER.x) < 2 && Math.abs(c.y - CENTER.y) < 2;
    })
    .toBe(true);
}

/** Set the camera and wait until the app has applied it. */
async function setCameraAndWait(
  page: Parameters<typeof setCamera>[0],
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await setCamera(page, cam);
  await expect.poll(() => zoomLabelValue(page)).toBe(Math.round(cam.zoom * 100));
  await expect
    .poll(async () => (await worldTranslate(page)).tx)
    .toBeCloseTo(-cam.x, 1);
}

async function topmostNoteAt(
  page: Parameters<typeof gotoBoard>[0],
  point: { x: number; y: number },
): Promise<string | null> {
  return page.evaluate((p) => {
    const hit = document.elementFromPoint(p.x, p.y)?.closest('[data-sticky-note]');
    return hit?.getAttribute('data-note-id') ?? null;
  }, point);
}

async function openBoard(page: Parameters<typeof gotoBoard>[0]): Promise<void> {
  await gotoBoard(page);
  await waitForCentered(page);
}

test.describe('sticky.create', () => {
  test('the Sticky note button creates one yellow note centred on the view and lets me type', async ({ page }) => {
    await openBoard(page);

    await createStickyByButton(page);

    await expect(notes(page)).toHaveCount(1);
    const board = await getBoard(page);
    expect(board).toHaveLength(1);
    expect(board[0].color).toBe('yellow');
    expect(board[0].text).toBe('');
    expect(board[0].z).toBe(1);

    // Centred on the visible area: the note's centre sits on the world origin,
    // which the camera has in the middle of the viewport.
    const box = await boxOf(note(page));
    const origin = await markerCenter(page);
    expect(Math.abs(box.cx - origin.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - origin.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - STICKY_SIZE_WORLD)).toBeLessThanOrEqual(1);

    // Ready to type straight away.
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type(SHORT_NOTE);
    expect((await getBoard(page))[0].text).toBe(SHORT_NOTE);

    await stopEditing(page);
    expect(await note(page).getAttribute('data-selected')).toBe('true');
    expect(await note(page).locator('[data-sticky-text]').textContent()).toBe(
      'Faster onboarding',
    );
  });

  test('double-clicking empty board space creates a note centred on the point', async ({ page }) => {
    await openBoard(page);

    await page.mouse.dblclick(420, 260);

    await expect(notes(page)).toHaveCount(1);
    const box = await boxOf(note(page));
    expect(Math.abs(box.cx - 420)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - 260)).toBeLessThanOrEqual(1);
    const board = await getBoard(page);
    expect(board[0].color).toBe('yellow');
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('Hello');
    expect((await getBoard(page))[0].text).toBe('Hello');
  });

  test('Enter with nothing selected does nothing', async ({ page }) => {
    await openBoard(page);

    await page.keyboard.press('Enter');
    await page.mouse.click(200, 600);
    await page.keyboard.press('Enter');

    await expect(notes(page)).toHaveCount(0);
    expect(await getBoard(page)).toHaveLength(0);
    await expect(editor(page)).toHaveCount(0);
  });

  test('each new note is placed on top of the previous one', async ({ page }) => {
    await openBoard(page);

    await createStickyByButton(page);
    await stopEditing(page);
    await page.mouse.dblclick(500, 300);
    await stopEditing(page);

    const board = await getBoard(page);
    expect(board).toHaveLength(2);
    expect(board[1].z).toBeGreaterThan(board[0].z);
    // Where the two notes overlap, the later one is on top.
    const first = await boxOf(page.locator(`[data-note-id="${board[0].id}"]`));
    const second = await boxOf(page.locator(`[data-note-id="${board[1].id}"]`));
    const probeX = Math.max(first.x, second.x) + 10;
    const probeY = Math.min(first.bottom, second.bottom) - 10;
    expect(probeX).toBeLessThan(Math.min(first.right, second.right));
    expect(probeY).toBeGreaterThan(Math.max(first.y, second.y));
    const topId = await page.evaluate((p) => {
      const hit = document.elementFromPoint(p.x, p.y)?.closest('[data-sticky-note]');
      return hit?.getAttribute('data-note-id') ?? null;
    }, { x: probeX, y: probeY });
    expect(topId).toBe(board[1].id);
  });
});

test.describe('sticky.drag_no_pan', () => {
  test('at 100% a note drag moves the note by exactly the gesture and leaves the camera alone', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);

    const before = (await getBoard(page))[0];
    const originBefore = await markerCenter(page);
    const cameraBefore = await worldTranslate(page);
    const zoomBefore = await zoomLabelValue(page);

    const start = await boxOf(note(page));
    await dragBy(page, { x: start.cx, y: start.cy }, 60, 25);

    const after = (await getBoard(page))[0];
    expect(after.x).toBeCloseTo(before.x + 60, 0);
    expect(after.y).toBeCloseTo(before.y + 25, 0);
    // The board itself did not move.
    expect(await markerCenter(page)).toEqual(originBefore);
    expect(await worldTranslate(page)).toEqual(cameraBefore);
    expect(await zoomLabelValue(page)).toBe(zoomBefore);
    // The dragged note stays selected.
    expect(await note(page).getAttribute('data-selected')).toBe('true');
  });

  test('at 50% the same gesture moves the note twice as far in board units', async ({ page }) => {
    await openBoard(page);
    await setCameraAndWait(page, centredCamera(0.5));
    await createStickyByButton(page);
    await stopEditing(page);

    const before = (await getBoard(page))[0];
    const originBefore = await markerCenter(page);
    const start = await boxOf(note(page));
    await dragBy(page, { x: start.cx, y: start.cy }, 60, 25);

    const after = (await getBoard(page))[0];
    expect(after.x).toBeCloseTo(before.x + 60 / 0.5, 0);
    expect(after.y).toBeCloseTo(before.y + 25 / 0.5, 0);
    expect(await markerCenter(page)).toEqual(originBefore);
    // The point that was grabbed is still under the pointer: the note's screen
    // box moved by exactly the gesture.
    const moved = await boxOf(note(page));
    expect(Math.abs(moved.x - (start.x + 60))).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - (start.y + 25))).toBeLessThanOrEqual(1);
  });

  test('a press shorter than the drag threshold selects instead of moving', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);
    // Deselect first, so the press has to be what selects it.
    await page.mouse.click(200, 700);
    await expect(note(page)).toHaveAttribute('data-selected', 'false');

    const before = (await getBoard(page))[0];
    const start = await boxOf(note(page));
    await dragBy(page, { x: start.cx, y: start.cy }, DRAG_THRESHOLD_PX - 1, 0);

    const after = (await getBoard(page))[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(await note(page).getAttribute('data-selected')).toBe('true');
  });

  test('dragging the board background pans the camera and leaves the note where it was', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);
    await page.mouse.click(200, 700); // clear selection

    const before = (await getBoard(page))[0];
    const originBefore = await markerCenter(page);

    await dragBy(page, { x: 300, y: 620 }, -120, 90);

    const after = (await getBoard(page))[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    const originAfter = await markerCenter(page);
    expect(Math.abs(originAfter.x - (originBefore.x - 120))).toBeLessThanOrEqual(1);
    expect(Math.abs(originAfter.y - (originBefore.y + 90))).toBeLessThanOrEqual(1);
  });

  test('a dragged note keeps its position while the board is panned and zoomed', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);

    const start = await boxOf(note(page));
    await dragBy(page, { x: start.cx, y: start.cy }, 140, -60);
    const moved = (await getBoard(page))[0];

    await dragBy(page, { x: 200, y: 650 }, 90, 40);
    await page.getByRole('button', { name: 'Zoom in' }).click();

    const settled = (await getBoard(page))[0];
    expect(settled.x).toBe(moved.x);
    expect(settled.y).toBe(moved.y);

    // And it still renders where the camera math says it should.
    const zoom = (await zoomLabelValue(page)) / 100;
    const camera = await worldTranslate(page);
    const expectedScreenX = (settled.x + camera.tx) * zoom;
    const expectedScreenY = (settled.y + camera.ty) * zoom;
    const box = await boxOf(note(page));
    expect(Math.abs(box.x - expectedScreenX)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - expectedScreenY)).toBeLessThanOrEqual(1);
  });
});

test.describe('sticky.drag_no_pan', () => {
  test('at 200% the gesture moves the note half as far in board units and lifts it above the note it overlaps', async ({ page }) => {
    await openBoard(page);
    await setCameraAndWait(page, centredCamera(2));

    // Note A in the middle, note B overlapping it towards the bottom right.
    await createStickyByButton(page);
    await stopEditing(page);
    // B is created outside A but overlapping it towards the bottom right.
    await page.mouse.dblclick(900, 650);
    await stopEditing(page);
    const [a, b] = await getBoard(page);
    expect(b).toBeDefined();
    const probe = { x: 760, y: 520 }; // inside both notes
    expect(await topmostNoteAt(page, probe)).toBe(b.id);

    // Grab A where it is still exposed and drag it over B.
    const aBox = await boxOf(page.locator(`[data-note-id="${a.id}"]`));
    expect(aBox.x + 30).toBeLessThan(700);
    await dragBy(page, { x: aBox.x + 30, y: 300 }, 100, 50);

    // The snapshot is ordered by z, and A now has the highest z: look it up by id.
    const movedA = (await getBoard(page)).find((n) => n.id === a.id);
    expect(movedA).toBeDefined();
    expect(movedA!.x).toBeCloseTo(a.x + 100 / 2, 0);
    expect(movedA!.y).toBeCloseTo(a.y + 50 / 2, 0);
    // Dragged notes come to the front of the pile.
    expect(await topmostNoteAt(page, probe)).toBe(a.id);
  });
});

test.describe('sticky.create_when_panned', () => {
  test('creating while panned far away still puts the note in the middle of the screen', async ({ page }) => {
    await openBoard(page);
    const far = { x: 42000, y: -28000, zoom: 1 };
    await setCameraAndWait(page, far);
    const origin = await markerCenter(page);
    expect(origin.x).toBeLessThan(-40000);

    await createStickyByButton(page);

    const box = await boxOf(note(page));
    expect(Math.abs(box.cx - CENTER.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.cy - CENTER.y)).toBeLessThanOrEqual(1);
    const created = (await getBoard(page))[0];
    expect(created.x + STICKY_SIZE_WORLD / 2).toBeCloseTo(far.x + CENTER.x, 0);
    expect(created.y + STICKY_SIZE_WORLD / 2).toBeCloseTo(far.y + CENTER.y, 0);
  });
});

test.describe('sticky.text', () => {
  test('three lines are kept, and a 1,200 character paste is cut to 1,000', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);

    await page.keyboard.type(RETRO_ITEM);
    expect((await getBoard(page))[0].text).toBe(RETRO_ITEM);
    // While editing, the display layer is gone (no double paint).
    await expect(note(page).locator('[data-sticky-text]')).toHaveCount(0);

    // One big paste: only the first 1,000 characters are kept, the caret ends
    // up after them and the counter reads the limit.
    await page.keyboard.insertText(PASTE_1200);
    const board = (await getBoard(page))[0];
    const expected = (RETRO_ITEM + PASTE_1200).slice(0, STICKY_TEXT_MAX_CHARS);
    expect(board.text).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(board.text).toBe(expected);
    const caret = await editorCaret(page);
    expect(caret.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(caret.start).toBe(STICKY_TEXT_MAX_CHARS);
    expect(await page.locator('[data-sticky-counter]').textContent()).toBe('1000/1000');

    // Typing more adds nothing.
    await page.keyboard.type('xyz');
    expect((await getBoard(page))[0].text).toHaveLength(STICKY_TEXT_MAX_CHARS);
  });

  test('Backspace while editing edits text and never deletes the note', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await page.keyboard.type('ab');
    expect((await getBoard(page))[0].text).toBe('ab');

    await page.keyboard.press('Backspace');

    expect(await getBoard(page)).toHaveLength(1);
    expect((await getBoard(page))[0].text).toBe('a');
    await expect(editor(page)).toBeVisible();
  });

  test('Delete on a selected (not edited) note removes it', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await page.keyboard.type('gone soon');
    await stopEditing(page);
    await expect(note(page)).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('Delete');

    await expect(notes(page)).toHaveCount(0);
    expect(await getBoard(page)).toHaveLength(0);
    await expect(noteToolbar(page)).toHaveCount(0);
  });

  test('Escape keeps what I typed and leaves the note selected', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await page.keyboard.type('kept text');
    await stopEditing(page);

    expect((await getBoard(page))[0].text).toBe('kept text');
    expect(await note(page).getAttribute('data-selected')).toBe('true');
    expect(await note(page).locator('[data-sticky-text]').textContent()).toBe('kept text');
  });

  test('clicking the board while editing keeps the text and drops the selection', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await page.keyboard.type('clicked outside');

    await page.mouse.click(1100, 120);

    await expect(editor(page)).toHaveCount(0);
    expect((await getBoard(page))[0].text).toBe('clicked outside');
    expect(await note(page).getAttribute('data-selected')).toBe('false');
  });
});

test.describe('sticky.counter_layout', () => {
  test('1,000 characters: the counter sits inside the note, the overflow fades out, the font stays in range', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await page.keyboard.insertText(LONG_NOTE_1000);
    await expect(page.locator('[data-sticky-counter]')).toBeVisible();

    const noteBox = await boxOf(note(page));
    const counter = await boxOf(page.locator('[data-sticky-counter]'));
    // Inside the note bounds with at least 8px of margin.
    expect(counter.right).toBeLessThanOrEqual(noteBox.right - 8 + 0.5);
    expect(counter.bottom).toBeLessThanOrEqual(noteBox.bottom - 8 + 0.5);
    expect(counter.x).toBeGreaterThanOrEqual(noteBox.x + 8);
    expect(counter.y).toBeGreaterThanOrEqual(noteBox.y + 8);

    // The text does not fit at the smallest size: overflow is clipped and the
    // fade band marks it.
    expect(await note(page).getAttribute('data-overflow')).toBe('true');
    const fade = await boxOf(page.locator('[data-sticky-fade]'));
    expect(Math.abs(fade.height - STICKY_OVERFLOW_BAND_PX)).toBeLessThanOrEqual(1);
    expect(Math.abs(fade.width - noteBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(fade.bottom - noteBox.bottom)).toBeLessThanOrEqual(1);

    await stopEditing(page);
    const fontSize = await note(page)
      .locator('[data-sticky-text]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(fontSize).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);
    // Nothing spills outside the note.
    const text = await note(page).locator('[data-sticky-text]').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflow: getComputedStyle(el).overflow,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    });
    expect(text.overflow).toBe('hidden');
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight);
    // Nothing is rendered outside the note box.
    expect(text.top).toBeGreaterThanOrEqual(noteBox.y - 0.5);
    expect(text.bottom).toBeLessThanOrEqual(noteBox.bottom + 0.5);
    expect(text.left).toBeGreaterThanOrEqual(noteBox.x - 0.5);
    expect(text.right).toBeLessThanOrEqual(noteBox.right + 0.5);
  });

  test('the counter only appears within 50 characters of the limit', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);

    await page.keyboard.insertText('x'.repeat(949));
    await expect(page.locator('[data-sticky-counter]')).toHaveCount(0);
    await page.keyboard.insertText('y');
    await expect(page.locator('[data-sticky-counter]')).toHaveText('950/1000');
  });

  test('short text is centred, auto-fitted to the largest size and shows no placeholder', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);

    // An empty note shows nothing but the note itself.
    expect(await note(page).locator('[data-sticky-text]').textContent()).toBe('');
    expect(await note(page).getAttribute('data-overflow')).toBe('false');

    await note(page).dblclick();
    await page.keyboard.type(ONE_WORD);
    await stopEditing(page);

    // The glyphs themselves are centred horizontally in the note.
    const box = await boxOf(note(page));
    const glyphs = await note(page)
      .locator('[data-sticky-text]')
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = range.getBoundingClientRect();
        return { cx: rect.x + rect.width / 2, width: rect.width };
      });
    expect(Math.abs(glyphs.cx - box.cx)).toBeLessThanOrEqual(1);
    expect(glyphs.width).toBeGreaterThan(10);
    const fontSize = await note(page)
      .locator('[data-sticky-text]')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBe(STICKY_FONT_MAX_PX);
  });
});

test.describe('sticky.toolbar_layout', () => {
  test('the note toolbar keeps its screen size at 100% and 50%, centred above the note', async ({ page }) => {
    await openBoard(page);

    const measurements: Array<Record<string, number>> = [];
    for (const zoom of [1, 0.5]) {
      await setCameraAndWait(page, centredCamera(zoom));
      await createStickyByButton(page);
      await stopEditing(page);
      await expect(noteToolbar(page)).toBeVisible();

      const toolbar = await boxOf(noteToolbar(page));
      const swatch = await boxOf(page.locator('[data-swatch="green"]'));
      const noteBox = await boxOf(note(page));
      measurements.push({
        width: toolbar.width,
        height: toolbar.height,
        swatch: swatch.width,
        toolbarCx: toolbar.cx,
        noteCx: noteBox.cx,
        gap: noteBox.y - toolbar.bottom,
      });
      expect(Math.abs(swatch.width - swatch.height)).toBeLessThanOrEqual(1);
      // Above the note, not over it.
      expect(toolbar.bottom).toBeLessThanOrEqual(noteBox.y + 1);
      // Centred on the note.
      expect(Math.abs(toolbar.cx - noteBox.cx)).toBeLessThanOrEqual(1);
      // Colour and delete are reachable at this zoom.
      await page.getByRole('button', { name: 'Green colour' }).click();
      expect((await getBoard(page))[0].color).toBe('green');
      expect(await note(page).getAttribute('data-selected')).toBe('true');
      await page.keyboard.press('Delete');
      await expect(notes(page)).toHaveCount(0);
    }

    const [at100, at50] = measurements;
    expect(Math.abs(at100.width - at50.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(at100.height - at50.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(at100.swatch - at50.swatch)).toBeLessThanOrEqual(1);
    // The gap between toolbar and note is in board units, so on screen it halves
    // with the zoom; both must still be non-negative (above the note).
    expect(at100.gap).toBeGreaterThanOrEqual(0);
    expect(at50.gap).toBeGreaterThanOrEqual(0);
    expect(at50.gap).toBeLessThan(at100.gap);
    expect(Math.abs(at100.toolbarCx - at100.noteCx)).toBeLessThanOrEqual(1);
    expect(Math.abs(at50.toolbarCx - at50.noteCx)).toBeLessThanOrEqual(1);
  });

  test('swatches and the bin are labelled, keyboard reachable and show a tooltip', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);

    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      const swatch = page.getByRole('button', { name: `${name} colour` });
      await expect(swatch).toHaveAttribute('title', `${name} colour`);
    }
    const del = page.getByRole('button', { name: 'Delete note' });
    await expect(del).toHaveAttribute('title', 'Delete note');

    // Keyboard only: focus a swatch and press Enter.
    await page.getByRole('button', { name: 'Violet colour' }).focus();
    await page.keyboard.press('Enter');
    expect((await getBoard(page))[0].color).toBe('violet');

    const stickyButton = page.getByRole('button', { name: 'Sticky note' });
    await expect(stickyButton).toHaveAttribute(
      'title',
      'Sticky note \u2013 or double-click the board',
    );
  });

  test('using the note toolbar does not start a pan or clear the selection', async ({ page }) => {
    await openBoard(page);
    await createStickyByButton(page);
    await stopEditing(page);
    const cameraBefore = await worldTranslate(page);

    await page.getByRole('button', { name: 'Pink colour' }).click();

    expect(await note(page).getAttribute('data-selected')).toBe('true');
    expect(await worldTranslate(page)).toEqual(cameraBefore);
    expect(await note(page).getAttribute('data-overflow')).toBe('false');
  });
});
