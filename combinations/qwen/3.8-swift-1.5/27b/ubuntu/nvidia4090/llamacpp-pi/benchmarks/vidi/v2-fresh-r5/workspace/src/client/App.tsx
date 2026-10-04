import { useCallback, useEffect, useRef } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { NoteToolbar } from './objects/NoteToolbar';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { worldToScreen } from './canvas/camera';

/**
 * Top-level app: wires the board document, selection state, toolbar,
 * sticky notes, and keyboard shortcuts.
 */
export default function App() {
  const { doc, notes } = useBoardDoc();
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // Camera ref updated by BoardViewport via onCameraChange callback
  const cameraRef = useRef({ x: -640, y: -400, zoom: 1 });

  const onDblClickEmpty = useCallback((screenPoint: { x: number; y: number }) => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screenPoint);
    const id = createSticky(doc, world);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit]);

  const onClickEmpty = useCallback(() => {
    select(null);
  }, [select]);

  const onCreateSticky = useCallback(() => {
    const cam = cameraRef.current;
    // Centre of the visible board area (viewport is 1280x800 default)
    const centre = { x: 640, y: 400 };
    const world = screenToWorld(cam, centre);
    const id = createSticky(doc, world);
    if (id) {
      startEdit(id);
    }
  }, [doc, startEdit]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'Enter' && selectedId && !editingId) {
        e.preventDefault();
        startEdit(selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, startEdit, select]);

  return (
    <>
      <BoardViewport
        onDblClickEmpty={onDblClickEmpty}
        onClickEmpty={onClickEmpty}
        onCameraChange={(cam) => { cameraRef.current = cam; }}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={cameraRef.current.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={onCreateSticky} />
      {selectedId && !editingId && (() => {
        const selNote = notes.find(n => n.id === selectedId);
        if (!selNote) return null;
        const cam = cameraRef.current;
        const screen = worldToScreen(cam, { x: selNote.x, y: selNote.y });
        return (
          <div style={{ position: 'fixed', left: screen.x + (STICKY_SIZE_WORLD / 2) * cam.zoom, top: screen.y + STICKY_SIZE_WORLD * cam.zoom + 8, transform: 'translateX(-50%)', zIndex: 1000 }}>
            <NoteToolbar
              color={selNote.color}
              onColor={(c) => setStickyColor(doc, selectedId, c)}
              onDelete={() => { deleteObject(doc, selectedId); select(null); }}
            />
          </div>
        );
      })()}
    </>
  );
}
