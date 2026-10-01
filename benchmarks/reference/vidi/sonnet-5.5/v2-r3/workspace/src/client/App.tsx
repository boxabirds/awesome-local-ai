import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport, type BoardViewportApi } from './canvas/BoardViewport';
import type { Point } from './canvas/camera';
import { StickyNote } from './objects/StickyNote';
import './sticky.css';

function focusInTextField(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

export function App() {
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const apiRef = useRef<BoardViewportApi | null>(null);
  // Stacking is expressed with z-index, so DOM order stays stable: re-ordering a note's element mid-drag
  // would make the browser drop its pointer capture.
  const domOrder = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);

  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // A selected or edited note that no longer exists (deleted here or elsewhere) ends the interaction.
  useEffect(() => {
    const exists = (id: string | null) => id !== null && notes.some((n) => n.id === id);
    if (editingId !== null && !exists(editingId)) endEdit('unselected');
    else if (selectedId !== null && !exists(selectedId)) select(null);
  }, [notes, selectedId, editingId, endEdit, select]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || selectedId === null || editingId !== null) return;
      if (focusInTextField()) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, selectedId, editingId, startEdit, select]);

  return (
    <>
      <BoardViewport apiRef={apiRef} onCreateAt={createAt} onEmptyClick={() => select(null)}>
        {(camera) =>
          domOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={selectedId === note.id}
              editing={editingId === note.id}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))
        }
      </BoardViewport>
      <Toolbar onCreateSticky={() => apiRef.current && createAt(apiRef.current.viewportCentreWorld())} />
    </>
  );
}
