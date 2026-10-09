import type { JSX, MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';

export interface HarnessRegistry {
  doc: Y.Doc | null;
  // Derived for story 2 tests: the only selected id, or null when the
  // selection is empty or holds more than one object.
  selectedId: string | null;
  editingId: string | null;
}

// Mirrors BoardShell's wiring but exposes the Y.Doc and current selection so
// tests can assert model and selection state directly.
export function Harness(props: { registry: MutableRefObject<HarnessRegistry> }): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: true });
  const ids = [...selection.ids];
  props.registry.current = {
    doc,
    selectedId: ids.length === 1 ? ids[0] : null,
    editingId: selection.editingId
  };
  return <BoardViewport doc={doc} notes={notes} selection={selection} />;
}
