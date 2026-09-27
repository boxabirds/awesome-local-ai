// Story 7: selection keyboard commands (anchor: sel.keyboard).
//
// Window-level keydown. Replaces story 2's Delete/Enter handling in App and
// adds select-all, Escape (clear) and arrow nudging (Shift = large step).
// Suppressed while editing text, while focus is in an input/textarea, and
// (for mutating keys) when the board is read-only (load_failed).

import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';
import type { UndoController } from './undo';
import type { Tool } from './useTool';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  /** Story 8: undo/redo shortcuts and step boundaries for Delete/nudge. */
  undo?: UndoController | null;
  /** Story 9: tool shortcuts (V/Escape -> Select, T -> Text) and N (sticky at view centre). */
  tool?: { tool: Tool; setTool(tool: Tool): void } | null;
  /** Story 9: N creates a sticky note at the view centre (story 2 behaviour). */
  onCreateStickyAtCenter?: (() => void) | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

export function useBoardKeys(opts: BoardKeysOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      const { doc, selection, snapshot, canEdit, undo, tool, onCreateStickyAtCenter } =
        optsRef.current;
      if (selection.editingId !== null) return;

      // Select all (non-mutating: selection only, allowed read-only).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(snapshot), false);
        return;
      }

      // Story 9: tool shortcuts (text.tool). Plain keys only (no modifiers),
      // and never while typing (guarded above by isTypingTarget + editingId):
      // T while editing a note types 't' (TC-16).
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'v' || e.key === 'V') {
          tool?.setTool('select');
          return;
        }
        if (e.key === 't' || e.key === 'T') {
          tool?.setTool('text'); // ignored when the board is read-only
          return;
        }
        // Story 10 (tools.active): S -> Shape, L -> Connector; ignored
        // read-only (the hook's setTool enforces that).
        if (e.key === 's' || e.key === 'S') {
          tool?.setTool('shape');
          return;
        }
        if (e.key === 'l' || e.key === 'L') {
          tool?.setTool('connector');
          return;
        }
        if (e.key === 'n' || e.key === 'N') {
          if (canEdit) onCreateStickyAtCenter?.();
          return;
        }
      }

      // Escape: back to the Select tool (story 9, text.tool), then clear the
      // selection (story 7). Both are non-mutating.
      if (e.key === 'Escape') {
        e.preventDefault();
        tool?.setTool('select');
        selection.clear();
        return;
      }

      // Mutating keys are no-ops when the board is read-only.
      if (!canEdit) return;

      // Story 8: undo/redo shortcuts (undo.shortcuts). Personal history
      // only; preventDefault stops the browser's native undo. The editor's
      // own textarea handles these keys itself (guarded above by
      // isTypingTarget and editingId).
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')
      ) {
        if (undo === null || undo === undefined) return;
        e.preventDefault();
        if (e.key === 'y' || e.key === 'Y' || e.shiftKey) undo.redo();
        else undo.undo();
        return;
      }

      const selected = [...selection.ids];
      const byId = new Map(snapshot.map((o) => [o.id, o]));

      // Enter edits a single selected editable object (kept from story 2).
      if (e.key === 'Enter' && selected.length === 1) {
        const o = byId.get(selected[0]);
        if (o !== undefined && getObjectType(o.type)?.editableText === true) {
          e.preventDefault();
          selection.startEdit(selected[0]);
        }
        return;
      }

      // Delete / Backspace remove the whole selection.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.length === 0) return;
        e.preventDefault();
        // Story 8: one delete (of any number of objects) is one step.
        undo?.boundary();
        deleteObjects(doc, selected);
        undo?.boundary();
        selection.clear();
        return;
      }

      // Arrow keys nudge the selection (Shift = large step).
      const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      if (selected.length === 0) return;
      e.preventDefault(); // no page scroll, no text selection, no board pan
      const positions = new Map<string, Point>();
      for (const id of selected) {
        const o = byId.get(id);
        if (o !== undefined) positions.set(id, { x: o.x + dx, y: o.y + dy });
      }
      if (positions.size > 0) {
        // Story 8: each nudge is its own step.
        undo?.boundary();
        moveObjects(doc, positions);
        undo?.boundary();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
