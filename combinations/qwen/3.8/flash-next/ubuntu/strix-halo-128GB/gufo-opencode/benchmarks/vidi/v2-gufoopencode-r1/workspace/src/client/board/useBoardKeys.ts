import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { SelectionApi } from './useSelection';

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable === true;
}

// Window-level keyboard commands for the selection: Ctrl/Cmd+A select all,
// Escape clear, Enter edit the single editable-text object, arrows nudge,
// Delete/Backspace delete. While editing text, every key is left to the
// editor. Replaces story 2's useNoteKeys.
export function useBoardKeys(opts: {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const { doc, selection, snapshot: objects, canEdit } = optsRef.current;
      if (selection.editingId !== null) return;
      if (isEditableTarget(event.target)) return;

      if ((event.key === 'a' || event.key === 'A') && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        selection.setMany(allObjectIds(objects), false);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        selection.clear();
        return;
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!canEdit || selection.ids.size !== 1) return;
        const id = [...selection.ids][0];
        const obj = objects.find((o) => o.id === id);
        if (obj === undefined || getObjectType(obj.type)?.editableText !== true) return;
        event.preventDefault();
        selection.startEdit(id);
        return;
      }
      const arrow =
        event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown';
      const remove = event.key === 'Delete' || event.key === 'Backspace';
      if (!arrow && !remove) return;
      if (!canEdit || selection.ids.size === 0) return;
      // Handled: no page scroll, no page text selection.
      event.preventDefault();
      if (remove) {
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }
      const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
      const delta: Point =
        event.key === 'ArrowLeft'
          ? { x: -step, y: 0 }
          : event.key === 'ArrowRight'
            ? { x: step, y: 0 }
            : event.key === 'ArrowUp'
              ? { x: 0, y: -step }
              : { x: 0, y: step };
      const positions = new Map<string, Point>();
      for (const obj of objects) {
        if (selection.ids.has(obj.id)) positions.set(obj.id, { x: obj.x + delta.x, y: obj.y + delta.y });
      }
      moveObjects(doc, positions);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
