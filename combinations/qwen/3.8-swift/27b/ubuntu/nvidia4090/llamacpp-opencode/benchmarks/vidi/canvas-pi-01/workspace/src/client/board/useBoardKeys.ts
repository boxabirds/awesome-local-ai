// Board keyboard shortcuts (see spec: sel.keyboard).
//
// Attached to window; inert while focus is in a text field (the note editor)
// or an object is in edit mode:
// - Ctrl/Cmd+A: select every object (select-all)
// - Escape: clear the selection
// - Arrow keys: nudge the selection 1 unit (Shift: 10)
// - Delete/Backspace: delete the selection
// - Enter: begin editing the single selected object (editable-text types)

import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { allObjectIds, deleteObjects, moveObjects, type ObjectSnapshot } from '../../shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { useSelection } from './useSelection';

export interface BoardKeysOptions {
  doc: Y.Doc;
  selection: ReturnType<typeof useSelection>;
  snapshot: readonly ObjectSnapshot[];
  /** The current client may edit the board (false while load_failed). */
  canEdit: boolean;
}

function inEditableTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

export function useBoardKeys(options: BoardKeysOptions): void {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { doc, selection, snapshot, canEdit } = optsRef.current;
      if (inEditableTarget(event.target)) return;
      if (selection.editingId !== null) return;

      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'a' || event.key === 'A') {
          event.preventDefault();
          selection.setMany(allObjectIds(snapshot), false);
        }
        return;
      }

      switch (event.key) {
        case 'Escape':
          selection.clear();
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!canEdit || selection.ids.size === 0) return;
          event.preventDefault();
          const step = event.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
          const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
          const byId = new Map(snapshot.map((o) => [o.id, o]));
          const positions = new Map<string, Point>();
          for (const id of selection.ids) {
            const obj = byId.get(id);
            if (obj !== undefined) positions.set(id, { x: obj.x + dx, y: obj.y + dy });
          }
          moveObjects(doc, positions);
          return;
        }
        case 'Delete':
        case 'Backspace': {
          if (!canEdit || selection.ids.size === 0) return;
          event.preventDefault();
          deleteObjects(doc, [...selection.ids]);
          selection.clear();
          return;
        }
        case 'Enter': {
          if (!canEdit || selection.ids.size !== 1) return;
          const [id] = selection.ids.values();
          const obj = snapshot.find((o) => o.id === id);
          if (obj !== undefined && getObjectType(obj.type)?.editableText) {
            event.preventDefault();
            selection.startEdit(id);
          }
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
