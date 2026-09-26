import { expect, type Page } from '@playwright/test';

/**
 * Story 5: a board link only works for boards that exist. Create one through
 * the production `POST /api/boards` path (in the page, so it hits the app's
 * own origin) and return its id.
 *
 * Each creation uses a unique `x-test-visitor` (TEST_HOOKS override) so the
 * per-visitor rate limit never collides across the parallel e2e suite.
 */
export async function createBoardViaApi(page: Page): Promise<string> {
  await page.goto('/');
  return page.evaluate(async () => {
    const res = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'x-test-visitor': crypto.randomUUID() },
    });
    if (!res.ok) throw new Error(`POST /api/boards failed: ${res.status}`);
    const body = (await res.json()) as { id: string };
    return body.id;
  });
}

/**
 * Navigate to a fresh board and wait until it is rendered. Story 5: the
 * board is created via the API first (its link is what the app now serves),
 * then we go straight to the board URL.
 */
export async function gotoBoard(page: Page): Promise<string> {
  const id = await createBoardViaApi(page);
  await page.goto('/b/' + id);
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
  return id;
}

/**
 * Story 5: make a (possibly never-created) board id exist via the server
 * test hook `initialize` (idempotent: created exactly once). Runs in the
 * page so it always hits the app's own origin. Used by openBoard, whose
 * callers pass in the id several participants share.
 */
export async function ensureBoardExists(page: Page, boardId: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (id: string) => {
    const res = await fetch(`/__test/boards/${id}/initialize`);
    if (!res.ok) throw new Error(`initialize failed for ${id}: ${res.status}`);
  }, boardId);
}

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.locator('[data-testid="origin-marker"]');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="zoom-label"]').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}

export async function getHintVisible(page: Page): Promise<boolean> {
  const hint = page.locator('[data-testid="navigation-hint"]');
  return await hint.isVisible();
}

export interface NoteSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  /** Story 7: sticky width/height (world px). Optional: pre-story-7 boards
   *  omit them and the client falls back to the default sticky size. */
  width?: number;
  height?: number;
  color: string;
  text: string;
  z: number;
  createdAt: number;
}

/** Story 2: the board's sticky notes, read through the test hooks. */
export async function getNotes(page: Page): Promise<NoteSnapshot[]> {
  return page.evaluate(() => {
    const h = (window as any).__vidi6;
    return h ? h.getNotes() : [];
  });
}

/** Story 10: a connector endpoint (attached with fallback, or free). */
export interface EndpointSnap {
  kind: 'free' | 'attached';
  objectId?: string;
  x?: number;
  y?: number;
  fallback?: { x: number; y: number };
}

/**
 * Story 9: snapshot of ALL board objects (any type) with the text fields
 * (size, widthMode, width, height, createdBy). Story 10 adds the shape
 * fields (kind, fill, stroke, label) and the connector fields (from/to plus
 * their resolved world points).
 */
export interface ObjectSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  size?: string;
  widthMode?: 'auto' | 'fixed';
  createdBy?: string;
  z: number;
  createdAt: number;
  /** Story 10: shape kind (rect | ellipse | diamond). */
  kind?: string;
  /** Story 10: shape fill colour name. */
  fill?: string;
  /** Story 10: shape outline colour name. */
  stroke?: string;
  /** Story 10: shape label text. */
  label?: string;
  /** Story 10: connector endpoints. */
  from?: EndpointSnap;
  to?: EndpointSnap;
  /** Story 10: connector resolved endpoint points (world units). */
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
}

export async function getObjects(page: Page): Promise<ObjectSnapshot[]> {
  return page.evaluate(() => {
    const h = (window as any).__vidi6;
    return h ? h.getObjects() : [];
  });
}

/** Waits until the note's bounding box matches the expected screen rect. */
export async function waitForNoteBox(page: Page, noteId: string, expected: { x: number; y: number; width: number; height: number }): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.locator(`[data-id="${noteId}"]`).boundingBox();
      if (!box) return false;
      return (
        Math.abs(box.x - expected.x) < 2 &&
        Math.abs(box.y - expected.y) < 2 &&
        Math.abs(box.width - expected.width) < 2 &&
        Math.abs(box.height - expected.height) < 2
      );
    })
    .toBeTruthy();
}
