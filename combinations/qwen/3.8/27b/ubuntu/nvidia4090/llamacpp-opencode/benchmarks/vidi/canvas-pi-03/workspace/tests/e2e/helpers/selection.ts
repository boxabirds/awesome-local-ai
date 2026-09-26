/**
 * Story 7 e2e helpers: seeding exact layouts through the real client path
 * (applyUpdates), marquee/shift-click selection, group drags and reading the
 * local selection. All screen math uses the board's initial camera
 * (x: -640, y: -360) — screen = (world - camera) * zoom.
 */
import { expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { getNotes } from './board';

/** The page's current camera (test hook). */
async function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => (window as any).__vidi6?.getCamera?.() ?? { x: 0, y: 0, zoom: 1 });
}

export const INITIAL_CAM = { x: -640, y: -360, zoom: 1 } as const;

/** World point -> screen pixel for a given zoom (initial camera position). */
export function screenOf(w: { x: number; y: number }, zoom: number = INITIAL_CAM.zoom): { x: number; y: number } {
  return { x: (w.x - INITIAL_CAM.x) * zoom, y: (w.y - INITIAL_CAM.y) * zoom };
}

export interface SeedNote {
  id: string;
  /** Top-left in world units. */
  x: number;
  y: number;
  z: number;
  /** Explicit size (default: STICKY_SIZE_WORLD, left unset). */
  size?: number;
}

/**
 * Seeds a board with stickies at exact top-left positions by building a Yjs
 * update here (node) and applying it through the client's applyUpdates hook.
 * Waits until the page shows all of them.
 */
export async function seedNotes(page: Page, notes: SeedNote[]): Promise<void> {
  const doc = new Y.Doc();
  const objects = doc.getMap('objects');
  const base = Date.now();
  notes.forEach((n, i) => {
    const m = new Y.Map();
    m.set('type', 'sticky');
    m.set('x', n.x);
    m.set('y', n.y);
    m.set('z', n.z);
    m.set('createdAt', base + i);
    m.set('color', 'yellow');
    m.set('text', new Y.Text());
    if (n.size !== undefined) {
      m.set('width', n.size);
      m.set('height', n.size);
    }
    objects.set(n.id, m);
  });
  const b64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  await page.evaluate((u) => (window as any).__vidi6?.applyUpdates([u]), b64);
  await expect
    .poll(
      async () => (await getNotes(page)).length,
      { timeout: 15_000, message: `waiting for ${notes.length} seeded notes` },
    )
    .toBe(notes.length);
}

/** The page's local selection ids (story 7 test hook). */
export async function getSelection(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as any).__vidi6?.getSelection?.() ?? []) as string[]);
}

/** Shift+drag a marquee from screen `from` to `to`. */
export async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Clicks a screen point (optionally shift-clicking). */
export async function clickAt(page: Page, x: number, y: number, shift: boolean = false): Promise<void> {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(x, y);
  if (shift) await page.keyboard.up('Shift');
}

/**
 * Drags the note by (dx, dy) WORLD units from its true centre (computed from
 * its stored size, not the 200px default).
 */
export async function dragNoteWorld(page: Page, noteId: string, dx: number, dy: number, size: number): Promise<void> {
  const notes = await getNotes(page);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  const cam = await getCamera(page);
  const c = screenOf({ x: note.x + size / 2, y: note.y + size / 2 }, cam.zoom);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx * cam.zoom, c.y + dy * cam.zoom, { steps: 12 });
  await page.mouse.up();
}

