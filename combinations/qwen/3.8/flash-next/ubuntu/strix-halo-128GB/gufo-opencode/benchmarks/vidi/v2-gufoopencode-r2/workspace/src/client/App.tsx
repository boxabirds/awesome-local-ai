import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardViewport, type ViewportHandle } from './canvas/BoardViewport';
import { installTestHook } from './canvas/testHooks';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import type { Point } from './canvas/camera';

// Story 3 routing: `/b/<boardId>` opens that board; `/` (or anything invalid)
// generates a fresh id. Temporary until story 5 adds board management.
function boardIdFromLocation(): string {
  const match = /^\/b\/([^/]+)$/.exec(window.location.pathname);
  const candidate = match === null ? '' : decodeURIComponent(match[1]);
  const id = isValidBoardId(candidate) ? candidate : newBoardId();
  window.history.replaceState(null, '', `/b/${id}`);
  return id;
}

export function App() {
  const [boardId] = useState(boardIdFromLocation);
  const { doc, notes, connection } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);

  // Test-only: expose the live doc, note snapshot and connection state for
  // e2e assertions.
  useEffect(() => {
    installTestHook({ board: { doc, getNotes: () => snapshot(doc) }, connectionState: () => connection });
  }, [doc, connection]);

  // Selection and editing are per-client and must not survive the note (TC-37).
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
    if (editingId !== null && !notes.some((n) => n.id === editingId)) select(null);
  }, [notes, selectedId, editingId, select]);

  const createStickyAtWorld = useCallback(
    (world: Point) => {
      // createSticky takes the note centre, so the note lands centred here.
      const id = createSticky(doc, world);
      // Creation immediately starts editing with an empty caret (FR-4).
      if (typeof id === 'string') startEdit(id);
    },
    [doc, startEdit],
  );

  const createStickyAtCentre = useCallback(() => {
    if (!viewport) return;
    createStickyAtWorld(viewport.centerWorld());
  }, [viewport, createStickyAtWorld]);

  // Global keyboard: Enter edits the selected note, Delete/Backspace deletes it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (editingId !== null || selectedId === null) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, startEdit, select]);

  // Render in stable creation order (never re-sorted by z) so bringToFront
  // mid-drag cannot detach the dragged node and break pointer capture; the
  // note's z-index carries the stacking order instead.
  const orderedNotes = useMemo(
    () => [...notes].sort((a, b) => a.createdAt - b.createdAt),
    [notes],
  );

  const zoom = viewport?.camera.zoom ?? 1;

  return (
    <>
      <ConnectionStatus state={connection} />
      <Toolbar onCreateSticky={createStickyAtCentre} />
      <BoardViewport
        onCreateStickyAtWorld={createStickyAtWorld}
        onClearSelection={() => select(null)}
        onViewportHandle={setViewport}
      >
        {orderedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
    </>
  );
}
