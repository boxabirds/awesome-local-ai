import { expect, type Page } from "@playwright/test";
import { STICKY_SIZE_WORLD } from "../../../src/shared/config";
import type { XY } from "./board";

/**
 * Read-side helpers for sticky notes. Everything is read from the rendered page
 * (the world layer carries world coordinates in its inline styles, the zoom in
 * its transform), which is what a user actually sees.
 */
export interface NoteView {
  id: string;
  /** World coordinates, straight from the world layer's inline styles. */
  worldX: number;
  worldY: number;
  centre: XY;
  width: number;
  height: number;
  text: string;
  background: string;
  zIndex: number;
  selected: boolean;
  dragging: boolean;
  editing: boolean;
  overflow: boolean;
  fontPx: number;
  /** Bounding box of the text element, for "nothing outside the note" checks. */
  textBox: { x: number; y: number; width: number; height: number };
}

export async function notes(page: Page): Promise<NoteView[]> {
  return page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid='sticky-note']"),
    );
    return elements.map((el) => {
      const box = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      const textEl = el.querySelector<HTMLElement>("[data-testid='sticky-text']");
      const text = textEl
        ? textEl instanceof HTMLTextAreaElement
          ? textEl.value
          : (textEl.textContent ?? "")
        : "";
      const textBox = textEl ? textEl.getBoundingClientRect() : box;
      return {
        id: el.getAttribute("data-note-id") ?? "",
        worldX: Number.parseFloat(el.style.left),
        worldY: Number.parseFloat(el.style.top),
        centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        width: box.width,
        height: box.height,
        text,
        background: computed.backgroundColor,
        zIndex: Number.parseInt(computed.zIndex, 10),
        selected: el.getAttribute("data-selected") === "true",
        dragging: el.getAttribute("data-dragging") === "true",
        editing: Boolean(el.querySelector("textarea")),
        overflow: el.classList.contains("sticky-note-overflow"),
        fontPx: textEl ? Number.parseFloat(window.getComputedStyle(textEl).fontSize) : 0,
        textBox: { x: textBox.left, y: textBox.top, width: textBox.width, height: textBox.height },
      };
    });
  });
}

export async function noteCount(page: Page): Promise<number> {
  return page.locator("[data-testid='sticky-note']").count();
}

export async function noteByIndex(page: Page, index = 0): Promise<NoteView> {
  const all = await notes(page);
  if (all.length <= index) throw new Error(`note ${index} is not on the board (found ${all.length})`);
  return all[index];
}

export async function waitForNotes(page: Page, expected: number) {
  await expect(page.locator("[data-testid='sticky-note']")).toHaveCount(expected);
}

/** Centre of the note that was created most recently (highest z). */
export async function topNote(page: Page): Promise<NoteView> {
  const all = await notes(page);
  if (all.length === 0) throw new Error("no notes on the board");
  return all.reduce((best, note) => (note.zIndex >= best.zIndex ? note : best));
}

export async function createNoteByDoubleClick(page: Page, at: XY) {
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.getByTestId("sticky-editor")).toBeVisible();
}

export async function noteCentreOf(page: Page): Promise<XY> {
  const viewport = await page.locator("[data-testid='board-viewport']").boundingBox();
  if (!viewport) throw new Error("board area has no bounding box");
  return { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
}

/** Real pointer drag: down on the note, move in steps, up. */
export async function dragNote(
  page: Page,
  from: XY,
  dx: number,
  dy: number,
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await expect
    .poll(async () => (await notes(page)).some((note) => !note.dragging))
    .toBe(true);
}

/** Type into the note that is currently being edited. */
export async function typeIntoEditor(page: Page, text: string) {
  const editor = page.getByTestId("sticky-textarea");
  await editor.fill(text);
  await expect(editor).toHaveValue(text);
}

export async function endEditing(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("sticky-textarea")).toHaveCount(0);
}

/** The note size as rendered, so zoom assertions are explicit. */
export function expectedScreenSize(zoom: number): number {
  return STICKY_SIZE_WORLD * zoom;
}

export function rgbOf(hex: string): string {
  const value = hex.replace("#", "");
  const channel = (index: number) => Number.parseInt(value.slice(index, index + 2), 16);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}
