// Test-only hooks, installed only in builds made with `--mode test`.
// Production builds never expose window.__vidi6.

import type * as Y from 'yjs';
import type { BoardConnection } from '../sync/connectBoard';
import type { CameraApi } from './useCamera';
import {
  bringToFront,
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  objectBounds,
  objectsSnapshot,
  setStickyColor,
} from '../../shared/board-model';
import { SHAPE_DEFAULT_SIZE_WORLD, STICKY_COLORS, type ShapeKind, type StickyColor } from '../../shared/config';
import { getTextContent, textSnapshot } from '../../shared/objects/text';
import { createShape, shapeSnapshot } from '../../shared/objects/shape';
import { connectorSnapshot, createConnector, connectorResolved, setConnectorEndpoint } from '../../shared/objects/connector';
import { strokeSnapshot } from '../../shared/objects/stroke';
import { nearestSide, sideAnchor } from '../../shared/geometry/connector-geometry';

export interface Vidi6TestApi {
  /** Current connection badge state (story 3): connecting | connected |
   *  reconnecting | confirmed. */
  readonly connectionState: string;
  /** Story 12 (image.unavailable): this session's client id. */
  readonly clientId: string;
  setCamera(x: number, y: number, zoom: number): void;
  /** Creates a sticky centred on a world point; returns its id (or null). */
  createSticky(x: number, y: number, color?: string): string | null;
  /** Current sticky snapshots (id, position, size, colour, text, stacking).
   *  width/height are null while the note keeps its implicit default size. */
  getStickyNotes(): Array<{
    id: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    color: string;
    text: string;
    z: number;
  }>;
  /** Snapshot of every object on the board (all known types). */
  getAllObjects(): Array<{
    id: string;
    type: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    text: string;
    z: number;
  }>;
  /** Story 9: every text object with its extended fields (size/widthMode). */
  getTextObjects(): Array<{
    id: string;
    x: number;
    y: number;
    width: number | null;
    height: number | null;
    text: string;
    size: string | null;
    widthMode: 'auto' | 'fixed' | null;
    z: number;
  }>;
  /** Story 9: sets a text object's text (test seeding; replaces content). */
  setTextObjectText(id: string, text: string): boolean;
  /** Ids of all currently selected objects (empty when nothing is selected). */
  getSelectedIds(): string[];
  /** Id of the currently selected note, or null (only for a single note
   *  selection; legacy helper kept for earlier stories' tests). */
  selectedStickyId(): string | null;
  /** The current camera (x, y, zoom) in world units. */
  getCamera(): { x: number; y: number; zoom: number };
  deleteSticky(id: string): boolean;
  moveSticky(id: string, x: number, y: number): boolean;
  bringStickyToFront(id: string): boolean;
  setStickyColor(id: string, color: string): boolean;
  /** Replaces a note's text (test seeding). */
  setStickyText(id: string, text: string): boolean;
  /** Test-only: provider connection internals (diagnosing sync issues). */
  connectionDebug(): { status: string; synced: boolean; wsconnected: boolean; wsReadyState: number | null } | null;
  /** Simulates a network drop for this client (badge → Reconnecting…). */
  dropConnection(): void;
  /** Restores the network, letting the client reconnect. */
  restoreConnection(): void;
  /** Transform-gesture start/end counts (story 7: TC-26). */
  getGestureEvents(): { start: number; end: number };
  /** Story 10: creates a shape (top-left at `x`,`y`, standard size, kind
   *  defaults to 'rect'); returns the id (null when rejected). */
  createShape(x: number, y: number, kind?: ShapeKind): string | null;
  /** Story 10: the shapes (id, x, y, width, height, kind, fill, stroke,
   *  label, z), world coordinates, ascending z. */
  getShapes(): Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    kind: ShapeKind;
    fill: string;
    stroke: string;
    label: string;
    z: number;
  }>;
  /** Story 11: the strokes with their extended fields (points in base
   *  coordinates, colour, thickness), ascending z. */
  getStrokes(): Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    baseWidth: number;
    baseHeight: number;
    color: string;
    thickness: string;
    points: number[];
    z: number;
  }>;
  /** Story 10: the connectors with their RAW stored endpoints plus the
   *  RESOLVED world line points (ascending z). */
  getConnectors(): Array<{
    id: string;
    z: number;
    from: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
    to: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
    fromPoint: { x: number; y: number };
    toPoint: { x: number; y: number };
  }>;
  /** Story 10: creates a connector between two objects (both ends
   *  attached, anchors computed); returns the id (null when rejected). */
  createConnectorBetween(fromId: string, toId: string): string | null;
  /** Story 10: reattaches a connector end — to `targetId` (an object id,
   *  anchor computed) or to a FREE point (`targetId` null, at x,y). Returns
   *  false when rejected (the TC-27 concurrent-race test drives this). */
  reattachConnectorEnd(id: string, end: 'from' | 'to', targetId: string | null, x: number, y: number): boolean;
  /** Story 10: the checkout-flow fixture — 4 shapes in a row (Cart rect,
   *  Paid? diamond, Verify ellipse, Shipped rect) with 3 attached
   *  connectors between them and one connector whose second end is FREE.
   *  Returns {shapes, connectors} (ids) or null when rejected. */
  seedCheckoutFlow(): {
    shapes: [string, string, string, string];
    connectors: [string, string, string, string];
  } | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestApi;
  }
}

function testColor(color: string | undefined): StickyColor | undefined {
  return color !== undefined && color in STICKY_COLORS ? (color as StickyColor) : undefined;
}

export function installTestHooks(
  getApi: () => CameraApi,
  getDoc: () => Y.Doc | null,
  getConnectionState: () => string,
  getConnection: () => BoardConnection | null,
  getSelectedIds: () => string[],
  getGestureEvents?: () => { start: number; end: number },
  getClientId?: () => string,
): void {
  if (import.meta.env.MODE !== 'test') return;
  (window as unknown as Record<string, unknown>).__vidi6Doc = getDoc();
  window.__vidi6 = {
    get connectionState() {
      return getConnectionState();
    },
    // Story 12 (image.unavailable): the session client id, so tests can
    // make an image's uploaderId match THIS client (uploader-only UI).
    get clientId() {
      return getClientId?.() ?? '';
    },
    setCamera(x, y, zoom) {
      getApi().setCamera({ x, y, zoom });
    },
    createSticky(x, y, color) {
      const doc = getDoc();
      if (!doc) return null;
      const id = createSticky(doc, { x, y }, testColor(color));
      return id === '' ? null : id;
    },
    getStickyNotes() {
      const doc = getDoc();
      if (!doc) return [];
      return objectsSnapshot(doc)
        .filter((o) => o.type === 'sticky')
        .map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          width: n.width ?? null,
          height: n.height ?? null,
          color: n.color ?? 'yellow',
          text: n.text,
          z: n.z,
        }));
    },
    getAllObjects() {
      const doc = getDoc();
      if (doc === null) return [];
      return objectsSnapshot(doc).map((o) => ({
        id: o.id,
        type: o.type,
        x: o.x,
        y: o.y,
        width: o.width ?? null,
        height: o.height ?? null,
        text: o.text,
        z: o.z,
      }));
    },
    getTextObjects() {
      const doc = getDoc();
      if (doc === null) return [];
      return objectsSnapshot(doc)
        .filter((o) => o.type === 'text')
        .map((o) => {
          const snap = textSnapshot(doc, o.id);
          return {
            id: o.id,
            x: o.x,
            y: o.y,
            width: o.width ?? null,
            height: o.height ?? null,
            text: o.text,
            size: snap?.size ?? null,
            widthMode: snap?.widthMode ?? null,
            z: o.z,
          };
        });
    },
    setTextObjectText(id, text) {
      const doc = getDoc();
      if (doc === null) return false;
      if (textSnapshot(doc, id) === null) return false;
      const y = getTextContent(doc, id);
      if (y === undefined) return false;
      y.delete(0, y.length);
      if (text !== '') y.insert(0, text);
      return true;
    },
    getSelectedIds() {
      return getSelectedIds();
    },
    selectedStickyId() {
      const ids = getSelectedIds();
      return ids.length === 1 ? ids[0] : null;
    },
    getCamera() {
      const c = getApi().camera;
      return { x: c.x, y: c.y, zoom: c.zoom };
    },
    deleteSticky(id) {
      const doc = getDoc();
      return doc ? deleteObject(doc, id) : false;
    },
    moveSticky(id, x, y) {
      const doc = getDoc();
      return doc ? moveObject(doc, id, x, y) : false;
    },
    bringStickyToFront(id) {
      const doc = getDoc();
      return doc ? bringToFront(doc, id) : false;
    },
    setStickyColor(id, color) {
      const doc = getDoc();
      return doc ? setStickyColor(doc, id, color) : false;
    },
    setStickyText(id, text) {
      const doc = getDoc();
      if (doc === null || !objectsSnapshot(doc).some((n) => n.id === id)) return false;
      getStickyText(doc, id)?.insert(0, text);
      return true;
    },
    connectionDebug() {
      return getConnection()?.debug?.() ?? null;
    },
    dropConnection() {
      getConnection()?.dropNetwork?.();
    },
    restoreConnection() {
      getConnection()?.restoreNetwork?.();
    },
    getGestureEvents() {
      return getGestureEvents?.() ?? { start: 0, end: 0 };
    },
    createShape(x, y, kind = 'rect') {
      const doc = getDoc();
      if (!doc) return null;
      const id = createShape(doc, {
        kind,
        rect: { x, y, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD },
        at: { x, y },
      }, 'test');
      return id === null ? null : id;
    },
    getShapes() {
      const doc = getDoc();
      if (!doc) return [];
      return objectsSnapshot(doc)
        .filter((o) => o.type === 'shape')
        .map((o) => {
          const snap = shapeSnapshot(doc, o.id) ?? { kind: 'rect' as const, fill: 'white' as const, stroke: 'dark' as const, label: '' };
          return {
            id: o.id,
            x: o.x,
            y: o.y,
            width: o.width ?? SHAPE_DEFAULT_SIZE_WORLD,
            height: o.height ?? SHAPE_DEFAULT_SIZE_WORLD,
            kind: snap.kind,
            fill: snap.fill,
            stroke: snap.stroke,
            label: snap.label,
            z: o.z,
          };
        });
    },
    getStrokes() {
      const doc = getDoc();
      if (!doc) return [];
      return objectsSnapshot(doc)
        .filter((o) => o.type === 'stroke')
        .map((o) => {
          const snap = strokeSnapshot(doc, o.id);
          if (snap === null) {
            // Defensive: a corrupt stroke is invisible to the renderer too.
            return null;
          }
          return {
            id: o.id,
            x: o.x,
            y: o.y,
            width: o.width ?? 0,
            height: o.height ?? 0,
            baseWidth: snap.baseWidth,
            baseHeight: snap.baseHeight,
            color: snap.color,
            thickness: snap.thickness,
            points: [...snap.points],
            z: o.z,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);
    },
    getConnectors() {
      const doc = getDoc();
      if (!doc) return [];
      const out: Array<{
        id: string;
        z: number;
        from: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
        to: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number };
        fromPoint: { x: number; y: number };
        toPoint: { x: number; y: number };
      }> = [];
      for (const o of objectsSnapshot(doc)) {
        if (o.type !== 'connector') continue;
        const snap = connectorSnapshot(doc, o.id);
        const line = connectorResolved(doc, o.id);
        if (snap === null || line === null) continue;
        const raw = (e: { kind: 'attached'; objectId: string } | { kind: 'free'; x: number; y: number }) =>
          e.kind === 'attached'
            ? { kind: 'attached' as const, objectId: e.objectId }
            : { kind: 'free' as const, x: e.x, y: e.y };
        out.push({
          id: o.id,
          z: o.z,
          from: raw(snap.from),
          to: raw(snap.to),
          fromPoint: line.from,
          toPoint: line.to,
        });
      }
      return out;
    },
    createConnectorBetween(fromId, toId) {
      const doc = getDoc();
      if (!doc) return null;
      return createConnector(
        doc,
        { kind: 'attached', objectId: fromId, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: toId, fallback: { x: 0, y: 0 } },
        'test',
      );
    },
    reattachConnectorEnd(id, end, targetId, x, y) {
      const doc = getDoc();
      if (!doc) return false;
      if (targetId !== null) {
        const target = objectsSnapshot(doc).find((o) => o.id === targetId && o.type !== 'connector');
        if (target === undefined) return false;
        const r = objectBounds(target);
        const line = connectorResolved(doc, id);
        const anchorFrom = line !== null ? (end === 'to' ? line.from : line.to) : { x, y };
        return setConnectorEndpoint(doc, id, end, {
          kind: 'attached',
          objectId: targetId,
          fallback: sideAnchor(r, nearestSide(r, anchorFrom)),
        });
      }
      return setConnectorEndpoint(doc, id, end, { kind: 'free', x, y });
    },
    seedCheckoutFlow() {
      const doc = getDoc();
      if (!doc) return null;
      const S = SHAPE_DEFAULT_SIZE_WORLD; // 160
      // Four shapes in a row, 140px gaps (world): Cart (rect) x 0,
      // Paid? (diamond) x 300, Verify (ellipse) x 600, Shipped (rect) x 900;
      // all at y 0 (rects 160 wide → right edges 160/460/760/1060).
      const cart = createShape(doc, { kind: 'rect', rect: { x: 0, y: 0, width: S, height: S }, at: { x: 0, y: 0 } }, 'test');
      const paid = createShape(doc, { kind: 'diamond', rect: { x: 300, y: 0, width: S, height: S }, at: { x: 300, y: 0 } }, 'test');
      const verify = createShape(doc, { kind: 'ellipse', rect: { x: 600, y: 0, width: S, height: S }, at: { x: 600, y: 0 } }, 'test');
      const shipped = createShape(doc, { kind: 'rect', rect: { x: 900, y: 0, width: S, height: S }, at: { x: 900, y: 0 } }, 'test');
      if (cart === null || paid === null || verify === null || shipped === null) return null;
      const c1 = createConnector(
        doc,
        { kind: 'attached', objectId: cart, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: paid, fallback: { x: 0, y: 0 } },
        'test',
      );
      const c2 = createConnector(
        doc,
        { kind: 'attached', objectId: paid, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: verify, fallback: { x: 0, y: 0 } },
        'test',
      );
      const c3 = createConnector(
        doc,
        { kind: 'attached', objectId: verify, fallback: { x: 0, y: 0 } },
        { kind: 'attached', objectId: shipped, fallback: { x: 0, y: 0 } },
        'test',
      );
      // One connector whose second end is FREE: from Shipped's right anchor
      // (1060, 80) to a free point further right (1200, 80).
      const c4 = createConnector(
        doc,
        { kind: 'attached', objectId: shipped, fallback: { x: 1060, y: 80 } },
        { kind: 'free', x: 1200, y: 80 },
        'test',
      );
      if (c1 === null || c2 === null || c3 === null || c4 === null) return null;
      return { shapes: [cart, paid, verify, shipped], connectors: [c1, c2, c3, c4] };
    },
  };
}
