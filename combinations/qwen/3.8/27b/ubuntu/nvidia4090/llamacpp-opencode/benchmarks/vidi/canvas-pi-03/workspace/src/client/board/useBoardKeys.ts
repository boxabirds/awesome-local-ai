import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '@/shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '@/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@/shared/config';
import { getObjectType } from '../objects/registry';
import type { Selection } from './useSelection';
import type { Tool } from './useTool';

/**
 * Selection keyboard commands (story 7, sel.keyboard). Replaces story 2's
 * inline Delete/Enter handling in Board:
 *
 *  - Ctrl/Cmd+A: select all (known) objects; preventDefault.
 *  - Escape: clear the selection (while a marquee is active, the marquee
 *    cancels instead — `marqueeActive` + `cancelMarquee`).
 *  - Arrows: nudge the selection by NUDGE_STEP_WORLD (NUDGE_LARGE_STEP_WORLD
 *    with Shift); preventDefault so the page neither scrolls nor pans.
 *  - Delete/Backspace: delete the selection, then clear.
 *  - Enter: edit a single selected object whose type is editableText
 *    (sticky from story 2, text from story 9).
 *
 * Story 9 tool shortcuts (text.tool): V → Select, T → Text (only when
 * canEdit), N → create a sticky at the view centre (story 2 behaviour),
 * Escape also returns to Select. Plain single keys are ignored while any
 * modifier (Ctrl/Meta/Alt) is held.
 *
 * Ignored while editing text (editingId set) or focus is in an
 * input/textarea/contenteditable. Mutating keys (nudge/delete/enter) also
 * require `canEdit` (story 4 load-failure lock); selection keys (Ctrl+A,
 * Escape) work in every state.
 */

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** True while a marquee drag is in progress (Escape cancels it instead). */
  marqueeActive?: boolean;
  cancelMarquee?: () => void;
  /** Story 8: close the capture window before/after a single model call. */
  onBoundary?: () => void;
  /** Story 8: undo this tab's most recent own step. */
  onUndo?: () => void;
  /** Story 8: re-apply this tab's most recently undone own step. */
  onRedo?: () => void;
  /** Story 9: the active tool (V/T/Escape shortcuts read and set it). */
  tool?: { tool: Tool; setTool(t: Tool): void };
  /** Story 9: N shortcut — create a sticky at the view centre (story 2). */
  onCreateStickyCenter?: () => void;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const ref = useRef(opts);
  ref.current = opts;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const { doc, snapshot, canEdit, marqueeActive, cancelMarquee, onBoundary, onUndo, onRedo } = ref.current;
      const sel = selectionRef.current;

      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return; // the input owns the keys
      }
      if (sel.editingId !== null) return; // the editor owns the keys

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        sel.setMany(allObjectIds(snapshot), false);
        return;
      }

      if (e.key === 'Escape') {
        if (marqueeActive) {
          cancelMarquee?.();
          return;
        }
        e.preventDefault();
        sel.clear();
        ref.current.tool?.setTool('select'); // story 9: Escape returns to Select
        return;
      }

      // Story 9: tool shortcuts (plain single keys, no modifiers, and never
      // while a marquee is active). V works in every state; T and N create
      // content, so they respect the story 4 edit lock.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !marqueeActive) {
        if (e.key === 'v' || e.key === 'V') {
          ref.current.tool?.setTool('select');
          return;
        }
        if ((e.key === 't' || e.key === 'T') && canEdit) {
          e.preventDefault();
          ref.current.tool?.setTool('text');
          return;
        }
        if ((e.key === 'n' || e.key === 'N') && canEdit) {
          e.preventDefault();
          ref.current.onCreateStickyCenter?.();
          return;
        }
      }

      if (!canEdit) return; // story 4: nudge/delete/edit/undo blocked when locked

      // Story 8: undo / redo (no selection required). Intercepted here only
      // when focus is NOT in an input and no sticky is being edited (the
      // guards above returned early), so the board and the in-note editor
      // never both handle the same keystroke.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) onRedo?.();
        else onUndo?.();
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      const ids = [...sel.ids];
      if (ids.length === 0) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, { x: number; y: number }>();
        for (const o of snapshot) {
          if (sel.ids.has(o.id)) positions.set(o.id, { x: o.x + dx, y: o.y + dy });
        }
        onBoundary?.();
        moveObjects(doc, positions);
        onBoundary?.();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onBoundary?.();
        deleteObjects(doc, ids);
        onBoundary?.();
        sel.clear();
        return;
      }

      if (e.key === 'Enter') {
        // Story 2: Enter edits a single selected sticky. Story 9: the same
        // command edits a single selected text object (registry spec's
        // editableText, sel.all_types).
        if (ids.length === 1) {
          const o = snapshot.find((s) => s.id === ids[0]);
          if (o !== undefined && getObjectType(o.type)?.editableText) {
            e.preventDefault();
            sel.startEdit(ids[0]);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
