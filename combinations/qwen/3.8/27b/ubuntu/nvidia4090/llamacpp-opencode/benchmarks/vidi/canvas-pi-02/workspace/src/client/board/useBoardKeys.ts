import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../canvas/camera';
import type { Selection } from './useSelection';
import type { UndoController } from './undo';
import type { Tool } from './useTool';
import type { ShapeKind } from '../../shared/config';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON' || target.isContentEditable;
}

/**
 * Selection keyboard commands (story 7, sel.keyboard). Replaces story 2's
 * Delete/Enter handling (Enter-to-edit for a single selected sticky is kept).
 *
 *  - Ctrl/Cmd+A (not while editing): select every object, preventDefault so
 *    the page's text is not selected;
 *  - Escape (not while editing): clear the selection;
 *  - Arrows (with a selection, editable board): nudge by NUDGE_STEP_WORLD,
 *    NUDGE_LARGE_STEP_WORLD with Shift; preventDefault so the page neither
 *    scrolls nor pans the board;
 *  - Delete/Backspace (with a selection, editable board): delete everything
 *    selected, then clear;
 *  - Ctrl/Cmd+Z → undo; Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y → redo (story 8,
 *    undo.controls): preventDefault, ignored while locked (`canEdit ===
 *    false`).
 *
 * Ignored while `editingId` is set or focus is in an input/textarea/button,
 * so typing in a note (or on a toolbar button) keeps its native behaviour
 * (the sticky editor handles its own undo/redo keys).
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  undo: UndoController;
  /** Current tool (story 9/10). */
  tool?: Tool;
  /** Change the tool (story 9/10). */
  setTool?: (tool: Tool) => void;
  /** Create a sticky note at the centre of the visible board (N key, story 9). */
  onCreateStickyCentre?: () => void;
  /** Open the image file picker (I key, story 12). */
  onOpenImagePicker?: () => void;
  /** The current shape kind (story 10, used by the S key). */
  shapeKind?: ShapeKind;
}): void {
  const docRef = useRef(opts.doc);
  docRef.current = opts.doc;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(opts.canEdit);
  canEditRef.current = opts.canEdit;
  const undoRef = useRef(opts.undo);
  undoRef.current = opts.undo;
  const setToolRef = useRef(opts.setTool);
  setToolRef.current = opts.setTool;
  const createStickyCentreRef = useRef(opts.onCreateStickyCentre);
  createStickyCentreRef.current = opts.onCreateStickyCentre;
  const openImagePickerRef = useRef(opts.onOpenImagePicker);
  openImagePickerRef.current = opts.onOpenImagePicker;
  const toolRef = useRef(opts.tool);
  toolRef.current = opts.tool;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const selection = selectionRef.current;
      if (isTypingTarget(e.target)) return; // native behaviour (typing, buttons)
      if (selection.editingId !== null) return; // the editor owns the keys
      const snapshot = snapshotRef.current;

      // Ctrl/Cmd+A: select every object (view state — works when locked too).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (e.key === 'Escape') {
        selection.clear();
        // Also reset the tool to select (story 9).
        setToolRef.current?.('select');
        return;
      }

      // V: switch to select tool (story 9).
      if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        setToolRef.current?.('select');
        return;
      }

      // T: switch to text tool (story 9, only when editable).
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          setToolRef.current?.('text');
        }
        return;
      }

      // N: create a sticky note at the centre of the visible board (story 9).
      if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          e.preventDefault();
          createStickyCentreRef.current?.();
        }
        return;
      }

      // S: switch to shape tool (story 10, only when editable).
      if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          setToolRef.current?.('shape');
        }
        return;
      }

      // I: open image picker (story 12, only when editable).
      if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          e.preventDefault();
          openImagePickerRef.current?.();
        }
        return;
      }

      // L: switch to connector tool (story 10, only when editable).
      if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          setToolRef.current?.('connector');
        }
        return;
      }

      // P: switch to pen tool (story 11, only when editable).
      if ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (canEditRef.current) {
          setToolRef.current?.('pen');
        }
        return;
      }

      // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y: undo and redo (story 8).
      // Each nudge/delete below is one step, so the undo keys must work
      // without a selection too.
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        const isUndo = key === 'z' && !e.shiftKey && !e.altKey;
        const isRedo = (key === 'z' && e.shiftKey && !e.altKey) || (key === 'y' && !e.shiftKey && !e.altKey);
        if (isUndo || isRedo) {
          if (canEditRef.current) {
            e.preventDefault();
            if (isUndo) undoRef.current.undo();
            else undoRef.current.redo();
          }
          return;
        }
      }

      if (selection.ids.size === 0) return; // the rest needs a selection

      // Arrow keys: nudge (no page scroll, no board pan). Each nudge is one
      // undo step (story 8): boundaries bracket the single model call.
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!canEditRef.current) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
        if (dx === 0 && dy === 0) return;
        const positions = new Map<string, Point>();
        for (const o of snapshot) {
          if (selection.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        undoRef.current.boundary();
        moveObjects(docRef.current, positions);
        undoRef.current.boundary();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEditRef.current) return;
        e.preventDefault();
        undoRef.current.boundary();
        if (deleteObjects(docRef.current, [...selection.ids]) > 0) selection.clear();
        undoRef.current.boundary();
        return;
      }

      // Enter starts editing a single selected sticky (story 2 behaviour).
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        canEditRef.current &&
        selection.ids.size === 1
      ) {
        const id = [...selection.ids][0]!;
        const obj = snapshot.find((o) => o.id === id);
        if (obj?.type === 'sticky') {
          e.preventDefault();
          selection.startEdit(id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
