/**
 * Story 2 · the `useSelection` hook; Story 3 · task 4 — remote-delete safety.
 *
 * Selection and editing are **local, per-client state** and are never written
 * to the Y.Doc: another person must not see my selection as board data (that
 * is a presence feature in a later story). This hook owns just two ids and the
 * transitions between Unselected / Selected / Editing.
 *
 * Story 3 adds one cross-cutting rule: if the note we have selected / are
 * editing disappears — because someone else deleted it — the local selection
 * and any open editor are cleared (the TC-25 "Sam editing, Alex deletes" case).
 * We detect this by observing `objects` and checking the ids still exist; the
 * ids themselves never travel over the wire.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';

export interface Selection {
  selectedId: string | null;
  editingId: string | null;
  /** Select a note (or null to clear). Clears any active editing. */
  select(id: string | null): void;
  /** Begin editing a note (implies it is selected). */
  startEdit(id: string): void;
  /** Finish editing, keeping the selection or dropping it. */
  endEdit(next: 'selected' | 'unselected'): void;
}

export function useSelection(doc?: Y.Doc): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setEditingId(null);
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: 'selected' | 'unselected') => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  // Keep the latest ids readable from the observer callback without re-binding.
  const idsRef = useRef({ selectedId, editingId });
  idsRef.current = { selectedId, editingId };

  useEffect(() => {
    if (doc === undefined) return;
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const onObjectsChange = () => {
      const { selectedId: selected, editingId: editing } = idsRef.current;
      if (selected !== null && !objects.has(selected)) {
        // The selected note is gone (remote or local delete): drop the local
        // selection *and* the editor, and end any drag implicitly.
        setSelectedId(null);
        setEditingId(null);
        return;
      }
      if (editing !== null && !objects.has(editing)) {
        setEditingId(null);
      }
    };
    objects.observeDeep(onObjectsChange);
    return () => {
      objects.unobserveDeep(onObjectsChange);
    };
  }, [doc]);

  return { selectedId, editingId, select, startEdit, endEdit };
}