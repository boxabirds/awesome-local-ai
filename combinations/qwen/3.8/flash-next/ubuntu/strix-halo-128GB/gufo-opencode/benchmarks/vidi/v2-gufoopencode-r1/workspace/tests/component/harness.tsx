import type { JSX, MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useNoteKeys } from '../../src/client/board/useNoteKeys';

export interface HarnessRegistry {
  doc: Y.Doc | null;
  selectedId: string | null;
  editingId: string | null;
}

// Mirrors App's wiring but exposes the Y.Doc and current selection so tests can
// assert model and selection state directly.
export function Harness(props: { registry: MutableRefObject<HarnessRegistry> }): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  useNoteKeys(doc, selection);
  props.registry.current = { doc, selectedId: selection.selectedId, editingId: selection.editingId };
  return (
    <BoardViewport
      doc={doc}
      notes={notes}
      selectedId={selection.selectedId}
      editingId={selection.editingId}
      onSelect={selection.select}
      onStartEdit={selection.startEdit}
      onEndEdit={selection.endEdit}
    />
  );
}
