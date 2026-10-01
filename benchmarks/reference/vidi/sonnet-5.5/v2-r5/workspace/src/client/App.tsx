import { useEffect, useMemo, useRef } from 'react';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { StickyNote } from './objects/StickyNote';

const HALF = 2;
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function App() {
  const { doc, notes } = useBoardDoc();
  const sel = useSelection();
  const selRef = useRef(sel);
  selRef.current = sel;

  // Stacking is CSS z-index (z, with id as DOM-order tie-break). The DOM order stays stable so that
  // bringToFront never moves a note's element, which would drop its pointer capture mid-drag.
  const domOrder = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);

  const createAt =(world: Point) => {
    const id = createSticky(doc, world);
    if (id) sel.startEdit(id);
  };

  // A selected note that no longer exists (deleted here or by a peer later) clears the selection.
  useEffect(() => {
    if (sel.selectedId && !notes.some((n) => n.id === sel.selectedId)) sel.select(null);
  }, [notes, sel]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId, editingId, startEdit, select } = selRef.current;
      if (!selectedId || editingId !== null || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (TEXT_ENTRY_TAGS.has(t.tagName) || t.isContentEditable)) return;
      if (e.key === 'Enter') {
        if (t instanceof HTMLButtonElement) return; // Enter activates the focused button
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
  }, [doc]);

  return (
    <BoardViewport
      onDoubleClickEmpty={createAt}
      onEmptyClick={() => sel.select(null)}
      overlay={(api) => (
        <>
          <Toolbar
            onCreateSticky={() => createAt(
              screenToWorld(api.getCamera(), { x: api.size.width / HALF, y: api.size.height / HALF }),
            )}
          />
          <NavigationHint visible={!api.hasNavigated} />
          <ZoomControls
            zoomPercent={zoomPercent(api.camera)}
            canZoomIn={canZoomIn(api.camera)}
            canZoomOut={canZoomOut(api.camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
        </>
      )}
    >
      {(api) => domOrder.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={api.camera.zoom}
          selected={sel.selectedId === note.id}
          editing={sel.editingId === note.id}
          onSelect={sel.select}
          onStartEdit={sel.startEdit}
          onEndEdit={sel.endEdit}
        />
      ))}
    </BoardViewport>
  );
}
