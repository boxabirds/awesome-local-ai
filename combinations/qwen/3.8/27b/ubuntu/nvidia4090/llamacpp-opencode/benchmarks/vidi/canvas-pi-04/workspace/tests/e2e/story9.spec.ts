// Story 9, e2e (TC-26..TC-31): long annotations, rewrapping on a width drag,
// headings (create/size/move/delete/undo), concurrent editing, full-capacity
// heading creation and abandoned text. Runs against `wrangler dev` (chromium;
// TC-26 also in firefox/webkit).

import { expect, test } from '@playwright/test';
import {
  newBoard,
  openParticipant,
  closeParticipant,
  type Participant,
} from './participants';
import {
  seedNotes,
  parkCamera,
  expectNoteCount,
  marqueeDrag,
  dragHandle,
} from './helpers/story7';
import {
  TEXT_OBJECT,
  createTextAt,
  typeInEditor,
  fillEditor,
  endTextEdit,
  expectTextCount,
  textWorld,
  textContents,
  containsAllChars,
} from './helpers/story9';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

// Camera with the origin at the viewport origin (world = screen, 1280x800).
const ZOOM1 = { x: 0, y: 0, zoom: 1 };

// The 300-character fixture (TC-26): one line, longer than the max auto
// width, so the stored box clamps to TEXT_MAX_AUTO_WIDTH_WORLD and wraps.
const LONG_ANNOTATION =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure in reprehenderit voluptate velit esse cillum dolore ';

test.describe('story 9 e2e (TC-26..TC-31)', () => {
  test('TC-26: a 300-character annotation stores a 600-wide wrapped box', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await parkCamera(page, ZOOM1);

    await createTextAt(page, ZOOM1, 100, 300);
    // fill() is one deterministic input event (pressSequentially can drop
    // keys under load); TC-26 is about the stored box, not the typing path.
    await fillEditor(page, LONG_ANNOTATION);
    await endTextEdit(page);
    await expectTextCount(page, 1);

    const box = await textWorld(page);
    expect(box.w).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);
    expect(box.w).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    // Several rendered lines: more than two line-heights at M (2 * 26 = 52).
    expect(box.h).toBeGreaterThan(52);

    expect(await textContents(page)).toEqual([LONG_ANNOTATION]);
  });

  test('TC-27: dragging the right handle narrower rewraps; no top/bottom handles', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await parkCamera(page, ZOOM1);

    await createTextAt(page, ZOOM1, 100, 300);
    await fillEditor(page, LONG_ANNOTATION);
    await endTextEdit(page);
    const before = await textWorld(page);
    expect(before.w).toBeGreaterThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD - 2);

    // Drag the east handle 200 world units to the left: width 600 -> 400.
    await dragHandle(page, 'e', -200, 0, ZOOM1.zoom);
    const after = await textWorld(page);
    expect(after.w).toBeGreaterThanOrEqual(before.w - 200 - 2);
    expect(after.w).toBeLessThanOrEqual(before.w - 200 + 2);
    // The same words in a narrower box take more lines.
    expect(after.h).toBeGreaterThan(before.h);

    // A single text shows the horizontal handles only.
    await expect(page.locator('[aria-label="Resize e"]')).toBeVisible();
    await expect(page.locator('[aria-label="Resize w"]')).toBeVisible();
    for (const h of ['nw', 'n', 'ne', 'se', 's', 'sw']) {
      await expect(page.locator(`[aria-label="Resize ${h}"]`)).toHaveCount(0);
    }
  });

  test('TC-28: a heading - create, XL, move over the cluster, delete, undo', async ({ page, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    await seedNotes(baseURL!, boardId, 4);
    await page.goto(`/b/${boardId}`);
    await expectNoteCount(page, 4);
    // Shifted down 100: the heading (world y = 0) and its toolbar above it
    // stay on-screen, and the seeded row (world y = 40) renders below it.
    const cam = { x: 0, y: -100, zoom: 1 };
    await parkCamera(page, cam);

    // Click above the cluster (the seeded row starts at y = 40).
    await createTextAt(page, cam, 100, 0);
    await fillEditor(page, 'Went well');
    await endTextEdit(page);
    await expectTextCount(page, 1);
    expect(await textContents(page)).toEqual(['Went well']);

    // XL: the font grows and the box re-measures at the same top-left.
    await page.getByLabel('Text size XL').click();
    const xl = await textWorld(page);
    expect(xl.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(xl.x).toBeCloseTo(100, 0);
    expect(xl.y).toBeCloseTo(0, 0);

    // Drag the heading over the cluster: press 10px into its box, release at
    // world (350, 120) -> the text lands at (100 + 340, 0 + 220) minus the
    // 10px press offset = (340, 110).
    const vp = page.locator('[data-testid="board-viewport"]');
    const vpBox = (await vp.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const el = page.locator(TEXT_OBJECT);
    const box = (await el.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(vpBox.x + 350, vpBox.y + 120 - cam.y, { steps: 16 });
    await page.mouse.up();
    const moved = await textWorld(page);
    expect(moved.x).toBeCloseTo(340, -1);
    expect(moved.y).toBeCloseTo(110, -1);

    // Delete removes it...
    await page.keyboard.press('Delete');
    await expectTextCount(page, 0);

    // ...and one undo restores it (at the moved position, still XL).
    await page.keyboard.press('Control+z');
    await expectTextCount(page, 1);
    const restored = await textWorld(page);
    expect(restored.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    expect(restored.x).toBeCloseTo(moved.x, -1);
    expect(restored.y).toBeCloseTo(moved.y, -1);
    expect(await textContents(page)).toEqual(['Went well']);
  });

  test('TC-29: two peers typing into the same text keep every character', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const lee = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await parkCamera(lee.page, ZOOM1);
      await createTextAt(lee.page, ZOOM1, 200, 300);

      // Sam sees the text appear and starts editing the SAME object.
      await parkCamera(sam.page, ZOOM1);
      await expectTextCount(sam.page, 1);
      await sam.page.locator(TEXT_OBJECT).dblclick();

      // Simultaneous inserts into the shared Y.Text.
      await Promise.all([
        typeInEditor(lee.page, 'Hello'),
        typeInEditor(sam.page, ' World!'),
      ]);
      await Promise.all([endTextEdit(lee.page), endTextEdit(sam.page)]);

      // Both screens converge on the same text containing every character.
      await expect
        .poll(
          async () => {
            const a = await textContents(lee.page);
            const b = await textContents(sam.page);
            return (
              a.length === 1 &&
              b.length === 1 &&
              a[0] === b[0] &&
              containsAllChars(a[0], 'Hello World!')
            );
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      const [text] = await textContents(lee.page);
      expect(text).toBeTruthy();
      expect(containsAllChars(text, 'Hello World!')).toBe(true);
    } finally {
      await closeParticipant(lee);
      await closeParticipant(sam);
    }
  });

  test('TC-30: all concurrent editors create headings; every screen shows all', async ({ browser, baseURL }) => {
    test.slow();
    const boardId = await newBoard(baseURL!);
    const participants: Participant[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      participants.push(await openParticipant(browser, boardId));
    }
    try {
      // Staggered empty spots (well clear of each other's boxes).
      const spots = [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 700, y: 100 },
        { x: 100, y: 400 },
        { x: 400, y: 400 },
      ];
      // Every context creates its heading at once. fill() is one
      // deterministic input event (no per-key races under parallel load).
      await Promise.all(
        participants.map(async (p, i) => {
          await parkCamera(p.page, ZOOM1);
          await createTextAt(p.page, ZOOM1, spots[i].x, spots[i].y);
          await fillEditor(p.page, `Heading ${i + 1}`);
          await endTextEdit(p.page);
        }),
      );

      // Content syncs a beat after the objects' metadata (5 peers); poll each
      // screen until every heading is present, rather than one-shot reading.
      const expected = Array.from(
        { length: MAX_CONCURRENT_EDITORS },
        (_, i) => `Heading ${i + 1}`,
      ).sort();
      for (const p of participants) {
        await expectTextCount(p.page, MAX_CONCURRENT_EDITORS);
        await expect
          .poll(
            async () => (await textContents(p.page)).filter(Boolean).sort(),
            { timeout: 20_000 },
          )
          .toEqual(expected);
      }
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });

  test('TC-31: abandoning a new text leaves no object behind', async ({ page, baseURL }) => {
    const boardId = await newBoard(baseURL!);
    await page.goto(`/b/${boardId}`);
    await parkCamera(page, ZOOM1);

    // T, click, Escape without typing: the empty text is removed.
    await createTextAt(page, ZOOM1, 500, 400);
    await endTextEdit(page);
    await expectTextCount(page, 0);

    // A marquee over the spot selects nothing.
    await marqueeDrag(page, ZOOM1, 460, 370, 660, 470);
    expect(await page.locator('[data-selected]').count()).toBe(0);
    await expect(page.locator('.selection-bar')).toHaveCount(0);
  });
});
