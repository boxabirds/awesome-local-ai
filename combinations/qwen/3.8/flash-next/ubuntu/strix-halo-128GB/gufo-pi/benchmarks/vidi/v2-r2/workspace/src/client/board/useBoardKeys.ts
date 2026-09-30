import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '@shared/board-model';
import { moveObjects, deleteObjects, allObjectIds } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import type { SelectionApi } from './useSelection';

interface UseBoardKeysOpts {
  doc: Y.Doc;
  selection: SelectionApi;
  snapshot: readonly ObjectSnapshot[];
  canEdit: boolean;
}

function isEditingText(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable;
}

export function useBoardKeys(opts: UseBoardKeysOpts): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { doc, selection, snapshot: snap, canEdit } = optsRef.current;
      const editingText = isEditingText() || selection.editingId !== null;

      // Ctrl/Cmd+A: select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey && !e.altKey) {
        if (!editingText) {
          e.preventDefault();
          const ids = allObjectIds(snap);
          selection.setMany(ids, false);
        }
        return;
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        if ((window as any).__vidi6_escapeHandled) {
          delete (window as any).__vidi6_escapeHandled;
          return;
        }
        if (!editingText) {
          selection.clear();
        }
        return;
      }

      // Enter: start editing single selected sticky (kept from story 2)
      if (e.key === 'Enter' && !editingText && canEdit) {
        if (selection.ids.size === 1) {
          const id = [...selection.ids][0];
          const obj = snap.find((o) => o.id === id);
          if (obj && obj.type === 'sticky') {
            e.preventDefault();
            selection.startEdit(id);
          }
        }
        return;
      }

      // Arrow keys: nudge
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!editingText && selection.ids.size > 0 && canEdit) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_LARGE_STEP_WORLD : NUDGE_STEP_WORLD;
          let dx = 0;
          let dy = 0;
          switch (e.key) {
            case 'ArrowLeft': dx = -step; break;
            case 'ArrowRight': dx = step; break;
            case 'ArrowUp': dy = -step; break;
            case 'ArrowDown': dy = step; break;
          }
          const positions = new Map<string, { x: number; y: number }>();
          const snapById = new Map(snap.map((o) => [o.id, o]));
          for (const id of selection.ids) {
            const obj = snapById.get(id);
            if (obj) {
              positions.set(id, { x: obj.x + dx, y: obj.y + dy });
            }
          }
          if (positions.size > 0) {
            moveObjects(doc, positions);
          }
        }
        return;
      }

      // Delete/Backspace: delete selection
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editingText && selection.ids.size > 0 && canEdit) {
          e.preventDefault();
          deleteObjects(doc, [...selection.ids]);
          selection.clear();
        }
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
