/**
 * The active tool (story 10).
 *
 * Story 9 had two tools and a boolean's worth of state. Story 10 adds three shapes and the arrow,
 * and - more importantly - tools that stay armed while their object is being drawn. So this hook
 * owns three things the toolbar, the keyboard and the drawing surface all need to agree on:
 *
 *  * `tool`: what a pointer press on the board means right now;
 *  * `shapeKind`: which shape the Shape tool will draw, remembered across visits to the shape bar;
 *  * `toolCreated(id)`: what happens to the tool and the selection when a tool has made its object.
 *
 * Not every tool calls `toolCreated`. The Pen (story 11) commits its stroke itself and leaves this
 * hook alone on purpose: `pen.stay_active` says the tool stays armed after every stroke, so the
 * person draws one line after another until they press Escape or pick another tool - and a stroke
 * they have just finished is not what they want selected, it is the next one they are aiming at.
 *
 * Tool state is per screen and is never written to the document. Keyboard shortcuts are ignored
 * while focus is in a text field or a note is being written, so typing "s" into a note stays a
 * letter - the same guard the board's other keys use.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isBuiltTool,
  isShapeTool,
  shapeKindOf,
  shapeToolId,
  TOOL_KEYS,
  type ToolId,
} from '../../shared/tools';
import type { ShapeKind } from '../../shared/objects/shape';
import type { SelectionController } from '../board/useSelection';

/** True when the keyboard belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export interface ActiveToolOptions {
  /** A board that cannot be edited has no tool that makes anything. */
  canEdit: boolean;
  /** So a tool that has just made an object can select it. */
  selection: SelectionController;
}

export interface ActiveToolController {
  readonly tool: ToolId;
  /** Switching to a tool this build does not have, or to a creating tool on a board that cannot be
   * edited, is refused here rather than misbehaving further down. */
  setTool(tool: ToolId): void;
  /** The kind the Shape tool draws. Holds the last choice while some other tool is active. */
  readonly shapeKind: ShapeKind;
  setShapeKind(kind: ShapeKind): void;
  /** A tool that makes one object at a time has made `id`: select it and go back to Select. */
  toolCreated(id: string): void;
}

export function useActiveTool(options: ActiveToolOptions): ActiveToolController {
  const { canEdit, selection } = options;
  const [tool, setToolState] = useState<ToolId>('select');
  // The shape bar highlights a kind; leaving the shape tool and coming back should not have
  // forgotten it, so the last choice is kept separately from the tool itself.
  const [lastShapeKind, setLastShapeKind] = useState<ShapeKind>('rect');

  const setTool = useCallback(
    (next: ToolId) => {
      if (!isBuiltTool(next)) return;
      // Every tool but Select makes something, and a board that cannot be edited has nothing to
      // offer: the press does the ordinary Select thing instead of appearing broken.
      if (!canEdit) return;
      if (isShapeTool(next)) setLastShapeKind(shapeKindOf(next) ?? 'rect');
      setToolState(next);
    },
    [canEdit],
  );

  // Losing the right to edit while a creating tool is armed puts the screen back on Select, so a
  // click there does something sensible instead of drawing nothing at all.
  useEffect(() => {
    if (canEdit) return;
    setToolState((current) => (current === 'select' ? current : 'select'));
  }, [canEdit]);

  const setShapeKind = useCallback((kind: ShapeKind) => {
    setLastShapeKind(kind);
    setToolState(shapeToolId(kind));
  }, []);

  const toolCreated = useCallback(
    (id: string) => {
      setToolState('select');
      selection.setMany([id], false);
    },
    [selection],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) return;
      if (selection.editingId !== null) return;
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Escape leaves a tool without waiting for the gesture to finish: the shape being dragged is
      // drawn by the tool's own overlay, and the overlay goes away with the tool.
      if (event.key === 'Escape') {
        setToolState((current) => (current === 'select' ? current : 'select'));
        return;
      }
      if (event.shiftKey) return;

      const pressed = TOOL_KEYS[event.key.toLowerCase()];
      if (pressed === undefined || !isBuiltTool(pressed)) return;
      // 'v' and 't' are also handled by the board's own keys; both paths arrive at the same value
      // through the same guard, and setting state to what it already is changes nothing.
      event.preventDefault();
      // 'S' means "the Shape tool", and the Shape tool draws the kind the shape bar last chose. The
      // key is a shortcut for the button, not for a rectangle: pressing it must not quietly undo a
      // choice somebody made in the menu.
      setTool(isShapeTool(pressed) ? shapeToolId(lastShapeKind) : pressed);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, setTool, lastShapeKind]);

  const shapeKind = isShapeTool(tool) ? (shapeKindOf(tool) ?? lastShapeKind) : lastShapeKind;

  return useMemo(
    () => ({ tool, setTool, shapeKind, setShapeKind, toolCreated }),
    [tool, setTool, shapeKind, setShapeKind, toolCreated],
  );
}
