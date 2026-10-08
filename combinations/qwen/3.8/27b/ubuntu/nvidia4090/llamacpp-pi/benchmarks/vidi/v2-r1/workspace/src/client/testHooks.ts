// Test-only hooks (story 1 fixture + story 2).
// Installed only when import.meta.env.MODE === 'test' (vitest and the e2e
// dev server run with --mode test), so they are excluded from production
// builds.

import type * as Y from 'yjs';
import type { Camera } from './canvas/camera';

export interface Vidi6NoteInfo {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
}

/** Story 7: a known object with resolved (fallback-applied) bounds. */
export interface Vidi6ObjectInfo {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text: string;
  z: number;
  /** Size preset (text objects only, story 9). */
  size?: string;
  /** 'auto' | 'fixed' (text objects only, story 9). */
  widthMode?: 'auto' | 'fixed';
  // --- Story 10 (shapes and connectors) ------------------------------------
  /** Shape kind (shape objects only). */
  kind?: 'rect' | 'ellipse' | 'diamond';
  /** Fill colour name (shape objects only). */
  fill?: string;
  /** Outline colour name (shape objects only). */
  stroke?: string;
  /** The label text (shape objects only). */
  label?: string;
  /** Resolved endpoint points (connector objects only). */
  fromPoint?: { x: number; y: number };
  toPoint?: { x: number; y: number };
  /** Endpoint kinds (connector objects only); attached drops the fallback. */
  from?: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string };
  to?: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string };
  // --- Story 11 (strokes) ----------------------------------------------------
  /** Flattened [x0, y0, x1, y1, ...] relative to the bbox origin (strokes only). */
  points?: number[];
  /** Bbox size at creation (strokes only); the render scale is width/baseWidth. */
  baseWidth?: number;
  baseHeight?: number;
  /** 'thin' | 'medium' | 'thick' (strokes only). */
  thickness?: string;
}

export interface Vidi6TestHooks {
  /** The in-memory board document. */
  readonly doc: Y.Doc;
  getCamera(): Camera;
  setCamera(cam: Camera): void;
  /** Current notes (id, world top-left, colour, text, stacking z). */
  getNotes(): Vidi6NoteInfo[];
  /** Current known objects (story 7), with width/height resolved. */
  getObjects(): Vidi6ObjectInfo[];
  /** Current connection state. */
  getConnectionState(): string;
  /** Create a note at the center of the viewport. */
  createNote(): void;
  /**
   * Create a note centred at world (x, y) with a colour and text, returning
   * its id (null on failure). For deterministic board seeding in e2e.
   */
  createNoteAt(x: number, y: number, color: string, text: string): string | null;
  /** Story 8: undo one of this tab's steps. false on an empty stack. */
  undo(): boolean;
  /** Story 8: redo one of this tab's steps. false on an empty stack. */
  redo(): boolean;
  /** Story 8: start a new undo step (end the current capture interval). */
  boundary(): void;
  /** Story 8: whether undo() would consume a step. */
  canUndo(): boolean;
  /** Story 8: whether redo() would consume a step. */
  canRedo(): boolean;
  /** Story 10: create a shape at a world point (or covering a rect). */
  createShape(a: {
    kind: 'rect' | 'ellipse' | 'diamond';
    rect: { x: number; y: number; width: number; height: number } | null;
    at: { x: number; y: number };
    square?: boolean;
  }): string | null;
  /** Story 10: set a shape's label text. */
  setShapeLabel(id: string, text: string): void;
  /** Story 10: create a connector between two endpoints. */
  createConnector(
    from: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string },
    to: { kind: 'free'; x: number; y: number } | { kind: 'attached'; objectId: string },
  ): string | null;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

export function isTestMode(): boolean {
  return import.meta.env.MODE === 'test';
}
