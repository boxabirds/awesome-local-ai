// The stories 1–4 board UI (viewport, toolbar, sticky notes, sync badge),
// extracted from App when story 5 added pages. Mounted by BoardPage only
// once the board is known to exist, so a socket is never opened against an
// unknown board.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardViewport, type ViewportHandle } from '../canvas/BoardViewport';
import { installTestHook } from '../canvas/testHooks';
import { useBoardDoc } from '../board/useBoardDoc';
import { seedBoard } from '../board/seedBoard';
import { useSelection } from '../board/useSelection';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';
import { createSticky, deleteObject, snapshot } from '../../shared/board-model';
import type { Point } from '../canvas/camera';

// Editing is disabled only while the board could not be loaded: every other
// state (connecting, reconnecting, confirmed) keeps the board editable.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function BoardScreen({ boardId }: { boardId: string }) {
  const { doc, notes, connection } = useBoardDoc(boardId);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);

  // Test-only: expose the live doc, note snapshot and connection state for
  // e2e assertions. Gated by mode so seed code and hooks are dead-code
  // eliminated from production builds.
  if (import.meta.env.MODE === 'test') {
    useEffect(() => {
      installTestHook({
        board: { doc, getNotes: () => snapshot(doc), seedBoard: (count) => seedBoard(doc, count) },
        connectionState: () => connection,
      });
    }, [doc, connection]);
  }

  // Selection and editing are per-client and must not survive the note (TC-37).
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
    if (editingId !== null && !notes.some((n) => n.id === editingId)) select(null);
  }, [notes, selectedId, editingId, select]);

  const editable = canEdit(connection);

  const createStickyAtWorld = useCallback(
    (world: Point) => {
      if (!editable) return; // load_failed: creation is a no-op
      // createSticky takes the note centre, so the note lands centred here.
      const id = createSticky(doc, world);
      // Creation immediately starts editing with an empty caret (FR-4).
      if (typeof id === 'string') startEdit(id);
    },
    [doc, startEdit, editable],
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
        if (!editable) return;
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!editable) return;
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, startEdit, select, editable]);

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
      <Toolbar onCreateSticky={createStickyAtCentre} disabled={!editable} />
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
            editable={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
    </>
  );
}
