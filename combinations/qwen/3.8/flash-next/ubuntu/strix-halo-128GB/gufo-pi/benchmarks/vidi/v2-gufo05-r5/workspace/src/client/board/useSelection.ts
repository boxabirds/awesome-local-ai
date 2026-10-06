/**
 * Which note this user is looking at, and which one they are typing in.
 *
 * Selection and editing are per-user, per-tab facts: they are deliberately local React
 * state and never written to the Y.Doc, so two people on the same board (story 3) do
 * not steal each other's selection or caret.
 */
import { useCallback, useState } from 'react';

export type EndEditNext = 'selected' | 'unselected';

export interface Selection {
  readonly selectedId: string | null;
  readonly editingId: string | null;
  /** Selects a note, or clears the selection when called with `null`. */
  select(id: string | null): void;
  /** Starts text editing on a note (which is then also selected). */
  startEdit(id: string): void;
  /** Stops editing; the note stays selected, or is deselected, per `next`. */
  endEdit(next: EndEditNext): void;
}

export function useSelection(): Selection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    // editing another note is impossible; editing this one continues
    setEditingId((current) => (current !== null && current !== id ? null : current));
  }, []);

  const startEdit = useCallback((id: string) => {
    setSelectedId(id);
    setEditingId(id);
  }, []);

  const endEdit = useCallback((next: EndEditNext) => {
    setEditingId(null);
    setSelectedId((current) => (next === 'selected' ? current : null));
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
