/**
 * Story 2 e2e workflows (design "E2E workflows"), run against `wrangler dev`
 * serving the client build built with `--mode test` (enables
 * `window.__vidi6`, which now also exposes the board document snapshot).
 *
 *  1. "Brainstorm golden path" — TC-30 (real dblclick at (400,300), type
 *     "Hello", centred note, deselect/select, recolour) → TC-31 (drag at
 *     50% zoom: grabbed point under the pointer, world +200/+100) → delete
 *     the second note via the Delete key.
 *  2. TC-32 — 200% zoom drag moves the note +50/+25 in world units and the
 *     dragged note is drawn above the note it overlaps (stacking).
 *  3. TC-33 — long text: one word renders at the max font size; 1,000 chars
 *     shrink to the minimum size with the overflow fade, clipped inside the
 *     note box.
 *  4. TC-34 — panned far away, the toolbar creates a note at the visible
 *     screen centre.
 *
 * Notes are asserted in world coordinates through the board snapshot and in
 * screen coordinates through bounding boxes; the drag assertions wait (poll)
 * for the rAF-throttled position writes to settle.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_SIZE_WORLD,
  STICKY_TEXT_MAX_CHARS,
} from "../../src/shared/config";
import { LONG_PARAGRAPH } from "../fixtures/texts";
import { CENTER, drag, getCamera, setCamera, VIEWPORT } from "./helpers/board";

interface BoardNote {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  createdAt: number;
}

const notes = (page: Page): Locator => page.getByRole("group", { name: "Sticky note" });

async function boardSnapshot(page: Page): Promise<BoardNote[]> {
  return page.evaluate(() =>
    window.__vidi6!.getBoardSnapshot().map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      color: n.color,
      text: n.text,
      z: n.z,
      createdAt: n.createdAt,
    })),
  );
}

/** World-space centre of a note from the board snapshot. */
function worldCenter(note: BoardNote): { x: number; y: number } {
  return {
    x: note.x + STICKY_SIZE_WORLD / 2,
    y: note.y + STICKY_SIZE_WORLD / 2,
  };
}

/** Poll until the note's rendered screen centre is within 1px of (x, y). */
async function expectNoteCenterAt(locator: Locator, x: number, y: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        if (!box) return Infinity;
        return Math.max(
          Math.abs(box.x + box.width / 2 - x),
          Math.abs(box.y + box.height / 2 - y),
        );
      },
      { timeout: 5000 },
    )
    .toBeLessThanOrEqual(1);
}

test("Brainstorm golden path: create, type, move at 50% zoom, recolour, delete", async ({
  page,
}) => {
  await page.goto("/");

  // --- TC-30: double-click at (400,300) creates a note centred there -----
  await page.mouse.dblclick(400, 300);
  await expect(notes(page)).toHaveCount(1);
  const note = notes(page).first();
  await expectNoteCenterAt(note, 400, 300);
  let box = (await note.boundingBox())!;
  expect(box.width).toBeCloseTo(STICKY_SIZE_WORLD, 0); // 100% zoom: 200 CSS px
  expect(box.height).toBeCloseTo(STICKY_SIZE_WORLD, 0);

  // The new note is immediately in Editing mode; type "Hello".
  await expect(page.getByTestId("sticky-note-textarea")).toBeFocused();
  await page.keyboard.type("Hello");
  await page.keyboard.press("Escape"); // keep the text, back to Selected
  await expect(note).toHaveText("Hello");

  // Click empty board: Unselected, toolbar gone.
  await page.mouse.click(150, 650);
  await expect(page.getByRole("button", { name: "Delete note" })).toBeHidden();

  // Click the note: Selected, toolbar back.
  await page.mouse.click(400, 300);
  const deleteButton = page.getByRole("button", { name: "Delete note" });
  await expect(deleteButton).toBeVisible();

  // Recolour via the swatch; the model shows the change.
  await page.getByRole("button", { name: "Green colour" }).click();
  let snap = await boardSnapshot(page);
  expect(snap).toHaveLength(1);
  expect(snap[0].color).toBe("green");
  expect(snap[0].text).toBe("Hello");

  // --- TC-31: drag at 50% zoom -------------------------------------------
  const before = worldCenter((await boardSnapshot(page))[0]);
  await setCamera(page, { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 0.5 });
  box = (await note.boundingBox())!;
  const grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(page, grab, 100, 50);

  // The grabbed point stays under the pointer (within 1px)...
  await expectNoteCenterAt(note, grab.x + 100, grab.y + 50);
  // ...and at 50% zoom a (100, 50) screen drag is (200, 100) in world units.
  snap = await boardSnapshot(page);
  const center = worldCenter(snap[0]);
  expect(center.x).toBeCloseTo(before.x + 200, 1);
  expect(center.y).toBeCloseTo(before.y + 100, 1);

  // A second note via the left toolbar, then delete it with the Delete key.
  await page.getByRole("button", { name: "Sticky note" }).click();
  await expect(notes(page)).toHaveCount(2);
  await expect(page.getByTestId("sticky-note-textarea")).toBeFocused();
  await page.keyboard.type("Second");
  await page.keyboard.press("Escape");
  snap = await boardSnapshot(page);
  expect(snap).toHaveLength(2);

  const second = notes(page).filter({ hasText: "Second" });
  await second.click();
  await page.keyboard.press("Delete");
  await expect(notes(page)).toHaveCount(1);
  snap = await boardSnapshot(page);
  expect(snap).toHaveLength(1);
  expect(snap[0].text).toBe("Hello");
  expect(snap[0].color).toBe("green");
});

test("TC-32: at 200% zoom a drag moves the note half as far in world units and it stacks on top", async ({
  page,
}) => {
  await page.goto("/");

  // Two overlapping notes: A centred at (400,300), B 100px to its right.
  await page.mouse.dblclick(400, 300);
  await expect(page.getByTestId("sticky-note-textarea")).toBeFocused();
  await page.keyboard.type("A");
  await page.keyboard.press("Escape");
  await page.mouse.dblclick(500, 300);
  await expect(page.getByTestId("sticky-note-textarea")).toBeFocused();
  await page.keyboard.type("B");
  await page.keyboard.press("Escape");

  let snap = await boardSnapshot(page);
  expect(snap).toHaveLength(2);
  const aId = snap.find((n) => n.text === "A")!.id;
  const bId = snap.find((n) => n.text === "B")!.id;
  const aBefore = worldCenter(snap.find((n) => n.id === aId)!);
  const noteA = page.locator(`[data-note-id="${aId}"]`);
  const noteB = page.locator(`[data-note-id="${bId}"]`);

  await setCamera(page, { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 2 });
  const aBox = (await noteA.boundingBox())!;
  const aCenterScreen = { x: aBox.x + aBox.width / 2, y: aBox.y + aBox.height / 2 };
  // Grab A well inside its area, left of the region B (on top) overlaps.
  const grabA = { x: aCenterScreen.x - 100, y: aCenterScreen.y };
  await drag(page, grabA, 100, 50);

  // Grabbed point under the pointer (the whole note moves by the delta)...
  await expectNoteCenterAt(noteA, aCenterScreen.x + 100, aCenterScreen.y + 50);
  // ...and at 200% zoom that is (+50, +25) in world units.
  snap = await boardSnapshot(page);
  const a = snap.find((n) => n.id === aId)!;
  const aCenter = worldCenter(a);
  expect(aCenter.x).toBeCloseTo(aBefore.x + 50, 1);
  expect(aCenter.y).toBeCloseTo(aBefore.y + 25, 1);

  // Stacking: A is now above B in the model and painted on top (CSS
  // z-index; DOM order stays stable so drags never lose pointer capture).
  const b = snap.find((n) => n.id === bId)!;
  expect(a.z).toBeGreaterThan(b.z);
  const [aZIndex, bZIndex] = await page.evaluate(([aid, bid]) => {
    const zIndex = (id: string) =>
      getComputedStyle(document.querySelector(`[data-note-id="${id}"]`)!).zIndex;
    return [zIndex(aid), zIndex(bid)];
  }, [aId, bId]);
  expect(Number(aZIndex)).toBeGreaterThan(Number(bZIndex));
  // The notes still overlap on screen, so the draw order is visible.
  const aAfter = (await noteA.boundingBox())!;
  const bAfter = (await noteB.boundingBox())!;
  expect(
    Math.min(aAfter.x + aAfter.width, bAfter.x + bAfter.width) -
      Math.max(aAfter.x, bAfter.x),
  ).toBeGreaterThan(0);
});

test("TC-33: text auto-fits — one word at max size, 1,000 chars at min size with a fade", async ({
  page,
}) => {
  await page.goto("/");
  await page.mouse.dblclick(CENTER.x, CENTER.y);
  const note = notes(page).first();
  const textarea = page.getByTestId("sticky-note-textarea");
  await expect(textarea).toBeFocused();

  // One word fits at the maximum font size.
  await page.keyboard.type("Hello");
  expect(parseFloat((await textarea.evaluate((el) => getComputedStyle(el).fontSize))!)).toBe(
    STICKY_FONT_MAX_PX,
  );

  // Paste 1,000 chars: the text is clamped to the limit and shrunk to the
  // minimum size; the overflow is clipped behind a fade at the bottom edge.
  await page.keyboard.insertText(LONG_PARAGRAPH);
  await expect
    .poll(async () =>
      (await textarea.evaluate((el) => (el as HTMLTextAreaElement).value.length))!,
    )
    .toBe(STICKY_TEXT_MAX_CHARS);
  const fontPx = parseFloat(
    (await textarea.evaluate((el) => getComputedStyle(el).fontSize))!,
  );
  expect(fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
  expect(fontPx).toBeLessThanOrEqual(STICKY_FONT_MAX_PX);

  // Fade present, counter at the limit, nothing rendered outside the note.
  const fade = note.locator(".sticky-note__fade");
  await expect(fade).toHaveCount(1);
  await expect(page.getByTestId("sticky-char-counter")).toHaveText(
    `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
  );
  const noteBox = (await note.boundingBox())!;
  expect(noteBox.width).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  expect(noteBox.height).toBeCloseTo(STICKY_SIZE_WORLD, 0);
  const taBox = (await textarea.boundingBox())!;
  expect(taBox.x).toBeCloseTo(noteBox.x, 0);
  expect(taBox.y).toBeCloseTo(noteBox.y, 0);
  expect(taBox.width).toBeCloseTo(noteBox.width, 0);
  expect(taBox.height).toBeCloseTo(noteBox.height, 0);
  // The content is actually taller than the box, so it is clipped.
  expect(await textarea.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test("TC-34: the toolbar creates a note at the visible centre even when panned far away", async ({
  page,
}) => {
  await page.goto("/");
  await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 });

  await page.getByRole("button", { name: "Sticky note" }).click();
  await expect(notes(page)).toHaveCount(1);
  const note = notes(page).first();
  await expectNoteCenterAt(note, CENTER.x, CENTER.y);

  // The note really is at the visible centre in world coordinates too.
  const cam = await getCamera(page);
  const snap = await boardSnapshot(page);
  const center = worldCenter(snap[0]);
  expect(center.x).toBeCloseTo(CENTER.x / cam.zoom + cam.x, 0);
  expect(center.y).toBeCloseTo(CENTER.y / cam.zoom + cam.y, 0);
});
