import { useCallback, useEffect, useState } from 'react';
import * as Y from 'yjs';

import { OBJECTS_KEY } from '../../shared/board-model';

/**
 * Which note is selected and which is being edited — per-client interaction
 * state, never written to the Y.Doc (another user's cursor must not change
 * what you have selected, live.local_selection).
 */
export interface SelectionController {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Select `id`, or clear the selection with `null` (also ends editing). */
  select(id: string | null): void;
  /** Start editing a note; implies it is selected. */
  startEdit(id: string): void;
  /** End editing; the note stays selected or is deselected. */
  endEdit(next: 'selected' | 'unselected'): void;
}

/**
 * Selection of one screen. Pass the board document so a note that disappears
 * *because somebody else deleted it* also stops being selected or edited here
 * (live.delete_during_edit): the editor unmounts, an in-progress drag ends with
 * the element, and nothing is reported to the user as an error.
 */
export function useSelection(doc: Y.Doc): SelectionController {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // Leaving for another note (or nowhere) ends any edit; re-selecting the
    // note being edited keeps the editor mounted.
    setEditingId((current) => (current !== null && current === id ? current : null));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_KEY);
    const prune = (): void => {
      const drop = (id: string | null): string | null => (id !== null && objects.has(id) ? id : null);
      setSelectedId((current) => drop(current));
      setEditingId((current) => drop(current));
    };
    prune();
    objects.observeDeep(prune);
    return () => objects.unobserveDeep(prune);
  }, [doc]);

  return { selectedId, editingId, select, startEdit, endEdit };
}
