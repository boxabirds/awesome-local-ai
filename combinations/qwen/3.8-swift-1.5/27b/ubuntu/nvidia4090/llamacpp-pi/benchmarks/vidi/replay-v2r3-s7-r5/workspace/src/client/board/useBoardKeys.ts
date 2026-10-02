import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { allObjectIds, moveObjects, deleteObjects } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
} from '../../shared/config';
import type { SelectionApi } from './useSelection';

/**
 * Story 7: selection keyboard commands (sel.keyboard).
 *
 * - Ctrl/Cmd+A: select all (preventDefault; empty board → empty set).
 * - Escape: clear the selection.
 * - Arrow keys: nudge the selection by NUDGE_STEP_WORLD
 *   (NUDGE_LARGE_STEP_WORLD with Shift); preventDefault (no page scroll).
 * - Delete/Backspace: delete the selection, then clear it.
 * - Enter: edit a single selected sticky (story 2 behaviour, kept).
 *
 * Ignored while editing text or when focus is in any form field.
 */
export interface UseBoardKeysDeps {
  objects: readonly ObjectSnapshot[];
  selection: SelectionApi;
  doc: Y.Doc;
  canEdit: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)
  );
}

export function useBoardKeys({ objects, selection, doc, canEdit }: UseBoardKeysDeps): void {
  const depsRef = { objects, selection, doc, canEdit };

  const handler = useCallback(
    (e: KeyboardEvent) => {
      const { objects, selection, doc, canEdit } = depsRef;
      if (isEditableTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        selection.setMany(allObjectIds(objects), false);
        return;
      }

      if (e.key === 'Escape') {
        selection.clear();
        return;
      }

      const hasSelection = selection.ids.size > 0;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!hasSelection || !canEdit) return;
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const positions = new Map<string, { x: number; y: number }>();
        for (const obj of objects) {
          if (selection.ids.has(obj.id)) {
            positions.set(obj.id, { x: obj.x + dx, y: obj.y + dy });
          }
        }
        moveObjects(doc, positions);
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!hasSelection || !canEdit) return;
        e.preventDefault();
        deleteObjects(doc, [...selection.ids]);
        selection.clear();
        return;
      }

      if (e.key === 'Enter') {
        if (!hasSelection || selection.editingId !== null) return;
        const [only] = selection.ids;
        const obj = objects.find((o) => o.id === only);
        const spec = obj ? getObjectType(obj.type) : undefined;
        if (selection.ids.size === 1 && obj && spec?.editableText) {
          e.preventDefault();
          selection.startEdit(only);
        }
      }
    },
    // depsRef keeps the latest values without re-binding the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, selection, doc, canEdit],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
