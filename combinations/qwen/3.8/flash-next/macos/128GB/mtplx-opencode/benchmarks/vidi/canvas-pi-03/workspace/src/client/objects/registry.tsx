import type { ReactNode } from 'react';
import type * as Y from 'yjs';
import type { AnySnapshot } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import type { TransformGesture } from '../board/transform-gesture';
import { StickyNote } from './StickyNote';
import { TextObject } from './TextObject';
import { ShapeObject } from './ShapeObject';
import { ConnectorObject } from './ConnectorObject';

/** Everything a renderer needs that is NOT part of the object itself: the board
 * the object lives in, the local selection, and the shared gesture. */
export interface RenderContext {
  doc: Y.Doc;
  camera: Camera;
  zoom: number;
  /** The ids taking part in the selection. */
  selected: ReadonlySet<string>;
  /** The object whose text editor is open, if any. */
  editingId: string | null;
  /** The group a move of this object drags along. */
  groupIds: readonly string[];
  /** The board's one transform gesture (contract `sel.transform`). */
  gesture: TransformGesture;
  /** False while the board cannot be edited. */
  editable: boolean;
  /** Every box on the board, keyed by id: what an arrow resolves against. */
  rects: ReadonlyMap<string, Rect>;
  /** Screen point → world point, for anything that aims at another object. */
  toWorld(screen: { x: number; y: number }): { x: number; y: number };
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

/**
 * The board's object renderers.
 *
 * Selection, moving, resizing, nudging and deleting are declared once per type
 * in `shared/object-types.ts`; this is the other half of the same registry:
 * which component draws a type. A type absent from here (and from the shared
 * spec table) renders nothing and selects nothing, which is the whole point of
 * having a table — a new object type is added by registering it, not by
 * threading another `if` through the board.
 *
 * Each entry returns an element keyed by the object id, because React needs the
 * key to survive a re-sort of the paint order.
 */
export function renderObject(object: AnySnapshot, ctx: RenderContext): ReactNode {
  const selected = ctx.selected.has(object.id);
  switch (object.type) {
    case 'sticky':
      return (
        <StickyNote
          key={object.id}
          note={object}
          doc={ctx.doc}
          zoom={ctx.zoom}
          selected={selected}
          groupIds={ctx.groupIds}
          gesture={ctx.gesture}
          editing={ctx.editingId === object.id}
          editable={ctx.editable}
          onSelect={ctx.onSelect}
          onStartEdit={ctx.onStartEdit}
          onEndEdit={ctx.onEndEdit}
        />
      );
    case 'text':
      return (
        <TextObject
          key={object.id}
          block={object}
          doc={ctx.doc}
          selected={selected}
          groupIds={ctx.groupIds}
          gesture={ctx.gesture}
          editing={ctx.editingId === object.id}
          editable={ctx.editable}
          onSelect={ctx.onSelect}
          onStartEdit={ctx.onStartEdit}
          onEndEdit={ctx.onEndEdit}
        />
      );
    case 'shape':
      return (
        <ShapeObject
          key={object.id}
          shape={object}
          doc={ctx.doc}
          zoom={ctx.zoom}
          selected={selected}
          groupIds={ctx.groupIds}
          gesture={ctx.gesture}
          editing={ctx.editingId === object.id}
          editable={ctx.editable}
          onSelect={ctx.onSelect}
          onStartEdit={ctx.onStartEdit}
          onEndEdit={ctx.onEndEdit}
        />
      );
    case 'connector':
      return (
        <ConnectorObject
          key={object.id}
          connector={object}
          rects={ctx.rects}
          doc={ctx.doc}
          selected={selected}
          zoom={ctx.zoom}
          toWorld={ctx.toWorld}
          editable={ctx.editable}
          onSelect={ctx.onSelect}
        />
      );
    default:
      return null;
  }
}
