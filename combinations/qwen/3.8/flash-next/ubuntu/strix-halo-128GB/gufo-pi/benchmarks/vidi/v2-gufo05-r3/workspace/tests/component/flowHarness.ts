/**
 * Helpers for the story 10 component tests.
 *
 * The board's camera lives in React state and is written into the world layer's CSS
 * transform, so a test that wants to press a *screen* point on top of a *world*
 * rectangle reads the camera back out of that transform rather than assuming where the
 * board is looking. Everything else here is a thin wrapper over the real model calls:
 * fixtures are made the way a user makes them, not by poking at the Y.Doc.
 */
import * as Y from 'yjs';
import {
  objectBounds,
  snapshot,
  type AnySnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { createShape, getShapeLabel, type ShapeSnap } from '../../src/shared/objects/shape';
import { createConnector, type ConnectorSnap, type Endpoint } from '../../src/shared/objects/connector';
import type { Rect } from '../../src/shared/geometry';
import type { Camera, Point } from '../../src/client/canvas/camera';
import type { ShapeKind } from '../../src/shared/config';

/** Every object in the document, in paint order. */
export function objectsOf(doc: Y.Doc): readonly AnySnapshot[] {
  return snapshot(doc);
}

/** A shape made through the model, at an exact world rectangle. */
export function seedShape(
  doc: Y.Doc,
  kind: ShapeKind,
  rect: Rect,
  options: { fill?: string; stroke?: string; label?: string } = {},
): string {
  const id = createShape(doc, { kind, rect, at: { x: rect.x, y: rect.y } }, 'local');
  if (!id) throw new Error(`seedShape refused a ${kind} at ${JSON.stringify(rect)}`);
  if (options.label) getShapeLabel(doc, id)?.insert(0, options.label);
  return id;
}

/** An arrow made through the model, joined to two objects by id. */
export function seedConnector(doc: Y.Doc, fromId: string, toId: string): string {
  const objects = objectsOf(doc);
  const rectOf = (id: string): Rect => {
    const object = objects.find((candidate) => candidate.id === id);
    if (!object) throw new Error(`seedConnector was given an id that is not on the board: ${id}`);
    return objectBounds(object);
  };
  const a = rectOf(fromId);
  const b = rectOf(toId);
  const from: Endpoint = { kind: 'attached', objectId: fromId, fallback: { x: a.x + a.width, y: a.y + a.height / 2 } };
  const to: Endpoint = { kind: 'attached', objectId: toId, fallback: { x: b.x, y: b.y + b.height / 2 } };
  const id = createConnector(doc, from, to, 'local');
  if (!id) throw new Error(`seedConnector refused ${fromId} -> ${toId}`);
  return id;
}

/** An arrow with one end parked at a world point and the other on an object. */
export function seedConnectorFromPoint(doc: Y.Doc, at: Point, toId: string): string {
  const id = createConnector(doc, { kind: 'free', x: at.x, y: at.y }, { kind: 'attached', objectId: toId, fallback: at }, 'local');
  if (!id) throw new Error(`seedConnectorFromPoint refused ${toId}`);
  return id;
}

/** The camera the board is looking through, read from the world layer's transform. */
export function cameraOf(container: HTMLElement): Camera {
  const layer = container.querySelector<HTMLElement>('.world-layer');
  const match = /scale\(([-\d.]+)\)\s*translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(layer?.style.transform ?? '');
  if (!match) throw new Error('the board has not put a camera on the world layer yet');
  return { zoom: Number(match[1]), x: -Number(match[2]), y: -Number(match[3]) };
}

/** A world point as the screen point the pointer has to visit. */
export function toScreen(camera: Camera, world: Point): Point {
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/** The screen point over an object's centre. */
export function screenCentre(container: HTMLElement, object: ObjectSnapshot): Point {
  const bounds = objectBounds(object);
  return toScreen(cameraOf(container), { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

/** The screen point over a world point. */
export function screenOf(container: HTMLElement, world: Point): Point {
  return toScreen(cameraOf(container), world);
}

/** The snapshot of one object, by id. */
export function findObject(doc: Y.Doc, id: string): AnySnapshot | undefined {
  return objectsOf(doc).find((object) => object.id === id);
}

/** One object's shape snapshot, insisting it is a shape. */
export function findShape(doc: Y.Doc, id: string): ShapeSnap {
  const object = findObject(doc, id);
  if (!object || object.type !== 'shape') throw new Error(`${id} is not a shape on the board`);
  return object as ShapeSnap;
}

/** One object's arrow snapshot, insisting it is an arrow. */
export function findConnector(doc: Y.Doc, id: string): ConnectorSnap {
  const object = findObject(doc, id);
  if (!object || object.type !== 'connector') throw new Error(`${id} is not a connector on the board`);
  return object as ConnectorSnap;
}

/** The element that answers a press on an object's body. */
export function bodyOf(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-object-id="${id}"] [data-object-body], [data-object-id="${id}"][data-object-body]`);
  if (!el) throw new Error(`object ${id} has no rendered body`);
  return el;
}

/** Count the document updates a block of work produces (one per command). */
export function countUpdates(doc: Y.Doc, work: () => void): number {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  doc.on('update', listener);
  try {
    work();
  } finally {
    doc.off('update', listener);
  }
  return count;
}
