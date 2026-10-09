import { expect, test, type Page } from "@playwright/test";
import { openBoard } from "./helpers/board";
import {
  createNoteByDoubleClick,
  endEditingWithEscape,
  noteDisplayText,
  noteFontSize,
  noteLocator,
  noteScreenSize,
  textMetrics,
  waitForEditor,
} from "./helpers/stickies";
import { PROSE_1000, SHORT_PHRASE } from "../fixtures/texts";
/** Types a value into the editor the way a clipboard paste does: one input event. */
async function pasteIntoEditor(page: Page, value: string) {
  await page.getByTestId("sticky-note-textarea").evaluate((raw, text) => {
    const el = raw as HTMLTextAreaElement;
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/**
 * sticky.text, e2e level: real font layout, so the auto-fit and the clip at the
 * minimum size are checked on painted output.
 */
test.describe("sticky notes: text fit and length limit", () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
  });

  test("TC-33: a short note uses the maximum font size", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await page.keyboard.type(SHORT_PHRASE);

    expect(await noteFontSize(page, id)).toBe(24);
    const metrics = await textMetrics(page, id);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    await expect(page.locator(".sticky-note-fade")).toHaveCount(0);

    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, id)).toBe(SHORT_PHRASE);
  });

  test("TC-33b: longer text shrinks to fit and stays inside the note", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await pasteIntoEditor(page, PROSE_1000.slice(0, 400));

    const fontPx = await noteFontSize(page, id);
    expect(fontPx).toBeGreaterThanOrEqual(10);
    expect(fontPx).toBeLessThan(24);
    const metrics = await textMetrics(page, id);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    await expect(page.locator(".sticky-note-fade")).toHaveCount(0);

    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, id)).toBe(PROSE_1000.slice(0, 400));
    const size = await noteScreenSize(page, id);
    expect(size.height).toBeCloseTo(200, 0);
  });

  test("TC-33c: 1,000 characters clip at the minimum size with a fade, inside the note", async ({
    page,
  }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await pasteIntoEditor(page, PROSE_1000);

    const fontPx = await noteFontSize(page, id);
    expect(fontPx).toBeGreaterThanOrEqual(10);
    expect(fontPx).toBeLessThanOrEqual(24);

    const metrics = await textMetrics(page, id);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    await expect(page.locator(".sticky-note-fade")).toHaveCount(1);

    const textEl = noteLocator(page, id).locator(".sticky-note-text");
    expect(await textEl.evaluate((el) => window.getComputedStyle(el).overflow)).toBe("hidden");
    const size = await noteScreenSize(page, id);
    expect(size.height).toBeCloseTo(200, 0);
    expect(size.width).toBeCloseTo(200, 0);

    // The counter is visible at the limit and nothing beyond it was stored.
    await expect(page.getByTestId("sticky-char-counter")).toHaveText("1000/1000");
    await endEditingWithEscape(page);
    expect((await noteDisplayText(page, id)).length).toBe(1000);
  });

  test("TC-33d: a 1,200 character paste is clamped to 1,000 and editing stays usable", async ({
    page,
  }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await pasteIntoEditor(page, `${PROSE_1000}and a good deal more text that never makes it into the note`);

    await expect(page.getByTestId("sticky-char-counter")).toHaveText("1000/1000");
    await endEditingWithEscape(page);
    const stored = await noteDisplayText(page, id);
    expect(stored.length).toBe(1000);
    expect(PROSE_1000.startsWith(stored.slice(0, 900))).toBe(true);

    // At the limit typing adds nothing; removing a character frees room.
    await noteLocator(page, id).dblclick();
    await waitForEditor(page);
    await page.keyboard.type("abc");
    expect(await page.getByTestId("sticky-note-textarea").inputValue()).toHaveLength(1000);
    await page.keyboard.press("Backspace");
    await page.keyboard.type("ab");
    expect(await page.getByTestId("sticky-note-textarea").inputValue()).toHaveLength(1000);
    await endEditingWithEscape(page);
    expect((await noteDisplayText(page, id)).length).toBe(1000);
  });

  test("the counter appears only when 50 or fewer characters remain", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);

    for (const length of [900, 949, 950, 951, 1000]) {
      await pasteIntoEditor(page, PROSE_1000.slice(0, length).padEnd(length, "x"));
      const counter = page.getByTestId("sticky-char-counter");
      if (length >= 950) {
        await expect(counter).toHaveText(`${length}/1000`);
      } else {
        await expect(counter).toHaveCount(0);
      }
    }

    await endEditingWithEscape(page);
    expect((await noteDisplayText(page, id)).length).toBe(1000);
  });

  test("typing writes to the note on every keystroke, not only on exit", async ({ page }) => {
    const id = await createNoteByDoubleClick(page, 640, 400);
    await page.keyboard.type("typed slowly");
    // While still editing, the note's own text layer already holds the text.
    expect(await noteDisplayText(page, id)).toBe("typed slowly");
    expect(await noteFontSize(page, id)).toBe(24);
    await endEditingWithEscape(page);
    expect(await noteDisplayText(page, id)).toBe("typed slowly");
  });
});
