import { useCallback, useState } from 'react';

/** Where selection lands when text editing ends. */
export type EndEditTarget = 'selected' | 'unselected';

export interface SelectionApi {
  /** Note the local user has selected, or `null`. */
  selectedId: string | null;
  /** Note whose text the local user is editing, or `null`. */
  editingId: string | null;
  /** Select a note (`null` clears) and leave editing mode. */
  select(id: string | null): void;
  /** Select and start editing a note. */
  startEdit(id: string): void;
  /** Stop editing; keep or drop the selection. */
  endEdit(next: EndEditTarget): void;
}

/**
 * Selection and text-editing state for this client.
 *
 * This is deliberately local React state and never written to the Y.Doc: which
 * note *I* have selected or am typing in is not board content, and sharing it
 * is a separate concern (presence, story 6).
 */
export function useSelection(): SelectionApi {
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

  const endEdit = useCallback((next: EndEditTarget) => {
    setEditingId(null);
    if (next === 'unselected') setSelectedId(null);
  }, []);

  return { selectedId, editingId, select, startEdit, endEdit };
}
