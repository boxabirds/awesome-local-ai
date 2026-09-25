/**
 * Story 7 · task 12 — the shared per-object interaction.
 *
 * Selection, group *move* and *resize* are deliberately **not** implemented
 * inside any one object type. A press that starts on an object either selects
 * it (a plain click) or, once the pointer has travelled past the drag
 * threshold, hands off to the board's single {@link TransformController}
 * instance. Whether that gesture moves one object or the whole selection is
 * decided by the *selection*, not the renderer: grabbing any member of a
 * multi-selection drags the group, grabbing an unselected object selects just
 * it first.
 *
 * The hook owns only the tiny local phase machine (`idle → pressed → dragging`)
 * that the DOM exposes as `data-phase`; it never touches the Y.Doc directly, so
 * a read-only board (`canEdit` false) and a double-click that opens the editor
 * are both no-ops, and a gesture whose objects vanish mid-drag simply stops
 * having anything to write (the controller skips missing ids).
 */
import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import type { TransformController } from '../board/transformController';

export type ObjectPhase = 'idle' | 'pressed' | 'dragging';

export interface ObjectInteractionOptions {
  /** This object's id. */
  id: string;
  /** Whether the board is currently editable (false ⇒ every gesture refused). */
  isEditable(): boolean;
  /** True while *this* object's text editor is open (a click stays in it). */
  isEditing(): boolean;
  /** The current selection, used to decide single-vs-group at pointer-down. */
  getSelection(): readonly string[];
  /** Select just this id, or (with `additive`) toggle it in the set. */
  onSelect(id: string, additive: boolean): void;
  /** The board-wide transform controller (shared by every object). */
  getController(): TransformController;
}

export interface ObjectInteraction {
  phase: ObjectPhase;
  /**
   * Widened to `Element` rather than `HTMLElement` so an SVG target can use the
   * same handlers as an HTML one: a sketch's press lands on its hit *path*, and
   * React types a handler's event by the element it sits on.
   */
  onPointerDown(event: ReactPointerEvent<Element>): void;
  onPointerMove(event: ReactPointerEvent<Element>): void;
  /** Release, cancel and lost-capture all route here: the gesture just ends. */
  onPointerEnd(event: ReactPointerEvent<Element>): void;
}

interface PendingDrag {
  startX: number;
  startY: number;
  /** The ids a threshold-crossing drag will move (one, or the whole group). */
  ids: string[];
  dragging: boolean;
}

/**
 * Build the pointer handlers for one board object. Kept as a hook so both the
 * sticky note and the test-only rectangle share exactly one gesture path (the
 * design's "generic transforms" requirement).
 */
export function useObjectInteraction(options: ObjectInteractionOptions): ObjectInteraction {
  const [phase, setPhase] = useState<ObjectPhase>('idle');
  const dragRef = useRef<PendingDrag | null>(null);

  const endGesture = useCallback(() => {
    if (dragRef.current === null && phase === 'idle') return;
    dragRef.current = null;
    options.getController().end();
    setPhase('idle');
    // options are read-only per render; only the ref/phase closure is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<Element>) => {
      // The object owns its pointer: the board must not pan or create beneath.
      event.stopPropagation();
      if (!options.isEditable()) return;
      if (options.isEditing()) return; // a click inside an open editor stays in it
      if (event.button !== 0) return;

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom / engines without pointer capture: capture is skipped.
      }

      const selection = options.getSelection();
      const alreadyGrouped = selection.includes(options.id);

      // Shift+click toggles membership (a selection edit, never a drag).
      if (event.shiftKey) {
        options.onSelect(options.id, true);
        return;
      }

      // A plain press on an unselected object selects exactly it first; a press
      // on an already-selected object keeps the whole group so it can be dragged
      // as one (PRD sel.additive / sel.group).
      if (!alreadyGrouped) {
        options.onSelect(options.id, false);
      }
      const groupId = alreadyGrouped ? selection : null;

      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        ids: groupId ? [...groupId] : [options.id],
        dragging: false,
      };
      setPhase('pressed');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      if (options.isEditing()) return;
      const drag = dragRef.current;
      if (drag === null) return;

      if (!drag.dragging) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        // Below the threshold this is still a press, not a drag: nothing moves.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.dragging = true;
        setPhase('dragging');
        options.getController().beginMove(drag.ids, drag.startX, drag.startY);
      }
      options.getController().move(event.clientX, event.clientY);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options],
  );

  return { phase, onPointerDown, onPointerMove, onPointerEnd: endGesture };
}
