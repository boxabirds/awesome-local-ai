import * as Y from 'yjs';
import {
  createSticky,
  deleteObject,
  deleteObjects,
  getStickyText,
  setStickyColor,
  snapshot,
} from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import { createConnector, type Endpoint } from '../../shared/objects/connector';
import {
  createStroke,
  strokeBBox,
  strokePathData,
  toPoints,
  type StrokeSnap,
} from '../../shared/objects/stroke';
import type { PenColor, PenThickness } from '../../shared/config';
import type { Camera } from './camera';
import type { CameraApi } from './useCamera';
import type { ConnectionState } from '../sync/connectBoard';
import type { BoardSession } from '../sync/boardSession';

/**
 * Test-only handle on the live app (design "Test seams").
 *
 * The camera part lets an e2e test jump far away instead of dragging a million
 * pixels. The note part lets a test reach a state the UI cannot produce in one
 * gesture - two overlapping notes, a note with a 1,000 character text - by
 * going through the very same model functions the app uses, so the fixture is
 * subject to the same rules as real input.
 *
 * The connection part (story 3) lets a test cut a live link and watch the
 * board catch up afterwards, which is the only way to test the PRD's 30-second
 * outage without waiting 30 seconds in every run.
 *
 * Installed only when `import.meta.env.MODE === 'test'`: production builds
 * contain no hook.
 */

/** One board object as the app currently renders it, in paint order. */
export interface StickyNoteHook {
  id: string;
  type: string;
  /** Top-left corner, world units. */
  x: number;
  y: number;
  /** Paint order: a lower z is painted first, i.e. below. */
  z: number;
  color: StickyColor;
  text: string;
}

export interface SeedNote {
  /** Centre of the new note, world units (the same convention as createSticky). */
  x: number;
  y: number;
  color?: StickyColor;
  text?: string;
}

export interface TextObjectHook {
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

export interface ShapeHook {
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

export interface ConnectorHook {
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

export interface SeedShape {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  at?: { x: number; y: number };
}

export interface SeedConnector {
  fromId: string | null;
  toId: string | null;
  fromFallback: { x: number; y: number };
  toFallback: { x: number; y: number };
}

/** One stroke as the live document holds it, in paint order. */
export interface StrokeHook {
  id: string;
  type: 'stroke';
  /** Top-left of the ink's box, world units. */
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  color: string;
  thickness: string;
  closed: boolean;
  /** How many points the ink is drawn from. */
  pointCount: number;
  /** The ink itself, flattened and relative to `x`/`y`. */
  points: number[];
  /** The path it is drawn with, for a test that compares a drawing to itself. */
  path: string;
}

export interface SeedStroke {
  /** The ink, as absolute world coordinates: `[x0, y0, x1, y1, …]`. */
  points: number[];
  color?: string;
  thickness?: string;
  closed?: boolean;
}

export interface BoardTestHooks {
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  getCamera(): Camera;
  /** The objects on the board, lowest z first. */
  getNotes(): StickyNoteHook[];
  /** The text objects on the board, lowest z first. */
  getTexts(): TextObjectHook[];
  /** Adds a note through the board model and returns its id ('' if refused). */
  seedNote(note: SeedNote): string;
  /** Get shape objects from the document. */
  getShapes(): ShapeHook[];
  /** Get connector objects from the document. */
  getConnectors(): ConnectorHook[];
  /** Seed a shape through the model. */
  seedShape(seed: SeedShape): string;
  /** Seed a connector through the model. */
  seedConnector(seed: SeedConnector): string;
  /** The document's strokes, lowest z first. */
  getStrokes(): StrokeHook[];
  /**
   * Puts a drawing on the board through `createStroke`, from absolute world
   * points, and returns its id ('' when the model refuses it).
   */
  seedStroke(seed: SeedStroke): string;
  /**
   * Removes a note while the pointer is still down, for interruption tests. Raw:
   * this is the single-object delete, which leaves any connector that pointed at
   * the object attached to a missing id.
   */
  removeNote(id: string): boolean;
  /**
   * Deletes through the product's own path: `deleteObjects`, what the Delete key
   * runs, which detaches the connectors that pointed at what was deleted.
   */
  removeObjects(ids: string[]): number;
  getDoc(): Y.Doc | null;
  /** The room this board is shared in, or `'local'`. */
  getBoardId(): string;
  /** The socket URL of the room, or `null` for a local board. */
  getRoomUrl(): string | null;
  /** The connection state the badge is showing. */
  getConnectionState(): ConnectionState;
  /**
   * Cuts the live link without unmounting the board, so a test can watch the
   * reconnect and the catch-up. Returns false when there is no link to cut.
   */
  dropConnection(): boolean;
}

declare global {
  interface Window {
    __vidi6?: BoardTestHooks;
  }
}

export function installBoardTestHooks(
  getApi: () => CameraApi | null,
  getSession: () => BoardSession | null = () => null,
): void {
  if (typeof window === 'undefined') return;
  if (import.meta.env.MODE !== 'test') return;

  const hooks: BoardTestHooks = {
    setCamera(camera) {
      getApi()?.setCamera({
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
      });
    },
    getCamera() {
      return getApi()?.camera ?? { x: 0, y: 0, zoom: 1 };
    },
    getNotes() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'sticky')
        .map((row) => ({
          id: row.id,
          type: row.type,
          x: row.x,
          y: row.y,
          z: row.z,
          color: (row as any).color ?? 'yellow',
          text: row.text,
        }));
    },
    seedNote(note: SeedNote) {
      const session = getSession();
      if (!session) return '';
      const id = createSticky(session.doc, { x: note.x, y: note.y }, note.color);
      if (!id) return '';
      if (note.color) setStickyColor(session.doc, id, note.color);
      if (note.text) getStickyText(session.doc, id)?.insert(0, note.text);
      return id;
    },
    getTexts() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'text')
        .map((row) => ({
          id: row.id,
          type: 'text' as const,
          x: row.x,
          y: row.y,
          width: (row as any).width ?? 80,
          height: (row as any).height ?? 26,
          z: row.z,
          text: (row as any).text,
          size: (row as any).size ?? 'M',
          widthMode: ((row as any).widthMode ?? 'auto') as 'auto' | 'fixed',
        }));
    },
    getShapes() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'shape')
        .map((row) => ({
          id: row.id,
          type: 'shape' as const,
          x: row.x,
          y: row.y,
          width: (row as any).width ?? 160,
          height: (row as any).height ?? 160,
          z: row.z,
          kind: (row as any).kind ?? 'rect',
          fill: (row as any).fill ?? 'lightBlue',
          stroke: (row as any).stroke ?? 'charcoal',
          label: (row as any).label ?? '',
        }));
    },
    getConnectors() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'connector')
        .map((row) => ({
          id: row.id,
          type: 'connector' as const,
          x: row.x,
          y: row.y,
          width: (row as any).width ?? 0,
          height: (row as any).height ?? 0,
          z: row.z,
          fromKind: (row as any).from?.kind ?? 'free',
          toKind: (row as any).to?.kind ?? 'free',
          fromId: (row as any).from?.objectId,
          toId: (row as any).to?.objectId,
        }));
    },
    seedShape(seed: SeedShape) {
      const session = getSession();
      if (!session) return '';
      const id = createShape(session.doc, {
        kind: seed.kind as any,
        rect: { x: seed.x, y: seed.y, width: seed.width, height: seed.height },
        at: seed.at ?? { x: seed.x + seed.width / 2, y: seed.y + seed.height / 2 },
      }, 'seed');
      return id ?? '';
    },
    seedConnector(seed: SeedConnector) {
      const session = getSession();
      if (!session) return '';
      const from: Endpoint = seed.fromId
        ? { kind: 'attached', objectId: seed.fromId, fallback: seed.fromFallback }
        : { kind: 'free', x: seed.fromFallback.x, y: seed.fromFallback.y };
      const to: Endpoint = seed.toId
        ? { kind: 'attached', objectId: seed.toId, fallback: seed.toFallback }
        : { kind: 'free', x: seed.toFallback.x, y: seed.toFallback.y };
      const id = createConnector(session.doc, from, to, 'seed');
      return id ?? '';
    },
    getStrokes() {
      const session = getSession();
      if (!session) return [];
      return snapshot(session.doc)
        .filter((row) => row.type === 'stroke')
        .map((row) => {
          const stroke = row as StrokeSnap;
          return {
            id: stroke.id,
            type: 'stroke' as const,
            x: stroke.x,
            y: stroke.y,
            width: stroke.width,
            height: stroke.height,
            z: stroke.z,
            color: stroke.color,
            thickness: stroke.thickness,
            closed: stroke.closed,
            pointCount: stroke.points.length / 2,
            points: [...stroke.points],
            path: strokePathData(stroke),
          };
        });
    },
    seedStroke(seed: SeedStroke) {
      const session = getSession();
      if (!session) return '';
      if (seed.points.length < 4) return '';
      // The ink in the document lives relative to the object's own box, so a seed
      // that names absolute points is moved to its own origin first: the hook
      // takes the coordinates a test can see on screen and hands the model the
      // same shape a drawn stroke has.
      const ink = toPoints(seed.points);
      const box = strokeBBox(ink);
      const flat: number[] = [];
      for (const point of ink) flat.push(point.x - box.x, point.y - box.y);
      return createStroke(session.doc, flat, { x: box.x, y: box.y }, {
        color: seed.color as PenColor | undefined,
        thickness: seed.thickness as PenThickness | undefined,
        closed: seed.closed === true,
        by: 'seed',
      });
    },
    removeNote(id: string) {
      const session = getSession();
      if (!session) return false;
      return deleteObject(session.doc, id);
    },
    removeObjects(ids: string[]) {
      const session = getSession();
      if (!session) return 0;
      return deleteObjects(session.doc, ids);
    },
    getDoc() {
      return getSession()?.doc ?? null;
    },
    getBoardId() {
      return getSession()?.boardId ?? 'local';
    },
    getRoomUrl() {
      return getSession()?.url ?? null;
    },
    getConnectionState() {
      return getSession()?.connection?.getState() ?? 'connected';
    },
    dropConnection() {
      const provider = getSession()?.connection?.provider as
        | { ws?: { close(): void } }
        | undefined;
      const socket = provider?.ws;
      if (!socket) return false;
      socket.close();
      return true;
    },
  };

  window.__vidi6 = hooks;
}

export function removeBoardTestHooks(): void {
  if (typeof window === 'undefined') return;
  delete window.__vidi6;
}
