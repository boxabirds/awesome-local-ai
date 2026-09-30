import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { type Camera } from '../../src/client/canvas/camera';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import { type ConnectorSnap, type Endpoint, createConnector } from '../../src/shared/objects/connector';
import { type ShapeKind, type ShapeSnap, createShape } from '../../src/shared/objects/shape';
import { cameraFromDom, initialCamera, nextFrame } from './helpers';

/** A doc with shapes covering the given world rects. */
export function docWithShapes(rects: Rect[], kind: ShapeKind = 'rect', doc = new Y.Doc()) {
  initDoc(doc);
  const ids = rects.map((rect) => createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y } }, 'g_test')!);
  return { doc, ids };
}

export function addConnector(doc: Y.Doc, from: Endpoint, to: Endpoint) {
  return createConnector(doc, from, to, 'g_test')!;
}

export const attachedTo = (objectId: string): Endpoint => ({
  kind: 'attached',
  objectId,
  fallback: { x: 0, y: 0 },
});

export const shapesOf = (doc: Y.Doc) =>
  objectsSnapshot(doc).filter((o): o is ShapeSnap => o.type === 'shape');
export const connectorsOf = (doc: Y.Doc) =>
  objectsSnapshot(doc).filter((o): o is ConnectorSnap => o.type === 'connector');

export const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!;
export const selectedIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-object-id][data-selected="true"]')]
    .map((el) => el.dataset.objectId!)
    .sort();

export const toolButton = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
export const pressedTool = () =>
  ['Select (V)', 'Text (T)', 'Shape (S)', 'Connector (L)'].find(
    (name) => toolButton(name).getAttribute('aria-pressed') === 'true',
  );

let camera: Camera | null = null;

/** Sets the board camera through the test hook (test builds only, as in e2e). */
export function setCamera(cam: Camera) {
  act(() => window.__vidi6!.setCamera!(cam));
  // Camera updates are applied on the next frame.
  nextFrame();
  camera = cameraFromDom();
}

export function resetCameraTracking() {
  camera = null;
}

/** jsdom has no layout: the viewport is at (0, 0), so client px = viewport px. */
export function toClient(world: Point): Point {
  const cam = camera ?? initialCamera();
  return { x: (world.x - cam.x) * cam.zoom, y: (world.y - cam.y) * cam.zoom };
}

export function toWorld(client: Point): Point {
  const cam = camera ?? initialCamera();
  return { x: client.x / cam.zoom + cam.x, y: client.y / cam.zoom + cam.y };
}
