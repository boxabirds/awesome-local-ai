import { expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { worldToScreen, type Camera, type Point } from '../../../src/client/canvas/camera';
import { E2E_PORT } from './boards-api';
import { settle } from './board';

/** Seeds a created board with a doc's state through the test-only hook (the room applies and saves it). */
export async function seedBoard(boardId: string, doc: Y.Doc, baseURL = `http://127.0.0.1:${E2E_PORT}`) {
  const res = await fetch(`${baseURL}/__test/boards/${boardId}/seed`, {
    method: 'POST',
    body: Buffer.from(Y.encodeStateAsUpdate(doc)),
  });
  expect(res.status, 'seed hook').toBe(200);
}

export async function selectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__vidi6!.selection?.() ?? []);
}

export function selectionBar(page: Page) {
  return page.getByRole('toolbar', { name: 'Selection' });
}

/** Screen point of a world point for `cam` (the viewport fills the page). */
export function toScreen(cam: Camera, p: Point): Point {
  return worldToScreen(cam, p);
}

/** Shift+drag from screen `from` to `to` with the real mouse. */
export async function marquee(page: Page, from: Point, to: Point) {
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await settle(page);
}

export async function shiftClick(page: Page, at: Point) {
  await page.keyboard.down('Shift');
  await page.mouse.click(at.x, at.y);
  await page.keyboard.up('Shift');
}

/** Centre of a resize handle, e.g. 'bottom-right'. */
export async function handleCentre(page: Page, position: string): Promise<Point> {
  const box = await page.getByRole('button', { name: `Resize ${position}` }).boundingBox();
  if (!box) throw new Error(`handle ${position} not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
