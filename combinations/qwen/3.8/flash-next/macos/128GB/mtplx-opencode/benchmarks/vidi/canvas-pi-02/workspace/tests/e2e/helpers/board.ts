import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers shared by the e2e specs: reading the camera and the grid out of the
 * rendered board, and jumping the camera with the test-only hook.
 */
export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/** One sticky note as the live document sees it, lowest z first. */
export interface NoteState {
  id: string;
  type: string;
  /** Top-left corner, world units. */
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

export interface SeedNoteState {
  /** Centre of the new note, world units. */
  x: number;
  y: number;
  color?: string;
  text?: string;
}

export interface BoardWindow {
  __vidi6?: {
    setCamera(camera: CameraState): void;
    getCamera(): CameraState;
    getNotes(): NoteState[];
    seedNote(note: SeedNoteState): string;
    removeNote(id: string): boolean;
    getTexts(): TextObjectState[];
    getShapes(): ShapeState[];
    getConnectors(): ConnectorState[];
    seedShape(seed: SeedShapeState): string;
    seedConnector(seed: SeedConnectorState): string;
    getDoc(): import('yjs').Doc | null;
  };
}

/** A shape object as the live document sees it. */
export interface ShapeState {
  id: string;
  type: 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  kind: string;
  fill: string;
  stroke: string;
  label: string;
}

/** A connector object as the live document sees it. */
export interface ConnectorState {
  id: string;
  type: 'connector';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  fromKind: string;
  toKind: string;
  fromId?: string;
  toId?: string;
}

export interface SeedShapeState {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  at?: { x: number; y: number };
}

export interface SeedConnectorState {
  fromId: string | null;
  toId: string | null;
  fromFallback: { x: number; y: number };
  toFallback: { x: number; y: number };
}

/** A text object as the live document sees it. */
export interface TextObjectState {
  id: string;
  type: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  text: string;
  size: string;
  widthMode: 'auto' | 'fixed';
}

export const board = (page: Page): Locator =>
  page.locator('[data-testid="board-viewport"]');

export const originMarker = (page: Page): Locator =>
  page.locator('[data-testid="origin-marker"]');

export const zoomLabel = (page: Page): Locator =>
  page.locator('[data-testid="zoom-label"]');

export const zoomInButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Zoom in' });

export const zoomOutButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Zoom out' });

export const resetViewButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Reset view' });

export async function readCamera(page: Page): Promise<CameraState> {
  const value = await board(page).getAttribute('data-camera');
  if (!value) throw new Error('data-camera is missing');
  const [x, y, zoom] = value.split(',').map(Number);
  return { x, y, zoom };
}

/** Jump the camera through the test hook and wait for the frame to render. */
export async function setCamera(page: Page, camera: CameraState): Promise<void> {
  // The hook is installed by an effect once the app has mounted, and WebKit
  // can reach this point before that first commit has flushed.
  await page.waitForFunction(
    () => Boolean((window as unknown as BoardWindow).__vidi6),
    undefined,
    { timeout: 10_000 },
  );
  const expected = `${camera.x},${camera.y},${camera.zoom}`;
  await page.evaluate((next) => {
    const hooks = (window as unknown as BoardWindow).__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is not installed in this build');
    hooks.setCamera(next);
  }, camera);
  // Camera updates are batched into one frame; wait for the rendered camera to
  // catch up instead of sleeping, so slow engines cannot be read mid-update.
  await expect
    .poll(() => board(page).getAttribute('data-camera'), { timeout: 5_000 })
    .toBe(expected);
}

/**
 * Wait for the frame-coalesced camera update to have been rendered: two
 * animation frames guarantees any update scheduled in the previous one has
 * been flushed.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Screen position of the origin crosshair, from its rendered box. */
export async function markerCentre(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('the origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Screen position (page coordinates) of a world point, taken from the *rendered*
 * camera and the rendered position of the viewport, so a test can aim the mouse
 * at a piece of board data without hard-coded numbers.
 */
export async function screenPointOf(
  page: Page,
  world: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const camera = await readCamera(page);
  const rect = await board(page).boundingBox();
  if (!rect) throw new Error('the board viewport has no bounding box');
  return {
    x: rect.x + (world.x - camera.x) * camera.zoom,
    y: rect.y + (world.y - camera.y) * camera.zoom,
  };
}

async function waitForHooks(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as BoardWindow).__vidi6),
    undefined,
    { timeout: 10_000 },
  );
}

/** The document's notes, lowest z first, read straight out of the live Y.Doc. */
export async function readNotes(page: Page): Promise<NoteState[]> {
  await waitForHooks(page);
  return page.evaluate(() => window.__vidi6?.getNotes() ?? []);
}

/** The document's text objects, lowest z first. */
export async function readTexts(page: Page): Promise<TextObjectState[]> {
  await waitForHooks(page);
  return page.evaluate(() => window.__vidi6?.getTexts() ?? []);
}

/** Put notes on the board through the test hook, and wait for them to render. */
export async function seedNotes(
  page: Page,
  notes: SeedNoteState[],
): Promise<string[]> {
  await waitForHooks(page);
  const ids = await page.evaluate((list) => {
    const hooks = (window as unknown as BoardWindow).__vidi6;
    if (!hooks) throw new Error('window.__vidi6 is not installed in this build');
    return list.map((note) => hooks.seedNote(note));
  }, notes);
  if (ids.some((id) => !id)) throw new Error('seeding a note was refused');
  const count = ids.length;
  await expect
    .poll(() => page.locator('[data-testid="sticky-note"]').count(), { timeout: 5_000 })
    .toBe(count);
  return ids;
}

export interface GridStyle {
  size: { x: number; y: number };
  position: { x: number; y: number };
}

/** The computed dot-grid pitch and phase as rendered by the browser. */
export async function readGrid(page: Page): Promise<GridStyle> {
  const style = await board(page).evaluate((element) => {
    const computed = getComputedStyle(element);
    const numbers = (value: string) =>
      value
        .split(/[\s,]+/)
        .map((part) => Number.parseFloat(part))
        .filter((part) => Number.isFinite(part));
    const size = numbers(computed.backgroundSize);
    const position = numbers(computed.backgroundPosition);
    return {
      size: { x: size[0] ?? 0, y: size[1] ?? size[0] ?? 0 },
      position: { x: position[0] ?? 0, y: position[1] ?? 0 },
    };
  });
  return style;
}

/** Assert a rendered position is within `tolerance` px of the expected one. */
export function expectWithin(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  tolerance = 1,
): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
}

/** The document's shape objects. */
export async function readShapes(page: Page): Promise<ShapeState[]> {
  await waitForHooks(page);
  return page.evaluate(() => window.__vidi6?.getShapes() ?? []);
}

/** The document's connector objects. */
export async function readConnectors(page: Page): Promise<ConnectorState[]> {
  await waitForHooks(page);
  return page.evaluate(() => window.__vidi6?.getConnectors() ?? []);
}

/** Put a shape on the board through the test hook. */
export async function seedShape(
  page: Page,
  seed: SeedShapeState,
): Promise<string> {
  await waitForHooks(page);
  return page.evaluate((s) => window.__vidi6?.seedShape(s) ?? '', seed);
}

/** Put a connector on the board through the test hook. */
export async function seedConnector(
  page: Page,
  seed: SeedConnectorState,
): Promise<string> {
  await waitForHooks(page);
  return page.evaluate((s) => window.__vidi6?.seedConnector(s) ?? '', seed);
}
