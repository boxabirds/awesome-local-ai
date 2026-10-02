// The Shape tool: a drag on the board draws a shape, a click makes a standard one.
//
// It watches the pointer on the window, in the capturing phase, and stops every
// event it is acting on. That is the only way a drag can be owned by a tool on
// this board: the objects under the pointer stop propagation themselves — that is
// how a drag of a note works — and the viewport stops it too, so a tool that
// listened further down would hear nothing whenever it was pointed at something,
// which is most of what a shape is drawn over. Listening first and stopping means
// the board never pans and no note moves while a shape is being drawn, and that
// the tool hears the press even when it lands on a shape that is already there.
//
// What it draws is decided by the model (`createShape`), because the line between
// a drag and a click, the effect of Shift and the size a click makes are the same
// rules whatever the pointer looked like while it was doing it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';
export interface ShapeToolOptions {
  doc: Y.Doc;
  /** The camera the drag is converted with, at the moment the drag ends. */
  camera: Camera;
  /** The Shape tool is the board's active tool. */
  active: boolean;
  /** The board can be written to. A tool that cannot be used is not entered. */
  canEdit: boolean;
  /** The kind the menu chose, read when the shape is made. */
  kind: ShapeKind;
  undo?: UndoController;
  /** A shape was made: select it, and go back to Select. */
  onCreated(id: string): void;
}

export interface ShapeToolResult {
  /** The drag in flight, in the viewport's own screen coordinates, or null. */
  preview: Rect | null;
  /** The tool is waiting for a drag to be drawn. Only the preview says anything. */
  onSurfacePointerDown?(e: ReactPointerEvent<HTMLDivElement>): void;
}

/** A drag in flight, in screen coordinates, plus the point it started from. */
interface Drag {
  startX: number;
  startY: number;
  x: number;
  y: number;
  pointerId: number;
}

export function useShapeTool(options: ShapeToolOptions): ShapeToolResult {
  const [preview, setPreview] = useState<Rect | null>(null);
  const opts = useRef(options);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    opts.current = options;
  });

  // The listener is on the window for as long as the tool is the one the board
  // is in, and nothing more: leaving the tool — by Escape, by the toolbar, by a
  // shape being drawn — takes it away, and with it the drag that was in flight.
  useEffect(() => {
    if (!options.active || !options.canEdit) return;

    /** The board's surface, when this event is a press on it or on something in it. */
    const surfaceOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      // A press on a toolbar — the note's, the shape's, the board's — belongs to
      // that toolbar, and a press in a box being typed into belongs to the typing.
      if (target.closest('[role="toolbar"]') !== null) return null;
      if (target.closest('textarea') !== null) return null;
      return target.closest<HTMLElement>('[data-testid="board-viewport"]');
    };

    const relative = (surface: HTMLElement, clientX: number, clientY: number): Point => {
      const rect = surface.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      const surface = surfaceOf(e.target);
      if (surface === null) return;
      const from = relative(surface, e.clientX, e.clientY);
      drag.current = { startX: from.x, startY: from.y, x: from.x, y: from.y, pointerId: e.pointerId };
      // Nothing else is to see this drag: not the viewport, which would pan, and
      // not the object under the pointer, which would start moving itself.
      e.stopPropagation();
      e.preventDefault();
      setPreview({ x: from.x, y: from.y, width: 0, height: 0 });
    };

    const onPointerMove = (e: PointerEvent) => {
      const held = drag.current;
      if (held === null || e.pointerId !== held.pointerId) return;
      const surface = surfaceOf(e.target);
      const base = surface ?? document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (base === null) return;
      const to = relative(base, e.clientX, e.clientY);
      held.x = to.x;
      held.y = to.y;
      e.stopPropagation();
      setPreview(position(held));
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const held = drag.current;
      drag.current = null;
      if (held === null || e.pointerId !== held.pointerId) return;
      e.stopPropagation();
      setPreview(null);
      if (cancelled) return;

      const current = opts.current;
      const surface = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (surface === null) return;
      // Screen coordinates relative to the surface are what the camera works in.
      const from = screenToWorld(current.camera, { x: held.startX, y: held.startY });
      const to = screenToWorld(current.camera, { x: held.x, y: held.y });
      const dragged = Math.hypot(held.x - held.startX, held.y - held.startY) >= DRAG_THRESHOLD_PX;
      // A drag shorter than the threshold is a click, and a click is a shape of
      // the standard size centred on the point; both go to the model, which owns
      // that line and the size that follows from it (shape.create_click).
      const id = make(current, {
        kind: current.kind,
        rect: dragged ? normalizeRect(from, to) : null,
        at: from,
        square: e.shiftKey,
      });
      if (id !== null) current.onCreated(id);
    };

    const onPointerUp = (e: PointerEvent) => {
      finish(e, false);
    };
    const onPointerCancel = (e: PointerEvent) => {
      finish(e, true);
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
      drag.current = null;
      setPreview(null);
    };
  }, [options.active, options.canEdit]);

  const onSurfacePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    void e;
  }, []);

  return { preview, onSurfacePointerDown };
}

/** One shape, one step of mine: closed on both sides of it, so the drawing is
 *  neither merged into what went before it nor into the first drag of it. */
function make(options: ShapeToolOptions, creation: Parameters<typeof createShape>[1]): string | null {
  options.undo?.boundary();
  const id = createShape(options.doc, creation);
  options.undo?.boundary();
  return id;
}

/** The rectangle a drag has described, wherever its author dragged to: the two
 *  corners it started at and is at now, squared up. */
function position(held: Drag): Rect {
  return normalizeRect({ x: held.startX, y: held.startY }, { x: held.x, y: held.y });
}
