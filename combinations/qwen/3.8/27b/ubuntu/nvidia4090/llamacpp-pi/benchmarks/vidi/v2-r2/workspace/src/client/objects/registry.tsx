/**
 * Object type registry (story 7, sel.registry).
 *
 * Every object type registers one spec here. Selection, move, resize and
 * delete stay generic (sel.all_types); the spec only carries the per-type
 * knobs: the renderer component, resizability, the aspect lock, the minimum
 * size, whether the text is editable, and the hit test.
 *
 * Selection state is never written to the Y.Doc (sel.interaction contract).
 */
import * as Y from 'yjs';
import type { ComponentType } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { addKnownObjectType, objectBounds } from '../../shared/board-model';
import type { Point } from '../canvas/camera';
import { STICKY_MIN_SIZE_WORLD } from '../../shared/config';
import { StickyNote } from './StickyNote';

/**
 * Structural pointer event: satisfied by both React synthetic pointer events
 * and native PointerEvents.
 */
export interface GesturePointerEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly shiftKey: boolean;
  readonly button?: number;
  readonly pointerType?: string;
  stopPropagation(): void;
}

/**
 * Props every object component receives (sel.all_types). Objects only
 * report; the board owns selection, gestures and editing.
 */
export interface ObjectProps {
  doc: Y.Doc;
  obj: ObjectSnapshot;
  /** True when this object is in the current selection. */
  selected: boolean;
  /** The object currently in text editing mode (null when none). */
  editingId: string | null;
  /** Pointerdown on this object: the board routes it to selection + gesture. */
  onPointerDown(e: GesturePointerEvent, id: string): void;
  /** Double-click: start editing this object (only when the spec allows). */
  onEdit(id: string): void;
  /** End text editing: 'selected' (Escape) or 'unselected' (outside press). */
  onEndEdit(next: 'selected' | 'unselected'): void;
  /**
   * Close the undo capture window when text editing starts/ends (story 8,
   * undo.boundaries); optional so types without editable text need not care.
   */
  onTextBoundary?(): void;
  /** Ctrl/Cmd+Z inside the text editor: undo this tab's last step (story 8). */
  onTextUndo?(): void;
}

/** One registered object type. */
export interface ObjectTypeSpec {
  Component: ComponentType<ObjectProps>;
  /** Bounding-box resize handles are offered when any selected spec has this. */
  resizable: boolean;
  /** Resize keeps the width/height ratio (sticky notes stay square). */
  aspectLocked: boolean;
  /** Smallest side, in world units. Feeds clampScale in the transform gesture. */
  minSize: number;
  /** Double-click / Enter opens an inline text editor. */
  editableText: boolean;
  /** True when the world point hits the object. */
  hitTest(obj: ObjectSnapshot, worldPoint: Point): boolean;
}

const registry = new Map<string, ObjectTypeSpec>();

/**
 * Register an object type. Throws on duplicate registration (a programming
 * error: the same type must not be registered twice).
 */
export function registerObjectType(type: string, spec: ObjectTypeSpec): void {
  if (registry.has(type)) {
    throw new Error(`object type "${type}" is already registered`);
  }
  registry.set(type, spec);
  // The type is now known to the document layer (allObjectIds, objectBounds…).
  addKnownObjectType(type);
}

/** The spec for `type`, or undefined when the type is unknown to this client. */
export function getObjectType(type: string): ObjectTypeSpec | undefined {
  return registry.get(type);
}

// ---------------------------------------------------------------------------
// sticky
// ---------------------------------------------------------------------------

function pointWithinBounds(obj: ObjectSnapshot, p: Point): boolean {
  const b = objectBounds(obj);
  return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
}

registerObjectType('sticky', {
  Component: StickyNote,
  resizable: true,
  aspectLocked: true,
  minSize: STICKY_MIN_SIZE_WORLD,
  editableText: true,
  hitTest: pointWithinBounds,
});
