import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
  allObjectIds,
  deleteObjects,
  moveObjects,
  objectBounds,
  type ObjectSnapshot,
} from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';

export interface BoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** True while a marquee drag is in progress (Escape cancels the marquee instead of the selection). */
  marqueeActive?: () => boolean;
  /** Per-client undo history (story 8): shortcuts + step boundaries. */
  undo?: UndoController;
  /** Story 9: current tool. */
  tool?: 'select' | 'text';
  /** Story 9: set the active tool. */
  setTool?: (t: 'select' | 'text') => void;
  /** Story 9: N shortcut — create a sticky at the view centre. */
  onCreateStickyAtCenter?: () => void;
}

/**
 * Story 7 (sel.select_all, sel.delete_group, sel.nudge): board keyboard
 * shortcuts. Attached to window so they work without a focused note.
 *
 * - Ctrl/Cmd+A: select every known object (stops the browser select-all).
 * - Escape: clear the selection (and any editing) — unless a marquee is in
 *   progress, in which case the marquee owns Escape (it cancels).
 * - Enter: edit the single selected object (if its type supports text).
 * - Delete/Backspace: delete the whole selection (one transaction, one undo
 *   step — story 8 boundaries).
 * - Arrow keys: nudge the selection by NUDGE_STEP_WORLD (Shift: ×10).
 *   preventDefault so the page never scrolls (TC-34); one undo step (story 8).
 * - Ctrl/Cmd+Z: undo my last step; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y: redo
 *   (story 8, PRD undo.shortcuts). Always claimed (never the browser's own
 *   undo) outside of typing targets; a no-op on a read-only board.
 *
 * Nothing fires while typing (contenteditable/inputs), and nothing mutates
 * the doc on a read-only board (canEdit).
 */
export function useBoardKeys({ doc, selection, snapshot, canEdit, marqueeActive, undo, tool, setTool, onCreateStickyAtCenter }: BoardKeysOpts) {
  // Latest opts in a ref so the window listener stays stable across renders.
  const stateRef = useRef({ doc, selection, snapshot, canEdit, marqueeActive, undo, tool, setTool, onCreateStickyAtCenter });
  stateRef.current = { doc, selection, snapshot, canEdit, marqueeActive, undo, tool, setTool, onCreateStickyAtCenter };

  const handler = useCallback((e: KeyboardEvent) => {
    const { selection: sel, snapshot: snap, canEdit: editable, marqueeActive: marquee, undo: history } =
      stateRef.current;
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;

    // Story 8 (undo.shortcuts): claim the combos even on a read-only board so
    // the browser's own undo can never fire from the board.
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (editable) {
        if (e.shiftKey) history?.redo();
        else history?.undo();
      }
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      if (editable) history?.redo();
      return;
    }

    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      sel.setMany(allObjectIds(snap), false);
      return;
    }
    if (e.key === 'Escape') {
      if (marquee?.()) return; // the marquee cancels itself
      // Story 9: Escape returns to select tool (if text tool is active)
      if (stateRef.current.tool === 'text') {
        stateRef.current.setTool?.('select');
        return;
      }
      sel.clear();
      return;
    }
    // Story 9: V → select tool
    if ((e.key === 'v' || e.key === 'V') && !mod) {
      stateRef.current.setTool?.('select');
      return;
    }
    // Story 9: T → text tool (only if canEdit)
    if ((e.key === 't' || e.key === 'T') && !mod) {
      if (editable) stateRef.current.setTool?.('text');
      return;
    }
    // Story 9: N → create sticky at view centre
    if ((e.key === 'n' || e.key === 'N') && !mod) {
      if (editable) stateRef.current.onCreateStickyAtCenter?.();
      return;
    }
    if (e.key === 'Enter') {
      // Story 2: Enter edits the (single) selected note; story 7: any type
      // whose spec declares editableText.
      if (sel.ids.size === 1 && sel.editingId === null) {
        const [id] = [...sel.ids];
        const obj = snap.find((o) => o.id === id);
        if (obj && getObjectType(obj.type)?.editableText) {
          e.preventDefault();
          sel.startEdit(id);
        }
      }
      return;
    }
    if (!editable) return; // read-only: no doc-mutating shortcuts

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.ids.size === 0) return;
      e.preventDefault();
      // Story 8: the whole deletion is one undo step.
      history?.boundary();
      deleteObjects(doc, [...sel.ids]);
      history?.boundary();
      return;
    }
    const nudge = arrowNudge(e);
    if (nudge && sel.ids.size > 0) {
      e.preventDefault();
      const positions = new Map<string, { x: number; y: number }>();
      for (const o of snap) {
        if (sel.ids.has(o.id)) {
          const b = objectBounds(o);
          positions.set(o.id, { x: b.x + nudge.dx, y: b.y + nudge.dy });
        }
      }
      // Story 8: the nudge burst is one undo step (frames merge inside the
      // capture window; the trailing boundary isolates the next action).
      history?.boundary();
      moveObjects(doc, positions);
      history?.boundary();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);

  return { handler };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function arrowNudge(e: KeyboardEvent): { dx: number; dy: number } | null {
  const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
  switch (e.key) {
    case 'ArrowUp':
      return { dx: 0, dy: -step };
    case 'ArrowDown':
      return { dx: 0, dy: step };
    case 'ArrowLeft':
      return { dx: -step, dy: 0 };
    case 'ArrowRight':
      return { dx: step, dy: 0 };
    default:
      return null;
  }
}
