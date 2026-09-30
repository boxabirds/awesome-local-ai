import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { deleteObjects, moveObjects, allObjectIds, objectBounds, type ObjectSnapshot } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import type { Point } from '@shared/geometry';
import type { Selection } from './useSelection';

/**
 * Story 7: board-level keyboard shortcuts (PRD sel.keys).
 *
 *  - Ctrl/Cmd+A  select all (registered types only)
 *  - Escape      clear selection / end marquee / end editing
 *  - Arrow keys  nudge the selection by 1 (10 with Shift), one
 *                LOCAL_ORIGIN transaction
 *  - Delete/Backspace delete the selection, one transaction
 *  - Enter       edit the single selected sticky
 *
 * All keys are ignored while the user is typing in a text editor (the
 * editor handles its own keys) and while a gesture or marquee is in
 * progress.
 */
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: Selection;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
  isBusy: () => boolean;
  isMarqueeActive: () => boolean;
  onEscape(): void;
  onUndo?: () => void;
  onRedo?: () => void;
  isEditing?: () => boolean;
}) {
  const { doc, canEdit, onEscape } = opts;
  const selectionRef = useRef(opts.selection);
  selectionRef.current = opts.selection;
  const snapshotRef = useRef(opts.snapshot);
  snapshotRef.current = opts.snapshot;
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const isBusyRef = useRef(opts.isBusy);
  isBusyRef.current = opts.isBusy;
  const isMarqueeActiveRef = useRef(opts.isMarqueeActive);
  isMarqueeActiveRef.current = opts.isMarqueeActive;
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onUndoRef = useRef(opts.onUndo);
  onUndoRef.current = opts.onUndo;
  const onRedoRef = useRef(opts.onRedo);
  onRedoRef.current = opts.onRedo;
  const isEditingRef = useRef(opts.isEditing);
  isEditingRef.current = opts.isEditing;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Let the text editor handle its own keys.
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (isMarqueeActiveRef.current()) return;
      if (isBusyRef.current()) return;

      const sel = selectionRef.current;
      const mod = e.ctrlKey || e.metaKey;

      // Story 8: Undo / Redo shortcuts.
      // Ignored while a sticky is being edited (the editor handles it).
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (isEditingRef.current?.()) return; // editor handles it
        if (!canEditRef.current) return;
        e.preventDefault();
        if (e.shiftKey) {
          onRedoRef.current?.();
        } else {
          onUndoRef.current?.();
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (isEditingRef.current?.()) return;
        if (!canEditRef.current) return;
        e.preventDefault();
        onRedoRef.current?.();
        return;
      }

      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const ids = allObjectIds(snapshotRef.current);
        sel.setMany(ids, false);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (sel.editingId) {
          // End editing first; the note stays selected (story 3).
          sel.endEdit('selected');
          return;
        }
        sel.clear();
        onEscapeRef.current();
        return;
      }

      if (!canEditRef.current) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (sel.ids.size === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, Point>();
        for (const obj of snapshotRef.current) {
          if (!sel.ids.has(obj.id)) continue;
          const b = objectBounds(obj);
          positions.set(obj.id, { x: b.x + dx, y: b.y + dy });
        }
        moveObjects(doc, positions);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.ids.size === 0) return;
        e.preventDefault();
        deleteObjects(doc, [...sel.ids]);
        return;
      }

      if (e.key === 'Enter') {
        if (sel.ids.size === 1) {
          const [id] = sel.ids;
          const obj = snapshotRef.current.find((o) => o.id === id);
          if (obj?.type === 'sticky') {
            e.preventDefault();
            sel.startEdit(id);
          }
        }
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  return;
}
