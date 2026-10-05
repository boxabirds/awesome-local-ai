import { expect, type Page } from "@playwright/test";
import { boardBox, renderedCamera, type XY } from "./board";

/**
 * Story 2 e2e helpers: read notes out of the rendered board, convert their
 * screen geometry into board coordinates, and drive the real pointer gestures
 * (double-click, press-move-release) that the story is specified with.
 */

export interface NoteDom {
  id: string;
  /** Screen box in CSS pixels. */
  box: { x: number; y: number; width: number; height: number };
  /** The note's text, from the displayed text or from the editor if it is open. */
  text: string;
  selected: boolean;
  editing: boolean;
  /** DOM order (stable by id); stacking is the note's z-index. */
  index: number;
  z: number;
}

export async function notes(page: Page): Promise<NoteDom[]> {
  const located = page.getByTestId("sticky-note");
  const count = await located.count();
  const out: NoteDom[] = [];
  for (let index = 0; index < count; index += 1) {
    const el = located.nth(index);
    const box = await el.boundingBox();
    if (!box) throw new Error(`note ${index} has no bounding box`);
    const displayed = el.getByTestId("sticky-note-text");
    const editor = el.getByTestId("sticky-note-input");
    const editing = (await editor.count()) > 0;
    out.push({
      index,
      id: String(await el.getAttribute("data-note-id")),
      box,
      text:
        editing === true
          ? ((await editor.inputValue()) ?? "")
          : ((await displayed.textContent()) ?? ""),
      selected: (await el.getAttribute("data-selected")) === "true",
      editing,
      z: Number(await el.evaluate((node) => node.style.zIndex || "0")),
    });
  }
  return out;
}

export async function noteCount(page: Page): Promise<number> {
  return page.getByTestId("sticky-note").count();
}

/** Anything with a screen box: a rendered NoteDom, or a story 3 board snapshot. */
export type HasBox = { box: { x: number; y: number; width: number; height: number } };

export function centreOf(note: HasBox): XY {
  return { x: note.box.x + note.box.width / 2, y: note.box.y + note.box.height / 2 };
}

/** The note's top-left corner in board coordinates, from what is on screen. */
export async function worldOf(page: Page, note: NoteDom): Promise<XY> {
  const area = await boardBox(page);
  const camera = await renderedCamera(page);
  return {
    x: (note.box.x - area.x) / camera.zoom + camera.x,
    y: (note.box.y - area.y) / camera.zoom + camera.y,
  };
}

/** Waits for the frame-throttled model writes and React's paint to land. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function createNoteByDoubleClick(page: Page, at: XY): Promise<void> {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("sticky-note-input")).toBeVisible();
  await settle(page);
}

export async function endEditing(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sticky-note-input")).toHaveCount(0);
  await settle(page);
}

export async function dragOnBoard(page: Page, from: XY, dx: number, dy: number, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps);
  }
  await page.mouse.up();
  await settle(page);
}

/**
 * The `data-testid` of the board object painted at a screen point - the direct
 * answer to "is this note drawn above that one".
 */
export async function paintTestIdAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([pointX, pointY]) => {
      const element = document.elementFromPoint(pointX, pointY);
      const holder = element ? element.closest("[data-testid]") : null;
      return holder ? String(holder.getAttribute("data-testid")) : null;
    },
    [x, y],
  );
}

/** The id of the note painted at a screen point, or null if none is there. */
export async function paintedNoteIdAt(page: Page, x: number, y: number): Promise<string | null> {
  return page.evaluate(
    ([pointX, pointY]) => {
      const element = document.elementFromPoint(pointX, pointY);
      const note = element ? element.closest("[data-testid='sticky-note']") : null;
      return note ? note.getAttribute("data-note-id") : null;
    },
    [x, y],
  );
}

export function rgbOf(hex: string): string {
  const digits = hex.replace("#", "");
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}
