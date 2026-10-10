import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

/** Story 5: boards are created server-side; POST /api/boards returns the id. */
export async function createBoardApi(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/boards');
  if (response.status() !== 201) {
    throw new Error(`POST /api/boards failed with ${response.status()}`);
  }
  return ((await response.json()) as { id: string }).id;
}

export async function gotoBoard(page: Page): Promise<string> {
  const boardId = await createBoardApi(page.request);
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await expect(page.getByTestId('world-layer')).toHaveAttribute('data-camera', /,/);
  // Story 5: BoardScreen mounts once the existence check passes, so the
  // viewport can appear before the room sync finishes; the final board load
  // re-centers the camera, which would race later camera changes.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState?: () => string } }).__vidi6
              ?.connectionState?.() ?? 'missing-hook',
        ),
      { timeout: 15_000 },
    )
    .toBe('connected');
  return boardId;
}

export function getCamera(page: Page): Promise<Cam> {
  return page.evaluate(() => (window as never as { __vidi6: { getCamera(): Cam } }).__vidi6.getCamera());
}

export async function setCamera(page: Page, camera: Cam): Promise<void> {
  await page.evaluate((c) => {
    (window as never as { __vidi6: { setCamera(cam: Cam): void } }).__vidi6.setCamera(c);
  }, camera);
  // Camera commits are coalesced to one render per animation frame; wait until
  // the rendered world layer reflects the new camera so later interactions use
  // handlers closed over the new state.
  const expected = `${camera.x},${camera.y},${camera.zoom}`;
  await expect
    .poll(
      async () =>
        page
          .getByTestId('world-layer')
          .getAttribute('data-camera'),
      { timeout: 5_000 },
    )
    .toBe(expected);
}

export async function markerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('origin-marker').boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Waits until the rendered origin marker settles at the given position.
export async function waitForMarkerCenter(
  page: Page,
  x: number,
  y: number,
  tolerance = 1,
): Promise<{ x: number; y: number }> {
  await expect
    .poll(
      async () => {
        const c = await markerCenter(page);
        return Math.abs(c.x - x) <= tolerance && Math.abs(c.y - y) <= tolerance;
      },
      { timeout: 5_000 },
    )
    .toBe(true);
  return markerCenter(page);
}

export interface NoteInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

export function getNotes(page: Page): Promise<NoteInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getNotes(): NoteInfo[] } };
      }
    ).__vidi6.board.getNotes(),
  );
}

export interface TextInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: string;
  widthMode: string;
}

/** Story 9: free-text objects as the shared snapshot reader sees them. */
export function getTexts(page: Page): Promise<TextInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getObjectSnapshots?(): TextInfo[] } };
      }
    )
      .__vidi6.board.getObjectSnapshots!()
      .filter((o) => o.type === 'text'),
  );
}

export interface ShapeInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: string;
  fill: string;
  stroke: string;
}

export interface EndpointInfo {
  kind: string;
  objectId?: string;
  x?: number;
  y?: number;
  side?: string;
  fallback?: { x: number; y: number };
}

export interface ConnectorInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  from: EndpointInfo;
  to: EndpointInfo;
}

/** Story 10: shape objects as the shared snapshot reader sees them. */
export function getShapes(page: Page): Promise<ShapeInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getObjectSnapshots?(): ShapeInfo[] } };
      }
    )
      .__vidi6.board.getObjectSnapshots!()
      .filter((o) => o.type === 'shape'),
  );
}

/** Story 10: connector objects as the shared snapshot reader sees them. */
export function getConnectors(page: Page): Promise<ConnectorInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getObjectSnapshots?(): ConnectorInfo[] } };
      }
    )
      .__vidi6.board.getObjectSnapshots!()
      .filter((o) => o.type === 'connector'),
  );
}

export async function gridSpacingPx(page: Page): Promise<string> {
  return page
    .getByTestId('board-grid')
    .evaluate((el) => getComputedStyle(el).backgroundSize.split(' ')[0]);
}

export interface StrokeInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  points: { x: number; y: number }[];
}

/** Story 11: stroke objects as the shared snapshot reader sees them. */
export function getStrokes(page: Page): Promise<StrokeInfo[]> {
  return page.evaluate(() =>
    (
      window as never as {
        __vidi6: { board: { getObjectSnapshots?(): StrokeInfo[] } };
      }
    )
      .__vidi6.board.getObjectSnapshots!()
      .filter((o) => o.type === 'stroke'),
  );
}
