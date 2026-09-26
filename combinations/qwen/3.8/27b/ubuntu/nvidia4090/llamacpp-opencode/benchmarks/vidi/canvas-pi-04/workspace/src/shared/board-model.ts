// Story 2: the Yjs board document model (anchor: board.model).
//
// This module owns the document schema and every mutation. It is
// framework-free (no React) so the Durable Object of story 4 can import it.
// Selection and editing state are deliberately NOT here: they are per-client
// UI state (see useSelection) and must not be stored in the shared document.
//
// Task 2.1 stub: the exports carry the final contract; bodies throw
// "not implemented" until task 2.2.

import type * as Y from 'yjs';
import type { StickyColor } from './config';

/**
 * Transaction origin for all local (this client's user) mutations.
 * Story 8 (undo) and story 3 (echo avoidance) key off this symbol.
 */
export const LOCAL_ORIGIN: unique symbol = Symbol('vidi6.local-origin');

/** Immutable view of one sticky note, as rendered by React. */
export interface StickySnapshot {
  id: string;
  type: 'sticky';
  /** Top-left corner in world units. */
  x: number;
  /** Top-left corner in world units. */
  y: number;
  color: StickyColor;
  text: string;
  /** Stacking order; higher draws on top. */
  z: number;
  /** Epoch ms. */
  createdAt: number;
}

function notImplemented(): never {
  throw new Error('not implemented');
}

/** Set `meta.schemaVersion = 1` when absent. */
export function initDoc(_doc: Y.Doc): void {
  notImplemented();
}

/**
 * Create a yellow-by-default sticky centred on `at`, on top of everything,
 * and return its new id. Returns '' (no object, no update) when the
 * coordinates are not finite.
 */
export function createSticky(
  _doc: Y.Doc,
  _at: { x: number; y: number },
  _color?: StickyColor,
): string {
  notImplemented();
}

/** Move an object's top-left to world (x, y); false (no update) when rejected. */
export function moveObject(_doc: Y.Doc, _id: string, _x: number, _y: number): boolean {
  notImplemented();
}

/**
 * Raise an object above all others (z = maxZ + 1). No-op (false, no update)
 * when the object is already topmost or the id is unknown.
 */
export function bringToFront(_doc: Y.Doc, _id: string): boolean {
  notImplemented();
}

/** Set a sticky's colour to a preset colour name; false (no update) when rejected. */
export function setStickyColor(_doc: Y.Doc, _id: string, _color: string): boolean {
  notImplemented();
}

/** Remove an object by id; false (no update) when the id is unknown. */
export function deleteObject(_doc: Y.Doc, _id: string): boolean {
  notImplemented();
}

/** The live Y.Text of a sticky, or undefined for unknown ids / other types. */
export function getStickyText(_doc: Y.Doc, _id: string): Y.Text | undefined {
  notImplemented();
}

/**
 * Immutable snapshot of all sticky notes, sorted by (z, id); objects with an
 * unknown `type` are skipped (forward compatibility with stories 9-12).
 */
export function snapshot(_doc: Y.Doc): readonly StickySnapshot[] {
  notImplemented();
}
