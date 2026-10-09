import type { Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';
import { stickyColorLabel } from '../../../src/shared/config';
import type { ScreenPoint } from './board';

export interface NoteBox extends ScreenPoint {
  width: number;
  height: number;
}

interface BoardHooks {
  notes(): StickySnapshot[];
  createNote(params: { at: ScreenPoint; color?: StickyColor }): string;
}

/** Read the live document through the test-only hooks (test build only). */
export async function getNotes(page: Page): Promise<StickySnapshot[]> {
  return page.evaluate(() => {
    const api = (window as unknown as { __vidi6?: BoardHooks }).__vidi6;
    if (!api) {
      throw new Error('test hooks are not installed');
    }
    return api.notes();
  });
}

/** Put a note on the board through the model (test setup only). */
export async function createNoteAt(page: Page, at: ScreenPoint, color?: StickyColor): Promise<string> {
  const id = await page.evaluate(
    (args) => {
      const api = (window as unknown as { __vidi6?: BoardHooks }).__vidi6;
      if (!api) {
        throw new Error('test hooks are not installed');
      }
      return api.createNote({ at: { x: args.x, y: args.y }, color: args.color });
    },
    { x: at.x, y: at.y, color },
  );
  await page.waitForTimeout(60);
  return id;
}

export function noteCard(page: Page, id: string) {
  return page.locator(`[data-testid="sticky-note-${id}"]`);
}

export async function noteBox(page: Page, id: string): Promise<NoteBox> {
  const box = await noteCard(page, id).boundingBox();
  if (!box) {
    throw new Error(`sticky note ${id} has no bounding box (is it on screen?)`);
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export async function noteCentre(page: Page, id: string): Promise<ScreenPoint> {
  const box = await noteBox(page, id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function noteAttribute(page: Page, id: string, name: string): Promise<string | null> {
  return noteCard(page, id).getAttribute(name);
}

/** Click the middle of a note: it becomes Selected. */
export async function selectNote(page: Page, id: string): Promise<ScreenPoint> {
  const centre = await noteCentre(page, id);
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(60);
  return centre;
}

/** Real pointer drag from the note's centre by (dx, dy) screen pixels. */
export async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<ScreenPoint> {
  const grab = await noteCentre(page, id);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + dx / 2, grab.y + dy / 2, { steps: 6 });
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  return grab;
}

/** The sticky note painted on top at a screen point, or null. */
export async function topNoteIdAt(page: Page, at: ScreenPoint): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    const note = element ? element.closest('[data-testid^="sticky-note-"]') : null;
    return note ? note.getAttribute('data-testid') : null;
  }, { x: at.x, y: at.y });
}

/** The colour the note is actually painted in, e.g. "rgb(255, 245, 157)". */
export async function noteBackground(page: Page, id: string): Promise<string> {
  return noteCard(page, id).evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
}

export async function clickSwatch(page: Page, color: StickyColor): Promise<void> {
  await page.getByRole('button', { name: stickyColorLabel(color) }).click();
  await page.waitForTimeout(60);
}

export async function clickCreateStickyButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sticky note' }).click();
  await page.waitForTimeout(60);
}

export async function clickDeleteButton(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete note' }).click();
  await page.waitForTimeout(60);
}

export interface EditorMetrics {
  fontSize: number;
  value: string;
  scrollHeight: number;
  clientHeight: number;
}

/** Measurements of the live textarea while a note is being edited. */
export async function editorMetrics(page: Page): Promise<EditorMetrics> {
  return page.locator('[data-testid="sticky-editor"]').evaluate((el) => {
    const field = el as HTMLTextAreaElement;
    const style = getComputedStyle(field);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      value: field.value,
      scrollHeight: field.scrollHeight,
      clientHeight: field.clientHeight,
    };
  });
}

export interface TextMetrics {
  fontSize: number;
  /** Height of the text content, whether or not it is clipped. */
  contentHeight: number;
  /** Inner height of the clipping box. */
  clipHeight: number;
  /** Scroll height of the clipping box (includes what it clips). */
  clipScrollHeight: number;
  overflow: string;
  /** Height of the faded strip at the bottom of the note. */
  fadeHeight: number;
  fadeVisible: boolean;
}

/** Measurements of the note's own text layer (Selected, i.e. not editing). */
export async function textMetrics(page: Page, id: string): Promise<TextMetrics> {
  return page
    .locator(`[data-sticky-note="${id}"] .sticky-note__clip`)
    .evaluate((clip) => {
      const element = clip as HTMLElement;
      const text = element.querySelector('[data-testid^="sticky-text-"]') as HTMLElement;
      const fade = element.querySelector('.sticky-note__fade') as HTMLElement;
      const style = getComputedStyle(text);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        contentHeight: text.scrollHeight,
        clipHeight: element.clientHeight,
        clipScrollHeight: element.scrollHeight,
        overflow: getComputedStyle(element).overflow,
        fadeHeight: fade.getBoundingClientRect().height,
        fadeVisible: getComputedStyle(fade).display !== 'none' && getComputedStyle(fade).opacity !== '0',
      };
    });
}
